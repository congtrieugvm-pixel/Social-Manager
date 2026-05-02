/**
 * Focused integration test for parseGraphError, mapTokenErrorToVi,
 * and verifyTokenWithoutAppCreds. No test runner deps — uses node:assert.
 * Run: npx tsx scripts/test-facebook-verify.ts
 */

import assert from "node:assert/strict";
import {
  parseGraphError,
  mapTokenErrorToVi,
  verifyTokenWithoutAppCreds,
  fetchMeAccounts,
  fetchPageEarnings,
  fetchPostVideoEarnings,
  fetchPageEarningsBreakdown,
} from "../src/lib/facebook";

// ── helpers ──────────────────────────────────────────────────────────────────

const results: Array<{ name: string; ok: boolean; err?: string }> = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    results.push({ name, ok: false, err: msg });
    console.error(`  FAIL  ${name}\n         ${msg}`);
  }
}

function makeFetchMock(
  responses: Array<{ status: number; body: unknown }>,
): typeof fetch {
  const queue = [...responses];
  return async (_url: string | URL | Request, _opts?: RequestInit) => {
    const resp = queue.shift();
    if (!resp) throw new Error("Unexpected fetch call — no more queued responses");
    const body = JSON.stringify(resp.body);
    return new Response(body, {
      status: resp.status,
      headers: { "content-type": "application/json" },
    });
  };
}

