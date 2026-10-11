# TikTok Account Manager

Webapp nội bộ quản lý tài khoản TikTok.

## Tính năng MVP

- Import bulk tài khoản theo định dạng `username|password|email|2fa|email_password`
- Lưu credentials mã hóa AES-256-GCM (SQLite local)
- Button **Lấy Follow** — cập nhật follower/following/video count + avatar
- Button **Lấy Video** — lấy 3 video gần nhất (view, like, cover)
- Xem chi tiết tài khoản, copy credentials, edit note, xóa
- Tìm kiếm theo username/note

## Chạy local

```bash
cd app
npm install
npm run dev
```

Mở http://localhost:3000

## Env (optional)

Copy `.env.local.example` → `.env.local` và set `ENCRYPTION_KEY`.
Không set → dùng dev fallback (OK cho local).

Tạo key:
```bash
openssl rand -base64 32
```

## Lấy code Hotmail (OAuth2 Microsoft Graph)

Tính năng chuột phải → **Lấy code Hotmail** gọi Graph API đọc 15 email mới nhất,
regex OTP 6 số, copy vào clipboard.

### Setup Azure AD app (1 lần cho cả hệ thống)

1. Vào https://portal.azure.com → **Azure Active Directory** → **App registrations** → **New registration**
2. Điền:
   - Name: `TikTok Manager`
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (hoặc "Personal Microsoft accounts only" nếu chỉ dùng Hotmail)
   - Redirect URI → **Web** → `http://localhost:3000/api/oauth/microsoft/callback`
3. Sau khi tạo, copy **Application (client) ID** vào `AZURE_CLIENT_ID`
4. Vào **Certificates & secrets** → **Client secrets** → **New client secret** → copy **Value** (không phải Secret ID) vào `AZURE_CLIENT_SECRET`
5. Vào **API permissions** → **Add a permission** → Microsoft Graph → **Delegated permissions** → tick:
   - `Mail.Read`
   - `offline_access`
   - `User.Read`
6. Set các biến trong `.env.local`:
   ```
   AZURE_CLIENT_ID=<client id>
   AZURE_CLIENT_SECRET=<client secret value>
   AZURE_TENANT=common
   AZURE_REDIRECT_URI=http://localhost:3000/api/oauth/microsoft/callback
   ```
7. Restart `npm run dev`

### Cách dùng

- Chuột phải vào 1 account → **Lấy code Hotmail**
- Lần đầu: popup hiện consent Microsoft → đăng nhập Hotmail của account đó → OK
- Token (refresh + access) được mã hoá AES-256-GCM lưu vào DB, gắn với account
- Lần sau: click → auto refresh token → fetch inbox → trả OTP 6 số, tự copy clipboard
- Nút **Ngắt kết nối** xoá token nếu cần đăng nhập Microsoft khác

## Insight — Lượt tiếp cận (Reach) của Trang

Menu **Insight** (`/insight`). Tính năng "Quản lý Fanpage" đã bị gỡ (10/2026) cùng
toàn bộ dữ liệu (`fanpages`, `fanpage_posts`, `fanpage_snapshots`, `insight_groups`
— migration `0004_drop_fanpages.sql`). Insight **không lưu Trang vào DB**: danh sách
Trang được đọc trực tiếp từ Graph bằng token của từng tài khoản Facebook.

- Kỳ: **Hôm nay | 7 ngày | 28 ngày** (nhớ theo user: localStorage `rmf_insight_<user>`).
- Ô tổng: tổng reach (cộng các Trang — người xem nhiều Trang có thể bị tính nhiều lần),
  số Trang có dữ liệu, Trang reach cao nhất, % so với kỳ liền trước.
- Biểu đồ cột reach theo ngày (7/28 ngày), bảng từng Trang sắp xếp được, Xuất CSV (UTF-8 BOM).
- Lọc theo nhóm: Trang thuộc nhóm của các tài khoản Facebook quản lý nó.

### Endpoint

| Route | Trả về |
|---|---|
| `GET /api/insight/accounts` | tài khoản FB có token + nhóm |
| `GET /api/insight/accounts/:id/pages` | Trang mà tài khoản đó quản lý (classic + Business Manager) |
| `GET /api/insight/reach?pageId=&range=today\|7d\|28d&accounts=1,2` | `{ range, metric, reach, prev, daily[], via, todayPending?, unsupported?, reason? }` — 429 `{ cooling: true }` khi mọi token đang bị giới hạn |

### Quyết định về dữ liệu Reach (`src/lib/page-reach.ts`)

- **Không cố định một metric.** Meta đã ngừng nhiều metric Page Insights năm 2025. Server
  thử lần lượt `page_impressions_unique` → `page_total_media_view_unique` →
  `page_posts_impressions_unique`; gặp lỗi metric không hợp lệ (#100) thì thử metric kế,
  nhớ metric dùng được theo Trang. Không metric nào dùng được, hoặc thiếu quyền (#10/#200)
  → `unsupported` + lý do tiếng Việt (cần `read_insights` / Advanced Access).
- **Không cộng dồn reach theo ngày.** Reach là số người duy nhất; cộng 7 giá trị ngày sẽ
  đếm trùng người xem nhiều ngày. 7 ngày dùng `period=week`, 28 ngày dùng `period=days_28`,
  Hôm nay dùng `period=day`. `prev` = giá trị cùng kỳ kết thúc đúng N ngày trước.
- Ngày = `end_time` (nửa đêm giờ Thái Bình Dương) trừ 1 ngày. Hôm nay chưa có số →
  hiện "—" + "Facebook chưa cập nhật số liệu hôm nay", không hiện 0.
- **Token pool:** một Trang có thể được nhiều tài khoản quản lý → nhiều token. Server xoay
  vòng token theo Trang (chia tải). Lỗi giới hạn #4/#17/#613 làm nguội cả tài khoản 5 phút;
  #32/#368 (cấp Trang) chỉ làm nguội token của Trang đó. Client tải tối đa 6 Trang song song,
  cache 3 phút, "Tải lại" bỏ qua cache.
- Test với Graph giả: đặt `FB_GRAPH_BASE=http://127.0.0.1:<port>/v23.0` và `DB_PATH=<db tạm>`.

## Stack

- Next.js 16 App Router + TypeScript + Tailwind
- SQLite (better-sqlite3) + Drizzle ORM
- `@tobyg74/tiktok-api-dl` cho TikTok data
- AES-256-GCM (Node built-in crypto)

## Data

SQLite file tại `app/data/app.db` — backup file này là đủ.
