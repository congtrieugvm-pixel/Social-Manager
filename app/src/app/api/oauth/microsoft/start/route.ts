import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import {
  buildAuthorizeUrl,
  isAzureConfigured,
} from "@/lib/ms-graph";
import { encrypt } from "@/lib/crypto";
import { getOwnerId } from "@/lib/scope";

export async function GET(req: Request) {
  if (!isAzureConfigured()) {
    return NextResponse.json(
      {
        error:
          "Chưa cấu hình Azure AD app. Thiếu AZURE_CLIENT_ID / AZURE_CLIENT_SECRET trong .env",
      },
      { status: 500 },
    );
  }

  const ownerId = await getOwnerId();
  const url = new URL(req.url);
  const accountIdRaw = url.searchParams.get("accountId");
  const accountId = Number(accountIdRaw);
  if (!Number.isFinite(accountId) || accountId <= 0) {
    return NextResponse.json({ error: "Invalid accountId" }, { status: 400 });
  }
  // Verify the account belongs to the current user — otherwise user A could
  // start an OAuth flow against user B's account row by guessing the id.
  const [owned] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.ownerUserId, ownerId)));
  if (!owned) {
    return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  }

  // Encrypted state carries accountId + short expiry. No external store needed.
  const payload = JSON.stringify({
    a: accountId,
    n: Math.random().toString(36).slice(2, 10),
    e: Math.floor(Date.now() / 1000) + 600, // 10-minute window
  });
  const state = await encrypt(payload);
  if (!state) {
    return NextResponse.json({ error: "Lỗi tạo state" }, { status: 500 });
  }

  // URL-safe base64 form: replace chars that Microsoft rejects in query strings.
  const stateParam = Buffer.from(state, "utf8").toString("base64url");
  const authorizeUrl = buildAuthorizeUrl(stateParam);
  return NextResponse.redirect(authorizeUrl);
}
