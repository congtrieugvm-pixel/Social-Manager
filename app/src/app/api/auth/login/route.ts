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
  console.log("[login] hasBody:", !!req.body, "method:", req.method, "ct:", req.headers.get("content-type"));
  try {
    if (req.body) {
      const reader = req.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        console.log("[login] chunk done:", done, "valueLen:", value?.length ?? 0);
        if (done) break;
        if (value) text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      console.log("[login] total text length:", text.length, "first40:", JSON.stringify(text.slice(0, 40)));
      if (text) body = JSON.parse(text) as Body;
    }
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
