import type { Locator, Page } from 'playwright-core';
import { base32, totp, totpRemaining } from './totp.js';

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

/** Ask TikTok for its English UI whatever the IP's country (the automation reads English text).
 *  Pairs with the browser-wide en-US locale set when the window is launched. */
export const inEnglish = (url: string) => url + (url.includes('?') ? '&' : '?') + 'lang=en';
const HOME_URL = inEnglish('https://www.tiktok.com/');
const LOGIN_URL = inEnglish('https://www.tiktok.com/login/phone-or-email/email');
const ERROR_TEXT = /incorrect|wrong|try again|too many|maximum number|doesn['’]t exist|not registered|sai|không đúng|không chính xác|thử lại|quá nhiều|không tồn tại/i;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const onLoginPage = (page: Page) => { try { return new URL(page.url()).pathname.startsWith('/login'); } catch { return false; } };
const captchaVisible = (page: Page) => page.locator('iframe[src*="captcha"], [id*="captcha"]').first().isVisible().catch(() => false);
// The 2-step verification code box (never the username/password fields).
const CODE_INPUT = ['input[autocomplete="one-time-code"]', 'input[placeholder*="code" i]', 'input[placeholder*="mã" i]', 'input[name*="code" i]', 'input[inputmode="numeric"]']
  .map(s => `${s}:not([name="username"]):not([type="password"])`).join(', ');
const codeInput = (page: Page) => page.locator(CODE_INPUT).first();
const AUTH_METHOD = /authenticator|ứng dụng xác thực|trình xác thực/i;
const SEND_CODE = /^\s*(send code|get code|send|gửi mã|nhận mã|gửi)\s*$/i;
// "Verify it's really you" dialog: the email option shows the masked address (p***1@hotmail.com).
const MASKED_EMAIL = /[^\s@]*\*{2,}[^\s@]*@\S+/;
const VERIFY_DIALOG = /verify it.?s really you|verify your identity|xác minh (đó là bạn|danh tính|rằng đó là bạn)/i;

/** First element of a locator that is actually visible (the login page keeps hidden copies). */
async function firstVisible(locator: Locator): Promise<Locator | null> {
  try {
    const all = await locator.all();
    for (const item of all.slice(0, 20)) if (await item.isVisible().catch(() => false)) return item;
  } catch { /* detached / unsupported: treat as not found */ }
  return null;
}

/** The email row of the verify dialog — never the "Email" tab of the login form behind it. */
async function emailMethod(page: Page): Promise<Locator | null> {
  const masked = await firstVisible(page.getByText(MASKED_EMAIL));
  if (masked) return masked;
  // Fallback: an "Email" option inside the verify dialog only.
  const dialog = await firstVisible(page.locator('[role="dialog"], [class*="modal" i], [class*="Modal"]').filter({ hasText: VERIFY_DIALOG }));
  return dialog ? firstVisible(dialog.getByText(/^\s*(email|e-mail|thư điện tử)\s*$/i)) : null;
}
const nextButton = (page: Page) => page.getByRole('button', { name: /^\s*(next|verify|submit|continue|confirm|log in|tiếp|tiếp tục|xác minh|xác nhận|gửi|đăng nhập)\s*$/i }).first();

async function loginError(page: Page): Promise<string | null> {
  const text = await page.locator('form').getByText(ERROR_TEXT).first().innerText({ timeout: 300 }).catch(() => null);
  return text ? text.trim().replace(/\s+/g, ' ').slice(0, 160) : null;
}

/** Reads the emailed TikTok code for an account with no 2FA. `since` = when Log in was clicked. */
export type MailCodeResolver = (since: number) => Promise<string | null>;

/** Fill the saved username/password and press Log in at most once. Never retries a submission. */
export async function fillOnce(page: Page, username: string, password: string | null, check = () => {}, twofa: string | null = null, getMailCode?: MailCodeResolver): Promise<LoginOutcome> {
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
  // TikTok enables Log in only after React sees both values.
  const enabled = async (ms: number) => {
    for (let i = 0; i * 200 < ms; i++) { if (await submit.isEnabled().catch(() => false)) return true; await sleep(200); check(); }
    return submit.isEnabled().catch(() => false);
  };
  // 1) Fast path: set the values directly.
  await user.fill(username); check(); await pass.fill(password); check();
  if (!(await enabled(2000))) {
    // 2) In a visible window TikTok's React may ignore programmatic values: clear and type like a person.
    for (const [field, value] of [[user, username], [pass, password]] as const) {
      await field.click({ timeout: 5000 }); check();
      await field.press('Control+a'); await field.press('Delete'); check();
      await field.pressSequentially(value, { delay: 45 }); check();
    }
    await pass.press('Tab').catch(() => {});
  }
  if (!(await enabled(5000))) {
    const userLen = (await user.inputValue().catch(() => '')).length;
    const passLen = (await pass.inputValue().catch(() => '')).length;
    return { result: 'no_form', error: `Nút Log in không bật sau khi điền (ô tài khoản ${userLen}/${username.length} ký tự, mật khẩu ${passLen}/${password.length})` };
  }
  check();
  await submit.click({ timeout: 5000 });
  // Watch the result: a CAPTCHA (wait for the person, up to 5 min), the 2-step code
  // (typed from the saved 2FA secret, once), leaving the login page = accepted, or an error.
  const started = Date.now();
  let deadline = started + 20000, codeSent = false, methodTries = 0, sendClicked = false;
  while (Date.now() < deadline) {
    await sleep(500); check();
    if (await captchaVisible(page)) { deadline = Math.max(deadline, Math.min(started + 300000, Date.now() + 20000)); continue; }
    const code = codeInput(page);
    if (await code.isVisible().catch(() => false)) {
      if (codeSent) continue;
      let value: string | null = null;
      if (twofa) {
        const key = base32(twofa);
        if (!key) return { result: 'challenge', error: 'Khoá 2FA đã lưu không đúng định dạng (cần chuỗi base32 của ứng dụng xác thực)' };
        if (totpRemaining() < 6000) await sleep(totpRemaining() + 500); // don't type a code that expires mid-typing
        value = totp(key);
      } else if (getMailCode) {
        // No 2FA: TikTok emailed the code. Read it from the mailbox.
        value = await getMailCode(started).catch(() => null);
        if (!value) return { result: 'challenge', error: 'Không lấy được mã TikTok gửi qua email. Kiểm tra hộp thư/khôi phục rồi nhập tay.' };
      } else return { result: 'challenge', error: 'TikTok hỏi mã xác minh nhưng tài khoản chưa có 2FA và chưa cấu hình đọc mã email' };
      check();
      await code.click({ timeout: 5000 }); await code.press('Control+a'); await code.press('Delete');
      await code.pressSequentially(value, { delay: 60 }); check();
      await sleep(800);
      const next = nextButton(page);
      if (await code.isVisible().catch(() => false)) {
        if (await next.isVisible().catch(() => false) && await next.isEnabled().catch(() => false)) await next.click({ timeout: 5000 }).catch(() => {});
        else await code.press('Enter').catch(() => {});
      }
      codeSent = true; deadline = Date.now() + 25000;
      continue;
    }
    // TikTok may first ask "Verify it's really you": pick authenticator (2FA) or the email row (no 2FA).
    // Retried a few times: a click that lands on the wrong element must not end the attempt.
    if (methodTries < 4 && (twofa || getMailCode)) {
      const method = twofa ? await firstVisible(page.getByText(AUTH_METHOD)) : await emailMethod(page);
      if (method) {
        methodTries++;
        await method.click({ timeout: 5000 }).catch(() => {});
        await sleep(1200);
        const next = nextButton(page);
        if (await next.isVisible().catch(() => false) && await next.isEnabled().catch(() => false)) await next.click({ timeout: 5000 }).catch(() => {});
        deadline = Math.max(deadline, Date.now() + 25000);
        continue;
      }
    }
    // Some flows show a "Send code" button before the code box.
    if (!sendClicked && !twofa && getMailCode) {
      const send = await firstVisible(page.getByRole('button', { name: SEND_CODE }));
      if (send && await send.isEnabled().catch(() => false)) {
        sendClicked = true;
        await send.click({ timeout: 5000 }).catch(() => {});
        deadline = Math.max(deadline, Date.now() + 25000);
        continue;
      }
    }
    if (!onLoginPage(page)) return { result: 'submitted' };
    const error = await loginError(page);
    if (error) return { result: 'rejected', error };
  }
  if (codeSent) return { result: 'challenge', error: twofa ? 'Đã nhập mã 2FA nhưng TikTok chưa chấp nhận (kiểm tra khoá 2FA đã lưu)' : 'Đã nhập mã email nhưng TikTok chưa chấp nhận (có thể mã cũ/hết hạn)' };
  if (await captchaVisible(page)) return { result: 'challenge' };
  return { result: 'pending' };
}

/** Poll the page for proof of the signed-in account (the nav can render a few seconds late). */
async function signedInAs(page: Page, username: string, ms: number) {
  const end = Date.now() + ms;
  let status = await observe(page, username).catch(() => 'unverified');
  while (status === 'unverified' && Date.now() < end) { await sleep(1000); status = await observe(page, username).catch(() => 'unverified'); }
  return status;
}

export async function navigateAccount(page: Page, hasSession: boolean, username: string, password: string | null, autofill: boolean, check = () => {}, twofa: string | null = null, getMailCode?: MailCodeResolver): Promise<LoginOutcome> {
  await page.goto(HOME_URL, { timeout: 45000, waitUntil: 'domcontentloaded' }).catch(() => {});
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
  return fillOnce(page, username, password, check, twofa, getMailCode).catch((e: unknown) => {
    if (e instanceof Error && e.message === 'INTERRUPTED') throw e;
    return { result: 'no_form' as const, error: 'Lỗi khi điền form đăng nhập' };
  });
}
