# Windows kết nối nền và xem trước lượt đăng

Người dùng đã yêu cầu tiến hành sau đề xuất ưu tiên hai phần này. Dùng kiến trúc Next.js/D1 + agent Windows hiện có, triển khai theo thứ tự bên dưới.

## Kết quả sử dụng

- Sau Setup thành công, biểu tượng Social Manager xuất hiện cạnh đồng hồ Windows. Menu có trạng thái kết nối, mở website, kết nối lại, dừng và thoát. Tùy chọn chạy cùng Windows mặc định tắt, người dùng có thể bật/tắt trong menu.
- Đăng bài có bước Xem trước. Máy đọc tối đa 10 video chưa dùng trong thư mục cho từng tài khoản, gửi tên, kích thước và khóa file. Website hiển thị video, caption và proxy theo tài khoản. Người dùng đổi video, chỉnh caption cho lượt đó hoặc bỏ tài khoản rồi xác nhận.
- Đăng đúng file đã chọn. Nếu file hoặc cấu hình thư mục/proxy đã đổi sau preview, yêu cầu xem trước lại. Preview hết hạn sau 10 phút. Không giữ chỗ file khi chỉ xem trước. Khóa file vẫn được tạo nguyên tử trước upload để chống đăng trùng.

## Các phương án

Tiếp tục chạy nền không có UI có ít thay đổi nhưng không giải quyết việc người dùng không biết chương trình đã dừng. Electron đem lại cửa sổ phong phú nhưng tăng kích thước gói và phụ thuộc. Chọn NotifyIcon WinForms/PowerShell sẵn có trên Windows để tái sử dụng bộ cài hiện tại.

Đọc thư mục trên server không truy cập được ổ Windows. Chọn lệnh preview qua cùng kênh HTTPS/token của agent, kế thừa phân quyền owner/device và workaround X-Body. Không tạo cổng localhost.

## Chi tiết dữ liệu và hành vi

- Thêm browser_jobs.result để lưu danh sách video preview. Không lưu video/cookie vào D1. Không gửi đường dẫn file tùy ý từ client để đăng. Agent tự xác định file từ thư mục đã gán và fingerprint gồm path, size, mtime.
- Job preview độc lập mỗi account, tối đa 20 account/lượt. Result giới hạn 10 file/account và payload sync tách mỗi report để không vượt header 16 KB. ErrorCode có FILE_CHANGED khi file không còn khớp.
- Job post tham chiếu preview job đúng owner/device/account, state done, chưa hết hạn, configKey và folder/caption snapshot còn khớp. Caption tùy chỉnh cho lượt đăng dài tối đa 2200 ký tự. Agent chỉ nhận fileKey đã được server đối chiếu với preview.
- API cần từ chối post khi preview không hợp lệ. Device phiên bản cũ vẫn mở/đóng browser, cần 1.0.4 cho preview/post mới.
- Agent ghi status JSON chỉ có trạng thái, thời gian và PID trong LOCALAPPDATA. Tray hiển thị mất kết nối khi status cũ, thử kết nối lại khi người dùng bấm. Agent tiếp tục dùng backoff/lease hiện có.
- Tray chỉ có một instance theo user Windows. Shortcut Startup thuộc CurrentUser, cập nhật khi người dùng bật lựa chọn và xóa khi tắt. Khi nâng cấp, Stop bản cũ, mở Setup bản mới giữ device ID.
- Thumbnails, lịch đăng, phân phối video khác nhau giữa tài khoản và lịch sử có URL bài thực tế là các đợt tiếp theo. Đợt này preview cung cấp tên video, dung lượng và caption, chưa có phát video từ web.

## Kế hoạch thực hiện

1. Thêm migration/result, kiểm tra preview và ràng buộc post trên server.
2. Agent đọc danh sách file, kiểm tra khóa file đã chọn, báo result và status.
3. Thêm UI tray và nối vào Setup, đóng gói 1.0.4.
4. UI web xem trước, chọn video/caption/bỏ account, gửi xác nhận qua post.
5. Kiểm thử API owner/device/expiry/config/file changes, Windows tray bằng dữ liệu thử, UI desktop/mobile. Không đăng video thật trong kiểm thử tự động.
6. Rà soát, tạo ZIP/checksum và deploy web/migration. Ghi rõ luồng đăng thật còn cần nghiệm thu.
