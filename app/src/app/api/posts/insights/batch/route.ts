import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages, fanpagePosts } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import {
  extractPostMetric,
  fetchPostInsights,
  fetchPostVideoEarnings,
  isAbuseError,
} from "@/lib/facebook";

export const runtime = "nodejs";
// Inter-post throttle is 400ms; insighting 25+ posts can exceed the default
// 10s serverless function timeout. Allow up to 60s for the full batch.
export const maxDuration = 60;

interface BatchBody {
  ids?: number[]; // post row ids
  fanpageId?: number; // alternative: all posts of a fanpage
}

interface Item {
  id: number;
  postId: string;
  ok: boolean;
  reach?: number | null;
  error?: string;
}

export async function POST(req: Request) {
  let body: BatchBody = {};
  try {
    body = (await req.json()) as BatchBody;
  } catch {
    // empty ok
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    : [];

  const rows =
    ids.length > 0
      ? await db
          .select({
            id: fanpagePosts.id,
            postId: fanpagePosts.postId,
            fanpageId: fanpagePosts.fanpageId,
          })
          .from(fanpagePosts)
          .where(inArray(fanpagePosts.id, ids))
      : typeof body.fanpageId === "number" && Number.isFinite(body.fanpageId)
        ? await db
            .select({
              id: fanpagePosts.id,
              postId: fanpagePosts.postId,
              fanpageId: fanpagePosts.fanpageId,
            })
            .from(fanpagePosts)
            .where(eq(fanpagePosts.fanpageId, body.fanpageId))
        : [];

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      total: 0,
      okCount: 0,
      errCount: 0,
      skipCount: 0,
      results: [],
      empty: true,
    });
  }

  // Cache page tokens by fanpageId (avoid re-decrypting per post).
  const fpIds = [...new Set(rows.map((r) => r.fanpageId))];
  const fpRows = await db
    .select({
      id: fanpages.id,
      encPageAccessToken: fanpages.encPageAccessToken,
    })
    .from(fanpages)
    .where(inArray(fanpages.id, fpIds));
  const tokenMap = new Map<number, string | null>();
  for (const fp of fpRows) {
    tokenMap.set(fp.id, decrypt(fp.encPageAccessToken));
  }

  const results: Item[] = [];
  let okCount = 0;
  let errCount = 0;
  let skipCount = 0;
  let abused = false;

  // Inter-post delay to stay under FB's per-token abuse limiter. 400ms × 25
  // posts ≈ 10s — slow enough that bursty insight fetches don't trip code 368
  // (sticky 5–60min cooldown), fast enough that small batches feel responsive.
  const DELAY_MS = 400;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const token = tokenMap.get(r.fanpageId);
    if (!token) {
      results.push({
        id: r.id,
        postId: r.postId,
        ok: false,
        error: "Fanpage chưa có page token",
      });
      skipCount++;
      continue;
    }
    if (i > 0) await new Promise((res) => setTimeout(res, DELAY_MS));
    const now = new Date();
    try {
      // Fetch insights + earnings in parallel — earnings is best-effort
      // (returns available:false for non-video posts / not-monetized pages
      // and never throws, so it doesn't break the insights write).
      const [insights, earnings] = await Promise.all([
        fetchPostInsights(r.postId, token),
        fetchPostVideoEarnings(r.postId, token),
      ]);
      const reach = extractPostMetric(insights, "post_impressions_unique");
      await db
        .update(fanpagePosts)
        .set({
          impressions: extractPostMetric(insights, "post_impressions"),
          impressionsUnique: reach,
          reach,
          engagedUsers: extractPostMetric(insights, "post_engaged_users"),
          clicks: extractPostMetric(insights, "post_clicks"),
          videoViews: extractPostMetric(insights, "post_video_views"),
          insightsJson: JSON.stringify(insights),
          adBreakEarnings: earnings.available ? earnings.totalMicros : null,
          adBreakCurrency: earnings.available ? earnings.currency : null,
          earningsUpdatedAt: now,
          earningsError: earnings.available ? null : earnings.error,
          lastInsightsAt: now,
          lastInsightsError: null,
          updatedAt: now,
        })
        .where(eq(fanpagePosts.id, r.id));
      results.push({ id: r.id, postId: r.postId, ok: true, reach });
      okCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .update(fanpagePosts)
        .set({
          lastInsightsError: msg,
          lastInsightsAt: now,
          updatedAt: now,
        })
        .where(eq(fanpagePosts.id, r.id));
      results.push({ id: r.id, postId: r.postId, ok: false, error: msg });
      errCount++;
      // FB abuse cooldown is sticky across the whole token — finishing the
      // loop just produces N copies of the same error and deepens the
      // penalty. Mark remaining rows as skipped and return a clear hint.
      if (isAbuseError(e)) {
        abused = true;
        for (let j = i + 1; j < rows.length; j++) {
          results.push({
            id: rows[j].id,
            postId: rows[j].postId,
            ok: false,
            error: "Bỏ qua — token đang bị FB giới hạn (abuse)",
          });
          skipCount++;
        }
        break;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    total: rows.length,
    okCount,
    errCount,
    skipCount,
    results,
    abused,
    hint: abused
      ? "FB đang giới hạn token này (abuse). Chờ ~5–60 phút rồi thử lại với ít bài hơn (≤10)."
      : undefined,
  });
}
