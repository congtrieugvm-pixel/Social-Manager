import { NextResponse } from "next/server";
import {
  clearAccountTokens,
  fetchRecentMessages,
  getValidAccessToken,
  isAzureConfigured,
  loadAccountTokens,
} from "@/lib/ms-graph";
import { pickLatestOtp } from "@/lib/otp-extract";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  await clearAccountTokens(id);
  return NextResponse.json({ ok: true });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  if (!isAzureConfigured()) {
    return NextResponse.json(
      {
        error:
          "Chưa cấu hình Azure AD app (AZURE_CLIENT_ID / AZURE_CLIENT_SECRET trong .env)",
      },
      { status: 500 },
    );
  }

  const tokens = await loadAccountTokens(id);
  if (!tokens) {
    return NextResponse.json(
      {
        needsAuth: true,
        authUrl: `/api/oauth/microsoft/start?accountId=${id}`,
      },
      { status: 200 },
    );
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Refresh lỗi";
    // Refresh token rejected (revoked / expired). Clear so user can re-auth.
    if (msg.toLowerCase().includes("aadsts") || msg.toLowerCase().includes("invalid_grant")) {
      await clearAccountTokens(id);
      return NextResponse.json(
        {
          needsAuth: true,
          authUrl: `/api/oauth/microsoft/start?accountId=${id}`,
          error: "Token hết hạn, cần đăng nhập lại Microsoft",
        },
        { status: 200 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  try {
    const messages = await fetchRecentMessages(accessToken, 15);
    const match = pickLatestOtp(messages);
    if (!match) {
      return NextResponse.json(
        {
          error:
            "Không tìm thấy mã OTP 6 số trong 15 email mới nhất (trong vòng 15 phút)",
        },
        { status: 404 },
      );
    }
    return NextResponse.json({
      code: match.code,
      subject: match.subject,
      from: match.fromAddress,
      receivedAt: match.receivedAt,
      snippet: match.snippet,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Lỗi Graph API";
    if (msg.includes("401")) {
      await clearAccountTokens(id);
      return NextResponse.json(
        {
          needsAuth: true,
          authUrl: `/api/oauth/microsoft/start?accountId=${id}`,
          error: "Access token bị từ chối, cần đăng nhập lại",
        },
        { status: 200 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
