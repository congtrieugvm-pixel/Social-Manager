import { and, eq, inArray, lt, gt, isNull, desc, asc, like, sql } from "drizzle-orm";
import { db } from "./db";
import { accounts, groups, appUsers, browserProxies as proxies, browserDevices as devices, browserPairings as pairings, browserProfiles as profiles, browserJobs as jobs, browserProxyChecks as checks } from "./db/schema";
import { encrypt, decrypt } from "./crypto";
import { AuthError, findUserByUsername, verifyPassword } from "./auth";
import { browserLoginAttempts, browserPosting } from './db/browser-schema';
import { previewFiles } from './browser-preview';

export const now = () => Math.floor(Date.now() / 1000);
export const uuid = () => crypto.randomUUID();
export function fail(message: string, status = 400): never { throw new AuthError(message, status); }
export function id(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 1) fail("ID không hợp lệ"); return Number(value); }
export function str(value: unknown, max = 120): string { if (typeof value !== "string" || !value.trim() || value.length > max) fail("Giá trị không hợp lệ"); return value.trim(); }
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), n => n.toString(16).padStart(2, "0")).join("");
export const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("");
const pending = ["queued", "claimed"];
const active = [...pending, "running"];
const statuses = ["starting", "open", "needs_verification", "unverified", "logged_in", "wrong_account", "closed", "error", "interrupted"];
const errorCodes = ["PROXY_FAILED", "BROWSER_FAILED", "PROFILE_BUSY", "LOGIN_MANUAL", "NETWORK", "INTERRUPTED", "CONFIG_CHANGED", "CLOSED", 'FOLDER_EMPTY', 'FOLDER_INVALID', 'POST_UNKNOWN', 'POST_MANUAL', 'FILE_CHANGED', 'HIDE_MANUAL', 'HIDE_FAILED'];
const atLeast = (version: string, [a, b, c]: [number, number, number]) => {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [x, y, z] = version.split('.').map(Number);
  return x !== a ? x > a : y !== b ? y > b : z >= c;
};
/** Progress of an "Ẩn bài" job, stored in browser_jobs.result. Counters + a short message only. */
function feedProgress(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(1e6, Math.round(v)) : 0);
  const status = ['completed', 'stopped', 'error'].includes(r.status as string) ? (r.status as string) : undefined;
  return { watched: n(r.watched), liked: n(r.liked), message: typeof r.message === 'string' ? r.message.slice(0, 300) : '', ...(status ? { status } : {}) };
}
function hideProgress(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(1e6, Math.round(v)) : 0);
  return {
    changed: n(r.changed), skipped: n(r.skipped), scanned: n(r.scanned),
    message: typeof r.message === 'string' ? r.message.slice(0, 300) : '',
    status: ['completed', 'stopped', 'error'].includes(r.status as string) ? (r.status as string) : null,
  };
}
const code = (v: unknown) => typeof v === "string" && errorCodes.includes(v) ? v : "BROWSER_FAILED";

export function normalizeServer(value: unknown): string {
  const raw = str(value, 300);
  let u: URL; try { u = new URL(raw); } catch { return fail("Proxy cần dạng http://host:port, https://host:port hoặc socks5://host:port"); }
  if (!["http:", "https:", "socks5:"].includes(u.protocol) || !u.hostname || u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== "/")) fail("Proxy không hợp lệ; nhập username/password ở ô riêng");
  // URL normalizes default HTTP ports away.
  const port = Number(u.port || (u.protocol === "http:" ? 80 : u.protocol === "https:" ? 443 : 0));
  if (port < 1 || port > 65535) fail("Port proxy phải từ 1 đến 65535");
  return `${u.protocol}//${u.hostname}:${port}`;
}

/** Parse a single pasted proxy string into server + credentials, so the user can paste one
 *  value and save. Accepts: host:port@user@pass (the standard we show), host:port,
 *  user:pass@host:port, host:port:user:pass, and scheme://[user:pass@]host:port. Default
 *  scheme is http://. The caller still runs the result through normalizeServer(). */
