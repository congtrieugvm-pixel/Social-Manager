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
  // Read body via raw stream wrapped in a fresh Response — Next's request
  // wrapper on opennextjs/Cloudflare Workers eats the body before
  // req.json()/req.text() can read it. Constructing a new Response from
  // the underlying ReadableStream side-steps that wrapper.
  let body: Body = {};
  let rawText = "";
  try {
    if (req.body) {
      rawText = await new Response(req.body).text();
    } else {
      rawText = await req.text();
    }
    console.log("[login] body text length:", rawText.length, "first40:", rawText.slice(0, 40));
    if (rawText) body = JSON.parse(rawText) as Body;
  } catch (e) {
    console.log("[login] body parse error:", e instanceof Error ? e.message : String(e));
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
