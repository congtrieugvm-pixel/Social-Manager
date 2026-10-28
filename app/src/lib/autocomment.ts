// Insight "Comment tự động": comment as the Page, with one of the prepared
// texts (random), on every post published after the rule was turned on.
//
// Run every 5 minutes by the cron Worker (workers/cron → /api/cron/autocomment)
// and on demand ("Chạy ngay"). One run, per owner:
//   rules → target pages (a page rule wins over a group rule)
//   → new posts of up to 50 pages in ONE Graph Batch call (published_posts since …)
//   → skip posts already in fb_comment_log
//   → POST /{post-id}/comments with the page token (withPageToken: rotation,
//     cooling, next token on permission errors)
// Bounded so one Worker invocation stays under the Free plan's 50 subrequests.

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { fbCommentLog, fbCommentRules, insightPageAssignments, insightPageGroups } from "@/lib/db/schema";
import { graphPost, parseGraphError } from "@/lib/facebook";
import { loadCandidates } from "@/lib/insight-tokens";
import { loadSnapshots } from "@/lib/insight-snapshots";
import { CoolingError, fetchPageBatch, withPageToken, type ReachCandidate } from "@/lib/page-reach";

/** Comments posted per run (each is one subrequest). */
export const MAX_COMMENTS_PER_RUN = 15;
/** Pages read per owner per run. One Graph Batch holds 50, but pages without a
 * cached page token fall back to one request each — 30 keeps a run safe. */
const MAX_PAGES_PER_RUN = 30;
/** Never look further back than this (cron down for a while → no backlog flood). */
const LOOKBACK_S = 24 * 3600;
const IN_CHUNK = 90;

export interface RunSummary {
  owners: number;
  pagesChecked: number;
  newPosts: number;
  commented: number;
  failed: number;
  skipped: number; // left for the next run (budget / transient error)
  errors: string[];
}

interface PostRow {
  id: string;
  created_time: string;
  message?: string;
}

export function parseComments(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
  } catch {
    return [];
  }
}

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

/** Retryable = try again next run instead of recording a failure. */
function isTransient(e: unknown): boolean {
  if (e instanceof CoolingError) return true;
  const code = parseGraphError(e).code;
  if (code === 1 || code === 2 || code === 4 || code === 17 || code === 32 || code === 613) return true;
  return code === null && !(e as { graph?: unknown })?.graph; // network error
}

function viError(e: unknown): string {
  const info = parseGraphError(e);
  const perm = info.code === 10 || info.code === 200 || (info.code !== null && info.code >= 200 && info.code < 300);
  if (perm) return `Token thiếu quyền comment (cần pages_manage_engagement): ${info.message}`;
  if (info.code === 368) return `Facebook tạm chặn comment (chống spam): ${info.message}`;
  return `Lỗi Graph${info.code ? ` #${info.code}` : ""}: ${info.message}`;
}

/** Page id → token ids that can read it, from the saved token page lists. */
async function pageTokenMap(ownerId: number): Promise<Map<string, number[]>> {
  const snaps = await loadSnapshots(ownerId, "pages");
  const map = new Map<string, number[]>();
  for (const [key, v] of Object.entries(snaps)) {
    const tokenId = Number(key.replace(/^t:/, ""));
    if (!Number.isInteger(tokenId)) continue;
    for (const p of (v.data as Array<{ id?: string }>) ?? []) {
      if (!p?.id) continue;
      const list = map.get(p.id) ?? [];
      list.push(tokenId);
      map.set(p.id, list);
    }
  }
  return map;
}

