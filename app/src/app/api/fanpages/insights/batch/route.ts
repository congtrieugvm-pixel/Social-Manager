import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages } from "@/lib/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { fetchPageInsights, resolveInsightRange } from "@/lib/facebook";
import { recordFanpageSnapshot } from "@/lib/fanpage-snapshot";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

interface BatchBody {
  ids?: number[];
  /** Last N days. Ignored when `from`/`to` are supplied. */
  days?: number;
  /** Epoch seconds. */
  from?: number;
  to?: number;
}

interface ItemResult {
  id: number;
  pageId: string;
  name: string;
  ok: boolean;
  error?: string;
  /**
   * Classification of `error` for UI purposes:
   *  - "perm"  → FB returned #200/#190 (admin role missing, 2FA required,
   *              token invalid). User must fix on FB side; not a bug.
   *  - "rate"  → FB returned #4/#17/#32 (rate-limit). Transient.
   *  - "other" → real error (network, malformed response, app bug).
   * Only set when ok === false.
   */
  errorKind?: "perm" | "rate" | "other";
}

/**
 * Maps FB Graph error text to a coarse category. Permission errors are
 * the dominant noise source — many user accounts have stored page tokens
 * that have since lost admin access (page transferred, 2FA enforced on
 * the owning Business, etc.). The UI uses this to suppress the verbose
 * raw error toast for permission cases (the user can't fix them by
 * retrying) and just show a "X thiếu quyền" count.
 */
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
  const body = await readBody<BatchBody>(req);

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    : [];

  const rangeOpts = {
    // Default to last 365 days. Library chunks ranges >93d into 90-day windows.
    days: typeof body.days === "number" && Number.isFinite(body.days) && body.days > 0
      ? body.days
      : 365,
    from: typeof body.from === "number" && Number.isFinite(body.from) && body.from > 0
      ? body.from
      : undefined,
    to: typeof body.to === "number" && Number.isFinite(body.to) && body.to > 0
      ? body.to
      : undefined,
  };
  const { start: rangeStart, end: rangeEnd } = resolveInsightRange(rangeOpts);

  const rows = await db
    .select({
      id: fanpages.id,
      pageId: fanpages.pageId,
      name: fanpages.name,
      encPageAccessToken: fanpages.encPageAccessToken,
      fanCount: fanpages.fanCount,
      followersCount: fanpages.followersCount,
    })
    .from(fanpages)
    .where(
      and(
        eq(fanpages.ownerUserId, ownerId),
        ids.length > 0
          ? inArray(fanpages.id, ids)
          : isNotNull(fanpages.encPageAccessToken),
      ),
    );

  // Per-page status produced inside the parallel mapper so we can tally after.
  // "perm" / "rate" are subcategories of failure; tallied separately for UI.
  type Tagged = ItemResult & { _kind: "ok" | "skip" | "perm" | "rate" | "err" };

  // Parallelize per page. Each fanpage has its OWN page-token, so FB Graph
  // rate limits are independent across pages — concurrent calls don't risk
  // the per-token cap. Workers Paid gives 1000 subrequests / 30s wall, so
  // even a 15-page chunk × ~10 inner subreqs = 150 concurrent reqs fits.
  // Wall-clock per chunk drops from ~Σ(per-page) to ~max(per-page).
  const tagged = await Promise.all(
    rows.map(async (r): Promise<Tagged> => {
      const token = await decrypt(r.encPageAccessToken);
      if (!token) {
        return {
          id: r.id,
          pageId: r.pageId,
          name: r.name,
          ok: false,
          error: "Chưa có page access token",
          _kind: "skip",
        };
      }
      const now = new Date();
      try {
        const insights = await fetchPageInsights(r.pageId, token, rangeOpts);
        await db
          .update(fanpages)
          .set({
            insightsJson: JSON.stringify(insights),
            lastSyncedAt: now,
            lastSyncError: null,
            updatedAt: now,
          })
          .where(inArray(fanpages.id, [r.id]));
        await recordFanpageSnapshot(r.id, insights, {
          fanCount: r.fanCount,
          followersCount: r.followersCount,
          rangeStart,
          rangeEnd,
        });
        return {
          id: r.id,
          pageId: r.pageId,
          name: r.name,
          ok: true,
          _kind: "ok",
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const kind = classifyError(msg);
        await db
          .update(fanpages)
          .set({ lastSyncError: msg, lastSyncedAt: now, updatedAt: now })
          .where(inArray(fanpages.id, [r.id]));
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
  const results: ItemResult[] = [];
  for (const t of tagged) {
    if (t._kind === "ok") okCount++;
    else if (t._kind === "skip") skipCount++;
    else if (t._kind === "perm") permCount++;
    else if (t._kind === "rate") rateCount++;
    else errCount++;
    const { _kind: _omit, ...item } = t;
    void _omit;
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
    rangeStart,
    rangeEnd,
    results,
  });
}
