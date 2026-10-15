import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { loadCandidates } from "@/lib/insight-tokens";
import { fetchReachBatch } from "@/lib/page-reach";
import { saveSnapshots } from "@/lib/insight-snapshots";
import { errorResponse } from "../_util";

const MAX_PAGES = 50; // Graph batch limit

// POST /api/insight/reach-batch  { pages: [{ pageId, tokens: [tokenId…] }] }
// → { results: { [pageId]: ReachResult | { error, cooling? } } }
// One Graph Batch call for the whole list (see fetchReachBatch); answers are
// saved as snapshots so a page reload shows them without calling Graph.
export async function POST(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const body = await readBody<{ pages?: Array<{ pageId?: unknown; tokens?: unknown }> }>(req);
    const pages = (Array.isArray(body.pages) ? body.pages : [])
      .filter((p): p is { pageId: string; tokens: number[] } => typeof p?.pageId === "string" && /^\d+$/.test(p.pageId) && Array.isArray(p.tokens))
      .slice(0, MAX_PAGES);
    if (pages.length === 0) return NextResponse.json({ error: "Chưa có Trang nào" }, { status: 400 });

    const allIds = [...new Set(pages.flatMap((p) => p.tokens.map(Number)))];
    const candidates = await loadCandidates(ownerId, allIds);
    const byId = new Map(candidates.map((c) => [c.tokenId, c]));

    const results = await fetchReachBatch(
      pages.map((p) => ({
        pageId: p.pageId,
        candidates: p.tokens.map((t) => byId.get(Number(t))).filter((c): c is NonNullable<typeof c> => !!c),
      })),
    );

    // Save everything that is an answer (incl. "unsupported"); errors stay
    // unsaved so the last good numbers keep showing.
    await saveSnapshots(
      ownerId,
      "reach",
      Object.entries(results)
        .filter(([, r]) => !("error" in r))
        .map(([key, data]) => ({ key, data })),
    );
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
