import type { Page } from 'playwright-core';

export function identityStatus(actual: string | null, expected: string, challenge: boolean) {
  if (challenge) return 'needs_verification';
  if (!actual) return 'unverified';
  const clean = (s: string) => s.replace(/^@/, '').toLowerCase();
  return clean(actual) === clean(expected) ? 'logged_in' : 'wrong_account';
}
export async function observe(page: Page, expected: string): Promise<string> {
  // Only TikTok's current-user navigation is evidence; arbitrary profile links aren't.
  if (new URL(page.url()).hostname !== 'www.tiktok.com') return 'unverified';
  const challenge = await page.locator('iframe[src*="captcha"], [id*="captcha"], input[autocomplete="one-time-code"]').first().isVisible().catch(() => false);
  const href = await page.locator('[data-e2e="profile-icon"] a[href^="/@"], a[data-e2e="profile-icon"][href^="/@"], a[data-e2e="nav-profile"][href^="/@"]').first().getAttribute('href', { timeout: 1500 }).catch(() => null);
  return identityStatus(href?.match(/^\/@([^/?]+)/)?.[1] ?? null, expected, challenge);
}
export async function fillOnce(page: Page, username: string, password: string | null, check = () => {}) {
  check();
  if (!password || new URL(page.url()).hostname !== 'www.tiktok.com') return;
  const user = page.locator('input[name="username"]');
  const pass = page.locator('input[type="password"]');
  const submit = page.locator('button[data-e2e="login-button"]');
  if (await user.count() !== 1 || await pass.count() !== 1 || await submit.count() !== 1) return;
  if (!(await user.isVisible()) || !(await pass.isVisible())) return;
  check(); await user.fill(username); check(); await pass.fill(password);
  if (await submit.isEnabled()) { check(); await submit.click({ timeout: 5000 }); }
}
export async function navigateAccount(page: Page, hasSession: boolean, username: string, password: string | null, autofill: boolean, check = () => {}) {
  await page.goto('https://www.tiktok.com/', { timeout: 45000, waitUntil: 'domcontentloaded' }).catch(() => {});
  check();
  if (!hasSession && autofill) {
    await page.goto('https://www.tiktok.com/login/phone-or-email/email', { timeout: 45000, waitUntil: 'domcontentloaded' }).catch(() => {});
    check();
    await fillOnce(page, username, password, check).catch(() => {});
  }
  check();
}
