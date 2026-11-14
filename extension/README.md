# TikTok Studio Private

Extension Chrome/Edge tự mở TikTok Studio, chọn **Quyền riêng tư → Mọi người → Áp dụng** trước, rồi cuộn và đổi bài công khai sang **Chỉ mình tôi**. Khi một bài lỗi, tạm bỏ qua để xử lý bài khác; cuối lượt lọc lại và thử bài còn sót đến khi Mọi người không còn bài. Không cần chạy webapp hay cài Node.js để sử dụng.

## Cài đặt

1. Tải bản mới nhất ở menu **Tiện ích** trên Social Manager, rồi giải nén ZIP vào một thư mục cố định.
2. Chrome: mở `chrome://extensions`. Edge: mở `edge://extensions`.
3. Bật **Developer mode / Chế độ dành cho nhà phát triển**.
4. Chọn **Load unpacked / Tải tiện ích đã giải nén**, chọn thư mục có file `manifest.json`.
5. Ghim **TikTok Studio Private** lên thanh công cụ.

Đây là gói ZIP để cài dạng unpacked, không phải bản đã phát hành trên Chrome Web Store. Nếu chuyển/xóa thư mục đã giải nén, trình duyệt không tải được extension nữa.

## Sử dụng

1. Đăng nhập đúng tài khoản TikTok trong cùng hồ sơ Chrome/Edge.
2. Mở extension. Có thể bấm **Mở TikTok Studio** để kiểm tra tài khoản trước.
3. Chọn khoảng nghỉ 1–30 giây (mặc định 2 giây, cộng thêm thời gian chờ xác minh giao diện).
4. Bấm **Ẩn tất cả bài công khai**. Extension mở tab riêng tới `https://www.tiktok.com/tiktokstudio/content`, chọn **Mọi người**, bỏ chọn Chỉ mình tôi/Bạn bè rồi **Áp dụng**. Sau khi xác nhận bộ lọc đã lưu, trở về trang đầu và bắt đầu đổi bài. Bài Bạn bè và Chỉ mình tôi không nằm trong hàng chờ.
5. Theo dõi tiến độ ở popup hoặc thanh nhỏ trong Studio. Popup có thể đóng trong khi chạy. Giữ tab Studio mở, không đổi tài khoản, bộ lọc hoặc tự thao tác danh sách khi đang chạy.
6. Khi một bài lỗi menu/hộp thoại/lưu, extension thử **Escape**, **Hủy/Hủy bỏ** hoặc nút **Đóng/Close**, tạm bỏ qua ID đó và **cuộn xuống làm bài khác**. Không mở lại bộ lọc sau từng bài lỗi. Khi hết lượt cuộn/phân trang, mới áp dụng lại Mọi người và quay về trang đầu để thử các bài còn sót. Lỗi bộ lọc được chờ rồi thử lại, khoảng nghỉ tăng dần tối đa 30 giây; không tự báo hoàn tất chỉ vì hết hàng đang tải.
7. Bấm **Dừng** bất kỳ lúc nào. Thao tác đã gửi tới TikTok có thể vẫn hoàn tất; kiểm tra bài cuối. **Kiểm tra và chạy lại** mở lượt mới từ đầu, xử lý các bài còn trong Mọi người.

Nếu chưa đăng nhập, hoàn tất đăng nhập trong Studio. Nếu lượt xử lý đã báo lỗi hoặc hết thời gian chờ, bấm chạy lại. Đóng/tải lại tab, khởi động lại trình duyệt hoặc tải lại extension sẽ không tự tiếp tục thay đổi bài.

## Trạng thái và phạm vi

- **Đã chuyển**: giao diện hàng hiện Chỉ mình tôi hoặc bài rời bộ lọc Mọi người ổn định ít nhất 3 giây, không đang tải và không còn hộp thoại riêng tư. Đây là xác nhận từ giao diện; extension không gọi API nội bộ. Nếu bài xuất hiện lại sau khi lọc lại, extension thử lại và không cộng trùng ID.
- **Đã riêng tư**: bài đã có mức riêng tư đích lúc kiểm tra.
- **Hoàn tất**: đã áp dụng lại Mọi người, mở lại menu để xác nhận lựa chọn đã lưu, trở về trang đầu và thấy thông báo danh sách trống ổn định. Nút trang sau bị vô hiệu hóa hoặc hết ID mới chưa đủ để kết luận hoàn tất.
- **Tạm bỏ qua bài lỗi**: không tăng số Đã chuyển/Đã riêng tư; thử đóng hộp thoại, cuộn xuống và xử lý các bài khác. Bài lỗi được thử lại cuối lượt. Nếu hộp thoại không đóng được, không sửa bài phía sau hộp thoại, không xóa DOM để giả vờ đã đóng và không tự bấm Lưu khi khôi phục. Bấm Dừng nếu muốn tự kiểm tra hộp thoại.
- **Đang thử lại bộ lọc**: chưa xác nhận lựa chọn được TikTok nhận hoặc danh sách chưa ổn định. Chờ rồi mở lại menu; bấm Dừng nếu giao diện không tương thích.
- **Cần kiểm tra**: ID bài không rõ, có bộ lọc tìm kiếm khác, CAPTCHA, mất đăng nhập hoặc TikTok báo lỗi/giới hạn thao tác. Các trường hợp này dừng, không coi là hoàn tất và không cố vượt CAPTCHA/giới hạn.

