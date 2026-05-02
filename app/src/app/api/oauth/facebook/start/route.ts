import { NextResponse } from "next/server";
import { isFacebookConfigured } from "@/lib/facebook";

export const runtime = "nodejs";

const FB_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "read_insights",
  "public_profile",
  "email",
].join(",");

export async function GET(req: Request) {
  if (!isFacebookConfigured()) {
    return NextResponse.json(
      {
        error:
          "Chưa cấu hình FB_APP_ID/FB_APP_SECRET — dùng tab dán token thủ công",
      },
      { status: 400 },
    );
  }
  const appId = process.env.FB_APP_ID!;
  const reqUrl = new URL(req.url);
  const redirectUri = `${reqUrl.origin}/api/oauth/facebook/callback`;

  const linkTo = reqUrl.searchParams.get("linkTo");
  const state = encodeURIComponent(
    JSON.stringify({
      linkTo: linkTo && /^\d+$/.test(linkTo) ? Number(linkTo) : null,
      nonce: Math.random().toString(36).slice(2),
    }),
  );

  const url =
    `https://www.facebook.com/v21.0/dialog/oauth` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(FB_OAUTH_SCOPES)}` +
    `&state=${state}` +
    `&response_type=code`;

  return NextResponse.redirect(url);
}
