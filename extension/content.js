(() => {
  "use strict";
  if (window.top !== window || globalThis.__tspLoaded) return;
  globalThis.__tspLoaded = true;
  let active = null;
  let cancelled = false;
  let claiming = false;
  let overlay = null;
  const send = async (message) => {
    let result;
    try { result = await chrome.runtime.sendMessage(message); }
    catch { throw new TSP.Halt("connection", "Mất kết nối extension. Tải lại extension rồi chạy lại."); }
    if (!result?.ok) throw new TSP.Halt("connection", result?.error || "Không nhận được phản hồi từ extension.");
    return result;
  };
  async function guard() {
    if (cancelled || !active) throw new TSP.Halt("stopped", "Đã dừng theo yêu cầu.");
    const result = await send({ type: "CHECK", runId: active.runId });
    if (!result.allowed) { cancelled = true; throw new TSP.Halt("stopped", "Phiên xử lý đã dừng hoặc không còn hợp lệ."); }
  }
  function createOverlay() {
    const host = document.createElement("div");
    host.id = "tsp-progress";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = ":host{all:initial;position:fixed;bottom:20px;right:20px;z-index:2147483647}aside{font:14px/1.45 Segoe UI,sans-serif;background:#162d25;color:#fff;border:1px solid #a9c9b8;border-radius:14px;padding:16px;width:280px;box-shadow:0 8px 30px #0003}strong{display:block;font-size:15px}p{margin:8px 0;color:#d7e9df}button{font:inherit;border:0;border-radius:8px;padding:7px 14px;cursor:pointer;background:#e8efdd;color:#173a2c}button:disabled{opacity:.6}";
    const panel = document.createElement("aside");
    const title = document.createElement("strong"); title.textContent = "Studio Private";
    const status = document.createElement("p"); status.setAttribute("role", "status"); status.textContent = "Đang chuẩn bị…";
    const stop = document.createElement("button"); stop.type = "button"; stop.textContent = "Dừng xử lý";
    stop.addEventListener("click", () => {
      cancelled = true;
      stop.disabled = true;
      status.textContent = "Đã yêu cầu dừng. Đang kết thúc thao tác hiện tại.";
    });
    panel.append(title, status, stop); root.append(style, panel); document.documentElement.append(host);
    return { host, status, stop };
  }
  async function claim() {
    if (claiming || active || !TSP.isStudio(location.href)) return;
    claiming = true;
    try {
      const response = await send({ type: "CLAIM" });
      if (!response.job) return;
      active = response.job;
      cancelled = false;
      overlay?.host.remove();
      overlay = createOverlay();
      const runId = active.runId;
      const heartbeat = setInterval(() => {
        send({ type: "HEARTBEAT", runId }).then((r) => { if (!r.allowed) cancelled = true; }, () => { cancelled = true; });
      }, 10000);
      try {
        const adapter = new TSP.DomAdapter(active.settings, guard, () => cancelled);
        await TSP.run(adapter, async (data) => {
          overlay.status.textContent = `${data.changed} bài đã đổi · ${data.skipped} bài đã riêng tư. ${data.message}`;
          const result = await send({ type: "REPORT", runId, data });
          if (!result.allowed) cancelled = true;
          if (data.status) { overlay.stop.textContent = data.status === "completed" ? "Hoàn tất" : "Đã dừng"; overlay.stop.disabled = true; }
        }, guard);
      } finally { clearInterval(heartbeat); active = null; }
    } catch (error) {
      if (overlay) { overlay.status.textContent = error.message; overlay.stop.disabled = true; }
    } finally { claiming = false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === "STOP" && active?.runId === message.runId) {
      cancelled = true;
      if (overlay) { overlay.status.textContent = "Đã dừng. Kiểm tra bài cuối nếu thao tác đang lưu."; overlay.stop.disabled = true; }
      reply({ stopped: true });
    }
  });
  let lastPath = location.pathname;
  // Only retry after an SPA route change (for example returning from login).
  setInterval(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; void claim(); } }, 1500);
  void claim();
})();
