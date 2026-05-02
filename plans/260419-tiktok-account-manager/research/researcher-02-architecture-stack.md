# TikTok Account Manager — Architecture Stack Validation
**Date:** 2026-04-19 | **Context:** 500 accounts, 6 syncs/day, auth/RBAC, bulk import, E2E encryption

---

## Stack Validation & Rationale

| Component | Choice | Status | 1-2 Line Rationale |
|-----------|--------|--------|-------------------|
| Framework | Next.js 15 App Router + TS + Tailwind + shadcn/ui | ✅ Validated | Native RSC/server actions; type-safe DB integration; proven SaaS pattern |
| Database | PostgreSQL (Neon serverless) + Drizzle ORM | ✅ Validated | HTTP driver scales to 0; SQL migrations; JSONB for snapshots |
| Auth | Better-Auth + Drizzle adapter | ✅ Validated | Built-in RBAC plugin; email/password; zero lock-in; v1+ stable (April 2026) |
| Sessions | JWT httpOnly cookies + DB session fallback | ✅ Validated | httpOnly prevents XSS; DB for explicit revocation; Better-Auth handles both |
| Job Queue | BullMQ + Upstash Redis (Fixed plan) | ✅ Validated | Repeatable jobs (cron `0 */4 * * *`); concurrency control; Bull Board dashboard |
| Encryption | Node.js `crypto` (AES-256-GCM) + single ENCRYPTION_KEY env | ✅ Validated | No external KMS needed at this scale; IV stored per-record; NIST-approved |
| Storage | Cloudflare R2 + `@aws-sdk/client-s3` | ✅ Validated | S3-compatible; cheaper than AWS S3; `sharp` for WebP resize on upload |
| Deploy | Railway (Next.js service + separate worker service) | ✅ Validated | Nixpacks auto-detects both; remove `startCommand` from railway.json; each service defines own command |

---

## Critical Implementation Notes

### 1. Railway Multi-Service Deployment
**Pattern:** Use **Nixpacks**, no startCommand in shared railway.json
```
railway.json: build config + pre-deploy (db migrate) only
Each service override in Railway dashboard:
  - Web: npm run build && npm start
  - Worker: node dist/worker.js
```
Shared code: Extract job type definitions to `/lib/queue.ts` (imported by both)

**Cost Estimate (500 accounts, 6 syncs/day = 3,000 jobs/day):**
- **Web service:** $5/mo (small container)
- **Worker service:** $5/mo (runs 4h intervals, low idle)
- **PostgreSQL (Neon):** $15/mo (serverless, auto-scale)
- **Redis (Upstash Fixed Plan):** $20/mo (avoid pay-as-you-go; BullMQ incurs ~50 requests/sync)
- **R2 (avatar storage):** <$1/mo (500 accounts × ~10KB avg = 5GB, $0.15/GB)
- **Total:** ~$45–55/mo

### 2. Better-Auth Setup (April 2026)
```typescript
// lib/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { RBAC } from "better-auth/plugins"; // Built-in plugin

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    RBAC({
      roles: ["admin", "manager", "member"], // Custom roles
    }),
  ],
});

// app/api/auth/[...auth].ts (App Router)
import { auth } from "@/lib/auth";
export const { POST, GET } = auth;
```

Session getter for RSC:
```typescript
// lib/session.ts
import { headers } from "next/headers";
import { auth } from "./auth";

export async function getSession() {
  const headersList = headers();
  const cookie = headersList.get("cookie");
  const session = await auth.api.getSession({
    headers: { cookie },
  });
  return session;
}
```

### 3. Drizzle ORM + Neon Best Practices
**Migration Strategy:**
- Dev: `drizzle-kit generate:pg` → inspect → `drizzle-kit migrate:pg`
- Prod: `drizzle-kit migrate:pg` (run before web/worker start in railway.json pre-deploy)
- Driver choice: **Use `postgres` (node-postgres)** for local, Railway handles TCP fine
  - Neon HTTP driver slower for interactive txns; WebSocket driver overkill
  - Drizzle auto-detects & switches to Neon driver in prod if needed

**JSONB for video snapshots:**
```typescript
const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  last_3_videos: jsonb("last_3_videos"), // {id, title, views, created_at}[]
});
```

