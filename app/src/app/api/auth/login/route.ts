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
  // unenv (CF Workers' Node-compat polyfill used by opennextjs) doesn't
  // implement async iteration on Readable, so req.json() / req.text() /
  // getReader() / Response(req.body) all throw before delivering body.
  // arrayBuffer() routes through a non-iterating path that DOES work.
  let body: Body = {};
  console.log("[login] hasBody:", !!req.body, "ct:", req.headers.get("content-type"));
  try {
    const buf = await req.arrayBuffer();
    const text = new TextDecoder().decode(buf);
    console.log("[login] arrayBuffer len:", buf.byteLength, "first40:", JSON.stringify(text.slice(0, 40)));
    if (text) body = JSON.parse(text) as Body;
  } catch (e) {
    console.log("[login] err:", e instanceof Error ? e.message : String(e));
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
