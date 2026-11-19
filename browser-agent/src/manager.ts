import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { root } from './storage.js';
import { MANAGER_HTML } from './manager-page.js';

// "Browser Manager": a page served only to this PC (127.0.0.1 + a random token) that
// shows every open TikTok window as a live tile. Opened in an Edge app window by
// `main.js manager` (Desktop shortcut). Nothing here leaves the machine.

export interface Tile {
  profileId: string; username: string; status: string; openedAt: number;
  job?: { kind: string; startedAt: number; hide?: { changed: number; skipped: number; message: string } };
}
export interface ManagerHost {
  tiles(): Tile[];
  page(profileId: string): Page | undefined;
  close(profileId: string): Promise<void>;
  limit(): { max: number; used: number; opening: number };
}

const PORTS = [47831, 47832, 47833, 47834, 47835];
const infoFile = join(root, 'manager.json');
const SHOT_MS = 700;

function sameToken(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function startManager(host: ManagerHost, options: { ports?: number[]; infoFile?: string } = {}) {
  const ports = options.ports ?? PORTS, info = options.infoFile ?? infoFile;
  const token = randomBytes(24).toString('hex');
  const shots = new Map<string, { at: number; data?: Buffer; pending?: Promise<Buffer | undefined> }>();
  let port = 0;

  async function shot(profileId: string) {
    const cached = shots.get(profileId) ?? { at: 0 };
    shots.set(profileId, cached);
    if (cached.data && Date.now() - cached.at < SHOT_MS) return cached.data;
    if (cached.pending) return cached.pending;
    const page = host.page(profileId);
    if (!page) return cached.data;
    cached.pending = page.screenshot({ type: 'jpeg', quality: 50, scale: 'css', timeout: 4000, animations: 'allow', caret: 'initial' })
      .then(data => { cached.data = data; cached.at = Date.now(); return data; }, () => cached.data)
      .finally(() => { cached.pending = undefined; });
    return cached.pending;
  }

  const send = (res: ServerResponse, status: number, body: string | Buffer, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      ...(type.startsWith('text/html') ? { 'Content-Security-Policy': "default-src 'none'; img-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" } : {}) });
    res.end(body);
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    // Only this PC, only with the token: blocks other machines, other local sites and DNS rebinding.
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, '{}');
    const url = new URL(req.url ?? '/', `http://${host}`);
    const given = url.searchParams.get('t') ?? String(req.headers['x-token'] ?? '');
    if (!sameToken(given, token)) return send(res, 403, '{"error":"token"}');
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${host}`) return send(res, 403, '{}');
    const id = url.pathname.split('/')[3] ?? '';
    const known = (pid: string) => /^[a-f0-9-]{36}$/.test(pid) && hostApi.tiles().some(t => t.profileId === pid);

    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, MANAGER_HTML, 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const tiles = hostApi.tiles();
      for (const pid of shots.keys()) if (!tiles.some(t => t.profileId === pid)) shots.delete(pid);
      return send(res, 200, JSON.stringify({ now: Date.now(), ...hostApi.limit(), tiles }));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/shot/')) {
      if (!known(id)) return send(res, 404, '{}');
      const data = await shot(id);
      return data ? send(res, 200, data, 'image/jpeg') : send(res, 204, '');
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/focus/')) {
      if (!known(id)) return send(res, 404, '{}');
      return send(res, 200, JSON.stringify({ ok: await focusWindow(id) }));
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/close/')) {
      if (!known(id)) return send(res, 404, '{}');
      await hostApi.close(id); shots.delete(id);
      return send(res, 200, '{"ok":true}');
    }
    if (req.method === 'POST' && url.pathname === '/api/close-all') {
      for (const t of hostApi.tiles()) await hostApi.close(t.profileId).catch(() => {});
      shots.clear();
      return send(res, 200, '{"ok":true}');
    }
    return send(res, 404, '{}');
  }
  const hostApi = host;

  const server = createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) send(res, 500, '{}'); else res.end(); }); });
  for (const candidate of ports) {
    const ok = await new Promise<boolean>(resolve => {
      server.once('error', () => resolve(false));
      server.listen(candidate, '127.0.0.1', () => resolve(true));
    });
    if (ok) { port = candidate; break; }
  }
  if (!port) return { url: null, close: async () => {} };
  const url = `http://127.0.0.1:${port}/?t=${token}`;
  await writeFile(info, JSON.stringify({ url, pid: process.pid }), { mode: 0o600 });
  return {
    url,
    close: async () => { await new Promise<void>(r => server.close(() => r())); await unlink(info).catch(() => {}); },
  };
}

/** Restore + raise the Camoufox window whose command line holds this profile's folder. */
export function focusWindow(profileId: string): Promise<boolean> {
  if (!/^[a-f0-9-]{36}$/.test(profileId)) return Promise.resolve(false);
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class SmWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
}
"@
$done = $false
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*camoufox*' -and $_.CommandLine -like '*${profileId}*' } | ForEach-Object {
  $h = (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).MainWindowHandle
  if ($h -and $h -ne 0 -and -not $done) {
    if ([SmWin]::IsIconic($h)) { [SmWin]::ShowWindow($h, 9) | Out-Null }
    # A background process may not take the foreground; a synthetic Alt press lifts that lock.
    [SmWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [SmWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [SmWin]::SetForegroundWindow($h) | Out-Null
    $done = $true
  }
}
if ($done) { 'ok' } else { 'none' }`;
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 }, (error, stdout) => resolve(!error && stdout.trim() === 'ok'));
  });
}

/** `main.js manager`: open the running agent's Browser Manager in an Edge app window. */
export async function openManagerWindow() {
  let info: { url: string } | null = null;
  try { info = JSON.parse(await readFile(infoFile, 'utf8')); } catch { /* not running */ }
  const alive = info ? await fetch(info.url.replace('/?', '/api/state?'), { signal: AbortSignal.timeout(3000) }).then(r => r.ok, () => false) : false;
  if (!info || !alive) {
    execFile('powershell.exe', ['-NoProfile', '-Command', "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Chương trình Social Manager Browser chưa chạy. Mở Start trước rồi thử lại.', 'Browser Manager') | Out-Null"], { windowsHide: true });
    return;
  }
  const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean).map(base => join(base!, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(p => existsSync(p));
  if (edge) {
    spawn(edge, [`--app=${info.url}`, '--window-size=1440,900', `--user-data-dir=${join(root, 'manager-ui')}`, '--no-first-run'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  } else {
    spawn('cmd.exe', ['/c', 'start', '""', info.url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
}

/** Desktop shortcut "Browser Manager" (created once; never overwritten). */
export function ensureShortcut(agentDir: string) {
  const script = `
$desktop = [Environment]::GetFolderPath('Desktop')
$path = Join-Path $desktop 'Browser Manager.lnk'
if (-not (Test-Path $path)) {
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
  $s.TargetPath = '${process.execPath.replace(/'/g, "''")}'
  $s.Arguments = '"' + '${join(agentDir, 'dist', 'main.js').replace(/'/g, "''")}' + '" manager'
  $s.WorkingDirectory = '${agentDir.replace(/'/g, "''")}'
  $s.WindowStyle = 7
  $s.Description = 'Xem tat ca trinh duyet TikTok dang mo'
  $s.IconLocation = 'shell32.dll,15'
  $s.Save()
}`;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000 }, () => {});
}
