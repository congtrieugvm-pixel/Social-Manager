const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ids, dom, adapter, studio } = require("./helpers.cjs");

test("startup filters Everyone before editing and leaves Friends untouched", async () => {
  const d = dom("");
  try {
    const ui = studio(d.window, [{ id: ids[0] }, { id: ids[1], privacy: "friends" }], { customCheckboxes: true });
    const a = adapter(d.window); await a.prepare();
    assert(ui.applies.length > 0); assert.deepEqual(ui.selected, ["public"]);
    assert.equal(d.window.document.getElementById("filter-panel"), null);
    assert.equal(await a.makePrivate(ids[0]), "changed"); assert.equal(ui.posts.get(ids[1]), "friends");
  } finally { d.window.close(); }
});

test("unlabelled custom checkboxes and div Apply use visible labels and verify a public-only selection", async () => {
  const d = dom("");
  try {
    const ui = studio(d.window, [{ id: ids[0] }, { id: ids[1], privacy: "private" }], { customCheckboxes: true, initialFilter: ["private", "friends"] });
    const a = adapter(d.window); await a.selectEveryone(true);
    assert.deepEqual(ui.selected, ["public"]); assert.equal(a.rows()[0].id, ids[0]); assert.equal(a.publicFiltered, true);
    await a.openFilter(); assert.equal(a.privateChoices().length, 0); assert.equal(a.privacyDialog().length, 0);
  } finally { d.window.close(); }
});

test("applies Everyone first, scrolls lazy posts, then refilters and drains late leftovers", async () => {
  const d = dom("");
  try {
    const ui = studio(d.window, [{ id: ids[0] }], { customCheckboxes: true }); const events = [];
    let position = 0, appended = false, opened = false, leftover = false, editsBeforeFilter;
    const scroll = d.window.document.documentElement;
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(scroll, "scrollTop", { configurable: true, get: () => position, set: (value) => {
      position = Math.max(0, Math.min(1200, value)); events.push(`scroll:${position}`);
      if (position >= 1000 && !appended) { appended = true; ui.posts.set(ids[1], "public"); ui.render(); }
    } });
    d.window.document.getElementById("privacy-filter").addEventListener("click", () => {
      if (!opened) { opened = true; events.push("filter"); editsBeforeFilter = [...ui.edits]; }
      if (position === 1200 && ui.edits.length === 2 && !leftover) { leftover = true; ui.posts.set(ids[2], "public"); ui.render(); }
    });
    const reports = []; await d.window.TSP.run(adapter(d.window), async (r) => reports.push(r), async () => {});
    assert.equal(reports.at(-1).status, "completed", JSON.stringify(reports.at(-1)));
    assert.equal(reports.at(-1).changed, 3); assert(events.indexOf("scroll:1200") > events.indexOf("filter"));
    assert.deepEqual(editsBeforeFilter, []); assert(leftover);
    assert.deepEqual(ui.selected, ["public"]); assert.equal([...ui.posts.values()].filter((v) => v === "public").length, 0);
  } finally { d.window.close(); }
});

test("temporary filter failure is retried until an empty public list is verified", async () => {
  const d = dom("");
  try {
    let checks = 0; const reports = [], delays = [];
    const a = { prepare: async () => {}, rows: () => [], advance: async () => "end",
      confirmEmpty: async () => { if (++checks < 3) throw new d.window.TSP.Halt("filter_control", "Menu đang tải"); return true; },
      backoff: async (attempt) => delays.push(attempt) };
    await d.window.TSP.run(a, async (r) => reports.push(r), async () => {});
    assert.equal(checks, 3); assert.equal(delays.length, 2); assert.equal(reports.at(-1).status, "completed");
  } finally { d.window.close(); }
});

test("Stop interrupts repeated filter detection errors", async () => {
  const d = dom("");
  try {
    let attempts = 0; const reports = [];
    const a = { prepare: async () => {}, rows: () => [], advance: async () => "end",
      confirmEmpty: async () => { attempts++; throw new d.window.TSP.Halt("filter_state", "Chưa áp dụng"); }, backoff: async () => {} };
    await d.window.TSP.run(a, async (r) => reports.push(r), async () => { if (attempts >= 3) throw new d.window.TSP.Halt("stopped", "Đã dừng"); });
    assert.equal(attempts, 3); assert.equal(reports.at(-1).status, "stopped");
    assert(!reports.some((r) => r.status === "completed"));
  } finally { d.window.close(); }
});

for (const failure of ["ignoreChoice", "ignoreClear"]) test(`custom filter ${failure} cannot produce a false completion`, async () => {
  const d = dom("");
  try {
    studio(d.window, [{ id: ids[0] }], { customCheckboxes: true, initialFilter: ["private"], [failure]: true });
    await assert.rejects(adapter(d.window).confirmEmpty(), { code: "filter_state" });
  } finally { d.window.close(); }
});
