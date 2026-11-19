# Kết nối tài khoản TikTok và đăng bài

UI đã deploy trên `https://social-manager.congtrieugvm.workers.dev/browser`, Worker version `7c96e396-96d1-487a-8b24-7d9ebdc3a013`. Asset production đã kiểm tra chứa điều hướng, readiness proxy và bảo vệ chọn máy khi thu hồi. Đợt này cập nhật web, không yêu cầu migration D1 mới.

Ngày khảo sát 2026-11-17. Phạm vi gồm mã Social Manager hiện tại và tài liệu chính thức của TikTok.

## Hiện trạng đã kiểm tra

Website xác thực user Social Manager rồi ghép máy Windows bằng token riêng. Mỗi tài khoản TikTok có account ID, owner, profile generation và máy lưu hồ sơ. Cookie nằm trong persistent profile Windows. Agent nhận lệnh qua HTTPS, kiểm tra quyền chạy và gửi trạng thái về web.

Username/password trong danh sách TikTok phục vụ điền form đăng nhập browser. Phiên đăng nhập được xác minh bằng liên kết hồ sơ của người dùng hiện tại. Nếu trang không cung cấp bằng chứng này, trạng thái là chưa xác minh. Cookie chỉ chọn luồng mở lại. Dữ liệu phiên Social Manager và phiên TikTok là hai kết nối riêng.

Luồng đăng đang dùng TikTok Studio trong Camoufox, lấy video từ thư mục Windows, kiểm username ngay trên trang upload trước khi chọn file và trước khi bấm Đăng. Nhật ký từng file ngăn gửi lại khi kết quả chưa rõ. Thành công hiện dựa vào thông báo UI. Đây là phần còn phụ thuộc DOM TikTok, chưa được nghiệm thu với tài khoản đăng thật.

## Ba hướng kết nối

| Hướng | Điều kiện và hành vi | Phù hợp với dự án hiện tại |
|---|---|---|
| Persistent browser | Người dùng đăng nhập TikTok trong profile riêng, hoàn tất OTP/CAPTCHA, xác minh username | Tận dụng máy Windows và tài khoản đang có. Cần kiểm chứng nhận diện Studio và xác nhận kết quả thực tế |
| OAuth và Direct Post API | App TikTok đã đăng ký, quyền `video.publish` được duyệt và từng creator cấp quyền. Lấy creator info rồi khởi tạo upload, theo dõi publish ID | Tích hợp theo điều kiện app được TikTok chấp thuận. Cần bổ sung kết nối OAuth và dữ liệu token/open ID |
| OAuth và Upload API | Creator cấp quyền `video.upload`. App gửi video vào inbox TikTok để creator hoàn tất chỉnh sửa/đăng | Có bước hoàn tất trên TikTok. Chưa có kết nối OAuth trong dự án |

