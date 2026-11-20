import type { BrowserContext, Page } from 'playwright-core';
import { authorizeUrl, exchangeCode, refreshTokens, pkce, fviaAddress, fviaMessages, fviaBody, MAIL_CLIENT_ID, MAIL_REDIRECT, type MailTokens } from './mailauth.js';
import { readRecentMail, toMail } from './imap.js';
import { latestCode, codeInMail } from './mailcode.js';

// Read the TikTok email verification code for an account whose login has no 2FA.
// First time: log into the Hotmail mailbox through OAuth (capturing a refresh token to
// store). Later: redeem the stored token. Either way, read the code from the inbox online.

export interface MailAccount { email: string; mailPassword: string | null; recoveryEmail: string | null; refreshToken: string | null; clientId: string | null }
export interface CodeResult { code: string | null; tokens?: MailTokens; error?: string }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Poll the inbox for the newest TikTok code after `since` (ms), up to ~90 s. */
export async function pollTikTokCode(email: string, accessToken: string, since: number, check = () => {},
    read = readRecentMail): Promise<string | null> {
  for (let i = 0; i < 18; i++) {
    check();
    const mails = (await read(email, accessToken, 8).catch(() => [])).map(toMail);
    const code = latestCode(mails, { sender: 'tiktok', digits: 6, since: since - 120000 });
    if (code) return code;
    await sleep(5000);
  }
  return null;
}

/**
 * Get a usable access token for the mailbox: redeem the stored refresh token, or, the first
 * time, log in through the browser and capture one. `tokens` is set only when newly captured
 * (so the caller stores the refresh token + client id).
 */
export async function ensureMailAccess(context: BrowserContext, account: MailAccount, check = () => {},
    deps: { refresh?: typeof refreshTokens; login?: typeof browserOAuthLogin } = {}): Promise<{ accessToken: string; tokens?: MailTokens }> {
  const refresh = deps.refresh ?? refreshTokens;
  const login = deps.login ?? browserOAuthLogin;
  if (account.refreshToken && account.clientId) {
    try { const t = await refresh(account.refreshToken, account.clientId); return { accessToken: t.accessToken }; }
    catch { /* token dead — fall back to a fresh browser login */ }
  }
  if (!account.mailPassword) throw new Error('MAIL_NO_PASSWORD');
  const tokens = await login(context, account, check);
  return { accessToken: tokens.accessToken, tokens };
}

// ── Browser OAuth sign-in (the fragile, real-credentials part). Microsoft's consumer flow
// varies a lot (password page, or passwordless "Verify your email", or a 2-step challenge),
// so this reacts to whatever page is shown instead of assuming a fixed order.
const MS = {
  email: 'input[type="email"][name="loginfmt"], input[name="loginfmt"]',
  password: 'input[type="password"][name="passwd"], input[name="passwd"]',
  // The code box is either one field or six single-char inputs.
  otc: 'input[name="otc"], input[name="otccode"], input[id*="otc" i], input[maxlength="1"][inputmode="numeric"], input[maxlength="1"]',
  error: '#usernameError, #passwordError, #idTD_Error, .alert-error, [role="alert"]',
};
const vis = (page: Page, sel: string) => page.locator(sel).first().isVisible().catch(() => false);
// Match a button/link by its visible text (Microsoft changes ids but not the wording much).
const byText = (page: Page, re: RegExp) => page.getByRole('button', { name: re }).or(page.getByRole('link', { name: re })).first();
const USE_PASSWORD = /use your password|dùng mật khẩu|sign in with.*password/i;
const SEND_CODE_MS = /send\s+(a\s+)?code|gửi\s+(một\s+)?mã/i;
const WRONG = /incorrect|wrong|doesn['’]t match|can['’]t|cannot|too many|try again|sai|không đúng|không chính xác/i;

export async function browserOAuthLogin(context: BrowserContext, account: MailAccount, check = () => {}): Promise<MailTokens> {
  if (!account.mailPassword) throw new Error('MAIL_NO_PASSWORD');
  const { verifier, challenge } = pkce();
  const state = Math.random().toString(36).slice(2);
  const page = await context.newPage();
  try {
    await page.goto(authorizeUrl(account.email, challenge, state), { timeout: 45000, waitUntil: 'domcontentloaded' });
    const code = await driveSignIn(page, account, state, check);
    return await exchangeCode(code, verifier, account.clientId ?? MAIL_CLIENT_ID);
  } finally { await page.close().catch(() => {}); }
}

