import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages, facebookAccounts } from "@/lib/db/schema";
import { and, eq, inArray, or, isNotNull } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";
import { getOwnerId } from "@/lib/scope";
import {
  fetchPageDetail,
  fetchPageEarningsBreakdown,
  fetchPageMonetizationOptions,
  resolveInsightRange,
} from "@/lib/facebook";
import { readBody } from "@/lib/req-body";

export const runtime = "nodejs";

interface SyncEarningsBody {
  /** When provided, sync only these fanpage row ids. Otherwise: all pages with token. */
  ids?: number[];
  /** Window length in days. Defaults to 28. Ignored if `from`/`to` provided. */
  days?: number;
  from?: number;
  to?: number;
}

interface ItemResult {
  id: number;
  pageId: string;
  name: string;
  ok: boolean;
  status?: string;
  totalMicros?: number;
  currency?: string | null;
  /** "page" when page-level access token used, "user" when fell back to user token. */
  tokenSource?: "page" | "user";
  error?: string;
  /** See insights/batch/route.ts — same classification scheme. */
  errorKind?: "perm" | "rate" | "other";
  /**
   * Explicit "Content Monetization enabled" check result:
   *   true  — `monetization_options` returned at least one feature
   *   false — explicitly empty / disabled (we skip the earnings query)
   *   null  — couldn't pre-check (field restricted), fell back to inferring
   *           from the earnings query
   */
  monetizationEnabled?: boolean | null;
  /** Comma-joined `monetization_options` from FB — diagnostic; null when not checked. */
  monetizationOptions?: string[] | null;
}

