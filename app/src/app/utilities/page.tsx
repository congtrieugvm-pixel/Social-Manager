import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Check, Download, LockKeyhole, Monitor, Puzzle, RefreshCw } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import release from "@/generated/extension-release.json";
import styles from "./utilities.module.css";

export const metadata: Metadata = { title: "Tiện ích · Social Manager" };

export default async function UtilitiesPage() {
  if (!(await getCurrentUser())) redirect("/login?from=/utilities");
  const size = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(release.size / 1024);

  return (
    <div className={styles.page}>
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Công cụ cho công việc hằng ngày</span>
          <h1 className="h1-serif">Tiện ích</h1>
        </div>
        <span className={styles.count}><Puzzle size={15} aria-hidden="true" />1 tiện ích</span>
      </header>

      <div className={styles.grid}>
        <article className={styles.extension} aria-labelledby="extension-title">
          <div className={styles.cardTop}>
            <div className={styles.mark}><LockKeyhole size={30} strokeWidth={1.6} aria-hidden="true" /></div>
            <span className={styles.version}>v{release.version}</span>
          </div>
          <span className={styles.category}>TIỆN ÍCH TRÌNH DUYỆT</span>
          <h2 id="extension-title">{release.name}</h2>
          <p className={styles.description}>
            Chuyển các bài đăng TikTok sang <strong>Chỉ mình tôi</strong>.
            Tự mở Studio và xử lý lần lượt, ngay trong trình duyệt của bạn.
          </p>
          <ul className={styles.features}>
            <li><Check size={16} aria-hidden="true" />Tự mở Studio → Bài đăng</li>
            <li><Check size={16} aria-hidden="true" />Bỏ qua bài đã riêng tư, duyệt qua các trang</li>
            <li><Check size={16} aria-hidden="true" />Có tiến độ, nhật ký và nút dừng</li>
            <li><Check size={16} aria-hidden="true" />Dùng phiên TikTok đang đăng nhập</li>
          </ul>
          <div className={styles.downloadArea}>
            <a className={`btn btn-primary ${styles.download}`} href={release.downloadUrl} download={release.filename}>
              <Download size={18} aria-hidden="true" />Tải extension
            </a>
            <div className={styles.fileInfo}><Monitor size={14} aria-hidden="true" />Chrome / Edge trên máy tính<span>ZIP · {size} KB</span></div>
          </div>
          <p className={styles.notice}>
            Bản thử nghiệm: đã kiểm thử bằng trang giả lập, chưa xác minh trên TikTok Studio đăng nhập thật.
            Giao diện khác có thể khiến tiện ích dừng để bạn kiểm tra.
          </p>
          <details className={styles.checksum}>
            <summary>Thông tin bản tải</summary>
            <dl><dt>Phiên bản</dt><dd>{release.version}</dd><dt>File</dt><dd>{release.filename}</dd><dt>SHA-256</dt><dd><code>{release.sha256}</code></dd></dl>
          </details>
        </article>

        <aside className={styles.guide} aria-labelledby="install-title">
          <div className={styles.guideHeader}><span className={styles.stepLabel}>BẮT ĐẦU SỬ DỤNG</span><h2 id="install-title">Cài trong vài bước</h2></div>
          <ol className={styles.steps}>
            <li><strong>Tải và giải nén</strong><p>Giải nén ZIP vào một thư mục cố định trên máy tính.</p></li>
            <li><strong>Mở trang tiện ích</strong><p>Nhập <code>chrome://extensions</code> hoặc <code>edge://extensions</code> vào thanh địa chỉ.</p></li>
            <li><strong>Tải thư mục đã giải nén</strong><p>Bật <b>Developer mode</b>, chọn <b>Load unpacked</b> rồi chọn thư mục chứa <code>manifest.json</code>.</p></li>
            <li><strong>Đăng nhập TikTok và bắt đầu</strong><p>Mở tiện ích, bấm <b>Ẩn tất cả bài đăng</b>. Giữ tab Studio mở trong lúc chạy.</p></li>
          </ol>
          <div className={styles.update}>
            <RefreshCw size={19} aria-hidden="true" />
            <div><h3>Khi có bản mới</h3><p>Nút tải luôn trỏ tới bản đang được phát hành trên web. Tải lại ZIP, thay các file trong thư mục cũ rồi bấm <b>Reload / Tải lại</b> ở trang tiện ích của trình duyệt.</p><p>Extension cài bằng Load unpacked không tự cập nhật trên máy của bạn.</p></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
