const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    const base = 'http://localhost:3107';
    assert.equal((await context.request.post(base + '/api/auth/login', { headers: { 'X-Auth-Username': 'admin', 'X-Auth-Password': 'BrowserFixtureOnly-238x' } })).status(), 200);
    const now = Math.floor(Date.now() / 1000);
    const fixture = {
      owner: 1, now,
      accounts: [
        { id: 101, username: 'studio.vietnam', groupId: 1, mode: 'inherit', proxyId: null },
        { id: 102, username: 'daily.travel', groupId: 1, mode: 'custom', proxyId: 1 },
        { id: 103, username: 'home.and.living', groupId: 2, mode: 'direct', proxyId: null },
      ],
      devices: [{ id: 'windows', name: 'Windows Studio', version: '1.0.3', lastSeenAt: now, revoked: 0 }],
      groups: [{ id: 1, name: 'Nội dung Việt Nam', proxyId: 1 }, { id: 2, name: 'Kênh thương hiệu', proxyId: null }],
      proxies: [{ id: 1, name: 'Vietnam · Studio', server: 'http://proxy.example:8080', revision: 1, enabled: 1, hasPassword: true }],
      profiles: [
        { accountId: 101, deviceId: 'windows', status: 'logged_in', updatedAt: now, proxyLabel: 'Nhóm: Vietnam · Studio' },
        { accountId: 102, deviceId: 'windows', status: 'needs_verification', updatedAt: now, proxyLabel: 'Riêng: Vietnam · Studio' },
      ],
      posting: [{ accountId: 101, deviceId: 'windows', folder: 'D:\\TikTok\\Vietnam', caption: '' }],
      jobs: [{ id: 'history', kind: 'open', accountId: 101, state: 'running', createdAt: now }],
      checks: [{ proxyId: 1, deviceId: 'windows', revision: 1, ip: '203.0.113.10', latency: 87 }],
    };
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const openRequests = [];
    await page.route('**/api/browser/jobs', route => {
      const body = JSON.parse(route.request().headers()['x-body']);
      openRequests.push(body);
      return route.fulfill({ json: { results: body.ids.map(id => ({ id, ok: true })) } });
    });
    await page.route('**/api/browser/dashboard?*', route => route.fulfill({ json: fixture }));
    fixture.devices[0].lastSeenAt = now - 120;
    await page.goto(base + '/browser');
    await page.getByRole('checkbox', { name: 'Chọn studio.vietnam', exact: true }).check();
    const openButton = page.getByRole('button', { name: 'Mở trình duyệt', exact: true });
    assert.equal(await openButton.isDisabled(), true);
    await page.getByText('Máy Windows chưa online. Mở Setup trên máy Windows để kết nối lại.', { exact: true }).waitFor();
    fixture.devices[0].lastSeenAt = now;
    await page.getByRole('button', { name: 'Làm mới trạng thái' }).click();
    await openButton.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Mở trình duyệt' && !button.disabled));
    assert.equal(await page.getByLabel('Máy chạy', { exact: true }).inputValue(), 'windows');
    await openButton.click();
    await page.getByRole('status').filter({ hasText: 'Đã gửi lệnh' }).waitFor();
    assert.deepEqual(openRequests[0].ids, [101]);
    assert.equal(openRequests[0].deviceId, 'windows');
    await page.getByRole('button', { name: 'Bỏ chọn', exact: true }).click();
    const rowRefresh = page.waitForResponse(response => response.url().endsWith('/api/browser/dashboard?'));
    await page.getByRole('button', { name: 'Mở trình duyệt studio.vietnam', exact: true }).click();
    await rowRefresh;
    assert.deepEqual(openRequests[1].ids, [101]);
    await page.getByRole('checkbox', { name: 'Chọn studio.vietnam', exact: true }).check();
    const nav = page.getByRole('navigation', { name: 'Quản lý trình duyệt' });
    const dir = path.resolve(__dirname, '../../dist/tests'); await fs.mkdir(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'browser-accounts-redesign.png'), fullPage: true });
    await nav.getByRole('button', { name: 'Đăng bài', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Đăng video tiếp theo' }).isEnabled(), true);
    await page.getByText('Sẵn sàng đăng', { exact: true }).waitFor();
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        for (const section of ['Tài khoản', 'Đăng bài', 'Proxy', 'Máy Windows', 'Lịch sử']) {
          await nav.getByRole('button', { name: section, exact: true }).click();
          await page.waitForFunction(() => document.querySelector('#app-sidebar').getBoundingClientRect().right <= 1 || innerWidth > 1024);
          const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
          assert.ok(dimensions.scroll <= dimensions.width, `${width}px ${theme} ${section} overflow ${JSON.stringify(dimensions)}`);
        }
        await nav.getByRole('button', { name: 'Đăng bài', exact: true }).click();
        if (width === 375 || width === 1440) await page.screenshot({ path: path.join(dir, `browser-posting-${width}-${theme}.png`), fullPage: true });
      }
    }
    fixture.proxies[0].enabled = 0;
    await page.getByRole('button', { name: 'Làm mới trạng thái' }).click();
    await page.getByText('Proxy đã tắt', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Đăng video tiếp theo' }).isDisabled(), true);
    fixture.proxies[0].enabled = 1;
    fixture.devices[0].lastSeenAt = now - 120;
    await page.getByRole('button', { name: 'Làm mới trạng thái' }).click();
    await page.getByText('Máy đang offline', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Đăng video tiếp theo' }).isDisabled(), true);
    fixture.devices[0].revoked = 1;
    fixture.devices.push({ id: 'other', name: 'Other Windows', version: '1.0.3', lastSeenAt: now, revoked: 0 });
    await page.getByRole('button', { name: 'Làm mới trạng thái' }).click();
    await page.getByRole('option', { name: 'Máy đã ngắt kết nối — chọn lại máy' }).waitFor({ state: 'attached' });
    assert.equal(await page.getByLabel('Máy chạy', { exact: true }).inputValue(), 'windows', 'revocation must not change posting target');
    assert.deepEqual(errors, []);
    console.log('PASS 4 viewport widths, 2 themes, all 5 sections, ready/offline posting states and zero browser errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
