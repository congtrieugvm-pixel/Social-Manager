import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { AuthError } from "@/lib/auth";
import { generateExtKey, sha256Hex } from "@/lib/ext-auth";

// Manage the current user's browser-extension API key. Session-authenticated (same-origin).
//   GET    → { exists }          does the user have a key?
//   POST   → { key }             generate/rotate; the plaintext is returned ONCE
//   DELETE → { ok }              revoke
const noStore = { "Cache-Control": "no-store" };
const fail = (e: unknown) => e instanceof AuthError
  ? NextResponse.json({ error: e.message }, { status: e.status, headers: noStore })
  : NextResponse.json({ error: "Lỗi server" }, { status: 500, headers: noStore });

export async function GET() {
  try {
    const ownerId = await getOwnerId();
    const [u] = await db.select({ h: appUsers.extKeyHash }).from(appUsers).where(eq(appUsers.id, ownerId));
    return NextResponse.json({ exists: !!u?.h }, { headers: noStore });
  } catch (e) { return fail(e); }
}

export async function POST() {
  try {
    const ownerId = await getOwnerId();
    const key = generateExtKey();
    await db.update(appUsers).set({ extKeyHash: await sha256Hex(key) }).where(eq(appUsers.id, ownerId));
    return NextResponse.json({ key }, { headers: noStore });
  } catch (e) { return fail(e); }
}

export async function DELETE() {
  try {
    const ownerId = await getOwnerId();
    await db.update(appUsers).set({ extKeyHash: null }).where(eq(appUsers.id, ownerId));
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) { return fail(e); }
}
