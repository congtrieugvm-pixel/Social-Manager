import { NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  isAzureConfigured,
} from "@/lib/ms-graph";
import { encrypt } from "@/lib/crypto";

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

  const url = new URL(req.url);
  const accountIdRaw = url.searchParams.get("accountId");
  const accountId = Number(accountIdRaw);
  if (!Number.isFinite(accountId) || accountId <= 0) {
    return NextResponse.json({ error: "Invalid accountId" }, { status: 400 });
  }

  // Encrypted state carries accountId + short expiry. No external store needed.
  const payload = JSON.stringify({
    a: accountId,
    n: Math.random().toString(36).slice(2, 10),
    e: Math.floor(Date.now() / 1000) + 600, // 10-minute window
  });
  const state = encrypt(payload);
  if (!state) {
    return NextResponse.json({ error: "Lỗi tạo state" }, { status: 500 });
  }

  // URL-safe base64 form: replace chars that Microsoft rejects in query strings.
  const stateParam = Buffer.from(state, "utf8").toString("base64url");
  const authorizeUrl = buildAuthorizeUrl(stateParam);
  return NextResponse.redirect(authorizeUrl);
}
