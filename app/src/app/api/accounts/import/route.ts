import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";
import {
  parseBulkImport,
  dedupByUsername,
  DEFAULT_ORDER,
  type FieldKey,
} from "@/lib/parser";
import { inArray } from "drizzle-orm";
import { readBody } from "@/lib/req-body";

interface ImportBody {
  text: string;
  delimiter?: string;
  groupId?: number | null;
  order?: FieldKey[];
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

export async function POST(req: Request) {
  const body = await readBody<ImportBody>(req);
  const { text, delimiter = "|", groupId = null } = body;
  const order = sanitizeOrder(body.order);

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "Thiếu nội dung import" }, { status: 400 });
  }

  const parsed = parseBulkImport(text, delimiter, order);
  const { rows } = dedupByUsername(parsed);
  const valid = rows.filter((r) => r.valid);

  if (valid.length === 0) {
    return NextResponse.json({ error: "Không có dòng hợp lệ", rows }, { status: 400 });
  }

  const usernames = valid.map((r) => r.username);
  const existing = await db
    .select({ username: accounts.username })
    .from(accounts)
    .where(inArray(accounts.username, usernames));
  const existingSet = new Set(existing.map((e) => e.username.toLowerCase()));

  const toInsert = valid.filter((r) => !existingSet.has(r.username.toLowerCase()));
  const skipped = valid.filter((r) => existingSet.has(r.username.toLowerCase()));

  const resolvedGroupId =
    typeof groupId === "number" && Number.isFinite(groupId) ? groupId : null;

  let inserted = 0;
  for (const r of toInsert) {
    try {
      await db.insert(accounts).values({
        username: r.username,
        groupId: resolvedGroupId,
        encPassword: await encrypt(r.password),
        encEmail: await encrypt(r.email),
        enc2fa: await encrypt(r.twofa),
        encEmailPassword: await encrypt(r.emailPassword),
        note: r.note || null,
      });
      inserted++;
    } catch (e) {
      console.error("Insert failed", r.username, e);
    }
  }

  return NextResponse.json({
    totalParsed: parsed.length,
    validCount: valid.length,
    inserted,
    skippedExisting: skipped.length,
    invalid: rows.filter((r) => !r.valid).length,
    rows,
  });
}

export async function PUT(req: Request) {
  const body = await readBody<ImportBody>(req);
  const { text, delimiter = "|" } = body;
  const order = sanitizeOrder(body.order);

  if (!text) return NextResponse.json({ rows: [] });
  const parsed = parseBulkImport(text, delimiter, order);
  const { rows, duplicates } = dedupByUsername(parsed);

  const usernames = rows.filter((r) => r.valid).map((r) => r.username);
  const existing =
    usernames.length > 0
      ? await db
          .select({ username: accounts.username })
          .from(accounts)
          .where(inArray(accounts.username, usernames))
      : [];
  const existingSet = new Set(existing.map((e) => e.username.toLowerCase()));

  const marked = rows.map((r) =>
    r.valid && existingSet.has(r.username.toLowerCase())
      ? { ...r, valid: false, error: "Đã tồn tại trong DB" }
      : r
  );

  return NextResponse.json({ rows: marked, duplicatesInInput: duplicates });
}
