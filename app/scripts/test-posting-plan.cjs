const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const file = path.resolve(__dirname, '../src/lib/posting-plan.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, mod, mod.exports);
const { buildPlan, perDayCounts, localMidnightEpoch, PlanError } = mod.exports;

// Deterministic RNG (mulberry32) so times are reproducible in tests.
const seeded = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const files = n => Array.from({ length: n }, (_, i) => ({ key: i.toString(16).padStart(64, '0'), name: `v${String(i).padStart(3, '0')}.mp4`, size: 1000 + i }));
let passed = 0;
const test = (name, fn) => { try { fn(); console.log('PASS', name); passed++; } catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1; } };
const caught = fn => { try { fn(); } catch (e) { return e; } throw new Error('expected a throw'); };

const MID = localMidnightEpoch(2026, 11, 21); // 00:00 VN on 2026-11-21

test('perDayCounts spreads evenly, earlier days take the remainder', () => {
  assert.deepEqual(perDayCounts(3, 3), [1, 1, 1]);
  assert.deepEqual(perDayCounts(5, 2), [3, 2]);
  assert.deepEqual(perDayCounts(6, 3), [2, 2, 2]);
  assert.deepEqual(perDayCounts(7, 3), [3, 2, 2]);
});

test('round-robin split: each account gets N videos, none shared, each used once', () => {
  const { items } = buildPlan({ files: files(30), accountIds: [10, 20, 30], postsPerAccount: 10, days: 5, windowStartMin: 540, windowEndMin: 1260, startDayEpoch: MID, random: seeded(1) });
  assert.equal(items.length, 30);
  const byAcc = new Map();
  for (const it of items) byAcc.set(it.accountId, [...(byAcc.get(it.accountId) ?? []), it.fileKey]);
  assert.deepEqual([...byAcc.keys()].sort((a, b) => a - b), [10, 20, 30]);
  for (const list of byAcc.values()) assert.equal(list.length, 10);
  assert.equal(new Set(items.map(i => i.fileKey)).size, 30, 'no video used twice');
  // account index 0 gets files 0,3,6,…; account 1 gets 1,4,7,…
  assert.deepEqual(byAcc.get(10).slice(0, 3), [files(3)[0].key, files(9)[3].key, files(9)[6].key]);
});

test('not enough videos is rejected with the counts', () => {
  const e = caught(() => buildPlan({ files: files(5), accountIds: [1, 2, 3], postsPerAccount: 2, days: 1, windowStartMin: 540, windowEndMin: 1260, startDayEpoch: MID }));
  assert.equal(e.code, 'NOT_ENOUGH_VIDEOS');
  assert.match(e.message, /Cần 6 video/);
});

test('window too small for the per-day count is rejected', () => {
  // 3 posts/day need ≥2h span; a 10:00–11:30 window (90 min) is too small.
  const e = caught(() => buildPlan({ files: files(3), accountIds: [1], postsPerAccount: 3, days: 1, windowStartMin: 600, windowEndMin: 690, startDayEpoch: MID }));
  assert.equal(e.code, 'WINDOW_TOO_SMALL');
});

test('times stay inside the window, ≥60 min apart per account per day, and in the right day', () => {
  const start = 540, end = 1260, gap = 60;
  const { items } = buildPlan({ files: files(40), accountIds: [1, 2, 3, 4], postsPerAccount: 10, days: 5, windowStartMin: start, windowEndMin: end, startDayEpoch: MID, random: seeded(42) });
  const groups = new Map();
  for (const it of items) {
    const min = (it.scheduledAt - MID - it.day * 86400) / 60;
    assert.ok(min >= start && min <= end, `time ${min} within window`);
    assert.ok(it.day >= 0 && it.day < 5);
    const k = `${it.accountId}:${it.day}`;
    groups.set(k, [...(groups.get(k) ?? []), min]);
  }
  for (const mins of groups.values()) {
    const sorted = [...mins].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= gap, `gap ${sorted[i] - sorted[i - 1]} ≥ 60`);
  }
});

test('Vietnam midnight epoch is UTC-7 of that date', () => {
  // 2026-11-21 00:00 +07:00 == 2026-11-20 17:00 UTC
  assert.equal(MID, Math.floor(Date.UTC(2026, 10, 20, 17, 0, 0) / 1000));
});

test('deterministic for a fixed seed', () => {
  const args = { files: files(12), accountIds: [1, 2], postsPerAccount: 6, days: 3, windowStartMin: 480, windowEndMin: 1320, startDayEpoch: MID };
  const a = buildPlan({ ...args, random: seeded(7) }).items.map(i => i.scheduledAt);
  const b = buildPlan({ ...args, random: seeded(7) }).items.map(i => i.scheduledAt);
  assert.deepEqual(a, b);
});

console.log(`\n${passed} passed`);
