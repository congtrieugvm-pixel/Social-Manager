import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts, groups, statuses, countries, machines, employees } from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";
import { readBody } from "@/lib/req-body";

interface HistoryEntry {
  enc: string;
  changedAt: number;
}

function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e): e is HistoryEntry =>
        e && typeof e.enc === "string" && typeof e.changedAt === "number",
    );
  } catch {
    return [];
  }
}

function pushHistory(current: HistoryEntry[], prevEnc: string | null): HistoryEntry[] {
  if (!prevEnc) return current;
  const next = [
    { enc: prevEnc, changedAt: Math.floor(Date.now() / 1000) },
    ...current,
  ];
  return next.slice(0, 3);
}

function decodeHistory(raw: string | null): Array<{ value: string | null; changedAt: number }> {
  return parseHistory(raw).map((e) => ({
    value: decrypt(e.enc),
    changedAt: e.changedAt,
  }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const [row] = await db
    .select({
      id: accounts.id,
      username: accounts.username,
      encPassword: accounts.encPassword,
      encEmail: accounts.encEmail,
      enc2fa: accounts.enc2fa,
      encEmailPassword: accounts.encEmailPassword,
      passwordHistory: accounts.passwordHistory,
      emailPasswordHistory: accounts.emailPasswordHistory,
      encMsRefreshToken: accounts.encMsRefreshToken,
      msEmail: accounts.msEmail,
      note: accounts.note,
      avatarUrl: accounts.avatarUrl,
      followerCount: accounts.followerCount,
      followingCount: accounts.followingCount,
      videoCount: accounts.videoCount,
      lastVideos: accounts.lastVideos,
      lastSyncedAt: accounts.lastSyncedAt,
      lastSyncError: accounts.lastSyncError,
      createdAt: accounts.createdAt,
      groupId: accounts.groupId,
      groupName: groups.name,
      groupColor: groups.color,
      statusId: accounts.statusId,
      statusName: statuses.name,
      statusColor: statuses.color,
      countryId: accounts.countryId,
      countryName: countries.name,
      countryCode: countries.code,
      countryColor: countries.color,
      machineId: accounts.machineId,
      machineName: machines.name,
      machineColor: machines.color,
      employeeId: accounts.employeeId,
      employeeName: employees.name,
      employeeColor: employees.color,
    })
    .from(accounts)
    .leftJoin(groups, eq(accounts.groupId, groups.id))
    .leftJoin(statuses, eq(accounts.statusId, statuses.id))
    .leftJoin(countries, eq(accounts.countryId, countries.id))
    .leftJoin(machines, eq(accounts.machineId, machines.id))
    .leftJoin(employees, eq(accounts.employeeId, employees.id))
    .where(eq(accounts.id, id));
  if (!row) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    username: row.username,
    password: decrypt(row.encPassword),
    email: decrypt(row.encEmail),
    twofa: decrypt(row.enc2fa),
    emailPassword: decrypt(row.encEmailPassword),
    passwordHistory: decodeHistory(row.passwordHistory),
    emailPasswordHistory: decodeHistory(row.emailPasswordHistory),
    hasMsToken: !!row.encMsRefreshToken,
    msEmail: row.msEmail,
    note: row.note,
    avatarUrl: row.avatarUrl,
    followerCount: row.followerCount,
    followingCount: row.followingCount,
    videoCount: row.videoCount,
    lastVideos: row.lastVideos ? JSON.parse(row.lastVideos) : null,
    lastSyncedAt: row.lastSyncedAt,
    lastSyncError: row.lastSyncError,
    createdAt: row.createdAt,
    groupId: row.groupId,
    groupName: row.groupName,
    groupColor: row.groupColor,
    statusId: row.statusId,
    statusName: row.statusName,
    statusColor: row.statusColor,
    countryId: row.countryId,
    countryName: row.countryName,
    countryCode: row.countryCode,
    countryColor: row.countryColor,
    machineId: row.machineId,
    machineName: row.machineName,
    machineColor: row.machineColor,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    employeeColor: row.employeeColor,
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await readBody<{
    username?: string;
    password?: string | null;
    email?: string | null;
    twofa?: string | null;
    emailPassword?: string | null;
    note?: string;
    groupId?: number | null;
    statusId?: number | null;
    countryId?: number | null;
    machineId?: number | null;
    employeeId?: number | null;
  }>(req);

  // Load current record for history diffing + uniqueness check baseline.
  const [current] = await db
    .select({
      id: accounts.id,
      username: accounts.username,
      encPassword: accounts.encPassword,
      encEmailPassword: accounts.encEmailPassword,
      passwordHistory: accounts.passwordHistory,
      emailPasswordHistory: accounts.emailPasswordHistory,
    })
    .from(accounts)
    .where(eq(accounts.id, id));
  if (!current) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });

  const patch: Partial<typeof accounts.$inferInsert> = { updatedAt: new Date() };

  if (typeof body.username === "string") {
    const newUsername = body.username.trim().replace(/^@/, "");
    if (!newUsername) {
      return NextResponse.json({ error: "Username không được trống" }, { status: 400 });
    }
    if (newUsername !== current.username) {
      const [clash] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.username, newUsername), ne(accounts.id, id)));
      if (clash) {
        return NextResponse.json({ error: "Username đã tồn tại" }, { status: 409 });
      }
      patch.username = newUsername;
    }
  }

  if (typeof body.note === "string") patch.note = body.note;

  // Encrypt credentials; track history for password + email password.
  // Compare plaintext (decrypted) — ciphertext always differs due to random IV.
  if (body.password !== undefined) {
    const newPlain = body.password ?? "";
    const oldPlain = decrypt(current.encPassword) ?? "";
    if (newPlain !== oldPlain) {
      patch.encPassword = encrypt(newPlain);
      const hist = parseHistory(current.passwordHistory);
      patch.passwordHistory = JSON.stringify(pushHistory(hist, current.encPassword));
    }
  }
  if (body.emailPassword !== undefined) {
    const newPlain = body.emailPassword ?? "";
    const oldPlain = decrypt(current.encEmailPassword) ?? "";
    if (newPlain !== oldPlain) {
      patch.encEmailPassword = encrypt(newPlain);
      const hist = parseHistory(current.emailPasswordHistory);
      patch.emailPasswordHistory = JSON.stringify(pushHistory(hist, current.encEmailPassword));
    }
  }
  if (body.email !== undefined) patch.encEmail = encrypt(body.email ?? "");
  if (body.twofa !== undefined) patch.enc2fa = encrypt(body.twofa ?? "");

  if (body.groupId === null) patch.groupId = null;
  else if (typeof body.groupId === "number" && Number.isFinite(body.groupId)) {
    patch.groupId = body.groupId;
  }
  if (body.statusId === null) patch.statusId = null;
  else if (typeof body.statusId === "number" && Number.isFinite(body.statusId)) {
    patch.statusId = body.statusId;
  }
  if (body.countryId === null) patch.countryId = null;
  else if (typeof body.countryId === "number" && Number.isFinite(body.countryId)) {
    patch.countryId = body.countryId;
  }
  if (body.machineId === null) patch.machineId = null;
  else if (typeof body.machineId === "number" && Number.isFinite(body.machineId)) {
    patch.machineId = body.machineId;
  }
  if (body.employeeId === null) patch.employeeId = null;
  else if (typeof body.employeeId === "number" && Number.isFinite(body.employeeId)) {
    patch.employeeId = body.employeeId;
  }

  await db.update(accounts).set(patch).where(eq(accounts.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  await db.delete(accounts).where(eq(accounts.id, id));
  return NextResponse.json({ ok: true });
}
