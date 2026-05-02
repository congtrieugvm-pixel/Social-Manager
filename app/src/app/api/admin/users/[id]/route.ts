import { NextResponse } from "next/server";
import { eq, and, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
import {
  AuthError,
  deleteAllSessionsForUser,
  findUserById,
  hashPassword,
  requireAdmin,
  toSafeUser,
  validatePassword,
  validateUsername,
} from "@/lib/auth";
import { readBody } from "@/lib/req-body";

export const runtime = "nodejs";

interface PatchBody {
  username?: string;
  password?: string;
  role?: "admin" | "user";
  isActive?: boolean;
}

async function countOtherActiveAdmins(userId: number): Promise<number> {
  const rows = await db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.role, "admin"),
        eq(appUsers.isActive, 1),
        ne(appUsers.id, userId),
      ),
    );
  return rows.length;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireAdmin();
    const { id: idStr } = await ctx.params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id không hợp lệ" }, { status: 400 });
    }
    const target = await findUserById(id);
    if (!target) {
      return NextResponse.json(
        { error: "Không tìm thấy user" },
        { status: 404 },
      );
    }
  const body = await readBody<PatchBody>(req);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    let invalidatesSessions = false;

    if (typeof body.username === "string") {
      const next = body.username.trim();
      const err = validateUsername(next);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      if (next !== target.username) {
        const dup = await db
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(eq(appUsers.username, next));
        if (dup[0] && dup[0].id !== id) {
          return NextResponse.json(
            { error: "Username đã tồn tại" },
            { status: 409 },
          );
        }
        patch.username = next;
      }
    }

    if (typeof body.password === "string" && body.password.length > 0) {
      const err = validatePassword(body.password);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      patch.passwordHash = await hashPassword(body.password);
      invalidatesSessions = true;
    }

    if (body.role === "admin" || body.role === "user") {
      // Don't let admin demote themselves to a non-admin if they're the last
      // remaining active admin. Avoids locking everyone out.
      if (
        target.id === me.id &&
        target.role === "admin" &&
        body.role !== "admin"
      ) {
        const others = await countOtherActiveAdmins(target.id);
        if (others === 0) {
          return NextResponse.json(
            { error: "Không thể tự hạ quyền admin cuối cùng" },
            { status: 400 },
          );
        }
      }
      if (target.role !== body.role) {
        patch.role = body.role;
      }
    }

    if (typeof body.isActive === "boolean") {
      const desired = body.isActive ? 1 : 0;
      // Same guard against locking everyone out.
      if (
        !body.isActive &&
        target.role === "admin" &&
        target.isActive === 1
      ) {
        const others = await countOtherActiveAdmins(target.id);
        if (others === 0) {
          return NextResponse.json(
            { error: "Không thể khoá admin cuối cùng" },
            { status: 400 },
          );
        }
      }
      if (target.isActive !== desired) {
        patch.isActive = desired;
        if (desired === 0) invalidatesSessions = true;
      }
    }

    if (Object.keys(patch).length === 1) {
      // Only `updatedAt` — nothing actually changed.
      return NextResponse.json({ ok: true, user: toSafeUser(target) });
    }

    const [updated] = await db
      .update(appUsers)
      .set(patch)
      .where(eq(appUsers.id, id))
      .returning();
    if (invalidatesSessions) {
      await deleteAllSessionsForUser(id);
    }
    return NextResponse.json({ ok: true, user: toSafeUser(updated) });
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

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireAdmin();
    const { id: idStr } = await ctx.params;
    const id = Number(idStr);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id không hợp lệ" }, { status: 400 });
    }
    if (id === me.id) {
      return NextResponse.json(
        { error: "Không thể tự xoá tài khoản của mình" },
        { status: 400 },
      );
    }
    const target = await findUserById(id);
    if (!target) {
      return NextResponse.json(
        { error: "Không tìm thấy user" },
        { status: 404 },
      );
    }
    if (target.role === "admin") {
      const others = await countOtherActiveAdmins(target.id);
      if (others === 0) {
        return NextResponse.json(
          { error: "Không thể xoá admin cuối cùng" },
          { status: 400 },
        );
      }
    }
    await db.delete(appUsers).where(eq(appUsers.id, id));
    return NextResponse.json({ ok: true });
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
