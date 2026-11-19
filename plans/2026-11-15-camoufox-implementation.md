# Kế hoạch triển khai Camoufox

## Cập nhật ngày 2026-11-17

Đã deploy bản này với Worker version `6df413ca-d6b2-4fa9-a71f-485108c9779d`. Asset production có chọn nhóm và posting/save, không còn connect-guide. Hai API mới trả 401 khi chưa xác thực. Gói Windows 1.0.3 SHA-256 `33eae147c591c82b219ea119e8066b6ef03152ea47272620b23611bab4ddc4ac`. Chưa thay chương trình đang chạy trên Windows của người dùng.

- Đã bỏ khối hướng dẫn tại `/browser`. TikTok có Chọn theo nhóm cho nhiều nhóm, lấy ID trên tất cả các trang theo owner. Đã kiểm UI với 56 tài khoản/hai nhóm và mobile.
- Windows 1.0.3 mở trang chủ khi hồ sơ có session, tránh ép login lại và giữ cửa sổ khi TikTok ngắt điều hướng do chuyển trang. Kết nối trực tiếp không còn phụ thuộc IPify/GeoIP để khởi chạy. Cookie chỉ dùng chọn luồng, trạng thái đăng nhập vẫn yêu cầu bằng chứng username. Production trước sửa có 5 BROWSER_FAILED, chưa xác minh chính xác từng lỗi bằng hồ sơ của người dùng.
- Đăng video hỗ trợ gán thư mục riêng hoặc chung cho tài khoản/nhóm trên máy đã chọn. Mỗi lệnh đăng một video MP4/MOV/WebM theo tên, tối đa 20 tài khoản/lượt. Caption chung hoặc dùng tên file. Chọn nhóm khóa thao tác cho tới khi trả đúng lựa chọn mới nhất.
- Agent kiểm danh tính ngay trên trang upload trước upload và trước bấm Đăng. Đăng cần phiên đã xác minh. Không tự retry video đã reserved/submitting/unknown. Giữ tab để kiểm tra CAPTCHA/form/kết quả. Khi kết quả chưa xác nhận cần kiểm tra TikTok thật trước khi xử lý nhật ký tại LOCALAPPDATA/SocialManagerBrowser/posting. Chưa có UI retry video lỗi hoặc hẹn giờ.
- Migration remote 0017 đã áp dụng. Bookmark D1 trước migration `00001cd7-00000002-00005126-c8f333b7f34bdebfa2d86c1c04354457`.
- Kiểm thử đạt: 10 integration SQLite (bao gồm unique post đồng thời, owner/device/verified profile), 7 agent unit/fixture, setup-flow DPAPI/process thật, Camoufox browser smoke thật với local fixture. UI kiểm chứng chọn nhóm, bỏ hướng dẫn, gán thư mục và mobile. Build có lỗi ESLint cấu hình sẵn có như đã ghi bên dưới.
- Chưa kiểm đăng video thực trên TikTok Studio. Selector/danh tính/confirmation có thể yêu cầu thao tác tay. Cần cài gói Windows 1.0.3 để dùng phần sửa và đăng bài. Web từ chối post từ agent cũ.

Thiết kế đã được người dùng duyệt bằng “Triển khai đi” ngày 2026-11-15.

1. Thêm migration/bootstrap và schema proxy, thiết bị, ghép nối, hồ sơ, hàng đợi. Viết API theo owner, token thiết bị, mã ghép nối một lần, cấp credentials theo lệnh và thu hồi quyền chạy.
2. Thêm chương trình Windows riêng, bảo vệ token bằng DPAPI, persistent profile, proxy/fingerprint, hàng đợi và đóng phiên khi hết lease. Khóa phiên bản dependency tương thích thực tế.
3. Thêm giao diện quản lý proxy/máy/phiên, gán theo tài khoản hoặc nhóm, thao tác mở từ danh sách hiện có, trang tải và hướng dẫn.
4. Kiểm thử bằng SQLite riêng, fixture browser và browser thật khi có binary; chạy kiểm tra TypeScript/build. Xác minh gói Windows allowlist/checksum và ghi rõ phạm vi kiểm chứng.
5. Rà soát thay đổi, cập nhật hướng dẫn và bàn giao mã/gói cài; ghi rõ trạng thái phát hành thực tế.

