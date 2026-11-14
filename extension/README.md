# TikTok Studio Private

Extension Chrome/Edge đổi lần lượt toàn bộ bài đăng trong TikTok Studio sang **Chỉ mình tôi**. Không cần chạy webapp hay cài Node.js để sử dụng.

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
4. Bấm **Ẩn tất cả bài đăng**. Extension mở tab riêng tới `https://www.tiktok.com/tiktokstudio/content` và bắt đầu khi danh sách tải xong.
5. Theo dõi tiến độ ở popup hoặc thanh nhỏ trong Studio. Popup có thể đóng trong khi chạy. Giữ tab Studio mở, không đổi tài khoản, bộ lọc hoặc tự thao tác danh sách khi đang chạy.
6. Bấm **Dừng** bất kỳ lúc nào. Thao tác đã gửi tới TikTok có thể vẫn hoàn tất; kiểm tra bài cuối. **Kiểm tra và chạy lại** mở lượt mới từ đầu, bỏ qua bài đã ở Chỉ mình tôi.

Nếu chưa đăng nhập, hoàn tất đăng nhập trong Studio. Nếu lượt xử lý đã báo lỗi hoặc hết thời gian chờ, bấm chạy lại. Đóng/tải lại tab, khởi động lại trình duyệt hoặc tải lại extension sẽ không tự tiếp tục thay đổi bài.

## Trạng thái và phạm vi

- **Đã chuyển**: giao diện hàng của bài hiện Chỉ mình tôi ổn định ít nhất 3 giây và không còn hộp thoại riêng tư. Đây là xác nhận từ giao diện; extension không gọi API nội bộ để kiểm chứng phía máy chủ.
- **Đã riêng tư**: bài đã có mức riêng tư đích lúc kiểm tra.
- **Hoàn tất**: đã xử lý các hàng nhận diện được và thấy dấu hiệu cuối danh sách (nút trang sau bị vô hiệu hóa hoặc thông báo hết danh sách).
- **Chưa xác nhận hết**: đã cuộn và xử lý phần tải được, nhưng không thấy dấu hiệu đủ chắc chắn về cuối danh sách. Không được hiểu là toàn bộ tài khoản đã ẩn xong.
- **Cần kiểm tra**: giao diện khác phiên bản được nhận diện, không tìm được nút, có CAPTCHA/lỗi hoặc không xác minh được lưu. Mở Studio để xem bài cuối, hoàn tất xác minh nếu có, rồi chạy lại.

Hỗ trợ nhãn giao diện Việt/Anh: Everyone/Public/Mọi người/Công khai; Friends/Followers/Bạn bè/Người theo dõi; Only me/Only you/Private/Chỉ mình tôi/Chỉ bạn/Riêng tư. Bài phải có ID trong liên kết video/ảnh hoặc thuộc tính hàng. Xử lý các bài đã đăng mà Studio cung cấp nút quyền riêng tư; không sửa bản nháp, bài lên lịch, quyền riêng tư tài khoản, bình luận hoặc nội dung bài. TikTok có thể không cho sửa một số bài; extension dừng tại bài đó.

Luồng duyệt hỗ trợ bảng phân trang và danh sách tải thêm/cuộn ảo có ID ổn định. Extension mở trang nội dung mới và từ chối các bộ lọc đang hoạt động mà nó nhận diện được. Kiểm tra Studio không còn bộ lọc ngày/loại bài/quyền riêng tư được lưu trước đó; không thể tự chứng minh các bộ lọc không có nhãn ngữ nghĩa. Không đổi tài khoản trong lượt chạy.

## Mức kiểm chứng của bản này

Đã có kiểm thử tự động trên DOM giả lập và Chrome API giả lập cho nhận diện bài, menu quyền riêng tư, hộp thoại lưu, dừng, lỗi, phân trang, chống lặp và phiên điều phối. **Chưa kiểm thử end-to-end trên TikTok Studio đăng nhập thật**, do công cụ khảo sát không kết nối được browser host. TikTok thay đổi DOM có thể khiến bản này dừng với thông báo không nhận diện giao diện; cần điều chỉnh `adapter.js` theo giao diện thực. Không có cam kết tương thích với mọi tài khoản/biến thể Studio. Không có bài thật nào bị thay đổi trong quá trình kiểm thử.

## Quyền và dữ liệu

Content script chỉ chạy trên `https://www.tiktok.com/*` để nhận biết điều hướng SPA từ đăng nhập vào Studio; chỉ sửa bài tại `/tiktokstudio/content` khi người dùng bấm bắt đầu. Không có quyền cookies/debugger và không đọc mật khẩu. Không gửi dữ liệu tới server, không analytics, không tải mã hoặc font từ xa.

`storage.local` lưu khoảng nghỉ. `storage.session` lưu tiến độ, ID bài hiện tại và tối đa 80 dòng nhật ký; xóa khi trình duyệt khởi động lại hoặc extension tải lại. Không lưu caption/nội dung bài hay thông tin đăng nhập. `alarms` phát hiện phiên mất phản hồi. Bấm bắt đầu là yêu cầu đổi toàn bộ bài đã đăng nhận diện được sang Chỉ mình tôi.

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
