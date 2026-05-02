import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { facebookAccounts, fanpages, fanpagePosts } from "@/lib/db/schema";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import {
  extractPostMetric,
  fetchPostInsights,
  fetchPostVideoEarnings,
  isAbuseError,
} from "@/lib/facebook";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";
// Inter-post throttle is 400ms; insighting 25+ posts can exceed the default
// 10s serverless function timeout. Allow up to 60s for the full batch.
export const maxDuration = 60;

interface BatchBody {
  ids?: number[]; // post row ids
  fanpageId?: number; // alternative: all posts of a fanpage
  // Optional token override: when fanpage X's own token is abuse-blocked, the
  // user can pick another fanpage row that manages the SAME FB page (different
  // managing FB account) and reuse its page token. Map: failedFpId → useFpId.
  tokenOverrides?: Record<string, number>;
}

interface Item {
  id: number;
  postId: string;
  ok: boolean;
  reach?: number | null;
  error?: string;
}

// Returned alongside `abused: true` so the UI can prompt the user to retry
// with a sibling account's token.
interface TokenAlternative {
  fanpageId: number;
  accountId: number;
  accountUsername: string;
  accountFbName: string | null;
}
interface TokenAlternativesBlock {
  failedFanpageId: number;
  pageId: string;
  failedAccountUsername: string | null;
  alternatives: TokenAlternative[];
}

export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  const body = await readBody<BatchBody>(req);

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    : [];

  // Posts inherit ownership from their parent fanpage. Inner-join to enforce
  // owner scope — prevents user A from triggering insight refresh on user B's
  // posts by guessing post or fanpage ids.
  const rows =
    ids.length > 0
      ? await db
          .select({
            id: fanpagePosts.id,
            postId: fanpagePosts.postId,
            fanpageId: fanpagePosts.fanpageId,
          })
          .from(fanpagePosts)
          .innerJoin(fanpages, eq(fanpagePosts.fanpageId, fanpages.id))
          .where(
            and(
              inArray(fanpagePosts.id, ids),
              eq(fanpages.ownerUserId, ownerId),
            ),
          )
      : typeof body.fanpageId === "number" && Number.isFinite(body.fanpageId)
        ? await db
            .select({
              id: fanpagePosts.id,
              postId: fanpagePosts.postId,
              fanpageId: fanpagePosts.fanpageId,
            })
            .from(fanpagePosts)
            .innerJoin(fanpages, eq(fanpagePosts.fanpageId, fanpages.id))
            .where(
              and(
                eq(fanpagePosts.fanpageId, body.fanpageId),
                eq(fanpages.ownerUserId, ownerId),
              ),
            )
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

  // Cache page tokens by fanpageId (avoid re-decrypting per post). Token
  // overrides redirect a fanpage's lookup to a sibling fanpage row's token.
  const fpIds = [...new Set(rows.map((r) => r.fanpageId))];
  const overrides = body.tokenOverrides ?? {};
  const overrideTargetIds = Object.values(overrides).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  const allFpIdsToFetch = [...new Set([...fpIds, ...overrideTargetIds])];
  const fpRows = await db
    .select({
      id: fanpages.id,
      pageId: fanpages.pageId,
      fbAccountId: fanpages.fbAccountId,
      encPageAccessToken: fanpages.encPageAccessToken,
    })
    .from(fanpages)
    .where(
      and(
        inArray(fanpages.id, allFpIdsToFetch),
        eq(fanpages.ownerUserId, ownerId),
      ),
    );
  const fpById = new Map(fpRows.map((f) => [f.id, f]));
  const tokenMap = new Map<number, string | null>();
  for (const fpId of fpIds) {
    const overrideTargetId = overrides[String(fpId)];
    const sourceId =
      typeof overrideTargetId === "number" && fpById.has(overrideTargetId)
        ? overrideTargetId
        : fpId;
    const enc = fpById.get(sourceId)?.encPageAccessToken;
    tokenMap.set(fpId, enc ? await decrypt(enc) : null);
  }

  const results: Item[] = [];
  let okCount = 0;
  let errCount = 0;
  let skipCount = 0;
  let abused = false;
  let abuseFanpageId: number | null = null;

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
      // FB abuse cooldown is sticky across the token — finishing the loop
      // just produces N copies of the same error and deepens the penalty.
      // Capture which fanpage tripped it so we can offer the user sibling
      // account tokens (same FB page, different managing account).
      if (isAbuseError(e)) {
        abused = true;
        abuseFanpageId = r.fanpageId;
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

  // Look up alternative-token candidates: sibling fanpage rows for the same
  // FB page (page_id) but managed by a different FB account, with a usable
  // page-access-token. Skip any row that the user already overrode (would
  // suggest the same token a 2nd time).
  let tokenAlternatives: TokenAlternativesBlock | undefined;
  if (abused && abuseFanpageId !== null) {
    const failedFp = fpById.get(abuseFanpageId);
    if (failedFp) {
      const overrideTargetForFailed = overrides[String(abuseFanpageId)];
      const altRows = await db
        .select({
          fanpageId: fanpages.id,
          fbAccountId: fanpages.fbAccountId,
          accountUsername: facebookAccounts.username,
          accountFbName: facebookAccounts.fbName,
        })
        .from(fanpages)
        .innerJoin(
          facebookAccounts,
          eq(fanpages.fbAccountId, facebookAccounts.id),
        )
        .where(
          and(
            eq(fanpages.ownerUserId, ownerId),
            eq(fanpages.pageId, failedFp.pageId),
            ne(fanpages.id, abuseFanpageId),
            isNotNull(fanpages.encPageAccessToken),
          ),
        );
      const alternatives: TokenAlternative[] = altRows
        .filter((a) => a.fanpageId !== overrideTargetForFailed)
        .map((a) => ({
          fanpageId: a.fanpageId,
          accountId: a.fbAccountId,
          accountUsername: a.accountUsername,
          accountFbName: a.accountFbName,
        }));
      let failedAccountUsername: string | null = null;
      const [failedAccount] = await db
        .select({ username: facebookAccounts.username })
        .from(facebookAccounts)
        .where(
          and(
            eq(facebookAccounts.id, failedFp.fbAccountId),
            eq(facebookAccounts.ownerUserId, ownerId),
          ),
        );
      if (failedAccount) failedAccountUsername = failedAccount.username;
      tokenAlternatives = {
        failedFanpageId: abuseFanpageId,
        pageId: failedFp.pageId,
        failedAccountUsername,
        alternatives,
      };
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
    abuseFanpageId,
    tokenAlternatives,
    hint: abused
      ? "FB đang giới hạn token này (abuse). Chờ ~5–60 phút rồi thử lại với ít bài hơn (≤10)."
      : undefined,
  });
}
