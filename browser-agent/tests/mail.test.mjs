import test from 'node:test';
import assert from 'node:assert/strict';
import { latestCode, codeInMail } from '../dist/mailcode.js';
import { readRecentMail, toMail } from '../dist/imap.js';
import { fviaAddress, fviaMessages, authorizeUrl, pkce } from '../dist/mailauth.js';

test('code extraction: cue words win, length is enforced, newest sender match chosen', () => {
  assert.equal(codeInMail({ subject: '482913 is your TikTok verification code', text: 'Welcome' }), '482913');
  assert.equal(codeInMail({ text: 'Mã xác minh của bạn là 100294. Hết hạn sau 5 phút.' }), '100294');
  assert.equal(codeInMail({ text: 'Order 20260101 shipped. Your code: 774820 thanks' }), '774820');
  assert.equal(codeInMail({ text: 'no code here' }), null);
  const mails = [
    { from: 'noreply@tiktok.com', subject: 'TikTok', text: 'code 111222', date: 'Fri, 20 Nov 2026 10:00:00 +0000' },
    { from: 'noreply@tiktok.com', subject: 'TikTok', text: 'code 333444', date: 'Fri, 20 Nov 2026 10:05:00 +0000' },
    { from: 'promo@shop.com', text: 'code 999999', date: 'Fri, 20 Nov 2026 11:00:00 +0000' },
  ];
  assert.equal(latestCode(mails, { sender: 'tiktok', digits: 6 }), '333444');
  assert.equal(latestCode(mails, { sender: 'tiktok', since: Date.parse('Fri, 20 Nov 2026 10:02:00 +0000') }), '333444');
  assert.equal(latestCode(mails, { sender: 'microsoft' }), null);
});

test('IMAP XOAUTH2: greeting, auth, SELECT, FETCH with a literal body', async () => {
  const msg = ['From: TikTok <noreply@account.tiktok.com>', 'Subject: 653201 is your verification code', 'Date: Fri, 20 Nov 2026 10:00:00 +0000',
    'Content-Type: text/plain; charset=utf-8', '', 'Your code is 653201. Do not share it.'].join('\r\n');
  const written = [];
  const script = [
    { match: null, data: '* OK IMAP4 ready\r\n' },
    { match: /AUTHENTICATE XOAUTH2/, data: 'AUTH OK AUTHENTICATE completed\r\n' },
    { match: /SELECT INBOX/, data: '* 1 EXISTS\r\na1 OK [READ-WRITE] SELECT completed\r\n' },
    { match: /FETCH 1:1 BODY/, data: `* 1 FETCH (BODY[] {${msg.length}}\r\n${msg})\r\na2 OK FETCH completed\r\n` },
  ];
  let dataCb;
  const connector = async () => ({
    write: line => { written.push(line); const s = script.find(x => x.match && x.match.test(line) && !x.done); if (s) { s.done = true; setImmediate(() => dataCb(Buffer.from(s.data, 'binary'))); } },
    on: (ev, cb) => { if (ev === 'data') { dataCb = cb; setImmediate(() => dataCb(Buffer.from(script[0].data, 'binary'))); } },
    end: () => {},
  });
  const raw = await readRecentMail('user@hotmail.com', 'ya29.token', 1, connector);
  assert.equal(raw.length, 1);
  const mail = toMail(raw[0]);
  assert.match(mail.from, /tiktok/i);
  assert.equal(latestCode([mail], { sender: 'tiktok' }), '653201');
  assert.ok(written.some(l => /AUTHENTICATE XOAUTH2 /.test(l)), 'sent XOAUTH2');
});

test('IMAP decodes a quoted-printable multipart body', () => {
  const raw = { headers: 'From: a@b.c\r\nSubject: =?utf-8?Q?M=C3=A3_x=C3=A1c_minh?=\r\nContent-Type: multipart/alternative; boundary="X"',
    body: ['--X', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', 'M=C3=A3 c=E1=BB=A7a b=E1=BA=A1n: 220931=', '', '--X--'].join('\r\n') };
  const mail = toMail(raw);
  assert.match(mail.subject, /Mã xác minh/);
  assert.equal(codeInMail(mail), '220931');
});

test('fvia recovery address parsing and inbox fetch', async () => {
  assert.deepEqual(fviaAddress('Cool.Name99@fviainboxes.com'), { user: 'cool.name99', domain: 'fviainboxes.com' });
  assert.equal(fviaAddress('someone@gmail.com'), null);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => { assert.match(String(url), /fviainboxes\.com\/messages\?username=bob&domain=fviainboxes\.com/); return { ok: true, json: async () => ({ result: [{ subject: 'Microsoft account security code', body: 'Security code: 7781234' }] }) }; };
  try {
    const msgs = await fviaMessages('bob', 'fviainboxes.com');
    assert.equal(latestCode(msgs, { sender: 'microsoft', digits: 7 }), '7781234');
  } finally { globalThis.fetch = realFetch; }
});

test('authorize URL carries PKCE, login hint and the IMAP scope', () => {
  const { verifier, challenge } = pkce();
  assert.notEqual(verifier, challenge);
  const u = new URL(authorizeUrl('me@hotmail.com', challenge, 'state123'));
  assert.equal(u.searchParams.get('login_hint'), 'me@hotmail.com');
  assert.equal(u.searchParams.get('code_challenge'), challenge);
  assert.match(u.searchParams.get('scope'), /IMAP\.AccessAsUser\.All/);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
});

import { ensureMailAccess, pollTikTokCode } from '../dist/maillogin.js';

test('ensureMailAccess: redeem stored token, else browser login; no creds fails', async () => {
  const stored = { email: 'a@hotmail.com', mailPassword: 'p', recoveryEmail: 'r@fviainboxes.com', refreshToken: 'RT', clientId: 'CID' };
  let refreshed = 0, logged = 0;
  const deps = { refresh: async (rt, cid) => { refreshed++; assert.equal(rt, 'RT'); assert.equal(cid, 'CID'); return { accessToken: 'AT', refreshToken: 'RT2', expiresAt: 0 }; },
    login: async () => { logged++; return { accessToken: 'NEW', refreshToken: 'RT_NEW', expiresAt: 0 }; } };
  let r = await ensureMailAccess({}, stored, () => {}, deps);
  assert.equal(r.accessToken, 'AT'); assert.equal(r.tokens, undefined); assert.equal(refreshed, 1); assert.equal(logged, 0);

  const dead = { ...deps, refresh: async () => { throw new Error('invalid_grant'); } };
  r = await ensureMailAccess({}, stored, () => {}, dead);
  assert.equal(r.accessToken, 'NEW'); assert.equal(r.tokens.refreshToken, 'RT_NEW'); assert.equal(logged, 1);

  await assert.rejects(ensureMailAccess({}, { ...stored, refreshToken: null, clientId: null, mailPassword: null }, () => {}, deps), /MAIL_NO_PASSWORD/);
});

test('pollTikTokCode returns the newest TikTok code from the inbox', async () => {
  const since = Date.parse('Fri, 20 Nov 2026 10:00:00 +0000');
  let calls = 0;
  const read = async () => { calls++; return calls < 2 ? [] : [{ headers: 'From: noreply@tiktok.com\r\nSubject: code\r\nDate: Fri, 20 Nov 2026 10:01:00 +0000', body: 'Your code is 445566' }]; };
  const code = await pollTikTokCode('a@hotmail.com', 'AT', since, () => {}, read);
  assert.equal(code, '445566');
});
