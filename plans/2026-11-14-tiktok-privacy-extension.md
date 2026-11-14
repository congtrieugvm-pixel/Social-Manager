# TikTok Studio Private — thiết kế và kế hoạch

Ngày: 2026-11-14. Yêu cầu: extension đóng gói, tự mở TikTok Studio / Bài đăng và đổi toàn bộ bài sang **Chỉ mình tôi**. Người dùng đã chọn thao tác toàn bộ, không cần chọn từng bài hay đổi sang công khai.

## Phương án

- Chọn extension Manifest V3 thao tác trên giao diện bằng phiên đăng nhập sẵn. Đóng gói ZIP, chạy độc lập với webapp `app/`. Đây là quyết định triển khai của người xây dựng.
- Không chọn backend tự đăng nhập: cần quản lý mật khẩu/cookie và máy chủ, không cần thiết cho yêu cầu này.
- Không chọn gọi API nội bộ TikTok: chưa có hợp đồng API chính thức cho thao tác này, khó xác minh thay đổi.

## Hành vi

1. Popup tiếng Việt có nút mở Studio, bắt đầu đổi toàn bộ, dừng, khoảng nghỉ và tiến độ.
2. Khi bắt đầu, mở tab Studio riêng tại `/tiktokstudio/content`, chờ trang tải và nhận diện danh sách bài đăng.
3. Chỉ thao tác trên tab thuộc phiên chạy hiện tại. Đọc ID bài từ liên kết hoặc thuộc tính hàng, nhận diện quyền riêng tư Việt/Anh; bỏ qua bài riêng tư, chọn Only me / Only you / Chỉ mình tôi / Chỉ bạn và xác nhận hộp thoại riêng tư nếu có.
4. Kiểm tra trạng thái hàng sau cập nhật, xử lý tuần tự. Cuộn từng đoạn để hỗ trợ danh sách ảo, đi tới trang tiếp, chống lặp ID.
5. Chỉ báo hoàn tất toàn bộ khi có dấu hiệu cuối danh sách rõ ràng. Nếu chỉ hết phần tải được, báo cần kiểm tra, không khẳng định toàn bộ đã đổi.
6. Dừng khi người dùng yêu cầu, tab đóng/tải lại/chuyển trang, phiên đăng nhập hết, CAPTCHA, giới hạn tốc độ, lỗi hoặc DOM không rõ. Chạy lại từ đầu bỏ qua bài đã riêng tư.

## Kiến trúc và dữ liệu

- `background.js`: điều phối một phiên, lưu trạng thái trong `chrome.storage.session`, xác thực tab/document, xử lý dừng và tab đóng. Cài đặt khoảng nghỉ lưu local; không có cookie/password/token, không có máy chủ hay telemetry.
- `content.js` + `engine.js`: vòng lặp xử lý và hủy; `adapter.js`: nhận diện DOM/đổi quyền/đọc phân trang. Mọi click được kiểm tra quyền sở hữu phiên trước khi thực hiện.
- `popup.html/css/js`: bảng điều khiển gọn, màu ngà/mực đậm/xanh lục, có trạng thái và nhật ký. Không dùng script hoặc font bên ngoài.
- Quyền: storage, alarms và truy cập duy nhất `https://www.tiktok.com/*` thông qua content script. Không xin quyền cookies, debugger hay toàn bộ website.
- Phiên đang chạy không tự tiếp tục sau restart/reload. Không ghi caption, nội dung bài hay thông tin đăng nhập vào nhật ký.

## Kiểm chứng và giới hạn

Không kết nối được browser host của phiên người dùng khi khảo sát; không thể xác thực DOM Studio đăng nhập thật. Các selector dựa trên ngữ nghĩa giao diện, có cơ chế dừng khi không chắc chắn. Kiểm thử DOM giả lập, trạng thái extension, mất kết nối, dừng giữa thao tác, xác nhận lưu, phân trang và đóng gói. Cần thử với tài khoản thực trước khi coi là đã xác minh tương thích TikTok hiện tại. Không thay đổi bài thật để kiểm thử trong quá trình xây dựng.

## Kế hoạch triển khai

1. Tạo extension độc lập và bộ điều phối phiên có kiểm tra tab/document.
2. Viết adapter, engine và bộ điều khiển tiếng Việt.
3. Kiểm thử những nhánh có thể đổi sai hoặc báo sai kết quả bằng DOM và Chrome API giả lập.
4. Đóng gói ZIP theo danh sách file cho phép, kiểm tra manifest và nội dung gói, viết hướng dẫn cài và giới hạn đã kiểm thử.

## Kết quả bàn giao

- Mã nguồn độc lập: `extension/`; gói cài: `dist/tiktok-studio-private-1.0.0.zip`.
- `npm.cmd test`: 31/31 kiểm thử giả lập đạt, gồm adapter DOM, engine, content runner, popup và điều phối phiên khi service worker khởi động lại.
- `npm.cmd run check`: manifest, quyền truy cập, cú pháp JavaScript và tài nguyên nội bộ đạt.
- Kiểm tra ZIP bằng Python `zipfile`: CRC hợp lệ, đúng 14 file trong danh sách cho phép, từng file trùng mã nguồn hiện tại; không có dữ liệu ứng dụng hoặc secrets.
- Chưa chạy trên TikTok Studio đăng nhập thật; giới hạn này có trong hướng dẫn đóng gói. Không thay đổi dữ liệu TikTok thật hoặc mã nguồn webapp hiện có.
