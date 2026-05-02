# Deploy lên Cloudflare Pages

App này đã được refactor để chạy được trên Cloudflare qua [`@opennextjs/cloudflare`](https://github.com/opennextjs/opennextjs-cloudflare). DB local dev (better-sqlite3) vẫn hoạt động bình thường — runtime proxy tự switch sang **Cloudflare D1** khi deploy.

## Kiến trúc sau refactor

| Phần | Local (`npm run dev`) | Cloudflare |
|---|---|---|
| Database | `better-sqlite3` → `data/app.db` | **D1** binding `DB` |
| Auth crypto | `scryptSync` (sync) | `scrypt` async (cùng code, đã đổi) |
| Hotmail login | Playwright OK | ❌ throws `not supported on edge` |
| Auto-fetch scheduler | `setInterval` mỗi 4h | ❌ no-op — cần **Cron Worker** riêng |
| Tracker output | `.next/` | `.open-next/worker.js` |

---

## Yêu cầu trước khi deploy

1. **Cloudflare account** + đã `wrangler login` (chạy `npx wrangler login`).
2. **Node.js 20+** trên máy local.
3. **WSL/Linux/macOS** cho `cf:build` — Windows native gặp lỗi symlink permission. Có thể bỏ qua nếu để Cloudflare Pages tự build từ GitHub.

---

## Bước 1 — Tạo D1 database

```bash
cd app
npx wrangler d1 create social-manager
```

Output sẽ in ra:

```toml
[[d1_databases]]
binding = "DB"
database_name = "social-manager"
database_id = "abc123-def456-..."  # ← copy giá trị này
```

Mở `wrangler.toml` và thay `REPLACE_ME_WITH_REAL_D1_ID` bằng `database_id` thực.

## Bước 2 — Apply migrations vào D1

```bash
# Local (test trước, dùng SQLite emulator của wrangler)
npm run db:migrate:local

# Remote (tạo schema thực sự trên Cloudflare D1)
npm run db:migrate:remote
```

Migrations được generate sẵn từ `src/lib/db/schema.ts` qua drizzle-kit. Khi schema đổi, chạy lại:
```bash
npm run db:generate
npm run db:migrate:remote
```

## Bước 3 — Set secrets

App cần các env vars sau (đặt qua `wrangler secret put`):

```bash
cd app
npx wrangler pages secret put ENC_KEY              # 32-byte hex (gen bên dưới)
npx wrangler pages secret put FB_APP_ID
npx wrangler pages secret put FB_APP_SECRET
npx wrangler pages secret put FB_OAUTH_REDIRECT_URI
npx wrangler pages secret put MS_CLIENT_ID
npx wrangler pages secret put MS_CLIENT_SECRET
npx wrangler pages secret put MS_REDIRECT_URI
```

Sinh `ENC_KEY` (CRITICAL — mất key = mất hết token đã encrypt):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Các non-secret env vars (`APP_RUNTIME=cloudflare`) đã có trong `wrangler.toml` `[vars]`.

## Bước 4 — Build + deploy

### Cách A — Push GitHub, để Cloudflare Pages tự build (KHUYẾN NGHỊ)

1. Mở dashboard Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Chọn repo `congtrieugvm-pixel/Social-Manager`.
3. Build settings:
   - **Framework**: None (custom)
   - **Build command**: `cd app && npm install && npm run cf:build`
   - **Build output directory**: `app/.open-next`
   - **Root directory**: `/` (mặc định)
4. **Environment variables (Production)**:
   - `APP_RUNTIME = cloudflare`
   - `NODE_VERSION = 20`
5. Save & Deploy. Cloudflare sẽ:
   - Clone repo
   - `npm install` (Linux env, không bị symlink error như Windows)
   - Chạy `npm run cf:build`
   - Deploy `.open-next/` lên CDN
6. Sau deploy xong, vào tab **Settings** → **Functions** → **D1 database bindings** → add binding name `DB` → chọn `social-manager`. Save → trigger lại deploy.

### Cách B — Build local, deploy bằng wrangler

```bash
cd app
npm run cf:build       # Tạo .open-next/worker.js (cần WSL nếu Windows)
npm run cf:deploy      # = opennextjs-cloudflare deploy
```

## Bước 5 — Tạo admin user đầu tiên

Sau deploy xong, mở `https://social-manager.pages.dev/register`:
- Đăng ký user đầu tiên → **tự động được grant role admin** (logic trong `/api/auth/register`).
- Subsequent users sẽ là `user` thường, admin tự cấp qua `/admin/users`.

Sau khi có admin, có thể tắt self-registration:
```bash
npx wrangler pages secret put DISABLE_REGISTRATION
# nhập: 1
```

## Bước 6 — Setup Cron Worker (cho auto-fetch scheduler)

CF Pages Functions **không hỗ trợ Cron Triggers**. Cần tạo Worker riêng:

1. Tạo folder `cron-worker/` ở repo root:
   ```bash
   mkdir cron-worker && cd cron-worker
   cat > wrangler.toml <<EOF
   name = "social-manager-cron"
   compatibility_date = "2026-04-01"
   main = "src/index.ts"

   [triggers]
   crons = ["0 */4 * * *"]   # mỗi 4h
   EOF

   mkdir src && cat > src/index.ts <<'EOF'
   export default {
     async scheduled(_event: ScheduledEvent, env: { PAGES_URL: string; CRON_SECRET: string }) {
       const res = await fetch(`${env.PAGES_URL}/api/scheduler`, {
         method: "POST",
         headers: { "x-cron-secret": env.CRON_SECRET },
       });
       console.log("[cron]", res.status, await res.text());
     },
   };
   EOF
   ```

2. Set secrets cho cron worker:
   ```bash
   npx wrangler secret put PAGES_URL    # https://social-manager.pages.dev
   npx wrangler secret put CRON_SECRET  # random string, đồng bộ với Pages
   ```

3. Deploy:
   ```bash
   npx wrangler deploy
   ```

> ⚠️ Trên Pages side, cần thêm middleware/check để verify `x-cron-secret` matches `CRON_SECRET` env (chưa implement — TODO).

---

## Limitation đã biết

| Feature | Status trên CF | Workaround |
|---|---|---|
| Hotmail tự động đăng nhập (Playwright) | ❌ throws | Chạy 1 service riêng VPS |
| Auto-fetch scheduler `setInterval` | ❌ no-op | Cron Worker (Bước 6) |
| File upload tạm vào `data/` | ❌ no FS | Chuyển sang R2 nếu cần |
| Local DB browser tools | OK Node, ❌ CF | Dùng `wrangler d1 execute` query |
| Next.js 16.2.x | ⚠️ may crash | Downgrade về 16.0.x nếu gặp issue [#1157](https://github.com/opennextjs/opennextjs-cloudflare/issues/1157) |

## Troubleshooting

- **`EPERM: symlink` khi build local trên Windows** → enable Developer Mode (Settings → Privacy → For developers) hoặc dùng WSL. Hoặc đẩy GitHub để CF tự build.
- **`D1_ERROR: no such table` khi runtime** → migrations chưa apply. Chạy `npm run db:migrate:remote`.
- **`D1 binding DB not found`** → CF Pages → Settings → Functions → D1 database bindings → add `DB`.
- **`ENC_KEY missing`** → secrets chưa set. Quay lại Bước 3.
- **`The action attempted has been deemed abusive`** (FB API) → token bị FB rate-limit. Đợi 5–60ph hoặc dùng ít post hơn. Đã có throttle 400ms/post + early-abort.

## Migrate dữ liệu local sang D1 (tùy chọn)

Nếu muốn copy data từ `data/app.db` (local) sang D1:

```bash
# Export local SQLite ra .sql dump
sqlite3 data/app.db .dump > backup.sql

# Strip CREATE TABLE statements (đã có trong migrations) — giữ INSERT
grep -E "^INSERT" backup.sql > data-only.sql

# Import vào D1
npx wrangler d1 execute social-manager --remote --file=data-only.sql
```

---

## Checklist deploy

- [ ] `wrangler login`
- [ ] `wrangler d1 create social-manager` → cập nhật `database_id` trong `wrangler.toml`
- [ ] `npm run db:migrate:remote`
- [ ] Set tất cả secrets qua `wrangler pages secret put`
- [ ] Push GitHub OR `npm run cf:deploy`
- [ ] Bind D1 trong Pages → Functions → D1 database bindings (UI)
- [ ] Đăng ký user đầu tiên qua `/register`
- [ ] (Optional) Setup Cron Worker
- [ ] Verify: login OK, /fanpage list ra fanpages, /insights chạy được
