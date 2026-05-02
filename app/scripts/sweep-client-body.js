// Convert client-side fetch calls that POST/PATCH JSON bodies to use the
// X-Body header (server has matching readBody helper). Pattern:
//
//   fetch("/api/...", {
//     method: "POST"|"PATCH",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify(X),
//   })
//
// becomes:
//
//   fetch("/api/...", {
//     method: "POST"|"PATCH",
//     headers: { "X-Body": JSON.stringify(X) },
//   })

const fs = require("node:fs");
const path = require("node:path");

const ROOTS = [path.resolve("src/app"), path.resolve("src/lib")];
const FILES = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) FILES.push(full);
  }
}
ROOTS.forEach(walk);

// Match a fetch options object with method (POST/PATCH/PUT/DELETE), headers
// containing Content-Type: application/json, and a body: JSON.stringify(...).
// We rebuild it without Content-Type and move the JSON.stringify(...) into
// the X-Body header.
const FETCH_RE =
  /headers:\s*\{\s*"Content-Type":\s*"application\/json"\s*,?\s*([^}]*)\}\s*,\s*body:\s*JSON\.stringify\(([\s\S]*?)\),/g;

let changed = 0;
for (const file of FILES) {
  const orig = fs.readFileSync(file, "utf8");
  // Skip files that don't even mention Content-Type to save work.
  if (!/"Content-Type":\s*"application\/json"/.test(orig)) continue;
  if (!/body:\s*JSON\.stringify/.test(orig)) continue;

  const next = orig.replace(FETCH_RE, (_m, otherHeaders, payload) => {
    // Trim trailing comma/whitespace from otherHeaders
    const extra = otherHeaders.replace(/^[\s,]+|[\s,]+$/g, "");
    const merged = extra
      ? `headers: { "X-Body": JSON.stringify(${payload.trim()}), ${extra} },`
      : `headers: { "X-Body": JSON.stringify(${payload.trim()}) },`;
    return merged;
  });
  if (next !== orig) {
    fs.writeFileSync(file, next, "utf8");
    console.log("updated:", path.relative(process.cwd(), file));
    changed++;
  }
}

console.log(`\nDone. ${changed} file(s) updated.`);
