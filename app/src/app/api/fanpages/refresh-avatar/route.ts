import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages } from "@/lib/db/schema";
import { inArray, eq } from "drizzle-orm";
import { buildFbAvatarUrl } from "@/lib/facebook";

export const runtime = "nodejs";

interface ItemResult {
  id: number;
  pageId: string;
  name: string;
  ok: boolean;
  pictureUrl?: string;
  error?: string;
}

/**
 * Refreshes `picture_url` to the public Graph picture redirector URL keyed
 * by `page_id`. No access token, no Graph API call. The redirector URL is
 * stable; FB resolves the live CDN URL on every browser load, so it never
 * "expires" the way the previously-stored signed CDN URL did.
 */
export async function POST(req: Request) {
  let ids: number[] = [];
  try {
    const body = (await req.json()) as { ids?: number[] };
    ids = Array.isArray(body.ids)
      ? body.ids.filter(
          (x): x is number => typeof x === "number" && Number.isFinite(x),
        )
      : [];
  } catch {
    // empty body → 400 below
  }
  if (ids.length === 0) {
    return NextResponse.json({ error: "Thiếu danh sách id" }, { status: 400 });
  }

  const rows = await db
    .select({
      id: fanpages.id,
      pageId: fanpages.pageId,
      name: fanpages.name,
    })
    .from(fanpages)
    .where(inArray(fanpages.id, ids));

  const results: ItemResult[] = [];
  let okCount = 0;
  let errCount = 0;
  const now = new Date();

  for (const r of rows) {
    if (!r.pageId) {
      results.push({
        id: r.id,
        pageId: r.pageId,
        name: r.name,
        ok: false,
        error: "Fanpage thiếu page_id",
      });
      errCount++;
      continue;
    }
    try {
      const pictureUrl = buildFbAvatarUrl(r.pageId);
      await db
        .update(fanpages)
        .set({
          pictureUrl,
          lastSyncedAt: now,
          lastSyncError: null,
          updatedAt: now,
        })
        .where(eq(fanpages.id, r.id));
      results.push({
        id: r.id,
        pageId: r.pageId,
        name: r.name,
        ok: true,
        pictureUrl,
      });
      okCount++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        id: r.id,
        pageId: r.pageId,
        name: r.name,
        ok: false,
        error: msg,
      });
      errCount++;
    }
  }

  return NextResponse.json({
    ok: true,
    total: rows.length,
    okCount,
    errCount,
    skipCount: 0,
    results,
  });
}
