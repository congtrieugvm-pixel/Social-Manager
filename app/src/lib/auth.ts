import crypto from "node:crypto";
import { promisify } from "node:util";

// Async scrypt — `crypto.scryptSync` blocks the event loop and trips
// Cloudflare Workers' CPU limit on large inputs. Promisified callback form
// runs scrypt off the main thread (Node) or on a fiber (CF nodejs_compat).
const scryptAsync = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSessions, appUsers, type AppUser } from "@/lib/db/schema";

export const SESSION_COOKIE = "sm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// ---------------------------------------------------------------------------
// Password hashing — Node built-in scrypt. Format: `salt$hash` (both base64).
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;

export async function hashPassword(plain: string): Promise<string> {
  if (!plain) throw new Error("Mật khẩu không được trống");
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const hash = await scryptAsync(plain, salt, SCRYPT_KEYLEN);
  return `${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (!plain || !stored) return false;
  const [saltB64, hashB64] = stored.split("$");
  if (!saltB64 || !hashB64) return false;
  let salt: Buffer;
  let hash: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64");
    hash = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || hash.length !== SCRYPT_KEYLEN) return false;
  const candidate = await scryptAsync(plain, salt, SCRYPT_KEYLEN);
  // Constant-time compare to thwart timing attacks.
  return crypto.timingSafeEqual(candidate, hash);
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export interface CurrentUser {
  id: number;
  username: string;
  role: string;
  isActive: boolean;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export async function createSession(
  userId: number,
): Promise<{ token: string; expiresAt: number }> {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = nowSec() + SESSION_TTL_SECONDS;
  await db.insert(appSessions).values({ token, userId, expiresAt });
  return { token, expiresAt };
}

export async function deleteSession(token: string): Promise<void> {
  if (!token) return;
  await db.delete(appSessions).where(eq(appSessions.token, token));
}

export async function deleteAllSessionsForUser(userId: number): Promise<void> {
  await db.delete(appSessions).where(eq(appSessions.userId, userId));
}

/**
 * Reads the session cookie + DB and returns the active user, or null. Stale
 * sessions are deleted lazily. Inactive users return null even if their
 * session row is still valid.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserByToken(token);
}

export async function getUserByToken(
  token: string,
): Promise<CurrentUser | null> {
  if (!token) return null;
  const rows = await db
    .select({
      sessionToken: appSessions.token,
      sessionExpiresAt: appSessions.expiresAt,
      userId: appUsers.id,
      username: appUsers.username,
      role: appUsers.role,
      isActive: appUsers.isActive,
    })
    .from(appSessions)
    .innerJoin(appUsers, eq(appSessions.userId, appUsers.id))
    .where(eq(appSessions.token, token));
  const row = rows[0];
  if (!row) return null;
  if (row.sessionExpiresAt <= nowSec()) {
    await db.delete(appSessions).where(eq(appSessions.token, token));
    return null;
  }
  if (!row.isActive) return null;
  return {
    id: row.userId,
    username: row.username,
    role: row.role,
    isActive: !!row.isActive,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError("Chưa đăng nhập", 401);
  }
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new AuthError("Chỉ admin được phép", 403);
  }
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "AuthError";
  }
}

// ---------------------------------------------------------------------------
// User CRUD helpers
// ---------------------------------------------------------------------------

export interface SafeUser {
  id: number;
  username: string;
  role: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

function toSafeUser(u: AppUser): SafeUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    isActive: !!u.isActive,
    createdAt: Math.floor(u.createdAt.getTime() / 1000),
    updatedAt: Math.floor(u.updatedAt.getTime() / 1000),
  };
}

export async function listUsers(): Promise<SafeUser[]> {
  const rows = await db.select().from(appUsers);
  return rows
    .map(toSafeUser)
    .sort((a, b) => a.username.localeCompare(b.username));
}

export async function findUserByUsername(
  username: string,
): Promise<AppUser | null> {
  const rows = await db
    .select()
    .from(appUsers)
    .where(eq(appUsers.username, username));
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<AppUser | null> {
  const rows = await db.select().from(appUsers).where(eq(appUsers.id, id));
  return rows[0] ?? null;
}

export const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export function validateUsername(u: string): string | null {
  if (!u) return "Username không được trống";
  if (!USERNAME_RE.test(u))
    return "Username 3-32 ký tự, chỉ gồm chữ/số và . _ -";
  return null;
}

export function validatePassword(p: string): string | null {
  if (!p) return "Password không được trống";
  if (p.length < 6) return "Password tối thiểu 6 ký tự";
  if (p.length > 200) return "Password quá dài";
  return null;
}

export async function createUser(input: {
  username: string;
  password: string;
  role?: "admin" | "user";
}): Promise<SafeUser> {
  const username = input.username.trim();
  const password = input.password;
  const role = input.role === "admin" ? "admin" : "user";
  const uErr = validateUsername(username);
  if (uErr) throw new AuthError(uErr, 400);
  const pErr = validatePassword(password);
  if (pErr) throw new AuthError(pErr, 400);
  const existing = await findUserByUsername(username);
  if (existing) throw new AuthError("Username đã tồn tại", 409);
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const [created] = await db
    .insert(appUsers)
    .values({
      username,
      passwordHash,
      role,
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toSafeUser(created);
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_TTL_SECONDS,
};

export { toSafeUser };
