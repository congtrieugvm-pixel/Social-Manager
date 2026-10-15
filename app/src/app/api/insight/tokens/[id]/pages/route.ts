import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/scope";
import { loadCandidates, setTokenError } from "@/lib/insight-tokens";
import {
  fetchBusinessPages,
  fetchMeAccounts,
  mapTokenErrorToVi,
  parseGraphError,
  type FbPage,
} from "@/lib/facebook";
import { rememberPageToken } from "@/lib/page-reach";
import { saveSnapshots } from "@/lib/insight-snapshots";
import { errorResponse, parseId } from "../../../_util";

// GET → { pages: [{ id, name }] } — pages this token can read, live from
// Graph (classic + Business Manager). One request per token keeps each Worker
// invocation far under the subrequest cap. A page token lists just its page.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let tokenId: number | null = null;
  try {
    const ownerId = await getOwnerId();
    tokenId = parseId((await ctx.params).id);
    const [c] = tokenId ? await loadCandidates(ownerId, [tokenId]) : [];
    if (!c) return NextResponse.json({ error: "Không tìm thấy token" }, { status: 404 });

    if (c.kind === "page") {
      const one = [{ id: c.fbId, name: c.label }];
      await saveSnapshots(ownerId, "pages", [{ key: `t:${c.tokenId}`, data: one }]);
      return NextResponse.json({ pages: one });
    }

    const byId = new Map<string, FbPage>();
    for (const p of await fetchMeAccounts(c.token)) byId.set(p.id, p);
    const biz = await fetchBusinessPages(c.token);
    for (const p of biz.pages) if (!byId.has(p.id)) byId.set(p.id, p);

    const pages = [...byId.values()].map((p) => {
      if (p.access_token) rememberPageToken(c.tokenId, p.id, p.access_token);
      return { id: p.id, name: p.name };
    });
    await setTokenError(c.tokenId, null);
    await saveSnapshots(ownerId, "pages", [{ key: `t:${c.tokenId}`, data: pages }]);
    return NextResponse.json({ pages });
  } catch (e) {
    const info = parseGraphError(e);
    if (info.code === null && !(e as { graph?: unknown })?.graph) return errorResponse(e);
    const message = mapTokenErrorToVi(info);
    if (tokenId) await setTokenError(tokenId, message).catch(() => {});
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
