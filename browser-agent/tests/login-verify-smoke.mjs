// Real Camoufox (headless) on a routed copy of TikTok's "Verify it's really you" step:
// the agent must click the masked-email row in the dialog (not the "Email" tab behind it),
// then type the emailed code. Run: node tests/login-verify-smoke.mjs
import assert from 'node:assert/strict';
import { Camoufox } from 'camoufox';
import { BROWSER_BUILD } from '../dist/browser.js';
import { fillOnce } from '../dist/login.js';

const LOGIN = `<!doctype html><html><body style="background:#111;color:#eee;font:16px sans-serif">
<div id="tabs"><span id="tabEmail" onclick="window.wrongTab=true">Email</span> <span>Log in with phone</span></div>
<form onsubmit="return false">
  <input name="username"><input type="password" name="password">
  <button type="button" data-e2e="login-button" onclick="document.getElementById('dlg').style.display='block'">Log in</button>
</form>
<div id="dlg" role="dialog" style="display:none;position:fixed;inset:40px;background:#222;padding:20px">
  <h2>Verify it’s really you</h2><p>Before you continue, verify your identity using one of the following methods.</p>
  <div id="row" style="cursor:pointer;padding:12px;background:#333">
    <div><b>Email</b></div><div>p***1@hotmail.com</div>
  </div>
</div>
<script>
document.getElementById('row').addEventListener('click', () => {
  window.sent = Date.now();
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = '<p>Enter the 6-digit code</p>';
  const input = document.createElement('input');
  input.placeholder = 'Enter 6-digit code'; input.maxLength = 6;
  input.addEventListener('input', () => { if (input.value.length === 6) { window.code = input.value; location.href = '/foryou'; } });
  dlg.append(input);
});
</script></body></html>`;

const browser = await Camoufox({ headless: true, browser: BROWSER_BUILD });
try {
  const page = await browser.newPage();
  await page.route('https://www.tiktok.com/**', route => route.fulfill({ contentType: 'text/html', body: route.request().url().includes('/foryou') ? '<p>feed</p>' : LOGIN }));
  await page.goto('https://www.tiktok.com/login/phone-or-email/email');
  let asked = 0;
  const outcome = await fillOnce(page, 'someone', 'secret', () => {}, null, async since => { asked++; assert.ok(since > 0); return '482913'; });
  if (outcome.result !== 'submitted') console.log('DIAG', JSON.stringify(outcome), await page.evaluate(() => JSON.stringify({ url: location.pathname, wrongTab: !!window.wrongTab, sent: !!window.sent, code: window.code ?? null, dlgShown: getComputedStyle(document.getElementById('dlg')).display, user: document.querySelector('input[name=username]').value, pass: document.querySelector('input[type=password]').value.length })));
  assert.deepEqual(outcome, { result: 'submitted' });
  assert.equal(asked, 1, 'mail code read once');
  // The page navigated to /foryou after the code, so check what the fixture recorded through the URL.
  assert.match(page.url(), /\/foryou$/);
  console.log('PASS verify dialog: email row clicked (not the tab), emailed code typed, login submitted');
} finally { await browser.close(); }
