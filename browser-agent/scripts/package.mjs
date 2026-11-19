import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Zip = require('adm-zip');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, '.package', 'build-' + Date.now());
await fs.mkdir(stage, { recursive: true });
const run = (args, cwd) => {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('Build failed');
};
run(['run', 'build'], root);
for (const name of ['package.json', 'package-lock.json', 'README.md', 'Setup.vbs', 'setup.ps1', 'Stop.cmd', 'dist']) {
  await fs.cp(path.join(root, name), path.join(stage, name), { recursive: true });
}
run(['ci', '--omit=dev', '--ignore-scripts'], stage);
const version = 'v24.14.1';
const base = `https://nodejs.org/dist/${version}/`;
const filename = `node-${version}-win-x64.zip`;
const fetchOk = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`Download failed: ${r.status}`); return r; };
const sums = await (await fetchOk(base + 'SHASUMS256.txt')).text();
const expected = sums.split('\n').find(line => line.trim().endsWith(' ' + filename))?.trim().split(/\s+/)[0];
if (!expected) throw new Error('Missing official runtime checksum');
const runtime = Buffer.from(await (await fetchOk(base + filename)).arrayBuffer());
const hash = value => createHash('sha256').update(value).digest('hex');
if (hash(runtime) !== expected) throw new Error('Node checksum mismatch');
const nodeZip = new Zip(runtime);
for (const [src, dest] of [['node.exe', 'node.exe'], ['LICENSE', 'NODE-LICENSE']]) {
  await fs.writeFile(path.join(stage, dest), nodeZip.readFile(`node-${version}-win-x64/${src}`));
}
const files = [];
async function walk(dir, rel = '') {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const name = path.posix.join(rel, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Unexpected symbolic link: ' + name);
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), name);
    else {
      if (/(^|\/)(\.env(?:\..*)?|connection\.json|identity\.json|session\.lock)$|\.(db|sqlite|sqlite3|log)$/i.test(name)) throw new Error('Forbidden release file: ' + name);
      files.push(name);
    }
  }
}
await walk(stage);
const manifest = [];
for (const name of files.sort()) manifest.push(`${hash(await fs.readFile(path.join(stage, name)))}  ${name}`);
await fs.writeFile(path.join(stage, 'SHA256SUMS'), manifest.join('\n') + '\n');
const zip = new Zip(); zip.addLocalFolder(stage);
const output = path.resolve(root, '../dist'); await fs.mkdir(output, { recursive: true });
const { version: agentVersion } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const releaseName = `social-manager-browser-${agentVersion}-win-x64.zip`;
const archive = zip.toBuffer(); await fs.writeFile(path.join(output, releaseName), archive);
const verify = new Zip(archive);
for (const line of manifest) {
  const [expectedHash, name] = line.split('  ');
  if (hash(verify.readFile(name)) !== expectedHash) throw new Error('Archive verification failed: ' + name);
}
const release = { version: '1.0.3', filename: releaseName, size: archive.length, sha256: hash(archive), files: files.length, node: version, browser: '158.0.1-beta.41', status: 'experimental' };
await fs.writeFile(path.join(output, releaseName + '.json'), JSON.stringify(release, null, 2));
console.log(JSON.stringify(release, null, 2));