### 4. BullMQ + Upstash Repeatable Job Pattern
```typescript
// lib/queue.ts (shared by web + worker)
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

const redis = new Redis(process.env.UPSTASH_REDIS_URL);
export const metricsQueue = new Queue("metrics", { connection: redis });

// Schedule repeatable sync
await metricsQueue.add(
  "fetch-all",
  { batchSize: 50 }, // Concurrency control: 5-10 parallel fetches
  {
    repeat: {
      pattern: "0 */4 * * *", // Every 4 hours
    },
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  }
);

// worker.ts
const worker = new Worker(
  "metrics",
  async (job) => {
    const { batchSize } = job.data;
    const accounts = await db.query.accounts.findMany();
    for (let i = 0; i < accounts.length; i += batchSize) {
      await Promise.all(
        accounts.slice(i, i + batchSize).map((acc) => fetchTikTokMetrics(acc))
      );
    }
  },
  {
    connection: redis,
    concurrency: batchSize, // 5–10 concurrent TikTok API calls
  }
);

// Bull Board dashboard (optional web service endpoint)
// GET /api/queues → Bull Board UI
```

**Upstash Fixed Plan:** Prevents cost overruns (BullMQ = request-heavy)

### 5. AES-256-GCM Encryption Helper
```typescript
// lib/crypto.ts
import crypto from "crypto";

const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY!, "hex");

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12); // 96-bit IV (GCM standard)
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("hex");
}

export function decrypt(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "hex");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28); // GCM tag = 16 bytes
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}
```

**Key Management:** Single env var `ENCRYPTION_KEY` (generate once: `openssl rand -hex 32`). No rotation needed for internal data <2yr old.

### 6. Cloudflare R2 + Image Processing
```typescript
// lib/r2.ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const s3 = new S3Client({
  region: "auto",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
  },
  endpoint: process.env.R2_ENDPOINT!,
});

export async function uploadAvatar(buffer: Buffer, accountId: number) {
  const webp = await sharp(buffer)
    .resize(200, 200, { fit: "cover" })
    .webp({ quality: 80 })
    .toBuffer();
  
  const key = `avatars/${accountId}-${Date.now()}.webp`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
    Body: webp,
    ContentType: "image/webp",
  }));
  
  return `https://${process.env.R2_CDN_DOMAIN}/${key}`;
}
```

### 7. shadcn/ui Data Table (500+ rows)
Use **TanStack Table (React Table) v8** + **@tanstack/react-virtual** for virtualization:
```typescript
// components/AccountsTable.tsx
import { useReactTable, getCoreRowModel, getPaginationRowModel } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

// shadcn DataTable wrapper handles sorting/filtering
// Add: virtualizer plugin from TanStack Table docs
// Row height ~40px → smooth scroll 500+ accounts
```

---

## Monthly Cost Breakdown
| Service | Estimate | Notes |
|---------|----------|-------|
| Railway (web + worker) | $10 | 2× small containers, ~5h/day uptime |
| Neon PostgreSQL | $15 | ~10GB data, modest query load |
| Upstash Redis (Fixed) | $20 | 10GB baseline; prevents overage charges |
| Cloudflare R2 | <$1 | 5GB @ $0.15/GB; includes CDN |
| **Total** | **~$45/mo** | Scales linearly to ~$60/mo at 2000 accounts |

---

## Unresolved Questions
1. **RBAC scope:** Better-Auth RBAC plugin supports roles; confirm group-scoped permissions (does plugin support "manager can edit members in group X only")?
2. **TikTok API rate limits:** 6 syncs/day × 500 accounts = batching strategy; confirm TikTok allows 5–10 parallel requests/second
3. **IV storage:** Encrypt() returns IV+tag+ciphertext; confirm DB schema handles variable-length encrypted blobs
4. **Neon connection limits:** Railway worker + web both use Neon; confirm 2 concurrent connections safe (Neon free tier = 3 connections)
5. **Upstash latency:** Worker on Railway US-EAST → Upstash global default; confirm acceptable sync latency for 4h interval

---

## Sources
- [Deploy BullMQ with BullBoard - Railway](https://railway.com/deploy/bull-board)
- [Deploy a Next.js App with Postgres - Railway Guides](https://docs.railway.com/guides/nextjs)
- [BullMQ Documentation](https://docs.bullmq.io)
- [Better Auth with Next.js 15 - Complete Guide](https://noqta.tn/en/tutorials/better-auth-nextjs-authentication-tutorial-2026)
- [Drizzle with Neon Postgres](https://orm.drizzle.team/docs/get-started/neon-new)
- [BullMQ with Upstash Redis](https://upstash.com/docs/redis/integrations/bullmq)
- [BullMQ Repeatable Jobs](https://docs.bullmq.io/guide/jobs/repeatable)
- [Node.js Crypto AES-256-GCM](https://gist.github.com/rjz/15baffeab434b8125ca4d783f4116d81)
- [Makerkit - Next.js Drizzle Better Auth Kits](https://makerkit.dev/blog/changelog/announcing-drizzle-prisma-better-auth-kits)
- [Neon - Drizzle Migrations Guide](https://neon.com/docs/guides/drizzle-migrations)
