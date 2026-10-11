import { NextResponse } from "next/server";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { listTokens, saveToken } from "@/lib/insight-tokens";
import { forgetToken } from "@/lib/page-reach";
import { errorResponse } from "../_util";

// GET → { tokens: SafeInsightToken[] }   (never the raw token)
export async function GET() {
  try {
    const ownerId = await getOwnerId();
    return NextResponse.json({ tokens: await listTokens(ownerId) });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST { token, label? } → validates against Graph, saves encrypted.
// Same Facebook user/page again → replaces the stored token.
export async function POST(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const body = await readBody<{ token?: string; label?: string }>(req);
    if (!body.token?.trim()) {
      return NextResponse.json({ error: "Chưa nhập token" }, { status: 400 });
    }
    const result = await saveToken(ownerId, body.token, body.label ?? null);
    if (result.replaced) forgetToken(result.token.id);
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
