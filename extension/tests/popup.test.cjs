const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dom, source } = require("./helpers.cjs");
test("popup shows persisted progress and renders log text without executing HTML", async () => {
  const d = dom(source("popup.html"), { url: "chrome-extension://test-extension/popup.html" });
  try {
    const w = d.window; let listener;
    const job = { status: "running", changed: 6, skipped: 4, pages: 2, message: "Đang chạy", logs: [{ at: 0, message: "<img src=x onerror=alert(1)>" }] };
    w.chrome = { runtime: { getManifest: () => JSON.parse(source("manifest.json")), sendMessage: async () => ({ ok: true, job, settings: { delayMs: 2000 } }) }, storage: { onChanged: { addListener(fn) { listener = fn; } } } };
    w.eval(source("popup.js")); await new Promise((r) => setTimeout(r, 10));
    assert.equal(w.document.getElementById("changed").textContent, "6");
    assert.equal(w.document.getElementById("start").disabled, true);
    assert.equal(w.document.getElementById("stop").disabled, false);
    assert.equal(w.document.querySelector("#logs img"), null);
    listener({ job: { newValue: { ...job, status: "stopped" } } }, "session");
    assert.equal(w.document.getElementById("start").disabled, false);
    assert.equal(w.document.getElementById("stop").disabled, true);
  } finally { d.window.close(); }
});
