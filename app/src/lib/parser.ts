export type FieldKey =
  | "username"
  | "password"
  | "email"
  | "twofa"
  | "emailPassword"
  | "token"
  | "note"
  | "skip";

export const DEFAULT_ORDER: FieldKey[] = [
  "username",
  "password",
  "email",
  "twofa",
  "emailPassword",
];

export const FIELD_LABELS: Record<Exclude<FieldKey, "skip">, string> = {
  username: "Username",
  password: "Password",
  email: "Email",
  twofa: "2FA",
  emailPassword: "Email password",
  token: "Token",
  note: "Note",
};

export interface ParsedRow {
  lineNumber: number;
  raw: string;
  username: string;
  password: string;
  email: string;
  twofa: string;
  emailPassword: string;
  token: string;
  note: string;
  valid: boolean;
  error?: string;
}

/**
 * Parse bulk import text. Each line is split by delimiter; fields map to
 * positions via `order`. Use "skip" to ignore a column.
 * Empty/comment (#) lines are skipped.
 */
export function parseBulkImport(
  text: string,
  delimiter = "|",
  order: FieldKey[] = DEFAULT_ORDER
): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const lines = text.split(/\r?\n/);
  const requiresUsername = order.includes("username");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(delimiter).map((p) => p.trim());

    const fields: Record<Exclude<FieldKey, "skip">, string> = {
      username: "",
      password: "",
      email: "",
      twofa: "",
      emailPassword: "",
      token: "",
      note: "",
    };

    for (let j = 0; j < order.length; j++) {
      const key = order[j];
      if (key === "skip") continue;
      fields[key] = parts[j] ?? "";
    }

    let valid = true;
    let error: string | undefined;

    // Variable field count per line allowed — missing trailing fields default to "".
    // Only hard requirement: username present when username column is configured.
    if (requiresUsername && !fields.username) {
      valid = false;
      error = "Thiếu username";
    }

    rows.push({
      lineNumber: i + 1,
      raw,
      username: fields.username.replace(/^@/, ""),
      password: fields.password,
      email: fields.email,
      twofa: fields.twofa,
      emailPassword: fields.emailPassword,
      token: fields.token,
      note: fields.note,
      valid,
      error,
    });
  }
  return rows;
}

export function dedupByUsername(rows: ParsedRow[]): { rows: ParsedRow[]; duplicates: string[] } {
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  const out: ParsedRow[] = [];
  for (const r of rows) {
    if (!r.valid) {
      out.push(r);
      continue;
    }
    const key = r.username.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(r.username);
      out.push({ ...r, valid: false, error: "Trùng username trong input" });
    } else {
      seen.set(key, r.lineNumber);
      out.push(r);
    }
  }
  return { rows: out, duplicates };
}
