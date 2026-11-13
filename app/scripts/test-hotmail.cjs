/* Offline integration tests: real SQLite + real handlers, fake Microsoft HTTP.
 * Run: node scripts/test-hotmail.cjs. Never opens a real mailbox or app DB. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const SQLite = require('better-sqlite3');
const { eq } = require('drizzle-orm');
const { NextRequest } = require('next/server');

const root = path.resolve(__dirname, '..');
process.env.AZURE_CLIENT_ID = 'test-client';
process.env.AZURE_CLIENT_SECRET = 'test-secret';
process.env.AZURE_REDIRECT_URI = 'http://localhost:3000/api/oauth/microsoft/callback';
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
let ownerId = 1;
let testDb;
class AuthError extends Error { constructor(message, status) { super(message); this.status = status; } }
const modules = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = name => {
    if (name === '@/lib/db') return { db: testDb };
    if (name === '@/lib/scope') return { getOwnerId: async () => { if (!ownerId) throw new AuthError('Chưa đăng nhập', 401); return ownerId; } };
    if (name === '@/lib/auth') return { AuthError, SESSION_COOKIE: 'sm_session' };
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
    return require(name);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports;
}
const sqlite = new SQLite(':memory:');
for (const filename of fs.readdirSync(path.join(root, 'drizzle/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  sqlite.exec(fs.readFileSync(path.join(root, 'drizzle/migrations', filename), 'utf8'));
}
const schema = load('src/lib/db/schema.ts');
testDb = drizzle(sqlite, { schema });
sqlite.exec("INSERT OR IGNORE INTO app_users (id, username, password_hash) VALUES (1, 'test_owner', 'test-only'), (2, 'test_other', 'test-only')");
const crypt = load('src/lib/crypto.ts');
const graph = load('src/lib/ms-graph.ts');
const oauth = load('src/lib/ms-oauth.ts');
const otp = load('src/lib/otp-extract.ts');
const client = load('src/lib/hotmail-client.ts');
const http = load('src/lib/ms-http.ts');
const start = load('src/app/api/oauth/microsoft/start/route.ts');
const callback = load('src/app/api/oauth/microsoft/callback/route.ts');
const codes = load('src/app/api/accounts/[id]/hotmail-code/route.ts');
const accountRoute = load('src/app/api/accounts/[id]/route.ts');
const originalFetch = global.fetch;
const disallowNetwork = async () => { throw new Error('Unexpected HTTP request in offline test'); };
global.fetch = disallowNetwork;
let passed = 0;
async function test(name, fn) {
  await fn(); passed++; console.log(`PASS ${name}`);
  global.fetch = disallowNetwork; ownerId = 1;
}
async function account(email = 'owner@hotmail.com') {
  const [row] = await testDb.insert(schema.accounts).values({ ownerUserId: 1,
    username: `test_${Math.random().toString(36).slice(2)}`, encEmail: await crypt.encrypt(email),
  }).returning();
  return row.id;
}
function row(id) { return testDb.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get(); }
function ctx(id) { return { params: Promise.resolve({ id: String(id) }) }; }
function req(url, cookie = 'sm_session=session-A') {
  return new NextRequest(`http://localhost:3000${url}`, { headers: { cookie } });
}
async function attempt(id) {
  const response = await start.GET(req(`/api/oauth/microsoft/start?accountId=${id}`));
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get('location'));
  const nonce = location.searchParams.get('state');
  const cookie = response.cookies.get(oauth.oauthCookieName(nonce));
  return { nonce, location, cookie: `sm_session=session-A; ${cookie.name}=${cookie.value}` };
}
function microsoft(mail = 'owner@hotmail.com') {
  global.fetch = async url => {
    if (String(url).includes('/token')) return Response.json({ access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 3600 });
    if (String(url).includes('/me?')) return Response.json({ mail });
    throw new Error('Unexpected fake Microsoft endpoint');
  };
}
async function connectAccount(id) {
  await graph.saveAccountTokens(id, 1, { access_token: 'access-old', refresh_token: 'refresh-old', expires_in: 3600 }, row(id).msTokenVersion, 'owner@hotmail.com');
}
function message(overrides = {}) {
  return { id: 'mail-1', subject: 'Your TikTok verification code is 123456', bodyPreview: '',
    from: { emailAddress: { address: 'noreply@account.tiktok.com' } },
    receivedDateTime: new Date().toISOString(), ...overrides };
}

(async () => {
  await test('migrations apply and new fields default safely', async () => {
    const r = row(await account()); assert.equal(r.msTokenVersion, 0); assert.equal(r.msClientId, null);
  });
  await test('PKCE, email hint, encrypted HttpOnly cookie and session binding', async () => {
    const id = await account(); const a = await attempt(id);
    assert.equal(a.location.searchParams.get('login_hint'), 'owner@hotmail.com');
    assert.equal(a.location.searchParams.get('code_challenge_method'), 'S256');
    assert(!a.location.toString().includes('session-A'));
    const cookieValue = a.cookie.split('; ')[1].split('=').slice(1).join('=');
    const state = await oauth.readOAuthAttempt(cookieValue, a.nonce, 1, 'session-A');
    assert.equal(a.location.searchParams.get('code_challenge'), await oauth.sha256(state.verifier));
    await assert.rejects(oauth.readOAuthAttempt(cookieValue, a.nonce, 2, 'session-A'));
    await assert.rejects(oauth.readOAuthAttempt(cookieValue, a.nonce, 1, 'session-B'));
    const expired = await oauth.sealOAuthAttempt({ ...state, expiresAt: 1 });
    await assert.rejects(oauth.readOAuthAttempt(expired, a.nonce, 1, 'session-A'));
  });
  await test('callback saves encrypted tokens once and rejects replay', async () => {
    const id = await account(); const a = await attempt(id); microsoft();
    const url = `/api/oauth/microsoft/callback?state=${a.nonce}&code=auth-code`;
    const response = await callback.GET(req(url, a.cookie));
    assert.equal(response.status, 200); assert.match(await response.text(), /Đã lưu token/);
    const saved = row(id);
    assert.equal(await crypt.decrypt(saved.encMsRefreshToken), 'refresh-new');
    assert.notEqual(saved.encMsRefreshToken, 'refresh-new');
    assert.equal(saved.msClientId, 'test-client'); assert.equal(saved.msOAuthNonce, null);
    assert.equal((await callback.GET(req(url, a.cookie))).status, 409);
  });
  await test('wrong mailbox does not overwrite an existing connection', async () => {
    const id = await account(); await connectAccount(id); const before = row(id).encMsRefreshToken;
    const a = await attempt(id); microsoft('someone-else@hotmail.com');
    const response = await callback.GET(req(`/api/oauth/microsoft/callback?state=${a.nonce}&code=c`, a.cookie));
    assert.equal(response.status, 400); assert.equal(row(id).encMsRefreshToken, before);
  });
  await test('OAuth callback rejects a different session without consuming valid state', async () => {
    const id = await account(); const a = await attempt(id); microsoft();
    const response = await callback.GET(req(`/api/oauth/microsoft/callback?state=${a.nonce}&code=c`, a.cookie.replace('session-A', 'session-B')));
    assert.equal(response.status, 400); assert.equal(row(id).msOAuthNonce, a.nonce);
  });
  await test('consent denial returns the correct account and does not reflect upstream HTML', async () => {
    const id = await account(); const a = await attempt(id);
    const response = await callback.GET(req(`/api/oauth/microsoft/callback?state=${a.nonce}&error=access_denied&error_description=%3Cscript%3E`, a.cookie));
    const text = await response.text(); assert.match(text, new RegExp(`"accountId":${id}`));
    assert(!text.includes('<p><script>')); assert.equal(row(id).encMsRefreshToken, null);
    const html = oauth.oauthResultHtml({ ok: false, accountId: id, message: '</script><script>alert(1)</script>' });
    assert(!html.includes('</script><script>alert')); assert(html.includes('\\u003c/script>'));
  });
  await test('changed email invalidates tokens and pending OAuth state', async () => {
    const id = await account(); await connectAccount(id); await attempt(id);
    const response = await accountRoute.PATCH(new Request('http://localhost', { method: 'PATCH', headers: { 'x-body': JSON.stringify({ email: 'new@hotmail.com' }) } }), ctx(id));
    assert.equal(response.status, 200); const saved = row(id);
    assert.equal(saved.encMsRefreshToken, null); assert.equal(saved.msOAuthNonce, null); assert.equal(saved.msEmail, null);
  });
  await test('access token cache avoids refresh; expired token rotates and coalesces', async () => {
    const id = await account(); await connectAccount(id);
    assert.equal(await graph.getValidAccessToken(id, 1), 'access-old');
    await testDb.update(schema.accounts).set({ msTokenExpiresAt: 0 }).where(eq(schema.accounts.id, id));
    let calls = 0;
    global.fetch = async () => { calls++; await new Promise(r => setTimeout(r, 5)); return Response.json({ access_token: 'new-access', refresh_token: 'rotated-refresh', expires_in: 3600 }); };
    const results = await Promise.all([graph.getValidAccessToken(id, 1), graph.getValidAccessToken(id, 1)]);
    assert.deepEqual(results, ['new-access', 'new-access']); assert.equal(calls, 1);
    assert.equal(await crypt.decrypt(row(id).encMsRefreshToken), 'rotated-refresh');
  });
  await test('refresh without a new refresh_token preserves existing refresh token', async () => {
    const id = await account(); await connectAccount(id);
    global.fetch = async () => Response.json({ access_token: 'new-access', expires_in: 3600 });
    await graph.getValidAccessToken(id, 1, 'access-old');
    assert.equal(await crypt.decrypt(row(id).encMsRefreshToken), 'refresh-old');
  });
  await test('disconnect prevents an in-flight refresh from restoring credentials', async () => {
    const id = await account(); await connectAccount(id);
    let release; let entered;
    const started = new Promise(r => { entered = r; });
    global.fetch = async () => { entered(); return new Promise(r => { release = () => r(Response.json({ access_token: 'late', refresh_token: 'late', expires_in: 3600 })); }); };
    const refreshing = graph.getValidAccessToken(id, 1, 'access-old');
    await started; await graph.clearAccountTokens(id, 1); release();
    await assert.rejects(refreshing); assert.equal(row(id).encMsRefreshToken, null);
  });
  await test('invalid_client and temporary errors never erase tokens', async () => {
    const id = await account(); await connectAccount(id);
    await testDb.update(schema.accounts).set({ msTokenExpiresAt: 0 }).where(eq(schema.accounts.id, id));
    for (const [code, status] of [['invalid_client', 400], ['temporarily_unavailable', 503], ['invalid_grant', 400]]) {
      global.fetch = async () => Response.json({ error: code, error_description: 'private-secret' }, { status });
      const response = await codes.POST(new Request('http://localhost', { method: 'POST' }), ctx(id));
      const body = await response.json(); assert(!JSON.stringify(body).includes('private-secret'));
      assert.equal(!!body.needsAuth, code === 'invalid_grant'); assert(row(id).encMsRefreshToken);
    }
  });
  await test('Graph 401 refreshes once, then returns code from Inbox or Junk', async () => {
    const id = await account(); await connectAccount(id); let refreshes = 0;
    global.fetch = async (url, init) => {
      if (String(url).includes('/token')) { refreshes++; return Response.json({ access_token: 'retry-access', refresh_token: 'refresh-next', expires_in: 3600 }); }
      if (init.headers.Authorization === 'Bearer access-old') return Response.json({ error: { code: 'InvalidAuthenticationToken' } }, { status: 401 });
      assert(String(url).includes('%24filter=receivedDateTime'));
      return Response.json({ value: String(url).includes('junkemail') ? [message()] : [] });
    };
    const response = await codes.POST(new Request('http://localhost', { method: 'POST' }), ctx(id));
    assert.equal(response.status, 200); assert.equal((await response.json()).code, '123456'); assert.equal(refreshes, 1);
  });
  await test('wrong owner cannot get code or disconnect', async () => {
    const id = await account(); await connectAccount(id); ownerId = 2;
    assert.equal((await codes.POST(new Request('http://localhost', { method: 'POST' }), ctx(id))).status, 404);
    assert.equal((await codes.DELETE(new Request('http://localhost'), ctx(id))).status, 404);
    assert(row(id).encMsRefreshToken);
  });
  await test('no mail is pending and throttling respects Retry-After', async () => {
    const id = await account(); await connectAccount(id);
    global.fetch = async () => Response.json({ value: [] });
    assert.equal((await codes.POST(new Request('http://localhost', { method: 'POST' }), ctx(id))).status, 202);
    global.fetch = async () => Response.json({ error: { code: 'TooManyRequests' } }, { status: 429, headers: { 'Retry-After': '17' } });
    const response = await codes.POST(new Request('http://localhost', { method: 'POST' }), ctx(id));
    assert.equal(response.status, 429); assert.equal((await response.json()).retryAfterSeconds, 17);
  });
  await test('parser rejects unrelated numbers, spoofed domains, stale and future mail', async () => {
    const bad = [
      message({ subject: 'Order 654321 confirmed', from: { emailAddress: { address: 'shop@example.com' } } }),
      message({ from: { emailAddress: { address: 'noreply@tiktok.com.evil.test', name: 'TikTok' } } }),
      message({ receivedDateTime: new Date(Date.now() - 12 * 60_000).toISOString() }),
      message({ receivedDateTime: new Date(Date.now() + 3600_000).toISOString() }),
      message({ subject: 'Order 654321 confirmed' }),
      message({ subject: 'Your TikTok Shop discount code is 654321' }),
      message({ subject: 'Your barcode 654321' }),
      message({ subject: 'Verification code 123456 or verification code 654321' }),
    ];
    for (const m of bad) assert.equal(otp.pickLatestOtp([m]), null);
    assert.equal(otp.pickLatestOtp([message({ subject: 'Ticket 987654', bodyPreview: 'Your verification code is 123456' })]).code, '123456');
    assert.equal(otp.pickLatestOtp([message({ subject: '123456 is your verification code' })]).code, '123456');
    assert.equal(otp.pickLatestOtp([message({ subject: '', body: { contentType: 'html', content: '<b>Mã xác minh:</b> &#49;23456' } })]).code, '123456');
  });
  await test('parser excludes previously returned message and earlier mail', async () => {
    const old = message({ id: 'old', receivedDateTime: new Date(Date.now() - 3000).toISOString() });
    const fresh = message();
    assert.equal(otp.pickLatestOtp([old, fresh], { afterMessageId: fresh.id, afterReceivedAt: Date.parse(fresh.receivedDateTime) }), null);
    assert.equal(otp.pickLatestOtp([old, fresh], { afterMessageId: old.id, afterReceivedAt: Date.parse(old.receivedDateTime) }).messageId, fresh.id);
  });
  await test('client waits for delayed mail, forwards watermark and handles cancellation', async () => {
    let now = 0; let calls = 0; const delays = [];
    const previous = { messageId: 'old', receivedAt: new Date().toISOString() };
    const result = await client.pollHotmailCode(1, { signal: new AbortController().signal, previous, onWaiting() {} }, {
      now: () => now, sleep: async ms => { now += ms; delays.push(ms); },
      request: async (_id, body) => { assert.equal(body.afterMessageId, 'old'); calls++;
        return calls === 1 ? Response.json({ retryable: true, retryAfterSeconds: 7 }, { status: 429 })
          : calls === 2 ? Response.json({ pending: true, retryAfterSeconds: 3 }, { status: 202 })
          : Response.json({ code: '123456', messageId: 'new', receivedAt: new Date().toISOString() }); },
    });
    assert.equal(result.code, '123456'); assert.deepEqual(delays, [7000, 3000]);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(client.pollHotmailCode(1, { signal: aborted.signal, onWaiting() {} }));
  });
  await test('client stops after 60 seconds and never ignores a long Retry-After', async () => {
    let now = 0; let calls = 0;
    await assert.rejects(client.pollHotmailCode(1, { signal: new AbortController().signal, onWaiting() {} }, {
      now: () => now, sleep: async ms => { now += ms; },
      request: async () => { calls++; return Response.json({ pending: true, retryAfterSeconds: 3 }, { status: 202 }); },
    }), /60 giây/);
    assert(calls <= 20);
    await assert.rejects(client.pollHotmailCode(1, { signal: new AbortController().signal, onWaiting() {} }, {
      now: () => 0, sleep: async () => assert.fail('must not retry early'),
      request: async () => Response.json({ retryable: true, retryAfterSeconds: 120, error: 'rate limited' }, { status: 429 }),
    }), /rate limited/);
  });
  await test('Microsoft HTTP errors are classified without parsing descriptive strings', async () => {
    assert.equal(http.requiresMicrosoftAuth(new http.MicrosoftError('AADSTS server error', 'invalid_client', 400)), false);
    assert.equal(http.requiresMicrosoftAuth(new http.MicrosoftError('revoked', 'invalid_grant', 400)), true);
  });
  console.log(`\n${passed} Hotmail checks passed (offline; no real Microsoft login).`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch; sqlite.close();
});
