/* No build/runtime dependencies. Creates a portable ZIP using the ZIP STORE format. */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const out = path.resolve(root, "..", "dist");
fs.mkdirSync(path.join(root, "icons"), { recursive: true });
fs.mkdirSync(out, { recursive: true });
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const label = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([size, label, data, crc]);
}
// A simple geometric lock mark, drawn locally; no external image assets.
for (const size of [16, 32, 48, 128]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size;
    const body = px > .26 && px < .74 && py > .45 && py < .79;
    const r = Math.hypot(px - .5, py - .39);
    const shackle = py < .49 && r > .13 && r < .19;
    const keyhole = Math.abs(px - .5) < .025 && py > .56 && py < .68;
    const color = (body || shackle) && !keyhole ? [225, 237, 197, 255] : [25, 54, 43, 255];
    const i = y * (size * 4 + 1) + 1 + x * 4; color.forEach((v, j) => raw[i + j] = v);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(path.join(root, "icons", `${size}.png`), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
const files = ["manifest.json", "shared.js", "engine.js", "adapter.js", "content.js", "background.js", "popup.html", "popup.css", "popup.js", "README.md", ...[16,32,48,128].map((s) => `icons/${s}.png`)];
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert(/^\d+(?:\.\d+){1,3}$/.test(manifest.version), "Invalid extension version");
const entries = [], central = []; let offset = 0;
for (const name of files) {
  const data = fs.readFileSync(path.join(root, name)); const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(0x5d6e, 12); // Deterministic ZIP date (2026-11-14).
  local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
  directory.writeUInt16LE(0x5d6e, 14); directory.writeUInt32LE(crc32(data), 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(nameBytes.length, 28); directory.writeUInt32LE(offset, 42);
  entries.push(local, nameBytes, data); central.push(directory, nameBytes); offset += local.length + nameBytes.length + data.length;
}
const centralBytes = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
const filename = path.join(out, `tiktok-studio-private-${manifest.version}.zip`);
fs.writeFileSync(filename, Buffer.concat([...entries, centralBytes, end]));
console.log(`${filename}\n${files.length} files; ${fs.statSync(filename).size} bytes`);
// Validate BEFORE exposing a new download. One manifest is the version source
// for the archive, website and metadata; no manually uploaded ZIP can drift.
require("./check.cjs");
if (process.argv.includes("--web")) {
  const publicDir = path.resolve(root, "../app/public/downloads/extensions");
  const generatedDir = path.resolve(root, "../app/src/generated");
  fs.mkdirSync(publicDir, { recursive: true });
  fs.mkdirSync(generatedDir, { recursive: true });
  const zip = fs.readFileSync(filename);
  const sha256 = crypto.createHash("sha256").update(zip).digest("hex");
  const releaseName = `tiktok-studio-private-${manifest.version}-${sha256.slice(0, 12)}.zip`;
  const release = {
    name: manifest.name,
    version: manifest.version,
    filename: path.basename(filename),
    downloadUrl: `/downloads/extensions/${releaseName}`,
    latestUrl: "/downloads/extensions/tiktok-studio-private-latest.zip",
    size: zip.length,
    sha256,
  };
  fs.writeFileSync(path.join(publicDir, releaseName), zip);
  fs.writeFileSync(path.join(publicDir, "tiktok-studio-private-latest.zip"), zip);
  const metadata = JSON.stringify(release, null, 2) + "\n";
  fs.writeFileSync(path.join(publicDir, "latest.json"), metadata);
  fs.writeFileSync(path.join(generatedDir, "extension-release.json"), metadata);
  console.log(`Web download ready: ${release.downloadUrl}`);
}
