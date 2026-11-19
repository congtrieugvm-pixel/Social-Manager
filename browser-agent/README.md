# Social Manager Browser (Windows x64)

1. Giải nén gói vào thư mục cố định rồi mở `Setup.vbs`. Cửa sổ có ô **Tài khoản**, **Mật khẩu** và nút **Đăng nhập**. Dùng tài khoản Social Manager trên website.
2. Bấm **Đăng nhập**. Setup tự cài Camoufox và chạy kết nối nền. Lần đầu cần tải khoảng 1,4 GB. Nếu tải lỗi, bấm Đăng nhập để thử lại.
3. Khi cửa sổ báo **Đã kết nối**, máy đã sẵn sàng trên website. Có thể đóng cửa sổ Setup và mở tài khoản TikTok từ website. Chương trình giữ kết nối nền sau khi đóng Setup. Mật khẩu chỉ dùng để xác thực. Token thiết bị được bảo vệ bằng DPAPI.
4. Dùng `Stop.cmd` để dừng và đóng cửa sổ do chương trình quản lý. Khi máy mất liên lạc quá 90 giây, chương trình yêu cầu đóng các phiên đang chạy. Không tắt máy cưỡng bức khi hồ sơ đang ghi dữ liệu.

Mã nguồn chạy với Node >=22.15: `npm ci`, `npm run build`, `npm run setup`, `npm start`. Gói Windows kèm Node, người dùng không cần npm/Python.

## Dữ liệu và khôi phục

Token được bảo vệ bằng DPAPI CurrentUser. Cấu hình, nhật ký ID lệnh và hồ sơ ở `%LOCALAPPDATA%\SocialManagerBrowser`, ngoài thư mục cài đặt. Cookie không gửi lên website. Chương trình chỉ nhận kết nối HTTPS; HTTP chỉ dành cho localhost khi phát triển. Không chia sẻ thư mục dữ liệu này.

Mỗi hồ sơ có khóa `session.lock`. Sau sự cố, chương trình không tự xóa khóa hoặc dừng Firefox khác. Nếu gặp `PROFILE_BUSY`, đóng cửa sổ Camoufox tương ứng và kiểm tra Task Manager. Chỉ khi chắc chắn mọi tiến trình dùng hồ sơ đã dừng mới xóa `session.lock` của hồ sơ đó, hoặc tạo hồ sơ mới trên website (cần đăng nhập lại). Không xóa khóa Firefox trong thư mục `data`.

Mỗi máy tối đa 3 cửa sổ, mở cách nhau ít nhất 2 giây. Lệnh chờ hết hạn sau 10 phút. Hủy hàng đợi không đóng cửa sổ đã mở. Ngắt máy hoặc chuyển/xóa tài khoản sẽ thu hồi quyền chạy.

## Proxy và đăng nhập

HTTP/HTTPS và SOCKS5 không xác thực được nhận; SOCKS5 có xác thực bị từ chối. Mọi proxy cần kiểm chứng bằng endpoint thực trên máy Windows. Proxy/GeoIP lỗi sẽ dừng mở, không chuyển sang trực tiếp. Kiểm tra IP qua HTTPS api.ipify.org. Giữ nguyên proxy khi phiên đang chạy; thay đổi áp dụng lần mở kế tiếp.

Mật khẩu chỉ được điền và gửi tối đa một lần khi nhận diện chính xác form. CAPTCHA/OTP do người dùng hoàn tất. Nếu TikTok đổi DOM, thao tác tay; trạng thái chỉ được xác nhận khi đọc được liên kết hồ sơ của người dùng hiện tại và username khớp. Không suy ra đăng nhập từ cookie.

Phiên bản khóa: camoufox 0.5.9, playwright-core 1.62.0, browser official/158.0.1-beta.41. Fingerprint preset được lưu riêng theo hồ sơ; không tự đổi preset khi nâng cấp. Cần kiểm chứng lại danh tính và dữ liệu phiên sau nâng cấp.

## Phát hành và kiểm chứng

## Đăng video từ thư mục (1.0.3)

Trong trang Proxy & trình duyệt, chọn một tài khoản để gán thư mục riêng hoặc chọn nhiều tài khoản/nhóm để gán thư mục chung trên máy Windows đã kết nối. Bấm Gán thư mục rồi mở và xác minh phiên TikTok. Bấm Đăng video tiếp theo để mỗi tài khoản đăng một video chưa dùng, theo thứ tự tên file. Hỗ trợ MP4/MOV/WebM. Nội dung để trống sẽ dùng tên file. Mỗi lượt tối đa 20 tài khoản.

Kết quả cần kiểm tra thêm trên TikTok Studio thật. Khi form/nhận diện tài khoản thay đổi, chương trình giữ tab để thao tác tay. Nếu kết quả đăng chưa xác nhận, file được giữ trong nhật ký tại `%LOCALAPPDATA%\SocialManagerBrowser\posting` để tránh tự gửi lại. File lỗi trước khi đăng cũng cần xem xét thủ công trước khi cho phép thử lại. Đóng cửa sổ trên web sẽ ngừng luồng đang xử lý ở lần nhận lệnh tiếp theo. Không xóa/di chuyển video nguồn.

`npm run package` tạo ZIP với Node Windows x64 24.14.1 (kiểm SHA-256 từ nodejs.org), dependency production từ lockfile, mã biên dịch và các launcher cho Windows. Gói không chứa `.env`, DB, token hay hồ sơ. `SHA256SUMS` liệt kê từng file; thông tin phát hành ghi riêng cạnh ZIP.

Đây là bản thử nghiệm chưa ký số, chưa tự cập nhật, chưa tự khởi động cùng Windows. Thay thư mục chương trình để nâng cấp sau khi Stop. Xem `plans/2026-11-15-camoufox-implementation.md` trong repository để biết phạm vi kiểm thử thực tế. Chưa coi fixture là bằng chứng đăng nhập TikTok thật hay tương thích mọi proxy.
