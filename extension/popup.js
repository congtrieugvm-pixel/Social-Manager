(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  const labels = { opening: "Đang mở Studio", running: "Đang xử lý", stopping: "Đang dừng", stopped: "Đã dừng", completed: "Hoàn tất", error: "Cần kiểm tra", interrupted: "Bị gián đoạn", review: "Chưa xác nhận hết" };
  let busy = false;
  let job = null;
  function render(next) {
    job = next;
    document.body.classList.toggle("has-run", Boolean(job));
    const active = TSP.ACTIVE.has(job?.status);
    $("start").disabled = active || busy;
    $("stop").disabled = !active || busy;
    $("delay").disabled = active || busy;
    $("start-label").textContent = active ? "Đang ẩn bài công khai…" : job ? "Kiểm tra và chạy lại" : "Ẩn tất cả bài công khai";
    $("badge").textContent = labels[job?.status] || "Sẵn sàng";
    $("badge").dataset.state = job?.status || "idle";
    for (const field of ["changed", "skipped"]) $(field).textContent = String(job?.[field] || 0);
    $("pages").textContent = job?.pages || "—";
    $("status").textContent = job?.message || "Bấm bắt đầu để tự mở Studio và xử lý bài đăng.";
    $("logs").replaceChildren();
    for (const log of (job?.logs || []).slice(-30).reverse()) {
      const li = document.createElement("li");
      const time = document.createElement("time"); time.textContent = new Date(log.at).toLocaleTimeString("vi-VN");
      li.append(time, document.createTextNode(log.message)); $("logs").append(li);
    }
    if (!job?.logs?.length) { const li = document.createElement("li"); li.textContent = "Chưa có lượt xử lý."; $("logs").append(li); }
  }
  async function request(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || "Không kết nối được extension. Hãy tải lại extension.");
    return response;
  }
  async function action(fn) {
    busy = true; $("error").hidden = true; render(job);
    try { await fn(); }
    catch (error) { $("error").textContent = error.message; $("error").hidden = false; }
    finally { busy = false; render(job); }
  }
  $("start").addEventListener("click", () => action(async () => {
    const settings = TSP.config({ delayMs: Number($("delay").value) * 1000 });
    render((await request("START", { settings })).job);
  }));
  $("stop").addEventListener("click", () => action(async () => render((await request("STOP")).job)));
  $("open").addEventListener("click", () => action(() => request("OPEN")));
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes.job) render(changes.job.newValue); });
  void action(async () => { const data = await request("GET"); $("delay").value = data.settings.delayMs / 1000; render(data.job); });
})();
