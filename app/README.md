# TikTok Account Manager

Webapp nội bộ quản lý tài khoản TikTok.

## Tính năng MVP

- Import bulk tài khoản theo định dạng `username|password|email|2fa|email_password`
- Lưu credentials mã hóa AES-256-GCM (SQLite local)
- Button **Lấy Follow** — cập nhật follower/following/video count + avatar
- Button **Lấy Video** — lấy 3 video gần nhất (view, like, cover)
- Xem chi tiết tài khoản, copy credentials, edit note, xóa
- Tìm kiếm theo username/note

## Thông tin mail của tài khoản TikTok

- Mở **Sửa tài khoản** để lưu **Mail khôi phục**, **Token Mail** và **Client ID của mail**.
  Cả ba trường đều không bắt buộc; để trống để xóa giá trị đã lưu. Token Mail có nút Ẩn/Hiện.
- Xem/copy từng trường trong chi tiết tài khoản hoặc menu chuột phải. Khi xuất, chọn các
  trường cần lấy. Khi nhập, chọn mẫu **8 cột (Mail khôi phục, Token Mail, Client ID)**:
  `username|password|email|2fa|email_password|recovery_email|mail_token|mail_client_id`.
  Mẫu 5 cột cũ vẫn dùng được.
- Mail khôi phục và Token Mail nhập tay được mã hóa AES-256-GCM. Client ID lưu dạng văn bản.
  Đây là thông tin lưu trữ; kết nối **Get Token / Get Code** tiếp tục dùng OAuth Hotmail riêng.
- SQLite local tự thêm cột khi khởi động. Trên D1, chạy migration
  `0014_account_mail_fields.sql` trước khi triển khai (`npm run db:migrate:remote`).
- Kiểm tra lưu/đọc, mã hóa, phân quyền, nhập/xuất và chuyển tài khoản:
  `npm run test:account-mail-fields` (SQLite trong bộ nhớ, không dùng dữ liệu thật).

## Chạy local

### Tiện ích trình duyệt

Menu **Tiện ích** (`/utilities`, trên điện thoại: **Thêm → Tiện ích**) cung cấp bản
tải TikTok Studio Private, phiên bản, dung lượng, SHA-256 và hướng dẫn cài/cập nhật.
Trang yêu cầu đăng nhập; các file ZIP và metadata phát hành là tài nguyên công khai.

`npm run dev` và `npm run build` tự đóng gói extension qua hook `predev` / `prebuild`.
Cloudflare/OpenNext gọi `npm run build`, nên workflow push `main` hiện có tự phát hành
extension cùng web. Có thể chạy riêng `npm run extensions:build`. Không cần sửa workflow
hoặc thêm secrets. Các file tại `public/downloads/extensions/` và
`src/generated/extension-release.json` được sinh tự động và không commit.

Khi sửa extension, tăng version trong `../extension/manifest.json`, kiểm thử rồi push
`main`. Nút tải dùng tên file có hash để tránh cache cũ; địa chỉ cố định
`/downloads/extensions/tiktok-studio-private-latest.zip` luôn là bản của lần deploy mới
nhất. Người đã cài Load unpacked vẫn phải thay file và bấm Reload trong trình duyệt.

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

Chuột phải vào tài khoản TikTok → **Hotmail OAuth2**:
**Get Token** kết nối Microsoft và tự lưu token; **Get Code** đọc mã TikTok qua Graph API.
Chạy được trên Node/SQLite và Cloudflare Workers/D1, không cần Chromium để lấy mã.

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
   AZURE_TENANT=consumers
   AZURE_REDIRECT_URI=http://localhost:3000/api/oauth/microsoft/callback
   ```
7. Restart `npm run dev`

Trên Cloudflare, cấu hình `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT`,
`AZURE_REDIRECT_URI` và `ENCRYPTION_KEY` trong Variables/Secrets của Worker.
Client secret và khóa mã hóa phải là secrets. Callback phải dùng đúng domain HTTPS
đang mở ứng dụng và phải được đăng ký loại **Web**, không phải SPA. Giữ nguyên
`ENCRYPTION_KEY` hiện có để tiếp tục giải mã dữ liệu đã lưu.

Áp dụng migration `0013_hotmail_oauth.sql` trước khi triển khai phiên bản mới trên D1
(`npm run db:migrate:remote`; workflow deploy hiện tại cũng chạy migrations).
SQLite local tự thêm các cột còn thiếu khi khởi động.

### Cách dùng

- Email mới nhập: chọn **Get Token**, đăng nhập đúng Hotmail và cấp quyền đọc thư.
  Email được gợi ý sẵn. Nếu Microsoft yêu cầu MFA/xác minh, người dùng hoàn tất trong popup.
  Email + mật khẩu không được tự đổi thành token bằng ROPC cho tài khoản Microsoft cá nhân.
- Callback kiểm tra phiên đăng nhập, state dùng một lần, PKCE và email hộp thư trước
  khi lưu token. Địa chỉ email tài khoản phải khớp địa chỉ Microsoft Graph trả về;
  chưa tự ánh xạ alias sang địa chỉ chính.
- Access/refresh token được mã hóa AES-256-GCM. Client ID, email kết nối và hạn token
  được lưu cùng tài khoản; token gốc không trả về trình duyệt. Không cần nhập token thủ công.
- **Get Code** tự gia hạn token khi cần; access token bị từ chối sẽ thử refresh một lần.
  Lỗi mạng, giới hạn lượt gọi hoặc cấu hình ứng dụng không tự xóa refresh token.
  Nếu Microsoft thu hồi quyền, bấm **Get Token lại**.
- Đọc tối đa 25 thư mới trong mỗi thư mục Inbox và Junk Email, giới hạn 5 phút gần nhất.
  Chỉ nhận mã 6 số có ngữ cảnh xác minh từ domain TikTok/ByteDance; bỏ mã mơ hồ,
  thư tương lai và số trong email không liên quan. Chưa đọc thư bị quy tắc chuyển sang thư mục khác.
- Nếu thư chưa đến, trình duyệt hỏi lại mỗi 3 giây, tối đa 60 giây, có nút **Dừng**.
  Tôn trọng `Retry-After` của Microsoft. Đóng menu sẽ dừng chờ. **Get Code mới** trong
  cùng phiên menu bỏ qua thư vừa lấy và các thư cũ hơn; **Chép** cho phép chép lại mã đang hiện.
- Đổi email hoặc **Ngắt kết nối Hotmail** làm mất hiệu lực token và phiên OAuth đang chờ
  của tài khoản đó. Chuyển tài khoản giữa user vẫn giữ token theo hành vi hiện có, nhưng
  hủy phiên OAuth đang chờ để tránh lưu vào tài khoản đã đổi chủ.

### Kiểm tra Hotmail

`npm run test:hotmail` chạy kiểm tra offline với SQLite trong bộ nhớ và Microsoft HTTP giả:
OAuth/callback, sai hộp thư, phiên hết hạn, chống dùng lại state, refresh, ngắt kết nối,
quyền sở hữu, 401/429, lọc OTP và chờ mã. Không mở hộp thư thật hoặc chạm DB đang dùng.
Kiểm tra đăng nhập Microsoft thực cần cấu hình ứng dụng và tài khoản Hotmail do người dùng cấp quyền.

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
