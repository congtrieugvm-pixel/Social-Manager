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
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";

const PAGE_SIZE = 50;

type SortKey =
  | "createdAt"
  | "username"
  | "group"
  | "status"
  | "country"
  | "machine"
  | "employee"
  | "fbName";

const SORT_COLUMNS: Record<SortKey, AnyColumn> = {
  createdAt: facebookAccounts.createdAt,
  username: facebookAccounts.username,
  group: groups.name,
  status: statuses.name,
  country: countries.name,
  machine: machines.name,
  employee: employees.name,
  fbName: facebookAccounts.fbName,
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const search = (url.searchParams.get("q") || "").trim();
  const groupFilter = url.searchParams.get("group"); // "all" | "none" | <id>
  const sortKey = (url.searchParams.get("sort") || "createdAt") as SortKey;
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";

  const sortCol = SORT_COLUMNS[sortKey] ?? facebookAccounts.createdAt;
  const primaryOrder = dir === "asc" ? asc(sortCol) : desc(sortCol);
  const orderBy: SQL[] = [primaryOrder, desc(facebookAccounts.id) as unknown as SQL];

  const filters: SQL[] = [];
  if (search) {
    filters.push(
      or(
        like(facebookAccounts.username, `%${search}%`),
        like(facebookAccounts.note, `%${search}%`),
        like(facebookAccounts.fbName, `%${search}%`),
      ) as SQL,
    );
  }
  if (groupFilter === "none") {
    filters.push(sql`${facebookAccounts.groupId} IS NULL` as SQL);
  } else if (groupFilter && groupFilter !== "all") {
    const gid = Number(groupFilter);
    if (Number.isFinite(gid)) filters.push(eq(facebookAccounts.groupId, gid));
  }
  const whereExpr = filters.length > 0 ? and(...filters) : undefined;

  const [{ c: total }] = await db
    .select({ c: sql<number>`count(*)` })
    .from(facebookAccounts)
    .where(whereExpr ?? sql`1=1`);

  const rows = await db
    .select({
      id: facebookAccounts.id,
      username: facebookAccounts.username,
      fbUserId: facebookAccounts.fbUserId,
      fbName: facebookAccounts.fbName,
      fbProfilePic: facebookAccounts.fbProfilePic,
      hasToken: sql<number>`CASE WHEN ${facebookAccounts.encAccessToken} IS NOT NULL THEN 1 ELSE 0 END`,
      tokenExpiresAt: facebookAccounts.tokenExpiresAt,
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
    .where(whereExpr ?? sql`1=1`)
    .orderBy(...orderBy)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return NextResponse.json({
    rows: rows.map((r) => ({ ...r, hasToken: !!r.hasToken })),
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    username: string;
    password?: string;
    email?: string;
    twofa?: string;
    emailPassword?: string;
    token?: string;
    note?: string;
    groupId?: number | null;
  };

  const username = body.username?.trim().replace(/^@/, "");
  if (!username) {
    return NextResponse.json({ error: "Thiếu username" }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: facebookAccounts.id })
    .from(facebookAccounts)
    .where(eq(facebookAccounts.username, username));
  if (existing) {
    return NextResponse.json({ error: "Username đã tồn tại" }, { status: 409 });
  }

  const [row] = await db
    .insert(facebookAccounts)
    .values({
      username,
      encPassword: encrypt(body.password ?? ""),
      encEmail: encrypt(body.email ?? ""),
      enc2fa: encrypt(body.twofa ?? ""),
      encEmailPassword: encrypt(body.emailPassword ?? ""),
      encAccessToken: body.token ? encrypt(body.token) : null,
      note: body.note ?? null,
      groupId:
        typeof body.groupId === "number" && Number.isFinite(body.groupId)
          ? body.groupId
          : null,
    })
    .returning({ id: facebookAccounts.id });

  return NextResponse.json({ id: row.id });
}
