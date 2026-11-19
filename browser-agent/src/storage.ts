import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export const root = join(process.env.LOCALAPPDATA || '', 'SocialManagerBrowser');
export async function saveJson(file: string, value: unknown) {
  await writeFile(file + '.tmp', JSON.stringify(value), { mode: 0o600 });
  await rename(file + '.tmp', file);
}
export function siteKey(origin: string, owner: number) { return createHash('sha256').update(`${origin}/${owner}`).digest('hex').slice(0, 32); }
export function validateOrigin(raw: string) {
  const u = new URL(raw);
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash ||
      !(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))) throw new Error('INVALID_SITE');
  return u.origin;
}
export function dpapi(value: string, decrypt = false): Promise<string> {
  if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $r=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = ''; p.stdout.on('data', d => { out += d; });
    p.on('error', () => reject(new Error('TOKEN_STORAGE_FAILED')));
    p.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error('TOKEN_STORAGE_FAILED')));
    p.stdin.end(decrypt ? value : Buffer.from(value).toString('base64'));
  });
}
export interface Settings { origin: string; ownerId: number; deviceId: string; token: string }
export async function saveSettings(s: Settings) {
  await mkdir(root, { recursive: true });
  await saveJson(join(root, 'connection.json'), { ...s, token: await dpapi(s.token) });
}
export async function settings(): Promise<Settings> {
  const s = JSON.parse(await readFile(join(root, 'connection.json'), 'utf8')) as Settings;
  s.origin = validateOrigin(s.origin);
  s.token = Buffer.from(await dpapi(s.token, true), 'base64').toString();
  return s;
}
