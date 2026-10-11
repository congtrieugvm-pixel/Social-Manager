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
import { and, eq, inArray, sql } from "drizzle-orm";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";
import { AuthError } from "@/lib/auth";

interface ImportBody {
  text: string;
  delimiter?: string;
  groupId?: number | null;
  order?: FieldKey[];
}

type RowStatus = "inserted" | "existing" | "error" | "invalid";

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
 * Usernames (lowercased) that already exist in THIS user's accounts. Other
 * users may hold the same TikTok username — uniqueness is per owner
 * (index accounts_owner_username_unique, migration 0006).
 */
async function findExisting(usernames: string[], ownerId: number): Promise<Set<string>> {
  const out = new Set<string>();
  const lowered = [...new Set(usernames.map((u) => u.toLowerCase()))];
  for (let i = 0; i < lowered.length; i += IN_CHUNK) {
    const chunk = lowered.slice(i, i + IN_CHUNK);
    const found = await db
      .select({ username: accounts.username })
      .from(accounts)
      .where(and(eq(accounts.ownerUserId, ownerId), inArray(sql`lower(${accounts.username})`, chunk)));
    for (const f of found) out.add(f.username.toLowerCase());
  }
  return out;
}

function markExisting(rows: ParsedRow[], existing: Set<string>): ResultRow[] {
  return rows.map((r) => {
    if (!r.valid) return { ...r, status: "invalid" as const };
    return existing.has(r.username.toLowerCase())
      ? { ...r, valid: false, status: "existing" as const, error: "Đã có trong tài khoản của bạn" }
      : r;
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
      ownerId,
    );
    const marked = markExisting(rows, existing);

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
      ownerId,
    );

    return NextResponse.json({
      rows: markExisting(rows, existing),
      duplicatesInInput: duplicates,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
