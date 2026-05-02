import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fanpages, facebookAccounts } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  buildFbAvatarUrl,
  debugUserToken,
  fetchMe,
  fetchMeAccounts,
  fetchBusinessPages,
  fetchPageDetail,
  fetchUserPages,
  isFacebookConfigured,
  mapTokenErrorToVi,
  mergeFbPages,
  parseGraphError,
  previewToken,
  scrubGraphMessage,
  verifyTokenWithoutAppCreds,
  type FbDebugTokenInfo,
  type FbPage,
} from "@/lib/facebook";
import { readBody } from "@/lib/req-body";
import { getOwnerId } from "@/lib/scope";

export const runtime = "nodejs";

interface SyncBody {
  fbAccountId?: number | null;
  token?: string | null;
}

interface ResolvedToken {
  token: string;
  source: "direct" | "stored";
  storedAccountId: number | null;
}

async function resolveToken(body: SyncBody): Promise<
  | { ok: true; resolved: ResolvedToken }
  | { ok: false; status: number; error: string }
> {
  const directToken =
    typeof body.token === "string" && body.token.trim().length > 0
      ? body.token.trim()
      : null;
  const reqAccountId =
    typeof body.fbAccountId === "number" && Number.isFinite(body.fbAccountId)
      ? body.fbAccountId
      : null;

  if (directToken) {
    return {
      ok: true,
      resolved: {
        token: directToken,
        source: "direct",
        storedAccountId: reqAccountId,
      },
    };
  }
  if (!reqAccountId) {
    return { ok: false, status: 400, error: "Thiếu token hoặc fbAccountId" };
  }
  const [row] = await db
    .select({
      id: facebookAccounts.id,
      encAccessToken: facebookAccounts.encAccessToken,
    })
    .from(facebookAccounts)
    .where(eq(facebookAccounts.id, reqAccountId));
  if (!row) {
    return { ok: false, status: 404, error: "Không tìm thấy tài khoản Facebook" };
  }
  const dec = await decrypt(row.encAccessToken);
  if (!dec) {
    return { ok: false, status: 400, error: "Tài khoản Facebook chưa có token" };
  }
  return {
    ok: true,
    resolved: { token: dec, source: "stored", storedAccountId: row.id },
  };
}

async function savePages(
  ownerAccountId: number,
  ownerUserId: number,
  pages: FbPage[],
  now: Date,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const p of pages) {
    const values = {
      ownerUserId,
      fbAccountId: ownerAccountId,
      pageId: p.id,
      name: p.name,
      category: p.category ?? null,
      categoryList: p.category_list ? JSON.stringify(p.category_list) : null,
      about: p.about ?? null,
      description: p.description ?? null,
      // Avatar: stable redirector keyed by page id. Don't store the
      // signed CDN URL from p.picture (it expires within days).
      pictureUrl: buildFbAvatarUrl(p.id),
      coverUrl: p.cover?.source ?? null,
      link: p.link ?? null,
      username: p.username ?? null,
      fanCount: p.fan_count ?? null,
      followersCount: p.followers_count ?? null,
      newLikeCount: p.new_like_count ?? null,
      ratingCount: p.rating_count ?? null,
      overallStarRating:
        p.overall_star_rating !== undefined
          ? String(p.overall_star_rating)
          : null,
      verificationStatus: p.verification_status ?? null,
      tasks: p.tasks ? JSON.stringify(p.tasks) : null,
      encPageAccessToken: p.access_token ? await encrypt(p.access_token) : null,
      lastSyncedAt: now,
      lastSyncError: null,
      updatedAt: now,
    };
    const [existing] = await db
      .select({ id: fanpages.id })
      .from(fanpages)
      .where(
        and(eq(fanpages.fbAccountId, ownerAccountId), eq(fanpages.pageId, p.id)),
      );
    if (existing) {
      await db.update(fanpages).set(values).where(eq(fanpages.id, existing.id));
      updated++;
    } else {
      await db.insert(fanpages).values(values);
      inserted++;
    }
  }
  return { inserted, updated };
}

