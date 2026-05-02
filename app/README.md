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

## Stack

- Next.js 16 App Router + TypeScript + Tailwind
- SQLite (better-sqlite3) + Drizzle ORM
- `@tobyg74/tiktok-api-dl` cho TikTok data
- AES-256-GCM (Node built-in crypto)

## Data

SQLite file tại `app/data/app.db` — backup file này là đủ.
