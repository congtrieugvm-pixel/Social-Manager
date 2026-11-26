// Real Camoufox + local fixture (no TikTok): browseFeed injects the visible cursor, watches,
// moves to the like button and clicks it, scrolls, and reports counters. Short duration.
import { Camoufox } from 'camoufox';
import assert from 'node:assert/strict';
import { BROWSER_BUILD } from '../dist/browser.js';
import { browseFeed } from '../dist/feed.js';

// A fake For You with a like button; clicking it flips a flag and bumps a counter.
// Counters live in the DOM (data-*), because a page's window globals aren't visible to
// page.evaluate under Camoufox's isolated world — only the shared DOM is.
const html = `<!doctype html><title>Feed fixture</title>
<body data-downs="0" style="margin:0;height:200vh;background:#111;color:#eee;font:16px sans-serif">
<div style="position:fixed;right:20px;bottom:120px">
  <button data-e2e="like-icon" data-n="0" style="width:48px;height:48px" onclick="this.dataset.n=(+this.dataset.n||0)+1">♥</button>
</div>
<div id=feed>For You</div>
<script>document.addEventListener('keydown',e=>{if(e.key==='ArrowDown')document.body.dataset.downs=(+document.body.dataset.downs||0)+1});</script>
</body>`;

const browser = await Camoufox({ headless: true, browser: BROWSER_BUILD });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('https://www.tiktok.com/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  const context = page.context();
  const session = { context, job: {}, login: undefined, inspect: async () => 'logged_in', close: async () => {} };
  const op = { check: () => {}, own: async () => {} };
  const progress = [];
  // likeRate 1 → like every video; short run so it finishes fast.
  const result = await browseFeed(session, { durationMs: 6000, likeRate: 1 }, op, p => progress.push(p));

  assert.equal(result.status, 'completed');
  assert.ok(result.watched >= 1, `watched ${result.watched}`);
  assert.ok(result.liked >= 1, `liked ${result.liked}`);
  const cursor = await page.evaluate('!!document.getElementById("sm-cursor")');
  assert.ok(cursor, 'visible cursor injected');
  const likes = Number(await page.locator('[data-e2e="like-icon"]').first().getAttribute('data-n'));
  const downs = Number(await page.evaluate('document.body.dataset.downs'));
  assert.ok(likes >= 1, `fixture like button clicked (${likes})`);
  assert.ok(downs >= 1, `scrolled with ArrowDown (${downs})`);
  assert.ok(progress.length >= 1 && progress.at(-1).message, 'reported progress');
  console.log(`PASS feed smoke: watched ${result.watched}, liked ${result.liked}, cursor shown, likes ${likes}, downs ${downs}`);
} finally {
  await browser.close();
}