Quyền OAuth chỉ phát sinh sau khi creator cấp quyền cho app. Login Kit web yêu cầu redirect URI HTTPS được đăng ký, kiểm tra state và bảo vệ token/refresh token trên server. [Login Kit Web](https://developers.tiktok.com/docs/en/login-kit-web)

Direct Post cần kiểm tra creator info mới nhất, quyền được cấp và token của creator. Tên người dùng đang lưu trong database chưa chứng minh có quyền `video.publish`. [Get Started — Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-get-started)

Ứng dụng chưa audit bị giới hạn nội dung riêng tư. Hướng dẫn Intended Use của Direct Post cũng loại công cụ chỉ dùng nội bộ để tải nội dung lên tài khoản của bản thân hoặc đội quản lý. Vì vậy cần xác nhận mô hình sản phẩm được TikTok chấp thuận trước khi đầu tư nhánh API cho Social Manager. Đây là điều kiện của API, không phải kết luận rằng luồng browser đã được TikTok phê duyệt. [Content Sharing Guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines)

Upload API yêu cầu creator tiếp tục từ thông báo inbox TikTok để hoàn tất bài. UI sản phẩm cần thể hiện đúng bước này nếu sau này tích hợp. [Upload API](https://developers.tiktok.com/docs/en/content-posting-api-reference-upload-video)

## Các bước thực hiện trên tài khoản hiện có

1. Ghép máy Windows vào đúng user Social Manager. Giữ device ID khi nâng cấp để tái sử dụng profile.
2. Mở tài khoản từ web, hoàn tất đăng nhập TikTok trong cửa sổ riêng. Xác minh username khớp account đang chọn.
3. Gán thư mục trên đúng máy lưu profile. Có thể gán một tài khoản hoặc nhiều tài khoản/nhóm.
4. Trước đăng, kiểm tra máy online, phiên đúng máy, username đã xác minh, thư mục đã gán và chưa có lệnh đăng đang xử lý.
5. Xác nhận lượt đăng từ danh sách tài khoản, đăng một video tiếp theo cho mỗi tài khoản. Giữ trạng thái chưa xác nhận nếu chưa có bằng chứng thành công.
6. Nghiệm thu bằng video được người dùng cho phép trên tài khoản thật. Xem lại bài trong Studio, kiểm đúng tài khoản, nội dung và video. Kiểm tra timeout sau submit, CAPTCHA, đổi account, đóng giữa luồng và mở lại profile.

## Thay đổi giao diện đã triển khai trong đợt này

- Thanh chọn máy luôn hiển thị trạng thái kết nối và phiên bản Windows.
- Các mục Tài khoản, Đăng bài, Proxy, Máy Windows và Lịch sử dùng chung lựa chọn tài khoản/máy.
- Bảng chuẩn bị đăng thể hiện điều kiện còn thiếu theo từng tài khoản. Nút Đăng chỉ bật khi tất cả tài khoản đang chọn đạt điều kiện đã biết từ server.
- Có trạng thái máy offline, profile nằm máy khác, chưa xác minh, thiếu thư mục, agent cũ và đang có lệnh đăng. Server tiếp tục kiểm tra lại khi nhận lệnh.
- Tôn trọng yêu cầu bỏ khối hướng dẫn cài đặt khỏi trang Proxy & trình duyệt.

## Phần chưa xác minh

Sửa lỗi nút mở browser sau khi tải trang lúc offline: chỉ kết thúc bước tự chọn máy khi đã tìm được máy phù hợp, vẫn tôn trọng lựa chọn thủ công và máy bị thu hồi. Thêm lý do khóa nút và thao tác Mở từng dòng. Kiểm thử hồi quy offline → online xác minh nút bật và request mở đúng account/device, kèm mở một tài khoản khi chưa tick checkbox. Khi kiểm tra thực tế, agent Windows đã dừng gửi heartbeat. Đã khởi động lại agent 1.0.3 từ mã build trong workspace bằng kết nối DPAPI hiện có, xác minh heartbeat production mới trong 3 giây. Agent này chạy nền từ thư mục `browser-agent` của workspace.

Bản sửa nút mở đã deploy với Worker version `61ad08af-9201-4d6d-aa40-905e8b2eb6fb`. Asset mới có browser-open-status, heartbeat máy Windows đã kiểm lại cách thời điểm truy vấn 1 giây.

Giao diện đã kiểm thử bằng API local và fixture tại 375/768/1024/1440 px, cả nền sáng/tối và đủ 5 mục. Đã kiểm nút đăng khi đủ điều kiện, máy offline, proxy tắt và máy bị thu hồi. Kiểm thử CRUD proxy, chọn nhóm, gán thư mục và đăng nhập agent vẫn đạt trên DB thử. TypeScript đạt. Build Cloudflare vẫn có lỗi cấu hình ESLint sẵn có đã ghi trong kế hoạch triển khai, nên chưa coi lint toàn dự án là đạt.

Chưa có nghiệm thu đăng thật trên TikTok Studio. DOM, selector nhận diện username và thông báo đăng thành công cần kiểm tra với phiên của người dùng. Chưa cấu hình client key/secret, redirect URI hoặc quyền OAuth TikTok trong repository. Đợt này tối ưu UI và đánh giá phương án kết nối, chưa đưa nhánh OAuth chưa được cấp quyền vào sản phẩm.
