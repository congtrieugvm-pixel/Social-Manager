(() => {
  "use strict";
  const { Halt } = globalThis.TSP;
  const RECOVERABLE = new Set(["privacy_menu", "missing_row", "verification", "unavailable", "unknown_privacy", "public_scope", "pagination_loop", "unsupported_ui", "scroll_stuck"]);
  /** The adapter performs UI operations; engine never guesses a successful result. */
  async function run(adapter, report, check) {
    const stats = { changed: 0, skipped: 0, scanned: 0, pages: 1 };
    const visited = new Set(); // This pass only; public posts may reappear after a failed save.
    const counted = new Set(); // Do not inflate totals when the same post is retried.
    let failures = 0;
    let passStart = 0;
    const emit = (message, extra = {}) => report({ ...stats, message, ...extra });
    const refreshFilter = async (action) => {
      while (true) {
        await check();
        try { return await action(); }
        catch (error) {
          if (!["filter_control", "filter_state", "unavailable"].includes(error.code)) throw error;
          await emit(`${error.message} Đang chờ rồi mở lại Quyền riêng tư → Mọi người; có thể bấm Dừng.`, { errorCode: error.code });
          await adapter.backoff(++failures);
        }
      }
    };
    try {
      await adapter.prepare();
      await emit("Đang cuộn danh sách và chuyển bài sang Chỉ mình tôi. Cuối lượt sẽ lọc Mọi người để kiểm tra bài còn sót.");
      while (true) {
        await check();
        // Re-read after EVERY mutation. Filtering can remove a row, refill the
        // page or recycle its DOM nodes while a previous menu is still closing.
        const row = adapter.rows().find((item) => !visited.has(item.id));
        if (row) {
          visited.add(row.id);
          await emit("Đang kiểm tra bài tiếp theo.", { currentId: row.id });
          let outcome;
          try {
            outcome = await adapter.makePrivate(row.id);
            if (!["changed", "skipped"].includes(outcome)) throw new Halt("verification", "Chưa xác nhận được kết quả bài vừa xử lý.");
          } catch (error) {
            if (!RECOVERABLE.has(error.code)) throw error;
            await emit(`${error.message} Đang chọn lại bộ lọc Mọi người để tiếp tục.`, { errorCode: error.code });
            await adapter.backoff(++failures);
            await check();
            await refreshFilter(() => adapter.recover());
            // Try other posts in this pass before revisiting this failed ID.
            continue;
          }
          if (!counted.has(row.id)) {
            counted.add(row.id); stats.scanned++; stats[outcome]++; failures = 0;
          }
          await emit(outcome === "changed" ? "Đã xác nhận bài chuyển sang Chỉ mình tôi." : "Bỏ qua bài đã ở Chỉ mình tôi.", { currentId: row.id });
          await adapter.rest(outcome);
          continue;
        }
        let step;
        try { step = await adapter.advance(visited); }
        catch (error) {
          if (!RECOVERABLE.has(error.code)) throw error;
          await emit("Danh sách đã thay đổi. Đang áp dụng lại Mọi người và kiểm tra từ đầu.", { errorCode: error.code });
          await adapter.backoff(++failures); await check(); await refreshFilter(() => adapter.recover()); visited.clear(); continue;
        }
        if (step === "page") { stats.pages++; await emit("Đã sang trang bài đăng tiếp theo."); continue; }
        if (step === "more") continue;
        // End of a page/scroll is NEVER proof of completion. Re-fetch the public
        // filter, return to the first page and require a stable explicit empty state.
        await emit("Đang áp dụng lại Mọi người để kiểm tra bài công khai còn sót.");
        if (await refreshFilter(() => adapter.confirmEmpty())) {
          await check();
          await emit("Hoàn tất: bộ lọc Quyền riêng tư → Mọi người không còn bài đăng.", { status: "completed", currentId: null });
          return;
        }
        if (stats.changed === passStart) {
          await emit("Mọi người vẫn còn bài. Đang chờ rồi tự thử lại; bạn có thể bấm Dừng.");
          await adapter.backoff(++failures);
        }
        passStart = stats.changed;
        visited.clear();
      }
    } catch (error) {
      await emit(error.message || "Có lỗi khi xử lý danh sách.", {
        status: error.code === "stopped" ? "stopped" : "error", errorCode: error.code || "unexpected",
      });
    }
  }
  globalThis.TSP.run = run;
})();
