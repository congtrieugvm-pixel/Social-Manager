import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { hostname } from 'node:os';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { settings, saveSettings, validateOrigin, root, siteKey, saveJson, type Settings } from './storage.js';
import { openSession, checkProxy, type Job, type Report, type Session } from './browser.js';
import { Operation } from './operation.js';
import { readPassword } from './password.js';
import { postVideo } from './posting.js';
import { hidePosts, waitForLogin, type HideProgress } from './hide.js';

const VERSION = '1.0.5';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function api<T>(s: Pick<Settings, 'origin'> & Partial<Settings>, route: string, body: unknown): Promise<T> {
  const payload = JSON.stringify(body).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const res = await fetch(`${s.origin}/api/browser/agent/${route}`, { method: 'POST', redirect: 'error',
    headers: { 'X-Body': payload, ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}) }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(route === 'login' && res.status === 401 ? 'INVALID_LOGIN' : res.status === 429 ? 'LOGIN_RATE_LIMIT' : res.status === 401 ? 'REVOKED' : 'NETWORK');
  return res.json() as Promise<T>;
}
async function setup() {
  const guard = await acquireLock();
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const origin = validateOrigin((await rl.question('Website [https://social-manager.congtrieugvm.workers.dev]: ')).trim() || 'https://social-manager.congtrieugvm.workers.dev');
    const username = (await rl.question('Tai khoan website: ')).trim();
    rl.close();
    let password = await readPassword();
    const previous = await settings().catch(() => null);
    let enrolled: { token: string; ownerId: number; deviceId: string };
    try { enrolled = await api<typeof enrolled>({ origin }, 'login', { username, password, name: hostname(), version: VERSION, deviceToken: previous?.origin === origin ? previous.token : undefined }); }
    finally { password = ''; }
    await saveSettings({ origin, ...enrolled });
    console.log('Da dang nhap va ghep may. Dang tai browser; neu loi, chay Download-browser.cmd.');
    await fetchBrowser();
  } finally { rl.close(); guard.close(); }
}
function progress(stage: string) {
  console.log(JSON.stringify({ stage }));
}
async function setupWindow() {
  let input = '';
  for await (const chunk of stdin) {
    input += chunk.toString();
    if (input.length > 8000) throw new Error('INVALID_LOGIN');
  }
  const credentials = JSON.parse(input) as { username: string; password: string };
  input = '';
  const origin = 'https://social-manager.congtrieugvm.workers.dev';
  const guard = await acquireLock();
  try {
    progress('login');
    const previous = await settings().catch(() => null);
    const enrolled = await api<{ token: string; ownerId: number; deviceId: string }>({ origin }, 'login', {
      username: credentials.username, password: credentials.password, name: hostname(), version: VERSION,
      deviceToken: previous?.origin === origin ? previous.token : undefined,
    });
    credentials.password = '';
    await saveSettings({ origin, ...enrolled });
    progress('install');
    await fetchBrowser();
  } finally {
    credentials.password = '';
    await new Promise<void>(resolve => guard.close(() => resolve()));
  }
  progress('connect');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'agent'], {
      detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const timer = setTimeout(() => {
      child.disconnect(); child.unref(); reject(new Error('CONNECT_PENDING'));
    }, 45000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('NETWORK')); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('NETWORK')); });
    child.on('message', message => {
      if (message === 'connected') {
        clearTimeout(timer); child.disconnect(); child.unref(); resolve();
      }
    });
  });
  progress('connected');
}
async function fetchBrowser() {
  // Resolve the package's declared CLI rather than relying on PATH.
  const pkg = JSON.parse(await readFile(new URL('../node_modules/camoufox/package.json', import.meta.url), 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.camoufox;
  const path = new URL('../node_modules/camoufox/' + bin, import.meta.url);
  await new Promise<void>((resolve, reject) => {
    const p = spawn(process.execPath, [decodeURIComponent(path.pathname).replace(/^\/(\w:)/, '$1'), 'fetch', 'official/158.0.1-beta.41'], { stdio: 'inherit', windowsHide: true });
    p.on('error', reject); p.on('exit', code => code === 0 ? resolve() : reject(new Error('BROWSER_DOWNLOAD_FAILED')));
  });
}
async function acquireLock() {
  // A Windows named pipe is an OS-owned singleton lock, automatically released after crash.
  const guard = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => { guard.once('error', () => reject(new Error('AGENT_ALREADY_RUNNING'))); guard.listen('\\\\.\\pipe\\SocialManagerBrowser-' + siteKey(root, 0), resolve); });
  return guard;
}
async function run() {
  const s = await settings();
  const guard = await acquireLock();
  const runId = randomUUID();
  const sessions = new Map<string, Session>();
  const reports = new Map<string, Report>();
  const journalFile = join(root, `jobs-${siteKey(s.origin, s.ownerId)}.json`);
  let journal: string[] = [];
  try { journal = JSON.parse(await readFile(journalFile, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  let stopped = false, busy = false, lastLease = 0, lastStart = 0, backoff = 3000;
  let executingId: string | null = null;
  let operation: Operation | undefined;
  let operationProfile: string | undefined;
  let allowed = new Set<string>();
  const stopFile = join(root, 'stop'); await unlink(stopFile).catch(() => {});
  await writeFile(join(root, 'running.pid'), String(process.pid));
  async function close(id: string) {
    const session = sessions.get(id); if (!session) return;
    try { await session.close(); sessions.delete(id); reports.set(session.job.id, { jobId: session.job.id, profileId: id, status: 'closed' }); }
    catch { console.error('PROFILE_BUSY: Khong dong duoc cua so; ho so van bi khoa.'); }
  }
  const watchdog = setInterval(() => {
    if (Date.now() - lastLease > 90000) { allowed.clear(); void operation?.cancel().catch(() => {}); for (const id of sessions.keys()) void close(id); }
  }, 1000);
  process.on('SIGINT', () => { stopped = true; }); process.on('SIGTERM', () => { stopped = true; });
  async function execute(job: Job) {
    operationProfile = job.profileId;
    const task = new Operation(() => !stopped && Date.now() - lastLease <= 90000 && (!job.profileId || allowed.has(job.profileId)));
    operation = task;
    try {
      if (journal.includes(job.id)) { reports.set(job.id, { jobId: job.id, profileId: job.profileId, status: 'interrupted', done: true, error: 'INTERRUPTED' }); return; }
      journal = [...journal, job.id].slice(-2000); await saveJson(journalFile, journal);
      if (job.expiresAt * 1000 < Date.now() || Date.now() - lastLease > 90000) throw new Error('INTERRUPTED');
      if (job.kind === 'close') { await close(job.profileId!); reports.set(job.id, { jobId: job.id, done: true, ...(sessions.has(job.profileId!) ? { error: 'PROFILE_BUSY' } : {}) }); }
      else if (job.kind === 'post') {
        const session = sessions.get(job.profileId!);
        if (!session) throw new Error('POST_MANUAL');
        await task.own(() => session.close());
        await postVideo(s.origin, session, job, task);
        reports.set(job.id, { jobId: job.id, done: true });
      }
      else if (job.kind === 'check_proxy') reports.set(job.id, { jobId: job.id, done: true, ...await checkProxy(job, task) });
      else if (job.kind === 'hide') {
        // Reuse the open window when there is one; otherwise open the profile like an `open` job.
        let session = sessions.get(job.profileId!);
        if (!session) {
          if (job.reuse) throw new Error('HIDE_MANUAL');
          await sleep(Math.max(0, 2000 - (Date.now() - lastStart))); lastStart = Date.now();
          session = await openSession(s.origin, job, task); sessions.set(job.profileId!, session);
        }
        const active = session;
        await task.own(() => active.close());
        const progress = (hide: HideProgress) => reports.set(`${job.id}:hide`, { jobId: job.id, hide });
        await waitForLogin(active, task, progress);
        const result = await hidePosts(active, job, task, progress);
        reports.set(`${job.id}:hide`, { jobId: job.id, hide: result, done: true,
          ...(result.status === 'completed' ? {} : { error: result.status === 'stopped' ? 'INTERRUPTED' : 'HIDE_FAILED' }) });
      }
      else if (job.kind !== 'open') throw new Error('UNSUPPORTED');
      else {
        await sleep(Math.max(0, 2000 - (Date.now() - lastStart))); lastStart = Date.now();
        const session = await openSession(s.origin, job, task); sessions.set(job.profileId!, session);
        if (stopped || Date.now() - lastLease > 90000 || !allowed.has(job.profileId!)) await close(job.profileId!);
      }
    } catch (e) {
      const error = e instanceof Error && ['PROFILE_BUSY', 'INTERRUPTED', 'FOLDER_EMPTY', 'FOLDER_INVALID', 'POST_UNKNOWN', 'POST_MANUAL', 'HIDE_MANUAL', 'HIDE_FAILED'].includes(e.message) ? e.message : job.proxy ? 'PROXY_FAILED' : 'BROWSER_FAILED';
      reports.set(job.id, { jobId: job.id, profileId: job.profileId, status: 'error', done: true, error });
    } finally { job.password = null; job.twofa = null; busy = false; executingId = null; operation = undefined; operationProfile = undefined; }
  }
  try {
    console.log('Da san sang nhan lenh. Dung bang Stop hoac Ctrl+C.');
    while (!stopped) {
      try { await readFile(stopFile); stopped = true; break; } catch { /* absent */ }
      try {
        for (const [id, session] of sessions) {
          const status = await session.inspect(); reports.set(session.job.id, { jobId: session.job.id, profileId: id, status });
          if (status === 'closed') sessions.delete(id);
        }
        const sent = [...reports.values()];
        const knownJobs: string[] = [...sessions.values()].map(session => session.job.id).concat([...reports.keys()], executingId ? [executingId] : []);
        const sync = await api<{ allowed: string[]; job: { id: string; kind: string } | null; pollSeconds: number }>(s, 'sync', { runId, version: VERSION, capacity: busy ? 0 : 3 - sessions.size, reports: sent, knownJobs });
        // Keys are job IDs or `${jobId}:hide`; drop exactly the objects that were sent.
        for (const [key, r] of reports) if (sent.includes(r)) reports.delete(key);
        lastLease = Date.now(); allowed = new Set(sync.allowed); backoff = 3000;
        if (process.connected) process.send?.('connected');
        if (operationProfile && !allowed.has(operationProfile)) await operation?.cancel();
        for (const id of sessions.keys()) if (!allowed.has(id)) await close(id);
        if (sync.job?.kind === 'close' && busy) {
          const command = await api<Job>(s, 'claim', { id: sync.job.id });
          if (command.profileId === operationProfile) await operation?.cancel();
          await close(command.profileId!);
          reports.set(command.id, { jobId: command.id, done: true, ...(sessions.has(command.profileId!) ? { error: 'PROFILE_BUSY' } : {}) });
        } else if (sync.job && !busy) {
          busy = true;
          try {
            const job = await api<Job>(s, 'claim', { id: sync.job.id });
            executingId = job.id;
            if (job.profileId && (job.kind === 'open' || (job.kind === 'hide' && !job.reuse))) allowed.add(job.profileId);
            void execute(job);
          } catch { busy = false; }
        }
        await sleep(busy || sessions.size || reports.size ? 3000 : sync.pollSeconds * 1000);
      } catch (e) {
        if (e instanceof Error && e.message === 'REVOKED') { stopped = true; break; }
        console.error('NETWORK: Dang thu ket noi lai.');
        await sleep(backoff + Math.random() * 1000); backoff = Math.min(60000, backoff * 2);
      }
    }
  } finally {
    allowed.clear(); lastLease = 0;
    await operation?.cancel().catch(() => {});
    while (busy) await sleep(250);
    for (const id of sessions.keys()) await close(id);
    await api(s, 'sync', { runId, capacity: 0, reports: [...reports.values()] }).catch(() => {});
    clearInterval(watchdog); guard.close(); await unlink(join(root, 'running.pid')).catch(() => {});
  }
}
async function main() {
  if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
  await mkdir(root, { recursive: true });
  if (process.argv[2] === 'setup-window') await setupWindow();
  else if (process.argv[2] === 'setup') await setup();
  else if (process.argv[2] === 'fetch') await fetchBrowser();
  else if (process.argv[2] === 'stop') await writeFile(join(root, 'stop'), 'stop');
  else await run();
}
main().catch(e => {
  const codes = ['INVALID_LOGIN', 'LOGIN_RATE_LIMIT', 'AGENT_ALREADY_RUNNING', 'BROWSER_DOWNLOAD_FAILED', 'CONNECT_PENDING'];
  if (process.argv[2] === 'setup-window') console.log(JSON.stringify({ error: codes.includes(e?.message) ? e.message : 'NETWORK' }));
  else console.error('Khong the tiep tuc. Kiem tra ket noi hoac chay Setup.');
  process.exitCode = 1;
});
