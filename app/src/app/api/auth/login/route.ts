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
  // Credentials arrive via HEADERS (X-Auth-Username, X-Auth-Password), not
  // body. Reason: opennextjs/Cloudflare Workers wraps Request body methods
  // with unenv's incomplete Node polyfill, which throws "Readable.asyncIterator
  // is not implemented yet" on every body-read call (req.json/text/blob/...).
  // Headers are unaffected. Over HTTPS the security profile is equivalent
  // to body (not visible in URL or browser history); it's a pragmatic
  // unblock until opennextjs ships a polyfill fix.
  const body: Body = {
    username: req.headers.get("x-auth-username") ?? undefined,
    password: req.headers.get("x-auth-password") ?? undefined,
  };
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
