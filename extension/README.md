# TikTok Studio Private

Extension Chrome/Edge lọc **Quyền riêng tư → Mọi người** trong TikTok Studio và đổi lần lượt các bài công khai sang **Chỉ mình tôi**. Tiếp tục kiểm tra đến khi bộ lọc Mọi người không còn bài. Không cần chạy webapp hay cài Node.js để sử dụng.

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
4. Bấm **Ẩn tất cả bài công khai**. Extension mở tab riêng tới `https://www.tiktok.com/tiktokstudio/content`, mở **Quyền riêng tư**, chỉ chọn **Mọi người**, bỏ chọn **Chỉ mình tôi / Bạn bè**, rồi bấm **Áp dụng**.
5. Theo dõi tiến độ ở popup hoặc thanh nhỏ trong Studio. Popup có thể đóng trong khi chạy. Giữ tab Studio mở, không đổi tài khoản, bộ lọc hoặc tự thao tác danh sách khi đang chạy.
6. Nếu không mở được menu của một bài, extension áp dụng lại bộ lọc Mọi người và tiếp tục các bài khác, sau đó thử lại bài lỗi. Có khoảng nghỉ tăng dần tối đa 30 giây khi lặp lỗi, không tự báo hoàn tất chỉ vì hết hàng đang tải.
7. Bấm **Dừng** bất kỳ lúc nào. Thao tác đã gửi tới TikTok có thể vẫn hoàn tất; kiểm tra bài cuối. **Kiểm tra và chạy lại** mở lượt mới từ đầu, xử lý các bài còn trong Mọi người.

Nếu chưa đăng nhập, hoàn tất đăng nhập trong Studio. Nếu lượt xử lý đã báo lỗi hoặc hết thời gian chờ, bấm chạy lại. Đóng/tải lại tab, khởi động lại trình duyệt hoặc tải lại extension sẽ không tự tiếp tục thay đổi bài.

## Trạng thái và phạm vi

- **Đã chuyển**: giao diện hàng hiện Chỉ mình tôi hoặc bài rời bộ lọc Mọi người ổn định ít nhất 3 giây, không đang tải và không còn hộp thoại riêng tư. Đây là xác nhận từ giao diện; extension không gọi API nội bộ. Nếu bài xuất hiện lại sau khi lọc lại, extension thử lại và không cộng trùng ID.
- **Đã riêng tư**: bài đã có mức riêng tư đích lúc kiểm tra.
- **Hoàn tất**: đã áp dụng lại Mọi người, xác nhận chỉ checkbox Mọi người được chọn, trở về trang đầu và thấy thông báo danh sách trống ổn định. Nút trang sau bị vô hiệu hóa hoặc hết ID mới chưa đủ để kết luận hoàn tất.
- **Đang xử lý / tự thử lại**: còn bài công khai hoặc lỗi menu/lưu tạm thời; tự lọc lại và xử lý tiếp. Bài lỗi được thử lại sau các bài khác để không chặn cả danh sách. Bấm Dừng nếu không muốn tiếp tục chờ.
- **Cần kiểm tra**: không nhận diện/áp dụng chắc chắn bộ lọc, ID bài không rõ, có CAPTCHA, mất đăng nhập hoặc TikTok báo lỗi/giới hạn thao tác. Các trường hợp này dừng, không coi là hoàn tất và không cố vượt CAPTCHA/giới hạn.

Hỗ trợ nhãn giao diện Việt/Anh: Everyone/Public/Mọi người/Công khai; Friends/Followers/Bạn bè/Người theo dõi; Only me/Only you/Private/Chỉ mình tôi/Chỉ bạn/Riêng tư. Bài phải có ID trong liên kết video/ảnh hoặc thuộc tính hàng. Từ v1.0.2 chỉ xử lý bài trong bộ lọc Mọi người; bài Bạn bè và Chỉ mình tôi không nằm trong hàng chờ. Không sửa bản nháp, bài lên lịch, quyền riêng tư tài khoản, bình luận hoặc nội dung bài.

