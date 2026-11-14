(() => {
  "use strict";
  const { Halt } = globalThis.TSP;
  /** The adapter performs UI operations; engine never guesses a successful result. */
  async function run(adapter, report, check) {
    const stats = { changed: 0, skipped: 0, scanned: 0, pages: 1 };
    const seen = new Set();
    let movements = 0;
    const emit = (message, extra = {}) => report({ ...stats, message, ...extra });
    try {
      await adapter.prepare();
      await emit("Đã nhận diện danh sách. Đang kiểm tra từng bài.");
      while (true) {
        await check();
        const rows = adapter.rows();
        const fresh = rows.filter((row) => !seen.has(row.id));
        for (const row of fresh) {
          await check();
          await emit("Đang kiểm tra bài tiếp theo.", { currentId: row.id });
          const outcome = await adapter.makePrivate(row.id);
          if (!["changed", "skipped"].includes(outcome)) throw new Halt("verification", "Không xác nhận được kết quả của bài vừa xử lý.");
          seen.add(row.id);
          stats.scanned++;
          stats[outcome]++;
          await emit(outcome === "changed" ? "Đã xác nhận bài chuyển sang Chỉ mình tôi." : "Bỏ qua bài đã ở Chỉ mình tôi.", { currentId: row.id });
          await adapter.rest(outcome);
        }
        await check();
        if (++movements > 10000) throw new Halt("scan_limit", "Đã tới giới hạn lượt quét. Chạy lại để tiếp tục kiểm tra các bài còn lại.");
        const step = await adapter.advance(seen);
        if (step === "page") { stats.pages++; await emit("Đã sang trang tiếp theo."); }
        else if (step === "more") continue;
        else if (step === "end") {
          await check();
          await emit("Đã tới cuối danh sách và xử lý tất cả bài nhận diện được.", { status: "completed", currentId: null });
          return;
        } else {
          await emit("Đã xử lý các bài tải được, nhưng chưa xác nhận được cuối danh sách. Kiểm tra Studio trước khi kết luận đã ẩn toàn bộ.", { status: "review", currentId: null });
          return;
        }
      }
    } catch (error) {
      await emit(error.message || "Có lỗi khi xử lý danh sách.", {
        status: error.code === "stopped" ? "stopped" : "error", errorCode: error.code || "unexpected",
      });
    }
  }
  globalThis.TSP.run = run;
})();
