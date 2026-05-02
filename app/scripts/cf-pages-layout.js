// opennextjs-cloudflare 1.x targets Cloudflare Workers — its build output is
// `.open-next/worker.js` + `.open-next/assets/`. Cloudflare Pages "advanced
// mode" instead expects `_worker.js` (with leading underscore) sitting AT
// THE ROOT of the build output directory, alongside static assets.
//
// Reorganize the output so a single Pages build output dir
// (`app/.open-next/assets`) contains everything Pages needs:
//   - static assets at root (already placed here by opennextjs)
//   - _worker.js  ← copied from ../worker.js
//
// Set the Cloudflare Pages "Build output directory" setting to
// `app/.open-next/assets` for this layout to work.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(".open-next");
const SRC_WORKER = path.join(ROOT, "worker.js");
const ASSETS_DIR = path.join(ROOT, "assets");
const DST_WORKER = path.join(ASSETS_DIR, "_worker.js");

if (!fs.existsSync(SRC_WORKER)) {
  console.error(`[cf-pages-layout] missing ${SRC_WORKER} — did opennext build run?`);
  process.exit(1);
}
if (!fs.existsSync(ASSETS_DIR)) {
  console.error(`[cf-pages-layout] missing ${ASSETS_DIR} — opennext output unexpected`);
  process.exit(1);
}

// _worker.js as a directory of compiled chunks isn't supported in advanced
// mode — Pages requires a single file. opennextjs's worker.js is already
// bundled to a single file, so a copy is sufficient.
fs.copyFileSync(SRC_WORKER, DST_WORKER);
console.log(`[cf-pages-layout] copied ${path.relative(process.cwd(), SRC_WORKER)} → ${path.relative(process.cwd(), DST_WORKER)}`);

// Pages also expects a `_routes.json` if we want to skip _worker.js for
// purely-static asset paths. Generate a permissive one if missing.
const ROUTES = path.join(ASSETS_DIR, "_routes.json");
if (!fs.existsSync(ROUTES)) {
  const routes = {
    version: 1,
    include: ["/*"],
    exclude: ["/_next/static/*", "/favicon.ico"],
  };
  fs.writeFileSync(ROUTES, JSON.stringify(routes, null, 2));
  console.log(`[cf-pages-layout] wrote default ${path.relative(process.cwd(), ROUTES)}`);
}

console.log("[cf-pages-layout] done — Pages-compatible layout ready");