Luồng duyệt hỗ trợ bảng phân trang và danh sách tải thêm/cuộn ảo có ID ổn định; đọc lại hàng sau mỗi thay đổi. Bộ lọc có ba checkbox và nút Áp dụng như ảnh người dùng cung cấp. Khi cần làm mới một lựa chọn Mọi người đã có, extension tạm chọn cả ba mức, Áp dụng, rồi chỉ chọn Mọi người và Áp dụng lại; đây là lọc danh sách, không phải thay đổi quyền của các bài khác. Kiểm tra Studio không còn bộ lọc ngày/loại bài hay từ khóa tìm kiếm; không thể tự chứng minh các bộ lọc không có nhãn ngữ nghĩa. Không đổi tài khoản trong lượt chạy.

## Mức kiểm chứng của bản này

Đã có kiểm thử tự động trên DOM giả lập và Chrome API giả lập, bao gồm lỗi menu sau 5 bài, checkbox của bộ lọc theo ảnh, bài biến mất khỏi danh sách, bài xuất hiện lại, danh sách co lại qua phân trang, trở về trang đầu trống, tự thử lại và nút Dừng. **Chưa kiểm thử end-to-end trên TikTok Studio đăng nhập thật**. TikTok thay đổi DOM có thể khiến bản này dừng với thông báo không nhận diện giao diện; cần điều chỉnh `adapter.js` theo giao diện thực. Không có bài thật nào bị thay đổi trong quá trình kiểm thử.

## Quyền và dữ liệu

Content script chỉ chạy trên `https://www.tiktok.com/*` để nhận biết điều hướng SPA từ đăng nhập vào Studio; chỉ sửa bài tại `/tiktokstudio/content` khi người dùng bấm bắt đầu. Không có quyền cookies/debugger và không đọc mật khẩu. Không gửi dữ liệu tới server, không analytics, không tải mã hoặc font từ xa.

`storage.local` lưu khoảng nghỉ. `storage.session` lưu tiến độ, ID bài hiện tại và tối đa 80 dòng nhật ký; xóa khi trình duyệt khởi động lại hoặc extension tải lại. Không lưu caption/nội dung bài hay thông tin đăng nhập. `alarms` phát hiện phiên mất phản hồi. Bấm bắt đầu là yêu cầu chuyển các bài công khai nhận diện được sang Chỉ mình tôi.

## Phát triển và đóng gói

Từ thư mục `extension`:

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd test
```

Runtime không có dependency. Test DOM dùng `jsdom` sẵn ở `../app/node_modules`, hoặc cài jsdom vào môi trường phát triển và chỉ định `NODE_PATH`. Bộ đóng gói dùng danh sách file cho phép, không đưa `app/`, cơ sở dữ liệu, `.env`, cookie, test hoặc mã build vào ZIP. Gói được tạo tại `../dist/tiktok-studio-private-<version>.zip`, lấy phiên bản từ `manifest.json`.

## Tự phát hành lên web

`app/package.json` có hook `prebuild` và `predev`, gọi bộ đóng gói với `--web`. Mỗi lần build, gói ZIP được kiểm tra rồi chép vào `app/public/downloads/extensions/`; cùng lúc sinh metadata cho trang `/utilities`. Link có SHA-256 trong tên để bản mới không dùng nhầm cache. `tiktok-studio-private-latest.zip` và `latest.json` là các địa chỉ cố định luôn được yêu cầu kiểm tra lại cache.

Workflow GitHub Actions hiện có chạy khi push `main`: OpenNext gọi `npm run build`, hook tự đóng gói và Cloudflare phát hành file cùng web. Không cần upload ZIP riêng và không cần credentials mới. Khi cập nhật extension, tăng `version` trong `manifest.json`, chạy kiểm thử phù hợp rồi đưa thay đổi lên `main`. Các file phát hành được sinh tự động, không commit ZIP hoặc metadata.

Việc này tự cập nhật **bản tải trên web**. Extension cài bằng Load unpacked vẫn cần tải ZIP mới, thay các file trong thư mục cũ và bấm Reload trong Chrome/Edge.

Tài liệu tham khảo: [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [Cài unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked), [TikTok Studio](https://newsroom.tiktok.com/helping-creators-bring-creativity-to-life-with-tiktok-studio?lang=en).
