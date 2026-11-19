import { readdir, stat, mkdir, readFile, writeFile } from 'node:fs/promises';
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
    const button = page.getByRole('button', { name: /^(Post|Đăng)$/ }).first();
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
    await page.getByText(/Your video has been posted|Video posted|Video đã được đăng|Đã đăng video/i).first().waitFor({ timeout: 60000 });
    await saveJson(item.receipt, { jobId: job.id, state: 'posted', file: basename(item.video) });
  } catch {
    await saveJson(item.receipt, { jobId: job.id, state: submitted ? 'unknown' : 'needs_review', file: basename(item.video) });
    throw new Error(submitted ? 'POST_UNKNOWN' : 'POST_MANUAL');
  }
  // Leave the upload/result tab open so the user can inspect confirmation or finish a challenge.
}