function makeFetchTrace(
  responses: Array<{ status: number; body: unknown }>,
): { fetch: typeof fetch; calls: string[] } {
  const queue = [...responses];
  const calls: string[] = [];
  const fn: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const resp = queue.shift();
    if (!resp) throw new Error("Unexpected fetch call");
    return new Response(JSON.stringify(resp.body), {
      status: resp.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fn, calls };
}

// ── run ───────────────────────────────────────────────────────────────────────

async function main() {
  // 1. parseGraphError — happy paths
  await test("parseGraphError: graph.code=190 sub=463 → expired", () => {
    const e = Object.assign(new Error("Session expired"), {
      graph: { code: 190, error_subcode: 463 },
    });
    const r = parseGraphError(e);
    assert.equal(r.kind, "expired");
    assert.equal(r.code, 190);
    assert.equal(r.subcode, 463);
  });

  await test("parseGraphError: graph.code=190 sub=458 → invalid", () => {
    const e = Object.assign(new Error("Invalid token"), {
      graph: { code: 190, error_subcode: 458 },
    });
    assert.equal(parseGraphError(e).kind, "invalid");
  });

  await test("parseGraphError: graph.code=10 → permission", () => {
    const e = Object.assign(new Error("Permission denied"), { graph: { code: 10 } });
    assert.equal(parseGraphError(e).kind, "permission");
  });

  await test("parseGraphError: graph.code=4 → rate_limit", () => {
    const e = Object.assign(new Error("Rate limited"), { graph: { code: 4 } });
    assert.equal(parseGraphError(e).kind, "rate_limit");
  });

  await test("parseGraphError: plain Error (no .graph) → network, message preserved", () => {
    const e = new Error("boom");
    const r = parseGraphError(e);
    assert.equal(r.kind, "network");
    assert.equal(r.message, "boom");
    assert.equal(r.code, null);
  });

  await test("parseGraphError: raw FB payload { error:{code:190,error_subcode:463} } → expired", () => {
    const payload = { error: { code: 190, error_subcode: 463, message: "Session expired" } };
    const r = parseGraphError(payload);
    assert.equal(r.kind, "expired");
  });

  // 2. mapTokenErrorToVi — string contents per kind
  await test("mapTokenErrorToVi: expired → contains 'hết hạn'", () => {
    const msg = mapTokenErrorToVi({ kind: "expired", code: 190, subcode: 463, type: null, message: "", fbtraceId: null });
    assert.ok(msg.includes("hết hạn"), `Got: ${msg}`);
  });

  await test("mapTokenErrorToVi: invalid → contains 'không hợp lệ'", () => {
    const msg = mapTokenErrorToVi({ kind: "invalid", code: 190, subcode: 458, type: null, message: "", fbtraceId: null });
    assert.ok(msg.includes("không hợp lệ"), `Got: ${msg}`);
  });

  await test("mapTokenErrorToVi: permission → contains 'thiếu quyền'", () => {
    const msg = mapTokenErrorToVi({ kind: "permission", code: 10, subcode: null, type: null, message: "x", fbtraceId: null });
    assert.ok(msg.includes("thiếu quyền"), `Got: ${msg}`);
  });

  await test("mapTokenErrorToVi: rate_limit → contains 'giới hạn'", () => {
    const msg = mapTokenErrorToVi({ kind: "rate_limit", code: 4, subcode: null, type: null, message: "", fbtraceId: null });
    assert.ok(msg.includes("giới hạn"), `Got: ${msg}`);
  });

  await test("mapTokenErrorToVi: network → contains 'Không gọi được'", () => {
    const msg = mapTokenErrorToVi({ kind: "network", code: null, subcode: null, type: null, message: "ECONNREFUSED", fbtraceId: null });
    assert.ok(msg.includes("Không gọi được"), `Got: ${msg}`);
  });

  await test("mapTokenErrorToVi: code #1 (other) → includes actionable hint", () => {
    const msg = mapTokenErrorToVi({ kind: "other", code: 1, subcode: null, type: null, message: "Invalid request", fbtraceId: null });
    assert.ok(msg.includes("#1"), `Got: ${msg}`);
    assert.ok(msg.includes("User Access Token") || msg.includes("user access token") || msg.includes("hạn chế"),
      `Expected actionable hint, got: ${msg}`);
  });

  // 3. verifyTokenWithoutAppCreds — mocked fetch
  await test("verify: valid token with pages_show_list → ok:true, missingRecommended has 2", async () => {
    globalThis.fetch = makeFetchMock([
      { status: 200, body: { id: "123", name: "Roland" } },
      { status: 200, body: { data: [{ permission: "pages_show_list", status: "granted" }] } },
    ]);
    const r = await verifyTokenWithoutAppCreds("FAKE_TOKEN");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.userId, "123");
    assert.equal(r.userName, "Roland");
    assert.deepEqual(r.missingRequired, []);
    assert.deepEqual(r.missingRecommended, ["pages_read_engagement", "pages_manage_metadata"]);
    assert.deepEqual(r.scopes, ["pages_show_list"]);
  });

  await test("verify: /me returns 400 expired → ok:false, step:'me', kind:'expired'", async () => {
    globalThis.fetch = makeFetchMock([
      { status: 400, body: { error: { code: 190, error_subcode: 463, message: "Session has expired" } } },
    ]);
    const r = await verifyTokenWithoutAppCreds("FAKE_TOKEN");
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.step, "me");
    assert.equal(r.error.kind, "expired");
  });

  await test("verify: /me ok, /permissions no granted scopes → ok:true, missingRequired=['pages_show_list']", async () => {
    globalThis.fetch = makeFetchMock([
      { status: 200, body: { id: "456", name: "Test User" } },
      { status: 200, body: { data: [{ permission: "pages_show_list", status: "declined" }] } },
    ]);
    const r = await verifyTokenWithoutAppCreds("FAKE_TOKEN");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.missingRequired, ["pages_show_list"]);
    assert.equal(r.permissionsCheckFailed, false);
  });

  await test("verify: /me ok, /permissions errors with code 1 → ok:true (soft fail), permissionsCheckFailed=true", async () => {
    globalThis.fetch = makeFetchMock([
      { status: 200, body: { id: "789", name: "Page Token User" } },
      { status: 400, body: { error: { code: 1, message: "Invalid request" } } },
    ]);
    const r = await verifyTokenWithoutAppCreds("FAKE_TOKEN");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.permissionsCheckFailed, true);
    assert.deepEqual(r.missingRequired, []);
    assert.deepEqual(r.missingRecommended, []);
    assert.equal(r.permissionsError?.code, 1);
  });

  // 4. fetchMeAccounts field fallback
  await test("fetchMeAccounts: full fields fail with code #1 → retries with safe fields and succeeds", async () => {
    const trace = makeFetchTrace([
      { status: 400, body: { error: { code: 1, message: "Invalid request" } } },
      { status: 200, body: { data: [{ id: "p1", name: "Page One", category: "Brand" }] } },
    ]);
    globalThis.fetch = trace.fetch;
    const pages = await fetchMeAccounts("FAKE_TOKEN");
    assert.equal(pages.length, 1);
    assert.equal(pages[0].id, "p1");
    assert.equal(trace.calls.length, 2);
    assert.ok(trace.calls[0].includes("new_like_count"), "first call should include full fields");
    assert.ok(!trace.calls[1].includes("new_like_count"), "second call should use safe fields");
    assert.ok(trace.calls[1].includes("access_token"), "safe set must keep access_token");
  });

  await test("fetchMeAccounts: non-#1 errors do NOT trigger fallback", async () => {
    const trace = makeFetchTrace([
      { status: 400, body: { error: { code: 190, error_subcode: 463, message: "expired" } } },
    ]);
    globalThis.fetch = trace.fetch;
    let threw = false;
    try {
      await fetchMeAccounts("FAKE_TOKEN");
    } catch {
      threw = true;
    }
    assert.equal(threw, true, "should rethrow on non-fallback errors");
    assert.equal(trace.calls.length, 1, "should not retry");
  });

  // 5. fetchPageEarnings
  await test("fetchPageEarnings: monetized page → status='monetized', sums micros correctly", async () => {
    globalThis.fetch = makeFetchMock([
      {
        status: 200,
        body: {
          data: [
            {
              name: "page_daily_video_ad_break_earnings",
              period: "day",
              values: [
                { value: 1.50, end_time: "2026-04-01T07:00:00+0000" },
                { value: 2.25, end_time: "2026-04-02T07:00:00+0000" },
                { value: 0.75, end_time: "2026-04-03T07:00:00+0000" },
              ],
            },
          ],
        },
      },
    ]);
    const r = await fetchPageEarnings("page-123", "FAKE_TOKEN", { days: 28 });
    assert.equal(r.status, "monetized");
    assert.equal(r.totalMicros, 4_500_000); // 1.50 + 2.25 + 0.75 = 4.50 USD
    assert.equal(r.currency, "USD");
    assert.equal(r.daily.length, 3);
  });

  await test("fetchPageEarnings: all-zero values → status='eligible'", async () => {
    globalThis.fetch = makeFetchMock([
      {
        status: 200,
        body: {
          data: [
            {
              name: "page_daily_video_ad_break_earnings",
              period: "day",
              values: [
                { value: 0, end_time: "2026-04-01T07:00:00+0000" },
                { value: 0, end_time: "2026-04-02T07:00:00+0000" },
              ],
            },
          ],
        },
      },
    ]);
    const r = await fetchPageEarnings("page-123", "FAKE_TOKEN", { days: 28 });
    assert.equal(r.status, "eligible");
    assert.equal(r.totalMicros, 0);
  });

  await test("fetchPageEarnings: empty data → status='eligible' (gracefully)", async () => {
    globalThis.fetch = makeFetchMock([
      { status: 200, body: { data: [] } },
    ]);
    const r = await fetchPageEarnings("page-123", "FAKE_TOKEN", { days: 28 });
    assert.equal(r.status, "eligible");
    assert.equal(r.totalMicros, 0);
  });

  await test("fetchPageEarnings: 400 not-monetized → status='not_monetized', captures error", async () => {
    globalThis.fetch = makeFetchMock([
      { status: 400, body: { error: { code: 100, message: "Object does not support this operation" } } },
    ]);
    const r = await fetchPageEarnings("page-123", "FAKE_TOKEN", { days: 28 });
    assert.equal(r.status, "not_monetized");
    assert.equal(r.totalMicros, 0);
    assert.ok(r.error && r.error.includes("Object does not support"));
  });

  await test("fetchPostVideoEarnings: video post with earnings → returns micros", async () => {
    globalThis.fetch = makeFetchMock([
      {
        status: 200,
        body: {
          data: [
            {
              name: "total_video_ad_break_earnings",
              values: [{ value: 12.34 }],
            },
          ],
        },
      },
    ]);
    const r = await fetchPostVideoEarnings("vid-123", "FAKE_TOKEN");
    assert.equal(r.available, true);
    assert.equal(r.totalMicros, 12_340_000);
  });

  await test("fetchPostVideoEarnings: non-video post → available:false", async () => {
    globalThis.fetch = makeFetchMock([
      { status: 400, body: { error: { code: 100, message: "Unsupported" } } },
    ]);
    const r = await fetchPostVideoEarnings("post-not-video", "FAKE_TOKEN");
    assert.equal(r.available, false);
    assert.equal(r.totalMicros, 0);
  });

  // 6. fetchPageEarningsBreakdown — multi-source aggregation
  // Note: as of Graph API v23 (May 2025), only `monetization_approximate_earnings`
  // is queryable. Tests fire ONE mocked fetch per call (not 3 like before).

  await test("breakdown v23: monetization_approximate_earnings returns data → status='monetized'", async () => {
    globalThis.fetch = makeFetchMock([
      {
        status: 200,
        body: {
          data: [{
            name: "monetization_approximate_earnings",
            values: [
              { value: 3.00, end_time: "2026-04-01T07:00:00+0000" },
              { value: 2.00, end_time: "2026-04-02T07:00:00+0000" },
            ],
          }],
        },
      },
    ]);
    const r = await fetchPageEarningsBreakdown("page-123", "FAKE_TOKEN", { days: 28 });
    assert.equal(r.status, "monetized");
    assert.equal(r.totalMicros, 5_000_000);
    const total = r.sources.find((s) => s.source === "total");
    assert.ok(total && total.available && total.micros === 5_000_000);
    // Sub-sources are intentionally not fetched on v23
    const reels = r.sources.find((s) => s.source === "reels_bonus");
    assert.ok(reels && !reels.available && reels.error == null);
  });

  await test("breakdown v23: metric returns zero → status='eligible'", async () => {
    globalThis.fetch = makeFetchMock([
      {
        status: 200,
        body: {
          data: [{
            name: "monetization_approximate_earnings",
            values: [{ value: 0, end_time: "2026-04-01T07:00:00+0000" }],
          }],
        },
      },
    ]);
    const r = await fetchPageEarningsBreakdown("page-123", "FAKE_TOKEN", { days: 28 });
    assert.equal(r.status, "eligible");
    assert.equal(r.totalMicros, 0);
  });

  await test("breakdown v23: code 100 (not onboarded) → status='not_monetized'", async () => {
    globalThis.fetch = makeFetchMock([
      { status: 400, body: { error: { code: 100, message: "Object does not support" } } },
    ]);
    const r = await fetchPageEarningsBreakdown("page-123", "FAKE_TOKEN", { days: 28 });
    assert.equal(r.status, "not_monetized");
    assert.equal(r.totalMicros, 0);
    assert.ok(r.error && r.error.includes("Object does not support"));
  });

  await test("breakdown v23: code 200 (permission denied) → status='missing_scope'", async () => {
    // FB returns code 200 with "User does not have sufficient administrative
    // permission..." for monetization_approximate_earnings when the token's user
    // isn't a verified admin. Real-world example from Sinistros BJJ probe.
    globalThis.fetch = makeFetchMock([
      { status: 403, body: { error: { code: 200, message: "User does not have sufficient administrative permission for this action on this page." } } },
    ]);
    const r = await fetchPageEarningsBreakdown("page-123", "FAKE_TOKEN", { days: 28 });
    assert.equal(r.status, "missing_scope");
    assert.ok(r.error && r.error.includes("permission"));
  });

  await test("breakdown v23: token expired (190/463) → status='missing_scope'", async () => {
    globalThis.fetch = makeFetchMock([
      { status: 401, body: { error: { code: 190, error_subcode: 463, message: "Session expired" } } },
    ]);
    const r = await fetchPageEarningsBreakdown("page-123", "FAKE_TOKEN", { days: 28 });
    assert.equal(r.status, "missing_scope");
  });

  // 7. Smoke check
  await test("smoke: all new exports are callable functions", () => {
    assert.equal(typeof parseGraphError, "function");
    assert.equal(typeof mapTokenErrorToVi, "function");
    assert.equal(typeof verifyTokenWithoutAppCreds, "function");
    assert.equal(typeof fetchMeAccounts, "function");
    assert.equal(typeof fetchPageEarnings, "function");
    assert.equal(typeof fetchPostVideoEarnings, "function");
    assert.equal(typeof fetchPageEarningsBreakdown, "function");
  });

  // summary
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n${passed}/${total} tests passed${passed < total ? ` — ${total - passed} FAILED` : ""}`);
  if (passed < total) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
