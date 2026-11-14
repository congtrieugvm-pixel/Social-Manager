const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ids, row, table, dom, adapter, wire, studio } = require("./helpers.cjs");

test("English and Vietnamese privacy labels are normalized without treating a caption as a control", async () => {
  const d = dom(table(row(ids[0], "Công khai", "Only me") + row(ids[1], "Chỉ mình tôi")));
  try {
    const w = d.window, a = adapter(w); const deletes = wire(w, { label: "Chỉ mình tôi" });
    assert.equal(a.rows().length, 2);
    assert.equal(await a.makePrivate(ids[0]), "changed");
    assert.equal(await a.makePrivate(ids[1]), "skipped");
    assert.equal(deletes(), 0);
  } finally { d.window.close(); }
});
test("explicit privacy dialog must be saved and disappear before counting a change", async () => {
  const d = dom(table(row(ids[0])));
  try { wire(d.window, { dialog: true }); assert.equal(await adapter(d.window).makePrivate(ids[0]), "changed"); assert.equal(d.window.document.querySelector("[role=dialog]"), null); }
  finally { d.window.close(); }
});
test("row that never changes is an error, not success", async () => {
  const d = dom(table(row(ids[0])));
  try { wire(d.window, { noSave: true }); await assert.rejects(adapter(d.window).makePrivate(ids[0]), { code: "verification" }); }
  finally { d.window.close(); }
});
test("TikTok error stops an optimistic change", async () => {
  const d = dom(table(row(ids[0])));
  try { wire(d.window, { error: true }); await assert.rejects(adapter(d.window).makePrivate(ids[0]), { code: "tiktok_error" }); }
  finally { d.window.close(); }
});
test("stop between menu open and selecting Only me prevents the privacy mutation", async () => {
  const d = dom(table(row(ids[0]))); let stopped = false;
  try {
    wire(d.window, { afterOpen: () => stopped = true });
    await assert.rejects(adapter(d.window, { stopped: () => stopped }).makePrivate(ids[0]), { code: "stopped" });
    assert.equal(d.window.document.querySelector(".privacy").textContent, "Everyone");
  } finally { d.window.close(); }
});
test("two new Only me options stop without guessing", async () => {
  const d = dom(table(row(ids[0])));
  try {
    wire(d.window, { afterOpen: () => {
      const extra = d.window.document.createElement("button"); extra.textContent = "Only me"; d.window.document.body.append(extra);
    } });
    await assert.rejects(adapter(d.window).makePrivate(ids[0]), { code: "ambiguous_option" });
  } finally { d.window.close(); }
});
test("native select changes only to the option with a private label", async () => {
  const d = dom(table(`<tr><td><a href='/@x/video/${ids[0]}'>Test</a></td><td><select><option value='public'>Everyone</option><option value='0'>Only you</option></select></td></tr>`));
  try { assert.equal(await adapter(d.window).makePrivate(ids[0]), "changed"); assert.equal(d.window.document.querySelector("select").value, "0"); }
  finally { d.window.close(); }
});
test("a duplicate ID in separate rows is rejected", () => {
  const d = dom(table(row(ids[0]) + row(ids[0])));
  try { assert.throws(() => adapter(d.window).rows(), { code: "ambiguous_row" }); }
  finally { d.window.close(); }
});
test("div rows with stable post links are discovered", async () => {
  const d = dom(`<section><div><a href='/@x/video/${ids[0]}'>Video</a><div role='button'>Only me</div></div></section>`);
  try { const a = adapter(d.window); assert.equal(a.rows().length, 1); assert.equal(await a.makePrivate(ids[0]), "skipped"); }
  finally { d.window.close(); }
});
test("no end marker never becomes a completed entire-account run", async () => {
  const d = dom(table(row(ids[0], "Only me")));
  try { assert.equal(await adapter(d.window).advance(new Set([ids[0]])), "unknown"); }
  finally { d.window.close(); }
});
test("pagination handles a disabled final next control", async () => {
  const d = dom(table(row(ids[0])) + "<button aria-label='Next page'>→</button>");
  try {
    const a = adapter(d.window); a.pageSignatures.add(a.signature());
    d.window.document.querySelector("[aria-label='Next page']").onclick = (event) => { d.window.document.querySelector("tbody").innerHTML = row(ids[1]); event.currentTarget.disabled = true; };
    assert.equal(await a.advance(new Set([ids[0]])), "page");
    assert.equal(await a.advance(new Set([ids[0], ids[1]])), "end");
  } finally { d.window.close(); }
});
test("pagination stuck on same content is an error", async () => {
  const d = dom(table(row(ids[0])) + "<button aria-label='Next page'>→</button>");
  try { await assert.rejects(adapter(d.window).advance(new Set([ids[0]])), { code: "unsupported_ui" }); }
  finally { d.window.close(); }
});
test("pagination cycle back to a prior page is rejected", async () => {
  const d = dom(table(row(ids[0])) + "<button aria-label='Next page'>→</button>");
  try {
    const a = adapter(d.window); a.pageSignatures.add(a.signature());
    d.window.document.querySelector("tbody").innerHTML = row(ids[1]); a.pageSignatures.add(a.signature());
    d.window.document.querySelector("[aria-label='Next page']").onclick = () => d.window.document.querySelector("tbody").innerHTML = row(ids[0]);
    await assert.rejects(a.advance(new Set(ids)), { code: "pagination_loop" });
  } finally { d.window.close(); }
});
test("CAPTCHA, search filters and missing privacy controls stop", async () => {
  const d = dom(table(row(ids[0])) + "<input type='search' value='keyword'>");
  try {
    const a = adapter(d.window); await assert.rejects(a.prepare(), { code: "filtered" });
    d.window.document.querySelector("input").remove();
    d.window.document.querySelector(".privacy").textContent = "Something new";
    await assert.rejects(a.makePrivate(ids[0]), { code: "unknown_privacy" });
    const captcha = d.window.document.createElement("div"); captcha.id = "captcha-verify"; d.window.document.body.append(captcha);
    assert.throws(() => a.assert(), { code: "captcha" });
  } finally { d.window.close(); }
});
test("engine integrates the public filter and only finishes at a rechecked empty list", async () => {
  const d = dom("");
  try {
    studio(d.window, [{ id: ids[0] }, { id: ids[1], privacy: "private" }]); const reports = [];
    await d.window.TSP.run(adapter(d.window), async (r) => reports.push(r), async () => {});
    const last = reports.at(-1);
    assert.equal(last.status, "completed"); assert.equal(last.changed, 1); assert.equal(last.skipped, 1); assert.equal(last.scanned, 2);
  } finally { d.window.close(); }
});
test("engine does not count a CAPTCHA-interrupted save or continue to following posts", async () => {
  const d = dom("");
  try {
    const ui = studio(d.window, [{ id: ids[0] }, { id: ids[1] }], { captchaOnClick: true }); const reports = [];
    await d.window.TSP.run(adapter(d.window), async (r) => reports.push(r), async () => {});
    assert.equal(reports.at(-1).status, "error"); assert.equal(reports.at(-1).changed, 0);
    assert.equal(reports.at(-1).errorCode, "captcha"); assert.equal(ui.posts.get(ids[1]), "public");
  } finally { d.window.close(); }
});
test("mixed list containing a privacy row without a stable ID is not silently skipped", () => {
  const d = dom(table(row(ids[0]) + "<tr><td>Unknown post</td><td><button>Everyone</button></td></tr>"));
  try { assert.throws(() => adapter(d.window).rows(), { code: "missing_id" }); }
  finally { d.window.close(); }
});
test("nested thumbnail IDs do not displace the complete privacy row", async () => {
  const d = dom(table(`<tr><td><div data-video-id='${ids[0]}'>Thumbnail</div></td><td><button>Only me</button></td></tr>`));
  try { const a = adapter(d.window); assert.equal(a.rows().length, 1); assert.equal(await a.makePrivate(ids[0]), "skipped"); }
  finally { d.window.close(); }
});
test("disabled Next during loading is not treated as the end", async () => {
  const d = dom(table(row(ids[0])) + "<button aria-label='Next page' disabled>→</button><div role='progressbar'>Loading</div>");
  try { await assert.rejects(adapter(d.window).advance(new Set([ids[0]])), { code: "unsupported_ui" }); }
  finally { d.window.close(); }
});
test("privacy filter outside rows rejects partial-account scope", async () => {
  const d = dom("<select><option>Public</option></select>" + table(row(ids[0])));
  try { await assert.rejects(adapter(d.window).prepare(), { code: "filtered" }); }
  finally { d.window.close(); }
});
test("engine reports an error instead of success when an empty public list cannot be confirmed", async () => {
  const d = dom("");
  try {
    studio(d.window, [], { noEmptyMarker: true });
    const reports = []; await d.window.TSP.run(adapter(d.window), async (r) => reports.push(r), async () => {});
    assert.equal(reports.at(-1).status, "error"); assert.equal(reports.at(-1).errorCode, "filter_state");
  } finally { d.window.close(); }
});
test("infinite scroll new rows are processed before end checks", async () => {
  const d = dom(table(row(ids[0], "Only me")));
  try {
    const a = adapter(d.window); let count = 0; const sleep = a.sleep.bind(a);
    a.sleep = async () => { await sleep(); if (++count === 1) d.window.document.querySelector("tbody").insertAdjacentHTML("beforeend", row(ids[1])); };
    assert.equal(await a.advance(new Set([ids[0]])), "more");
  } finally { d.window.close(); }
});
