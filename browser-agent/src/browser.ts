import { Camoufox, getRandomPreset } from 'camoufox';
import type { BrowserContext } from 'playwright-core';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { root, siteKey, saveJson } from './storage.js';
import { navigateAccount, observe } from './login.js';
import type { Operation } from './operation.js';

export const BROWSER_BUILD = 'official/158.0.1-beta.41';
export interface Job { id: string; kind: string; ownerId: number; expiresAt: number; accountId?: number; profileId?: string; username?: string; password?: string | null; autofill?: boolean; folder?: string; caption?: string; proxy?: { server: string; username?: string; password?: string } | null }
export interface Report { jobId: string; profileId?: string; status?: string; done?: boolean; ip?: string; latency?: number; error?: string }
export interface Session { context: BrowserContext; job: Job; inspect: () => Promise<string>; close: () => Promise<void> }
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
    await navigateAccount(page, hasSession, job.username!, job.password ?? null, !!job.autofill, () => operation.check());
    operation.check();
    if (closed) throw new Error('INTERRUPTED');
    job.password = null;
    const activeContext = context;
    return { context: activeContext, job, inspect: async () => closed ? 'closed' : observe(activeContext.pages().find(p => p.url().startsWith('https://www.tiktok.com/')) ?? page, job.username!).catch(() => 'unverified'),
      close: async () => { await activeContext.close(); await unlink(lock).catch(() => {}); } };
  } catch (e) {
    job.password = null;
    // Retain marker if shutdown fails: reopening may corrupt an active profile.
    if (context) await context.close();
    await unlink(lock).catch(() => {});
    throw e;
  }
}
