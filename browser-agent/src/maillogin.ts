import type { BrowserContext, Page } from 'playwright-core';
import { authorizeUrl, exchangeCode, refreshTokens, pkce, fviaAddress, fviaMessages, MAIL_CLIENT_ID, MAIL_REDIRECT, type MailTokens } from './mailauth.js';
import { readRecentMail, toMail } from './imap.js';
import { latestCode } from './mailcode.js';

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

// ── Browser OAuth sign-in (the fragile, real-credentials part). Best-effort selectors with
// fallbacks; on anything unexpected it throws a typed error so the login reports it clearly.
const MS = {
  email: 'input[type="email"], input[name="loginfmt"]',
  password: 'input[type="password"], input[name="passwd"]',
  next: '#idSIButton9, button[type="submit"][data-report-event], input[type="submit"]',
  otc: 'input[name="otc"], input[name="otccode"]',
  proofEmail: '[data-value*="@"], #idDiv_SAOTCS_Proofs_Section [role="button"]',
  error: '#usernameError, #passwordError, #idTD_Error, .alert-error',
};
const visible = (page: Page, sel: string, ms = 8000) => page.locator(sel).first().waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);

export async function browserOAuthLogin(context: BrowserContext, account: MailAccount, check = () => {}): Promise<MailTokens> {
  if (!account.mailPassword) throw new Error('MAIL_NO_PASSWORD');
  const { verifier, challenge } = pkce();
  const state = Math.random().toString(36).slice(2);
  const page = await context.newPage();
  try {
    await page.goto(authorizeUrl(account.email, challenge, state), { timeout: 45000, waitUntil: 'domcontentloaded' });
    check();
    // Email (usually prefilled via login_hint) → Next.
    if (await visible(page, MS.email, 12000)) {
      await page.fill(MS.email, account.email).catch(() => {});
      await page.click(MS.next).catch(() => {});
    }
    // Password → Sign in.
    if (!(await visible(page, MS.password, 15000))) throw new Error('MAIL_LOGIN_FAILED');
    await page.fill(MS.password, account.mailPassword);
    check();
    await page.click(MS.next).catch(() => {});
    // The flow now ends in one of: the redirect (code), a "stay signed in?" prompt,
    // a consent page, an identity challenge, or a visible error. Watch for up to ~2 min.
    const code = await waitForCode(page, account, state, check);
    const tokens = await exchangeCode(code, verifier, account.clientId ?? MAIL_CLIENT_ID);
    return tokens;
  } finally { await page.close().catch(() => {}); }
}

async function waitForCode(page: Page, account: MailAccount, state: string, check: () => void): Promise<string> {
  const deadline = Date.now() + 120000;
  let challengeHandled = false;
  while (Date.now() < deadline) {
    check();
    const url = page.url();
    if (url.startsWith(MAIL_REDIRECT)) {
      const params = new URL(url).searchParams;
      if (params.get('error')) throw new Error(`MAIL_LOGIN_FAILED:${params.get('error')}`);
      if (params.get('state') && params.get('state') !== state) throw new Error('MAIL_LOGIN_FAILED:state');
      const code = params.get('code');
      if (code) return code;
    }
    // "Stay signed in?" / consent — accept to finish the redirect.
    const yes = page.locator(MS.next).first();
    const otc = page.locator(MS.otc).first();
    if (await otc.isVisible().catch(() => false)) {
      if (challengeHandled) { await sleep(2000); continue; }
      challengeHandled = true;
      await fillSecurityCode(page, account, check);
      continue;
    }
    const err = await page.locator(MS.error).first().innerText({ timeout: 300 }).catch(() => '');
    if (err && /incorrect|wrong|can't|cannot|again|sai|không/i.test(err)) throw new Error(`MAIL_LOGIN_FAILED:${err.trim().slice(0, 80)}`);
    if (await yes.isVisible().catch(() => false)) { await yes.click().catch(() => {}); }
    await sleep(1500);
  }
  throw new Error('MAIL_LOGIN_TIMEOUT');
}

/** Microsoft asked for an emailed security code → read it from the recovery temp-mail. */
async function fillSecurityCode(page: Page, account: MailAccount, check: () => void) {
  const addr = account.recoveryEmail ? fviaAddress(account.recoveryEmail) : null;
  if (!addr) throw new Error('MAIL_CHALLENGE_NO_RECOVERY');
  const since = Date.now();
  let code: string | null = null;
  for (let i = 0; i < 20 && !code; i++) {
    check();
    await sleep(4000);
    const msgs = await fviaMessages(addr.user, addr.domain).catch(() => []);
    code = latestCode(msgs, { sender: 'microsoft', digits: 7, since: since - 180000 })
      ?? latestCode(msgs, { sender: 'microsoft', digits: 6, since: since - 180000 });
  }
  if (!code) throw new Error('MAIL_CHALLENGE_NO_CODE');
  await page.fill(MS.otc, code);
  await page.click(MS.next).catch(() => {});
}
