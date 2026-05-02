import { NextResponse } from "next/server";
import {
  AuthError,
  createUser,
  listUsers,
  requireAdmin,
} from "@/lib/auth";
import { readBody } from "@/lib/req-body";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const users = await listUsers();
    return NextResponse.json({ users });
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

interface CreateBody {
  username?: string;
  password?: string;
  role?: "admin" | "user";
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
  const body = await readBody<CreateBody>(req);
    const username = (body.username ?? "").trim();
    const password = body.password ?? "";
    const role = body.role === "admin" ? "admin" : "user";
    const user = await createUser({ username, password, role });
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
