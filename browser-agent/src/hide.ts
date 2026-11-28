import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright-core';
import { mainPage, type Session, type Job } from './browser.js';
import type { Operation } from './operation.js';
import { inEnglish } from './login.js';

// "Ẩn bài": switch every public post of the signed-in account to Only me in
// TikTok Studio. The DOM work is the TikTok Studio Private extension's engine
// (extension/shared.js + adapter.js + engine.js, copied into dist/studio at
// build). It never guesses success: it re-reads each row after saving and only
// reports "completed" when the Everyone filter is explicitly empty.

export const STUDIO_CONTENT = 'https://www.tiktok.com/tiktokstudio/content';
const STUDIO_FILES = ['shared.js', 'adapter.js', 'engine.js'];
const POLL_MS = 2000;
const MAX_RUN_MS = 3 * 60 * 60 * 1000;
const LOGIN_WAIT_MS = 10 * 60 * 1000;

export interface HideProgress {
  changed: number;
  skipped: number;
  scanned: number;
  message: string;
  status?: 'completed' | 'stopped' | 'error';
  errorCode?: string;
}

let bundle: string | undefined;
export async function studioScript() {
  bundle ??= (await Promise.all(STUDIO_FILES.map(file => readFile(new URL(`./studio/${file}`, import.meta.url), 'utf8')))).join('\n;\n');
  return bundle;
}

/** Runner evaluated in the page after the engine. State lives on globalThis so later polls can read it. */
export const RUNNER = (delayMs: number) => `(() => {
  const g = globalThis;
  g.__smStop = false;
  g.__smState = { changed: 0, skipped: 0, scanned: 0, message: 'Đang chuẩn bị TikTok Studio…' };
  const settings = TSP.config({ delayMs: ${delayMs} });
  const guard = async () => { if (g.__smStop) throw new TSP.Halt('stopped', 'Đã dừng theo yêu cầu.'); };
  const adapter = new TSP.DomAdapter(settings, guard, () => g.__smStop);
  TSP.run(adapter, async (data) => { g.__smState = Object.assign({}, data); }, guard)
    .catch((e) => { g.__smState = Object.assign({}, g.__smState, { status: 'error', errorCode: 'unexpected', message: String((e && e.message) || e) }); })
    .finally(() => { if (!g.__smState.status) g.__smState = Object.assign({}, g.__smState, { status: 'error', errorCode: 'unexpected', message: 'Kết thúc không rõ trạng thái.' }); });
  return true;
})()`;

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(1e6, Math.round(v)) : 0);
/** Keep only the counters and a short message: no captions, URLs or page data leave the machine. */
export function cleanProgress(raw: unknown): HideProgress {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const status = ['completed', 'stopped', 'error'].includes(r.status as string) ? (r.status as HideProgress['status']) : undefined;
  return {
    changed: int(r.changed), skipped: int(r.skipped), scanned: int(r.scanned),
    message: typeof r.message === 'string' ? r.message.slice(0, 300) : '',
    ...(status ? { status } : {}),
    ...(typeof r.errorCode === 'string' ? { errorCode: r.errorCode.slice(0, 40) } : {}),
  };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const onStudio = (page: Page) => { try { const u = new URL(page.url()); return u.hostname === 'www.tiktok.com' && u.pathname.startsWith('/tiktokstudio'); } catch { return false; } };

/** What to tell the user while waiting, based on how the saved-credentials login went. */
export function loginMessage(status: string, login: Session['login']): string {
  if (login?.result === 'challenge' && login.error) return `${login.error}. Hoàn tất xác minh trong cửa sổ trình duyệt để tiếp tục.`;
  if (status === 'needs_verification' || login?.result === 'challenge') return 'TikTok cần xác minh (CAPTCHA/OTP). Hoàn tất trong cửa sổ trình duyệt để tiếp tục.';
  if (status === 'wrong_account' || login?.result === 'wrong_account') return 'Cửa sổ đang đăng nhập tài khoản khác. Đăng xuất rồi đăng nhập đúng tài khoản.';
  switch (login?.result) {
    case 'rejected': return `TikTok từ chối đăng nhập: “${login.error}”. Kiểm tra mật khẩu đã lưu hoặc đăng nhập tay trong cửa sổ.`;
    case 'no_password': return 'Tài khoản chưa lưu mật khẩu nên không tự đăng nhập được. Đăng nhập tay trong cửa sổ trình duyệt.';
    case 'no_form': return `Không tự đăng nhập được${login.error ? ` (${login.error})` : ' (không thấy form đăng nhập email)'}. Đăng nhập tay trong cửa sổ trình duyệt.`;
    case 'pending': case 'submitted': return 'Đã tự điền và bấm Đăng nhập. Đang chờ TikTok xác nhận…';
    default: return 'Đang chờ đăng nhập đúng tài khoản trong cửa sổ trình duyệt…';
  }
}

/** Wait until the session's TikTok tab proves the expected account is signed in. */
export async function waitForLogin(session: Session, operation: Operation, report: (p: HideProgress) => void) {
  const deadline = Date.now() + LOGIN_WAIT_MS;
  let status = await session.inspect();
  while (status !== 'logged_in') {
    operation.check();
    if (status === 'closed' || Date.now() > deadline) throw new Error('HIDE_MANUAL');
    report({ changed: 0, skipped: 0, scanned: 0, message: loginMessage(status, session.login) });
    await sleep(3000);
    status = await session.inspect();
  }
}

export async function hidePosts(session: Session, job: Job, operation: Operation, report: (p: HideProgress) => void): Promise<HideProgress> {
  operation.check();
  // Work in the account's own window (no extra window).
  const page = await mainPage(session.context);
  let last: HideProgress = { changed: 0, skipped: 0, scanned: 0, message: 'Đang mở TikTok Studio…' };
  report(last);
  try {
    await page.goto(STUDIO_CONTENT, { waitUntil: 'domcontentloaded', timeout: 60000 });
    operation.check();
    // Let Studio's SPA settle; a logged-out profile is redirected away from /tiktokstudio.
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    if (!onStudio(page)) throw new Error('HIDE_MANUAL');
    await page.evaluate(await studioScript());
    await page.evaluate(RUNNER(2500));
    const deadline = Date.now() + MAX_RUN_MS;
    while (true) {
      await sleep(POLL_MS);
      try { operation.check(); }
      catch (e) { await page.evaluate('globalThis.__smStop = true').catch(() => {}); throw e; }
      if (Date.now() > deadline) { await page.evaluate('globalThis.__smStop = true').catch(() => {}); throw new Error('HIDE_FAILED'); }
      // A reload/redirect wipes the injected engine: the run can't be trusted to continue.
      const state = await page.evaluate('globalThis.__smState ?? null').catch(() => null);
      if (!state || !onStudio(page)) throw new Error('HIDE_MANUAL');
      last = cleanProgress(state);
      report(last);
      if (last.status) return last;
    }
  } finally {
    // This is the account's own window: leave Studio for TikTok's home page instead of closing it.
    await page.goto(inEnglish('https://www.tiktok.com/'), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }
}
