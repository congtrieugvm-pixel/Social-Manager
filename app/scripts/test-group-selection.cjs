const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const SQLite = require('better-sqlite3');
const { chromium } = require('playwright');

(async () => {
  // Use only the dedicated test database used by the port 3107 dev server.
  const db = new SQLite(path.join(os.tmpdir(), 'social-manager-ui-browser-test.db'));
  const owner = db.prepare("SELECT id FROM app_users WHERE username='admin'").get().id;
  const stamp = Date.now();
  const insertGroup = db.prepare('INSERT INTO groups(owner_user_id,name) VALUES(?,?)');
  const first = Number(insertGroup.run(owner, `Selection A ${stamp}`).lastInsertRowid);
  const second = Number(insertGroup.run(owner, `Selection B ${stamp}`).lastInsertRowid);
  const other = Number(db.prepare('INSERT INTO app_users(username,password_hash) VALUES(?,?)').run(`fixture${stamp}`, 'unused').lastInsertRowid);
  const foreignGroup = Number(insertGroup.run(other, `Foreign ${stamp}`).lastInsertRowid);
  const insert = db.prepare('INSERT INTO accounts(owner_user_id,username,group_id) VALUES(?,?,?)');
  for (let i = 0; i < 55; i++) insert.run(owner, `fixture_${stamp}_${i}`, first);
  insert.run(owner, `fixture_${stamp}_b`, second);
  insert.run(other, `foreign_${stamp}`, foreignGroup);
  db.close();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const base = 'http://localhost:3107';
    assert.equal((await context.request.post(base + '/api/auth/login', { headers: { 'X-Auth-Username': 'admin', 'X-Auth-Password': 'BrowserFixtureOnly-238x' } })).status(), 200);
    const select = async groups => context.request.post(base + '/api/accounts/selection', { headers: { 'X-Body': JSON.stringify({ groups }) } });
    assert.equal((await (await select([first, second])).json()).ids.length, 56);
    assert.deepEqual((await (await select([foreignGroup])).json()).ids, []);
    assert.equal((await select(['invalid'])).status(), 400);
    const page = await context.newPage();
    await page.goto(base);
    const picker = page.locator('.tt-group-picker');
    await picker.locator('summary').click();
    await picker.getByLabel(`Selection A ${stamp}`, { exact: true }).check();
    await picker.getByLabel(`Selection B ${stamp}`, { exact: true }).check();
    await picker.getByRole('button', { name: 'Chọn tài khoản', exact: true }).click();
    await page.locator('.tt-selcount b').filter({ hasText: '56' }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await picker.locator('summary').click();
    const box = await picker.locator('.menu-pop').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 390, 'group menu fits phone viewport');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.goto(base + '/browser');
    await page.getByRole('heading', { name: 'Proxy & trình duyệt', exact: true }).waitFor();
    assert.equal(await page.locator('#connect-guide').count(), 0);
    assert.equal(await page.getByText('Ghép máy bằng tài khoản website', { exact: true }).count(), 0);
    console.log('PASS group selection across pages, multiple groups, owner isolation, invalid input, mobile menu and removed instructions.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
