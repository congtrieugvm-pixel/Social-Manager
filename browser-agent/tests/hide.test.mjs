import test from 'node:test';
import assert from 'node:assert/strict';
import { hidePosts, cleanProgress, STUDIO_CONTENT } from '../dist/hide.js';
import { Operation } from '../dist/operation.js';

// A fake Studio page: evaluate() calls are, in order, the engine bundle, the
// runner, then progress polls answered from `states`.
function fakeSession(states, { url = STUDIO_CONTENT } = {}) {
  const calls = [];
  let poll = 0, closed = false;
  const page = {
    url: () => url,
    goto: async target => { calls.push(['goto', target]); },
    waitForLoadState: async () => {},
    evaluate: async code => {
      calls.push(['evaluate', String(code).slice(0, 40)]);
      if (String(code).startsWith('globalThis.__smState')) return states[Math.min(poll++, states.length - 1)];
      return true;
    },
    close: async () => { closed = true; },
  };
  return { session: { context: { pages: () => [page], newPage: async () => { throw new Error('must not open a new window'); } } }, calls, isClosed: () => closed };
}

test('runs the Studio engine, streams progress and returns the completed result', async () => {
  const { session, calls, isClosed } = fakeSession([
    { changed: 1, skipped: 0, scanned: 1, message: 'Đã xác nhận bài chuyển sang Chỉ mình tôi.' },
    { changed: 3, skipped: 2, scanned: 5, message: 'Hoàn tất', status: 'completed', caption: 'never sent' },
  ]);
  const seen = [];
  const result = await hidePosts(session, { id: 'j', username: 'fixture' }, new Operation(() => true), p => seen.push(p));
  assert.equal(result.status, 'completed');
  assert.equal(result.changed, 3);
  assert.equal('caption' in result, false, 'page data other than counters must not leave the machine');
  assert.equal(calls[0][1], STUDIO_CONTENT);
  assert.ok(seen.some(p => p.changed === 1));
  assert.equal(isClosed(), false, 'the account window itself is never closed');
  assert.deepEqual(calls.at(-1), ['goto', 'https://www.tiktok.com/?lang=en'], 'it returns to TikTok home afterwards');
});

test('a redirect away from Studio (logged out) stops with HIDE_MANUAL', async () => {
  const { session } = fakeSession([], { url: 'https://www.tiktok.com/login' });
  await assert.rejects(hidePosts(session, { id: 'j' }, new Operation(() => true), () => {}), /HIDE_MANUAL/);
});

test('losing the injected engine (page reload) stops with HIDE_MANUAL', async () => {
  const { session } = fakeSession([null]);
  await assert.rejects(hidePosts(session, { id: 'j' }, new Operation(() => true), () => {}), /HIDE_MANUAL/);
});

test('cancelling the operation asks the page engine to stop', async () => {
  const { session, calls } = fakeSession([{ changed: 0, skipped: 0, scanned: 0, message: 'running' }]);
  let valid = true;
  const op = new Operation(() => valid);
  setTimeout(() => { valid = false; }, 2500);
  await assert.rejects(hidePosts(session, { id: 'j' }, op, () => {}), /INTERRUPTED/);
  assert.ok(calls.some(([kind, code]) => kind === 'evaluate' && code.startsWith('globalThis.__smStop = true')));
});

test('cleanProgress keeps only counters, a short message and known statuses', () => {
  assert.deepEqual(cleanProgress({ changed: 2.4, skipped: -1, scanned: '9', message: 'x'.repeat(500), status: 'weird', url: 'https://x' }),
    { changed: 2, skipped: 0, scanned: 0, message: 'x'.repeat(300) });
});
