import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { AuthError, findUserByUsername } from "@/lib/auth";
import { readBody } from "@/lib/req-body";
import { getCurrentScopedUser } from "@/lib/scope";

// D1 caps bound parameters at 100 per statement.
const IN_CHUNK = 90;

interface Body {
  ids?: unknown;
  toUsername?: unknown;
  mode?: unknown; // "move" (default) | "copy"
}

// POST /api/accounts/transfer { ids, toUsername, mode }
// Gives the selected TikTok accounts (all their info: credentials, history,
// Hotmail tokens, stats, note) to another app user.
//   move → ownership changes; the accounts leave the sender's list
//   copy → the recipient gets a duplicate; the sender keeps theirs
// Group / status / country / machine / employee are the sender's own lists,
// so they are cleared on the recipient's side. Accounts the recipient already
// has (same username) are skipped and reported.
export async function POST(req: Request) {
  try {
    const me = await getCurrentScopedUser();
    const body = await readBody<Body>(req);
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.filter((n): n is number => Number.isInteger(n) && n > 0))]
      : [];
    const toUsername = typeof body.toUsername === "string" ? body.toUsername.trim() : "";
    const mode = body.mode === "copy" ? "copy" : "move";

    if (ids.length === 0) return NextResponse.json({ error: "Chưa chọn tài khoản" }, { status: 400 });
    if (!toUsername) return NextResponse.json({ error: "Chưa nhập user nhận" }, { status: 400 });

    const target = await findUserByUsername(toUsername);
    if (!target || !target.isActive) {
      return NextResponse.json({ error: `Không tìm thấy user “${toUsername}” (hoặc user đã bị khoá)` }, { status: 404 });
    }
    if (target.id === me.id) {
      return NextResponse.json({ error: "Không thể chuyển cho chính mình" }, { status: 400 });
    }

    // The sender's selected accounts (only their own).
    const mine: Array<typeof accounts.$inferSelect> = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      mine.push(
        ...(await db
          .select()
          .from(accounts)
          .where(and(eq(accounts.ownerUserId, me.id), inArray(accounts.id, ids.slice(i, i + IN_CHUNK))))),
      );
    }
    if (mine.length === 0) return NextResponse.json({ error: "Không tìm thấy tài khoản đã chọn" }, { status: 404 });

    // Usernames the recipient already has (case-insensitive).
    const theirs = new Set<string>();
    const lowered = [...new Set(mine.map((a) => a.username.toLowerCase()))];
    for (let i = 0; i < lowered.length; i += IN_CHUNK) {
      const rows = await db
        .select({ username: accounts.username })
        .from(accounts)
        .where(
          and(
            eq(accounts.ownerUserId, target.id),
            inArray(sql`lower(${accounts.username})`, lowered.slice(i, i + IN_CHUNK)),
          ),
        );
      for (const r of rows) theirs.add(r.username.toLowerCase());
    }

    const skipped: Array<{ username: string; reason: string }> = [];
    const todo = mine.filter((a) => {
      if (!theirs.has(a.username.toLowerCase())) return true;
      skipped.push({ username: a.username, reason: `${target.username} đã có tài khoản này` });
      return false;
    });

    const cleared = {
      ownerUserId: target.id,
      groupId: null,
      statusId: null,
      countryId: null,
      machineId: null,
      employeeId: null,
      updatedAt: new Date(),
    };
    let done = 0;
    if (mode === "move") {
      const moveIds = todo.map((a) => a.id);
      for (let i = 0; i < moveIds.length; i += IN_CHUNK) {
        await db
          .update(accounts)
          .set(cleared)
          .where(and(eq(accounts.ownerUserId, me.id), inArray(accounts.id, moveIds.slice(i, i + IN_CHUNK))));
      }
      done = moveIds.length;
    } else {
      for (const a of todo) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, createdAt, ...rest } = a;
        try {
          await db.insert(accounts).values({ ...rest, ...cleared, createdAt: new Date() });
          done++;
        } catch (e) {
          skipped.push({ username: a.username, reason: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    return NextResponse.json({ ok: true, mode, to: target.username, done, skipped });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Lỗi server: ${msg}` }, { status: 500 });
  }
}
