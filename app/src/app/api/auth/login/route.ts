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
  let body: Body = {};
  console.log("[login] start, ct:", req.headers.get("content-type"));
  // Try every body method until one works. unenv polyfill blocks some.
  const methods = ["formData", "blob", "json", "text", "arrayBuffer"] as const;
  for (const m of methods) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cloned = (req as any).clone() as Request;
      let result: unknown = null;
      if (m === "formData") {
        const fd = await cloned.formData();
        result = Object.fromEntries(fd.entries());
      } else if (m === "blob") {
        const blob = await cloned.blob();
        result = await blob.text();
      } else if (m === "json") {
        result = await cloned.json();
      } else if (m === "text") {
        result = await cloned.text();
      } else {
        const buf = await cloned.arrayBuffer();
        result = new TextDecoder().decode(buf);
      }
      const repr = typeof result === "string" ? result.slice(0, 60) : JSON.stringify(result).slice(0, 60);
      console.log(`[login] ${m} OK:`, repr);
      if (typeof result === "string" && result.length > 0) {
        body = JSON.parse(result) as Body;
      } else if (typeof result === "object" && result !== null) {
        body = result as Body;
      }
      break;
    } catch (e) {
      console.log(`[login] ${m} err:`, e instanceof Error ? e.message : String(e));
    }
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
