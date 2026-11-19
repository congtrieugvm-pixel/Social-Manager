const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const login = await context.request.post('http://localhost:3107/api/auth/login', { headers: { 'X-Auth-Username': 'admin', 'X-Auth-Password': 'BrowserFixtureOnly-238x' } });
    assert.equal(login.status(), 200);
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:3107/browser');
    await page.getByRole('heading', { name: 'Proxy & trình duyệt', exact: true }).waitFor();
    const navigation = page.getByRole('navigation', { name: 'Quản lý trình duyệt' });
    await navigation.getByRole('button', { name: 'Proxy', exact: true }).click();
    await page.getByRole('button', { name: 'Thêm proxy', exact: true }).click();
    const proxyName = 'UI fixture proxy ' + Date.now();
    await page.getByLabel('Tên', { exact: true }).fill(proxyName);
    await page.getByLabel('Địa chỉ', { exact: true }).fill('http://127.0.0.1:9999');
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.locator('b').filter({ hasText: proxyName }).first().waitFor();
    assert.equal(await page.locator('#connect-guide').count(), 0);
    const agentLogin = await context.request.post('http://localhost:3107/api/browser/agent/login', {
      headers: { 'X-Body': JSON.stringify({ username: 'admin', password: 'BrowserFixtureOnly-238x', name: 'UI login fixture', version: '1.0.1' }) },
    });
    assert.equal(agentLogin.status(), 200);
    const device = await agentLogin.json();
    const heartbeat = await context.request.post('http://localhost:3107/api/browser/agent/sync', {
      headers: { Authorization: `Bearer ${device.token}`, 'X-Body': JSON.stringify({ runId: 'ui-login-test', capacity: 0 }) },
    });
    assert.equal(heartbeat.status(), 200);
    await navigation.getByRole('button', { name: 'Máy Windows', exact: true }).click();
    await page.locator('div[class*="deviceInfo"]').filter({ hasText: 'UI login fixture' }).first().waitFor();
    const groupsResponse = await context.request.get('http://localhost:3107/api/groups');
    const group = (await groupsResponse.json()).groups.find(group => group.count > 0 && group.count <= 20);
    if (group) {
      await page.getByLabel('Máy chạy', { exact: true }).selectOption(device.deviceId);
      await navigation.getByRole('button', { name: 'Đăng bài', exact: true }).click();
      await page.getByLabel('Chọn theo nhóm', { exact: true }).selectOption(String(group.id));
      await page.getByLabel('Thư mục video trên máy Windows').fill('D:\\FixtureVideos');
      await page.getByRole('button', { name: /Gán thư mục cho/ }).click();
      await page.getByRole('cell', { name: 'D:\\FixtureVideos', exact: true }).first().waitFor();
      assert.equal(await page.getByRole('button', { name: 'Đăng video tiếp theo', exact: true }).isDisabled(), true);
      await page.getByText('Cần Windows 1.0.3 trở lên', { exact: true }).first().waitFor();
    }
    const dir = path.resolve(__dirname, '../../dist/tests'); await fs.mkdir(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'browser-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('#app-sidebar').getBoundingClientRect().right <= 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile page must not overflow');
    await page.screenshot({ path: path.join(dir, 'browser-mobile.png'), fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log('PASS UI: authenticated page, proxy save, password pairing + sync, desktop/mobile, no page errors.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
