import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fbCommentLog, fbCommentRules } from "@/lib/db/schema";
import { getOwnerId } from "@/lib/scope";
import { readBody } from "@/lib/req-body";
import { cleanRule, parseComments, recentLog, type RuleInput } from "@/lib/autocomment";
import { errorResponse } from "../_util";

// GET → { rules: [{ …, comments: string[], stats: { ok, error, last } }], log: [...] }
export async function GET() {
  try {
    const ownerId = await getOwnerId();
    const [rules, stats, log] = await Promise.all([
      db.select().from(fbCommentRules).where(eq(fbCommentRules.ownerUserId, ownerId)).orderBy(desc(fbCommentRules.id)),
      db
        .select({
          ruleId: fbCommentLog.ruleId,
          ok: sql<number>`SUM(CASE WHEN ${fbCommentLog.status} = 'ok' THEN 1 ELSE 0 END)`,
          error: sql<number>`SUM(CASE WHEN ${fbCommentLog.status} = 'error' THEN 1 ELSE 0 END)`,
          last: sql<number>`MAX(${fbCommentLog.createdAt})`,
        })
        .from(fbCommentLog)
        .where(eq(fbCommentLog.ownerUserId, ownerId))
        .groupBy(fbCommentLog.ruleId),
      recentLog(ownerId, 100),
    ]);
    const byRule = new Map(stats.map((s) => [s.ruleId, s]));
    return NextResponse.json(
      {
        rules: rules.map((r) => ({
          id: r.id,
          targetType: r.targetType,
          targetId: r.targetId,
          comments: parseComments(r.comments),
          enabled: r.enabled,
          activeSince: r.activeSince,
          lastRunAt: r.lastRunAt,
          stats: { ok: Number(byRule.get(r.id)?.ok ?? 0), error: Number(byRule.get(r.id)?.error ?? 0), last: byRule.get(r.id)?.last ?? null },
        })),
        log,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

// POST { targetType, targetId, comments: string[], enabled? } → { id }
// Only posts created from now on get comments.
export async function POST(req: Request) {
  try {
    const ownerId = await getOwnerId();
    const r = await cleanRule(ownerId, await readBody<RuleInput>(req));
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    const v = r.value as Required<typeof r.value>;
    const [row] = await db
      .insert(fbCommentRules)
      .values({
        ownerUserId: ownerId,
        targetType: v.targetType,
        targetId: v.targetId,
        comments: v.comments,
        enabled: r.value.enabled ?? true,
        activeSince: Math.floor(Date.now() / 1000),
      })
      .returning({ id: fbCommentRules.id });
    return NextResponse.json({ id: row.id });
  } catch (e) {
    return errorResponse(e);
  }
}
