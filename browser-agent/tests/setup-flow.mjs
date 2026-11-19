import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const folder = await mkdtemp(join(tmpdir(), 'sm-setup-test-'));
const hook = join(folder, 'fixture.mjs');
await writeFile(hook, `
import cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
const realSpawn = cp.spawn;
cp.spawn = function(file, args, options) {
  if (args?.includes('fetch') && args.some(x => x.includes('camoufox'))) {
    const child = new EventEmitter();
    setTimeout(() => child.emit('exit', 0), 50);
    return child;
  }
  return realSpawn(file, args, options);
};
syncBuiltinESMExports();
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.headers['X-Body']);
  if (url.endsWith('/agent/login')) {
    if (body.username !== 'fixture' || body.password !== 'fixture-password') return Response.json({}, {status:401});
    return Response.json({token:'a'.repeat(64),ownerId:123,deviceId:'fixture-device'});
  }
  if (url.endsWith('/agent/sync')) return Response.json({allowed:[],job:null,pollSeconds:1});
  throw new Error('Unexpected test request');
};
`);
const env = { ...process.env, LOCALAPPDATA: folder, NODE_OPTIONS: `--import="${pathToFileURL(hook).href}"` };
const launch = password => new Promise((resolveResult, reject) => {
  const child = spawn(process.execPath, ['dist/main.js', 'setup-window'], { cwd: resolve('.'), env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.resume();
  child.once('error', reject);
  child.once('exit', code => resolveResult({ code, output }));
  child.stdin.end(JSON.stringify({ username: 'fixture', password }));
});
const wrong = await launch('wrong');
assert.equal(wrong.code, 1);
assert.match(wrong.output, /INVALID_LOGIN/);
const result = await launch('fixture-password');
assert.equal(result.code, 0);
for (const stage of ['login', 'install', 'connect', 'connected']) assert.ok(result.output.includes(`"stage":"${stage}"`));
const dataDir = join(folder, 'SocialManagerBrowser');
const settings = JSON.parse(await readFile(join(dataDir, 'connection.json'), 'utf8'));
assert.notEqual(settings.token, 'a'.repeat(64));
assert.ok(!JSON.stringify(settings).includes('fixture-password'));
const pid = Number(await readFile(join(dataDir, 'running.pid'), 'utf8'));
process.kill(pid, 0);
await writeFile(join(dataDir, 'stop'), 'stop');
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 200));
  try { await readFile(join(dataDir, 'running.pid')); }
  catch { console.log('PASS setup flow: wrong login, install, background handshake, DPAPI, survives setup exit, stop.'); process.exit(0); }
}
throw new Error('Fixture agent did not stop');
