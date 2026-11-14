// A separate, disposable Chromium context. All URLs are served from fixtures;
// no TikTok network access, browser profile or signed-in account is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { root, row, table, studio } = require("./helpers.cjs");
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(root, "../app")] }));

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><style>
      body { font: 16px Arial; margin: 30px; } #toolbar { margin-bottom: 20px; }
      #post-list { height: 330px; overflow-y: auto; border: 1px solid #ddd; }
      td { height: 70px; padding: 0 20px; } button { padding: 8px 15px; }
      #filter-panel,.fixture-dialog,[role=listbox] { position: fixed; right: 40px; top: 30px; padding: 20px; background: white; border: 2px solid #333; z-index: 20; }
      .choice { padding: 8px; } .box { display: inline-block; width: 14px; height: 14px; border: 2px solid #aaa; margin-right: 10px; }
      .painted { background: #f25; } #filter-panel>div:last-child { display:flex; gap:30px; margin-top:15px; }
    </style></head><body></body></html>` }));
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("https://www.tiktok.com/tiktokstudio/content");
    for (const name of ["shared.js", "engine.js", "adapter.js"]) await page.addScriptTag({ path: path.join(root, name) });
    await page.addScriptTag({ content: `${row.toString()}\n${table.toString()}\n${studio.toString()}\nwindow.fixtureStudio = studio;` });
    const result = await page.evaluate(async () => {
      const ids = Array.from({ length: 24 }, (_, i) => String(7300000000000000000n + BigInt(i)));
      const friendId = "7400000000000000000";
      const ui = window.fixtureStudio(window, [...ids.map((id) => ({ id })), { id: friendId, privacy: "friends" }],
        { customCheckboxes: true, initialFilter: ["friends"], pageSize: 30, failId: ids[9], failDialog: true });
      const events = [], reports = [];
      document.addEventListener("scroll", () => events.push({ type: "scroll", edits: ui.edits.length }), true);
      document.getElementById("privacy-filter").addEventListener("click", () => events.push({ type: "filter", edits: ui.edits.length }));
      const a = new TSP.DomAdapter({ delayMs: 25, timeoutMs: 1200, settleMs: 40 }, async () => {}, () => false);
      const sleep = a.sleep.bind(a); a.sleep = (ms) => sleep(Math.min(ms, 25));
      const skip = a.skipProblem.bind(a);
      a.skipProblem = async (id) => {
        events.push({ type: "defer", id, edits: ui.edits.length });
        await skip(id);
        events.push({ type: "after-defer", dialogOpen: a.privacyDialog().length, scroll: a.scroller().scrollTop });
      };
      const deadline = Date.now() + 30000;
      await TSP.run(a, async (report) => reports.push(report), async () => {
        if (Date.now() > deadline) throw new TSP.Halt("stopped", "Test deadline");
      });
      return { last: reports.at(-1), events, edits: ui.edits, applies: ui.applies, selected: ui.selected,
        publicLeft: [...ui.posts.values()].filter((value) => value === "public").length,
        friendPrivacy: ui.posts.get(friendId), failedId: ids[9] };
    });
    assert.deepEqual(errors, []);
    assert.equal(result.last.status, "completed", JSON.stringify(result));
    assert.equal(result.last.changed, 24); assert.equal(result.publicLeft, 0); assert.equal(result.friendPrivacy, "friends");
    assert.deepEqual(result.selected, ["public"]);
    assert.equal(result.events.find((event) => event.type === "filter").edits, 0);
    const failureIndex = result.events.findIndex((event) => event.type === "defer");
    assert(failureIndex >= 0); assert.equal(result.events[failureIndex].edits, 9);
    const afterDefer = result.events.slice(failureIndex + 1).find((event) => event.type === "after-defer");
    assert(afterDefer); assert.equal(afterDefer.dialogOpen, 0); assert(afterDefer.scroll > 0);
    const nextFilter = result.events.slice(failureIndex + 1).find((event) => event.type === "filter");
    assert.equal(nextFilter.edits, 23, "All other posts must be attempted before refiltering");
    assert.equal(result.edits.at(-1), result.failedId, "Failed post must be retried after other posts");
    const out = path.resolve(root, "../dist/tests"); fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, "studio-private-recovery.png"), fullPage: true });
    fs.writeFileSync(path.join(out, "studio-private-recovery.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ browser: "Chromium (isolated fixture)", changed: result.last.changed, publicLeft: result.publicLeft,
      firstFilterBeforeEdits: true, failedAfter: 9, scrollAfterFailure: true, retryAfterOtherPosts: true, errors: errors.length }));
    await context.close();
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
