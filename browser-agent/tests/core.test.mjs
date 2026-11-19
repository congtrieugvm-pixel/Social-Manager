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
test('form fixture fills and submits once, declines ambiguous/missing forms', async () => {
  let clicks = 0, fills = [];
  const page = { url: () => 'https://www.tiktok.com/login', locator: selector => ({ count: async () => 1, isVisible: async () => true, isEnabled: async () => true, fill: async value => fills.push([selector, value]), click: async () => clicks++ }) };
  await fillOnce(page, 'alice', 'secret'); assert.equal(clicks, 1); assert.equal(fills.length, 2);
  await fillOnce(page, 'alice', null); assert.equal(clicks, 1);
  await fillOnce({ ...page, url: () => 'https://other.example/login' }, 'alice', 'secret'); assert.equal(clicks, 1);
  await fillOnce({ ...page, locator: () => ({ count: async () => 2 }) }, 'alice', 'secret'); assert.equal(clicks, 1);
});
test('Windows DPAPI round trip', { skip: process.platform !== 'win32' }, async () => {
  const encrypted = await dpapi('synthetic-test-token');
  assert.notEqual(encrypted, Buffer.from('synthetic-test-token').toString('base64'));
  assert.equal(Buffer.from(await dpapi(encrypted, true), 'base64').toString(), 'synthetic-test-token');
});
