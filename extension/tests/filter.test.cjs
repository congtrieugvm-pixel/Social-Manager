const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ids, dom, adapter, studio } = require("./helpers.cjs");

test("screenshot filter selects only Everyone and Apply, leaving private/friends unchecked", async () => {
  const d = dom("");
  try {
    const ui = studio(d.window, [{ id: ids[0] }, { id: ids[1], privacy: "private" }, { id: ids[2], privacy: "friends" }], { initialFilter: ["private", "friends"] });
    const a = adapter(d.window); await a.selectEveryone(true);
    assert.deepEqual(ui.selected, ["public"]); assert.equal(a.rows().length, 1); assert.equal(a.publicFiltered, true);
    assert.equal(ui.edits.length, 0, "Applying a list filter must not edit any post");
    assert.equal(d.window.document.getElementById("filter-panel"), null);
  } finally { d.window.close(); }
});
test("custom role checkboxes are read and toggled by state, not guessed clicks", async () => {
  const d = dom("");
  try { const ui = studio(d.window, [{ id: ids[0] }], { roleCheckboxes: true }); await adapter(d.window).selectEveryone(true); assert.deepEqual(ui.selected, ["public"]); }
  finally { d.window.close(); }
});
test("a filter dialog is never mistaken for the per-post privacy dialog", async () => {
  const d = dom("");
  try {
    studio(d.window, [{ id: ids[0] }]); const a = adapter(d.window); await a.openFilter();
    assert.equal(a.privacyDialog().length, 0); assert.equal(a.privateChoices().length, 0); assert.equal(await a.confirmIfNeeded(), false);
  } finally { d.window.close(); }
});
test("post disappearing from confirmed public filter is verified, then fresh empty filter confirms completion", async () => {
  const d = dom("");
  try {
    const ui = studio(d.window, [{ id: ids[0] }]); const a = adapter(d.window); await a.selectEveryone(true);
    assert.equal(await a.makePrivate(ids[0]), "changed"); assert.equal(a.rows().length, 0);
    assert.equal(await a.confirmEmpty(), true); assert.deepEqual(ui.applies.at(-1), ["public"]);
    assert(ui.applies.some((values) => values.length === 3), "Must force an actual filter reload");
  } finally { d.window.close(); }
});
test("reapplying Everyone returns to page one even if filter keeps the previous page offset", async () => {
  const d = dom("");
  try {
    const ui = studio(d.window, ids.map((id) => ({ id })), { pageSize: 1, startPage: 2, stickyPage: true });
    const a = adapter(d.window); a.leftFirstPage = true; await a.selectEveryone(true);
    assert.equal(ui.page, 0); assert.equal(a.rows()[0].id, ids[0]); assert.equal(await a.confirmEmpty(), false);
  } finally { d.window.close(); }
});
test("empty non-public filter never proves completion while Everyone still has posts", async () => {
  const d = dom("");
  try {
    studio(d.window, [{ id: ids[0] }], { initialFilter: ["private"] }); const a = adapter(d.window);
    assert.equal(a.empty(), true); assert.equal(await a.confirmEmpty(), false); assert.equal(a.rows().length, 1);
  } finally { d.window.close(); }
});

test("an empty later page returns to an empty first page using refreshed pagination nodes", async () => {
  const d = dom("");
  try {
    const ui = studio(d.window, ids.map((id) => ({ id, privacy: "private" })), { pageSize: 1, startPage: 2, stickyPage: true });
    const a = adapter(d.window); a.leftFirstPage = true;
    assert.equal(await a.confirmEmpty(), true); assert.equal(ui.page, 0);
  } finally { d.window.close(); }
});
test("vanishing rows without an explicit empty state cannot report completion", async () => {
  const d = dom("");
  try { studio(d.window, [], { noEmptyMarker: true }); await assert.rejects(adapter(d.window).confirmEmpty(), { code: "filter_state" }); }
  finally { d.window.close(); }
});
test("DOM fixture recovery after five successful posts drains Everyone and does not edit Friends", async () => {
  const d = dom("");
  try {
    const publicIds = Array.from({ length: 8 }, (_, i) => String(7100000000000000000n + BigInt(i)));
    const ui = studio(d.window, [...publicIds.map((id) => ({ id })), { id: ids[0], privacy: "friends" }], { failId: publicIds[5], pageSize: 3 });
    const reports = []; await d.window.TSP.run(adapter(d.window), async (r) => reports.push(r), async () => {});
    assert.equal(reports.at(-1).status, "completed"); assert.equal(reports.at(-1).changed, 8);
    assert(ui.applies.length >= 4); assert.equal([...ui.posts.values()].filter((value) => value === "public").length, 0);
    assert.equal(ui.posts.get(ids[0]), "friends"); assert.equal(new Set(ui.edits).size, 8);
    assert(reports.some((report) => report.message.includes("Tạm bỏ qua bài này")));
  } finally { d.window.close(); }
});
