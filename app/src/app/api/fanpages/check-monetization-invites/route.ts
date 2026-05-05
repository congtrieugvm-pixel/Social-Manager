import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages, facebookAccounts } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { fetchPageMonetizationOptions } from "@/lib/facebook";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

interface CheckInvitesBody {
  ids?: number[];
}

interface InvitedPage {
  id: number;
  pageId: string;
  name: string;
  pictureUrl: string | null;
  link: string | null;
  /**
   * Raw `monetization_options` array FB returned. Each entry is an FB
   * feature key (e.g. "instream_ads", "story_ads", "creator_program").
   * Treated as the "invitation surface" — if FB lists it, the page can
   * enroll in that monetization program from Business Suite.
   */
  options: string[];
}

interface ItemResult {
  id: number;
  pageId: string;
  name: string;
  hasInvite: boolean;
  options: string[];
  error?: string;
  errorKind?: "perm" | "rate" | "other";
}

function classifyError(msg: string): "perm" | "rate" | "other" {
  if (
    /\(#?(200|190|10|102|459|464)\)|sufficient administrative permission|Invalid OAuth|access token/i.test(
      msg,
    )
  ) {
    return "perm";
  }
  if (
    /\(#?(4|17|32|341|613)\)|rate limit|too many calls|temporarily blocked/i.test(
      msg,
    )
  ) {
    return "rate";
  }
  return "other";
}

/**
 * POST /api/fanpages/check-monetization-invites
 *
 * Body: `{ ids: number[] }`
 *
 * For each selected fanpage, queries FB's `monetization_options` field on
 * the Page node. Pages where FB returns a non-empty array are considered
 * to have an active "invitation surface" — the page admin can enable
 * Content Monetization (or related programs) from Business Suite. Pages
 * with an empty options array, OR where the field is restricted, are
 * reported as not-invited.
 *
 * The route is per-page parallel (each page has its own token, FB rate
 * limits are per-token so concurrent calls are safe). With chunk=20 on
 * the client + Promise.all here, a chunk completes in ~max(per-page) ≈
 * 1–2s instead of Σ.
 */
export async function POST(req: Request) {
  const ownerId = await getOwnerId();
  const body = await readBody<CheckInvitesBody>(req);
  const ids = Array.isArray(body.ids)
    ? body.ids.filter(
        (x): x is number => typeof x === "number" && Number.isFinite(x),
      )
    : [];

  if (ids.length === 0) {
    return NextResponse.json({
      total: 0,
      invitedCount: 0,
      notInvitedCount: 0,
      permCount: 0,
      rateCount: 0,
      errorCount: 0,
      invited: [],
      results: [],
    });
  }

  // Pull rows + user-token fallback so a fanpage missing its page token
  // can still query monetization_options (the route only reads, doesn't
  // mutate stored tokens — that's sync-earnings's job).
  const rows = await db
    .select({
      id: fanpages.id,
      pageId: fanpages.pageId,
      name: fanpages.name,
      pictureUrl: fanpages.pictureUrl,
      link: fanpages.link,
      encPageAccessToken: fanpages.encPageAccessToken,
      encUserToken: facebookAccounts.encAccessToken,
    })
    .from(fanpages)
    .leftJoin(facebookAccounts, eq(fanpages.fbAccountId, facebookAccounts.id))
    .where(
      and(eq(fanpages.ownerUserId, ownerId), inArray(fanpages.id, ids)),
    );

  type Tagged = ItemResult & {
    pictureUrl: string | null;
    link: string | null;
    _kind: "invited" | "notInvited" | "perm" | "rate" | "err";
  };

  const tagged = await Promise.all(
    rows.map(async (r): Promise<Tagged> => {
      const pageToken = await decrypt(r.encPageAccessToken);
      const token = pageToken ?? (await decrypt(r.encUserToken));
      if (!token) {
        return {
          id: r.id,
          pageId: r.pageId,
          name: r.name,
          pictureUrl: r.pictureUrl,
          link: r.link,
          hasInvite: false,
          options: [],
          error: "Không có page token và cũng không có user token",
          errorKind: "perm",
          _kind: "perm",
        };
      }
      const monet = await fetchPageMonetizationOptions(r.pageId, token);
      // `enabled === null` means FB rejected the field read; classify as
      // a query error (perm/other) rather than "not invited" so the user
      // sees the right reason and can re-grant if needed.
      if (monet.enabled === null && monet.error) {
        const kind = classifyError(monet.error);
        return {
          id: r.id,
          pageId: r.pageId,
          name: r.name,
          pictureUrl: r.pictureUrl,
          link: r.link,
          hasInvite: false,
          options: [],
          error: monet.error,
          errorKind: kind,
          _kind: kind === "perm" ? "perm" : kind === "rate" ? "rate" : "err",
        };
      }
      const invited = monet.options.length > 0;
      return {
        id: r.id,
        pageId: r.pageId,
        name: r.name,
        pictureUrl: r.pictureUrl,
        link: r.link,
        hasInvite: invited,
        options: monet.options,
        _kind: invited ? "invited" : "notInvited",
      };
    }),
  );

  let invitedCount = 0;
  let notInvitedCount = 0;
  let permCount = 0;
  let rateCount = 0;
  let errorCount = 0;
  const invited: InvitedPage[] = [];
  const results: ItemResult[] = [];
  for (const t of tagged) {
    if (t._kind === "invited") {
      invitedCount++;
      invited.push({
        id: t.id,
        pageId: t.pageId,
        name: t.name,
        pictureUrl: t.pictureUrl,
        link: t.link,
        options: t.options,
      });
    } else if (t._kind === "notInvited") notInvitedCount++;
    else if (t._kind === "perm") permCount++;
    else if (t._kind === "rate") rateCount++;
    else errorCount++;
    const { _kind: _k, pictureUrl: _p, link: _l, ...item } = t;
    void _k;
    void _p;
    void _l;
    results.push(item);
  }

  return NextResponse.json({
    total: rows.length,
    invitedCount,
    notInvitedCount,
    permCount,
    rateCount,
    errorCount,
    invited,
    results,
  });
}
