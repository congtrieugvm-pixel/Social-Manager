import path from "node:path";
import fs from "node:fs/promises";

// Use local `any` aliases instead of `import type { BrowserContext, Page } from "playwright"`
// — the playwright package is physically removed from node_modules during the
// Cloudflare build (see scripts/clean-cf-deps.js) and the type import would
// otherwise break `next build` typechecking on that pass. Loose typing here
// is OK because Playwright is only invoked behind the IS_EDGE guard, on Node.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BrowserContext = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

// Playwright + persistent profile directories require a writable filesystem
// and a Chromium binary — neither exists on Cloudflare Workers. When deployed
// to CF, this whole feature is unavailable; the helpers below short-circuit
// with a clear error so the UI can render a "feature not supported" message
// instead of crashing.
const IS_EDGE = process.env.APP_RUNTIME === "cloudflare";

const PROFILE_ROOT = IS_EDGE
  ? "" // unused on edge
  : path.join(process.cwd(), "data", "ms-profiles");

function profileDir(key: string | number): string {
  return path.join(PROFILE_ROOT, String(key));
}

export async function hasHotmailProfile(key: string | number): Promise<boolean> {
  if (IS_EDGE) return false;
  try {
    const stat = await fs.stat(profileDir(key));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export async function clearHotmailProfile(key: string | number): Promise<void> {
  if (IS_EDGE) return;
  await fs.rm(profileDir(key), { recursive: true, force: true });
}

/**
 * Launches Chromium with a persistent user-data-dir for the given account,
 * navigates to login.live.com, auto-fills credentials, and auto-dismisses
 * common "stay signed in / add phone / skip" prompts. Leaves the window open
 * for the user. Cookies persist in the profile dir for next time.
 */
export async function startHotmailLogin(opts: {
  accountId: number;
  email: string;
  password: string;
  profileKey?: string;
}): Promise<void> {
  if (IS_EDGE) {
    throw new Error(
      "Hotmail tự động đăng nhập không khả dụng trên Cloudflare — cần Node host (VPS/Railway) để chạy Chromium.",
    );
  }
  // String-built specifier defeats Next/opennext's file-tracer so the
  // playwright package + Chromium binary are NEVER copied into the CF
  // Worker bundle. The dynamic import only fires on Node where playwright
  // resolves normally from node_modules.
  // Function-constructor dynamic import. Turbopack constant-folds string
  // expressions like `["play","wright"].join("")` back to the literal
  // "playwright", and esbuild then tries to resolve it during the CF bundle
  // step (after clean-cf-deps removed the package). Wrapping the import in
  // `new Function(...)` produces an opaque body that NEITHER bundler can
  // statically analyze — the resolution is fully deferred to runtime, where
  // we never reach this code on Cloudflare anyway (IS_EDGE guard above).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-implied-eval
  const dynImport = new Function("spec", "return import(spec)") as (s: string) => Promise<any>;
  const { chromium } = await dynImport(["play", "wright"].join(""));
  const userDataDir = profileDir(opts.profileKey ?? opts.accountId);
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    args: ["--start-maximized"],
  });

  const page = context.pages()[0] ?? (await context.newPage());

  // Kick off the automation, but return immediately so the HTTP request
  // doesn't hang. Errors are swallowed (user can see in the window).
  runLoginFlow(context, page, opts).catch((err) => {
    console.error("[hotmail-login]", opts.accountId, err);
  });
}

async function runLoginFlow(
  context: BrowserContext,
  page: Page,
  opts: { accountId: number; email: string; password: string },
): Promise<void> {
  await page.goto("https://login.live.com/", { waitUntil: "domcontentloaded" });

  // Step 1: email field
  await fillAndSubmit(page, [
    'input[name="loginfmt"]',
    'input[type="email"]',
  ], opts.email);

  // Step 2: password field
  await fillAndSubmit(page, [
    'input[name="passwd"]',
    'input[type="password"]',
  ], opts.password);

  // Step 3: background loop to auto-dismiss common nuisance prompts
  const deadline = Date.now() + 5 * 60_000; // 5 min
  while (Date.now() < deadline) {
    if (context.pages().length === 0) break;
    if (page.isClosed()) break;

    const url = page.url();
    if (/outlook\.live\.com|outlook\.office|account\.microsoft\.com/i.test(url)) {
      // Successfully signed in.
      break;
    }

    // "Stay signed in?" prompt → click Yes (persists cookies, avoids prompt next time)
    await clickIfVisible(page, [
      "#acceptButton",
      "#idSIButton9",
      'input[type="submit"][value*="Yes"]',
      'button:has-text("Yes")',
      'button:has-text("Có")',
    ]);

    // Various "Not now / Skip / Cancel / Maybe later" options
    await clickIfVisible(page, [
      "#iCancel",
      "#cancelButton",
      'button#iCancel',
      'a#cancelButton',
      'input[value="Skip"]',
      'input[value="Not now"]',
      'button:has-text("Skip for now")',
      'button:has-text("Maybe later")',
      'button:has-text("Not now")',
      'button:has-text("Để sau")',
      'button:has-text("Bỏ qua")',
      'a:has-text("Skip")',
    ]);

    await page.waitForTimeout(1200);
  }
}

async function fillAndSubmit(
  page: Page,
  selectors: string[],
  value: string,
): Promise<void> {
  try {
    const sel = selectors.join(", ");
    await page.waitForSelector(sel, { timeout: 15_000, state: "visible" });
    await page.fill(sel, value);
    // Prefer the primary Next/Sign-in button; fall back to Enter key.
    const submitted = await clickIfVisible(page, [
      "#idSIButton9",
      'input[type="submit"]',
      'button[type="submit"]',
    ]);
    if (!submitted) {
      await page.keyboard.press("Enter");
    }
    // Give the next step a moment to render.
    await page.waitForTimeout(1500);
  } catch {
    // Field not found (already signed in, MFA, captcha, etc.) → skip silently.
  }
}

async function clickIfVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      await el.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(800);
      return true;
    } catch {
      // try next
    }
  }
  return false;
}
