import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { supervisorScript, EXIT_NO_RESTART } from '../dist/autostart.js';

// Runs the real VBScript supervisor with a fake agent that exits with the given codes in turn.
async function supervise(codes) {
  const dir = await mkdtemp(join(tmpdir(), 'sm auto ')); // a space, like "TIKTOK MANAGER"
  try {
    const fake = join(dir, 'fake agent.mjs'), log = join(dir, 'runs.txt');
    await writeFile(fake, `import { appendFileSync, readFileSync } from 'node:fs';
let n = 0; try { n = readFileSync(${JSON.stringify(log)}, 'utf8').length; } catch {}
appendFileSync(${JSON.stringify(log)}, 'x');
process.exit(${JSON.stringify(codes)}[n] ?? 0);`);
    const vbs = join(dir, 'autostart.vbs');
    await writeFile(vbs, supervisorScript(process.execPath, fake, dir));
    execFileSync('cscript.exe', ['//nologo', vbs], { timeout: 60000, windowsHide: true });
    return (await readFile(log, 'utf8')).length;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('autostart supervisor: stops on clean exit or "don\'t restart", restarts after a crash', { skip: process.platform !== 'win32', timeout: 90000 }, async () => {
  assert.equal(await supervise([0]), 1, 'Stop.cmd / revoked: exits for good');
  assert.equal(await supervise([EXIT_NO_RESTART]), 1, 'already running / not paired: no restart loop');
  assert.equal(await supervise([1, 0]), 2, 'crash: started again (after 15 s)');
});
