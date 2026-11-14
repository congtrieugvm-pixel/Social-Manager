const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ids, row, table, dom, source } = require("./helpers.cjs");
const waitUntil = async (fn) => {
  const deadline = Date.now() + 3000;
  while (!fn() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
  assert(fn(), "Content runner did not finish within test deadline");
};
test("content script claims, reports progress and keeps the terminal state after popup would close", async () => {
  const d = dom(table(row(ids[0], "Only me")) + "<button aria-label='Next page' disabled>→</button>");
  try {
    const w = d.window; const reports = []; let claimed = 0;
    w.chrome = { runtime: {
      id: "test-extension", onMessage: { addListener() {} },
      sendMessage: async (m) => {
        if (m.type === "CLAIM") { claimed++; return { ok: true, job: { runId: "test", settings: { timeoutMs: 200, settleMs: 1, delayMs: 1 } } }; }
        if (m.type === "REPORT") reports.push(m.data);
        return { ok: true, allowed: true };
      },
    } };
    w.TSP.DomAdapter.prototype.sleep = async function () { this.assert(); await new Promise((r) => setTimeout(r, 1)); };
    w.eval(source("content.js")); w.eval(source("content.js"));
    await waitUntil(() => reports.some((r) => r.status === "completed"));
    assert.equal(claimed, 1); assert.equal(reports.at(-1).skipped, 1);
    assert.equal(w.document.querySelectorAll("#tsp-progress").length, 1);
  } finally { d.window.close(); }
});
test("content script cannot start without an assigned job", async () => {
  const d = dom(table(row(ids[0])));
  try {
    let claims = 0; d.window.chrome = { runtime: { id: "test-extension", onMessage: { addListener() {} }, sendMessage: async () => { claims++; return { ok: true, job: null }; } } };
    d.window.eval(source("content.js")); await new Promise((r) => setTimeout(r, 10));
    assert.equal(claims, 1); assert.equal(d.window.document.querySelector("#tsp-progress"), null);
    assert.equal(d.window.document.querySelector(".privacy").textContent, "Everyone");
  } finally { d.window.close(); }
});
