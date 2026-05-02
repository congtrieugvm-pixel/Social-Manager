import {
  exchangeCodeForToken,
  fetchMeEmail,
  saveAccountTokens,
} from "@/lib/ms-graph";
import { decrypt } from "@/lib/crypto";

interface StatePayload {
  a: number;
  n: string;
  e: number;
}

function renderResultHtml({
  ok,
  message,
  accountId,
}: {
  ok: boolean;
  message: string;
  accountId: number | null;
}): string {
  const title = ok ? "Kết nối Hotmail thành công" : "Kết nối Hotmail thất bại";
  const color = ok ? "#5eb37a" : "#e05b5b";
  const safeMessage = message.replace(/</g, "&lt;");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { background: #0a0a0a; color: #e5e5e5; font-family: system-ui, sans-serif; padding: 40px; text-align: center; }
    .card { max-width: 420px; margin: 0 auto; padding: 28px; background: #111; border: 1px solid #242424; border-radius: 10px; }
    h1 { font-size: 18px; margin: 0 0 10px; color: ${color}; }
    p { color: #9a9a9a; font-size: 13px; margin: 8px 0; }
    code { color: #5e6ad2; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${safeMessage}</p>
    <p><code>Cửa sổ này sẽ tự đóng…</code></p>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({
          type: "ms-oauth-result",
          ok: ${ok ? "true" : "false"},
          accountId: ${accountId ?? "null"},
          message: ${JSON.stringify(message)},
        }, window.location.origin);
      }
    } catch (e) {}
    setTimeout(function(){ try { window.close(); } catch(e){} }, 1500);
  </script>
</body>
</html>`;
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const err = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (err) {
    return htmlResponse(
      renderResultHtml({ ok: false, message: err, accountId: null }),
      400,
    );
  }
  if (!code || !stateRaw) {
    return htmlResponse(
      renderResultHtml({
        ok: false,
        message: "Thiếu code hoặc state từ Microsoft",
        accountId: null,
      }),
      400,
    );
  }

  let accountId: number | null = null;
  try {
    const decoded = Buffer.from(stateRaw, "base64url").toString("utf8");
    const plain = decrypt(decoded);
    if (!plain) throw new Error("state decrypt failed");
    const parsed = JSON.parse(plain) as StatePayload;
    if (!parsed.a || typeof parsed.a !== "number") throw new Error("bad state");
    if (!parsed.e || parsed.e < Math.floor(Date.now() / 1000)) {
      throw new Error("state expired");
    }
    accountId = parsed.a;
  } catch (e) {
    return htmlResponse(
      renderResultHtml({
        ok: false,
        message: "State không hợp lệ: " + (e instanceof Error ? e.message : "unknown"),
        accountId: null,
      }),
      400,
    );
  }

  try {
    const tokens = await exchangeCodeForToken(code);
    const email = await fetchMeEmail(tokens.access_token).catch(() => null);
    await saveAccountTokens(accountId, tokens, email);
    return htmlResponse(
      renderResultHtml({
        ok: true,
        message: email
          ? `Đã cấp quyền cho ${email}. Giờ có thể lấy code Hotmail.`
          : "Đã cấp quyền Microsoft. Giờ có thể lấy code Hotmail.",
        accountId,
      }),
    );
  } catch (e) {
    return htmlResponse(
      renderResultHtml({
        ok: false,
        message: e instanceof Error ? e.message : "Lỗi token exchange",
        accountId,
      }),
      500,
    );
  }
}
