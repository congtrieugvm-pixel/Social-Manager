# Thiết kế: Đăng bài hàng loạt + lên lịch bằng lịch có sẵn của TikTok

## Ý định
Chia đều video trong một thư mục cho nhiều tài khoản TikTok, mỗi tài khoản một số
bài do người dùng đặt, rồi dùng **chức năng Schedule có sẵn của TikTok Studio** để
hẹn giờ — TikTok tự đăng, máy Windows không cần bật lúc đăng.

## Hiện trạng (đã đọc code)
- Agent có `postVideo` (browser-agent/src/posting.ts): lấy video chưa đăng kế tiếp
  trong thư mục, mở TikTok Studio Upload, điền nội dung, bấm Post, chờ xác nhận;
  sổ ghi nhớ per-account chống đăng trùng. **Đăng NGAY, không hẹn giờ.**
- Server bắt buộc bước `preview` trước `post`, nhưng **agent không xử lý `preview`**
  → luồng đăng hiện kẹt. `app/scripts/test-browser.cjs` posting fail từ 2026-11-17.
- Nút đăng nằm ở tab "Đăng bài" trong /browser.

## Quyết định của người dùng
- Chia video **xoay vòng**, mỗi video thuộc đúng 1 tài khoản (không trùng).
- Đặt **số bài mỗi tài khoản** và **số ngày** (cadence = số bài/ngày).
- Dùng **lịch TikTok** (hẹn giờ), không đăng ngay.
- Giờ **ngẫu nhiên trong khung người dùng đặt**; mỗi tài khoản lệch nhau.
- Lỗi → **báo lỗi, người dùng xử lý tay. KHÔNG tự thử lại.**

## Quyết định đã chốt (2026-11-20)
- Hai bài cùng ngày cùng tài khoản cách nhau tối thiểu **1 tiếng**.
- Giờ hẹn theo **giờ Việt Nam** (UTC+7).
- Đổi mô hình chống-trùng: từ "sổ per-account" sang **một kế hoạch phân bổ duy nhất**
  lưu ở server (video → tài khoản → giờ), lập 1 lần, người dùng xem rồi chạy.

## Luồng
1. Người dùng chọn: thư mục (trên máy Windows), danh sách tài khoản, số bài/tài khoản,
   số ngày, khung giờ, (nội dung mặc định/theo tên file).
2. Server gửi agent **liệt kê file** trong thư mục (tái dùng/sửa `preview`).
3. Server **lập kế hoạch**: chia file xoay vòng cho tài khoản; với mỗi bài bốc giờ ngẫu
   nhiên trong khung, theo ngày, mỗi tài khoản lệch nhau, ≥30' giữa 2 bài cùng ngày.
   Thiếu file → báo, không tạo. Vượt giới hạn ~10 ngày của TikTok → chia đợt / báo.
4. Người dùng **xem bảng kế hoạch** (ai, video nào, giờ nào) → bấm chạy.
5. Server xếp **một job "schedule" mỗi tài khoản**, mang danh sách (file, giờ) của nó.
6. Agent: mỗi tài khoản mở trình duyệt **một lần**, đăng nhập (dùng 2FA/mã mail đã làm),
   tải lần lượt từng video → bật **Schedule** → chọn đúng ngày giờ → xác nhận → sang
   video kế. Xong đóng cửa sổ. Ghi trạng thái từng video về server.
7. Tới giờ, **TikTok tự đăng**. Hệ thống đánh dấu "đã lên lịch" (không theo dõi sau đó).

## Không làm (non-goals)
- Không đăng ngay (chỉ hẹn giờ). (Có thể giữ `post` cũ như tuỳ chọn riêng, bàn sau.)
- Không tự thử lại khi lỗi.
- Không theo dõi/sửa bài sau khi đã lên lịch trên TikTok.
- Không xử lý quá giới hạn ngày của TikTok trong một đợt.

## Rủi ro / điểm cần kiểm trên trang thật
- **Nút "Schedule" + bộ chọn ngày giờ** trong TikTok Studio phải dò selector thật.
  Hiện IP đang bị TikTok giới hạn đăng nhập → cần hết giới hạn hoặc gắn proxy mới dò được.
- **Giới hạn số ngày** hẹn trước (nghe nói ~10 ngày) — kiểm con số thật.
- Nhiều tài khoản tải cùng IP (DE không proxy) vẫn rủi ro ở bước tải lên (dù đăng thì TikTok
  tự làm sau). Nên rải cả thời điểm **mở cửa sổ tải** giữa các tài khoản, không chỉ giờ đăng.
- Múi giờ: nếu dùng proxy nước khác, giờ hẹn phải set timezone cho context cho khớp.

## Việc để lại cho người làm (thứ tự đề xuất)
1. (Cần đăng nhập được) Dò trang TikTok Studio Upload: nút Schedule, chọn ngày/giờ,
   nút xác nhận; ghi lại selector. Spike headful như đã làm với login.
2. Agent: job "list folder" (liệt kê video) + job "schedule" (tải + hẹn giờ 1 video,
   rồi lặp cho cả danh sách của tài khoản). Ghi nhớ chống trùng theo kế hoạch.
3. Server: bảng kế hoạch phân bổ (video→tài khoản→giờ); API lập/duyệt/chạy; version gate.
4. Web: form (thư mục, tài khoản, số bài, số ngày, khung giờ) + bảng xem trước kế hoạch
   + nút chạy; đưa ra trang danh sách TikTok hoặc giữ ở /browser (bàn khi làm UI).
5. Thử trên 1–2 tài khoản (sau khi hết giới hạn IP / có proxy), rồi mở rộng.
