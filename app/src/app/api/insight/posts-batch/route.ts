import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { loadCandidates } from "@/lib/insight-tokens";
import { fetchPostsBatch, fetchScheduledBatch } from "@/lib/page-posts";
import { saveSnapshots } from "@/lib/insight-snapshots";
import { errorResponse } from "../_util";

const MAX_PAGES = 20;

// POST /api/insight/posts-batch  { pages: [{ pageId, tokens: [tokenId…] }] }
// → { results: { [pageId]: { posts, scheduled: ScheduledPost[] | null, scheduledError? } | { error, cooling? } } }
// Latest 25 posts per page with lifetime reach/views + engagement, plus the
// page's scheduled posts — two Graph Batch calls in parallel; answers saved as
// snapshots (kind 'posts').
export async function POST(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const body = await readBody<{ pages?: Array<{ pageId?: unknown; tokens?: unknown }> }>(req);
    const pages = (Array.isArray(body.pages) ? body.pages : [])
      .filter((p): p is { pageId: string; tokens: number[] } => typeof p?.pageId === "string" && /^\d+$/.test(p.pageId) && Array.isArray(p.tokens))
      .slice(0, MAX_PAGES);
    if (pages.length === 0) return NextResponse.json({ error: "Chưa có Trang nào" }, { status: 400 });

    const candidates = await loadCandidates(ownerId, [...new Set(pages.flatMap((p) => p.tokens.map(Number)))]);
    const byId = new Map(candidates.map((c) => [c.tokenId, c]));
    const items = pages.map((p) => ({
      pageId: p.pageId,
      candidates: p.tokens.map((t) => byId.get(Number(t))).filter((c): c is NonNullable<typeof c> => !!c),
    }));
    const [published, scheduled] = await Promise.all([fetchPostsBatch(items), fetchScheduledBatch(items)]);
    // Published posts decide success; the scheduled list rides along (or its
    // error, e.g. a token without the permission) without failing the page.
    const results: Record<string, unknown> = {};
    for (const [pageId, r] of Object.entries(published)) {
      if ("error" in r) {
        results[pageId] = r;
        continue;
      }
      const s = scheduled[pageId];
      results[pageId] = s && !("error" in s) ? { ...r, scheduled: s.scheduled } : { ...r, scheduled: null, scheduledError: s?.error ?? "Không đọc được" };
    }
    await saveSnapshots(
      ownerId,
      "posts",
      Object.entries(results)
        .filter(([, r]) => !(r as { error?: string }).error)
        .map(([key, data]) => ({ key, data })),
    );
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
