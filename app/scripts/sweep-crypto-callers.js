// Convert all sync `decrypt(...)` / `encrypt(...)` callsites to await.
// crypto.ts switched to Web Crypto (async) to bypass unenv polyfill bug
// on Cloudflare Workers.
//
// Patterns we rewrite:
//   `decrypt(x)` → `await decrypt(x)`
//   `encrypt(x)` → `await encrypt(x)`
// Skip lines that already have `await` immediately before the call, so
// re-running is safe.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve("src");
const FILES = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) FILES.push(full);
  }
}
walk(ROOT);

// Skip the helper itself.
const SKIP = new Set([
  path.resolve("src/lib/crypto.ts"),
]);

let changed = 0;
for (const file of FILES) {
  if (SKIP.has(file)) continue;
  const orig = fs.readFileSync(file, "utf8");
  if (!/\b(decrypt|encrypt)\s*\(/.test(orig)) continue;

  // Replace `decrypt(` or `encrypt(` not preceded by `await ` or by
  // identifier characters (so `safeDecrypt(` doesn't match).
  const next = orig.replace(
    /(^|[^\w.])(decrypt|encrypt)\s*\(/g,
    (_m, prefix, name) => {
      // Don't double-await
      if (/await\s*$/.test(prefix)) return `${prefix}${name}(`;
      return `${prefix}await ${name}(`;
    },
  );

  if (next !== orig) {
    fs.writeFileSync(file, next, "utf8");
    console.log("updated:", path.relative(process.cwd(), file));
    changed++;
  }
}

console.log(`\nDone. ${changed} file(s) updated.`);
