import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
import {
  AuthError,
  COOKIE_OPTIONS,
  SESSION_COOKIE,
  createSession,
  createUser,
} from "@/lib/auth";

export const runtime = "nodejs";

interface Body {
  username?: string;
  password?: string;
}

export async function POST(req: Request) {
  // Self-registration always creates a regular user; admin role can only be
  // granted by an existing admin via /admin/users. If you want to disable
  // self-registration entirely, set DISABLE_REGISTRATION=1 in .env.
  if (process.env.DISABLE_REGISTRATION === "1") {
    return NextResponse.json(
      { error: "Đăng ký đã bị tắt — liên hệ admin" },
      { status: 403 },
    );
  }

  // Read body via Web Streams (see /api/auth/login for full rationale —
  // unenv's partial polyfill on CF Workers breaks req.json()/req.text()).
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
    // handled below
  }
  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || !password) {
    return NextResponse.json(
      { error: "Thiếu username hoặc password" },
      { status: 400 },
    );
  }

  try {
    // First user to register gets admin (one-time bootstrap). Subsequent
    // registrations are plain users. Admin role for later users must be
    // granted via /admin/users by an existing admin.
    const [{ count }] = (await db
      .select({ count: sql<number>`count(*)` })
      .from(appUsers)) as Array<{ count: number }>;
    const role: "admin" | "user" = count === 0 ? "admin" : "user";
    const user = await createUser({ username, password, role });
    const { token } = await createSession(user.id);
    const jar = await cookies();
    jar.set(SESSION_COOKIE, token, COOKIE_OPTIONS);
    return NextResponse.json({ ok: true, user });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
