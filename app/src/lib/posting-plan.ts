// Pure planner for scheduled bulk posting: split a folder's videos round-robin across accounts,
// then pick random TikTok-schedule times inside a daily window, ≥ minGap apart. No I/O, no browser —
// fully testable. Times are produced as epoch seconds; the caller supplies day 0's midnight epoch
// (so the timezone, Vietnam UTC+7, is decided once by the caller).

export interface PlanFile { key: string; name: string; size: number }
export interface PlanItem { accountId: number; fileKey: string; fileName: string; scheduledAt: number; day: number }
export interface PlanInput {
  files: PlanFile[];
  accountIds: number[];
  postsPerAccount: number;
  days: number;
  windowStartMin: number;   // minutes from local midnight, e.g. 9:00 = 540
  windowEndMin: number;     // e.g. 21:00 = 1260
  startDayEpoch: number;    // epoch seconds of 00:00 (local) of the first scheduling day
  minGapMin?: number;       // default 60
  random?: () => number;    // default Math.random (injectable for tests)
}
export class PlanError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** Spread `total` posts across `days` as evenly as possible; earlier days take the remainder. */
export function perDayCounts(total: number, days: number): number[] {
  const base = Math.floor(total / days), rem = total % days;
  return Array.from({ length: days }, (_, d) => base + (d < rem ? 1 : 0));
}

/** k sorted minute marks inside [start,end], each ≥ gap apart, chosen at random. */
function dayTimes(k: number, start: number, end: number, gap: number, rnd: () => number): number[] {
  if (k <= 0) return [];
  const slack = (end - start) - (k - 1) * gap;
  if (slack < 0) throw new PlanError('WINDOW_TOO_SMALL', 'Khung giờ quá hẹp cho số bài mỗi ngày (cần cách nhau 1 tiếng).');
  // Pick k random offsets in [0,slack], sort, then fan out by the gap so marks never collide.
  const offsets = Array.from({ length: k }, () => rnd() * slack).sort((a, b) => a - b);
  return offsets.map((o, i) => Math.round(start + o + i * gap));
}

export function buildPlan(input: PlanInput): { items: PlanItem[]; perAccount: number; totalPosts: number } {
  const { files, accountIds, postsPerAccount: n, days, windowStartMin: s, windowEndMin: e, startDayEpoch, minGapMin = 60 } = input;
  const rnd = input.random ?? Math.random;
  if (!accountIds.length) throw new PlanError('NO_ACCOUNTS', 'Chưa chọn tài khoản.');
  if (!Number.isInteger(n) || n < 1) throw new PlanError('BAD_POSTS', 'Số bài mỗi tài khoản phải ≥ 1.');
  if (!Number.isInteger(days) || days < 1) throw new PlanError('BAD_DAYS', 'Số ngày phải ≥ 1.');
  if (!(s >= 0 && e <= 1440 && s < e)) throw new PlanError('BAD_WINDOW', 'Khung giờ không hợp lệ.');
  const need = accountIds.length * n;
  if (files.length < need) throw new PlanError('NOT_ENOUGH_VIDEOS', `Cần ${need} video (mỗi tài khoản ${n}), thư mục chỉ có ${files.length}.`);
  const counts = perDayCounts(n, days);
  if (Math.max(...counts) - 1 > 0 && (Math.max(...counts) - 1) * minGapMin > e - s) {
    throw new PlanError('WINDOW_TOO_SMALL', `Khung giờ ${fmt(s)}–${fmt(e)} không đủ cho ${Math.max(...counts)} bài/ngày cách nhau 1 tiếng.`);
  }
  const items: PlanItem[] = [];
  accountIds.forEach((accountId, a) => {
    // Round-robin deal: account a gets files a, a+A, a+2A, … (each video belongs to exactly one account).
    const mine = Array.from({ length: n }, (_, i) => files[a + i * accountIds.length]);
    let taken = 0;
    counts.forEach((k, day) => {
      const times = dayTimes(k, s, e, minGapMin, rnd);
      for (let j = 0; j < k; j++) {
        const file = mine[taken++];
        items.push({ accountId, fileKey: file.key, fileName: file.name, day, scheduledAt: startDayEpoch + day * 86400 + times[j] * 60 });
      }
    });
  });
  return { items, perAccount: n, totalPosts: items.length };
}

const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Epoch seconds of 00:00 on a given local day, for a fixed UTC offset (Vietnam = +7h). */
export function localMidnightEpoch(year: number, month1: number, day: number, utcOffsetHours = 7): number {
  return Math.floor(Date.UTC(year, month1 - 1, day) / 1000) - utcOffsetHours * 3600;
}
