import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { facebookAccounts } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { clearHotmailProfile, startHotmailLogin } from "@/lib/hotmail-login";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

function profileKey(id: number): string {
  return `fb-${id}`;
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: facebookAccounts.id,
      encEmail: facebookAccounts.encEmail,
      encEmailPassword: facebookAccounts.encEmailPassword,
    })
    .from(facebookAccounts)
    .where(and(eq(facebookAccounts.id, id), eq(facebookAccounts.ownerUserId, ownerId)));

  if (!row) {
    return NextResponse.json({ error: "Không tìm thấy tài khoản" }, { status: 404 });
  }

  const email = await decrypt(row.encEmail) ?? "";
  const password = await decrypt(row.encEmailPassword) ?? "";

  if (!email) {
    return NextResponse.json(
      { error: "Tài khoản chưa có email" },
      { status: 400 },
    );
  }

  try {
    await startHotmailLogin({
      accountId: id,
      email,
      password,
      profileKey: profileKey(id),
    });
    return NextResponse.json({
      ok: true,
      message: password
        ? "Đã mở Chromium, đang tự điền email/mật khẩu"
        : "Đã mở Chromium, chưa có mật khẩu nên chỉ điền email",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ownerId = await getOwnerId();
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const [owned] = await db
    .select({ id: facebookAccounts.id })
    .from(facebookAccounts)
    .where(and(eq(facebookAccounts.id, id), eq(facebookAccounts.ownerUserId, ownerId)));
  if (!owned) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });
  await clearHotmailProfile(profileKey(id));
  return NextResponse.json({ ok: true });
}
