import test from 'node:test';
import assert from 'node:assert/strict';
import { identityStatus, fillOnce, fillWithFallback } from '../dist/login.js';
import { validateOrigin, siteKey, dpapi } from '../dist/storage.js';
import { Operation } from '../dist/operation.js';
import { base32, totp } from '../dist/totp.js';

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
function loginPage({ enableAfter = 0, errorText = null, needsTyping = false, askCode = false, errorFirstOnly = false } = {}) {
  const state = { clicks: 0, fills: [], typed: [], url: 'https://www.tiktok.com/login/phone-or-email/email', checks: 0, codeShown: false, code: null };
  const codeBox = {
    isVisible: async () => state.codeShown, click: async () => {}, press: async () => {},
    pressSequentially: async value => { state.code = value; state.codeShown = false; state.url = 'https://www.tiktok.com/foryou'; },
  };
  const field = selector => selector.includes('one-time-code') ? { first: () => codeBox } : ({
    waitFor: async () => {}, count: async () => 1, isVisible: async () => true,
    isEnabled: async () => (needsTyping ? state.typed.length >= 2 : state.fills.length >= 2) && ++state.checks > enableAfter,
    fill: async value => state.fills.push([selector, value]),
    press: async () => {}, inputValue: async () => '',
    pressSequentially: async value => state.typed.push([selector, value]),
    click: async () => { if (!selector.includes('login-button')) return; state.clicks++; if (askCode) state.codeShown = true; else if (!errorText || (errorFirstOnly && state.clicks > 1)) state.url = 'https://www.tiktok.com/foryou'; },
    getByText: () => ({ first: () => ({ innerText: async () => { if (errorText && state.clicks && !state.url.includes('/foryou')) return errorText; throw new Error('none'); } }) }),
    first: () => ({ isVisible: async () => false }),
  });
  const hidden = { first: () => ({ isVisible: async () => false, isEnabled: async () => false }) };
  return { state, page: { url: () => state.url, locator: field, getByText: () => hidden, getByRole: () => hidden } };
}
test('a stale @handle ("Account doesn\'t exist") retries ONCE with the saved email', async () => {
  const stale = loginPage({ errorText: "Account doesn't exist", errorFirstOnly: true });
  assert.deepEqual(await fillWithFallback(stale.page, 'oldhandle', 'me@hotmail.com', 'secret'), { result: 'submitted', via: 'email' });
  assert.equal(stale.state.clicks, 2);
  assert.deepEqual(stale.state.fills.filter(([s]) => s.includes('username')).map(([, v]) => v), ['oldhandle', 'me@hotmail.com']);
  // No email saved → no second try.
  const noEmail = loginPage({ errorText: "Account doesn't exist", errorFirstOnly: true });
  assert.equal((await fillWithFallback(noEmail.page, 'oldhandle', null, 'secret')).result, 'rejected');
  assert.equal(noEmail.state.clicks, 1);
  // A wrong password is not retried with the email.
  const wrong = loginPage({ errorText: 'Incorrect account or password', errorFirstOnly: true });
  assert.equal((await fillWithFallback(wrong.page, 'alice', 'me@hotmail.com', 'secret')).result, 'rejected');
  assert.equal(wrong.state.clicks, 1);
});
test('TOTP matches RFC 6238 and accepts authenticator-style secrets', () => {
  const key = base32('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ');
  assert.equal(totp(key, 59000), '287082');
  assert.equal(totp(key, 1111111109000), '081804');
  assert.deepEqual(base32('otpauth://totp/TikTok:a?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), key);
  assert.equal(base32('not a secret!'), null);
});
test('after Log in, the 2-step code is typed from the saved 2FA secret', async () => {
  const two = loginPage({ askCode: true });
  assert.deepEqual(await fillOnce(two.page, 'alice', 'secret', () => {}, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'), { result: 'submitted' });
  assert.match(two.state.code, /^\d{6}$/); assert.equal(two.state.clicks, 1);
  const none = loginPage({ askCode: true });
  const out = await fillOnce(none.page, 'alice', 'secret');
  assert.equal(out.result, 'challenge'); assert.match(out.error, /2FA/);
});
test('autofill waits for Log in to enable, clicks exactly once and reports the outcome', async () => {
  const ok = loginPage({ enableAfter: 3 });
  assert.deepEqual(await fillOnce(ok.page, 'alice', 'secret'), { result: 'submitted' });
  assert.equal(ok.state.clicks, 1); assert.equal(ok.state.fills.length, 2);

  // A visible window where React ignores fill(): falls back to typing, still one click.
  const typed = loginPage({ needsTyping: true });
  assert.deepEqual(await fillOnce(typed.page, 'alice', 'secret'), { result: 'submitted' });
  assert.deepEqual(typed.state.typed.map(([, v]) => v), ['alice', 'secret']); assert.equal(typed.state.clicks, 1);

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
