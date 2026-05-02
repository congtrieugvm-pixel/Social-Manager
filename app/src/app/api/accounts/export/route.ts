import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { accounts } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { readBody } from "@/lib/req-body";

interface ExportBody {
  ids: number[];
  delimiter?: string;
  fields?: ExportField[];
}

type ExportField = "username" | "password" | "email" | "twofa" | "emailPassword";

const DEFAULT_FIELDS: ExportField[] = [
  "username",
  "password",
  "email",
  "twofa",
  "emailPassword",
];

const ALLOWED_FIELDS = new Set<ExportField>(DEFAULT_FIELDS);

function sanitizeFields(raw: unknown): ExportField[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_FIELDS;
  const cleaned = raw.filter(
    (k): k is ExportField => typeof k === "string" && ALLOWED_FIELDS.has(k as ExportField),
  );
  return cleaned.length > 0 ? cleaned : DEFAULT_FIELDS;
}

export async function POST(req: Request) {
  const body = await readBody<ExportBody>(req);
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((n) => Number.isFinite(n))
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Chưa chọn tài khoản" }, { status: 400 });
  }

  const delimiter = typeof body.delimiter === "string" && body.delimiter.length > 0
    ? body.delimiter
    : "|";
  const fields = sanitizeFields(body.fields);

  const rows = await db
    .select({
      id: accounts.id,
      username: accounts.username,
      encPassword: accounts.encPassword,
      encEmail: accounts.encEmail,
      enc2fa: accounts.enc2fa,
      encEmailPassword: accounts.encEmailPassword,
    })
    .from(accounts)
    .where(inArray(accounts.id, ids));

  // Preserve caller order
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = await Promise.all(
    ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map(async (r) => ({
        id: r.id,
        username: r.username,
        password: await decrypt(r.encPassword),
        email: await decrypt(r.encEmail),
        twofa: await decrypt(r.enc2fa),
        emailPassword: await decrypt(r.encEmailPassword),
      })),
  );

  const lines = items.map((it) =>
    fields
      .map((f) => {
        switch (f) {
          case "username":
            return it.username;
          case "password":
            return it.password;
          case "email":
            return it.email;
          case "twofa":
            return it.twofa;
          case "emailPassword":
            return it.emailPassword;
        }
      })
      .join(delimiter),
  );

  return NextResponse.json({
    count: items.length,
    text: lines.join("\n"),
    items,
    fields,
    delimiter,
  });
}