Không thay đổi dữ liệu thật để chạy kiểm thử. Cookie và token thiết bị chỉ lưu trong thư mục dữ liệu riêng trên Windows.

## Tiến độ ngày 2026-11-16

Đã tiếp tục triển khai web, API và chương trình Windows:

- Migration/bootstrap/schema và API owner-scoped cho proxy, ghép máy, hàng đợi, claim, báo trạng thái, chuyển hồ sơ và thu hồi quyền chạy.
- Chương trình TypeScript Windows: DPAPI, khóa một instance bằng named pipe, hồ sơ/preset riêng, nhật ký ID chống chạy trùng, proxy check qua browser, điền form một lần, lease 90 giây và hủy cả phiên đang khởi tạo.
- Trang `/browser`: máy/proxy/nhóm/tài khoản/phiên/hàng đợi, lựa chọn proxy hiệu lực, mã ghép nối, hướng dẫn cài đặt. Nối từ sidebar, Tiện ích và thao tác chọn tài khoản TikTok (tối đa 20).
- Gói thử nghiệm `dist/social-manager-browser-1.0.0-win-x64.zip`, kèm Node 24.14.1 và dependency khóa. Kiểm SHA-256 runtime từ nodejs.org, allowlist nguồn đóng gói, SHA256SUMS từng file và đọc lại ZIP xác minh hash. Chưa upload/publish; website chỉ hiện link khi cấu hình `BROWSER_RELEASE_URL` HTTPS.

### Bằng chứng kiểm thử

- `app: node scripts/test-browser.cjs`: 8 kịch bản tích hợp SQLite in-memory, gồm owner isolation, proxy precedence/secret masking, ghép mã một lần/hết hạn, duplicate/lost response, thay cấu hình, đóng phiên, chuyển quyền, thu hồi, hết hạn và restart sau relocate.
- `browser-agent: npm test`: 5 test, gồm DPAPI thực trên Windows, URL validation, trạng thái danh tính, fixture form và hủy operation lúc browser tạo chậm.
- `browser-agent: node tests/browser-smoke.mjs`: Camoufox thật trên Windows, browser official/158.0.1-beta.41; profile cookie/localStorage persistence, cách ly hai profile, UA/platform/screen giữ sau mở lại, proxy hỏng không chuyển trực tiếp. Dùng trang fixture local, headless, không dùng tài khoản TikTok.
- `app: node scripts/test-browser-ui.cjs`: trang authenticated trên dev server port 3107 với DB thử trong TEMP; tạo proxy, ghép mã, desktop 1440/mobile 390, không lỗi JS/overflow. Ảnh kiểm tra ở `dist/tests/browser-{desktop,mobile}.png`. Test yêu cầu dev server với DB và admin thử, không chạy lên DB thật.
- 12 test account-mail-fields hiện có vẫn đạt; TypeScript web/agent đạt. `next build` exit 0, nhưng ESLint cấu hình sẵn có không load được `eslint-config-next/core-web-vitals` (Next 15 legacy config vs cấu hình flat đang dùng); không coi lint toàn dự án là đạt. Cảnh báo dynamic DB require hiện có vẫn còn.
- Rà soát độc lập bằng code-review: đã sửa bốn lỗi phát hiện và thêm regression test cho expiry/restart/password/startup cancellation.

### Chưa nghiệm thu / chưa phát hành

- Chưa đăng nhập TikTok thật, kiểm chứng DOM trên tài khoản thật hay proxy có xác thực của người dùng. SOCKS5 xác thực bị chặn rõ ràng; HTTP/HTTPS/SOCKS5 không xác thực cần ma trận proxy thực.
- Chưa thử gói trên máy Windows sạch, chưa kiểm chứng toàn bộ luồng background agent ↔ production D1, chưa build/verify bundle Cloudflare cho thay đổi này, chưa chạy migration remote hay deploy.
- Bấm mở trùng hiện giữ một phiên và không tạo cửa sổ thứ hai; chưa đưa cửa sổ có sẵn ra trước. Chương trình yêu cầu khôi phục khóa hồ sơ thủ công sau crash, không tự phá khóa.
- Chưa có chữ ký số, tự cập nhật hoặc startup cùng Windows. Gói cài là bản thử nghiệm để tiếp tục nghiệm thu, không phải bản production đã hoàn tất.

## Deployment được người dùng yêu cầu ngày 2026-11-16

