import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reserveVideo, postVideo, waitForUpload } from '../dist/posting.js';
import { Operation } from '../dist/operation.js';
import { navigateAccount } from '../dist/login.js';

// The nav shows the signed-in user when `signedIn`, nothing otherwise.
const navPage = (signedIn, urls) => ({
  url: () => 'https://www.tiktok.com/',
  goto: async url => { urls.push(url); throw new Error('Navigation interrupted by redirect'); },
  locator: () => ({ first: () => ({ isVisible: async () => false, getAttribute: async () => { if (signedIn) return '/@fixture'; throw new Error('absent'); } }) }),
});
test('a session that the page confirms survives TikTok redirect without filling login', async () => {
  const urls = [];
  assert.deepEqual(await navigateAccount(navPage(true, urls), true, 'fixture', 'password', true), { result: 'logged_in' });
  assert.deepEqual(urls, ['https://www.tiktok.com/?lang=en']);
});
test('an expired session cookie no longer skips the saved-credentials login', async () => {
  const urls = [];
  await navigateAccount(navPage(false, urls), true, 'fixture', 'password', true);
  // Opens home to check the session, then the login form — retried while a redirect keeps the page elsewhere.
  const login = 'https://www.tiktok.com/login/phone-or-email/email?lang=en';
  assert.deepEqual(urls, ['https://www.tiktok.com/?lang=en', login, login, login]);
});
test('without a saved session the login form is opened directly (no home-page redirect in between)', async () => {
  const urls = [];
  await navigateAccount(navPage(false, urls), false, 'fixture', 'password', true);
  assert.equal(urls[0], 'https://www.tiktok.com/login/phone-or-email/email?lang=en');
  assert.ok(urls.every(u => u.includes('/login/')), 'never visits the home page first');
});
test('a shared scenario folder gives each video to exactly one account, even in parallel', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sm-shared-fixture-'));
  for (const n of ['01', '02', '03']) await writeFile(join(folder, `${n}.mp4`), 'fixture');
  const base = { kind: 'post', ownerId: Date.now(), folder, shared: true };
  // Three accounts reserve at the same moment: three different files, then the pool is empty.
  const picks = await Promise.all([1, 2, 3].map(accountId => reserveVideo('https://fixture.invalid', { ...base, id: `j${accountId}`, accountId })));
  assert.deepEqual(picks.map(p => p.video).sort(), ['01', '02', '03'].map(n => join(folder, `${n}.mp4`)));
  await assert.rejects(reserveVideo('https://fixture.invalid', { ...base, id: 'j4', accountId: 4 }), /FOLDER_EMPTY/);
  // Without `shared`, each account still has its own ledger for the same folder.
  const own = await reserveVideo('https://fixture.invalid', { ...base, shared: false, id: 'j5', accountId: 5 });
  assert.equal(own.video, join(folder, '01.mp4'));
});
test('a video that failed before TikTok got it returns to the pool (3 tries), one window at a time', async () => {
  const { writeFile: wf } = await import('node:fs/promises');
  const folder = await mkdtemp(join(tmpdir(), 'sm-retry-fixture-'));
  await writeFile(join(folder, '01.mp4'), 'fixture');
  const base = { kind: 'post', ownerId: Date.now(), folder, shared: true };
  const first = await reserveVideo('https://fixture.invalid', { ...base, id: 'a', accountId: 1 });
  assert.equal(first.attempts, 0);
  // Upload failed before the Post click: marked 'retry' → two windows race for it, exactly one wins.
  await wf(first.receipt, JSON.stringify({ state: 'retry', attempts: 1, file: '01.mp4' }));
  const race = await Promise.allSettled([1, 2].map(n => reserveVideo('https://fixture.invalid', { ...base, id: `r${n}`, accountId: 1 + n })));
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(race.find(r => r.status === 'fulfilled').value.attempts, 1);
  assert.match(String(race.find(r => r.status === 'rejected').reason), /FOLDER_EMPTY/);
  // Tried 3 times: kept out of the pool. Posted / unknown: never reused.
  for (const state of [{ state: 'retry', attempts: 3 }, { state: 'unknown' }, { state: 'posted' }]) {
    await wf(first.receipt, JSON.stringify({ ...state, file: '01.mp4' }));
    await assert.rejects(reserveVideo('https://fixture.invalid', { ...base, id: 'x', accountId: 9 }), /FOLDER_EMPTY/, JSON.stringify(state));
  }
});
test('waiting for the upload presses Retry when TikTok says it failed, and gives up after 3', async () => {
  const fakePage = (failures, enableAfterPolls) => {
    let polls = 0, retries = 0;
    const failedNow = () => retries < failures;
    const retryBtn = { first: () => ({ click: async () => { retries++; } }) };
    const page = {
      getByText: () => ({ first: () => ({ isVisible: async () => failedNow() }) }),
      locator: () => ({ filter: () => ({ first: () => ({ isVisible: async () => true, getByRole: () => retryBtn }) }) }),
      getByRole: () => retryBtn,
      evaluate: async () => String(polls),
    };
    const button = { isEnabled: async () => !failedNow() && ++polls > enableAfterPolls };
    return { page, button, retries: () => retries };
  };
  const ok = fakePage(2, 1);
  await waitForUpload(ok.page, ok.button, new Operation(() => true));
  assert.equal(ok.retries(), 2, 'two failed uploads were retried, then it finished');
  const bad = fakePage(9, 0);
  await assert.rejects(waitForUpload(bad.page, bad.button, new Operation(() => true)), /UPLOAD_FAILED/);
  assert.equal(bad.retries(), 3);
});
test('posting takes one file, skips reserved files per account and records confirmation', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sm-post-fixture-'));
  await writeFile(join(folder, '01.mp4'), 'fixture');
  await writeFile(join(folder, '02.mp4'), 'fixture');
  const job = { id: 'fixture', kind: 'post', ownerId: Date.now(), accountId: 1, folder, caption: 'Fixture caption', username: 'fixture' };
  let clicks = 0, chosen, caption;
  const page = {
    url: () => 'https://www.tiktok.com/tiktokstudio/upload',
    goto: async () => {},
    waitForURL: async pred => { if (typeof pred === 'function' && !pred(page.url())) throw new Error('not navigated'); },
    locator: selector => ({ first: () => ({ isVisible: async () => false, getAttribute: async () => '/@fixture', waitFor: async () => {}, isEnabled: async () => true, click: async () => { clicks++; }, setInputFiles: async path => { chosen = path; }, fill: async value => { caption = value; } }) }),
    getByRole: () => ({ first: () => ({ waitFor: async () => {}, isVisible: async () => false, isEnabled: async () => true, click: async () => { clicks++; } }) }),
    getByText: () => ({ first: () => ({ waitFor: async () => {} }) }),
  };
  // The account's one window is reused for every video; opening another window is a failure.
  const session = { inspect: async () => 'logged_in', context: { pages: () => [page], newPage: async () => { throw new Error('must not open a new window'); } } };
  await postVideo('https://fixture.invalid', session, job, new Operation(() => true));
  assert.equal(clicks, 1); assert.equal(caption, 'Fixture caption'); assert.equal(chosen, join(folder, '01.mp4'));
  const next = await reserveVideo('https://fixture.invalid', { ...job, id: 'second' });
  assert.equal(next.video, join(folder, '02.mp4'));
  await assert.rejects(reserveVideo('https://fixture.invalid', job), /FOLDER_EMPTY/);
  const differentAccount = await reserveVideo('https://fixture.invalid', { ...job, accountId: 2 });
  assert.equal(differentAccount.video, join(folder, '01.mp4'));
  const unknownJob = { ...job, accountId: 3 };
  page.getByText = () => ({ first: () => ({ waitFor: async () => { throw new Error('no confirmation'); } }) });
  await assert.rejects(postVideo('https://fixture.invalid', session, unknownJob, new Operation(() => true)), /POST_UNKNOWN/);
  const afterUnknown = await reserveVideo('https://fixture.invalid', unknownJob);
  assert.equal(afterUnknown.video, join(folder, '02.mp4'));
  const previousClicks = clicks;
  page.locator = () => ({ first: () => ({ isVisible: async () => false, getAttribute: async () => '/@other-account' }) });
  await assert.rejects(postVideo('https://fixture.invalid', session, { ...job, accountId: 4 }, new Operation(() => true)), /POST_MANUAL/);
  assert.equal(clicks, previousClicks, 'stale identity in original tab cannot authorize another upload account');
});
