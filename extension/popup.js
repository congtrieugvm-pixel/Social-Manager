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

  // Web connection for "Lưu kênh YouTube".
  const DEFAULT_ORIGIN = "https://social-manager.congtrieugvm.workers.dev";
  function showConnect(origin, hasKey) {
    $("sm-origin").value = origin || DEFAULT_ORIGIN;
    $("sm-status").textContent = hasKey ? "Đã lưu API key. Đổi nếu cần." : "Chưa lưu API key.";
  }
  $("sm-save").addEventListener("click", async () => {
    $("sm-status").textContent = "Đang lưu…";
    try {
      const origin = ($("sm-origin").value || DEFAULT_ORIGIN).trim();
      const key = $("sm-key").value.trim();
      const r = await request("EXT_CONFIG", { set: { origin, key: key || undefined } });
      // Keep an existing key when the field is left blank.
      if (!key && !r.hasKey) { $("sm-status").textContent = "Hãy dán API key."; return; }
      $("sm-key").value = "";
      showConnect(r.origin, true);
      $("sm-status").textContent = "Đã lưu kết nối ✓";
    } catch (error) { $("sm-status").textContent = error.message; }
  });

  void action(async () => { const data = await request("GET"); $("delay").value = data.settings.delayMs / 1000; render(data.job); });
  void request("EXT_CONFIG").then((r) => showConnect(r.origin, r.hasKey)).catch(() => {});
})();
