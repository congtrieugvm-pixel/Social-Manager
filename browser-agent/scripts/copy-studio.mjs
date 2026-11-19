// Copy the TikTok Studio Private engine (extension/) into dist/studio so the
// agent can run the same, already-tested DOM logic inside a Camoufox page.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '../extension');
const target = path.join(root, 'dist', 'studio');
await fs.mkdir(target, { recursive: true });
for (const file of ['shared.js', 'adapter.js', 'engine.js']) {
  const text = await fs.readFile(path.join(source, file), 'utf8');
  if (/\bchrome\./.test(text)) throw new Error(`${file} uses chrome.* APIs; it cannot run inside the agent page`);
  await fs.writeFile(path.join(target, file), text);
}
console.log('Copied TikTok Studio engine to dist/studio');
