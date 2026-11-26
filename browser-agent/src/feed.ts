import type { Page } from 'playwright-core';
import type { Session, Job } from './browser.js';
import type { Operation } from './operation.js';
import { loginMessage } from './hide.js';

// "Lướt feed như người thật": open the For You feed and browse it with human timing — watch each
// video a random while, scroll to the next, and occasionally like — while a visible fake cursor
// moves smoothly like a hand. No captions/URLs leave the machine; only counters + a short message.

export const FEED_URL = 'https://www.tiktok.com/foryou';
const LOGIN_WAIT_MS = 10 * 60 * 1000;

export interface FeedProgress {
  watched: number;
  liked: number;
  message: string;
  status?: 'completed' | 'stopped' | 'error';
  errorCode?: string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(1e6, Math.round(v)) : 0);

/** Keep only counters + a short message off the machine. */
export function cleanFeed(raw: unknown): FeedProgress {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const status = ['completed', 'stopped', 'error'].includes(r.status as string) ? (r.status as FeedProgress['status']) : undefined;
  return { watched: int(r.watched), liked: int(r.liked),
    message: typeof r.message === 'string' ? r.message.slice(0, 300) : '',
    ...(status ? { status } : {}), ...(typeof r.errorCode === 'string' ? { errorCode: r.errorCode.slice(0, 40) } : {}) };
}

// Injected once: a visible fake cursor overlay with a smooth move-to (easeInOutQuad) and a click flash.
const CURSOR_SCRIPT = `(() => {
  const g = globalThis;
  if (g.__smCursor) return;
  const el = document.createElement('div');
  el.id = 'sm-cursor';
  // pointer-events:none on BOTH the box and the SVG — an SVG defaults to capturing clicks even
  // when its parent has pointer-events:none, which would block the real like/scroll clicks.
  el.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;width:24px;height:24px;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));';
  el.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="#fff" stroke="#000" stroke-width="1.2" style="pointer-events:none"><path d="M5 3l15 9-6.5 1.7L10.5 20 5 3z"/></svg>';
  (document.body || document.documentElement).appendChild(el);
  let cx = innerWidth / 2, cy = innerHeight * 0.55;
  const place = () => { el.style.transform = 'translate(' + cx + 'px,' + cy + 'px)'; };
  place();
  g.__smCursor = (x, y) => new Promise(res => {
    const sx = cx, sy = cy, dx = x - sx, dy = y - sy, dist = Math.hypot(dx, dy);
    const dur = Math.min(1000, 200 + dist * 1.1), t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      cx = sx + dx * e; cy = sy + dy * e; place();
      if (p < 1) requestAnimationFrame(step); else res(null);
    };
    requestAnimationFrame(step);
  });
  g.__smClick = () => el.animate([{ transform: el.style.transform + ' scale(.7)' }, { transform: el.style.transform + ' scale(1)' }], { duration: 180 });
})()`;

const ensureCursor = (page: Page) => page.evaluate(CURSOR_SCRIPT).catch(() => {});
async function moveCursor(page: Page, x: number, y: number) {
  await page.evaluate(([x, y]) => (globalThis as unknown as { __smCursor?: (x: number, y: number) => Promise<unknown> }).__smCursor?.(x, y), [x, y]).catch(() => {});
  await page.mouse.move(x, y, { steps: 6 }).catch(() => {});
  await sleep(rand(120, 320));
}
const clickFx = (page: Page) => page.evaluate(() => (globalThis as unknown as { __smClick?: () => void }).__smClick?.()).catch(() => {});

const onFeed = (page: Page) => { try { const u = new URL(page.url()); return u.hostname === 'www.tiktok.com' && !u.pathname.startsWith('/login'); } catch { return false; } };
const viewport = (page: Page) => page.viewportSize() ?? { width: 1280, height: 720 };

/** Move the cursor somewhere plausible (idle wander while watching). */
async function wander(page: Page) {
  const v = viewport(page);
  await moveCursor(page, rand(v.width * 0.3, v.width * 0.7), rand(v.height * 0.3, v.height * 0.75));
}

/** Move to the like button and click it. Returns true if a like control was found. */
async function likeCurrent(page: Page): Promise<boolean> {
  const like = page.locator('[data-e2e="like-icon"], [data-e2e="browse-like-icon"]').first();
  if (!(await like.isVisible().catch(() => false))) return false;
  const box = await like.boundingBox().catch(() => null);
  if (!box) return false;
  await moveCursor(page, box.x + box.width / 2, box.y + box.height / 2);
  await clickFx(page);
  await like.click({ timeout: 4000, delay: rand(40, 120) }).catch(() => {});
  await sleep(rand(400, 900));
  return true;
}

/** Scroll to the next video the way a person does. */
async function nextVideo(page: Page) {
  const v = viewport(page);
  await moveCursor(page, rand(v.width * 0.45, v.width * 0.55), rand(v.height * 0.5, v.height * 0.6));
  await page.mouse.wheel(0, rand(300, 600)).catch(() => {});
  await page.keyboard.press('ArrowDown').catch(() => {});
  await sleep(rand(500, 1100));
}

async function waitForLogin(session: Session, operation: Operation, report: (p: FeedProgress) => void) {
  const deadline = Date.now() + LOGIN_WAIT_MS;
  let status = await session.inspect();
  while (status !== 'logged_in') {
    operation.check();
    if (status === 'closed' || Date.now() > deadline) throw new Error('FEED_MANUAL');
    report({ watched: 0, liked: 0, message: loginMessage(status, session.login) });
    await sleep(3000);
    status = await session.inspect();
  }
}

export async function browseFeed(session: Session, job: Job, operation: Operation, report: (p: FeedProgress) => void): Promise<FeedProgress> {
  operation.check();
  await waitForLogin(session, operation, report);
  const pages = session.context.pages().filter(p => !p.isClosed());
  const page = pages.find(p => onFeed(p)) ?? pages[0] ?? await session.context.newPage();
  await operation.own(() => page.close().catch(() => {}));
  try {
    await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    operation.check();
    await sleep(rand(1500, 3000));
    await ensureCursor(page);

    const durationMs = Math.min(60 * 60 * 1000, Math.max(30 * 1000, job.durationMs ?? 5 * 60 * 1000));
    const likeRate = Math.min(0.6, Math.max(0, job.likeRate ?? 0.15));
    const deadline = Date.now() + durationMs;
    let watched = 0, liked = 0;
    report({ watched, liked, message: 'Bắt đầu lướt feed…' });
    while (Date.now() < deadline) {
      operation.check();
      await ensureCursor(page); // re-inject after SPA navigations
      await wander(page);
      await sleep(rand(3500, 10000)); // watch the video
      operation.check();
      if (Math.random() < likeRate) { if (await likeCurrent(page)) liked++; }
      await nextVideo(page);
      watched++;
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      report({ watched, liked, message: `Đang lướt feed · đã xem ${watched}, tim ${liked} · còn ~${left}s` });
    }
    const done: FeedProgress = { watched, liked, message: `Hoàn tất: xem ${watched} video, thả tim ${liked}.`, status: 'completed' };
    report(done);
    return done;
  } catch (e) {
    if (e instanceof Error && e.message === 'INTERRUPTED') return { watched: 0, liked: 0, message: 'Đã dừng.', status: 'stopped' };
    throw e;
  }
}
