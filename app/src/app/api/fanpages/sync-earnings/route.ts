import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages, facebookAccounts } from "@/lib/db/schema";
import { eq, inArray, or, isNotNull } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  fetchPageDetail,
  fetchPageEarningsBreakdown,
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
}

export async function POST(req: Request) {
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
      ids.length > 0
        ? inArray(fanpages.id, ids)
        : or(
            isNotNull(fanpages.encPageAccessToken),
            isNotNull(facebookAccounts.encAccessToken),
          ),
    );

  const results: ItemResult[] = [];
  let okCount = 0;
  let skipCount = 0;
  let errCount = 0;
  let monetizedCount = 0;
  let totalMicros = 0;

  for (const r of rows) {
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
      results.push({
        id: r.id,
        pageId: r.pageId,
        name: r.name,
        ok: false,
        error: "Không có page token và cũng không có user token",
      });
      skipCount++;
      continue;
    }
    try {
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
      results.push({
        id: r.id,
        pageId: r.pageId,
        name: r.name,
        ok: true,
        status: earnings.status,
        totalMicros: earnings.totalMicros,
        currency: earnings.currency,
        tokenSource,
        error: earnings.error ?? undefined,
      });
      if (earnings.status === "monetized") {
        monetizedCount++;
        totalMicros += earnings.totalMicros;
      }
      okCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
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
      results.push({
        id: r.id,
        pageId: r.pageId,
        name: r.name,
        ok: false,
        error: msg,
      });
      errCount++;
    }
  }

  return NextResponse.json({
    ok: true,
    total: rows.length,
    okCount,
    errCount,
    skipCount,
    monetizedCount,
    totalMicros,
    rangeStart,
    rangeEnd,
    results,
  });
}
