import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { getOwnerId } from "@/lib/scope";
import { loadCandidates } from "@/lib/insight-accounts";
import {
  fetchBusinessPages,
  fetchMeAccounts,
  mapTokenErrorToVi,
  parseGraphError,
  type FbPage,
} from "@/lib/facebook";
import { rememberPageToken } from "@/lib/page-reach";

// Pages one Facebook account can manage (classic + Business Manager), read
// live from Graph. One request per account keeps each Worker invocation far
// under the subrequest cap, whatever the number of accounts.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await getOwnerId();
    const { id: idStr } = await ctx.params;
    const [candidate] = await loadCandidates(ownerId, [Number(idStr)]);
    if (!candidate) {
      return NextResponse.json(
        { error: "Không tìm thấy tài khoản hoặc tài khoản chưa có token" },
        { status: 404 },
      );
    }

    const byId = new Map<string, FbPage>();
    for (const p of await fetchMeAccounts(candidate.userToken)) byId.set(p.id, p);
    const biz = await fetchBusinessPages(candidate.userToken);
    for (const p of biz.pages) if (!byId.has(p.id)) byId.set(p.id, p);

    const pages = [...byId.values()].map((p) => {
      if (p.access_token) rememberPageToken(candidate.accountId, p.id, p.access_token);
      return { id: p.id, name: p.name };
    });
    return NextResponse.json({ pages });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: mapTokenErrorToVi(parseGraphError(e)) },
      { status: 502 },
    );
  }
}
