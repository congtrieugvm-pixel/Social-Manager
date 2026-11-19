// Real Camoufox, isolated temporary profiles and a local fixture; no TikTok login.
import { Camoufox, getRandomPreset } from 'camoufox';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { BROWSER_BUILD } from '../dist/browser.js';
const temp = await mkdtemp(join(tmpdir(), 'sm-browser-smoke-'));
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<title>Local fixture</title><h1>Browser test</h1>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const preset = getRandomPreset('windows', '158'); assert.ok(preset);
let active;
const open = async name => active = await Camoufox({ headless: true, browser: BROWSER_BUILD, persistent_context: true, user_data_dir: join(temp, name), fingerprint_preset: preset });
const identity = page => page.evaluate(() => ({ ua: navigator.userAgent, platform: navigator.platform, width: screen.width, height: screen.height }));
try {
  let context = await open('one'); let page = await context.newPage(); await page.goto(url);
  const before = await identity(page);
  await context.addCookies([{ name: 'fixture', value: 'one', url, expires: Math.floor(Date.now() / 1000) + 3600 }]);
  await page.evaluate(() => localStorage.setItem('fixture', 'one'));
  await context.close(); active = null;
  context = await open('one'); page = await context.newPage(); await page.goto(url);
  assert.deepEqual(await identity(page), before);
  assert.equal((await context.cookies(url)).find(c => c.name === 'fixture')?.value, 'one');
  assert.equal(await page.evaluate(() => localStorage.getItem('fixture')), 'one');
  await context.close(); active = null;
  context = await open('two'); page = await context.newPage(); await page.goto(url);
  assert.equal((await context.cookies(url)).find(c => c.name === 'fixture'), undefined);
  assert.equal(await page.evaluate(() => localStorage.getItem('fixture')), null);
  await context.close(); active = null;
  // A broken configured proxy must not reach the local fixture through a direct fallback.
  const browser = await Camoufox({ headless: true, browser: BROWSER_BUILD, proxy: { server: 'http://127.0.0.1:1' } });
  try { const p = await browser.newPage(); await assert.rejects(p.goto('https://api.ipify.org?format=json', { timeout: 10000 })); } finally { await browser.close(); }
  console.log('PASS real Camoufox: persistent cookie/storage, stable UA/platform/screen, isolated profiles, broken proxy fails.');
} finally {
  if (active) await active.close();
  await new Promise(r => server.close(r));
  const resolved = resolve(temp), parent = resolve(tmpdir()) + sep;
  if (!resolved.startsWith(parent) || !resolved.includes('sm-browser-smoke-')) throw new Error('Unsafe cleanup path');
  await rm(resolved, { recursive: true, force: true });
}