function classifyError(msg: string): "perm" | "rate" | "other" {
  if (/\(#?(200|190|10|102|459|464)\)|sufficient administrative permission|Invalid OAuth|access token/i.test(msg)) {
    return "perm";
  }
  if (/\(#?(4|17|32|341|613)\)|rate limit|too many calls|temporarily blocked/i.test(msg)) {
    return "rate";
  }
  return "other";
}

export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  const body = await readBody<SyncEarningsBody>(req);

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    : [];

  const rangeOpts = {
    // Default to last 365 days. Library chunks ranges >93d into 90-day windows.
    days:
      typeof body.days === "number" && Number.isFinite(body.days) && body.days > 0
        ? body.days
        : 365,
    from:
      typeof body.from === "number" && Number.isFinite(body.from) && body.from > 0
        ? body.from
        : undefined,
    to:
      typeof body.to === "number" && Number.isFinite(body.to) && body.to > 0
        ? body.to
        : undefined,
  };
  const { start: rangeStart, end: rangeEnd } = resolveInsightRange(rangeOpts);

  // Join with facebook_accounts so we can fall back to the user-level token
  // when a fanpage has no per-page access_token (FB doesn't return per-page
  // tokens for Business-Manager-only pages or when `pages_manage_metadata`
  // wasn't granted at sync time). User token works for `/{page-id}/insights`
  // when the user is admin/analyst of the page and has `pages_read_engagement`.
  const rows = await db
    .select({
      id: fanpages.id,
      pageId: fanpages.pageId,
      name: fanpages.name,
      encPageAccessToken: fanpages.encPageAccessToken,
      encUserToken: facebookAccounts.encAccessToken,
    })
    .from(fanpages)
    .leftJoin(facebookAccounts, eq(fanpages.fbAccountId, facebookAccounts.id))
    .where(
      and(
        eq(fanpages.ownerUserId, ownerId),
        ids.length > 0
          ? inArray(fanpages.id, ids)
          : or(
              isNotNull(fanpages.encPageAccessToken),
              isNotNull(facebookAccounts.encAccessToken),
            ),
      ),
    );

  type Tagged = ItemResult & {
    _kind: "ok" | "skip" | "perm" | "rate" | "err";
    _monetized?: boolean;
    _micros?: number;
  };

  // Parallelize per page. Each fanpage has its own token, so FB rate limits
  // don't compound across the chunk. Drops chunk wall-time from Σ(pages) to
  // max(pages) — typically 4–5× speedup for monetization sync (the FB
  // earnings endpoint is the slow part, ~1–2s per page).
  const tagged = await Promise.all(
    rows.map(async (r): Promise<Tagged> => {
      const now = new Date();
      let token = await decrypt(r.encPageAccessToken);
      let tokenSource: "page" | "user" = "page";

      // Aggressive backfill: when no page token is stored but a user token is
      // available, try to recover the page token via /{page-id}?fields=access_token.
      // FB returns it only when the user has full admin role on that page —
      // when it succeeds, persist the token so future syncs are faster and use
      // page-level permissions which work better for monetization endpoints.
      if (!token && r.encUserToken) {
        const userTok = await decrypt(r.encUserToken);
        if (userTok) {
          try {
            const detail = await fetchPageDetail(r.pageId, userTok);
            if (detail?.access_token) {
              token = detail.access_token;
              tokenSource = "page";
              await db
                .update(fanpages)
                .set({
                  encPageAccessToken: await encrypt(detail.access_token),
                  updatedAt: now,
                })
                .where(eq(fanpages.id, r.id));
            }
          } catch {
            // best-effort; fall through to user-token path
          }
        }
      }
      if (!token) {
        token = await decrypt(r.encUserToken);
        tokenSource = "user";
      }
      if (!token) {
        return {
          id: r.id,
          pageId: r.pageId,
          name: r.name,
          ok: false,
          error: "Không có page token và cũng không có user token",
          _kind: "skip",
        };
      }
      try {
        // Step 1 — explicit Content-Monetization-enabled check. User asked
        // for this so the route can confirm "page bật kiếm tiền nội dung"
        // before spending subrequests on the earnings metric. When FB
        // confirms `monetization_options` is empty, we short-circuit to
        // status=not_monetized without firing the earnings query (saves
        // ~5 subrequests × N pages on tenant runs where most pages aren't
        // enrolled). When the field is restricted, fall through to the
        // earnings query and let the existing inference handle it.
        const monet = await fetchPageMonetizationOptions(r.pageId, token);
        if (monet.enabled === false) {
          await db
            .update(fanpages)
            .set({
              monetizationStatus: "not_monetized",
              monetizationError: null,
              earningsValue: 0,
              earningsCurrency: null,
              earningsRangeStart: rangeStart,
              earningsRangeEnd: rangeEnd,
              earningsUpdatedAt: now,
              earningsBreakdownJson: "[]",
              updatedAt: now,
            })
            .where(eq(fanpages.id, r.id));
          return {
            id: r.id,
            pageId: r.pageId,
            name: r.name,
            ok: true,
            status: "not_monetized",
            totalMicros: 0,
            currency: null,
            tokenSource,
            monetizationEnabled: false,
            monetizationOptions: [],
            _kind: "ok",
            _monetized: false,
            _micros: 0,
          };
        }

        // Step 2 — earnings fetch. monet.enabled is true (verified) or
        // null (couldn't verify); either way we run the metric query.
        const earnings = await fetchPageEarningsBreakdown(r.pageId, token, rangeOpts);
        await db
          .update(fanpages)
          .set({
            monetizationStatus: earnings.status,
            monetizationError: earnings.error,
            earningsValue: earnings.totalMicros,
            earningsCurrency: earnings.currency,
            earningsRangeStart: earnings.rangeStart,
            earningsRangeEnd: earnings.rangeEnd,
            earningsUpdatedAt: now,
            earningsBreakdownJson: JSON.stringify(earnings.sources),
            updatedAt: now,
          })
          .where(eq(fanpages.id, r.id));
        return {
          id: r.id,
          pageId: r.pageId,
          name: r.name,
          ok: true,
          status: earnings.status,
          totalMicros: earnings.totalMicros,
          currency: earnings.currency,
          tokenSource,
          error: earnings.error ?? undefined,
          monetizationEnabled: monet.enabled,
          monetizationOptions: monet.options,
          _kind: "ok",
          _monetized: earnings.status === "monetized",
          _micros: earnings.totalMicros,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const kind = classifyError(msg);
        // Reset status to "unknown" so the UI doesn't show stale "monetized"
        // with old earnings_value when fetch fails entirely. Clear the value
        // too — anything stale is misleading.
        await db
          .update(fanpages)
          .set({
            monetizationStatus: "unknown",
            monetizationError: msg,
            earningsValue: null,
            earningsBreakdownJson: null,
            earningsUpdatedAt: now,
            updatedAt: now,
          })
          .where(eq(fanpages.id, r.id));
        return {
          id: r.id,
          pageId: r.pageId,
          name: r.name,
          ok: false,
          error: msg,
          errorKind: kind,
          _kind: kind === "perm" ? "perm" : kind === "rate" ? "rate" : "err",
        };
      }
    }),
  );

  let okCount = 0;
  let skipCount = 0;
  let permCount = 0;
  let rateCount = 0;
  let errCount = 0;
  let monetizedCount = 0;
  // Sub-categories of `okCount` based on Content-Monetization status. Lets
  // the UI render "X bật KT, Y chưa bật, Z không xác minh được, W thiếu quyền"
  // without re-iterating `results` on the client side.
  let enabledMonetizedCount = 0; // monet.enabled = true AND earned > 0
  let enabledZeroCount = 0;       // monet.enabled = true AND earned 0 (eligible but no income in window)
  let disabledCount = 0;          // monet.enabled = false (explicit "page chưa bật KT")
  let unknownEnabledCount = 0;    // monet.enabled = null (couldn't pre-check)
  let totalMicros = 0;
  const results: ItemResult[] = [];
  for (const t of tagged) {
    if (t._kind === "ok") {
      okCount++;
      if (t._monetized) {
        monetizedCount++;
        totalMicros += t._micros ?? 0;
      }
      if (t.monetizationEnabled === false) {
        disabledCount++;
      } else if (t.monetizationEnabled === true) {
        if ((t._micros ?? 0) > 0) enabledMonetizedCount++;
        else enabledZeroCount++;
      } else {
        unknownEnabledCount++;
      }
    } else if (t._kind === "skip") {
      skipCount++;
    } else if (t._kind === "perm") {
      permCount++;
    } else if (t._kind === "rate") {
      rateCount++;
    } else {
      errCount++;
    }
    const { _kind: _k, _monetized: _m, _micros: _mu, ...item } = t;
    void _k;
    void _m;
    void _mu;
    results.push(item);
  }

  return NextResponse.json({
    ok: true,
    total: rows.length,
    okCount,
    errCount,
    permCount,
    rateCount,
    skipCount,
    monetizedCount,
    enabledMonetizedCount,
    enabledZeroCount,
    disabledCount,
    unknownEnabledCount,
    totalMicros,
    rangeStart,
    rangeEnd,
    results,
  });
}
