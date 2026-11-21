"use strict";
importScripts("shared.js");
const { ACTIVE, STUDIO, config, isStudio } = TSP;
// All state mutations are serialized; state itself survives worker suspension.
let queue = Promise.resolve();
function serialized(fn) {
  const work = queue.then(fn, fn);
  queue = work.catch(() => {});
  return work;
}
const readJob = async () => (await chrome.storage.session.get("job")).job || null;
async function save(job) {
  job.updatedAt = Date.now();
  await chrome.storage.session.set({ job });
  await chrome.action.setBadgeText({ text: ACTIVE.has(job.status) ? String(job.changed || "…") : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#17694b" });
  return job;
}
function note(job, message) {
  job.message = message;
  job.logs = [...(job.logs || []), { at: Date.now(), message }].slice(-80);
}
function isController(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("popup.html");
}
function owns(job, message, sender) {
  return job && sender.id === chrome.runtime.id && sender.frameId === 0 &&
    sender.tab?.id === job.tabId && sender.documentId === job.documentId &&
    message.runId === job.runId && isStudio(sender.url);
}
async function stop(job, message, status = "stopped") {
  if (!job || !ACTIVE.has(job.status)) return job;
  job.status = status;
  note(job, message);
  await save(job);
  await chrome.tabs.sendMessage(job.tabId, { type: "STOP", runId: job.runId }).catch(() => {});
  return job;
}
// The web app reads POST bodies from the X-Body header (its unenv polyfill breaks req.json on
// Cloudflare), so the extension must send bodies the same way. Non-ASCII is escaped to \uXXXX.
const encodeBody = (body) => JSON.stringify(body ?? {}).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

/** Save one YouTube channel to Bookmark Key via the web app, using the stored API key. */
async function saveYoutube(url) {
  if (typeof url !== "string" || !/^https:\/\/www\.youtube\.com\//.test(url) || url.length > 500) return { ok: false, error: "Link kênh không hợp lệ." };
  const { sm } = await chrome.storage.local.get("sm");
  const origin = String(sm?.origin || "").trim().replace(/\/+$/, "");
  const key = String(sm?.key || "").trim();
  if (!/^https:\/\/[^/]+$/.test(origin) || !key) return { ok: false, error: "Chưa cấu hình. Mở tiện ích, dán Địa chỉ web và API key." };
  let res;
  try {
    res = await fetch(origin + "/api/ext/youtube/channel", { method: "POST", headers: { Authorization: "Bearer " + key, "X-Body": encodeBody({ url }) } });
  } catch { return { ok: false, error: "Không gọi được web. Kiểm tra Địa chỉ web và mạng." }; }
  let data = {};
  try { data = JSON.parse(await res.text()); } catch { /* empty / non-JSON */ }
  if (!res.ok) return { ok: false, error: data.error || ("Web trả lỗi " + res.status) };
  return { ok: true, status: data.status, title: data.title };
}

async function handle(message, sender) {
  if (!message || typeof message.type !== "string") throw new Error("Yêu cầu không hợp lệ.");
  if (message.type === "SAVE_YT") {
    if (sender.id !== chrome.runtime.id || !/^https:\/\/www\.youtube\.com\//.test(sender.url || "")) throw new Error("Nguồn không hợp lệ.");
    return await saveYoutube(message.url);
  }
  if (message.type === "EXT_CONFIG") {
    if (!isController(sender)) throw new Error("Chỉ bảng điều khiển extension được thực hiện thao tác này.");
    if (message.set) {
      const prev = (await chrome.storage.local.get("sm")).sm || {};
      const origin = String(message.set.origin || "").trim();
      const key = String(message.set.key || "").trim();
      // A blank key keeps the stored one (so the user can change only the origin).
      await chrome.storage.local.set({ sm: { origin: origin || prev.origin || "", key: key || prev.key || "" } });
    }
    const { sm } = await chrome.storage.local.get("sm");
    return { ok: true, origin: sm?.origin || "", hasKey: !!sm?.key };
  }
  let job = await readJob();
  if (["GET", "OPEN", "START", "STOP"].includes(message.type)) {
    if (!isController(sender)) throw new Error("Chỉ bảng điều khiển extension được thực hiện thao tác này.");
    if (message.type === "GET") return { job, settings: (await chrome.storage.local.get("settings")).settings || config() };
    if (message.type === "OPEN") {
      if (job?.tabId) {
        const tab = await chrome.tabs.update(job.tabId, { active: true }).catch(() => null);
        if (tab) return { tabId: tab.id };
      }
      return { tabId: (await chrome.tabs.create({ url: STUDIO })).id };
    }
    if (message.type === "STOP") return { job: await stop(job, "Đã dừng. Thao tác đã gửi tới TikTok có thể vẫn hoàn tất; kiểm tra bài cuối trong Studio.") };
    if (ACTIVE.has(job?.status)) throw new Error("Một lượt xử lý đang chạy. Dừng lượt hiện tại trước.");
    const settings = config(message.settings);
    await chrome.storage.local.set({ settings });
    // about:blank prevents a fast content script from claiming before tabId is saved.
    const tab = await chrome.tabs.create({ url: "about:blank", active: true });
    job = { runId: crypto.randomUUID(), tabId: tab.id, documentId: null, status: "opening", settings,
      changed: 0, skipped: 0, scanned: 0, pages: 0, currentId: null, logs: [], startedAt: Date.now(), heartbeatAt: Date.now() };
    note(job, "Đang mở TikTok Studio → Bài đăng. Nếu được yêu cầu, hãy đăng nhập trong tab Studio.");
    await save(job);
    await chrome.alarms.create("watch-job", { periodInMinutes: 0.5 });
    try { await chrome.tabs.update(tab.id, { url: STUDIO }); }
    catch (error) { await stop(job, "Không mở được tab Studio: " + error.message, "error"); }
    return { job };
  }
  if (message.type === "CLAIM") {
    if (!job || job.status !== "opening" || sender.id !== chrome.runtime.id ||
        sender.frameId !== 0 || sender.tab?.id !== job.tabId || !sender.documentId || !isStudio(sender.url)) return { job: null };
    job.documentId = sender.documentId;
    job.status = "running";
    job.heartbeatAt = Date.now();
    note(job, "Studio đã mở. Đang chờ danh sách bài đăng.");
    await save(job);
    return { job };
  }
  if (!owns(job, message, sender)) return { allowed: false };
  if (message.type === "CHECK" || message.type === "HEARTBEAT") {
    if (job.status !== "running") return { allowed: false };
    job.heartbeatAt = Date.now();
    await chrome.storage.session.set({ job });
    return { allowed: true };
  }
  if (message.type === "REPORT") {
    if (job.status !== "running") return { allowed: false };
    const data = message.data || {};
    for (const field of ["changed", "skipped", "scanned", "pages"]) {
      if (!Number.isSafeInteger(data[field]) || data[field] < job[field]) throw new Error("Tiến độ không hợp lệ.");
      job[field] = data[field];
    }
    if (typeof data.currentId === "string" && /^(?:\d{6,30}|dom:[a-f0-9]{16})$/.test(data.currentId)) job.currentId = data.currentId;
    if (data.currentId === null) job.currentId = null;
    if (["completed", "review", "error", "stopped"].includes(data.status)) job.status = data.status;
    job.errorCode = typeof data.errorCode === "string" ? data.errorCode.slice(0, 60) : null;
    job.heartbeatAt = Date.now();
    note(job, String(data.message || "Đang xử lý.").slice(0, 500));
    await save(job);
    return { allowed: true };
  }
  return { allowed: false };
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // SAVE_YT / EXT_CONFIG don't touch the hide-job state, so keep them off the job queue
  // (their network call must not stall a running job's heartbeat).
  const run = message && (message.type === "SAVE_YT" || message.type === "EXT_CONFIG")
    ? handle(message, sender)
    : serialized(() => handle(message, sender));
  run.then((data) => reply({ ok: true, ...data }), (error) => reply({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void serialized(async () => { const job = await readJob(); if (job?.tabId === tabId) await stop(job, "Tab Studio đã đóng. Bấm bắt đầu để chạy lại.", "interrupted"); });
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== "loading") return;
  void serialized(async () => { const job = await readJob(); if (job?.tabId === tabId && job.status === "running") await stop(job, "Tab Studio đã tải lại hoặc chuyển trang. Bấm bắt đầu để kiểm tra lại từ đầu.", "interrupted"); });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "watch-job") return;
  void serialized(async () => {
    const job = await readJob();
    if (!job || !ACTIVE.has(job.status)) { await chrome.alarms.clear("watch-job"); return; }
    const elapsed = Date.now() - job.heartbeatAt;
    if (job.status === "running" && elapsed > 90000) await stop(job, "Mất phản hồi từ tab Studio. Bấm bắt đầu để kiểm tra lại các bài còn lại.", "interrupted");
    if (job.status === "opening" && elapsed > 600000) await stop(job, "Chưa vào được danh sách sau 10 phút. Đăng nhập TikTok rồi bấm bắt đầu lại.", "interrupted");
  });
});
