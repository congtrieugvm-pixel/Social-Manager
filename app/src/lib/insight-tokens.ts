// Tokens pasted into the Insight screen (table insight_tokens). Stored
// encrypted; the raw token never leaves the server — the client only sees
// id / label / name / preview.

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { insightTokens } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { graphFetch, mapTokenErrorToVi, parseGraphError, previewToken } from "@/lib/facebook";
import type { ReachCandidate } from "@/lib/page-reach";

export interface SafeInsightToken {
  id: number;
  label: string;
  kind: "user" | "page";
  fbId: string | null;
  fbName: string | null;
  preview: string | null;
  lastError: string | null;
}

// D1 caps bound parameters at 100 per statement.
const IN_CHUNK = 90;

type Row = typeof insightTokens.$inferSelect;

function labelOf(r: Pick<Row, "label" | "fbName" | "id">): string {
  return r.label?.trim() || r.fbName?.trim() || `Token #${r.id}`;
}

function toSafe(r: Row): SafeInsightToken {
  return {
    id: r.id,
    label: labelOf(r),
    kind: r.kind === "page" ? "page" : "user",
    fbId: r.fbId,
    fbName: r.fbName,
    preview: r.tokenPreview,
    lastError: r.lastError,
  };
}

export async function listTokens(ownerId: number): Promise<SafeInsightToken[]> {
  const rows = await db
    .select()
    .from(insightTokens)
    .where(eq(insightTokens.ownerUserId, ownerId))
    .orderBy(desc(insightTokens.id));
  return rows.map(toSafe);
}

/**
 * Decrypted candidates for the given token ids — only the owner's own tokens,
 * so a client can't borrow another user's token by sending its id.
 */
export async function loadCandidates(ownerId: number, ids: number[]): Promise<ReachCandidate[]> {
  const unique = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0);
  const out: ReachCandidate[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const rows = await db
      .select()
      .from(insightTokens)
      .where(
        and(
          eq(insightTokens.ownerUserId, ownerId),
          inArray(insightTokens.id, unique.slice(i, i + IN_CHUNK)),
        ),
      );
    for (const r of rows) {
      const token = await decrypt(r.encToken);
      if (token) {
        out.push({
          tokenId: r.id,
          label: labelOf(r),
          kind: r.kind === "page" ? "page" : "user",
          fbId: r.fbId,
          token,
        });
      }
    }
  }
  // Keep the caller's order (stable rotation across requests).
  out.sort((a, b) => unique.indexOf(a.tokenId) - unique.indexOf(b.tokenId));
  return out;
}

export class TokenInputError extends Error {}

/**
 * Validate a pasted token against Graph and save it (encrypted). The same
 * Facebook user/page pasted again replaces the old token instead of adding a
 * duplicate. Returns the saved token and an optional warning.
 */
export async function saveToken(
  ownerId: number,
  rawToken: string,
  label: string | null,
): Promise<{ token: SafeInsightToken; warning: string | null; replaced: boolean }> {
  const token = rawToken.trim().replace(/^Bearer\s+/i, "");
  if (!/^[A-Za-z0-9_-]{30,}$/.test(token)) {
    throw new TokenInputError("Token không đúng định dạng (thường bắt đầu bằng EAA…)");
  }

  let me: { id: string; name: string };
  try {
    me = await graphFetch(`/me?fields=id,name`, token);
  } catch (e) {
    throw new TokenInputError(mapTokenErrorToVi(parseGraphError(e)));
  }
  // Only Page nodes have `category`; on a user token Graph answers #100
  // "nonexisting field" (verified live, 2026-10).
  let kind: "user" | "page" = "user";
  try {
    const probe = await graphFetch<{ category?: string }>(`/me?fields=category`, token);
    if (probe.category !== undefined) kind = "page";
  } catch {
    kind = "user";
  }

  let warning: string | null = null;
  if (kind === "user") {
    try {
      const perms = await graphFetch<{ data: Array<{ permission: string; status: string }> }>(
        `/me/permissions`,
        token,
      );
      const granted = new Set(perms.data.filter((p) => p.status === "granted").map((p) => p.permission));
      const missing = ["read_insights", "pages_show_list"].filter((p) => !granted.has(p));
      if (missing.length) {
        warning = `Token thiếu quyền ${missing.join(", ")} — có thể không đọc được Reach.`;
      }
    } catch {
      // permissions edge unavailable — not fatal
    }
  }

  const values = {
    ownerUserId: ownerId,
    label: label?.trim() || null,
    kind,
    encToken: (await encrypt(token)) as string,
    fbId: me.id,
    fbName: me.name,
    tokenPreview: previewToken(token),
    lastError: null,
  };

  const [existing] = await db
    .select({ id: insightTokens.id, label: insightTokens.label })
    .from(insightTokens)
    .where(and(eq(insightTokens.ownerUserId, ownerId), eq(insightTokens.fbId, me.id)));
  if (existing) {
    const [row] = await db
      .update(insightTokens)
      .set({ ...values, label: values.label ?? existing.label })
      .where(eq(insightTokens.id, existing.id))
      .returning();
    return { token: toSafe(row), warning, replaced: true };
  }
  const [row] = await db.insert(insightTokens).values(values).returning();
  return { token: toSafe(row), warning, replaced: false };
}

export async function setTokenError(tokenId: number, message: string | null) {
  await db.update(insightTokens).set({ lastError: message }).where(eq(insightTokens.id, tokenId));
}
