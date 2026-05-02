import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  facebookAccounts,
  groups,
  statuses,
  countries,
  machines,
  employees,
} from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";
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
  return [
    { enc: prevEnc, changedAt: Math.floor(Date.now() / 1000) },
    ...current,
  ].slice(0, 3);
}

async function decodeHistory(
  raw: string | null,
): Promise<Array<{ value: string | null; changedAt: number }>> {
  return Promise.all(
    parseHistory(raw).map(async (e) => ({
      value: await decrypt(e.enc),
      changedAt: e.changedAt,
    })),
  );
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const [row] = await db
    .select({
      id: facebookAccounts.id,
      username: facebookAccounts.username,
      encPassword: facebookAccounts.encPassword,
      encEmail: facebookAccounts.encEmail,
      enc2fa: facebookAccounts.enc2fa,
      encEmailPassword: facebookAccounts.encEmailPassword,
      encAccessToken: facebookAccounts.encAccessToken,
      tokenExpiresAt: facebookAccounts.tokenExpiresAt,
      passwordHistory: facebookAccounts.passwordHistory,
      emailPasswordHistory: facebookAccounts.emailPasswordHistory,
      fbUserId: facebookAccounts.fbUserId,
      fbName: facebookAccounts.fbName,
      fbProfilePic: facebookAccounts.fbProfilePic,
      note: facebookAccounts.note,
      lastSyncedAt: facebookAccounts.lastSyncedAt,
      lastSyncError: facebookAccounts.lastSyncError,
      createdAt: facebookAccounts.createdAt,
      groupId: facebookAccounts.groupId,
      groupName: groups.name,
      groupColor: groups.color,
      statusId: facebookAccounts.statusId,
      statusName: statuses.name,
      statusColor: statuses.color,
      countryId: facebookAccounts.countryId,
      countryName: countries.name,
      countryCode: countries.code,
      countryColor: countries.color,
      machineId: facebookAccounts.machineId,
      machineName: machines.name,
      machineColor: machines.color,
      employeeId: facebookAccounts.employeeId,
      employeeName: employees.name,
      employeeColor: employees.color,
    })
    .from(facebookAccounts)
    .leftJoin(groups, eq(facebookAccounts.groupId, groups.id))
    .leftJoin(statuses, eq(facebookAccounts.statusId, statuses.id))
    .leftJoin(countries, eq(facebookAccounts.countryId, countries.id))
    .leftJoin(machines, eq(facebookAccounts.machineId, machines.id))
    .leftJoin(employees, eq(facebookAccounts.employeeId, employees.id))
    .where(eq(facebookAccounts.id, id));
  if (!row) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    username: row.username,
    password: await decrypt(row.encPassword),
    email: await decrypt(row.encEmail),
    twofa: await decrypt(row.enc2fa),
    emailPassword: await decrypt(row.encEmailPassword),
    token: await decrypt(row.encAccessToken),
    hasToken: !!row.encAccessToken,
    tokenExpiresAt: row.tokenExpiresAt,
    passwordHistory: await decodeHistory(row.passwordHistory),
    emailPasswordHistory: await decodeHistory(row.emailPasswordHistory),
    fbUserId: row.fbUserId,
    fbName: row.fbName,
    fbProfilePic: row.fbProfilePic,
    note: row.note,
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
    token?: string | null;
    tokenExpiresAt?: number | null;
    note?: string;
    groupId?: number | null;
    statusId?: number | null;
    countryId?: number | null;
    machineId?: number | null;
    employeeId?: number | null;
  }>(req);

  const [current] = await db
    .select({
      id: facebookAccounts.id,
      username: facebookAccounts.username,
      encPassword: facebookAccounts.encPassword,
      encEmailPassword: facebookAccounts.encEmailPassword,
      passwordHistory: facebookAccounts.passwordHistory,
      emailPasswordHistory: facebookAccounts.emailPasswordHistory,
    })
    .from(facebookAccounts)
    .where(eq(facebookAccounts.id, id));
  if (!current) return NextResponse.json({ error: "Không tìm thấy" }, { status: 404 });

  const patch: Partial<typeof facebookAccounts.$inferInsert> = { updatedAt: new Date() };

  if (typeof body.username === "string") {
    const newUsername = body.username.trim().replace(/^@/, "");
    if (!newUsername) {
      return NextResponse.json({ error: "Username không được trống" }, { status: 400 });
    }
    if (newUsername !== current.username) {
      const [clash] = await db
        .select({ id: facebookAccounts.id })
        .from(facebookAccounts)
        .where(and(eq(facebookAccounts.username, newUsername), ne(facebookAccounts.id, id)));
      if (clash) {
        return NextResponse.json({ error: "Username đã tồn tại" }, { status: 409 });
      }
      patch.username = newUsername;
    }
  }

  if (typeof body.note === "string") patch.note = body.note;

  if (body.password !== undefined) {
    const newPlain = body.password ?? "";
    const oldPlain = await decrypt(current.encPassword) ?? "";
    if (newPlain !== oldPlain) {
      patch.encPassword = await encrypt(newPlain);
      const hist = parseHistory(current.passwordHistory);
      patch.passwordHistory = JSON.stringify(pushHistory(hist, current.encPassword));
    }
  }
  if (body.emailPassword !== undefined) {
    const newPlain = body.emailPassword ?? "";
    const oldPlain = await decrypt(current.encEmailPassword) ?? "";
    if (newPlain !== oldPlain) {
      patch.encEmailPassword = await encrypt(newPlain);
      const hist = parseHistory(current.emailPasswordHistory);
      patch.emailPasswordHistory = JSON.stringify(pushHistory(hist, current.encEmailPassword));
    }
  }
  if (body.email !== undefined) patch.encEmail = await encrypt(body.email ?? "");
  if (body.twofa !== undefined) patch.enc2fa = await encrypt(body.twofa ?? "");
  if (body.token !== undefined) {
    patch.encAccessToken = body.token ? await encrypt(body.token) : null;
  }
  if (body.tokenExpiresAt !== undefined) {
    patch.tokenExpiresAt = body.tokenExpiresAt;
  }

  const fkFields: Array<[keyof typeof body, keyof typeof patch]> = [
    ["groupId", "groupId"],
    ["statusId", "statusId"],
    ["countryId", "countryId"],
    ["machineId", "machineId"],
    ["employeeId", "employeeId"],
  ];
  for (const [bodyKey, patchKey] of fkFields) {
    const v = body[bodyKey];
    if (v === null) (patch as Record<string, unknown>)[patchKey] = null;
    else if (typeof v === "number" && Number.isFinite(v)) {
      (patch as Record<string, unknown>)[patchKey] = v;
    }
  }

  await db.update(facebookAccounts).set(patch).where(eq(facebookAccounts.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  await db.delete(facebookAccounts).where(eq(facebookAccounts.id, id));
  return NextResponse.json({ ok: true });
}
