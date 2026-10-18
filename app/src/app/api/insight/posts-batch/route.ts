import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { loadCandidates } from "@/lib/insight-tokens";
import { fetchPostsBatch } from "@/lib/page-posts";
import { saveSnapshots } from "@/lib/insight-snapshots";
import { errorResponse } from "../_util";

const MAX_PAGES = 20;

// POST /api/insight/posts-batch  { pages: [{ pageId, tokens: [tokenId…] }] }
// → { results: { [pageId]: { posts: PagePost[] } | { error, cooling? } } }
// Latest 25 posts per page with lifetime reach/views + engagement, one Graph
// Batch call; answers saved as snapshots (kind 'posts').
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
    const results = await fetchPostsBatch(
      pages.map((p) => ({
        pageId: p.pageId,
        candidates: p.tokens.map((t) => byId.get(Number(t))).filter((c): c is NonNullable<typeof c> => !!c),
      })),
    );
    await saveSnapshots(
      ownerId,
      "posts",
      Object.entries(results)
        .filter(([, r]) => !("error" in r))
        .map(([key, data]) => ({ key, data })),
    );
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
