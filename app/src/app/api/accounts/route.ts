import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts, groups, statuses, countries, machines, employees } from "@/lib/db/schema";
import { asc, desc, eq, isNull, sql, type SQL, type AnyColumn } from "drizzle-orm";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type SortKey =
  | "createdAt"
  | "username"
  | "group"
  | "status"
  | "country"
  | "machine"
  | "employee"
  | "follower"
  | "video";

const SORT_COLUMNS: Record<SortKey, AnyColumn> = {
  createdAt: accounts.createdAt,
  username: accounts.username,
  group: groups.name,
  status: statuses.name,
  country: countries.name,
  machine: machines.name,
  employee: employees.name,
  follower: accounts.followerCount,
  video: accounts.videoCount,
};

function parseSort(raw: string | null): SortKey {
  if (raw && raw in SORT_COLUMNS) return raw as SortKey;
  return "createdAt";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const groupParam = url.searchParams.get("group");
  const statusParam = url.searchParams.get("status");
  const sortKey = parseSort(url.searchParams.get("sort"));
  const dir = url.searchParams.get("dir") === "asc" ? "asc" : "desc";
  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const limitRaw = Number(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const limit = Math.min(
    MAX_LIMIT,
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : DEFAULT_LIMIT
  );
  const offset = (page - 1) * limit;

  const filters = [] as ReturnType<typeof eq>[];
  if (groupParam === "none") filters.push(isNull(accounts.groupId) as unknown as ReturnType<typeof eq>);
  else if (groupParam && Number.isFinite(Number(groupParam))) {
    filters.push(eq(accounts.groupId, Number(groupParam)));
  }
  if (statusParam === "none") filters.push(isNull(accounts.statusId) as unknown as ReturnType<typeof eq>);
  else if (statusParam && Number.isFinite(Number(statusParam))) {
    filters.push(eq(accounts.statusId, Number(statusParam)));
  }

  const whereClause = filters.length === 0 ? undefined : filters.reduce((a, b) => sql`${a} AND ${b}`);

  const sortCol = SORT_COLUMNS[sortKey];
  const primaryOrder = dir === "asc" ? asc(sortCol) : desc(sortCol);
  // Secondary deterministic tiebreaker on id so paging is stable.
  const orderBy: SQL[] = [primaryOrder, desc(accounts.id) as unknown as SQL];

  const baseSelect = db
    .select({
      id: accounts.id,
      username: accounts.username,
      note: accounts.note,
      avatarUrl: accounts.avatarUrl,
      followerCount: accounts.followerCount,
      followingCount: accounts.followingCount,
      videoCount: accounts.videoCount,
      lastVideos: accounts.lastVideos,
      lastSyncedAt: accounts.lastSyncedAt,
      lastSyncError: accounts.lastSyncError,
      encPassword: accounts.encPassword,
      encEmail: accounts.encEmail,
      enc2fa: accounts.enc2fa,
      encEmailPassword: accounts.encEmailPassword,
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
    .leftJoin(employees, eq(accounts.employeeId, employees.id));

  const rows = whereClause
    ? await baseSelect
        .where(whereClause)
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset)
    : await baseSelect.orderBy(...orderBy).limit(limit).offset(offset);

  const countQuery = db
    .select({ total: sql<number>`COUNT(*)`.as("total") })
    .from(accounts);
  const [{ total }] = whereClause
    ? await countQuery.where(whereClause)
    : await countQuery;

  const safe = rows.map((r) => ({
    id: r.id,
    username: r.username,
    note: r.note,
    avatarUrl: r.avatarUrl,
    followerCount: r.followerCount,
    followingCount: r.followingCount,
    videoCount: r.videoCount,
    lastVideos: r.lastVideos ? JSON.parse(r.lastVideos) : null,
    lastSyncedAt: r.lastSyncedAt,
    lastSyncError: r.lastSyncError,
    hasPassword: !!r.encPassword,
    hasEmail: !!r.encEmail,
    has2fa: !!r.enc2fa,
    hasEmailPassword: !!r.encEmailPassword,
    createdAt: r.createdAt,
    groupId: r.groupId,
    groupName: r.groupName,
    groupColor: r.groupColor,
    statusId: r.statusId,
    statusName: r.statusName,
    statusColor: r.statusColor,
    countryId: r.countryId,
    countryName: r.countryName,
    countryCode: r.countryCode,
    countryColor: r.countryColor,
    machineId: r.machineId,
    machineName: r.machineName,
    machineColor: r.machineColor,
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    employeeColor: r.employeeColor,
  }));
  return NextResponse.json({ accounts: safe, total, page, limit, sort: sortKey, dir });
}
