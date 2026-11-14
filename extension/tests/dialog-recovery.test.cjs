const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ids, dom, adapter, studio, table, row, wire } = require("./helpers.cjs");

test("startup applies Everyone before touching any post, including when another privacy filter was saved", async () => {
  const d = dom("");
  try {
    const ui = studio(d.window, [{ id: ids[0] }, { id: ids[1], privacy: "friends" }], { initialFilter: ["friends"], customCheckboxes: true });
    await adapter(d.window).prepare();
    assert.deepEqual(ui.selected, ["public"]); assert.equal(ui.edits.length, 0);
    assert.deepEqual([...adapter(d.window).rows()].map((r) => r.id), [ids[0]]);
  } finally { d.window.close(); }
});

for (const mode of ["escape", "close-icon", "cancel-div"]) test(`privacy dialog without a Cancel button closes using ${mode}`, async () => {
  const d = dom(table(row(ids[0])));
  try {
    const modal = d.window.document.createElement("div"); modal.setAttribute("role", "dialog");
    modal.innerHTML = '<p>Quyền riêng tư: Chỉ mình tôi</p><button>Lưu</button>';
    let saves = 0; modal.querySelector("button").onclick = () => saves++;
    if (mode === "escape") d.window.document.addEventListener("keydown", (e) => { if (e.key === "Escape") modal.remove(); });
    else {
      const close = d.window.document.createElement("div");
      if (mode === "close-icon") { close.setAttribute("role", "button"); close.setAttribute("aria-label", "Close dialog"); close.innerHTML = "<svg></svg>"; }
      else close.innerHTML = "<span>Hủy bỏ</span>";
      close.onclick = () => modal.remove(); modal.append(close);
    }
    d.window.document.body.append(modal);
    await adapter(d.window).dismissRowMenu();
    assert.equal(modal.isConnected, false); assert.equal(saves, 0, "Recovery must never click Save");
  } finally { d.window.close(); }
});

test("a modal that cannot close stays visible and no following post is edited behind it", async () => {
  const d = dom(table(row(ids[0])) + '<div role="dialog" aria-modal="true"><p>Quyền riêng tư</p><button>Lưu</button></div>');
  try {
    wire(d.window); let clicks = 0; d.window.document.querySelector(".privacy").addEventListener("click", () => clicks++);
    await assert.rejects(adapter(d.window).makePrivate(ids[0]), { code: "dialog_blocked" });
    assert.equal(clicks, 0); assert(d.window.document.querySelector('[role="dialog"]'));
  } finally { d.window.close(); }
});

test("after nine successful posts, an uncloseable-dialog error scrolls onward before refiltering and is retried at end", async () => {
  const d = dom("");
  try {
    const all = Array.from({ length: 12 }, (_, i) => String(7200000000000000000n + BigInt(i)));
    let remaining = [...all], failed = false, reachedEnd = false;
    const events = [], reports = [];
    const a = {
      prepare: async () => { events.push("filter-start"); }, rows: () => remaining.map((id) => ({ id })),
      makePrivate: async (id) => {
        events.push(id);
        if (id === all[9] && !failed) { failed = true; throw new d.window.TSP.Halt("ambiguous_dialog", "Có hộp thoại chưa đóng. Không thể khôi phục bộ lọc tự động."); }
        remaining = remaining.filter((value) => value !== id); return "changed";
      },
      skipProblem: async () => { events.push("scroll"); }, rest: async () => {}, backoff: async () => {},
      advance: async () => { reachedEnd = true; events.push("end"); return "end"; },
      recover: async () => { throw Error("Must not refilter after a single row fails"); },
      confirmEmpty: async () => { assert(reachedEnd); events.push("filter-end"); return !remaining.length; },
    };
    await d.window.TSP.run(a, async (r) => reports.push(r), async () => {});
    assert.equal(reports.at(-1).status, "completed"); assert.equal(reports.at(-1).changed, 12);
    assert(events.indexOf("scroll") > events.indexOf(all[9]));
    assert(events.indexOf(all[10]) > events.indexOf("scroll"));
    assert(events.indexOf("filter-end") > events.indexOf(all[11]));
    assert.equal(events.filter((value) => value === all[9]).length, 2);
  } finally { d.window.close(); }
});

test("skipping a failed post scrolls even while other unprocessed rows already exist", async () => {
  const d = dom(table(ids.map((id) => row(id)).join("")));
  try {
    Object.defineProperty(d.window.document.documentElement, "scrollHeight", { configurable: true, value: 2400 });
    const a = adapter(d.window); await a.skipProblem(ids[0]);
    assert(d.window.document.documentElement.scrollTop > 0);
  } finally { d.window.close(); }
});

test("Stop during dialog recovery prevents the subsequent scroll", async () => {
  const d = dom(table(row(ids[0]))); let stopped = false;
  try {
    Object.defineProperty(d.window.document.documentElement, "scrollHeight", { configurable: true, value: 2400 });
    d.window.document.addEventListener("keydown", () => { stopped = true; });
    await assert.rejects(adapter(d.window, { stopped: () => stopped }).skipProblem(ids[0]), { code: "stopped" });
    assert.equal(d.window.document.documentElement.scrollTop, 0);
  } finally { d.window.close(); }
});

test("persistent dialogs defer all rows, then wait with Stop available instead of reporting completion", async () => {
  const d = dom("");
  try {
    const attempted = [], scrolled = [], reports = []; let retries = 0;
    const a = {
      prepare: async () => {}, rows: () => ids.map((id) => ({ id })),
      makePrivate: async (id) => { attempted.push(id); throw new d.window.TSP.Halt("dialog_blocked", "Hộp thoại chưa đóng"); },
      skipProblem: async (id) => scrolled.push(id), advance: async () => "end",
      confirmEmpty: async () => { throw new d.window.TSP.Halt("dialog_blocked", "Hộp thoại chưa đóng"); },
      backoff: async () => { retries++; },
    };
    await d.window.TSP.run(a, async (report) => reports.push(report), async () => { if (retries >= 2) throw new d.window.TSP.Halt("stopped", "Dừng"); });
    assert.deepEqual(attempted, ids); assert.deepEqual(scrolled, ids);
    assert.equal(reports.at(-1).status, "stopped"); assert.equal(reports.at(-1).changed, 0);
    assert(!reports.some((report) => ["completed", "error"].includes(report.status)));
  } finally { d.window.close(); }
});