// ---------------------------------------------------------------------------
// JSON (legacy) flow — kept for callers that don't accept NDJSON. The streaming
// flow below is preferred for the manual-token UI.
// ---------------------------------------------------------------------------
async function runJsonFlow(body: SyncBody, ownerUserId: number): Promise<Response> {
  const r = await resolveToken(body);
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  const { token, source, storedAccountId } = r.resolved;
  let ownerAccountId = storedAccountId;

  let meId: string | null = null;
  let meName: string | null = null;
  let mePic: string | null = null;
  if (!ownerAccountId) {
    try {
      const me = await fetchMe(token);
      meId = me.id;
      meName = me.name;
      mePic = buildFbAvatarUrl(me.id);
      const matches = await db
        .select({ id: facebookAccounts.id })
        .from(facebookAccounts)
        .where(eq(facebookAccounts.fbUserId, me.id));
      ownerAccountId = matches[0]?.id ?? null;
    } catch {
      // /me failed — keep ownerAccountId null, may auto-create below.
    }
  }

  let pages;
  try {
    pages = await fetchUserPages(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (ownerAccountId) {
      await db
        .update(facebookAccounts)
        .set({ lastSyncError: msg, lastSyncedAt: new Date() })
        .where(eq(facebookAccounts.id, ownerAccountId));
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const now = new Date();
  if (!ownerAccountId && source === "direct") {
    const fallbackUsername = meId
      ? `fb_${meId}`
      : `fb_token_${Math.floor(Date.now() / 1000)}`;
    const [created] = await db
      .insert(facebookAccounts)
      .values({
        ownerUserId,
        username: fallbackUsername,
        encPassword: await encrypt(""),
        encEmail: await encrypt(""),
        enc2fa: await encrypt(""),
        encEmailPassword: await encrypt(""),
        encAccessToken: await encrypt(token),
        fbUserId: meId,
        fbName: meName,
        fbProfilePic: mePic,
        lastSyncedAt: now,
      })
      .returning({ id: facebookAccounts.id });
    ownerAccountId = created.id;
  }
  if (!ownerAccountId) {
    return NextResponse.json(
      {
        error:
          "Không xác định được tài khoản sở hữu token — chỉ định fbAccountId hoặc import tài khoản có fb_user_id trùng",
        pagesFound: pages.length,
      },
      { status: 400 },
    );
  }

  // Filter to pages user actually manages (has access_token after backfill).
  // BM-only-visible pages are dropped here to keep parity with the streaming
  // flow's behaviour. Existing entries for unmanaged pages are removed too.
  const managedPages = pages.filter((p) => !!p.access_token);
  const unmanagedPageIds = pages
    .filter((p) => !p.access_token)
    .map((p) => p.id);
  if (unmanagedPageIds.length > 0) {
    await db
      .delete(fanpages)
      .where(
        and(
          eq(fanpages.fbAccountId, ownerAccountId),
          inArray(fanpages.pageId, unmanagedPageIds),
        ),
      );
  }

  const { inserted, updated } = await savePages(ownerAccountId, ownerUserId, managedPages, now);
  await db
    .update(facebookAccounts)
    .set({ lastSyncedAt: now, lastSyncError: null })
    .where(eq(facebookAccounts.id, ownerAccountId));

  return NextResponse.json({
    ok: true,
    fbAccountId: ownerAccountId,
    pagesFound: managedPages.length,
    inserted,
    updated,
  });
}

// ---------------------------------------------------------------------------
// NDJSON streaming flow — emits one JSON-per-line so the UI can render
// per-step progress. Called when client sets `Accept: application/x-ndjson`.
// ---------------------------------------------------------------------------

type StepStatus = "running" | "ok" | "error" | "skipped";

interface StepEvent {
  type: "step";
  step: string;
  status: StepStatus;
  label: string;
  detail?: string;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

interface InitEvent {
  type: "init";
  source: "direct" | "stored";
  storedAccountId: number | null;
  tokenPreview: string;
  tokenLength: number;
}

interface DoneEvent {
  type: "done";
  ok: boolean;
  fbAccountId?: number;
  pagesFound?: number;
  inserted?: number;
  updated?: number;
  error?: string;
}

type StreamEvent = StepEvent | InitEvent | DoneEvent;

function makeEmitter(controller: ReadableStreamDefaultController<Uint8Array>) {
  const enc = new TextEncoder();
  return (e: StreamEvent) => {
    controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
  };
}

async function runStreamFlow(body: SyncBody, ownerUserId: number): Promise<Response> {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = makeEmitter(controller);
      const finish = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      try {
        await streamBody(body, ownerUserId, emit);
      } catch (e) {
        if (!closed) {
          try {
            emit({
              type: "done",
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          } catch {
            // controller may already be in an error state — best-effort.
          }
        }
      } finally {
        finish();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

async function streamBody(
  body: SyncBody,
  ownerUserId: number,
  emit: (e: StreamEvent) => void,
): Promise<void> {
  const r = await resolveToken(body);
  if (!r.ok) {
    emit({ type: "done", ok: false, error: r.error });
    return;
  }
  const { token, source, storedAccountId } = r.resolved;

  emit({
    type: "init",
    source,
    storedAccountId,
    tokenPreview: previewToken(token),
    tokenLength: token.length,
  });

  const runStep = async <T>(
    step: string,
    label: string,
    fn: () => Promise<{ data?: unknown; detail?: string; result: T }>,
  ): Promise<
    | { ok: true; result: T }
    | { ok: false; error: string; cause: unknown }
  > => {
    const startedAt = Date.now();
    emit({ type: "step", step, status: "running", label });
    try {
      const r2 = await fn();
      emit({
        type: "step",
        step,
        status: "ok",
        label,
        detail: r2.detail,
        data: r2.data,
        durationMs: Date.now() - startedAt,
      });
      return { ok: true, result: r2.result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      emit({
        type: "step",
        step,
        status: "error",
        label,
        error: msg,
        durationMs: Date.now() - startedAt,
      });
      return { ok: false, error: msg, cause: e };
    }
  };

  // Step 1 — debug_token (optional). Skipped when FB app creds missing.
  let debug: FbDebugTokenInfo | null = null;
  // Pre-populated when verify_token path runs successfully, so step 2 can
  // skip the redundant /me roundtrip.
  let prefetchedUser: { id: string; name: string } | null = null;
  if (isFacebookConfigured()) {
    const r1 = await runStep(
      "debug_token",
      "Kiểm tra token (Graph /debug_token)",
      async () => {
        const d = await debugUserToken(token);
        const expIso = d.expires_at
          ? new Date(d.expires_at * 1000).toISOString()
          : "không hết hạn";
        return {
          data: {
            isValid: !!d.is_valid,
            appId: d.app_id ?? null,
            application: d.application ?? null,
            userId: d.user_id ?? null,
            type: d.type ?? null,
            expiresAt: d.expires_at ?? null,
            dataAccessExpiresAt: d.data_access_expires_at ?? null,
            scopes: d.scopes ?? [],
            error: d.error?.message ? scrubGraphMessage(d.error.message) : null,
          },
          detail: d.is_valid
            ? `valid · app=${d.application ?? d.app_id ?? "?"} · user=${d.user_id ?? "?"} · expires=${expIso} · scopes=${(d.scopes ?? []).length}`
            : `KHÔNG hợp lệ${d.error?.message ? ` — ${scrubGraphMessage(d.error.message)}` : ""}`,
          result: d,
        };
      },
    );
    if (r1.ok) {
      debug = r1.result;
      if (!debug.is_valid) {
        emit({
          type: "done",
          ok: false,
          error: debug.error?.message
            ? scrubGraphMessage(debug.error.message)
            : "Token không hợp lệ",
        });
        return;
      }
    } else {
      emit({ type: "done", ok: false, error: r1.error });
      return;
    }
  } else {
    // Appless verification — works without FB_APP_ID. Calls /me + /me/permissions
    // so we can tell expired/invalid/missing-scope before /me/accounts.
    // /me/permissions failure is SOFT (Page tokens / restricted apps can't query
    // it but /me/accounts may still work) — don't block on it.
    const r1 = await runStep(
      "verify_token",
      "Xác thực token (Graph /me + /me/permissions)",
      async () => {
        const v = await verifyTokenWithoutAppCreds(token);
        if (!v.ok) {
          const e = new Error(mapTokenErrorToVi(v.error));
          (e as Error & { graph?: unknown }).graph = {
            code: v.error.code ?? undefined,
            error_subcode: v.error.subcode ?? undefined,
            type: v.error.type ?? undefined,
            message: v.error.message,
          };
          throw e;
        }
        const permsNote = v.permissionsCheckFailed
          ? ` · /permissions không đọc được (${v.permissionsError?.message ?? "?"}) — sẽ thử /me/accounts trực tiếp`
          : "";
        return {
          data: {
            isValid: true,
            userId: v.userId,
            fbName: v.userName,
            scopes: v.scopes,
            missingRequired: v.missingRequired,
            missingRecommended: v.missingRecommended,
            permissionsCheckFailed: v.permissionsCheckFailed,
          },
          detail:
            `valid · user=${v.userName} (${v.userId}) · scopes=${v.scopes.length}` +
            (v.missingRequired.length
              ? ` · THIẾU ${v.missingRequired.join(",")}`
              : "") +
            (v.missingRecommended.length
              ? ` · nên có thêm ${v.missingRecommended.join(",")}`
              : "") +
            permsNote,
          result: v,
        };
      },
    );
    if (!r1.ok) {
      emit({ type: "done", ok: false, error: r1.error });
      return;
    }
    // Only block when we KNOW required scopes are missing (perms call succeeded
    // and returned a permission set without pages_show_list). When the perms
    // call itself failed, let /me/accounts be the authoritative check.
    if (
      !r1.result.permissionsCheckFailed &&
      r1.result.missingRequired.length > 0
    ) {
      emit({
        type: "done",
        ok: false,
        error:
          `Token thiếu quyền bắt buộc: ${r1.result.missingRequired.join(", ")}. ` +
          `Hãy cấp lại token với các scope này.`,
      });
      return;
    }
    prefetchedUser = { id: r1.result.userId, name: r1.result.userName };
  }

  // Step 2 — /me. Reuse identity from verify_token when available to avoid a
  // second roundtrip; emit the same step event shape so the UI still hydrates.
  let meId: string | null = null;
  let meName: string | null = null;
  let mePic: string | null = null;
  if (prefetchedUser) {
    meId = prefetchedUser.id;
    meName = prefetchedUser.name;
    mePic = buildFbAvatarUrl(prefetchedUser.id);
    emit({
      type: "step",
      step: "fetch_me",
      status: "ok",
      label: "Lấy hồ sơ người dùng (Graph /me)",
      detail: `${meName} · id=${meId} (đã lấy ở bước xác thực)`,
      data: { fbUserId: meId, fbName: meName, fbProfilePic: mePic },
      durationMs: 0,
    });
  } else {
    const r2 = await runStep(
      "fetch_me",
      "Lấy hồ sơ người dùng (Graph /me)",
      async () => {
        const me = await fetchMe(token);
        meId = me.id;
        meName = me.name;
        mePic = buildFbAvatarUrl(me.id);
        return {
          data: { fbUserId: me.id, fbName: me.name, fbProfilePic: mePic },
          detail: `${me.name} · id=${me.id}`,
          result: me,
        };
      },
    );
    if (!r2.ok) {
      emit({
        type: "done",
        ok: false,
        error: mapTokenErrorToVi(parseGraphError(r2.cause)),
      });
      return;
    }
  }

  // Step 3 — match owner account by fb_user_id.
  let ownerAccountId: number | null = storedAccountId;
  if (!ownerAccountId && meId) {
    await runStep(
      "match_account",
      "Tìm tài khoản FB đã lưu khớp fb_user_id",
      async () => {
        const matches = await db
          .select({
            id: facebookAccounts.id,
            username: facebookAccounts.username,
          })
          .from(facebookAccounts)
          .where(eq(facebookAccounts.fbUserId, meId!));
        const m = matches[0] ?? null;
        ownerAccountId = m?.id ?? null;
        return {
          data: {
            matchedAccountId: m?.id ?? null,
            username: m?.username ?? null,
          },
          detail: m
            ? `khớp @${m.username} (id=${m.id})`
            : "không khớp — sẽ tạo tài khoản placeholder ở bước cuối",
          result: m,
        };
      },
    );
  } else if (ownerAccountId) {
    emit({
      type: "step",
      step: "match_account",
      status: "skipped",
      label: "Tìm tài khoản FB đã lưu khớp fb_user_id",
      detail: `dùng fbAccountId=${ownerAccountId} đã chỉ định`,
    });
  }

  // Step 4 — /me/accounts (classic admin pages).
  const r4 = await runStep(
    "fetch_me_accounts",
    "Lấy fanpage admin (Graph /me/accounts)",
    async () => {
      const list = await fetchMeAccounts(token);
      return {
        data: { count: list.length },
        detail: `${list.length} fanpage`,
        result: list,
      };
    },
  );
  if (!r4.ok) {
    emit({
      type: "done",
      ok: false,
      error: mapTokenErrorToVi(parseGraphError(r4.cause)),
    });
    return;
  }
  const meAccountsList = r4.result;

  // Step 5 — Business Manager pages. Errors are reported but non-fatal.
  const r5 = await runStep(
    "fetch_business_pages",
    "Lấy fanpage qua Business Manager (/me/businesses)",
    async () => {
      const res = await fetchBusinessPages(token);
      let detail: string;
      if (res.scopeMissing) {
        detail = `bỏ qua — token thiếu scope business_management`;
      } else if (res.businessCount === 0) {
        detail = `0 business`;
      } else {
        detail = `${res.businessCount} business · ${res.pages.length} fanpage${res.errors.length ? ` · ${res.errors.length} edge lỗi` : ""}`;
      }
      return {
        data: {
          businessCount: res.businessCount,
          pageCount: res.pages.length,
          scopeMissing: res.scopeMissing,
          errors: res.errors,
        },
        detail,
        result: res,
      };
    },
  );
  const bizPages = r5.ok ? r5.result.pages : [];

  // Step 6 — merge + dedup.
  const merged = mergeFbPages(meAccountsList, bizPages);
  emit({
    type: "step",
    step: "merge_pages",
    status: "ok",
    label: "Gộp và khử trùng theo page_id",
    detail: `${merged.length} fanpage duy nhất`,
    data: { count: merged.length },
  });

  // Step 7 — backfill missing per-page access tokens.
  const missing = merged.filter((p) => !p.access_token);
  if (missing.length > 0) {
    emit({
      type: "step",
      step: "backfill_tokens",
      status: "running",
      label: `Bù page access_token cho ${missing.length} fanpage`,
    });
    const bfStart = Date.now();
    let recovered = 0;
    const failures: string[] = [];
    for (const p of missing) {
      const detail = await fetchPageDetail(p.id, token);
      if (detail) {
        const idx = merged.findIndex((m) => m.id === p.id);
        if (idx >= 0) merged[idx] = { ...p, ...detail };
        if (detail.access_token) recovered++;
      } else {
        failures.push(p.id);
      }
    }
    emit({
      type: "step",
      step: "backfill_tokens",
      status: "ok",
      label: `Bù page access_token cho ${missing.length} fanpage`,
      detail: `phục hồi ${recovered}/${missing.length}${failures.length ? ` · ${failures.length} không tải được` : ""}`,
      data: { attempted: missing.length, recovered, failed: failures.length },
      durationMs: Date.now() - bfStart,
    });
  } else {
    emit({
      type: "step",
      step: "backfill_tokens",
      status: "skipped",
      label: "Bù page access_token",
      detail: "không có page nào thiếu token",
    });
  }

  const now = new Date();

  // Step 8 — ensure owner account.
  if (!ownerAccountId) {
    if (source !== "direct") {
      emit({
        type: "done",
        ok: false,
        error: "Tài khoản FB đã chỉ định không tồn tại",
      });
      return;
    }
    const r8 = await runStep(
      "ensure_owner",
      "Tạo tài khoản placeholder cho token",
      async () => {
        const fallbackUsername = meId
          ? `fb_${meId}`
          : `fb_token_${Math.floor(Date.now() / 1000)}`;
        const inserted = await db
          .insert(facebookAccounts)
          .values({
            ownerUserId,
            username: fallbackUsername,
            encPassword: await encrypt(""),
            encEmail: await encrypt(""),
            enc2fa: await encrypt(""),
            encEmailPassword: await encrypt(""),
            encAccessToken: await encrypt(token),
            fbUserId: meId,
            fbName: meName,
            fbProfilePic: mePic,
            lastSyncedAt: now,
          })
          .returning({ id: facebookAccounts.id });
        const created = inserted[0];
        if (!created || typeof created.id !== "number") {
          throw new Error(
            "Insert trả về rỗng — không lấy được id của tài khoản placeholder",
          );
        }
        ownerAccountId = created.id;
        return {
          data: { fbAccountId: created.id, username: fallbackUsername },
          detail: `tạo @${fallbackUsername} (id=${created.id})`,
          result: created.id,
        };
      },
    );
    if (!r8.ok) {
      emit({ type: "done", ok: false, error: r8.error });
      return;
    }
  } else {
    emit({
      type: "step",
      step: "ensure_owner",
      status: "skipped",
      label: "Tạo tài khoản placeholder cho token",
      detail: `dùng tài khoản id=${ownerAccountId}`,
    });
  }

  // Defensive: invariant checked before save_pages writes to DB.
  if (ownerAccountId == null) {
    emit({
      type: "done",
      ok: false,
      error: "Không xác định được tài khoản sở hữu sau khi xử lý",
    });
    return;
  }
  const finalOwnerId: number = ownerAccountId;

  // Step 8.5 — filter to pages user actually manages.
  // FB exposes pages via 3 paths: /me/accounts (full admin), /me/businesses
  // owned_pages, and client_pages. The latter two return pages user can SEE
  // but not necessarily manage — for those pages FB withholds `access_token`
  // and rejects monetization queries with "missing administrative permission".
  // Per product decision: only persist pages the user truly manages
  // (= has an access_token after backfill). Unmanaged BM-only pages are
  // dropped here, and previously-stored entries for them are deleted so the
  // DB stays in sync with what's actually queryable.
  const managed = merged.filter((p) => !!p.access_token);
  const unmanagedIds = merged
    .filter((p) => !p.access_token)
    .map((p) => p.id);
  let removedCount = 0;
  if (unmanagedIds.length > 0) {
    const deleted = await db
      .delete(fanpages)
      .where(
        and(
          eq(fanpages.fbAccountId, finalOwnerId),
          inArray(fanpages.pageId, unmanagedIds),
        ),
      )
      .returning({ id: fanpages.id });
    removedCount = deleted.length;
  }
  emit({
    type: "step",
    step: "filter_managed",
    status: "ok",
    label: "Lọc page user thực sự quản lý",
    detail:
      `${managed.length} có quyền · ${unmanagedIds.length} chỉ có trong BM (bỏ qua)` +
      (removedCount > 0 ? ` · xóa ${removedCount} entry cũ` : ""),
    data: {
      managedCount: managed.length,
      unmanagedCount: unmanagedIds.length,
      removedCount,
    },
  });

  // Step 9 — save pages.
  const r9 = await runStep(
    "save_pages",
    `Lưu ${managed.length} fanpage vào database`,
    async () => {
      const out = await savePages(finalOwnerId, ownerUserId, managed, now);
      await db
        .update(facebookAccounts)
        .set({ lastSyncedAt: now, lastSyncError: null })
        .where(eq(facebookAccounts.id, finalOwnerId));
      return {
        data: { inserted: out.inserted, updated: out.updated },
        detail: `thêm ${out.inserted} · cập nhật ${out.updated}`,
        result: out,
      };
    },
  );
  if (!r9.ok) {
    emit({ type: "done", ok: false, error: r9.error });
    return;
  }

  emit({
    type: "done",
    ok: true,
    fbAccountId: finalOwnerId,
    pagesFound: managed.length,
    inserted: r9.result.inserted,
    updated: r9.result.updated,
  });
  // `debug` is kept for potential future log/audit; reference it to keep
  // strict-unused checks satisfied.
  void debug;
}

export async function POST(req: Request) {
  const ownerUserId = await getOwnerId();
  const body = await readBody<SyncBody>(req);

  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("application/x-ndjson")) {
    return runStreamFlow(body, ownerUserId);
  }
  return runJsonFlow(body, ownerUserId);
}