/** React to each Microsoft page until the redirect carries the authorization code. */
async function driveSignIn(page: Page, account: MailAccount, state: string, check: () => void): Promise<string> {
  const deadline = Date.now() + 180000;
  let emailDone = false, pwDone = false, confirmDone = false, proofDone = false, otcDone = false;
  while (Date.now() < deadline) {
    check();
    // 1) Done: the redirect URL carries the code.
    if (page.url().startsWith(MAIL_REDIRECT)) {
      const params = new URL(page.url()).searchParams;
      if (params.get('error')) throw new Error(`MAIL_LOGIN_FAILED:${params.get('error_description') ?? params.get('error')}`.slice(0, 120));
      if (params.get('state') && params.get('state') !== state) throw new Error('MAIL_LOGIN_FAILED:state');
      if (params.get('code')) return params.get('code')!;
    }
    // 2) A visible "wrong password / try again" error is fatal — never resubmit credentials.
    const err = await page.locator(MS.error).filter({ hasText: WRONG }).first().innerText({ timeout: 250 }).catch(() => '');
    if (err) throw new Error(`MAIL_LOGIN_FAILED:${err.trim().replace(/\s+/g, ' ').slice(0, 80)}`);
    // 3) Password field → sign in (once). Prefer the password path.
    if (await vis(page, MS.password)) {
      if (!pwDone) { await page.fill(MS.password, account.mailPassword!).catch(() => {}); pwDone = true; await sleep(400); await clickPrimary(page); }
      await sleep(1500); continue;
    }
    // 4) Passwordless "Verify your email": switch to the password if offered.
    const usePw = byText(page, USE_PASSWORD);
    if (await usePw.isVisible().catch(() => false)) { await usePw.click().catch(() => {}); await sleep(1200); continue; }
    // 5) Email/account field → Next (once).
    if (!emailDone && await vis(page, MS.email)) {
      await page.fill(MS.email, account.email).catch(() => {}); emailDone = true; await clickPrimary(page); await sleep(1500); continue;
    }
    // 6) A 2-step code box → read the Microsoft code from the recovery temp-mail and enter it.
    if (await vis(page, MS.otc)) {
      if (!otcDone) { otcDone = true; await enterSecurityCode(page, account, check); }
      await sleep(2000); continue;
    }
    // 7) "Verify your email — enter it here": a Send-code button WITH a visible input. Type the full
    //    recovery address (MS reuses the name "loginfmt" here, so match by the page, not the name).
    const sendCode = byText(page, SEND_CODE_MS);
    const confirmField = page.locator('input[type="email"], input[type="text"]:not([name="otc"])').first();
    const hasSend = await sendCode.isVisible().catch(() => false);
    if (hasSend && await confirmField.isVisible().catch(() => false)) {
      if (!confirmDone) {
        confirmDone = true;
        if (!account.recoveryEmail) throw new Error('MAIL_CHALLENGE_NO_RECOVERY');
        await confirmField.fill(account.recoveryEmail).catch(() => {});
        await sleep(300); await clickPrimary(page);
      }
      await sleep(1500); continue;
    }
    // 8) Proof chooser ("Almost there": a "Send a code to he***@…" button, no input) → pick the email proof.
    if (!proofDone && hasSend) {
      proofDone = true; await sendCode.click().catch(() => {});
      await sleep(1500); continue;
    }
    // 9) "Stay signed in?" / consent / generic Next → accept.
    await clickPrimary(page);
    await sleep(1500);
  }
  throw new Error('MAIL_LOGIN_TIMEOUT');
}

const PRIMARY = /^\s*(next|sign in|yes|accept|continue|verify|submit|ti[eế]p|ti[eế]p t[uụ]c|đăng nhập|c[oó]|ch[aấ]p nh[aậ]n|x[aá]c nh[aậ]n)\s*$/i;
/** Click Microsoft's primary button — the modern UI drops the old #idSIButton9 id, so fall back to its text. */
async function clickPrimary(page: Page) {
  for (const btn of [page.locator('#idSIButton9').first(), page.getByRole('button', { name: PRIMARY }).first(), page.locator('button[type="submit"], input[type="submit"]').first()]) {
    if (await btn.isVisible().catch(() => false) && await btn.isEnabled().catch(() => false)) { await btn.click({ timeout: 4000 }).catch(() => {}); return; }
  }
}

/** Microsoft asked for an emailed security code → read it from the recovery temp-mail and type it. */
async function enterSecurityCode(page: Page, account: MailAccount, check: () => void) {
  const addr = account.recoveryEmail ? fviaAddress(account.recoveryEmail) : null;
  if (!addr) throw new Error('MAIL_CHALLENGE_NO_RECOVERY');
  const code = await readMicrosoftCode(addr.user, addr.domain, Date.now(), check);
  if (!code) throw new Error('MAIL_CHALLENGE_NO_CODE');
  // The code box is six single-char inputs: focus the first and type (each digit auto-advances).
  const box = page.locator(MS.otc).first();
  await box.click({ timeout: 5000 }).catch(() => {});
  await box.press('Control+a').catch(() => {}); await box.press('Delete').catch(() => {});
  await page.keyboard.type(code, { delay: 80 });
  await sleep(600);
  await clickPrimary(page);
}

const MS_SENDER = /microsoft|accountprotection|account-security/i;
/** Poll the temp-mail for the Microsoft security code sent for THIS attempt (fviainboxes createdAt is
 *  epoch seconds). Only messages newer than `sinceMs` count, so a stale code is never reused. */
async function readMicrosoftCode(user: string, domain: string, sinceMs: number, check: () => void): Promise<string | null> {
  const floor = (sinceMs - 90000) / 1000; // 90 s back-tolerance for clock skew / send latency
  for (let i = 0; i < 24; i++) {
    check();
    await sleep(4000);
    const list = (await fviaMessages(user, domain).catch(() => []))
      .filter(m => MS_SENDER.test(`${m.from ?? ''} ${m.subject ?? ''}`) && Number(m.createdAt ?? 0) >= floor)
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
      .slice(0, 3);
    for (const m of list) {
      const html = m.id ? await fviaBody(user, domain, m.id).catch(() => '') : '';
      const mail = { from: m.from, subject: m.subject, html };
      const code = codeInMail(mail, 6) ?? codeInMail(mail, 7) ?? codeInMail(mail, 8);
      if (code) return code;
    }
  }
  return null;
}
