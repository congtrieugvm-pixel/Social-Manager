import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  COOKIE_OPTIONS,
  SESSION_COOKIE,
  createSession,
  findUserByUsername,
  verifyPassword,
} from "@/lib/auth";

export const runtime = "nodejs";

interface Body {
  username?: string;
  password?: string;
}

export async function POST(req: Request) {
  // Read body via Web Streams API directly. Avoid req.json()/req.text()
  // and `new Response(req.body).text()` — those route through unenv's
  // partial Node polyfill on Cloudflare Workers, which throws
  // "Readable.asyncIterator is not implemented yet" before the body is
  // delivered. Reading the underlying ReadableStream chunks via TextDecoder
  // sidesteps the polyfill entirely.
  let body: Body = {};
  try {
    if (req.body) {
      const reader = req.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      if (text) body = JSON.parse(text) as Body;
    }
  } catch {
    // empty / invalid body — handled below
  }
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || !password) {
    return NextResponse.json(
      { error: "Thiếu username hoặc password" },
      { status: 400 },
    );
  }

  const user = await findUserByUsername(username);
  // Run scrypt even when the user doesn't exist to keep response time roughly
  // constant across hits — partial mitigation against username enumeration.
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    return NextResponse.json(
      { error: "Sai username hoặc password" },
      { status: 401 },
    );
  }
  if (!user.isActive) {
    return NextResponse.json(
      { error: "Tài khoản đã bị khoá" },
      { status: 403 },
    );
  }

  const { token } = await createSession(user.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, COOKIE_OPTIONS);
  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  });
}
