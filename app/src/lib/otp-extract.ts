import type { GraphMessage } from "@/lib/ms-graph";

export const OTP_MAX_AGE_MS = 5 * 60 * 1000;
export interface OtpMatch {
  code: string; messageId: string; subject: string;
  fromAddress: string | null; receivedAt: string; snippet: string;
}

function stripHtml(input: string): string {
  return input.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&#(x[\da-f]+|\d+);/gi, (_, value: string) => {
      const n = value[0].toLowerCase() === "x" ? parseInt(value.slice(1), 16) : Number(value);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    }).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}

function isTikTokSender(message: GraphMessage): boolean {
  const address = message.from?.emailAddress?.address?.trim().toLowerCase() ?? "";
  const domain = address.split("@");
  return domain.length === 2 && ["tiktok.com", "tiktokv.com", "bytedance.com"].some(
    root => domain[1] === root || domain[1].endsWith(`.${root}`),
  );
}

function contextualCodes(text: string): string[] {
  const label = "(?:verification\\s+code|security\\s+code|one[- ]time\\s+(?:code|password)|login\\s+code|mã(?:\\s+(?:xác minh|xác nhận|bảo mật|đăng nhập))|验证码|認証コード)";
  const before = new RegExp(`${label}[^\\d]{0,35}(?<!\\d)(\\d{6})(?!\\d)`, "giu");
  const after = new RegExp(`(?<!\\d)(\\d{6})(?!\\d)\\s+(?:is your|is the|l\u00e0)\\s*${label}`, "giu");
  return [...text.matchAll(before), ...text.matchAll(after)].map(match => match[1]);
}

export function pickLatestOtp(messages: GraphMessage[], options: {
  now?: number; maxAgeMs?: number; afterMessageId?: string; afterReceivedAt?: number;
} = {}): OtpMatch | null {
  const now = options.now ?? Date.now();
  const ordered = [...messages].sort((a, b) => Date.parse(b.receivedDateTime) - Date.parse(a.receivedDateTime));
  for (const msg of ordered) {
    const received = Date.parse(msg.receivedDateTime);
    if (!Number.isFinite(received) || received > now + 30_000 ||
      now - received > (options.maxAgeMs ?? OTP_MAX_AGE_MS) ||
      msg.id === options.afterMessageId ||
      (options.afterReceivedAt !== undefined && received < options.afterReceivedAt) || !isTikTokSender(msg)) continue;
    const text = stripHtml([msg.subject, msg.bodyPreview, msg.body?.content].filter(Boolean).join(" \n "));
    const codes = [...new Set(contextualCodes(text))];
    // Ambiguous messages must not auto-copy an arbitrary number.
    if (codes.length !== 1) continue;
    return { code: codes[0], messageId: msg.id, subject: msg.subject ?? "",
      fromAddress: msg.from?.emailAddress?.address ?? null, receivedAt: msg.receivedDateTime,
      snippet: stripHtml(msg.bodyPreview ?? "").slice(0, 160) };
  }
  return null;
}
