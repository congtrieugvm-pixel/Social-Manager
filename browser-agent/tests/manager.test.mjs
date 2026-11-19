import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { startManager } from '../dist/manager.js';

const ID = '11111111-2222-3333-4444-555555555555';
// Raw request so the Host header can be forged (fetch won't let us).
function raw(port, path, { method = 'GET', host = `127.0.0.1:${port}`, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: host, ...headers } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}

test('Browser Manager: local-only, token-gated; state, throttled screenshots, close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sm-manager-'));
  let shots = 0; const closed = [];
  const page = { isClosed: () => false, screenshot: async () => { shots++; return Buffer.from('jpeg-' + shots); } };
  const open = new Set([ID]);
  const manager = await startManager({
    tiles: () => [...open].map(id => ({ profileId: id, username: 'alice', status: 'logged_in', openedAt: 1, job: { kind: 'hide', startedAt: 2, hide: { changed: 3, skipped: 1, message: 'x' } } })),
    page: id => open.has(id) ? page : undefined,
    close: async id => { closed.push(id); open.delete(id); },
    limit: () => ({ max: 3, used: open.size, opening: 0 }),
  }, { ports: [47891, 47892], infoFile: join(dir, 'manager.json') });
  try {
    assert.ok(manager.url);
    const { url } = JSON.parse(await readFile(join(dir, 'manager.json'), 'utf8'));
    assert.equal(url, manager.url);
    const u = new URL(manager.url), port = Number(u.port), t = u.searchParams.get('t');

    // Wrong/missing token, foreign Host (DNS rebinding), cross-site POST: all refused.
    assert.equal((await raw(port, '/api/state')).status, 403);
    assert.equal((await raw(port, '/api/state?t=nope')).status, 403);
    assert.equal((await raw(port, `/api/state?t=${t}`, { host: `evil.example:${port}` })).status, 403);
    assert.equal((await raw(port, `/api/close/${ID}?t=${t}`, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.deepEqual(closed, []);

    const html = await raw(port, `/?t=${t}`);
    assert.equal(html.status, 200); assert.match(html.type, /text\/html/); assert.match(html.body.toString(), /Browser Manager/);
    const state = JSON.parse((await raw(port, `/api/state?t=${t}`)).body);
    assert.equal(state.max, 3); assert.equal(state.tiles[0].username, 'alice'); assert.equal(state.tiles[0].job.hide.changed, 3);

    const a = await raw(port, `/api/shot/${ID}?t=${t}`), b = await raw(port, `/api/shot/${ID}?t=${t}`);
    assert.equal(a.type, 'image/jpeg'); assert.equal(b.body.toString(), a.body.toString()); assert.equal(shots, 1, 'repeated requests reuse the recent screenshot');
    assert.equal((await raw(port, `/api/shot/00000000-0000-0000-0000-000000000000?t=${t}`)).status, 404, 'only open windows');

    assert.equal((await raw(port, `/api/close/${ID}?t=${t}`, { method: 'POST' })).status, 200);
    assert.deepEqual(closed, [ID]);
    assert.equal(JSON.parse((await raw(port, `/api/state?t=${t}`)).body).tiles.length, 0);
  } finally {
    await manager.close();
    await assert.rejects(readFile(join(dir, 'manager.json')), 'pointer file removed on close');
    await rm(dir, { recursive: true, force: true });
  }
});
