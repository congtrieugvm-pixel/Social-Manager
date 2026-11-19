// Diagnostic (no credentials typed): how TikTok's email login form appears over
// time in Camoufox, and whether the agent's selectors match it.
import { Camoufox } from 'camoufox';
import { BROWSER_BUILD } from '../dist/browser.js';

const URL = 'https://www.tiktok.com/login/phone-or-email/email';
const browser = await Camoufox({ headless: true, browser: BROWSER_BUILD });
try {
  const page = await browser.newPage();
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (const wait of [0, 1500, 4000, 8000]) {
    if (wait) await page.waitForTimeout(wait - (Date.now() - t0) > 0 ? wait - (Date.now() - t0) : 0);
    const probe = await page.evaluate(() => {
      const count = s => document.querySelectorAll(s).length;
      const inputs = [...document.querySelectorAll('input')].map(i => `${i.type}|name=${i.name}|ph=${i.placeholder}|ac=${i.autocomplete}`);
      const buttons = [...document.querySelectorAll('button')].map(b => `${b.getAttribute('data-e2e') ?? ''}|${(b.innerText || '').trim().slice(0, 30)}|type=${b.type}`);
      return { url: location.pathname, user: count('input[name="username"]'), pass: count('input[type="password"]'), submit: count('button[data-e2e="login-button"]'), inputs, buttons: buttons.slice(0, 12) };
    });
    console.log(`t+${Date.now() - t0}ms`, JSON.stringify(probe));
  }
} finally {
  await browser.close();
}
