import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";
import {
  parseBulkImport,
  dedupByUsername,
  DEFAULT_ORDER,
  type FieldKey,
  type ParsedRow,
} from "@/lib/parser";
import { inArray, sql } from "drizzle-orm";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";
import { AuthError } from "@/lib/auth";

interface ImportBody {
  text: string;
  delimiter?: string;
  groupId?: number | null;
  order?: FieldKey[];
}

type RowStatus = "inserted" | "existing" | "conflict" | "error" | "invalid";

interface ResultRow extends ParsedRow {
  status?: RowStatus;
}

const ALLOWED_KEYS: FieldKey[] = [
  "username",
  "password",
  "email",
  "twofa",
  "emailPassword",
  "note",
  "skip",
];

// D1 caps bound parameters at 100 per statement — keep IN (...) lists well
// under that or the whole import fails with "too many SQL variables".
const IN_CHUNK = 90;

function sanitizeOrder(order: unknown): FieldKey[] {
  if (!Array.isArray(order) || order.length === 0) return DEFAULT_ORDER;
  const cleaned = order.filter((k): k is FieldKey =>
    typeof k === "string" && (ALLOWED_KEYS as string[]).includes(k)
  );
  if (cleaned.length === 0) return DEFAULT_ORDER;
  // Username must appear at least once, otherwise we cannot store the row
  if (!cleaned.includes("username")) return DEFAULT_ORDER;
  return cleaned;
}

/**
 * Look up which usernames already exist, case-insensitively and across ALL
 * owners — `accounts.username` has a global UNIQUE index, so a username owned
 * by another user would make the insert fail. Returns lowercased username →
 * owner id.
 */
async function findExisting(usernames: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const lowered = [...new Set(usernames.map((u) => u.toLowerCase()))];
  for (let i = 0; i < lowered.length; i += IN_CHUNK) {
    const chunk = lowered.slice(i, i + IN_CHUNK);
    const found = await db
      .select({ username: accounts.username, ownerUserId: accounts.ownerUserId })
      .from(accounts)
      .where(inArray(sql`lower(${accounts.username})`, chunk));
    for (const f of found) out.set(f.username.toLowerCase(), f.ownerUserId);
  }
  return out;
}

function markExisting(
  rows: ParsedRow[],
  existing: Map<string, number | null>,
  ownerId: number,
): ResultRow[] {
  return rows.map((r) => {
    if (!r.valid) return { ...r, status: "invalid" as const };
    const key = r.username.toLowerCase();
    if (!existing.has(key)) return r;
    return existing.get(key) === ownerId
      ? { ...r, valid: false, status: "existing" as const, error: "Đã tồn tại trong DB" }
      : {
          ...r,
          valid: false,
          status: "conflict" as const,
          error: "Username đã thuộc tài khoản người dùng khác",
        };
  });
}

function errorResponse(e: unknown) {
  if (e instanceof AuthError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[accounts/import]", e);
  return NextResponse.json({ error: `Lỗi server: ${msg}` }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const body = await readBody<ImportBody>(req);
    const { text, delimiter = "|", groupId = null } = body;
    const order = sanitizeOrder(body.order);

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Thiếu nội dung import" }, { status: 400 });
    }

    const parsed = parseBulkImport(text, delimiter || "|", order);
    const { rows } = dedupByUsername(parsed);
    const existing = await findExisting(
      rows.filter((r) => r.valid).map((r) => r.username),
    );
    const marked = markExisting(rows, existing, ownerId);

    const resolvedGroupId =
      typeof groupId === "number" && Number.isFinite(groupId) ? groupId : null;

    const out: ResultRow[] = [];
    for (const r of marked) {
      if (!r.valid) {
        out.push(r);
        continue;
      }
      try {
        await db.insert(accounts).values({
          ownerUserId: ownerId,
          username: r.username,
          groupId: resolvedGroupId,
          encPassword: await encrypt(r.password),
          encEmail: await encrypt(r.email),
          enc2fa: await encrypt(r.twofa),
          encEmailPassword: await encrypt(r.emailPassword),
          note: r.note || null,
        });
        out.push({ ...r, status: "inserted" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Insert failed", r.username, e);
        out.push(
          /UNIQUE/i.test(msg)
            ? { ...r, valid: false, status: "existing", error: "Đã tồn tại trong DB" }
            : { ...r, valid: false, status: "error", error: `Lỗi lưu: ${msg}` },
        );
      }
    }

    const count = (s: RowStatus) => out.filter((r) => r.status === s).length;
    return NextResponse.json({
      totalParsed: parsed.length,
      validCount: out.filter((r) => r.status !== "invalid").length,
      inserted: count("inserted"),
      skippedExisting: count("existing"),
      conflict: count("conflict"),
      failed: count("error"),
      invalid: count("invalid"),
      rows: out,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const body = await readBody<ImportBody>(req);
    const { text, delimiter = "|" } = body;
    const order = sanitizeOrder(body.order);

    if (!text) return NextResponse.json({ rows: [], duplicatesInInput: [] });
    const parsed = parseBulkImport(text, delimiter || "|", order);
    const { rows, duplicates } = dedupByUsername(parsed);
    const existing = await findExisting(
      rows.filter((r) => r.valid).map((r) => r.username),
    );

    return NextResponse.json({
      rows: markExisting(rows, existing, ownerId),
      duplicatesInInput: duplicates,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
