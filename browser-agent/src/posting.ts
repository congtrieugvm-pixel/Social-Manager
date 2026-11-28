import { readdir, stat, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import type { Page } from 'playwright-core';
import { join, extname, basename, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { mainPage, type Session, type Job } from './browser.js';
import type { Operation } from './operation.js';
import { root, siteKey, saveJson } from './storage.js';
import { inEnglish } from './login.js';

export async function reserveVideo(origin: string, job: Job) {
  if (!job.folder || !isAbsolute(job.folder)) throw new Error('FOLDER_INVALID');
  // A scenario's folder is one pool shared by every account: one ledger per FOLDER, so each video
  // goes to exactly one account (the 'wx' create below is atomic, even with windows in parallel).
  // Otherwise each account keeps its own ledger for its own folder.
  const ledger = job.shared
    ? join(root, 'posting', siteKey(origin, job.ownerId), 'shared', createHash('sha256').update(job.folder.toLowerCase()).digest('hex').slice(0, 24))
    : join(root, 'posting', siteKey(origin, job.ownerId), String(job.accountId));
  await mkdir(ledger, { recursive: true });
  let entries;
  try { entries = await readdir(job.folder, { withFileTypes: true }); }
  catch { throw new Error('FOLDER_INVALID'); }
  for (const file of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!file.isFile() || !['.mp4', '.mov', '.webm'].includes(extname(file.name).toLowerCase())) continue;
    const video = join(job.folder, file.name);
    const info = await stat(video);
    const key = createHash('sha256').update(JSON.stringify([video.toLowerCase(), info.size, info.mtimeMs])).digest('hex');
    const receipt = join(ledger, key + '.json');
    try {
      await writeFile(receipt, JSON.stringify({ jobId: job.id, state: 'reserved', file: file.name }), { flag: 'wx' });
      return { video, receipt, attempts: 0 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    // A video that failed before TikTok ever got it ('retry') may be tried again, 3 times at most.
    // Claim it under an exclusive lock file and re-read the receipt inside it, so two windows can
    // never take the same one (the receipt itself is never absent, so fresh 'wx' reservations
    // can't slip in either).
    const readReceipt = () => readFile(receipt, 'utf8').then(t => JSON.parse(t) as { state?: string; attempts?: number }, () => null);
    const retryable = (r: { state?: string; attempts?: number } | null) => r?.state === 'retry' && (r.attempts ?? 1) < MAX_ATTEMPTS;
    if (!retryable(await readReceipt())) continue;
    const lock = `${receipt}.lock`;
    if (!(await takeLock(lock))) continue; // another window is claiming it
    try {
      const prev = await readReceipt();
      if (!retryable(prev)) continue;
      await writeFile(receipt, JSON.stringify({ jobId: job.id, state: 'reserved', file: file.name, attempts: prev!.attempts ?? 1 }));
      return { video, receipt, attempts: prev!.attempts ?? 1 };
    } finally { await unlink(lock).catch(() => {}); }
  }
  throw new Error('FOLDER_EMPTY');
}
const MAX_ATTEMPTS = 3;
/** Create `lock` exclusively; a lock left behind by a crash (older than 10 min) is taken over. */
async function takeLock(lock: string): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    try { await writeFile(lock, String(process.pid), { flag: 'wx' }); return true; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const age = await stat(lock).then(s => Date.now() - s.mtimeMs, () => 0);
      if (age < 10 * 60_000) return false;
      await unlink(lock).catch(() => {});
    }
  }
  return false;
}

export async function postVideo(origin: string, session: Session, job: Job, operation: Operation) {
  operation.check();
  if (await session.inspect() !== 'logged_in') throw new Error('POST_MANUAL');
  const item = await reserveVideo(origin, job);
  // Work in the account's own window (no new window per video).
  const page = await mainPage(session.context);
  let submitted = false;
  let step = 'open upload page';
  try {
    await page.goto(inEnglish('https://www.tiktok.com/tiktokstudio/upload'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    operation.check();
    // TikTok Studio has no site profile-icon to read, so identity was proven at session open
    // (session.inspect on the main tab). Here, only guard against a logged-out redirect.
    if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('POST_MANUAL');
    step = 'choose video file';
    const input = page.locator('input[type="file"]').first();
    await input.waitFor({ state: 'attached', timeout: 30000 });
    await input.setInputFiles(item.video);
    step = 'caption';
    const caption = page.locator('[contenteditable="true"]').first();
    await caption.waitFor({ timeout: 90000 });
    await caption.fill(job.caption || basename(item.video, extname(item.video)));
    await dismissOverlays(page);
    step = 'schedule';
    // Scheduled post: switch to Schedule and set the date/time BEFORE submitting. If the schedule
    // controls can't be set with confidence, fail safe (never post now instead of scheduling).
    const scheduling = typeof job.scheduleAt === 'number' && job.scheduleAt > 0;
    if (scheduling && !(await setSchedule(page, job.scheduleAt!, operation))) throw new Error('POST_SCHEDULE_MANUAL');
    // The submit button keeps data-e2e="post_video_button" whether its label reads Post or Schedule.
    step = 'wait for upload';
    const button = page.locator('[data-e2e="post_video_button"]').first();
    await button.waitFor({ timeout: 90000 });
    await waitForUpload(page, button, operation);
    operation.check();
    // Re-verify identity on the main-site tab (Studio can't show it) and that TikTok finished processing.
    if (new URL(page.url()).pathname.startsWith('/login') || await session.inspect() !== 'logged_in' || !await button.isEnabled()) throw new Error('POST_MANUAL');
    await dismissOverlays(page);
    // Persist before clicking. A crash/unknown result must never post the same file again automatically.
    step = 'click Post';
    await saveJson(item.receipt, { jobId: job.id, state: 'submitting', file: basename(item.video) });
    operation.check(); submitted = true;
    // A click that times out was never delivered (something covered the button): close what covers
    // it and try once more; if it is still covered, nothing was submitted.
    try { await button.click({ timeout: 10000 }); }
    catch {
      await dismissOverlays(page);
      try { await button.click({ timeout: 10000 }); }
      catch (e) { submitted = false; throw e; }
    }
    step = 'wait for TikTok confirmation';
    // Success = either TikTok's confirmation text, or it leaves the upload form for the content
    // manager (post-now and scheduled both redirect there; a live post shows the new item at top).
    const confirmed = page.getByText(/has been posted|Video posted|đã được đăng|Đã đăng video|has been scheduled|đã được lên lịch|scheduled for/i).first().waitFor({ timeout: 60000 });
    const left = page.waitForURL(u => { try { const p = new URL(u).pathname; return p.includes('/tiktokstudio') && !p.includes('/upload'); } catch { return false; } }, { timeout: 60000 });
    await Promise.any([confirmed, left]);
    // Only now, with TikTok's confirmation, may we remove the source file.
    let deleted = false;
    if (job.deleteAfter) { try { await unlink(item.video); deleted = true; } catch { /* keep if delete fails */ } }
    await saveJson(item.receipt, { jobId: job.id, state: deleted ? 'posted-deleted' : 'posted', file: basename(item.video) });
  } catch (e) {
    const manual = !submitted;
    // Failed BEFORE the Post click landed: TikTok never got it, so the video goes back to the pool
    // ('retry', tried at most 3 times). After the click the outcome is unknown: never reuse it.
    await saveJson(item.receipt, submitted
      ? { jobId: job.id, state: 'unknown', file: basename(item.video), step }
      : { jobId: job.id, state: 'retry', attempts: item.attempts + 1, file: basename(item.video), step });
    // Keep what the page showed, for diagnosis: %LOCALAPPDATA%\SocialManagerBrowser\posting\debug.
    await saveDebug(page, job, step, e).catch(() => {});
    if (e instanceof Error && (e.message === 'POST_SCHEDULE_MANUAL' || e.message === 'UPLOAD_FAILED')) throw e;
    throw new Error(manual ? 'POST_MANUAL' : 'POST_UNKNOWN');
  }
  // Leave the upload/result tab open so the user can inspect confirmation or finish a challenge.
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const UPLOAD_LIMIT_MS = 25 * 60_000; // a big file over a shared proxy can take many minutes
const UPLOAD_STALL_MS = 5 * 60_000;  // …but give up when its progress stops moving
const UPLOAD_FAILED_TEXT = /Couldn.t upload|Upload failed|Không thể tải lên|Tải lên thất bại/i;
/** TikTok enables Post once the upload and processing are done. Wait while the upload progresses;
 *  when TikTok says the upload failed, press its Retry (3 times at most). */
export async function waitForUpload(page: Page, button: { isEnabled: () => Promise<boolean> }, operation: Operation) {
  const started = Date.now();
  let lastProgress = '', lastMove = Date.now(), retries = 0;
  while (!(await button.isEnabled().catch(() => false))) {
    operation.check();
    const failed = await page.getByText(UPLOAD_FAILED_TEXT).first().isVisible().catch(() => false);
    if (failed) {
      if (retries >= 3) throw new Error('UPLOAD_FAILED');
      const dialog = page.locator('[role="dialog"], .TUXModal').filter({ hasText: UPLOAD_FAILED_TEXT }).first();
      const scope = (await dialog.isVisible().catch(() => false)) ? dialog : page;
      await scope.getByRole('button', { name: /^\s*(Retry|Thử lại)\s*$/i }).first().click({ timeout: 5000 }).catch(() => {});
      retries++; lastMove = Date.now(); await sleep(3000); continue;
    }
    // The upload card shows "35.09%": any change counts as progress.
    const progress = await page.evaluate(() => (document.body.innerText.match(/\b(\d{1,3}(?:\.\d+)?)%/) || [])[1] ?? '').catch(() => '');
    if (progress !== lastProgress) { lastProgress = progress; lastMove = Date.now(); }
    if (Date.now() - lastMove > UPLOAD_STALL_MS || Date.now() - started > UPLOAD_LIMIT_MS) throw new Error('UPLOAD_FAILED');
    await sleep(2000);
  }
}

/** A screenshot + what was being done when a post failed (the 30 newest are kept). */
async function saveDebug(page: Page, job: Job, step: string, error: unknown) {
  const dir = join(root, 'posting', 'debug');
  await mkdir(dir, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${job.accountId}`;
  await page.screenshot({ path: join(dir, `${name}.png`), timeout: 10000 }).catch(() => {});
  await writeFile(join(dir, `${name}.json`), JSON.stringify({ jobId: job.id, accountId: job.accountId, step, url: page.url(), error: error instanceof Error ? error.message.slice(0, 500) : String(error) }, null, 2));
  const files = (await readdir(dir)).filter(f => f.endsWith('.png')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - 30))) { await unlink(join(dir, old)).catch(() => {}); await unlink(join(dir, old.replace(/\.png$/, '.json'))).catch(() => {}); }
}
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Dismiss TikTok Studio's first-run onboarding tooltips/modals (react-joyride, copyright
 *  check, "new editing features") which otherwise intercept pointer events on the post form. */
async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    let acted = false;
    for (const name of [/^Got it$/i, /^Skip$/i, /^Not now$/i, /^Maybe later$/i, /^Close$/i]) {
      const b = page.getByRole('button', { name }).first();
      if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 1500 }).catch(() => {}); acted = true; await sleep(300); }
    }
    // "Turn on automatic content checks?" pops up after the upload and covers the Post button.
    // Decline it (the account's settings stay as they are) — only in THAT dialog, never a random Cancel.
    try {
      const checks = page.locator('[role="dialog"], .TUXModal').filter({ hasText: CONTENT_CHECKS_DIALOG }).first();
      if (await checks.isVisible().catch(() => false)) {
        const cancel = checks.getByRole('button', { name: /^(Cancel|Hủy|Huỷ|Not now)$/i }).first();
        if (await cancel.isVisible().catch(() => false)) await cancel.click({ timeout: 2000 }).catch(() => {});
        else await page.keyboard.press('Escape').catch(() => {});
        acted = true; await sleep(500);
      }
    } catch { /* best effort: a missing dialog must never fail the post */ }
    if (!acted) break;
  }
}
const CONTENT_CHECKS_DIALOG = /automatic content checks|kiểm tra nội dung tự động/i;

/** Switch the upload form to Schedule and set the date + time via TikTok Studio's custom
 *  pickers (the inputs are readonly, so we drive the calendar and time list, not fill()).
 *  Returns false (fail safe) if it cannot set it exactly, so the caller never posts now
 *  when a schedule was requested. Exported for calibration tests. */
export async function setSchedule(page: Page, whenEpoch: number, operation: Operation): Promise<boolean> {
  operation.check();
  const when = new Date(whenEpoch * 1000);
  let hh = when.getHours();
  let mm = Math.round(when.getMinutes() / 5) * 5; // the time list only offers 5-minute steps
  if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
  const wantDate = `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())}`;
  const wantTime = `${pad2(hh)}:${pad2(mm)}`;

  // 1. Select the "Schedule" radio in the "When to post" section.
  const radio = page.locator('input[name="postSchedule"][value="schedule"]').first();
  if (!(await radio.count())) return false;
  await radio.click({ force: true }).catch(() => {});
  await sleep(1200);
  // 2. First time scheduling, TikTok asks to allow saving the video — confirm with "Allow".
  const allow = page.locator('.TUXModal button, [role="dialog"] button').filter({ hasText: /^(Allow|Đồng ý|Cho phép)$/i }).first();
  if (await allow.isVisible().catch(() => false)) { await allow.click({ timeout: 3000 }).catch(() => {}); await sleep(1500); }
  if (!(await radio.isChecked().catch(() => false))) return false;

  const container = page.locator('[data-e2e="schedule_container"]').first();
  const timeInput = container.locator('input[type="text"]').nth(0);
  const dateInput = container.locator('input[type="text"]').nth(1);

  // 3. Date: open the calendar, page to the target month, click the matching valid day.
  await dateInput.click({ timeout: 4000 }).catch(() => {});
  await sleep(700);
  const cal = page.locator('.calendar-wrapper').first();
  if (!(await cal.isVisible().catch(() => false))) return false;
  const targetMonth = when.toLocaleString('en-US', { month: 'long' });
  const targetYear = String(when.getFullYear());
  for (let i = 0; i < 4; i++) {
    const mt = (await cal.locator('.month-title').first().innerText().catch(() => '')).trim();
    const yt = (await cal.locator('.year-title').first().innerText().catch(() => '')).trim();
    if (mt === targetMonth && yt === targetYear) break;
    await cal.locator('.arrow').nth(1).click({ timeout: 2000 }).catch(() => {}); // second arrow = next month
    await sleep(500);
  }
  const day = cal.locator('span.day.valid').filter({ hasText: new RegExp(`^${when.getDate()}$`) }).first();
  if (!(await day.count())) return false; // not a selectable (future, within window) day
  await day.click({ timeout: 3000 }).catch(() => {});
  await sleep(600);
  if ((await dateInput.inputValue().catch(() => '')) !== wantDate) return false;

  // 4. Time: open the time list, pick the hour (left column) then minute (right column).
  await timeInput.click({ timeout: 4000 }).catch(() => {});
  await sleep(700);
  const picker = page.locator('.tiktok-timepicker-time-picker-container').first();
  await picker.locator('.tiktok-timepicker-left').filter({ hasText: new RegExp(`^${pad2(hh)}$`) }).first().click({ timeout: 3000 }).catch(() => {});
  await sleep(300);
  await picker.locator('.tiktok-timepicker-right').filter({ hasText: new RegExp(`^${pad2(mm)}$`) }).first().click({ timeout: 3000 }).catch(() => {});
  await sleep(400);
  // Close the time popover and confirm both fields hold exactly what we asked for.
  await page.locator('[data-e2e="schedule_container"] .title-v2').first().click({ timeout: 2000 }).catch(() => {});
  await sleep(300);
  return (await timeInput.inputValue().catch(() => '')) === wantTime
    && (await dateInput.inputValue().catch(() => '')) === wantDate;
}
