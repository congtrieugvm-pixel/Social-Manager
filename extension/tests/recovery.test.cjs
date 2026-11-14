const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dom } = require("./helpers.cjs");

test("missing Only me after five posts defers the failure and continues until confirmed empty", async () => {
  const d = dom("");
  try {
    const remaining = Array.from({ length: 7 }, (_, i) => String(7000000000000000000n + BigInt(i)));
    let recoveries = 0, confirmations = 0, failOnce = true;
    const reports = [];
    const a = {
      prepare: async () => {}, rows: () => remaining.map((id) => ({ id })),
      makePrivate: async (id) => {
        if (remaining.length === 2 && failOnce) { failOnce = false; throw new d.window.TSP.Halt("privacy_menu", "Không thấy lựa chọn Chỉ mình tôi trong menu vừa mở."); }
        remaining.splice(remaining.indexOf(id), 1); return "changed";
      },
      rest: async () => {}, advance: async () => "end",
      skipProblem: async () => { recoveries++; },
      confirmEmpty: async () => { confirmations++; return remaining.length === 0; },
      backoff: async () => {},
    };
    await d.window.TSP.run(a, async (r) => reports.push(r), async () => {});
    assert.equal(reports.at(-1).status, "completed");
    assert.equal(reports.at(-1).changed, 7);
    assert(recoveries > 0); assert(confirmations > 0); assert.equal(remaining.length, 0);
  } finally { d.window.close(); }
});

test("last page is not completion if reapplying Everyone still finds public posts", async () => {
  const d = dom("");
  try {
    let rows = [], confirmations = 0, changed = 0;
    const reports = [];
    const a = {
      prepare: async () => {}, rows: () => rows,
      makePrivate: async () => { changed++; rows = []; return "changed"; }, rest: async () => {}, advance: async () => "end",
      confirmEmpty: async () => { if (++confirmations === 1) { rows = [{ id: "7000000000000000008" }]; return false; } return true; },
      recover: async () => {}, backoff: async () => {},
    };
    await d.window.TSP.run(a, async (r) => reports.push(r), async () => {});
    assert.equal(changed, 1); assert.equal(confirmations, 2); assert.equal(reports.at(-1).status, "completed");
  } finally { d.window.close(); }
});

test("repeated menu failures remain retryable with backoff and stop is always honored", async () => {
  const d = dom("");
  try {
    let recoveries = 0; const waits = [], reports = [];
    const a = {
      prepare: async () => {}, rows: () => [{ id: "7000000000000000009" }],
      makePrivate: async () => { throw new d.window.TSP.Halt("privacy_menu", "Menu chưa mở"); },
      advance: async () => "end", confirmEmpty: async () => false,
      skipProblem: async () => { recoveries++; }, backoff: async (attempt) => waits.push(attempt),
    };
    await d.window.TSP.run(a, async (r) => reports.push(r), async () => { if (recoveries >= 4) throw new d.window.TSP.Halt("stopped", "Dừng"); });
    assert.equal(recoveries, 4); assert(waits.length >= 3);
    assert.equal(reports.at(-1).status, "stopped"); assert.equal(reports.at(-1).changed, 0);
    assert(!reports.some((r) => r.status === "completed"));
  } finally { d.window.close(); }
});

test("posts that reappear after a save are retried without double-counting", async () => {
  const d = dom("");
  try {
    let visible = true, edits = 0, checks = 0; const reports = [];
    const a = {
      prepare: async () => {}, rows: () => visible ? [{ id: "7000000000000000010" }] : [],
      makePrivate: async () => { edits++; visible = false; return "changed"; }, rest: async () => {}, advance: async () => "end",
      confirmEmpty: async () => { if (++checks === 1) { visible = true; return false; } return true; },
      recover: async () => {}, backoff: async () => {},
    };
    await d.window.TSP.run(a, async (r) => reports.push(r), async () => {});
    assert.equal(edits, 2); assert.equal(reports.at(-1).changed, 1); assert.equal(reports.at(-1).status, "completed");
  } finally { d.window.close(); }
});