Hỗ trợ nhãn giao diện Việt/Anh: Everyone/Public/Mọi người/Công khai; Friends/Followers/Bạn bè/Người theo dõi; Only me/Only you/Private/Chỉ mình tôi/Chỉ bạn/Riêng tư. Bài phải có ID trong liên kết video/ảnh hoặc thuộc tính hàng. Từ v1.0.4 luôn xác nhận Mọi người trước khi sửa bài, theo yêu cầu mới nhất. Không sửa bài Bạn bè, bản nháp, bài lên lịch, quyền riêng tư tài khoản, bình luận hoặc nội dung bài.

Luồng duyệt hỗ trợ bảng phân trang và danh sách tải thêm/cuộn ảo có ID ổn định; đọc lại hàng sau mỗi thay đổi. Bộ lọc được nhận qua ba nhãn và Áp dụng, hỗ trợ cả input/ARIA và checkbox vẽ bằng CSS/SVG. Với checkbox không có trạng thái HTML, extension bấm **Xóa trong menu bộ lọc**, so sánh ba ô đã về cùng trạng thái, rồi chọn và kiểm tra hình thức ô có thay đổi; mở lại menu sau Áp dụng để kiểm tra lựa chọn còn được giữ. Khi cần tải mới danh sách, tạm chọn cả ba mức và Áp dụng rồi lọc riêng Mọi người; đây chỉ là lọc danh sách. Kiểm tra Studio không còn bộ lọc ngày/loại bài hay từ khóa tìm kiếm; không thể tự chứng minh các bộ lọc không có nhãn ngữ nghĩa. Không đổi tài khoản trong lượt chạy.

## Mức kiểm chứng của bản này

Đã có kiểm thử DOM/Chrome API giả lập: lọc trước khi đổi bài, lỗi hộp thoại sau 9 bài, nút đóng dạng icon hoặc div, Escape, cuộn sau lỗi, thử lại cuối lượt, hộp thoại không đóng được, nút Dừng, tải thêm/phân trang và xác nhận danh sách trống.

Kiểm thử bổ sung trên **Chromium riêng với trang mô phỏng** chạy 24 bài công khai: bài thứ 10 phát sinh hộp thoại không có Cancel, tiện ích đóng bằng icon, cuộn và làm các bài còn lại trước khi quay lại bài lỗi; danh sách Mọi người hết bài và bài Bạn bè không bị đổi. Bài kiểm thử có bố cục/cuộn thật, chặn truy cập mạng và không dùng hồ sơ Chrome của người dùng. Kết quả và ảnh được ghi vào `dist/tests/`.

**Chưa kiểm thử end-to-end trên TikTok Studio đăng nhập thật**: công cụ báo kết nối trình duyệt chưa khả dụng. Các kiểm thử trên không chứng minh tương thích với mọi phiên bản DOM của TikTok; giao diện khác có thể khiến tiện ích chờ thử lại hoặc dừng để kiểm tra. Không có bài thật nào bị thay đổi trong quá trình kiểm thử.

## Quyền và dữ liệu

Content script chỉ chạy trên `https://www.tiktok.com/*` để nhận biết điều hướng SPA từ đăng nhập vào Studio; chỉ sửa bài tại `/tiktokstudio/content` khi người dùng bấm bắt đầu. Không có quyền cookies/debugger và không đọc mật khẩu. Không gửi dữ liệu tới server, không analytics, không tải mã hoặc font từ xa.

`storage.local` lưu khoảng nghỉ. `storage.session` lưu tiến độ, ID bài hiện tại và tối đa 80 dòng nhật ký; xóa khi trình duyệt khởi động lại hoặc extension tải lại. Không lưu caption/nội dung bài hay thông tin đăng nhập. `alarms` phát hiện phiên mất phản hồi. Bấm bắt đầu là yêu cầu chuyển các bài công khai nhận diện được sang Chỉ mình tôi.

## Phát triển và đóng gói

Từ thư mục `extension`:

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd test
npm.cmd run test:browser
```

Runtime không có dependency. Test DOM dùng `jsdom` sẵn ở `../app/node_modules`, hoặc cài jsdom vào môi trường phát triển và chỉ định `NODE_PATH`. `test:browser` dùng Playwright và Chromium đã cài trong môi trường phát triển; chạy riêng với test DOM. Bộ đóng gói dùng danh sách file cho phép, không đưa `app/`, cơ sở dữ liệu, `.env`, cookie, test hoặc mã build vào ZIP. Gói được tạo tại `../dist/tiktok-studio-private-<version>.zip`, lấy phiên bản từ `manifest.json`.

## Tự phát hành lên web

`app/package.json` có hook `prebuild` và `predev`, gọi bộ đóng gói với `--web`. Mỗi lần build, gói ZIP được kiểm tra rồi chép vào `app/public/downloads/extensions/`; cùng lúc sinh metadata cho trang `/utilities`. Link có SHA-256 trong tên để bản mới không dùng nhầm cache. `tiktok-studio-private-latest.zip` và `latest.json` là các địa chỉ cố định luôn được yêu cầu kiểm tra lại cache.

Workflow GitHub Actions hiện có chạy khi push `main`: OpenNext gọi `npm run build`, hook tự đóng gói và Cloudflare phát hành file cùng web. Không cần upload ZIP riêng và không cần credentials mới. Khi cập nhật extension, tăng `version` trong `manifest.json`, chạy kiểm thử phù hợp rồi đưa thay đổi lên `main`. Các file phát hành được sinh tự động, không commit ZIP hoặc metadata.

Việc này tự cập nhật **bản tải trên web**. Extension cài bằng Load unpacked vẫn cần tải ZIP mới, thay các file trong thư mục cũ và bấm Reload trong Chrome/Edge.

Tài liệu tham khảo: [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [Cài unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked), [TikTok Studio](https://newsroom.tiktok.com/helping-creators-bring-creativity-to-life-with-tiktok-studio?lang=en).
