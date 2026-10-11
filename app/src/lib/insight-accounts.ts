import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { facebookAccounts } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import type { ReachCandidate } from "@/lib/page-reach";

export interface InsightAccount {
  id: number;
  label: string;
  groupId: number | null;
}

// D1 caps bound parameters at 100 per statement.
const IN_CHUNK = 90;

function labelOf(r: { fbName: string | null; username: string }) {
  return r.fbName?.trim() || r.username;
}

/** The owner's Facebook accounts that have an access token stored. */
export async function listInsightAccounts(ownerId: number): Promise<InsightAccount[]> {
  const rows = await db
    .select({
      id: facebookAccounts.id,
      username: facebookAccounts.username,
      fbName: facebookAccounts.fbName,
      groupId: facebookAccounts.groupId,
    })
    .from(facebookAccounts)
    .where(
      and(
        eq(facebookAccounts.ownerUserId, ownerId),
        isNotNull(facebookAccounts.encAccessToken),
      ),
    );
  return rows.map((r) => ({ id: r.id, label: labelOf(r), groupId: r.groupId }));
}

/**
 * Decrypted token candidates for the given account ids — only accounts that
 * belong to `ownerId` and have a token, so a client can't borrow other
 * users' tokens by sending their ids.
 */
export async function loadCandidates(
  ownerId: number,
  ids: number[],
): Promise<ReachCandidate[]> {
  const out: ReachCandidate[] = [];
  const unique = [...new Set(ids)].filter((n) => Number.isInteger(n) && n > 0);
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const rows = await db
      .select({
        id: facebookAccounts.id,
        username: facebookAccounts.username,
        fbName: facebookAccounts.fbName,
        encAccessToken: facebookAccounts.encAccessToken,
      })
      .from(facebookAccounts)
      .where(
        and(
          eq(facebookAccounts.ownerUserId, ownerId),
          inArray(facebookAccounts.id, unique.slice(i, i + IN_CHUNK)),
        ),
      );
    for (const r of rows) {
      const token = r.encAccessToken ? await decrypt(r.encAccessToken) : null;
      if (token) out.push({ accountId: r.id, label: labelOf(r), userToken: token });
    }
  }
  // Keep the caller's order (stable rotation across requests).
  out.sort((a, b) => unique.indexOf(a.accountId) - unique.indexOf(b.accountId));
  return out;
}
