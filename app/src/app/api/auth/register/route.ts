import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers, statuses, countries, machines, employees } from "@/lib/db/schema";
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
    // Seed per-user defaults so empty workspace has the same dimension
    // values existing users had pre-multi-tenancy. Insert as ownerUserId
    // = the new user. createUser doesn't do this — keeping it lean.
    await Promise.all([
      db.insert(statuses).values([
        { ownerUserId: user.id, name: "BKT",       color: "#2d5a3d", sortOrder: 10 },
        { ownerUserId: user.id, name: "TKT",       color: "#2f6bb0", sortOrder: 20 },
        { ownerUserId: user.id, name: "ĐANG BUILD", color: "#b88c3a", sortOrder: 30 },
      ]),
      db.insert(countries).values([
        { ownerUserId: user.id, name: "Việt Nam",  code: "VN", color: "#d94a1f", sortOrder: 10 },
        { ownerUserId: user.id, name: "Hoa Kỳ",    code: "US", color: "#2f6bb0", sortOrder: 20 },
        { ownerUserId: user.id, name: "Anh",       code: "UK", color: "#7a4e9c", sortOrder: 30 },
        { ownerUserId: user.id, name: "Châu Âu",   code: "EU", color: "#2d5a3d", sortOrder: 40 },
        { ownerUserId: user.id, name: "Nhật",      code: "JP", color: "#c23e6f", sortOrder: 50 },
        { ownerUserId: user.id, name: "Hàn Quốc",  code: "KR", color: "#b88c3a", sortOrder: 60 },
        { ownerUserId: user.id, name: "Khác",      code: "OT", color: "#7a766a", sortOrder: 90 },
      ]),
      db.insert(machines).values([
        { ownerUserId: user.id, name: "Máy 01", color: "#3f8fb0", sortOrder: 10 },
        { ownerUserId: user.id, name: "Máy 02", color: "#7a4e9c", sortOrder: 20 },
        { ownerUserId: user.id, name: "Máy 03", color: "#2d5a3d", sortOrder: 30 },
      ]),
      db.insert(employees).values([
        { ownerUserId: user.id, name: "Chưa gán", color: "#7a766a", sortOrder: 0 },
      ]),
    ]);
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
