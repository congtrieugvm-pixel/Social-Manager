import type { GraphMessage } from "@/lib/ms-graph";

export interface OtpMatch {
  code: string;
  messageId: string;
  subject: string;
  fromAddress: string | null;
  receivedAt: string;
  snippet: string;
}

// Strip HTML tags and decode the most common entities so a 6-digit OTP can be found
// inside the body preview even when Microsoft Graph returns HTML content.
function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCandidates(text: string): string[] {
  if (!text) return [];
  const cleaned = stripHtml(text);
  // Match exactly 6 digits not surrounded by other digits (avoids year spans / IDs).
  const matches = cleaned.match(/(?<!\d)\d{6}(?!\d)/g);
  return matches ?? [];
}

const SENDER_HINTS = ["tiktok", "bytedance", "accounts"];

function senderLooksRelevant(msg: GraphMessage): boolean {
  const addr = msg.from?.emailAddress?.address?.toLowerCase() ?? "";
  const name = msg.from?.emailAddress?.name?.toLowerCase() ?? "";
  return SENDER_HINTS.some((h) => addr.includes(h) || name.includes(h));
}

/**
 * Pick the freshest 6-digit OTP from the given messages.
 * Preference order:
 *   1. Most recent message from a TikTok-ish sender with a 6-digit code
 *   2. Most recent message overall with a 6-digit code
 * Messages older than 15 minutes are ignored to avoid returning stale codes.
 */
export function pickLatestOtp(
  messages: GraphMessage[],
  maxAgeMs = 15 * 60 * 1000,
): OtpMatch | null {
  const now = Date.now();
  const ordered = [...messages].sort(
    (a, b) =>
      new Date(b.receivedDateTime).getTime() -
      new Date(a.receivedDateTime).getTime(),
  );

  const scan = (relevantOnly: boolean): OtpMatch | null => {
    for (const msg of ordered) {
      const received = new Date(msg.receivedDateTime).getTime();
      if (!Number.isFinite(received)) continue;
      if (now - received > maxAgeMs) continue;
      if (relevantOnly && !senderLooksRelevant(msg)) continue;

      const haystack = [
        msg.subject ?? "",
        msg.bodyPreview ?? "",
        msg.body?.content ?? "",
      ].join(" \n ");
      const candidates = extractCandidates(haystack);
      if (candidates.length === 0) continue;
      // Prefer first candidate (usually appears earliest in the email body / subject).
      return {
        code: candidates[0],
        messageId: msg.id,
        subject: msg.subject ?? "",
        fromAddress: msg.from?.emailAddress?.address ?? null,
        receivedAt: msg.receivedDateTime,
        snippet: stripHtml(msg.bodyPreview ?? "").slice(0, 160),
      };
    }
    return null;
  };

  return scan(true) ?? scan(false);
}