export async function runAutoComment(opts: { ownerId?: number; maxComments?: number } = {}): Promise<RunSummary> {
  const sum: RunSummary = { owners: 0, pagesChecked: 0, newPosts: 0, commented: 0, failed: 0, skipped: 0, errors: [] };
  let budget = opts.maxComments ?? MAX_COMMENTS_PER_RUN;
  const rules = await db
    .select()
    .from(fbCommentRules)
    .where(opts.ownerId ? and(eq(fbCommentRules.enabled, true), eq(fbCommentRules.ownerUserId, opts.ownerId)) : eq(fbCommentRules.enabled, true));
  const byOwner = new Map<number, typeof rules>();
  for (const r of rules) byOwner.set(r.ownerUserId, [...(byOwner.get(r.ownerUserId) ?? []), r]);

  const nowS = Math.floor(Date.now() / 1000);
  for (const [ownerId, ownerRules] of byOwner) {
    if (budget <= 0) break;
    sum.owners++;
    try {
      // Target pages → the rule that applies (page rule first, then oldest group rule).
      const groupIds = ownerRules.filter((r) => r.targetType === "group").map((r) => Number(r.targetId));
      const assigns = groupIds.length
        ? await db
            .select()
            .from(insightPageAssignments)
            .where(and(eq(insightPageAssignments.ownerUserId, ownerId), inArray(insightPageAssignments.groupId, groupIds.slice(0, IN_CHUNK))))
        : [];
      const ruleOf = new Map<string, (typeof ownerRules)[number]>();
      for (const r of [...ownerRules].sort((a, b) => a.id - b.id)) {
        if (r.targetType === "page" && !ruleOf.has(r.targetId)) ruleOf.set(r.targetId, r);
      }
      for (const r of [...ownerRules].sort((a, b) => a.id - b.id)) {
        if (r.targetType !== "group") continue;
        for (const a of assigns) if (String(a.groupId) === r.targetId && !ruleOf.has(a.pageId)) ruleOf.set(a.pageId, r);
      }
      let pageIds = [...ruleOf.keys()].filter((p) => parseComments(ruleOf.get(p)!.comments).length > 0);
      // More pages than one batch holds: rotate so each gets checked in turn.
      if (pageIds.length > MAX_PAGES_PER_RUN) {
        const start = (Math.floor(nowS / 300) * MAX_PAGES_PER_RUN) % pageIds.length;
        pageIds = [...pageIds.slice(start), ...pageIds.slice(0, start)].slice(0, MAX_PAGES_PER_RUN);
      }
      if (pageIds.length === 0) continue;

      const tokensOf = await pageTokenMap(ownerId);
      const candidates = await loadCandidates(ownerId, [...new Set(pageIds.flatMap((p) => tokensOf.get(p) ?? []))]);
      const byToken = new Map(candidates.map((c) => [c.tokenId, c]));
      const candOf = (pageId: string): ReachCandidate[] =>
        (tokensOf.get(pageId) ?? []).map((t) => byToken.get(t)).filter((c): c is ReachCandidate => !!c);

      const sinceOf = (pageId: string) => Math.max(ruleOf.get(pageId)!.activeSince, nowS - LOOKBACK_S);
      const posts = await fetchPageBatch<PostRow[]>(
        pageIds.map((pageId) => ({ pageId, candidates: candOf(pageId) })),
        (pageId) => `/${pageId}/published_posts?fields=id,created_time,message&since=${sinceOf(pageId)}&limit=25`,
        (data) => ((data as { data?: PostRow[] })?.data ?? []),
      );
      sum.pagesChecked += pageIds.length;

      const fresh: Array<{ pageId: string; post: PostRow }> = [];
      for (const pageId of pageIds) {
        const r = posts[pageId];
        if (!r || "error" in r) {
          if (r && "error" in r) sum.errors.push(`${pageId}: ${r.error}`);
          continue;
        }
        const since = sinceOf(pageId);
        for (const post of r) if (Date.parse(post.created_time) / 1000 >= since) fresh.push({ pageId, post });
      }
      // Drop posts already handled.
      const done = new Set<string>();
      const ids = fresh.map((f) => f.post.id);
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const rows = await db
          .select({ postId: fbCommentLog.postId })
          .from(fbCommentLog)
          .where(and(eq(fbCommentLog.ownerUserId, ownerId), inArray(fbCommentLog.postId, ids.slice(i, i + IN_CHUNK))));
        for (const r of rows) done.add(r.postId);
      }
      const todo = fresh.filter((f) => !done.has(f.post.id)).sort((a, b) => a.post.created_time.localeCompare(b.post.created_time));
      sum.newPosts += todo.length;

      const logRows: Array<typeof fbCommentLog.$inferInsert> = [];
      for (const { pageId, post } of todo) {
        if (budget <= 0) {
          sum.skipped++;
          continue;
        }
        budget--;
        const rule = ruleOf.get(pageId)!;
        const text = pick(parseComments(rule.comments));
        const base = { ownerUserId: ownerId, ruleId: rule.id, pageId, postId: post.id, postMessage: post.message?.slice(0, 300) ?? null, comment: text, createdAt: nowS };
        try {
          const r = await withPageToken(pageId, candOf(pageId), (token) => graphPost<{ id: string }>(`/${post.id}/comments`, { message: text }, token));
          if ("permissionError" in r) {
            logRows.push({ ...base, status: "error", error: `Token thiếu quyền comment (cần pages_manage_engagement): ${r.permissionError}` });
            sum.failed++;
          } else {
            logRows.push({ ...base, status: "ok", commentId: r.value.id });
            sum.commented++;
          }
        } catch (e) {
          if (isTransient(e)) {
            sum.skipped++;
            continue;
          }
          logRows.push({ ...base, status: "error", error: viError(e) });
          sum.failed++;
        }
      }
      // ~11 columns per row; D1 allows 100 bound parameters per statement.
      for (let i = 0; i < logRows.length; i += 8) {
        await db.insert(fbCommentLog).values(logRows.slice(i, i + 8)).onConflictDoNothing();
      }
      await db
        .update(fbCommentRules)
        .set({ lastRunAt: nowS })
        .where(and(eq(fbCommentRules.ownerUserId, ownerId), inArray(fbCommentRules.id, ownerRules.map((r) => r.id).slice(0, IN_CHUNK))));
    } catch (e) {
      sum.errors.push(`owner ${ownerId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return sum;
}

/** Latest log rows for the UI. */
export async function recentLog(ownerId: number, limit = 100) {
  return db.select().from(fbCommentLog).where(eq(fbCommentLog.ownerUserId, ownerId)).orderBy(desc(fbCommentLog.id)).limit(limit);
}

// ── rule input (shared by the API routes) ──

export interface RuleInput {
  targetType?: unknown;
  targetId?: unknown;
  comments?: unknown;
  enabled?: unknown;
}

/** Validate a rule body; returns the clean fields or an error message. */
export async function cleanRule(ownerId: number, b: RuleInput, partial = false) {
  const out: { targetType?: string; targetId?: string; comments?: string; enabled?: boolean } = {};
  if (b.targetType !== undefined || !partial) {
    if (b.targetType !== "page" && b.targetType !== "group") return { error: "Chọn Trang hoặc nhóm Trang" };
    const id = typeof b.targetId === "string" || typeof b.targetId === "number" ? String(b.targetId) : "";
    if (b.targetType === "page" && !/^\d+$/.test(id)) return { error: "Trang không hợp lệ" };
    if (b.targetType === "group") {
      const [g] = await db
        .select({ id: insightPageGroups.id })
        .from(insightPageGroups)
        .where(and(eq(insightPageGroups.id, Number(id)), eq(insightPageGroups.ownerUserId, ownerId)));
      if (!g) return { error: "Không tìm thấy nhóm" };
    }
    out.targetType = b.targetType;
    out.targetId = id;
  }
  if (b.comments !== undefined || !partial) {
    const list = (Array.isArray(b.comments) ? b.comments : [])
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.trim().slice(0, 2000))
      .filter(Boolean)
      .slice(0, 30);
    if (list.length === 0) return { error: "Soạn ít nhất 1 nội dung comment" };
    out.comments = JSON.stringify(list);
  }
  if (typeof b.enabled === "boolean") out.enabled = b.enabled;
  return { value: out };
}
