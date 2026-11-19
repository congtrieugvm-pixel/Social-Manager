const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const SQLite = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const root = path.resolve(__dirname, '..');
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
class AuthError extends Error { constructor(message, status) { super(message); this.status = status; } }
let db;
const cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const req = name => {
    if (name === './db' || name === '@/lib/db') return { db };
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
    if (name === './auth') return load('src/lib/auth.ts');
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')));
    return require(name);
  };
  new Function('require', 'module', 'exports', compiled)(req, module, module.exports);
  return module.exports;
}
const sqlite = new SQLite(':memory:');
const migrationDir = path.join(root, 'drizzle/migrations');
for (const f of fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(migrationDir, f), 'utf8'));
const schema = load('src/lib/db/schema.ts'); db = drizzle(sqlite, { schema });
const s = load('src/lib/browser-service.ts');
const crypt = load('src/lib/crypto.ts');
let passed = 0;
async function test(name, fn) { await fn(); console.log('PASS', name); passed++; }
const row = table => sqlite.prepare(`SELECT * FROM ${table}`).all();
const req = token => new Request('https://test.invalid', { headers: { Authorization: `Bearer ${token}` } });
(async () => {
  sqlite.exec("INSERT INTO app_users(id,username,password_hash) VALUES (1,'one','x'),(2,'two','x'); INSERT INTO groups(id,owner_user_id,name) VALUES(1,1,'g1'),(2,2,'g2'); INSERT INTO accounts(id,owner_user_id,username,group_id) VALUES(1,1,'alice',1),(2,2,'bob',2),(3,1,'charlie',1)");
  await test('pairing is one-use; device authentication scoped', async () => {
    const pair = await s.createPairing(1);
    global.device = await s.enroll({ code: pair.code, name: 'test', version: '1.0.0' });
    await assert.rejects(s.enroll({ code: pair.code, name: 'again', version: '1' }));
    global.auth = await s.authenticateDevice(req(device.token));
    assert.equal(auth.ownerUserId, 1);
    assert.equal(row('browser_devices')[0].token_hash.includes(device.token), false);
    const expired = await s.createPairing(1); sqlite.exec('UPDATE browser_pairings SET expires_at=0');
    await assert.rejects(s.enroll({ code: expired.code, name: 'expired', version: '1' }));
  });
  await test('proxy precedence, masking, password retention, owner isolation', async () => {
    await s.saveProxy(1, { name: 'test proxy', server: 'http://127.0.0.1:9000', password: 'test-secret' });
    const id = row('browser_proxies')[0].id;
    await s.assign(1, { groupId: 1, proxyId: id });
    assert.equal((await s.effective(1, 1)).source, 'Nhóm');
    await s.assign(1, { ids: [1], mode: 'direct' });
    assert.equal((await s.effective(1, 1)).proxy, null);
    await s.assign(1, { ids: [1], mode: 'custom', proxyId: id });
    assert.equal((await s.effective(1, 1)).source, 'Riêng');
    const before = row('browser_proxies')[0].enc_password;
    await s.saveProxy(1, { id, name: 'renamed', server: 'http://127.0.0.1:9000', password: '' });
    assert.equal(row('browser_proxies')[0].enc_password, before);
    assert.equal(await crypt.decrypt(before), 'test-secret');
    const snapshot = await s.dashboard(1, '', []);
    assert.equal(JSON.stringify(snapshot).includes('test-secret'), false);
    assert.equal(snapshot.proxies[0].encPassword, undefined);
    await assert.rejects(s.assign(2, { ids: [2], mode: 'custom', proxyId: id }));
    await assert.rejects(s.assign(1, { ids: [2], mode: 'direct' }));
    await assert.rejects(s.deleteProxy(1, id));
    await assert.rejects(s.saveProxy(1, { name: 'bad', server: 'socks5://localhost:9000', username: 'u' }));
  });
  await test('offline rejection; duplicate open creates one job; secrets only at claim', async () => {
    await assert.rejects(s.queue(1, { deviceId: 'missing', kind: 'open', ids: [1] }));
    assert.equal((await s.queue(1, { deviceId: device.deviceId, kind: 'open', ids: [1] })).results[0].ok, true);
    await s.queue(1, { deviceId: device.deviceId, kind: 'open', ids: [1] });
    assert.equal(row('browser_jobs').length, 1);
    assert.equal(JSON.stringify(row('browser_jobs')).includes('test-secret'), false);
    const next = await s.sync(auth, { runId: 'run1', capacity: 3 });
    global.job = await s.claim(auth, next.job.id);
    assert.equal(job.proxy.password, 'test-secret');
    assert.ok(job.profileId);
    const retry = await s.sync(auth, { runId: 'run1', capacity: 3 });
    assert.equal(retry.job.id, job.id, 'lost claim response is redelivered');
    assert.equal((await s.claim(auth, retry.job.id)).profileId, job.profileId);
    const acknowledged = await s.sync(auth, { runId: 'run1', capacity: 2, knownJobs: [job.id] });
    assert.equal(acknowledged.job, null); assert.deepEqual(acknowledged.allowed, [job.profileId]);
  });
  await test('changed proxy blocks queued credentials; close and status roundtrip', async () => {
    const p = row('browser_proxies')[0];
    await s.queue(1, { deviceId: device.deviceId, kind: 'open', ids: [3] });
    await s.saveProxy(1, { id: p.id, name: p.name, server: p.server });
    const next = await s.sync(auth, { runId: 'run1', capacity: 2, knownJobs: [job.id] });
    await assert.rejects(s.claim(auth, next.job.id));
    await s.queue(1, { deviceId: device.deviceId, kind: 'close', ids: [1] });
    const close = await s.sync(auth, { runId: 'run1', capacity: 0, knownJobs: [job.id] });
    const cmd = await s.claim(auth, close.job.id); assert.equal(cmd.kind, 'close'); assert.equal(cmd.password, null);
    await s.sync(auth, { runId: 'run1', capacity: 0, reports: [{ jobId: job.id, profileId: job.profileId, status: 'closed' }, { jobId: cmd.id, done: true }] });
    assert.equal(row('browser_profiles')[0].status, 'closed');
  });
  await test('transfer revokes source profile and resets proxy; recipient cannot reuse generation', async () => {
    await s.queue(1, { deviceId: device.deviceId, kind: 'open', ids: [1] });
    const next = await s.sync(auth, { runId: 'run1', capacity: 3 });
    const open = await s.claim(auth, next.job.id);
    sqlite.exec('UPDATE accounts SET owner_user_id=2,group_id=2 WHERE id=1');
    assert.equal(row('accounts').find(a => a.id === 1).browser_proxy_id, null);
    assert.equal(row('browser_profiles')[0].status, 'revoked');
    const revoked = await s.sync(auth, { runId: 'run1', capacity: 0 }); assert.deepEqual(revoked.allowed, []);
    await assert.rejects(s.claim(auth, open.id));
  });
  await test('revoked device cannot authenticate', async () => {
    await s.revokeDevice(1, device.deviceId);
    await assert.rejects(s.authenticateDevice(req(device.token)));
  });
  await test('expired delivery releases queue and restart preserves relocation', async () => {
    const pair = await s.createPairing(1); const d = await s.enroll({ code: pair.code, name: 'recovery', version: '1' });
    let a = await s.authenticateDevice(req(d.token));
    await s.assign(1, { ids: [3], mode: 'direct' });
    await s.queue(1, { deviceId: d.deviceId, kind: 'open', ids: [3] });
    const next = await s.sync(a, { runId: 'old', capacity: 3 });
    const j = await s.claim(a, next.job.id);
    sqlite.prepare('UPDATE browser_jobs SET expires_at=0 WHERE id=?').run(j.id);
    await assert.rejects(s.claim(a, j.id));
    assert.equal(row('browser_jobs').find(r => r.id === j.id).state, 'error');
    sqlite.prepare("UPDATE browser_profiles SET status='closed' WHERE account_id=3").run();
    await s.relocate(1, { accountId: 3, confirmStopped: true });
    a = await s.authenticateDevice(req(d.token));
    await s.sync(a, { runId: 'new', capacity: 0 });
    assert.equal(row('browser_profiles').find(p => p.account_id === 3).status, 'revoked');
  });
  await test('proxy credential whitespace preserved', async () => {
    await s.saveProxy(1, { name: 'spaces', server: 'http://localhost:9999', password: ' secret ' });
    assert.equal(await crypt.decrypt(row('browser_proxies').find(p => p.name === 'spaces').enc_password), ' secret ');
  });
  await test('website password pairs devices under correct owner; failed login creates nothing', async () => {
    const auth = load('src/lib/auth.ts');
    const password = ' synthetic-password ';
    sqlite.prepare('UPDATE app_users SET password_hash=? WHERE id=1').run(await auth.hashPassword(password));
    const before = row('browser_devices').length;
    for (const body of [{ username: 'one', password: 'wrong' }, { username: 'missing', password }]) {
      await assert.rejects(s.loginDevice({ ...body, name: 'fixture', version: '1.0.1' }, 'test-ip'), e => e.status === 401);
    }
    assert.equal(row('browser_devices').length, before);
    const enrolled = await s.loginDevice({ username: 'one', password, name: 'password fixture', version: '1.0.1' }, 'test-ip');
    assert.equal(enrolled.ownerId, 1);
    const repeated = await s.loginDevice({ username: 'one', password, name: 'password fixture', version: '1.0.1', deviceToken: enrolled.token }, 'test-ip');
    assert.equal(repeated.deviceId, enrolled.deviceId);
    assert.equal(row('browser_devices').length, before + 1);
    assert.equal((await s.authenticateDevice(req(enrolled.token))).ownerUserId, 1);
    assert.equal(JSON.stringify(row('browser_devices')).includes(password), false);
    sqlite.exec('UPDATE app_users SET is_active=0 WHERE id=1');
    await assert.rejects(s.loginDevice({ username: 'one', password, name: 'disabled', version: '1' }, 'test-ip'), e => e.status === 401);
    sqlite.exec('UPDATE app_users SET is_active=1 WHERE id=1');
    sqlite.exec('UPDATE browser_login_attempts SET attempts=20');
    await assert.rejects(s.loginDevice({ username: 'one', password, name: 'limited', version: '1' }, 'test-ip'), e => e.status === 429);
  });
  await test('posting config scoped to account/device and commands require verified session', async () => {
    const pair = await s.createPairing(1);
    const enrolled = await s.enroll({ code: pair.code, name: 'posting fixture', version: '1.0.3' });
    const device = await s.authenticateDevice(req(enrolled.token));
    await s.savePosting(1, { ids: [3], deviceId: device.id, folder: 'D:\\Videos', caption: 'Test' });
    await assert.rejects(s.savePosting(1, { ids: [2], deviceId: device.id, folder: 'D:\\Videos' }));
    const denied = await s.queue(1, { deviceId: device.id, kind: 'post', ids: [3] });
    assert.equal(denied.results[0].ok, false);
    await s.queue(1, { deviceId: device.id, kind: 'open', ids: [3] });
    const sync = await s.sync(device, { runId: 'posting-run', capacity: 3 });
    const opened = await s.claim(device, sync.job.id);
    await s.sync(device, { runId: 'posting-run', capacity: 0, knownJobs: [opened.id], reports: [{ jobId: opened.id, profileId: opened.profileId, status: 'logged_in' }] });
    const results = await Promise.all([s.queue(1, { deviceId: device.id, kind: 'post', ids: [3] }), s.queue(1, { deviceId: device.id, kind: 'post', ids: [3] })]);
    assert.equal(results.filter(result => result.results[0].ok).length, 1);
    const delivery = await s.sync(device, { runId: 'posting-run', capacity: 0, knownJobs: [opened.id] });
    const post = await s.claim(device, delivery.job.id);
    assert.equal(post.kind, 'post'); assert.equal(post.folder, 'D:\\Videos'); assert.equal(post.password, null);
    await s.sync(device, { runId: 'posting-run', capacity: 0, knownJobs: [opened.id], reports: [{ jobId: post.id, done: true }] });
    assert.equal(row('browser_jobs').find(j => j.id === post.id).state, 'done');
    assert.equal(row('browser_profiles').find(p => p.account_id === 3).status, 'logged_in');
  });
  console.log(`${passed} browser integration scenarios passed (isolated in-memory SQLite).`);
  sqlite.close();
})().catch(e => { console.error(e); process.exitCode = 1; });