export function parseProxyInput(value: unknown): { server: string; username: string; password: string } {
  const raw = str(value, 400).trim();
  if (!raw) fail("Nhập proxy, ví dụ 1.2.3.4:8000@user@pass");
  const splitCreds = (s: string): [string, string] => { const i = s.indexOf(":"); return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]; };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  if (hasScheme) {
    let u: URL; try { u = new URL(raw); } catch { return { server: raw, username: "", password: "" }; }
    return { server: `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`, username: decodeURIComponent(u.username || ""), password: decodeURIComponent(u.password || "") };
  }
  const isHostPort = (s: string) => /^[^\s:@]+:\d{1,5}$/.test(s);
  let hostPort = raw, username = "", password = "";
  if (raw.includes("@")) {
    const parts = raw.split("@");
    if (parts.length >= 3) { hostPort = parts[0]; username = parts[1]; password = parts.slice(2).join("@"); }
    else {
      const [a, b] = parts;
      if (isHostPort(a) && !isHostPort(b)) { hostPort = a; [username, password] = splitCreds(b); }
      else { hostPort = b; [username, password] = splitCreds(a); }
    }
  } else {
    const seg = raw.split(":");
    if (seg.length >= 4) { hostPort = `${seg[0]}:${seg[1]}`; username = seg[2]; password = seg.slice(3).join(":"); }
  }
  return { server: `http://${hostPort}`, username, password };
}
export async function proxyFor(owner: number, proxyId: number) {
  const [p] = await db.select().from(proxies).where(and(eq(proxies.id, proxyId), eq(proxies.ownerUserId, owner)));
  if (!p) fail("Không tìm thấy proxy", 404); return p;
}
export async function accountFor(owner: number, accountId: number) {
  const [a] = await db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.ownerUserId, owner)));
  if (!a) fail("Không tìm thấy tài khoản", 404); return a;
}
export async function effective(owner: number, accountId: number) {
  const a = await accountFor(owner, accountId);
  let proxyId = a.browserProxyMode === "custom" ? a.browserProxyId : null;
  let source = a.browserProxyMode === "custom" ? "Riêng" : "Trực tiếp";
  if (a.browserProxyMode === "inherit" && a.groupId !== null) {
    const [g] = await db.select().from(groups).where(and(eq(groups.id, a.groupId), eq(groups.ownerUserId, owner)));
    if (!g) fail("Nhóm không thuộc tài khoản website này", 409);
    proxyId = g.browserProxyId; source = proxyId ? "Nhóm" : "Trực tiếp";
  }
  if (a.browserProxyMode === "custom" && !proxyId) fail("Chưa chọn proxy riêng", 409);
  const proxy = proxyId ? await proxyFor(owner, proxyId) : null;
  return { account: a, proxy, source, label: proxy ? `${source}: ${proxy.name}` : "Không dùng proxy", key: JSON.stringify([a.groupId, a.browserProxyMode, proxyId, proxy?.revision ?? 0, a.username]) };
}
export const MAX_WINDOWS = 10;
export async function expireJobs(owner: number) {
  await db.update(jobs).set({ state: "expired" }).where(and(eq(jobs.ownerUserId, owner), inArray(jobs.state, pending), lt(jobs.expiresAt, now())));
}
export async function dashboard(owner: number, search: string, selected: number[]) {
  await expireJobs(owner);
  const accountRows = await db.select({ id: accounts.id, username: accounts.username, groupId: accounts.groupId, mode: accounts.browserProxyMode, proxyId: accounts.browserProxyId }).from(accounts)
    .where(and(eq(accounts.ownerUserId, owner), selected.length ? inArray(accounts.id, selected) : search ? like(accounts.username, `%${search.slice(0, 80)}%`) : undefined)).orderBy(asc(accounts.username)).limit(100);
  const [ps, ds, gs, fs, js, cs] = await Promise.all([
    db.select({ id: proxies.id, name: proxies.name, server: proxies.server, enabled: proxies.enabled, revision: proxies.revision, hasUsername: sql<boolean>`(${proxies.encUsername} IS NOT NULL)`, hasPassword: sql<boolean>`(${proxies.encPassword} IS NOT NULL)` }).from(proxies).where(eq(proxies.ownerUserId, owner)),
    db.select({ id: devices.id, name: devices.name, version: devices.version, lastSeenAt: devices.lastSeenAt, revoked: devices.revoked, maxWindows: devices.maxWindows }).from(devices).where(eq(devices.ownerUserId, owner)),
    db.select({ id: groups.id, name: groups.name, proxyId: groups.browserProxyId }).from(groups).where(eq(groups.ownerUserId, owner)),
    db.select().from(profiles).where(eq(profiles.ownerUserId, owner)),
    db.select().from(jobs).where(eq(jobs.ownerUserId, owner)).orderBy(desc(jobs.createdAt)).limit(100),
    db.select().from(checks).where(eq(checks.ownerUserId, owner)).orderBy(desc(checks.checkedAt)).limit(100),
  ]);
  const posting = await db.select().from(browserPosting).where(eq(browserPosting.ownerUserId, owner));
  // Every browser profile with its TikTok username, for the window manager (not limited by the account filter).
  const windows = await db.select({ accountId: profiles.accountId, username: accounts.username, groupId: accounts.groupId }).from(profiles)
    .innerJoin(accounts, and(eq(accounts.id, profiles.accountId), eq(accounts.ownerUserId, owner))).where(eq(profiles.ownerUserId, owner));
  return { owner, now: now(), accounts: accountRows, proxies: ps, devices: ds, groups: gs, profiles: fs, jobs: js, checks: cs, posting, windows, maxWindowsLimit: MAX_WINDOWS };
}
/** Light snapshot for the TikTok accounts table: machines, window status per account, recent jobs. */
export async function browserState(owner: number) {
  await expireJobs(owner);
  const [ds, fs, js] = await Promise.all([
    db.select({ id: devices.id, name: devices.name, version: devices.version, lastSeenAt: devices.lastSeenAt, maxWindows: devices.maxWindows }).from(devices).where(and(eq(devices.ownerUserId, owner), eq(devices.revoked, 0))),
    // Usernames ride along for the floating thread panel (joined, not an IN list: D1 caps bound parameters).
    db.select({ accountId: profiles.accountId, deviceId: profiles.deviceId, status: profiles.status, updatedAt: profiles.updatedAt, username: accounts.username }).from(profiles)
      .leftJoin(accounts, and(eq(accounts.id, profiles.accountId), eq(accounts.ownerUserId, owner))).where(eq(profiles.ownerUserId, owner)),
    db.select({ id: jobs.id, kind: jobs.kind, accountId: jobs.accountId, state: jobs.state, error: jobs.error, result: jobs.result, createdAt: jobs.createdAt, deviceId: jobs.deviceId, username: accounts.username })
      .from(jobs).leftJoin(accounts, and(eq(accounts.id, jobs.accountId), eq(accounts.ownerUserId, owner)))
      .where(and(eq(jobs.ownerUserId, owner), gt(jobs.createdAt, now() - 86400), inArray(jobs.kind, ['open', 'close', 'hide', 'feed'])))
      .orderBy(desc(jobs.createdAt)).limit(300),
  ]);
  const ps = await db.select({ id: proxies.id, name: proxies.name, enabled: proxies.enabled }).from(proxies).where(eq(proxies.ownerUserId, owner)).orderBy(asc(proxies.name));
  return { now: now(), owner, devices: ds, profiles: fs, jobs: js, proxies: ps };
}

/** Set the browser proxy for one account from the TikTok accounts tab: pick an existing proxy,
 *  go direct/inherit, or paste a new proxy (host:port[:user:pass]) that is created then assigned. */
