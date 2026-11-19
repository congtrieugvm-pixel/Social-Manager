// Real Camoufox + local fixture (no TikTok): the copied Studio engine loads
// through page.evaluate, the runner starts, its state survives across
// evaluate calls, and the stop flag ends the run.
import { Camoufox } from 'camoufox';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { BROWSER_BUILD } from '../dist/browser.js';
import { studioScript, RUNNER, STUDIO_CONTENT } from '../dist/hide.js';

// A page with a privacy filter the engine cannot use, so prepare() keeps
// reporting "filter_control" and waiting: enough to observe live state.
const html = '<title>Studio fixture</title><main><table><tbody></tbody></table></main>';
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await Camoufox({ headless: true, browser: BROWSER_BUILD });
try {
  const page = await browser.newPage();
  // Serve the fixture at the real Studio URL (the engine refuses other pages); nothing reaches TikTok.
  await page.route('https://www.tiktok.com/**', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto(STUDIO_CONTENT);
  await page.evaluate(await studioScript());
  assert.equal(await page.evaluate('typeof TSP.DomAdapter + "/" + typeof TSP.run'), 'function/function');
  assert.equal(await page.evaluate(RUNNER(1000)), true);
  await new Promise(r => setTimeout(r, 1500));
  const running = await page.evaluate('globalThis.__smState');
  assert.ok(running && typeof running.message === 'string' && running.message.length > 0, 'state is readable from a later evaluate');
  console.log('live state:', running.message, running.errorCode ?? '');
  await page.evaluate('globalThis.__smStop = true');
  let final;
  for (let i = 0; i < 30 && !final?.status; i++) { await new Promise(r => setTimeout(r, 500)); final = await page.evaluate('globalThis.__smState'); }
  assert.equal(final?.status, 'stopped', 'the stop flag ends the engine run');
  console.log('PASS hide smoke: engine injected, state readable, stop honoured.');
} finally {
  await browser.close();
  server.close();
}
