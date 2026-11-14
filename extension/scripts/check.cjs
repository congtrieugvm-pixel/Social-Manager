const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ["storage", "alarms"]);
assert.deepEqual(manifest.content_scripts[0].matches, ["https://www.tiktok.com/*"]);
assert(!manifest.externally_connectable && !manifest.web_accessible_resources);
for (const name of ["shared.js", "engine.js", "adapter.js", "content.js", "background.js", "popup.js"]) {
  const code = fs.readFileSync(path.join(root, name), "utf8"); new vm.Script(code, { filename: name });
  assert(!/\beval\s*\(|new Function\s*\(|\bfetch\s*\(|XMLHttpRequest|document\.cookie/.test(code), `Unexpected execution/network primitive in ${name}`);
}
const assets = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons), ...manifest.content_scripts[0].js, "popup.css", "popup.js", "README.md"];
for (const name of assets) assert(fs.existsSync(path.join(root, name)), `Missing ${name}`);
console.log("Manifest, local assets, JavaScript syntax and permission checks passed.");
