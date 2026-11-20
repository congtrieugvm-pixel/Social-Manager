// Pull a verification code out of an email. Works for a TikTok login code and for a
// Microsoft security code (the challenge during the Hotmail OAuth login).

export interface Mail { from?: string; subject?: string; text?: string; html?: string; body?: string; date?: string; receivedAt?: string; created_at?: string }

const stripHtml = (s: string) => s.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&');
const content = (m: Mail) => `${m.subject ?? ''}\n${stripHtml(m.text || m.body || m.html || '')}`.replace(/ /g, ' ');
const when = (m: Mail) => Date.parse(m.date || m.receivedAt || m.created_at || '') || 0;

const SENDER = {
  tiktok: /tiktok|bytedance|@account|@register|@notify/i,
  microsoft: /microsoft|outlook|accountprotection|account-security/i,
};
// A code near a cue word beats a random number elsewhere in the mail.
const CUE = /(?:code|c[oô]de|verification|verify|security|m[aã]\s*(?:x[aá]c|b[aả]o)|x[aá]c\s*minh|x[aá]c\s*nh[aậ]n|OTP)[^0-9]{0,40}(\d{4,8})/i;

/** Best code in one mail, or null. `digits` constrains the length (TikTok = 6). */
export function codeInMail(mail: Mail, digits = 6): string | null {
  const text = content(mail);
  const near = text.match(CUE)?.[1];
  if (near && near.length === digits) return near;
  const runs = text.match(new RegExp(`(?<!\\d)\\d{${digits}}(?!\\d)`, 'g')) ?? [];
  // Avoid years / obvious non-codes when we can.
  return runs.find(c => !/^(19|20)\d{2}$/.test(c)) ?? runs[0] ?? (near ?? null);
}

/** Newest matching code across an inbox, after `since` (ms). */
export function latestCode(mails: Mail[], opts: { sender?: keyof typeof SENDER; digits?: number; since?: number } = {}): string | null {
  const digits = opts.digits ?? 6;
  const filter = opts.sender ? SENDER[opts.sender] : null;
  const candidates = mails
    .filter(m => when(m) >= (opts.since ?? 0))
    .filter(m => !filter || filter.test(`${m.from ?? ''} ${m.subject ?? ''}`))
    .sort((a, b) => when(b) - when(a));
  for (const m of candidates) { const code = codeInMail(m, digits); if (code) return code; }
  return null;
}
