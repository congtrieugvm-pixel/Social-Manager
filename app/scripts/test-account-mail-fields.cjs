/* Offline integration tests with real SQLite, migrations and account handlers. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const SQLite = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { eq } = require('drizzle-orm');

const root = path.resolve(__dirname, '..');
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.DB_PATH = ':memory:';
let ownerId = 1;
let testDb;
class AuthError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
const modules = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const localRequire = name => {
    if (name === '@/lib/db') return { db: testDb };
    if (name === '@/lib/scope') return {
      getOwnerId: async () => ownerId,
      getCurrentScopedUser: async () => ({ id: ownerId }),
    };
    if (name === '@/lib/auth') return {
      AuthError,
      findUserByUsername: async username => testDb.select().from(schema.appUsers)
        .where(eq(schema.appUsers.username, username)).get(),
    };
    if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`)));
    return require(name);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports;
}

const sqlite = new SQLite(':memory:');
const migrationDir = path.join(root, 'drizzle/migrations');
const migrations = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort();
for (const filename of migrations.filter(f => f < '0014')) {
  sqlite.exec(fs.readFileSync(path.join(migrationDir, filename), 'utf8'));
}
sqlite.exec("INSERT INTO app_users (id, username, password_hash) VALUES (1, 'owner', 'test-only'), (2, 'recipient', 'test-only')");
sqlite.exec("INSERT INTO accounts (id, owner_user_id, username, note) VALUES (1, 1, 'legacy', 'existing note')");
for (const filename of migrations.filter(f => f >= '0014')) {
  sqlite.exec(fs.readFileSync(path.join(migrationDir, filename), 'utf8'));
}
const schema = load('src/lib/db/schema.ts');
testDb = drizzle(sqlite, { schema });
const crypt = load('src/lib/crypto.ts');
const body = load('src/lib/req-body.ts');
const account = load('src/app/api/accounts/[id]/route.ts');
const imports = load('src/app/api/accounts/import/route.ts');
const exportsRoute = load('src/app/api/accounts/export/route.ts');
const transfer = load('src/app/api/accounts/transfer/route.ts');
const list = load('src/app/api/accounts/route.ts');
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error('Unexpected network request in offline test'); };
let passed = 0;
function ctx(id) { return { params: Promise.resolve({ id: String(id) }) }; }
function req(method, payload) {
  return new Request('http://localhost/api/accounts', {
    method, headers: payload ? { 'X-Body': body.encodeBodyHeader(payload) } : {},
  });
}
function row(id) { return testDb.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get(); }
async function detail(id) { return (await account.GET(req('GET'), ctx(id))).json(); }
async function patch(id, values) { return account.PATCH(req('PATCH', values), ctx(id)); }
async function test(name, fn) {
  await fn(); passed++; ownerId = 1; console.log(`PASS ${name}`);
}
const fields = ['username', 'password', 'email', 'twofa', 'emailPassword', 'recoveryEmail', 'mailToken', 'mailClientId'];
const values = {
  recoveryEmail: 'recovery@example.com',
  mailToken: 'token_with+/=symbols_' + 'x'.repeat(1800),
  mailClientId: '00000000-0000-0000-0000-000000000001',
};

(async () => {
  await test('migration preserves existing accounts and defaults new fields to null', async () => {
    const old = await detail(1);
    assert.equal(old.note, 'existing note');
    for (const key of Object.keys(values)) assert.equal(old[key], null);
  });
  await test('local SQLite bootstrap adds all fields and is safe to call again', async () => {
    const { initNodeDb } = load('src/lib/db/node.ts');
    const local = initNodeDb();
    const saved = local.insert(schema.accounts).values({ username: 'local-test', mailClientId: values.mailClientId }).returning().get();
    assert.equal(saved.mailClientId, values.mailClientId);
    assert.equal(saved.encRecoveryEmail, null);
    assert.equal(saved.encMailToken, null);
    assert.equal(initNodeDb(), local);
    local.$client.close();
  });
  await test('save/read preserves full token and client ID; secrets are encrypted at rest', async () => {
    assert.equal((await patch(1, values)).status, 200);
    const saved = row(1);
    assert.notEqual(saved.encRecoveryEmail, values.recoveryEmail);
    assert.notEqual(saved.encMailToken, values.mailToken);
    assert.equal(await crypt.decrypt(saved.encMailToken), values.mailToken);
    const read = await detail(1);
    for (const key of Object.keys(values)) assert.equal(read[key], values[key]);
    assert.equal(read.id, 1);
  });
  await test('unrelated edits preserve mail fields and existing OAuth connection', async () => {
    const oauthToken = await crypt.encrypt('oauth-refresh-token');
    testDb.update(schema.accounts).set({ encMsRefreshToken: oauthToken, msClientId: 'oauth-client', msEmail: 'oauth@example.com' })
      .where(eq(schema.accounts.id, 1)).run();
    await patch(1, { note: 'new note' });
    await patch(1, { mailToken: values.mailToken, mailClientId: values.mailClientId });
    const saved = row(1);
    assert.equal(saved.encMsRefreshToken, oauthToken);
    assert.equal(saved.msClientId, 'oauth-client');
    for (const key of Object.keys(values)) assert.equal((await detail(1))[key], values[key]);
  });
  await test('invalid field types are rejected without a partial update', async () => {
    for (const key of Object.keys(values)) {
      assert.equal((await patch(1, { note: 'must not save', [key]: 123 })).status, 400);
      assert.equal(row(1).note, 'new note');
    }
  });
  await test('another owner cannot read, edit or export mail fields', async () => {
    ownerId = 2;
    assert.equal((await account.GET(req('GET'), ctx(1))).status, 404);
    assert.equal((await patch(1, { mailToken: 'wrong-owner' })).status, 404);
    const exported = await (await exportsRoute.POST(req('POST', { ids: [1], fields }))).json();
    assert.equal(exported.count, 0);
    assert.equal(await crypt.decrypt(row(1).encMailToken), values.mailToken);
  });
  await test('account list does not expose stored mail secrets', async () => {
    const result = await list.GET(req('GET'));
    assert.equal(result.status, 200);
    const text = await result.text();
    assert(!text.includes(values.recoveryEmail));
    assert(!text.includes(values.mailToken));
    assert(!text.includes('encMailToken'));
  });
  await test('8-column import preview and saved data preserve the three fields', async () => {
    const text = ['imported', 'pass', 'mail@example.com', 'SECRET', 'mail-pass', ...Object.values(values)].join('|');
    const payload = { text, order: fields };
    const preview = await (await imports.PUT(req('PUT', payload))).json();
    for (const key of Object.keys(values)) assert.equal(preview.rows[0][key], values[key]);
    const result = await (await imports.POST(req('POST', payload))).json();
    assert.equal(result.inserted, 1);
    const imported = testDb.select().from(schema.accounts).where(eq(schema.accounts.username, 'imported')).get();
    assert.notEqual(imported.encMailToken, values.mailToken);
    for (const key of Object.keys(values)) assert.equal((await detail(imported.id))[key], values[key]);
  });
  await test('old five-column import and default export stay compatible', async () => {
    const text = 'old-format|pass|mail@example.com|SECRET|mail-pass';
    const result = await (await imports.POST(req('POST', { text }))).json();
    assert.equal(result.inserted, 1);
    const saved = testDb.select().from(schema.accounts).where(eq(schema.accounts.username, 'old-format')).get();
    assert.equal(saved.encRecoveryEmail, null);
    assert.equal(saved.encMailToken, null);
    assert.equal(saved.mailClientId, null);
    const exported = await (await exportsRoute.POST(req('POST', { ids: [saved.id] }))).json();
    assert.equal(exported.text, text);
  });
  await test('selected mail columns export in the requested order and can be reimported', async () => {
    const order = ['mailClientId', 'username', 'mailToken', 'recoveryEmail'];
    const result = await (await exportsRoute.POST(req('POST', { ids: [1], fields: order }))).json();
    assert.equal(result.text, [values.mailClientId, 'legacy', values.mailToken, values.recoveryEmail].join('|'));
    ownerId = 2;
    const imported = await (await imports.POST(req('POST', { text: result.text, order }))).json();
    assert.equal(imported.inserted, 1);
    for (const key of Object.keys(values)) assert.equal(imported.rows[0][key], values[key]);
  });
  await test('copy and move retain mail fields for the recipient', async () => {
    const source = testDb.select().from(schema.accounts).where(eq(schema.accounts.username, 'imported')).get();
    const result = await (await transfer.POST(req('POST', { ids: [source.id], toUsername: 'recipient', mode: 'copy' }))).json();
    assert.equal(result.done, 1);
    const copies = testDb.select().from(schema.accounts).where(eq(schema.accounts.username, 'imported')).all();
    assert.equal(copies.length, 2);
    for (const copy of copies) {
      assert.equal(copy.mailClientId, values.mailClientId);
      assert.equal(await crypt.decrypt(copy.encMailToken), values.mailToken);
      assert.equal(await crypt.decrypt(copy.encRecoveryEmail), values.recoveryEmail);
    }
    const movable = testDb.insert(schema.accounts).values({ ...source, id: undefined, username: 'movable' }).returning().get();
    const moved = await (await transfer.POST(req('POST', { ids: [movable.id], toUsername: 'recipient', mode: 'move' }))).json();
    assert.equal(moved.done, 1);
    assert.equal(row(movable.id).ownerUserId, 2);
    assert.equal(await crypt.decrypt(row(movable.id).encMailToken), values.mailToken);
    assert.equal(row(movable.id).mailClientId, values.mailClientId);
  });
  await test('empty strings and null clear saved fields', async () => {
    for (const empty of ['', null]) {
      await patch(1, values);
      const cleared = Object.fromEntries(Object.keys(values).map(key => [key, empty]));
      assert.equal((await patch(1, cleared)).status, 200);
      const read = await detail(1);
      for (const key of Object.keys(values)) assert.equal(read[key], null);
    }
  });
  console.log(`\n${passed} account mail field tests passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { global.fetch = originalFetch; sqlite.close(); });
