import { createRequire } from "node:module";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// Runtime-aware database proxy.
//
// On Node (`npm run dev` / `npm run build` / `npm start`):
//   → lazily initializes better-sqlite3 from `./node.ts` (file-based DB
//     under `data/app.db`, with full schema + seed bootstrap on first run).
//
// On Cloudflare (built via `npm run cf:build` and run as a Worker):
//   → resolves the D1 binding via `getCloudflareContext()` per-request and
//     wraps it with `drizzle-orm/d1`. The `./node.ts` file is NOT bundled
//     (we use eval-based require so esbuild can't statically follow into
//     the better-sqlite3 native module).
//
// All 52 callers continue to `import { db } from "@/lib/db"` unchanged —
// the proxy delegates each property access to the appropriate driver.
//
// Type note: drizzle's bsqlite3 and d1 query builders share the same surface
// (select / insert / update / delete with schema). We type the export as the
// bsqlite3 variant so the 52 callers keep full inference at compile time —
// at runtime the D1 driver behaves identically for these operations.

const isCloudflare = process.env.APP_RUNTIME === "cloudflare";

type Db = BetterSQLite3Database<typeof schema>;

// `createRequire` returns a CommonJS-style require usable inside ESM. The
// path is built from variables so neither the bundler nor Next's static
// import tracer can resolve it — `./node.ts` (which pulls in the
// better-sqlite3 native module) stays out of the Cloudflare Workers bundle.
const dynRequire = createRequire(import.meta.url);

let nodeDbInstance: Db | null = null;
function getNodeDb(): Db {
  if (nodeDbInstance) return nodeDbInstance;
  // String-built specifier defeats nft (Next's file-trace) — this branch is
  // only reached on Node, where the file resolves at runtime against
  // `./src/lib/db/node.ts`.
  const segments = ["./", "node"];
  const mod: { initNodeDb: () => Db } = dynRequire(segments.join(""));
  nodeDbInstance = mod.initNodeDb();
  return nodeDbInstance;
}

function getCfDb(): Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cf = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const d1 = require("drizzle-orm/d1") as typeof import("drizzle-orm/d1");
  // `D1Database` global type only exists in @cloudflare/workers-types, which
  // we intentionally don't add globally (it conflicts with DOM Response.json
  // typing across the whole codebase). drizzle accepts the binding object as
  // its first arg — we don't call methods on it directly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = cf.getCloudflareContext().env as { DB: any };
  return d1.drizzle(env.DB, { schema }) as unknown as Db;
}

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = isCloudflare ? getCfDb() : getNodeDb();
    return Reflect.get(real, prop);
  },
}) as Db;

export { schema };
