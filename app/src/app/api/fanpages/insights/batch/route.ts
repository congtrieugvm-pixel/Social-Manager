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

  // Parallel per-page processing within the chunk. The client already chunks
  // ids (typically 3 per request) to stay under CF Workers' subrequest budget,
  // so running those 3 in parallel inside one Worker invocation cuts wall-
  // clock from 3×FB-API-time to max(FB-API-times) — roughly 3× faster on
  // multi-page chunks. Subrequest *count* is unchanged (parallel doesn't
  // multiply subrequests, just shortens wall-clock).
  type Outcome =
    | { kind: "ok"; result: ItemResult }
    | { kind: "skip"; result: ItemResult }
    | { kind: "err"; result: ItemResult };

  const outcomes: Outcome[] = await Promise.all(
    rows.map(async (r): Promise<Outcome> => {
      const token = await decrypt(r.encPageAccessToken);
      if (!token) {
        return {
          kind: "skip",
          result: {
            id: r.id,
            pageId: r.pageId,
            name: r.name,
            ok: false,
            error: "Chưa có page access token",
          },
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
          kind: "ok",
          result: { id: r.id, pageId: r.pageId, name: r.name, ok: true },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db
          .update(fanpages)
          .set({ lastSyncError: msg, lastSyncedAt: now, updatedAt: now })
          .where(inArray(fanpages.id, [r.id]));
        return {
          kind: "err",
          result: {
            id: r.id,
            pageId: r.pageId,
            name: r.name,
            ok: false,
            error: msg,
          },
        };
      }
    }),
  );

  const results: ItemResult[] = outcomes.map((o) => o.result);
  const okCount = outcomes.filter((o) => o.kind === "ok").length;
  const skipCount = outcomes.filter((o) => o.kind === "skip").length;
  const errCount = outcomes.filter((o) => o.kind === "err").length;

  return NextResponse.json({
    ok: true,
    total: rows.length,
    okCount,
    errCount,
    skipCount,
    rangeStart,
    rangeEnd,
    results,
  });
}
