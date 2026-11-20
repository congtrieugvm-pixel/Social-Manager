import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './storage.js';

// Pair once, then the agent starts by itself at every Windows sign-in: a Startup-folder
// shortcut runs a small hidden VBScript that keeps the agent alive (restarts it after a
// crash; stops when it exits on purpose: Stop.cmd = 0, already running / not paired = 3).

/** Exit code meaning "don't restart me". */
export const EXIT_NO_RESTART = 3;
const LINK = 'Social Manager Browser.lnk';
const vbs = join(root, 'autostart.vbs');
const q = (s: string) => s.replace(/"/g, '""');

export function supervisorScript(node: string, mainJs: string, dir: string) {
  return [
    "' Social Manager Browser: started at Windows sign-in, keeps the agent running.",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = "${q(dir)}"`,
    'Do',
    `  code = sh.Run("""${q(node)}"" ""${q(mainJs)}""", 0, True)`,
    `  If code = 0 Or code = ${EXIT_NO_RESTART} Then Exit Do`,
    '  WScript.Sleep 15000',
    'Loop',
    '',
  ].join('\r\n');
}

function powershell(script: string) {
  return new Promise<string>(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000 }, (e, out) => resolve(e ? '' : out.trim())));
}
const psq = (s: string) => s.replace(/'/g, "''");

/** (Re)write the supervisor with the current node/agent paths and make sure the Startup shortcut exists. */
export async function ensureAutostart(agentDir: string) {
  await writeFile(vbs, supervisorScript(process.execPath, join(agentDir, 'dist', 'main.js'), agentDir), 'utf8');
  return powershell(`
$path = Join-Path ([Environment]::GetFolderPath('Startup')) '${LINK}'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($path)
$s.TargetPath = (Join-Path $env:SystemRoot 'System32\\wscript.exe')
$s.Arguments = '"${psq(vbs)}"'
$s.WorkingDirectory = '${psq(agentDir)}'
$s.Description = 'Tu dong ket noi trinh duyet Social Manager khi mo may'
$s.Save()
'ok'`);
}

/** `main.js autostart off`: stop starting with Windows (the running agent keeps running). */
export function disableAutostart() {
  return powershell(`Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Startup')) '${LINK}') -ErrorAction SilentlyContinue; 'ok'`);
}
