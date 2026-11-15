const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { source } = require("./helpers.cjs");
function harness(existing) {
  const data = existing || { session: {}, local: {}, tabs: [], nextId: 10 };
  const events = {};
  const on = (name) => ({ addListener(fn) { events[name] = fn; } });
  const storage = (area) => ({ get: async (key) => ({ [key]: structuredClone(data[area][key]) }), set: async (value) => Object.assign(data[area], structuredClone(value)) });
  const chrome = {
    runtime: { id: "test-extension", getURL: (s) => `chrome-extension://test-extension/${s}`, onMessage: on("message") },
    storage: { session: storage("session"), local: storage("local") },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    tabs: { create: async (args) => { const tab = { id: data.nextId++, ...args }; data.tabs.push(tab); return tab; }, update: async (id, args) => Object.assign(data.tabs.find((t) => t.id === id), args), sendMessage: async () => {}, onRemoved: on("removed"), onUpdated: on("updated") },
    alarms: { create: async () => {}, clear: async () => {}, onAlarm: on("alarm") },
  };
  const context = vm.createContext({ chrome, crypto: require("node:crypto").webcrypto, URL, console, structuredClone });
  context.importScripts = (name) => vm.runInContext(source(name), context);
  vm.runInContext(source("background.js"), context);
  const popup = { id: chrome.runtime.id, url: chrome.runtime.getURL("popup.html") };
  const content = (job, extra = {}) => ({ id: chrome.runtime.id, url: "https://www.tiktok.com/tiktokstudio/content", tab: { id: job.tabId }, frameId: 0, documentId: "doc-a", ...extra });
  const send = (message, sender = popup) => new Promise((resolve) => events.message(message, sender, resolve));
  return { data, events, send, content, popup };
}
test("only extension popup may start; concurrent starts allocate one tab", async () => {
  const h = harness();
  assert.equal((await h.send({ type: "START" }, { id: "test-extension", url: "https://www.tiktok.com/" })).ok, false);
  const results = await Promise.all([h.send({ type: "START" }), h.send({ type: "START" })]);
  assert.equal(results.filter((r) => r.ok).length, 1); assert.equal(h.data.tabs.length, 1);
});
test("only intended main-frame document claims the job; stale document cannot update", async () => {
  const h = harness(); const { job } = await h.send({ type: "START" });
  assert.equal((await h.send({ type: "CLAIM" }, h.content(job, { frameId: 1 }))).job, null);
  assert.equal((await h.send({ type: "CLAIM" }, h.content(job, { tab: { id: 99 } }))).job, null);
  assert.equal((await h.send({ type: "CLAIM" }, h.content(job))).job.status, "running");
  assert.equal((await h.send({ type: "CHECK", runId: job.runId }, h.content(job, { documentId: "doc-b" }))).allowed, false);
  assert.equal((await h.send({ type: "CHECK", runId: job.runId }, h.content(job))).allowed, true);
});
test("worker restart preserves running state and stop prevents stale progress from reviving it", async () => {
  let h = harness(); const { job } = await h.send({ type: "START" }); await h.send({ type: "CLAIM" }, h.content(job));
  h = harness(h.data);
  assert.equal((await h.send({ type: "GET" })).job.status, "running");
  await h.send({ type: "STOP" });
  assert.equal((await h.send({ type: "CHECK", runId: job.runId }, h.content(job))).allowed, false);
  const result = await h.send({ type: "REPORT", runId: job.runId, data: { changed: 1, skipped: 0, scanned: 1, pages: 1, status: "completed" } }, h.content(job));
  assert.equal(result.allowed, false); assert.equal(h.data.session.job.status, "stopped");
});
test("closing or reloading Studio interrupts a running job", async () => {
  for (const event of ["removed", "updated"]) {
    const h = harness(); const { job } = await h.send({ type: "START" }); await h.send({ type: "CLAIM" }, h.content(job));
    h.events[event](job.tabId, { status: "loading" });
    const result = await h.send({ type: "GET" }); assert.equal(result.job.status, "interrupted");
  }
});
test("heartbeat timeout interrupts rather than completing a job", async () => {
  const h = harness(); const { job } = await h.send({ type: "START" }); await h.send({ type: "CLAIM" }, h.content(job));
  h.data.session.job.heartbeatAt = Date.now() - 100000;
  h.events.alarm({ name: "watch-job" });
  assert.equal((await h.send({ type: "GET" })).job.status, "interrupted");
});
test("invalid settings and forged external controls cannot change the session", async () => {
  const h = harness(); assert.equal((await h.send({ type: "START", settings: { delayMs: 0 } })).ok, false);
  const { job } = await h.send({ type: "START" });
  assert.equal((await h.send({ type: "STOP" }, h.content(job))).ok, false);
  assert.equal(h.data.session.job.status, "opening");
});

test("progress accepts sanitized DOM row keys for captionless posts", async () => {
  const h = harness();
  const { job } = await h.send({ type: "START" });
  await h.send({ type: "CLAIM" }, h.content(job));
  const data = { changed: 0, skipped: 0, scanned: 1, pages: 1, currentId: "dom:0123456789abcdef" };
  assert.equal((await h.send({ type: "REPORT", runId: job.runId, data }, h.content(job))).allowed, true);
  assert.equal(h.data.session.job.currentId, data.currentId);
  data.currentId = "https://example.test/private-url";
  await h.send({ type: "REPORT", runId: job.runId, data }, h.content(job));
  assert.equal(h.data.session.job.currentId, "dom:0123456789abcdef");
});
