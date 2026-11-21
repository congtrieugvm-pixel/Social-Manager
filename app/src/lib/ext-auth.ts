// Browser-extension API key: a per-user bearer token so the extension can save bookmarks
// without the web session cookie (SameSite=lax blocks cross-site cookies). The plaintext key
// is shown once on generation; only its sha256 is stored (app_users.ext_key_hash).

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
import { AuthError } from "@/lib/auth";

const b64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(new Uint8Array(digest)).toString("hex");
}

/** A fresh, human-copyable key. Prefix marks it; the rest is 32 random bytes. */
export function generateExtKey(): string {
  return "smk_" + b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The owner id for a request bearing a valid extension key, or throws 401. */
export async function requireExtKey(req: Request): Promise<number> {
  const header = req.headers.get("authorization") ?? "";
  const key = (/^Bearer\s+(.+)$/i.exec(header)?.[1] ?? req.headers.get("x-ext-key") ?? "").trim();
  if (!key || key.length > 200) throw new AuthError("Thiếu hoặc sai API key của tiện ích.", 401);
  const hash = await sha256Hex(key);
  const [user] = await db
    .select({ id: appUsers.id, isActive: appUsers.isActive })
    .from(appUsers)
    .where(and(eq(appUsers.extKeyHash, hash)));
  if (!user || !user.isActive) throw new AuthError("API key không hợp lệ hoặc tài khoản bị khoá.", 401);
  return user.id;
}
