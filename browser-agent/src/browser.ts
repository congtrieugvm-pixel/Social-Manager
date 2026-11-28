import { Camoufox, getRandomPreset } from 'camoufox';
import type { BrowserContext } from 'playwright-core';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { root, siteKey, saveJson } from './storage.js';
import { navigateAccount, observe, type LoginOutcome } from './login.js';
import { ensureMailAccess, pollTikTokCode } from './maillogin.js';
import { MAIL_CLIENT_ID } from './mailauth.js';
import type { Operation } from './operation.js';

export const BROWSER_BUILD = 'official/158.0.1-beta.41';
export interface MailLogin { email?: string; mailPassword?: string | null; recoveryEmail?: string | null; mailRefreshToken?: string | null; mailClientId?: string | null }
export interface Job extends MailLogin { id: string; kind: string; ownerId: number; expiresAt: number; accountId?: number; profileId?: string; username?: string; password?: string | null; twofa?: string | null; autofill?: boolean; folder?: string; caption?: string; proxy?: { server: string; username?: string; password?: string } | null; reuse?: boolean; durationMs?: number; likeRate?: number; scheduleAt?: number; deleteAfter?: boolean }
/** A mailbox OAuth token captured during this login, to be stored on the account. */
export interface MailCapture { refreshToken: string; clientId: string }
export interface Report { jobId: string; profileId?: string; status?: string; done?: boolean; ip?: string; latency?: number; error?: string; mail?: MailCapture; twofaSecret?: string; hide?: { changed: number; skipped: number; scanned: number; message: string; status?: string; errorCode?: string }; feed?: { watched: number; liked: number; message: string; status?: string; errorCode?: string } }
export interface Session { context: BrowserContext; job: Job; inspect: () => Promise<string>; close: () => Promise<void>; login?: LoginOutcome; mailCapture?: MailCapture }
export async function check(context: BrowserContext) {
  const page = await context.newPage();
  const start = Date.now();
  try {
    const res = await page.goto('https://api.ipify.org?format=json', { timeout: 30000 });
    if (!res?.ok()) throw new Error('PROXY_FAILED');
    const { ip } = await res.json();
    if (typeof ip !== 'string' || !isIP(ip)) throw new Error('PROXY_FAILED');
    return { ip, latency: Date.now() - start };
  } finally { await page.close(); }
}
export async function checkProxy(job: Job, operation: Operation) {
  operation.check();
  if (!job.proxy) throw new Error('PROXY_FAILED');
  const browser = await Camoufox({ headless: true, browser: BROWSER_BUILD, proxy: job.proxy, geoip: true });
  try { await operation.own(() => browser.close()); operation.check(); return await check(await browser.newContext()); } finally { await browser.close(); }
}
export async function openSession(origin: string, job: Job, operation: Operation): Promise<Session> {
  operation.check();
  if (!job.profileId || !/^[a-f0-9-]{36}$/.test(job.profileId)) throw new Error('PROFILE_BUSY');
  const dir = join(root, 'profiles', siteKey(origin, job.ownerId), job.profileId);
  await mkdir(dir, { recursive: true });
  const lock = join(dir, 'session.lock');
  // An abandoned marker requires manual recovery; never break a Firefox/profile lock.
  try { await writeFile(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx' }); } catch { throw new Error('PROFILE_BUSY'); }
  let context: BrowserContext | undefined;
  let closed = false;
  try {
    const identityFile = join(dir, 'identity.json');
    let identity: { build: string; preset: Record<string, unknown> };
    try { identity = JSON.parse(await readFile(identityFile, 'utf8')); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      const preset = getRandomPreset('windows', '158');
      if (!preset) throw new Error('BROWSER_FAILED');
      identity = { build: BROWSER_BUILD, preset }; await saveJson(identityFile, identity);
    }
    if (identity.build !== BROWSER_BUILD) throw new Error('BROWSER_FAILED');
    context = await Camoufox({ persistent_context: true, user_data_dir: join(dir, 'data'), browser: BROWSER_BUILD,
      fingerprint_preset: identity.preset, headless: false, proxy: job.proxy ?? undefined, geoip: job.proxy ? true : undefined });
    const ownedContext = context;
    ownedContext.on('close', () => { closed = true; void unlink(lock).catch(() => {}); });
    await operation.own(() => ownedContext.close());
    operation.check();
    // This request uses the browser's proxy. Failure never retries without a proxy.
    if (job.proxy) await check(context);
    operation.check();
    const page = context.pages()[0] ?? await context.newPage();
    // Preserve an authenticated profile's landing page. TikTok may abort the
    // requested login navigation while redirecting an already logged-in user.
    const loginCookies = await context.cookies('https://www.tiktok.com');
    const hasSession = loginCookies.some(cookie => ['sessionid', 'sessionid_ss', 'sid_tt'].includes(cookie.name));
    // No-2FA accounts: resolver that reads TikTok's emailed code from the Hotmail mailbox,
    // capturing a mailbox OAuth token the first time so later logins read online.
    const captured: { mail?: MailCapture } = {};
    const getMailCode = job.autofill && !job.twofa && job.email
      ? (async (since: number) => {
          const account = { email: job.email!, mailPassword: job.mailPassword ?? null, recoveryEmail: job.recoveryEmail ?? null, refreshToken: job.mailRefreshToken ?? null, clientId: job.mailClientId ?? null };
          const access = await ensureMailAccess(context!, account, () => operation.check());
          if (access.tokens?.refreshToken) captured.mail = { refreshToken: access.tokens.refreshToken, clientId: job.mailClientId ?? MAIL_CLIENT_ID };
          return pollTikTokCode(account.email, access.accessToken, since, () => operation.check());
        })
      : undefined;
    const login = await navigateAccount(page, hasSession, job.username!, job.password ?? null, !!job.autofill, () => operation.check(), job.twofa ?? null, getMailCode);
    operation.check();
    if (closed) throw new Error('INTERRUPTED');
    job.password = null; job.twofa = null; job.mailPassword = null; job.mailRefreshToken = null;
    const activeContext = context;
    return { context: activeContext, job, login, mailCapture: captured.mail, inspect: async () => closed ? 'closed' : observe(activeContext.pages().find(p => p.url().startsWith('https://www.tiktok.com/')) ?? page, job.username!).catch(() => 'unverified'),
      close: async () => { await activeContext.close(); await unlink(lock).catch(() => {}); } };
  } catch (e) {
    job.password = null; job.twofa = null; job.mailPassword = null; job.mailRefreshToken = null;
    // Retain marker if shutdown fails: reopening may corrupt an active profile.
    if (context) await context.close();
    await unlink(lock).catch(() => {});
    throw e;
  }
}
