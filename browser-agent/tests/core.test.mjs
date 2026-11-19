import test from 'node:test';
import assert from 'node:assert/strict';
import { identityStatus, fillOnce } from '../dist/login.js';
import { validateOrigin, siteKey, dpapi } from '../dist/storage.js';
import { Operation } from '../dist/operation.js';

test('cancel during startup closes late browser and prevents credentials', async () => {
  let closed = 0;
  const task = new Operation(() => true);
  await task.cancel();
  await assert.rejects(task.own(async () => { closed++; }), /INTERRUPTED/);
  assert.equal(closed, 1); assert.throws(() => task.check(), /INTERRUPTED/);
  let allowed = true;
  const leased = new Operation(() => allowed);
  await leased.own(async () => { closed++; });
  allowed = false;
  assert.throws(() => leased.check(), /INTERRUPTED/);
  await leased.cancel(); assert.equal(closed, 2);
});

test('connection rejects non-HTTPS remote URLs, credentials, paths', () => {
  assert.equal(validateOrigin('https://example.com/'), 'https://example.com');
  assert.equal(validateOrigin('http://localhost:3000'), 'http://localhost:3000');
  for (const url of ['http://example.com', 'https://user:pw@example.com', 'https://example.com/path', 'file:///tmp']) assert.throws(() => validateOrigin(url));
  assert.notEqual(siteKey('https://one.example', 1), siteKey('https://two.example', 1));
  assert.notEqual(siteKey('https://one.example', 1), siteKey('https://one.example', 2));
});
test('login evidence distinguishes verification, unknown and wrong user', () => {
  assert.equal(identityStatus(null, 'alice', false), 'unverified');
  assert.equal(identityStatus('alice', 'alice', true), 'needs_verification');
  assert.equal(identityStatus('bob', 'alice', false), 'wrong_account');
  assert.equal(identityStatus('@Alice', 'alice', false), 'logged_in');
});
// A login page fixture: Log in enables `enableAfter` checks after filling; clicking
// either leaves /login (accepted) or shows `errorText` in the form.
function loginPage({ enableAfter = 0, errorText = null } = {}) {
  const state = { clicks: 0, fills: [], url: 'https://www.tiktok.com/login/phone-or-email/email', checks: 0 };
  const field = selector => ({
    waitFor: async () => {}, count: async () => 1, isVisible: async () => true,
    isEnabled: async () => state.fills.length >= 2 && ++state.checks > enableAfter,
    fill: async value => state.fills.push([selector, value]),
    click: async () => { state.clicks++; if (!errorText) state.url = 'https://www.tiktok.com/foryou'; },
    getByText: () => ({ first: () => ({ innerText: async () => { if (errorText && state.clicks) return errorText; throw new Error('none'); } }) }),
    first: () => ({ isVisible: async () => false }),
  });
  return { state, page: { url: () => state.url, locator: field } };
}
test('autofill waits for Log in to enable, clicks exactly once and reports the outcome', async () => {
  const ok = loginPage({ enableAfter: 3 });
  assert.deepEqual(await fillOnce(ok.page, 'alice', 'secret'), { result: 'submitted' });
  assert.equal(ok.state.clicks, 1); assert.equal(ok.state.fills.length, 2);

  const wrong = loginPage({ errorText: 'Incorrect account or password' });
  assert.deepEqual(await fillOnce(wrong.page, 'alice', 'bad'), { result: 'rejected', error: 'Incorrect account or password' });
  assert.equal(wrong.state.clicks, 1, 'a rejected login is never resubmitted');

  const none = loginPage();
  assert.equal((await fillOnce(none.page, 'alice', null)).result, 'no_password'); assert.equal(none.state.clicks, 0);
  assert.equal((await fillOnce({ ...none.page, url: () => 'https://other.example/login' }, 'alice', 'secret')).result, 'no_form');
  const ambiguous = { url: () => none.state.url, locator: () => ({ waitFor: async () => { throw new Error('strict mode violation'); }, count: async () => 2 }) };
  assert.equal((await fillOnce(ambiguous, 'alice', 'secret')).result, 'no_form'); assert.equal(none.state.clicks, 0);
});
test('Windows DPAPI round trip', { skip: process.platform !== 'win32' }, async () => {
  const encrypted = await dpapi('synthetic-test-token');
  assert.notEqual(encrypted, Buffer.from('synthetic-test-token').toString('base64'));
  assert.equal(Buffer.from(await dpapi(encrypted, true), 'base64').toString(), 'synthetic-test-token');
});
