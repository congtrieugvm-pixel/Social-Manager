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

Menu **Insight** (`/insight`), hoàn toàn độc lập với "Tài khoản Facebook". Tính năng
"Quản lý Fanpage" cũ đã bị gỡ (10/2026) cùng toàn bộ dữ liệu (migration
`0004_drop_fanpages.sql`). Insight **không lưu Trang vào DB** — danh sách Trang đọc
trực tiếp từ Graph bằng các token dán vào Insight.

- **Token:** nút "Token (n)" → dán **User Access Token** (đọc mọi Trang tài khoản đó quản
  lý, cần `pages_show_list` + `read_insights`) hoặc **Page Token**. Server kiểm tra token với
  Graph, lưu mã hóa AES-GCM (bảng `insight_tokens`); trình duyệt chỉ thấy preview `EAA…xxxx`.
  Dán lại token của cùng tài khoản/Trang → cập nhật, không nhân đôi.
- **Phân nhóm:** tạo/sửa/xóa nhóm có màu ("＋ / ✎ Nhóm"), gán Trang vào nhóm ngay trên dòng
  hoặc chọn nhiều Trang → "Chuyển vào nhóm…" (có "＋ Nhóm mới…"). Một Trang thuộc một nhóm
  (bảng `insight_page_groups`, `insight_page_assignments` — migration `0005`). Lọc theo nhóm
  + "Chưa phân nhóm"; xóa nhóm → Trang về "Chưa phân nhóm".
- Kỳ **Hôm nay | 7 ngày | 28 ngày** và nhóm đang lọc được nhớ theo user
  (localStorage `rmf_insight_<user>`). Ô tổng, biểu đồ cột theo ngày, bảng sắp xếp được
  (tiêu đề cố định khi cuộn), tìm Trang, Xuất CSV (UTF-8 BOM, có cột Nhóm).

### Endpoint

| Route | Việc |
|---|---|
| `GET / POST /api/insight/tokens` | danh sách token (không có token gốc) / thêm `{ token, label? }` |
| `PATCH / DELETE /api/insight/tokens/:id` | đổi tên / xóa token |
| `GET /api/insight/tokens/:id/pages` | Trang token đọc được (classic + Business Manager) |
| `GET / POST /api/insight/groups` | nhóm + `assignments { pageId: groupId }` / tạo nhóm `{ name, color }` |
| `PATCH / DELETE /api/insight/groups/:id` | sửa / xóa nhóm |
| `POST /api/insight/assign` | `{ pageIds[], groupId \| null }` gán / bỏ nhóm |
| `GET /api/insight/reach?pageId=&tokens=1,2` | `{ metric, via, ranges: { today, 7d, 28d }, unsupported?, reason? }` — mỗi kỳ `{ reach, prev, daily[], todayPending? }`; 429 `{ cooling: true }` khi mọi token đang bị giới hạn |

### Quyết định về dữ liệu Reach (`src/lib/page-reach.ts`)

- **Metric (đo trên Graph v23 thật, 10/2026):** `page_impressions_unique` và
  `page_posts_impressions_unique` đã bị Meta khai tử (#100 "must be a valid insights metric");
  `page_total_media_view_unique` ("Người xem") chạy cho day/week/days_28. Server thử theo thứ
  tự `page_total_media_view_unique` → `page_impressions_unique` → `page_posts_impressions_unique`,
  nhớ metric dùng được theo Trang. Không metric nào dùng được / thiếu quyền (#10/#200) →
  `unsupported` + lý do tiếng Việt.
- **Một lần gọi cho cả 3 kỳ:** bỏ tham số `period` thì Graph trả cùng lúc chuỗi day, week,
  days_28 (31 ngày gần nhất) → đổi kỳ trên giao diện không gọi lại server.
- **Không cộng dồn reach theo ngày.** Reach là số người duy nhất; cộng giá trị ngày sẽ đếm
  trùng. 7 ngày = `week`, 28 ngày = `days_28`, Hôm nay = `day`. `prev` = giá trị cùng kỳ kết
  thúc đúng N ngày trước.
- Ngày = `end_time` (nửa đêm giờ Thái Bình Dương) trừ 1 ngày. Facebook báo ngày đang chạy là
  0 cho tới khi xử lý xong → Hôm nay = 0 hiển thị "—" + "Facebook chưa cập nhật số liệu hôm nay".
- **Token pool:** Trang đọc được qua nhiều token → xoay vòng token theo Trang (chia tải).
  #4/#17/#613 làm nguội cả token 5 phút; #32/#368 (cấp Trang) chỉ làm nguội token của Trang
  đó. Client tải tối đa 6 Trang song song, cache 3 phút, "Tải lại" bỏ qua cache.
- Test với Graph giả: `FB_GRAPH_BASE=http://127.0.0.1:<port>/v23.0` và `DB_PATH=<db tạm>`.

## Stack

- Next.js 16 App Router + TypeScript + Tailwind
- SQLite (better-sqlite3) + Drizzle ORM
- `@tobyg74/tiktok-api-dl` cho TikTok data
- AES-256-GCM (Node built-in crypto)

## Data

SQLite file tại `app/data/app.db` — backup file này là đủ.
