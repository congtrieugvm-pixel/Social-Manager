const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
function readZip(bytes) {
  const files = new Map(); let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0, "Expected uncompressed portable ZIP");
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    files.set(name, bytes.subarray(start, start + size)); offset = start + size;
  }
  assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
  return files;
}
test("web release matches ZIP; subsequent source/version updates change download without a manual upload", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tsp-release-"));
  try {
    const target = path.join(temp, "extension"); fs.mkdirSync(path.join(target, "scripts"), { recursive: true });
    const files = ["manifest.json", "shared.js", "engine.js", "adapter.js", "content.js", "background.js", "popup.html", "popup.css", "popup.js", "README.md", "scripts/package.cjs", "scripts/check.cjs"];
    for (const file of files) fs.copyFileSync(path.join(root, file), path.join(target, file));
    const build = () => {
      execFileSync(process.execPath, [path.join(target, "scripts/package.cjs"), "--web"], { stdio: "pipe" });
      const release = JSON.parse(fs.readFileSync(path.join(temp, "app/src/generated/extension-release.json")));
      const publicDir = path.join(temp, "app/public");
      const bytes = fs.readFileSync(path.join(publicDir, release.downloadUrl));
      assert.equal(sha(bytes), release.sha256); assert.equal(bytes.length, release.size);
      assert.deepEqual(bytes, fs.readFileSync(path.join(publicDir, release.latestUrl)));
      assert.deepEqual(release, JSON.parse(fs.readFileSync(path.join(publicDir, "downloads/extensions/latest.json"))));
      const contents = readZip(bytes); assert.equal(contents.size, 14);
      assert.equal(JSON.parse(contents.get("manifest.json")).version, release.version);
      for (const file of contents.keys()) assert(!/\.env|app\.db|node_modules|tests|AGENTS|scripts/.test(file));
      return release;
    };
    const first = build();
    assert.deepEqual(build(), first, "Unchanged sources must generate the same release");
    fs.appendFileSync(path.join(target, "engine.js"), "\n// release fixture change\n");
    const sourceUpdate = build(); assert.notEqual(sourceUpdate.downloadUrl, first.downloadUrl);
    const manifest = JSON.parse(fs.readFileSync(path.join(target, "manifest.json"))); manifest.version = "2.0.0";
    fs.writeFileSync(path.join(target, "manifest.json"), JSON.stringify(manifest));
    const versionUpdate = build(); assert.equal(versionUpdate.version, "2.0.0"); assert.match(versionUpdate.filename, /2\.0\.0\.zip$/);
    assert.notEqual(versionUpdate.sha256, sourceUpdate.sha256);
  } finally {
    const resolved = fs.realpathSync(temp), parent = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(resolved).toLowerCase(), parent.toLowerCase());
    assert(path.basename(resolved).startsWith("tsp-release-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
