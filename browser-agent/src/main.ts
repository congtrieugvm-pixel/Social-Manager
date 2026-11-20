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
import { startManager, openManagerWindow, ensureShortcut, type Tile } from './manager.js';
import { ensureAutostart, disableAutostart, EXIT_NO_RESTART } from './autostart.js';

const VERSION = '1.0.9';
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
  // Not paired yet: nothing to connect to (the autostart supervisor must not loop on this).
  const s = await settings().catch(() => { throw new Error('NOT_PAIRED'); });
  const guard = await acquireLock();
  const runId = randomUUID();
  const sessions = new Map<string, Session>();
  const reports = new Map<string, Report>();
  const journalFile = join(root, `jobs-${siteKey(s.origin, s.ownerId)}.json`);
  let journal: string[] = [];
  try { journal = JSON.parse(await readFile(journalFile, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  let stopped = false, lastLease = 0, lastStart = 0, backoff = 3000;
  // Several jobs run at once (one per account); the website sets how many windows this machine may keep open.
  let maxWindows = 3, opening = 0;
  const running = new Map<string, { operation: Operation; profileId?: string; kind: string; startedAt: number; hide?: HideProgress }>();
  // For the Browser Manager tiles: last window status and when each window opened.
  const windowStatus = new Map<string, string>(), openedAt = new Map<string, number>();
  const mailReported = new Set<string>(); // profileIds whose captured mail token was already reported
  let journalWrite: Promise<void> = Promise.resolve();
  let manager: Awaited<ReturnType<typeof startManager>> | null = null;
  let allowed = new Set<string>();
  const stopFile = join(root, 'stop'); await unlink(stopFile).catch(() => {});
  await writeFile(join(root, 'running.pid'), String(process.pid));
  async function close(id: string) {
    const session = sessions.get(id); if (!session) return;
    try { await session.close(); sessions.delete(id); reports.set(session.job.id, { jobId: session.job.id, profileId: id, status: 'closed' }); }
    catch { console.error('PROFILE_BUSY: Khong dong duoc cua so; ho so van bi khoa.'); }
  }
  const cancelProfile = async (id: string) => { for (const r of running.values()) if (r.profileId === id) await r.operation.cancel().catch(() => {}); };
  const cancelAll = () => { for (const r of running.values()) void r.operation.cancel().catch(() => {}); };
  // Space window launches 2 s apart even when several start together.
  const startGate = async () => { const at = Math.max(Date.now(), lastStart + 2000); lastStart = at; await sleep(at - Date.now()); };
  // Journal writes go one after another (they share a temp file).
  const remember = (id: string) => {
    journal = [...journal, id].slice(-2000);
    const write = journalWrite.then(() => saveJson(journalFile, journal));
    journalWrite = write.catch(() => {});
    return write;
  };
  const watchdog = setInterval(() => {
    if (Date.now() - lastLease > 90000) { allowed.clear(); cancelAll(); for (const id of sessions.keys()) void close(id); }
  }, 1000);
  process.on('SIGINT', () => { stopped = true; }); process.on('SIGTERM', () => { stopped = true; });
  async function openWindow(job: Job, task: Operation) {
    opening++;
    try {
      await startGate(); task.check();
      const session = await openSession(s.origin, job, task); sessions.set(job.profileId!, session); openedAt.set(job.profileId!, Date.now());
      return session;
    } finally { opening--; }
  }
  async function execute(job: Job) {
    const task = new Operation(() => !stopped && Date.now() - lastLease <= 90000 && (!job.profileId || allowed.has(job.profileId)));
    // One job per browser profile at a time.
    if (job.profileId && [...running.values()].some(r => r.profileId === job.profileId)) {
      reports.set(job.id, { jobId: job.id, profileId: job.profileId, status: 'error', done: true, error: 'PROFILE_BUSY' });
      job.password = null; job.twofa = null; return;
    }
    running.set(job.id, { operation: task, profileId: job.profileId, kind: job.kind, startedAt: Date.now() });
    try {
      if (journal.includes(job.id)) { reports.set(job.id, { jobId: job.id, profileId: job.profileId, status: 'interrupted', done: true, error: 'INTERRUPTED' }); return; }
      await remember(job.id);
      if (job.expiresAt * 1000 < Date.now() || Date.now() - lastLease > 90000) throw new Error('INTERRUPTED');
      if (job.kind === 'post') {
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
          session = await openWindow(job, task);
        }
        const active = session;
        await task.own(() => active.close());
        const progress = (hide: HideProgress) => { reports.set(`${job.id}:hide`, { jobId: job.id, hide }); const r = running.get(job.id); if (r) r.hide = hide; };
        await waitForLogin(active, task, progress);
        const result = await hidePosts(active, job, task, progress);
        reports.set(`${job.id}:hide`, { jobId: job.id, hide: result, done: true,
          ...(result.status === 'completed' ? {} : { error: result.status === 'stopped' ? 'INTERRUPTED' : 'HIDE_FAILED' }) });
      }
      else if (job.kind !== 'open') throw new Error('UNSUPPORTED');
      else {
        await openWindow(job, task);
        if (stopped || Date.now() - lastLease > 90000 || !allowed.has(job.profileId!)) await close(job.profileId!);
      }
    } catch (e) {
      const error = e instanceof Error && ['PROFILE_BUSY', 'INTERRUPTED', 'FOLDER_EMPTY', 'FOLDER_INVALID', 'POST_UNKNOWN', 'POST_MANUAL', 'HIDE_MANUAL', 'HIDE_FAILED'].includes(e.message) ? e.message : job.proxy ? 'PROXY_FAILED' : 'BROWSER_FAILED';
      reports.set(job.id, { jobId: job.id, profileId: job.profileId, status: 'error', done: true, error });
    } finally { job.password = null; job.twofa = null; running.delete(job.id); }
  }
  try {
    console.log('Da san sang nhan lenh. Dung bang Stop hoac Ctrl+C.');
    // Browser Manager: live tiles of every open window, on this PC only.
    manager = await startManager({
      tiles: () => [...sessions.entries()].map(([id, session]): Tile => {
        const job = [...running.values()].find(r => r.profileId === id && r.kind !== 'open');
        return { profileId: id, username: session.job.username ?? '?', status: windowStatus.get(id) ?? 'starting', openedAt: openedAt.get(id) ?? Date.now(),
          ...(job ? { job: { kind: job.kind, startedAt: job.startedAt, ...(job.hide ? { hide: { changed: job.hide.changed, skipped: job.hide.skipped, message: job.hide.message } } : {}) } } : {}) };
      }),
      page: id => { const pages = sessions.get(id)?.context.pages() ?? []; return pages.filter(p => !p.isClosed()).at(-1); },
      close: async id => { await cancelProfile(id); await close(id); },
      limit: () => ({ max: maxWindows, used: sessions.size, opening }),
    }).catch(() => null);
    const agentDir = fileURLToPath(new URL('..', import.meta.url));
    if (manager?.url) ensureShortcut(agentDir);
    // Paired: start by itself at every Windows sign-in from now on.
    void ensureAutostart(agentDir).catch(() => {});
    while (!stopped) {
      try { await readFile(stopFile); stopped = true; break; } catch { /* absent */ }
      try {
        for (const [id, session] of sessions) {
          const status = await session.inspect(); reports.set(session.job.id, { jobId: session.job.id, profileId: id, status }); windowStatus.set(id, status);
          // A mailbox OAuth token captured during this login is reported once, for the server to store.
          if (session.mailCapture && !mailReported.has(id)) { mailReported.add(id); reports.set(`${session.job.id}:mail`, { jobId: session.job.id, mail: session.mailCapture }); }
          if (status === 'closed') sessions.delete(id);
        }
        const sent = [...reports.values()].slice(0, 25); // the server reads at most 25 per sync
        const knownJobs: string[] = [...sessions.values()].map(session => session.job.id).concat([...reports.keys()], [...running.keys()]);
        const capacity = Math.max(0, maxWindows - sessions.size - opening);
        const slots = Math.max(0, maxWindows + 2 - running.size);
        const sync = await api<{ allowed: string[]; job: { id: string; kind: string } | null; jobs?: Array<{ id: string; kind: string }>; maxWindows?: number; pollSeconds: number }>(s, 'sync', { runId, version: VERSION, capacity, slots, reports: sent, knownJobs });
        // Keys are job IDs or `${jobId}:hide`; drop exactly the objects that were sent.
        for (const [key, r] of reports) if (sent.includes(r)) reports.delete(key);
        lastLease = Date.now(); allowed = new Set(sync.allowed); backoff = 3000;
        if (Number.isInteger(sync.maxWindows)) maxWindows = Math.max(1, Math.min(10, sync.maxWindows!));
        if (process.connected) process.send?.('connected');
        for (const r of running.values()) if (r.profileId && !allowed.has(r.profileId)) await r.operation.cancel().catch(() => {});
        for (const id of sessions.keys()) if (!allowed.has(id)) await close(id);
        for (const next of sync.jobs ?? (sync.job ? [sync.job] : [])) {
          try {
            const job = await api<Job>(s, 'claim', { id: next.id });
            if (job.kind === 'close') {
              // Stop whatever runs in that window, then close it.
              await cancelProfile(job.profileId!);
              await close(job.profileId!);
              reports.set(job.id, { jobId: job.id, done: true, ...(sessions.has(job.profileId!) ? { error: 'PROFILE_BUSY' } : {}) });
              continue;
            }
            if (job.profileId && (job.kind === 'open' || (job.kind === 'hide' && !job.reuse))) allowed.add(job.profileId);
            void execute(job);
          } catch { /* expired or cancelled meanwhile */ }
        }
        await sleep(running.size || sessions.size || reports.size ? 3000 : sync.pollSeconds * 1000);
      } catch (e) {
        if (e instanceof Error && e.message === 'REVOKED') { stopped = true; break; }
        console.error('NETWORK: Dang thu ket noi lai.');
        await sleep(backoff + Math.random() * 1000); backoff = Math.min(60000, backoff * 2);
      }
    }
  } finally {
    allowed.clear(); lastLease = 0;
    cancelAll();
    while (running.size) await sleep(250);
    for (const id of sessions.keys()) await close(id);
    await api(s, 'sync', { runId, capacity: 0, slots: 0, reports: [...reports.values()] }).catch(() => {});
    await manager?.close().catch(() => {});
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
  else if (process.argv[2] === 'manager') await openManagerWindow();
  else if (process.argv[2] === 'autostart' && process.argv[3] === 'off') { await disableAutostart(); console.log('Da tat tu dong chay khi mo may.'); }
  else await run();
}
main().catch(e => {
  const codes = ['INVALID_LOGIN', 'LOGIN_RATE_LIMIT', 'AGENT_ALREADY_RUNNING', 'BROWSER_DOWNLOAD_FAILED', 'CONNECT_PENDING'];
  if (process.argv[2] === 'setup-window') console.log(JSON.stringify({ error: codes.includes(e?.message) ? e.message : 'NETWORK' }));
  else console.error('Khong the tiep tuc. Kiem tra ket noi hoac chay Setup.');
  // The autostart supervisor restarts on 1 (crash) but not when another copy runs or the PC isn't paired.
  process.exitCode = ['AGENT_ALREADY_RUNNING', 'NOT_PAIRED'].includes(e?.message) ? EXIT_NO_RESTART : 1;
});