### Thay đổi ghép máy theo yêu cầu mới

Cập nhật tiếp theo theo yêu cầu một bước Setup: gói Windows 1.0.2 có `Setup.vbs` mở WinForms với Tài khoản/Mật khẩu/Đăng nhập. Nút Đăng nhập chạy xác thực, tải browser và khởi động agent nền, chờ heartbeat thành công rồi báo Đã kết nối. Người dùng có thể đóng Setup khi hoàn tất. Gói bỏ các bước Start/Download riêng. Website mặc định là production Social Manager.

Hướng dẫn một bước Setup đã deploy với Worker version `bebf2b81-d425-40ee-9fcd-8c35f16208cb`. Đã kiểm tra asset production chứa Setup.vbs và bỏ bước Start.vbs.

Đã kiểm thử `tests/setup-flow.mjs` với API/tải browser mô phỏng nhưng DPAPI, tiến trình nền và handshake thật trên Windows, gồm đăng nhập sai, tiến trình sống sau khi Setup thoát và Stop. `tests/setup-window.ps1` kiểm thử WinForms thật với tiến trình cài đặt mô phỏng, xác nhận nút đăng nhập, mật khẩu che, tiến độ và hoàn tất. Chưa nhập tài khoản thật của người dùng vào Setup. ZIP 1.0.2 tại thư mục dist đã kiểm checksum.

Người dùng yêu cầu ghép máy bằng cùng username/password website. Windows 1.0.1 dùng Setup đăng nhập Social Manager, nhận token thiết bị và lưu bằng DPAPI. Website hướng dẫn đăng nhập, API mã ghép cũ vẫn hỗ trợ gói cũ. Setup lại với token hợp lệ cùng owner giữ device ID và hồ sơ cũ. Setup yêu cầu dừng agent đang chạy trước khi thay kết nối.

Đã kiểm tra 9 kịch bản tích hợp SQLite với password hashing thật, gồm sai mật khẩu, user bị khóa, giới hạn thử, đúng owner và Setup lại. UI dev với DB riêng đã kiểm tra password login → sync → máy xuất hiện. Console Windows kiểm tra nhập ẩn và phím điều hướng. Gói mới nằm ở `dist/social-manager-browser-1.0.1-win-x64.zip`. Migration `0016_browser_password_login.sql` đã áp dụng remote. Build Cloudflare đạt, vẫn có lỗi cấu hình lint đã ghi phía trên.

Nếu phiên bị dừng do hạn mức, tiếp tục từ ghi chú này và kiểm tra deployment hiện hành. Agent không có tín hiệu tự khởi chạy khi hạn mức được reset.

Bản đăng nhập password đã deploy thành công với Worker version `31bd9de0-67cf-4871-9b7b-6ef8bb15e06f`. Production trả 401 cho thông tin đăng nhập thử không tồn tại. Luồng đăng nhập thành công đã kiểm tra trên DB thử local. Gói 1.0.1 bàn giao riêng qua file ZIP, chưa đưa lên host tải.

- Đã deploy web/API lên `https://social-manager.congtrieugvm.workers.dev`, Worker version `3ef1ea38-cabb-4bf9-9a62-b7c3fe66dbd0`.
- `npm run cf:build` và `wrangler deploy --dry-run` đạt; tìm trong JavaScript bundle không có đường dẫn module camoufox/playwright. Cảnh báo ESLint đã nêu vẫn còn.
- Đã áp dụng migration remote `0015_camoufox_browser.sql` (16 statements). Sau deploy không còn migration chờ.
- D1 bookmark trước migration: `00001c08-00000000-00005125-7bfc5a12dea442bde81628746fe1fbed`. Worker trước deploy: `87defa67-a855-4e37-952a-a3aad3166a10`. Không restore DB tự động vì có thể mất thay đổi mới sau bookmark.
- Kiểm tra production: `/login` 200; `/browser` chuyển tới login khi chưa đăng nhập; dashboard trả 401; agent sync thiếu token trả 401; enroll mã giả trả 401 qua D1, không tạo dữ liệu thử.
- Chưa thử phiên web đã đăng nhập/ghép agent trên production. Gói Windows vẫn bàn giao riêng, chưa upload lên host tải và chưa cấu hình `BROWSER_RELEASE_URL`. Chưa commit/push mã nguồn; deployment dùng working tree hiện tại.
