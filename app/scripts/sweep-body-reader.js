// Bulk-replace all variants of body-via-req.json() with readBody helper.
// Patterns covered:
//   1. let body: T = {}; try { body = (await req.json()) as T; } catch { ... }
//   2. const body = (await req.json()) as T;
//   3. const body = await req.json() as T;

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve("src/app/api");
const FILES = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "route.ts") FILES.push(full);
  }
}
walk(ROOT);

const PATTERNS = [
  // Pattern 1: let body: T = {}; try { body = (await req.json()) as T; } catch { ... }
  {
    re: /\s*let body:\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*\{\};\s*\n\s*try\s*\{\s*\n\s*body\s*=\s*\(await\s+req\.json\(\)\)\s*as\s*\1;\s*\n\s*\}\s*catch\s*\{[\s\S]*?\n\s*\}/,
    replace: (_m, type) => `\n  const body = await readBody<${type}>(req);`,
  },
  // Pattern 2: const body = (await req.json()) as <Named or { inline }>;
  {
    re: /const\s+body\s*=\s*\(await\s+req\.json\(\)\)\s*as\s*(\{[^}]*\}|[A-Za-z][A-Za-z0-9_]*);/,
    replace: (_m, type) => `const body = await readBody<${type}>(req);`,
  },
  // Pattern 3: const body = await req.json() as <Named or { inline }>;
  {
    re: /const\s+body\s*=\s*await\s+req\.json\(\)\s*as\s*(\{[^}]*\}|[A-Za-z][A-Za-z0-9_]*);/,
    replace: (_m, type) => `const body = await readBody<${type}>(req);`,
  },
];

function insertImport(src) {
  if (/from\s+"@\/lib\/req-body"/.test(src)) return src;
  // Find end of import block — first non-import non-empty line.
  const lines = src.split("\n");
  let lastImport = -1;
  let inMultilineImport = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^import\s/.test(line)) {
      lastImport = i;
      // Detect multiline import: line starts with `import {` and doesn't end with `;`
      if (/^import\s+\{/.test(line) && !/;\s*$/.test(line)) inMultilineImport = true;
      else inMultilineImport = false;
    } else if (inMultilineImport) {
      lastImport = i; // include continuation lines
      if (/}\s+from\s/.test(line) || /;\s*$/.test(line)) inMultilineImport = false;
    } else if (line.trim() && !line.startsWith("//") && !line.startsWith("/*")) {
      break; // first non-import code line
    }
  }
  if (lastImport < 0) return src;
  lines.splice(lastImport + 1, 0, `import { readBody } from "@/lib/req-body";`);
  return lines.join("\n");
}

let changed = 0;
for (const file of FILES) {
  let src = fs.readFileSync(file, "utf8");
  let touched = false;
  for (const { re, replace } of PATTERNS) {
    let prev;
    do {
      prev = src;
      src = src.replace(re, replace);
    } while (src !== prev);
    if (src !== prev || PATTERNS.indexOf({ re, replace }) === -1) {
      // not exactly tracking — just check at the end
    }
  }
  // Recheck: did we change anything?
  const orig = fs.readFileSync(file, "utf8");
  if (src !== orig) {
    src = insertImport(src);
    fs.writeFileSync(file, src, "utf8");
    console.log("updated:", path.relative(process.cwd(), file));
    changed++;
  }
}

console.log(`\nDone. ${changed} file(s) updated.`);
