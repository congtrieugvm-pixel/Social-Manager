// Remove Node-only deps from node_modules right before the Cloudflare bundle
// step. opennextjs's esbuild follows transitive requires inside playwright →
// playwright-core → chromium-bidi and fails on Linux build envs where module
// hoisting differs from Windows. Our runtime never loads these on CF
// (IS_EDGE / APP_RUNTIME=cloudflare guards), so deleting them on disk is the
// cleanest way to stop the bundler from walking into them.
//
// After this script runs, `npm install` is needed again to restore playwright
// for local Node use (the dev server / hotmail-login feature). On CF we
// don't care — bundle is already built, runtime never reaches them.

const fs = require("node:fs");
const path = require("node:path");

const TARGETS = [
  "node_modules/playwright",
  "node_modules/playwright-core",
  "node_modules/chromium-bidi",
];

let removed = 0;
for (const rel of TARGETS) {
  const abs = path.resolve(rel);
  try {
    if (!fs.existsSync(abs)) continue;
    fs.rmSync(abs, { recursive: true, force: true });
    console.log(`[clean-cf-deps] removed ${rel}`);
    removed++;
  } catch (e) {
    console.warn(`[clean-cf-deps] failed to remove ${rel}: ${e.message}`);
  }
}
console.log(`[clean-cf-deps] done — ${removed} folder(s) removed`);
