// Sweep simple dimension-table list/insert routes (statuses, countries,
// machines, employees, insight-groups) to add owner_user_id filtering.
//
// Patterns these files share:
//   GET — db.select(...).from(TABLE).orderBy(...)
//   POST — db.insert(TABLE).values({ name, color, ... })
//
// We add owner filtering via getOwnerId() + WHERE clause + ownerUserId on
// inserts. UNIQUE-constraint catch is replaced with per-user dup check.

const fs = require("node:fs");
const path = require("node:path");

const ROUTES = [
  ["src/app/api/statuses/route.ts", "statuses"],
  ["src/app/api/countries/route.ts", "countries"],
  ["src/app/api/machines/route.ts", "machines"],
  ["src/app/api/employees/route.ts", "employees"],
  ["src/app/api/insight-groups/route.ts", "insightGroups"],
];

let changed = 0;
for (const [rel, tableSym] of ROUTES) {
  const file = path.resolve(rel);
  if (!fs.existsSync(file)) {
    console.warn("missing:", rel);
    continue;
  }
  let src = fs.readFileSync(file, "utf8");
  const before = src;

  // Add scope import if missing.
  if (!/from\s+"@\/lib\/scope"/.test(src)) {
    src = src.replace(
      /(import\s+\{\s*readBody\s*\}\s+from\s+"@\/lib\/req-body";)/,
      `$1\nimport { getOwnerId } from "@/lib/scope";`,
    );
    if (!/getOwnerId/.test(src)) {
      // Fallback: insert after first import line.
      src = src.replace(
        /^(import [^\n]+;\n)/m,
        `$1import { getOwnerId } from "@/lib/scope";\n`,
      );
    }
  }

  // Add `and` to drizzle import (idempotent).
  src = src.replace(
    /from\s+"drizzle-orm"/,
    (m, _o) => m,
  );
  if (/import\s+\{[^}]*\}\s+from\s+"drizzle-orm"/.test(src) && !/\band\b[^"]*"drizzle-orm"/s.test(src)) {
    src = src.replace(
      /import\s+\{([^}]*)\}\s+from\s+"drizzle-orm"/,
      (_m, inner) => `import { and,${inner.replace(/^,?\s*/, " ")} } from "drizzle-orm"`,
    );
  }

  // GET handler: insert const ownerId = await getOwnerId(); after `export async function GET() {`
  src = src.replace(
    /export async function GET\([^)]*\)\s*\{\n/,
    (m) => `${m}  const ownerId = await getOwnerId();\n`,
  );

  // POST handler: insert ownerId line at start.
  src = src.replace(
    /export async function POST\([^)]*\)\s*\{\n/,
    (m) => `${m}  const ownerId = await getOwnerId();\n`,
  );

  // Add WHERE filter to GET select if not already present.
  // Match `.from(TABLE)\n` then anything until `.orderBy` and inject `.where(eq(TABLE.ownerUserId, ownerId))`.
  // Simpler: add `.where(...)` right before `.orderBy`.
  const orderByPat = new RegExp(`(\\.from\\(${tableSym}\\)[\\s\\S]*?)(\\.orderBy)`);
  if (orderByPat.test(src) && !src.includes(`eq(${tableSym}.ownerUserId, ownerId)`)) {
    src = src.replace(
      orderByPat,
      `$1.where(eq(${tableSym}.ownerUserId, ownerId))$2`,
    );
  }

  // INSERT: add ownerUserId on .values({ ... })
  // Match .insert(TABLE).values({ then add ownerUserId: ownerId, after the {
  const insertPat = new RegExp(`(\\.insert\\(${tableSym}\\)\\s*\\.values\\(\\{)`);
  if (insertPat.test(src) && !src.includes(`ownerUserId: ownerId`)) {
    src = src.replace(insertPat, `$1 ownerUserId: ownerId,`);
  }

  if (src !== before) {
    fs.writeFileSync(file, src, "utf8");
    console.log("updated:", rel);
    changed++;
  } else {
    console.log("no change:", rel);
  }
}
console.log(`\nDone. ${changed} file(s) updated.`);
