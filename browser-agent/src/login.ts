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

/**
 * What happened to the saved-credentials login, so the web can say it instead
 * of a silent "waiting for login":
 *   logged_in   — the profile was already signed in as this account
 *   submitted   — filled and clicked Log in once; TikTok accepted (left the login page)
 *   pending     — clicked Log in; still on the login page without a visible error
 *   challenge   — TikTok asked for CAPTCHA / code
 *   rejected    — TikTok showed an error (see `error`)
 *   no_form     — the email login form never appeared
 *   no_password — no saved password, or autofill turned off
 *   wrong_account — the profile is signed in as someone else; left untouched
 */
export interface LoginOutcome { result: 'logged_in' | 'submitted' | 'pending' | 'challenge' | 'rejected' | 'no_form' | 'no_password' | 'wrong_account'; error?: string }

const LOGIN_URL = 'https://www.tiktok.com/login/phone-or-email/email';
const ERROR_TEXT = /incorrect|wrong|try again|too many|maximum number|doesn['’]t exist|not registered|sai|không đúng|không chính xác|thử lại|quá nhiều|không tồn tại/i;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const onLoginPage = (page: Page) => { try { return new URL(page.url()).pathname.startsWith('/login'); } catch { return false; } };
const challengeVisible = (page: Page) => page.locator('iframe[src*="captcha"], [id*="captcha"], input[autocomplete="one-time-code"]').first().isVisible().catch(() => false);

async function loginError(page: Page): Promise<string | null> {
  const text = await page.locator('form').getByText(ERROR_TEXT).first().innerText({ timeout: 300 }).catch(() => null);
  return text ? text.trim().replace(/\s+/g, ' ').slice(0, 160) : null;
}

/** Fill the saved username/password and press Log in at most once. Never retries a submission. */
export async function fillOnce(page: Page, username: string, password: string | null, check = () => {}): Promise<LoginOutcome> {
  check();
  if (!password) return { result: 'no_password' };
  if (new URL(page.url()).hostname !== 'www.tiktok.com') return { result: 'no_form' };
  const user = page.locator('input[name="username"]');
  const pass = page.locator('input[type="password"]');
  const submit = page.locator('button[data-e2e="login-button"]');
  // The form can render late on slow connections/proxies: wait for it instead of checking once.
  // Strict locator: several matches (an ambiguous form) also end up as "no_form".
  const ready = await user.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);
  check();
  if (!ready || await user.count() !== 1 || await pass.count() !== 1 || await submit.count() !== 1 || !(await pass.isVisible())) return { result: 'no_form' };
  await user.fill(username); check(); await pass.fill(password); check();
  // TikTok enables Log in only after React sees both values.
  for (let i = 0; i < 25 && !(await submit.isEnabled().catch(() => false)); i++) { await sleep(200); check(); }
  if (!(await submit.isEnabled().catch(() => false))) return { result: 'no_form', error: 'Nút Log in không bật sau khi điền' };
  await submit.click({ timeout: 5000 });
  // Watch the result for a while: leave the login page = accepted; or a challenge / an error message.
  for (let i = 0; i < 40; i++) {
    await sleep(500); check();
    if (await challengeVisible(page)) return { result: 'challenge' };
    if (!onLoginPage(page)) return { result: 'submitted' };
    const error = await loginError(page);
    if (error) return { result: 'rejected', error };
  }
  return { result: 'pending' };
}

/** Poll the page for proof of the signed-in account (the nav can render a few seconds late). */
async function signedInAs(page: Page, username: string, ms: number) {
  const end = Date.now() + ms;
  let status = await observe(page, username).catch(() => 'unverified');
  while (status === 'unverified' && Date.now() < end) { await sleep(1000); status = await observe(page, username).catch(() => 'unverified'); }
  return status;
}

export async function navigateAccount(page: Page, hasSession: boolean, username: string, password: string | null, autofill: boolean, check = () => {}): Promise<LoginOutcome> {
  await page.goto('https://www.tiktok.com/', { timeout: 45000, waitUntil: 'domcontentloaded' }).catch(() => {});
  check();
  // A session cookie alone isn't proof: expired/revoked sessions keep their cookies.
  if (hasSession) {
    const status = await signedInAs(page, username, 8000);
    check();
    if (status === 'logged_in') return { result: 'logged_in' };
    if (status === 'wrong_account') return { result: 'wrong_account' };
    if (status === 'needs_verification') return { result: 'challenge' };
  }
  if (!autofill) return { result: 'no_password' };
  await page.goto(LOGIN_URL, { timeout: 45000, waitUntil: 'domcontentloaded' }).catch(() => {});
  check();
  // TikTok sends an already signed-in profile away from /login.
  if (!onLoginPage(page)) return { result: (await signedInAs(page, username, 5000)) === 'logged_in' ? 'logged_in' : 'no_form' };
  return fillOnce(page, username, password, check).catch((e: unknown) => {
    if (e instanceof Error && e.message === 'INTERRUPTED') throw e;
    return { result: 'no_form' as const, error: 'Lỗi khi điền form đăng nhập' };
  });
}
