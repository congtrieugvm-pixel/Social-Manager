import { readdir, stat, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import type { Page } from 'playwright-core';
import { join, extname, basename, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import type { Session, Job } from './browser.js';
import type { Operation } from './operation.js';
import { root, siteKey, saveJson } from './storage.js';
import { observe } from './login.js';

export async function reserveVideo(origin: string, job: Job) {
  if (!job.folder || !isAbsolute(job.folder)) throw new Error('FOLDER_INVALID');
  const ledger = join(root, 'posting', siteKey(origin, job.ownerId), String(job.accountId));
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
      return { video, receipt };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('FOLDER_EMPTY');
}

export async function postVideo(origin: string, session: Session, job: Job, operation: Operation) {
  operation.check();
  if (await session.inspect() !== 'logged_in') throw new Error('POST_MANUAL');
  const item = await reserveVideo(origin, job);
  const page = await session.context.newPage();
  let submitted = false;
  try {
    await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 45000 });
    operation.check();
    if (await observe(page, job.username!) !== 'logged_in') throw new Error('POST_MANUAL');
    const input = page.locator('input[type="file"]').first();
    await input.waitFor({ state: 'attached', timeout: 30000 });
    await input.setInputFiles(item.video);
    const caption = page.locator('[contenteditable="true"]').first();
    await caption.waitFor({ timeout: 90000 });
    await caption.fill(job.caption || basename(item.video, extname(item.video)));
    // Scheduled post: switch to Schedule and set the date/time BEFORE submitting. If the schedule
    // controls can't be set with confidence, fail safe (never post now instead of scheduling).
    const scheduling = typeof job.scheduleAt === 'number' && job.scheduleAt > 0;
    if (scheduling && !(await setSchedule(page, job.scheduleAt!, operation))) throw new Error('POST_SCHEDULE_MANUAL');
    const button = page.getByRole('button', { name: scheduling ? /^(Schedule|Lên lịch|Đăng)$/ : /^(Post|Đăng)$/ }).first();
    await button.waitFor({ timeout: 90000 });
    // Wait for TikTok to finish processing the selected file.
    for (let i = 0; i < 120 && !await button.isEnabled(); i++) {
      operation.check(); await new Promise(resolve => setTimeout(resolve, 1000));
    }
    operation.check();
    if (await observe(page, job.username!) !== 'logged_in' || !await button.isEnabled()) throw new Error('POST_MANUAL');
    // Persist before clicking. A crash/unknown result must never post the same file again automatically.
    await saveJson(item.receipt, { jobId: job.id, state: 'submitting', file: basename(item.video) });
    operation.check(); submitted = true;
    await button.click({ timeout: 10000 });
    await page.getByText(/has been posted|Video posted|đã được đăng|Đã đăng video|has been scheduled|đã được lên lịch|scheduled for/i).first().waitFor({ timeout: 60000 });
    // Only now, with TikTok's confirmation, may we remove the source file.
    let deleted = false;
    if (job.deleteAfter) { try { await unlink(item.video); deleted = true; } catch { /* keep if delete fails */ } }
    await saveJson(item.receipt, { jobId: job.id, state: deleted ? 'posted-deleted' : 'posted', file: basename(item.video) });
  } catch (e) {
    const manual = !submitted;
    await saveJson(item.receipt, { jobId: job.id, state: submitted ? 'unknown' : 'needs_review', file: basename(item.video) });
    if (e instanceof Error && e.message === 'POST_SCHEDULE_MANUAL') throw e;
    throw new Error(manual ? 'POST_MANUAL' : 'POST_UNKNOWN');
  }
  // Leave the upload/result tab open so the user can inspect confirmation or finish a challenge.
}

/** Switch the upload form to Schedule and set the date/time. Returns false (fail safe) if it
 *  cannot set it, so the caller never posts immediately when a schedule was requested. */
async function setSchedule(page: Page, whenEpoch: number, operation: Operation): Promise<boolean> {
  operation.check();
  const when = new Date(whenEpoch * 1000);
  // Choose the "Schedule" radio/option in the "When to post" section.
  const option = page.getByText(/^\s*(Schedule|Lên lịch|Hẹn giờ)\s*$/i).first();
  if (!(await option.isVisible().catch(() => false))) return false;
  await option.click({ timeout: 5000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 800));
  const pad = (n: number) => String(n).padStart(2, '0');
  const hhmm = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const mmddyyyy = `${pad(when.getMonth() + 1)}-${pad(when.getDate())}-${when.getFullYear()}`;
  // TikTok's picker is a custom widget; try native-ish date/time inputs first.
  const timeInput = page.locator('input[placeholder*="time" i], input[name*="time" i], [data-e2e*="schedule-time" i] input, input[value*=":"]').first();
  const dateInput = page.locator('input[placeholder*="date" i], input[name*="date" i], [data-e2e*="schedule-date" i] input').first();
  let okTime = false, okDate = false;
  if (await timeInput.isVisible().catch(() => false)) { await timeInput.fill(hhmm).catch(() => {}); await timeInput.press('Enter').catch(() => {}); okTime = (await timeInput.inputValue().catch(() => '')).includes(hhmm.slice(0, 2)); }
  if (await dateInput.isVisible().catch(() => false)) { await dateInput.fill(mmddyyyy).catch(() => {}); await dateInput.press('Enter').catch(() => {}); okDate = /\d/.test(await dateInput.inputValue().catch(() => '')); }
  // Only proceed if both the date and time were accepted; otherwise fail safe.
  return okTime && okDate;
}
