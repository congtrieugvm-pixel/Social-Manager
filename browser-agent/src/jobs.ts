/** Jobs that open the account's window themselves: `open`, and Ẩn bài / Lướt feed / Đăng bài when no
 *  window of that account is open already (`reuse` false). The agent must allow such a job's profile
 *  as soon as it claims it — the allowed list from the last sync predates the claim, and a job whose
 *  profile is "not allowed" stops at its first check (INTERRUPTED). */
export const opensOwnWindow = (job: { kind: string; reuse?: boolean }) =>
  job.kind === 'open' || (['hide', 'feed', 'post'].includes(job.kind) && !job.reuse);
