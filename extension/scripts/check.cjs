const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ["storage", "alarms"]);
// The only network the extension may touch is the Social Manager web app (for "Lưu kênh YouTube").
assert.deepEqual(manifest.host_permissions, ["https://social-manager.congtrieugvm.workers.dev/*"]);
assert.equal(manifest.content_scripts.length, 2);
assert.deepEqual(manifest.content_scripts[0].matches, ["https://www.tiktok.com/*"]);
assert.deepEqual(manifest.content_scripts[1].matches, ["https://www.youtube.com/*"]);
assert(!manifest.externally_connectable && !manifest.web_accessible_resources);

// No eval/dynamic code, no raw XHR, no cookie reading — in any script.
const DANGER = /\beval\s*\(|new Function\s*\(|XMLHttpRequest|document\.cookie/;
for (const name of ["shared.js", "engine.js", "adapter.js", "content.js", "youtube.js", "background.js", "popup.js"]) {
  const code = fs.readFileSync(path.join(root, name), "utf8");
  new vm.Script(code, { filename: name });
  assert(!DANGER.test(code), `Unexpected execution/cookie primitive in ${name}`);
  // Only the background service worker may make network calls; everything else stays offline.
  if (name !== "background.js") assert(!/\bfetch\s*\(/.test(code), `Unexpected fetch in ${name}`);
}
// The background call uses a Bearer API key, never the web session cookie.
const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");
assert(!/credentials\s*:/.test(bg), "background.js must not send cookies (credentials)");

const assets = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons),
  ...manifest.content_scripts.flatMap((c) => c.js), "popup.css", "popup.js", "README.md"];
for (const name of assets) assert(fs.existsSync(path.join(root, name)), `Missing ${name}`);
console.log("Manifest, local assets, JavaScript syntax and permission checks passed.");
