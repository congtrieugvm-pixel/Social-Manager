// Persisted Insight results (table insight_snapshots) — what the Insight
// screen shows on load without calling Graph.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { insightSnapshots } from "@/lib/db/schema";

export type SnapshotKind = "reach" | "monet" | "pages" | "posts";

// D1 caps bound parameters at 100 per statement: 5 per row → 18 rows/insert.
const ROWS_PER_INSERT = 18;

export async function saveSnapshots(
  ownerId: number,
  kind: SnapshotKind,
  entries: Array<{ key: string; data: unknown }>,
): Promise<void> {
  if (entries.length === 0) return;
  const fetchedAt = Math.floor(Date.now() / 1000);
  for (let i = 0; i < entries.length; i += ROWS_PER_INSERT) {
    await db
      .insert(insightSnapshots)
      .values(
        entries.slice(i, i + ROWS_PER_INSERT).map((e) => ({
          ownerUserId: ownerId,
          kind,
          key: e.key,
          data: JSON.stringify(e.data),
          fetchedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [insightSnapshots.ownerUserId, insightSnapshots.kind, insightSnapshots.key],
        set: { data: sql`excluded.data`, fetchedAt: sql`excluded.fetched_at` },
      });
  }
}

export async function loadSnapshots(
  ownerId: number,
  kind: SnapshotKind,
): Promise<Record<string, { data: unknown; fetchedAt: number }>> {
  const rows = await db
    .select({ key: insightSnapshots.key, data: insightSnapshots.data, fetchedAt: insightSnapshots.fetchedAt })
    .from(insightSnapshots)
    .where(and(eq(insightSnapshots.ownerUserId, ownerId), eq(insightSnapshots.kind, kind)));
  const out: Record<string, { data: unknown; fetchedAt: number }> = {};
  for (const r of rows) {
    try {
      out[r.key] = { data: JSON.parse(r.data), fetchedAt: r.fetchedAt };
    } catch {
      // skip a corrupt row
    }
  }
  return out;
}

export async function deleteSnapshot(ownerId: number, kind: SnapshotKind, key: string): Promise<void> {
  await db
    .delete(insightSnapshots)
    .where(and(eq(insightSnapshots.ownerUserId, ownerId), eq(insightSnapshots.kind, kind), eq(insightSnapshots.key, key)));
}