export async function setAccountProxy(owner: number, b: Record<string, unknown>) {
  const accountId = id(b.accountId);
  await accountFor(owner, accountId);
  const mode = str(b.mode);
  if (!["inherit", "custom", "direct"].includes(mode)) fail("Chế độ proxy không hợp lệ");
  let proxyId: number | null = null;
  if (mode === "custom") {
    if (b.newProxy && typeof b.newProxy === "object") {
      const np = b.newProxy as Record<string, unknown>;
      const server = normalizeServer(np.server);
      const username = typeof np.username === "string" ? np.username : "";
      const password = typeof np.password === "string" ? np.password : "";
      if ((username.length > 1024 || password.length > 1024)) fail("Thông tin xác thực proxy không hợp lệ");
      if (server.startsWith("socks5:") && (username || password)) fail("SOCKS5 có xác thực chưa được hỗ trợ; dùng HTTP/HTTPS hoặc SOCKS5 không xác thực.");
      const name = (typeof np.name === "string" && np.name.trim() ? np.name.trim() : server.replace(/^\w+:\/\//, "")).slice(0, 80);
      const [created] = await db.insert(proxies).values({
        ownerUserId: owner, name, server, enabled: 1, revision: 1,
        encUsername: username ? await encrypt(username) : null, encPassword: password ? await encrypt(password) : null,
      }).returning({ id: proxies.id });
      proxyId = created.id;
    } else {
      proxyId = id(b.proxyId);
      await proxyFor(owner, proxyId);
    }
  }
  await db.update(accounts).set({ browserProxyMode: mode, browserProxyId: mode === "custom" ? proxyId : null })
    .where(and(eq(accounts.ownerUserId, owner), eq(accounts.id, accountId)));
  return { ok: true, proxyId };
}
export async function savePosting(owner: number, b: Record<string, unknown>) {
  const targets = ids(b.ids);
  const deviceId = str(b.deviceId, 40);
  const [device] = await db.select().from(devices).where(and(eq(devices.id, deviceId), eq(devices.ownerUserId, owner), eq(devices.revoked, 0)));
  if (!device) fail('Chọn máy Windows của bạn', 400);
  const folder = str(b.folder, 500);
  if (!/^[A-Za-z]:\\/.test(folder) || folder.includes('..')) fail('Nhập đường dẫn thư mục Windows, ví dụ D:\\Videos');
  const caption = typeof b.caption === 'string' ? b.caption : '';
  if (caption.length > 2200) fail('Nội dung tối đa 2200 ký tự');
  for (const aid of targets) await accountFor(owner, aid);
  for (const aid of targets) {
    const value = { accountId: aid, ownerUserId: owner, deviceId, folder, caption };
    await db.insert(browserPosting).values(value).onConflictDoUpdate({ target: browserPosting.accountId, set: value });
  }
  return { ok: true };
}
export async function saveProxy(owner: number, b: Record<string, unknown>) {
  const previous = b.id ? await proxyFor(owner, id(b.id)) : null;
  for (const field of ['username', 'password']) if (b[field] !== undefined && (typeof b[field] !== 'string' || (b[field] as string).length > 1024)) fail('Thông tin xác thực proxy không hợp lệ');
  // The "Proxy" field may carry credentials inline (host:port@user@pass, user:pass@host:port, …).
  // Prefer those; fall back to the separate username/password fields if still sent by older clients.
  const parsed = parseProxyInput(b.server);
  const username = parsed.username || (typeof b.username === "string" ? b.username : "");
  const password = parsed.password || (typeof b.password === "string" ? b.password : "");
  if (username.length > 1024 || password.length > 1024) fail('Thông tin xác thực proxy không hợp lệ');
  const values = { ownerUserId: owner, name: str(b.name), server: normalizeServer(parsed.server), enabled: b.enabled === false ? 0 : 1,
    encUsername: b.clearUsername ? null : username ? await encrypt(username) : previous?.encUsername ?? null,
    encPassword: b.clearPassword ? null : password ? await encrypt(password) : previous?.encPassword ?? null,
    revision: (previous?.revision ?? 0) + 1 };
  if (values.server.startsWith('socks5:') && (values.encUsername || values.encPassword)) fail('SOCKS5 có xác thực chưa được hỗ trợ; dùng HTTP/HTTPS hoặc SOCKS5 không xác thực.');
  if (previous) await db.update(proxies).set(values).where(and(eq(proxies.id, previous.id), eq(proxies.ownerUserId, owner)));
  else await db.insert(proxies).values(values);
  return { ok: true };
}
export async function deleteProxy(owner: number, proxyId: number) {
  await proxyFor(owner, proxyId);
  const [a] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.browserProxyId, proxyId)).limit(1);
  const [g] = await db.select({ id: groups.id }).from(groups).where(eq(groups.browserProxyId, proxyId)).limit(1);
  if (a || g) fail("Proxy đang được tài khoản hoặc nhóm sử dụng. Hãy bỏ gán trước.", 409);
  await db.delete(proxies).where(and(eq(proxies.id, proxyId), eq(proxies.ownerUserId, owner)));
  return { ok: true };
}
export function ids(value: unknown): number[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) fail("Chọn từ 1 đến 20 tài khoản");
  return [...new Set(value.map(id))];
}
export async function assign(owner: number, b: Record<string, unknown>) {
  const proxyId = b.proxyId == null ? null : id(b.proxyId);
  if (proxyId) await proxyFor(owner, proxyId);
  if (b.groupId != null) {
    const groupId = id(b.groupId);
    const [g] = await db.select().from(groups).where(and(eq(groups.id, groupId), eq(groups.ownerUserId, owner)));
    if (!g) fail("Không tìm thấy nhóm", 404);
    await db.update(groups).set({ browserProxyId: proxyId }).where(and(eq(groups.id, groupId), eq(groups.ownerUserId, owner)));
  } else {
    const list = ids(b.ids); const mode = str(b.mode);
    if (!["inherit", "custom", "direct"].includes(mode) || (mode === "custom" && !proxyId)) fail("Chọn chế độ và proxy hợp lệ");
    for (const aid of list) await accountFor(owner, aid);
    await db.update(accounts).set({ browserProxyMode: mode, browserProxyId: mode === "custom" ? proxyId : null }).where(and(eq(accounts.ownerUserId, owner), inArray(accounts.id, list)));
  }
  return { ok: true };
}
export async function createPairing(owner: number) {
  await db.delete(pairings).where(lt(pairings.expiresAt, now()));
  const secret = token();
  await db.insert(pairings).values({ hash: await hash(secret), ownerUserId: owner, expiresAt: now() + 300 });
  return { code: secret, expiresAt: now() + 300 };
}
export async function enroll(b: Record<string, unknown>) {
  const secret = str(b.code, 64); if (!/^[a-f0-9]{64}$/.test(secret)) fail("Mã ghép nối không hợp lệ", 401);
  const name = str(b.name, 80); const version = str(b.version, 30);
  const [pair] = await db.update(pairings).set({ usedAt: now() }).where(and(eq(pairings.hash, await hash(secret)), isNull(pairings.usedAt), gt(pairings.expiresAt, now()))).returning();
  if (!pair) fail("Mã hết hạn hoặc đã sử dụng", 401);
  const [user] = await db.select().from(appUsers).where(eq(appUsers.id, pair.ownerUserId));
  if (!user?.isActive) fail("Tài khoản website không hoạt động", 401);
  const deviceId = uuid(); const secretToken = token();
  await db.insert(devices).values({ id: deviceId, ownerUserId: user.id, tokenHash: await hash(secretToken), name, version, lastSeenAt: now() });
  return { deviceId, token: secretToken, ownerId: user.id };
}
export async function loginDevice(b: Record<string, unknown>, address: string) {
  const username = str(b.username, 32);
  if (typeof b.password !== 'string' || !b.password || b.password.length > 200) fail('Sai tài khoản hoặc mật khẩu', 401);
  const name = str(b.name, 80), version = str(b.version, 30);
  const key = await hash('browser-login:' + address);
  await db.delete(browserLoginAttempts).where(lt(browserLoginAttempts.expiresAt, now()));
  const [attempt] = await db.insert(browserLoginAttempts).values({ key, attempts: 1, expiresAt: now() + 300 })
    .onConflictDoUpdate({ target: browserLoginAttempts.key, set: { attempts: sql`${browserLoginAttempts.attempts} + 1` } }).returning();
  if (attempt.attempts > 20) fail('Thử đăng nhập quá nhiều lần. Vui lòng đợi 5 phút.', 429);
  const user = await findUserByUsername(username);
  // Run the same password work for unknown users; never disclose account existence.
  const dummy = 'AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';
  const correct = await verifyPassword(b.password, user?.passwordHash ?? dummy);
  if (!correct || !user?.isActive) fail('Sai tài khoản hoặc mật khẩu', 401);
  if (typeof b.deviceToken === 'string' && /^[a-f0-9]{64}$/.test(b.deviceToken)) {
    const [existing] = await db.select().from(devices).where(and(eq(devices.tokenHash, await hash(b.deviceToken)), eq(devices.ownerUserId, user.id), eq(devices.revoked, 0)));
    if (existing) {
      await db.update(devices).set({ name, version, lastSeenAt: now() }).where(eq(devices.id, existing.id));
      return { deviceId: existing.id, token: b.deviceToken, ownerId: user.id };
    }
  }
  const deviceId = uuid(), secretToken = token();
  await db.insert(devices).values({ id: deviceId, ownerUserId: user.id, tokenHash: await hash(secretToken), name, version, lastSeenAt: now() });
  return { deviceId, token: secretToken, ownerId: user.id };
}
export async function authenticateDevice(req: Request) {
  const bearer = req.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!bearer) fail("Thiếu token thiết bị", 401);
  const [device] = await db.select().from(devices).where(and(eq(devices.tokenHash, await hash(bearer)), eq(devices.revoked, 0)));
  if (!device) fail("Thiết bị đã bị thu hồi", 401);
  const [user] = await db.select().from(appUsers).where(eq(appUsers.id, device.ownerUserId));
  if (!user?.isActive) fail("Tài khoản không hoạt động", 401);
  return device;
}
type Device = typeof devices.$inferSelect;
export async function revokeDevice(owner: number, deviceId: string) {
  await db.update(devices).set({ revoked: 1 }).where(and(eq(devices.id, deviceId), eq(devices.ownerUserId, owner)));
  await db.update(jobs).set({ state: "cancelled" }).where(and(eq(jobs.deviceId, deviceId), eq(jobs.ownerUserId, owner), inArray(jobs.state, active)));
  return { ok: true };
}
export async function queue(owner: number, b: Record<string, unknown>) {
  await expireJobs(owner);
  const deviceId = str(b.deviceId, 40); const kind = str(b.kind);
  const [device] = await db.select().from(devices).where(and(eq(devices.id, deviceId), eq(devices.ownerUserId, owner), eq(devices.revoked, 0)));
  if (!device || device.lastSeenAt < now() - 60) fail("Máy Windows chưa kết nối hoặc đang offline", 409);
  if (!["open", "close", "check_proxy", 'post', 'preview', 'hide', 'feed'].includes(kind)) fail("Lệnh không hợp lệ");
  if (kind === 'hide' && !atLeast(device.version, [1, 0, 4])) fail('Cập nhật chương trình Windows lên 1.0.4 để dùng Ẩn bài', 409);
  if (kind === 'feed' && !atLeast(device.version, [1, 0, 12])) fail('Cập nhật chương trình Windows lên 1.0.12 để dùng Lướt feed', 409);
  const version = device.version.split('.').map(Number);
  if (['post', 'preview'].includes(kind) && (!/^\d+\.\d+\.\d+$/.test(device.version) || version[0] < 1 || (version[0] === 1 && version[1] === 0 && version[2] < 4))) fail('Cập nhật chương trình Windows lên 1.0.4 để xem trước và đăng bài', 409);
  const targets = kind === "check_proxy" ? [id(b.proxyId)] : ids(b.ids);
  const outstanding = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.deviceId, deviceId), inArray(jobs.state, pending)));
  if (outstanding.length + targets.length > 40) fail("Hàng đợi đầy. Hãy đợi hoặc hủy lệnh cũ.", 409);
  const result: Array<{ id: number; ok: boolean; error?: string }> = [];
  for (const target of targets) {
    try {
      const config = kind !== "check_proxy" ? await effective(owner, target) : null;
      const p = kind === "check_proxy" ? await proxyFor(owner, target) : config?.proxy;
      if (kind !== "close" && p && !p.enabled) fail("Proxy đã bị vô hiệu hóa", 409);
      const [profile] = config ? await db.select().from(profiles).where(eq(profiles.accountId, target)) : [];
      if (kind !== 'preview' && profile && profile.ownerUserId === owner && profile.deviceId !== deviceId && profile.status !== "revoked") fail("Hồ sơ nằm trên máy khác. Dùng Tạo hồ sơ trên máy khác trước.", 409);
      if (kind === "close" && (!profile || profile.ownerUserId !== owner)) fail("Chưa có hồ sơ", 409);
      if (kind === 'open') {
        const [existing] = await db.select().from(jobs).where(and(eq(jobs.accountId, target), eq(jobs.ownerUserId, owner), eq(jobs.kind, 'open'), inArray(jobs.state, active)));
        if (existing) { result.push({ id: target, ok: true }); continue; }
      }
      if (kind === 'hide') {
        const [existing] = await db.select().from(jobs).where(and(eq(jobs.accountId, target), eq(jobs.ownerUserId, owner), eq(jobs.kind, 'hide'), inArray(jobs.state, active)));
        if (existing) fail('Tài khoản đang ẩn bài', 409);
      }
      const jobId = uuid();
      let payload: string | null = null;
      if (kind === 'feed') {
        const [existing] = await db.select().from(jobs).where(and(eq(jobs.accountId, target), eq(jobs.ownerUserId, owner), eq(jobs.kind, 'feed'), inArray(jobs.state, active)));
        if (existing) fail('Tài khoản đang lướt feed', 409);
        const durationMs = Math.min(60 * 60 * 1000, Math.max(30 * 1000, Number(b.durationMs) || 5 * 60 * 1000));
        const likeRate = Math.min(0.6, Math.max(0, Number(b.likeRate) ?? 0.15));
        payload = JSON.stringify({ durationMs, likeRate });
      }
      if (kind === 'post' || kind === 'preview') {
        if (kind === 'post' && (!profile || profile.deviceId !== deviceId || profile.status !== 'logged_in')) fail('Mở trình duyệt và xác minh đúng tài khoản trước khi đăng', 409);
        const [settings] = await db.select().from(browserPosting).where(and(eq(browserPosting.accountId, target), eq(browserPosting.ownerUserId, owner), eq(browserPosting.deviceId, deviceId)));
        if (!settings) fail('Chưa gán thư mục trên máy này', 409);
        const [existing] = await db.select().from(jobs).where(and(eq(jobs.accountId, target), eq(jobs.kind, kind), inArray(jobs.state, active)));
        if (existing) fail('Tài khoản đang có lệnh đăng bài', 409);
        payload = JSON.stringify({ folder: settings.folder, caption: settings.caption });
        if (kind === 'post') {
          // Post the next unused video in the folder. Post now, or schedule (a specific time, or a
          // random minute inside a daily window), and optionally delete the file after it succeeds.
          const deleteAfter = b.deleteAfter === true;
          const mode = typeof b.scheduleMode === 'string' ? b.scheduleMode : 'now';
          let scheduleAt: number | null = null;
          if (mode === 'at') {
            const at = Math.floor(Number(b.scheduleAt));
            if (!Number.isFinite(at) || at < now() + 300) fail('Giờ lên lịch phải sau hiện tại ít nhất 5 phút', 400);
            scheduleAt = at + result.length * 60; // stagger accounts 1 phút
          } else if (mode === 'window') {
            const dayEpoch = Math.floor(Number(b.dayEpoch)), s = Math.floor(Number(b.startMin)), e2 = Math.floor(Number(b.endMin));
            if (!Number.isFinite(dayEpoch) || !(s >= 0 && e2 <= 1440 && s < e2)) fail('Khung giờ không hợp lệ', 400);
            let when = dayEpoch + (s + Math.floor(Math.random() * (e2 - s))) * 60;
            if (when < now() + 300) when = now() + 600;
            scheduleAt = when;
          }
          if (scheduleAt && scheduleAt > now() + 10 * 86400) fail('TikTok chỉ cho lên lịch trước tối đa ~10 ngày', 400);
          if ((scheduleAt || deleteAfter) && !atLeast(device.version, [1, 0, 13])) fail('Cập nhật chương trình Windows lên 1.0.13 để lên lịch / xóa file', 409);
          payload = JSON.stringify({ folder: settings.folder, caption: settings.caption, scheduleAt, deleteAfter });
        }
      }
      await db.insert(jobs).values({ id: jobId, ownerUserId: owner, deviceId, kind, accountId: config ? target : null, proxyId: p?.id ?? null,
        payload, configKey: config?.key ?? String(p?.revision), autofill: b.autofill === false ? 0 : 1, createdAt: now(), expiresAt: now() + (['open', 'hide', 'feed'].includes(kind) ? 3600 : 600) }); // open/hide/feed may wait for a free window
      result.push({ id: target, ok: true });
    } catch (e) { result.push({ id: target, ok: false, error: e instanceof AuthError ? e.message : "Đã có lệnh/phiên đang chạy cho tài khoản này" }); }
  }
  return { results: result };
}
export async function cancel(owner: number, jobId: string) {
  await db.update(jobs).set({ state: "cancelled" }).where(and(eq(jobs.id, jobId), eq(jobs.ownerUserId, owner), inArray(jobs.state, pending)));
  return { ok: true };
}
export async function relocate(owner: number, b: Record<string, unknown>) {
  const aid = id(b.accountId); await accountFor(owner, aid);
  const [p] = await db.select().from(profiles).where(and(eq(profiles.accountId, aid), eq(profiles.ownerUserId, owner)));
  if (!p) return { ok: true };
  const [old] = await db.select().from(devices).where(eq(devices.id, p.deviceId));
  if (!["closed", "error", "interrupted", "revoked"].includes(p.status) && old && old.lastSeenAt > now() - 90) fail("Đóng trình duyệt trên máy cũ trước", 409);
  if (b.confirmStopped !== true) fail("Cần xác nhận đã dừng trình duyệt trên máy cũ");
  await db.update(jobs).set({ state: "cancelled" }).where(and(eq(jobs.accountId, aid), eq(jobs.ownerUserId, owner), inArray(jobs.state, active)));
  await db.update(profiles).set({ status: "revoked", jobId: null }).where(and(eq(profiles.accountId, aid), eq(profiles.ownerUserId, owner)));
  return { ok: true };
}
async function allowedProfiles(device: Device) {
  return db.select({ id: profiles.id, accountId: profiles.accountId, jobId: profiles.jobId }).from(profiles)
    .innerJoin(accounts, and(eq(accounts.id, profiles.accountId), eq(accounts.ownerUserId, device.ownerUserId)))
    .innerJoin(jobs, and(eq(jobs.id, profiles.jobId), eq(jobs.state, "running")))
    .where(and(eq(profiles.deviceId, device.id), eq(profiles.ownerUserId, device.ownerUserId)));
}
export async function sync(device: Device, b: Record<string, unknown>) {
  const runId = str(b.runId, 40);
  if (device.runId && device.runId !== runId) {
    await db.update(jobs).set({ state: "error", error: "INTERRUPTED" }).where(and(eq(jobs.deviceId, device.id), inArray(jobs.state, ["claimed", "running"])));
    await db.update(profiles).set({ status: "interrupted", updatedAt: now() }).where(and(eq(profiles.deviceId, device.id), eq(profiles.ownerUserId, device.ownerUserId), inArray(profiles.status, ['starting', 'open', 'needs_verification', 'unverified', 'logged_in', 'wrong_account'])));
  }
  const version = typeof b.version === 'string' && /^\d+\.\d+\.\d+$/.test(b.version) ? b.version.slice(0, 30) : device.version;
  await db.update(devices).set({ lastSeenAt: now(), runId, version }).where(eq(devices.id, device.id));
  await expireJobs(device.ownerUserId);
  const reports = Array.isArray(b.reports) ? b.reports.slice(0, 25) : [];
  for (const raw of reports) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const [job] = await db.select().from(jobs).where(and(eq(jobs.id, String(r.jobId)), eq(jobs.deviceId, device.id), eq(jobs.ownerUserId, device.ownerUserId), eq(jobs.state, "running")));
    if (!job) continue;
    // Secrets captured during login (mailbox OAuth token, enabled-2FA key) → store on the account, encrypted.
    if (job.accountId && (isRecord(r.mail) || typeof r.twofaSecret === 'string')) {
      const patch: Record<string, unknown> = {};
      if (isRecord(r.mail) && typeof r.mail.refreshToken === 'string' && r.mail.refreshToken) {
        patch.encMailToken = await encrypt(String(r.mail.refreshToken).slice(0, 4096));
        if (typeof r.mail.clientId === 'string' && r.mail.clientId) patch.mailClientId = String(r.mail.clientId).slice(0, 100);
      }
      if (typeof r.twofaSecret === 'string' && /^[A-Za-z2-7 =-]{16,128}$/.test(r.twofaSecret.trim())) patch.enc2fa = await encrypt(r.twofaSecret.trim());
      if (Object.keys(patch).length) await db.update(accounts).set(patch).where(and(eq(accounts.id, job.accountId), eq(accounts.ownerUserId, device.ownerUserId)));
      continue;
    }
    if (job.kind === 'preview') {
      if (r.done === true) {
        const files = previewFiles(r.files);
        await db.update(jobs).set({ state: files.length ? 'done' : 'error', result: JSON.stringify(files), error: files.length ? null : code(r.error ?? 'FOLDER_EMPTY') }).where(eq(jobs.id, job.id));
      }
    } else if (job.kind === "check_proxy") {
      if (r.done === true) {
        const ip = typeof r.ip === "string" && /^[0-9a-fA-F.:]{3,45}$/.test(r.ip) ? r.ip : null;
        await db.insert(checks).values({ jobId: job.id, ownerUserId: device.ownerUserId, deviceId: device.id, proxyId: job.proxyId!, revision: Number(job.configKey), ip, latency: Number.isFinite(r.latency) ? Math.max(0, Math.min(60000, Number(r.latency))) : null, error: ip ? null : code(r.error), checkedAt: now() }).onConflictDoNothing();
        await db.update(jobs).set({ state: ip ? "done" : "error", error: ip ? null : code(r.error) }).where(eq(jobs.id, job.id));
      }
    } else if (job.kind === 'feed') {
      const status = typeof r.status === "string" && statuses.includes(r.status) ? r.status : null;
      if (status) await db.update(profiles).set({ status, updatedAt: now() }).where(and(eq(profiles.accountId, job.accountId!), eq(profiles.jobId, job.id), eq(profiles.ownerUserId, device.ownerUserId), eq(profiles.id, String(r.profileId))));
      const progress = feedProgress(r.feed);
      if (progress) await db.update(jobs).set({ result: JSON.stringify(progress) }).where(eq(jobs.id, job.id));
      if (r.done === true) {
        await db.update(jobs).set({ state: r.error ? "error" : "done", error: r.error ? code(r.error) : null }).where(eq(jobs.id, job.id));
        await db.update(profiles).set({ status: "closed", updatedAt: now() }).where(and(eq(profiles.accountId, job.accountId!), eq(profiles.jobId, job.id), eq(profiles.ownerUserId, device.ownerUserId)));
      }
      else if (status && ["closed", "error", "interrupted"].includes(status)) await db.update(jobs).set({ state: "error", error: status === "closed" ? "CLOSED" : code(r.error) }).where(eq(jobs.id, job.id));
    } else if (job.kind === 'hide') {
      // Window status (only when this job opened the profile) …
      const status = typeof r.status === "string" && statuses.includes(r.status) ? r.status : null;
      if (status) await db.update(profiles).set({ status, updatedAt: now() }).where(and(eq(profiles.accountId, job.accountId!), eq(profiles.jobId, job.id), eq(profiles.ownerUserId, device.ownerUserId), eq(profiles.id, String(r.profileId))));
      // … Studio progress …
      const progress = hideProgress(r.hide);
      if (progress) await db.update(jobs).set({ result: JSON.stringify(progress) }).where(eq(jobs.id, job.id));
      // … and the outcome. A window closed before the run finished is an interruption.
      if (r.done === true) {
        await db.update(jobs).set({ state: r.error ? "error" : "done", error: r.error ? code(r.error) : null }).where(eq(jobs.id, job.id));
        // A window this job opened is closed by the agent once the job ends (it is no longer allowed).
        await db.update(profiles).set({ status: "closed", updatedAt: now() }).where(and(eq(profiles.accountId, job.accountId!), eq(profiles.jobId, job.id), eq(profiles.ownerUserId, device.ownerUserId)));
      }
      else if (status && ["closed", "error", "interrupted"].includes(status)) await db.update(jobs).set({ state: "error", error: status === "closed" ? "CLOSED" : code(r.error) }).where(eq(jobs.id, job.id));
    } else if (job.kind === "close" || job.kind === 'post') {
      if (r.done === true) await db.update(jobs).set({ state: r.error ? "error" : "done", error: r.error ? code(r.error) : null }).where(eq(jobs.id, job.id));
    } else {
      const status = typeof r.status === "string" && statuses.includes(r.status) ? r.status : null;
      if (!status) continue;
      // A revoked/relocated generation cannot update the new profile.
      await db.update(profiles).set({ status, updatedAt: now() }).where(and(eq(profiles.accountId, job.accountId!), eq(profiles.jobId, job.id), eq(profiles.ownerUserId, device.ownerUserId), eq(profiles.id, String(r.profileId))));
      if (["closed", "error", "interrupted"].includes(status)) await db.update(jobs).set({ state: status === "closed" ? "done" : "error", error: status === "closed" ? null : code(r.error) }).where(eq(jobs.id, job.id));
    }
  }
  const allow = await allowedProfiles(device);
  const known = Array.isArray(b.knownJobs) ? b.knownJobs.filter(v => typeof v === 'string').slice(0, 50) : [];
  const candidates = await db.select().from(jobs).where(and(eq(jobs.deviceId, device.id), inArray(jobs.state, active))).orderBy(asc(jobs.createdAt)).limit(50);
  const maxWindows = device.maxWindows;
  // `capacity`: windows the agent can still open. `slots`: jobs it can still run at once
  // (agents before 1.0.6 run one job at a time and don't send it).
  let capacity = Number.isInteger(b.capacity) ? Math.max(0, Math.min(maxWindows, Number(b.capacity))) : 0;
  let slots = Number.isInteger(b.slots) ? Math.max(0, Math.min(maxWindows + 2, Number(b.slots))) : 1;
  const openProfiles = new Set(allow.map(p => p.accountId));
  const picked: typeof candidates = [];
  for (const j of candidates.filter(j => j.kind === 'close').concat(candidates.filter(j => j.kind !== 'close'))) {
    if (known.includes(j.id)) continue;
    if (j.kind === 'close') { picked.push(j); continue; } // closing never waits for a free slot
    if (slots <= 0) continue;
    // Opening a window (open, or "Ẩn bài" without an open window) needs a free window.
    const opens = j.kind === 'open' || ((j.kind === 'hide' || j.kind === 'feed') && !openProfiles.has(j.accountId!));
    if (opens && capacity <= 0) continue;
    if (picked.some(p => p.accountId !== null && p.accountId === j.accountId)) continue; // one job per account per round
    picked.push(j); slots--; if (opens) capacity--;
  }
  const handed: Array<{ id: string; kind: string }> = [];
  for (const next of picked) {
    const updated = await db.update(jobs).set({ state: next.state === 'running' ? 'running' : 'claimed' }).where(and(eq(jobs.id, next.id), eq(jobs.state, next.state))).returning({ id: jobs.id, kind: jobs.kind });
    if (updated[0]) handed.push(updated[0]);
  }
  return { allowed: allow.map(p => p.id), job: handed[0] ?? null, jobs: handed, maxWindows, leaseSeconds: 90, pollSeconds: allow.length || handed.length ? 3 : 15 };
}
export async function deviceSettings(owner: number, b: Record<string, unknown>) {
  const deviceId = str(b.id, 40);
  const max = Number(b.maxWindows);
  if (!Number.isInteger(max) || max < 1 || max > MAX_WINDOWS) fail(`Số luồng từ 1 đến ${MAX_WINDOWS}`);
  const updated = await db.update(devices).set({ maxWindows: max }).where(and(eq(devices.id, deviceId), eq(devices.ownerUserId, owner), eq(devices.revoked, 0))).returning({ id: devices.id });
  if (!updated.length) fail('Không tìm thấy máy', 404);
  return { ok: true };
}
async function proxySecret(p: typeof proxies.$inferSelect | null | undefined) {
  if (!p) return null;
  return { server: p.server, username: await decrypt(p.encUsername) ?? undefined, password: await decrypt(p.encPassword) ?? undefined };
}
export async function claim(device: Device, jobId: string) {
  const [j] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.deviceId, device.id), eq(jobs.ownerUserId, device.ownerUserId), inArray(jobs.state, ["claimed", "running"])));
  if (!j) fail("Lệnh hết hạn hoặc đã hủy", 409);
  try {
    if (j.expiresAt < now()) fail('Lệnh hết hạn', 409);
    let payload: Record<string, unknown>;
    if (j.kind === 'preview') {
      const config = await effective(device.ownerUserId, j.accountId!);
      const [settings] = await db.select().from(browserPosting).where(and(eq(browserPosting.accountId, j.accountId!), eq(browserPosting.ownerUserId, device.ownerUserId), eq(browserPosting.deviceId, device.id)));
      if (!settings || j.configKey !== config.key || j.payload !== JSON.stringify({ folder: settings.folder, caption: settings.caption })) fail('Cấu hình đã đổi. Hãy xem trước lại', 409);
      payload = { accountId: j.accountId, username: config.account.username, ...JSON.parse(j.payload!) };
    } else if (j.kind === "check_proxy") {
      const p = await proxyFor(device.ownerUserId, j.proxyId!);
      if (!p.enabled || String(p.revision) !== j.configKey) fail("Cấu hình proxy đã đổi", 409);
      payload = { proxy: await proxySecret(p) };
    } else {
      const e = await effective(device.ownerUserId, j.accountId!);
      let [p] = await db.select().from(profiles).where(eq(profiles.accountId, j.accountId!));
      // "Ẩn bài" reuses a window already open on this device (its open job still running);
      // otherwise it opens the profile itself, exactly like an `open` job.
      let reuse = false;
      if ((j.kind === 'hide' || j.kind === 'feed') && p && p.ownerUserId === device.ownerUserId && p.deviceId === device.id && p.status !== 'revoked' && p.jobId) {
        const [current] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.id, p.jobId), eq(jobs.state, 'running'), eq(jobs.deviceId, device.id)));
        reuse = !!current;
      }
      const opens = j.kind === "open" || ((j.kind === 'hide' || j.kind === 'feed') && !reuse);
      if (opens && (e.key !== j.configKey || e.proxy?.enabled === 0)) fail("Cấu hình đã đổi; hãy mở lại", 409);
      if (opens) {
        if (p && p.ownerUserId === device.ownerUserId && p.status !== "revoked" && p.deviceId !== device.id) fail("Hồ sơ nằm trên máy khác", 409);
        if (!p || p.ownerUserId !== device.ownerUserId || p.status === "revoked") {
          const fresh = { accountId: j.accountId!, ownerUserId: device.ownerUserId, deviceId: device.id, id: uuid(), status: "closed", updatedAt: now() };
          await db.insert(profiles).values(fresh).onConflictDoUpdate({ target: profiles.accountId, set: fresh });
          [p] = await db.select().from(profiles).where(eq(profiles.accountId, j.accountId!));
        }
        await db.update(profiles).set({ jobId: j.id, status: "starting", proxyLabel: e.label, configKey: e.key, updatedAt: now() }).where(and(eq(profiles.accountId, j.accountId!), eq(profiles.ownerUserId, device.ownerUserId)));
      }
      if (!p || p.ownerUserId !== device.ownerUserId || p.deviceId !== device.id) fail("Không tìm thấy hồ sơ trên máy này", 409);
      if (j.kind === 'post' && p.status !== 'logged_in') fail('Phiên chưa xác minh đúng tài khoản', 409);
      // Mail credentials go out only when opening a window with autofill — for reading the
      // emailed TikTok code when the account has no 2FA.
      const mail = opens && j.autofill ? {
        email: await decrypt(e.account.encEmail), mailPassword: await decrypt(e.account.encEmailPassword),
        recoveryEmail: await decrypt(e.account.encRecoveryEmail), mailRefreshToken: await decrypt(e.account.encMailToken), mailClientId: e.account.mailClientId,
      } : {};
      payload = { accountId: j.accountId, profileId: p.id, username: e.account.username, password: opens && j.autofill ? await decrypt(e.account.encPassword) : null, twofa: opens && j.autofill ? await decrypt(e.account.enc2fa) : null, ...mail, autofill: !!j.autofill, proxy: opens ? await proxySecret(e.proxy) : null, ...(j.kind === 'post' ? JSON.parse(j.payload!) : {}), ...(j.kind === 'feed' && j.payload ? JSON.parse(j.payload) : {}), ...((j.kind === 'hide' || j.kind === 'feed') ? { reuse } : {}) };
    }
    const changed = await db.update(jobs).set({ state: "running" }).where(and(eq(jobs.id, j.id), inArray(jobs.state, ["claimed", "running"]))).returning({ id: jobs.id });
    if (!changed.length) fail("Lệnh đã bị hủy", 409);
    // Check ownership again after the writes, before returning decrypted material.
    if (j.accountId) await accountFor(device.ownerUserId, j.accountId);
    const [stillAllowed] = await db.select({ id: devices.id }).from(devices).innerJoin(appUsers, eq(appUsers.id, devices.ownerUserId)).where(and(eq(devices.id, device.id), eq(devices.revoked, 0), eq(appUsers.isActive, 1)));
    if (!stillAllowed) fail('Thiết bị đã bị thu hồi', 401);
    return { id: j.id, kind: j.kind, ownerId: device.ownerUserId, expiresAt: j.expiresAt, ...payload };
  } catch (e) {
    await db.update(jobs).set({ state: "error", error: "CONFIG_CHANGED" }).where(eq(jobs.id, j.id));
    throw e;
  }
}
