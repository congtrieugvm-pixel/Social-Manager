# Thiết kế: Đăng nhập TikTok tự lấy mã mail + bật 2FA (nhóm DE)

## Mục tiêu (ý định)
Khi agent đăng nhập một tài khoản TikTok chưa có 2FA, nó tự lấy mã xác minh gửi về
Hotmail, đăng nhập được, rồi bật 2FA và lưu khoá để các lần sau đăng nhập không cần
mail nữa. Làm cho nhóm **DE** (20 tài khoản: login @hotmail.com, mail khôi phục
@fviainboxes.com, có sẵn mật khẩu mail, chưa có 2FA, chưa có token).

## Dữ liệu hiện có (đã kiểm tra)
- `enc_email`, `enc_email_password`: 20/20 có. `enc_recovery_email` (@fviainboxes.com): 20/20.
- `enc_2fa`: 0/20. `enc_mail_token` + `mail_client_id`: 0/20. OAuth Azure: 0/20.
- fviainboxes.com = temp-mail, **API công khai không cần mật khẩu**:
  `GET https://fviainboxes.com/messages?username=<tên>&domain=fviainboxes.com` → `{result:[...]}`.
  (Turnstile hiện tắt. Mail tạm nên có thể bị xoá sau một thời gian.)

## Cách lưu OAuth2: phương án B (đã chốt)
Lưu **refresh token + client ID** (dạng `token|clientid` đi kèm khi mua Hotmail) vào
`enc_mail_token` và `mail_client_id`. Vì 20 tài khoản chưa có sẵn token, lần đầu agent
đăng nhập Hotmail qua OAuth consumer với một **public client ID** để lấy refresh token,
rồi lưu lại. Các lần sau đọc mã bằng token đó, không mở tab Hotmail.

Không dùng phương án A (ứng dụng Azure của web) vì app Azure chưa bật trên web thật và
không khớp dữ liệu `token|clientid` người dùng đang nhập.

## Luồng đăng nhập mới (chạy trong agent Windows, trong job open/hide)
1. Đăng nhập TikTok bằng user/pass (như hiện nay).
2. TikTok hỏi mã (tài khoản chưa 2FA) → agent cần mã trong hộp thư Hotmail:
   - **Đã có token:** đọc mã qua **IMAP XOAUTH2** (`outlook.office365.com`) — agent là Node
     nên IMAP chạy được. Lọc mail TikTok, lấy mã 6 số mới nhất.
   - **Chưa có token:** mở **tab mới** → `login.live.com` OAuth authorize (public client ID,
     `redirect_uri=https://login.live.com/oauth20_desktop.srf`, scope đọc mail + `offline_access`).
     Điền email + mật khẩu mail. Nếu Microsoft đòi xác minh → đọc mã xác minh từ
     **fviainboxes API** rồi nhập. Khi redirect về `oauth20_desktop.srf?code=…` → đổi code
     lấy **refresh token** tại `oauth20_token.srf`. Lưu token + client ID. Rồi đọc mã TikTok.
3. Nhập mã TikTok, vào được tài khoản.
4. **Bật 2FA (ứng dụng xác thực):** vào cài đặt bảo mật TikTok, chọn Authenticator app,
   lấy **khoá bí mật** (chuỗi base32), tạo TOTP nhập để xác nhận. Lưu khoá vào `enc_2fa`.
5. Agent báo về server: refresh token + client ID + khoá 2FA → server mã hoá lưu.
   Lần sau tài khoản đã có 2FA → đăng nhập bằng TOTP (đã làm ở 1.0.5), không cần mail.

## Quyết định của người dùng
- Phương án lưu OAuth2: **B** (refresh token + client ID).
- Lấy mã mail khôi phục tại **fviainboxes.com**.
- Bật 2FA nếu tài khoản chưa có, lưu khoá.

## Quyết định của mình (cần người dùng xác nhận)
- **Public client ID + scope** để lấy token consumer: mình sẽ thử (spike) client ID công
  khai hỗ trợ đọc mail. Nếu một mailbox không đổi được token hợp lệ, tài khoản đó báo lỗi
  rõ ("không lấy được token mail") và bỏ qua, không làm hỏng phiên.
- **Đọc mã online về sau chạy trong agent (IMAP), không ở web** — vì Cloudflare Worker
  không mở được kết nối IMAP. Nút "lấy mã Hotmail" trên web (qua Graph/Azure) giữ nguyên,
  là việc riêng.
- Thử **1 tài khoản** chạy hết luồng (đăng nhập → lấy mã → bật 2FA) trước, xác nhận ổn rồi
  mới mở cho cả 20. Vì bật 2FA khó hoàn tác và IP dùng chung.

## Không làm (non-goals)
- Không đổi app Azure/luồng Hotmail-code trên web.
- Không bật 2FA cho nhóm khác ngoài DE.
- Không lưu mật khẩu mail mới; chỉ đọc.
- Không retry đăng nhập mail sai nhiều lần (tránh khoá mail / chặn IP).

## Rủi ro
- IP dùng chung với agent: đăng nhập Hotmail/MS sai nhiều có thể bị chặn → giới hạn 1 lần,
  sai thì dừng và báo.
- Mail tạm fviainboxes có thể hết mã cũ hoặc đổi API.
- Bật 2FA sai bước có thể khoá tính năng trên tài khoản thật → thử 1 tài khoản trước.
- Màn hình cài 2FA của TikTok có thể khác nhau → agent chụp lại được qua Browser Manager để kiểm.

## Việc để lại cho người làm (thứ tự đề xuất)
1. Spike: lấy refresh token consumer bằng public client ID trên 1 mailbox DE (dữ liệu thật,
   nhưng chỉ đọc/không bật 2FA) → chốt client ID + scope + endpoint IMAP/Graph.
2. Agent: đọc mã qua IMAP bằng token; luồng mở tab lấy token lần đầu; lấy mã fviainboxes.
3. Agent: bật 2FA + lấy khoá + xác nhận TOTP.
4. Server: nhận & lưu refresh token/client ID/khoá 2FA (mã hoá).
5. Thử 1 tài khoản, rồi mở 20.
