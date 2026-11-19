// Diagnostic, never submits: does TikTok's email login form accept the agent's
// input? Types DUMMY values and reports when "Log in" becomes enabled, for
// fill() and for typed keys. `--headful` runs a visible window like the agent.
import { Camoufox, getRandomPreset } from 'camoufox';
import { BROWSER_BUILD } from '../dist/browser.js';

const headful = process.argv.includes('--headful');
const browser = await Camoufox({ headless: !headful, browser: BROWSER_BUILD, fingerprint_preset: getRandomPreset('windows', '158') });
try {
  for (const mode of ['fill', 'type']) {
    const page = await browser.newPage();
    await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.goto('https://www.tiktok.com/login/phone-or-email/email', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const user = page.locator('input[name="username"]');
    const pass = page.locator('input[type="password"]');
    const submit = page.locator('button[data-e2e="login-button"]');
    await user.waitFor({ state: 'visible', timeout: 20000 });
    if (mode === 'fill') { await user.fill('probe.user.not.real'); await pass.fill('not-a-password'); }
    else for (const [f, v] of [[user, 'probe.user.not.real'], [pass, 'not-a-password']]) { await f.click(); await f.press('Control+a'); await f.press('Delete'); await f.pressSequentially(v, { delay: 45 }); }
    const samples = [];
    for (const ms of [0, 300, 1000, 2500]) {
      await page.waitForTimeout(Math.max(0, ms - (samples.at(-1)?.ms ?? 0)));
      samples.push({ ms, enabled: await submit.isEnabled(), user: (await user.inputValue()).length, pass: (await pass.inputValue()).length });
    }
    console.log(`${headful ? 'headful' : 'headless'} ${mode}`, JSON.stringify(samples));
    await page.close();
  }
} finally {
  await browser.close();
}
