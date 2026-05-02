# Fix: Fanpage token verification flow

Surgical fix — replace the cosmetic "bỏ qua (chưa cấu hình FB_APP_ID)" debug step with a real token-verification step that works without app credentials, parse Graph API subcodes so callers can act on them, and surface actionable Vietnamese messages in the UI. No DB schema changes, no new dependencies, no streaming protocol changes.

## Files touched

| File | Type of change |
|---|---|
| `app/src/lib/facebook.ts` | Add `parseGraphError`, `verifyTokenWithoutAppCreds`, `mapTokenErrorToVi`. Update `graphFetch` to attach the parsed error metadata. |
| `app/src/app/api/fanpages/sync/route.ts` | Replace the `isFacebookConfigured()` skip branch with a real `verify_token` step. Wrap `fetch_me` / `fetch_me_accounts` failures through `mapTokenErrorToVi`. Step ordering unchanged. |
| `app/src/app/fanpage/page.tsx` | Drop `debugSkipped` branch. Always render the token info block from data. Add new `requiredScopes`/`missingScopes` fields. Update step-name handling so existing `debug_token` event handler also accepts `verify_token`. |

## Step-by-step changes

### 1. `app/src/lib/facebook.ts` — error parsing + appless verification

Add new public types + helpers AFTER the existing `FbDebugTokenInfo` interface (around line 113):

```ts
// Graph API error metadata extracted from `error` payloads. Kept narrow:
// callers care about discrimination (expired? missing scope?), not the
// full FB error envelope.
export interface GraphErrorInfo {
  code: number | null;          // top-level FB error code
  subcode: number | null;       // error_subcode
  type: string | null;          // e.g. "OAuthException"
  message: string;              // scrubbed, ready to surface
  fbtraceId: string | null;
  // Convenience flags derived from code/subcode for downstream branching.
  kind:
    | "expired"        // subcode 463 / 467 — issue session, mostly 190
    | "invalid"        // 190 with subcode 458 / generic invalid token
    | "permission"    // code 10 / 200 — missing perms
    | "rate_limit"   // 4 / 17 / 32 / 613
    | "network"     // non-Graph fetch failure
    | "other";
}

export function parseGraphError(err: unknown): GraphErrorInfo {
  // Supports: Error objects with `.graph` populated by graphFetch, raw
  // `{error:{...}}` Graph payloads, or anything else (treated as network).
  const fallback: GraphErrorInfo = {
    code: null, subcode: null, type: null,
    message: err instanceof Error ? err.message : String(err),
    fbtraceId: null, kind: "network",
  };
  const graph =
    (err as { graph?: { code?: number; error_subcode?: number; type?: string;
              message?: string; fbtrace_id?: string } } | null)?.graph
    ?? (err as { error?: typeof graph }).error
    ?? null;
  if (!graph) return fallback;
  const code = typeof graph.code === "number" ? graph.code : null;
  const sub = typeof graph.error_subcode === "number" ? graph.error_subcode : null;
  const message = scrubGraphMessage(graph.message ?? fallback.message);
  let kind: GraphErrorInfo["kind"] = "other";
  if (sub === 463 || sub === 467) kind = "expired";
  else if (sub === 458 || code === 102 || code === 190) kind = "invalid";
  else if (code === 10 || code === 200 || code === 299) kind = "permission";
  else if (code === 4 || code === 17 || code === 32 || code === 613) kind = "rate_limit";
  return {
    code, subcode: sub, type: graph.type ?? null, message,
    fbtraceId: graph.fbtrace_id ?? null, kind,
  };
}
```

Update `graphFetch` (lines 60–73) so the thrown error carries the same metadata that callers will need (no behaviour change for existing callers — they already read `err.message`):

```ts
async function graphFetch<T>(pathAndQuery: string, accessToken: string): Promise<T> {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const url = `${GRAPH_BASE}${pathAndQuery}${sep}access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = data?.error?.message ?? `Graph API ${res.status} ${res.statusText}`;
    const err = new Error(scrubGraphMessage(String(raw)));
    (err as Error & { graph?: unknown; httpStatus?: number }).graph = data?.error;
    (err as Error & { httpStatus?: number }).httpStatus = res.status;
    throw err;
  }
  return data as T;
}
```

Add the appless verifier and the Vietnamese mapper. Place after `debugUserToken` (around line 140):

```ts
export interface AppLessVerifyResult {
  ok: true;
  userId: string;
  userName: string;
  scopes: string[];                  // granted scopes
  missingRequired: string[];         // pages_show_list at minimum
  missingRecommended: string[];      // pages_read_engagement, pages_manage_metadata
}
export interface AppLessVerifyFail {
  ok: false;
  error: GraphErrorInfo;
  step: "me" | "permissions";
}
export type AppLessVerify = AppLessVerifyResult | AppLessVerifyFail;

const REQUIRED_SCOPES = ["pages_show_list"] as const;
const RECOMMENDED_SCOPES = [
  "pages_read_engagement",
  "pages_manage_metadata",
] as const;

/**
 * Verifies a user access token WITHOUT requiring FB_APP_ID/FB_APP_SECRET.
 * Calls /me?fields=id,name + /me/permissions and inspects the result so we
 * can tell expired/invalid/missing-scope apart before hitting /me/accounts.
 */
export async function verifyTokenWithoutAppCreds(
  token: string,
): Promise<AppLessVerify> {
  let me: FbUser;
  try {
    me = await fetchMe(token);
  } catch (e) {
    return { ok: false, step: "me", error: parseGraphError(e) };
  }
  let perms: { data: Array<{ permission: string; status: string }> };
  try {
    perms = await graphFetch("/me/permissions", token);
  } catch (e) {
    return { ok: false, step: "permissions", error: parseGraphError(e) };
  }
  const granted = new Set(
    (perms.data ?? [])
      .filter((p) => p.status === "granted")
      .map((p) => p.permission),
  );
  const scopes = Array.from(granted).sort();
  const missingRequired = REQUIRED_SCOPES.filter((s) => !granted.has(s));
  const missingRecommended = RECOMMENDED_SCOPES.filter((s) => !granted.has(s));
  return {
    ok: true,
    userId: me.id,
    userName: me.name,
    scopes,
    missingRequired,
    missingRecommended,
  };
}

/**
 * Maps a parsed Graph error to a UI-friendly Vietnamese message. Used by
 * sync/route to give actionable feedback ("token hết hạn" vs "thiếu quyền").
 */
export function mapTokenErrorToVi(err: GraphErrorInfo): string {
  switch (err.kind) {
    case "expired":
      return "Token đã hết hạn. Vui lòng vào Graph API Explorer tạo token mới.";
    case "invalid":
      return "Token không hợp lệ hoặc đã bị thu hồi. Vui lòng dán token mới.";
    case "permission":
      return `Token thiếu quyền truy cập (${err.message}). Hãy cấp lại với scope pages_show_list, pages_read_engagement.`;
    case "rate_limit":
      return "Facebook đang giới hạn truy cập. Hãy thử lại sau ít phút.";
    case "network":
      return `Không gọi được Graph API: ${err.message}`;
    case "other":
    default:
      return `Lỗi Graph API${err.code ? ` (#${err.code}${err.subcode ? `/${err.subcode}` : ""})` : ""}: ${err.message}`;
  }
}
```

### 2. `app/src/app/api/fanpages/sync/route.ts` — replace the skip branch

Update imports (line 6–20):

```ts
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
```

Replace the `else { emit(... skipped ...) }` block (lines 412–420) with a real verification step. New behaviour: when FB_APP_ID is configured, run debug_token (existing path); otherwise run `verify_token`. Both populate enough data for the UI.

```ts
  // Step 1 — token verification. Two paths:
  //   • FB_APP_ID configured  → /debug_token (rich data: app, expiry).
  //   • Otherwise             → /me + /me/permissions (validity, scopes).
  let debug: FbDebugTokenInfo | null = null;
  if (isFacebookConfigured()) {
    /* … existing debug_token block unchanged … */
  } else {
    const r1 = await runStep(
      "verify_token",
      "Xác thực token (Graph /me + /me/permissions)",
      async () => {
        const v = await verifyTokenWithoutAppCreds(token);
        if (!v.ok) {
          // Throw with attached error so runStep emits an `error` event, then
          // the caller below short-circuits with a Vietnamese message.
          const e = new Error(mapTokenErrorToVi(v.error));
          (e as Error & { graphInfo?: unknown }).graphInfo = v.error;
          throw e;
        }
        return {
          data: {
            isValid: true,
            userId: v.userId,
            fbName: v.userName,
            scopes: v.scopes,
            missingRequired: v.missingRequired,
            missingRecommended: v.missingRecommended,
          },
          detail:
            `valid · user=${v.userName} (${v.userId}) · ` +
            `scopes=${v.scopes.length}` +
            (v.missingRequired.length
              ? ` · THIẾU ${v.missingRequired.join(",")}`
              : "") +
            (v.missingRecommended.length
              ? ` · nên có thêm ${v.missingRecommended.join(",")}`
              : ""),
          result: v,
        };
      },
    );
    if (!r1.ok) {
      emit({ type: "done", ok: false, error: r1.error });
      return;
    }
    if (r1.result.missingRequired.length > 0) {
      emit({
        type: "done",
        ok: false,
        error:
          `Token thiếu quyền bắt buộc: ${r1.result.missingRequired.join(", ")}. ` +
          `Hãy cấp lại token với các scope này.`,
      });
      return;
    }
  }
```

Wrap the `fetch_me` and `fetch_me_accounts` failure surfacing through `mapTokenErrorToVi` so the user sees a Vietnamese message instead of raw text. Update `runStep` invocations at lines ~441–444 and 497–500 — only the failure branch:

```ts
  if (!r2.ok) {
    const info = parseGraphError(new Error(r2.error));
    emit({ type: "done", ok: false, error: mapTokenErrorToVi(info) });
    return;
  }
```

(Same pattern at line 498 for `r4`.)

Note: `parseGraphError` falls back gracefully when only an Error string is available — kind becomes `"network"` and message is preserved. This keeps the change minimal without requiring `runStep` to forward the original Error object.

If a tighter mapping is preferred, change `runStep`'s catch to keep a reference to the thrown Error and stash it on the result:

```ts
return { ok: false, error: msg, cause: e };
```

then read `cause` in the caller. Either approach works; the simpler string-only path is recommended for the surgical fix.

### 3. `app/src/app/fanpage/page.tsx` — UI updates

#### 3a. `TokenInfo` interface (line 125–139)

Drop `debugSkipped` and add scope-presence fields:

```ts
interface TokenInfo {
  preview?: string;
  length?: number;
  source?: "direct" | "stored";
  isValid?: boolean;
  appId?: string | null;
  application?: string | null;
  userId?: string | null;
  type?: string | null;
  expiresAt?: number | null;
  scopes?: string[];
  missingRequired?: string[];
  missingRecommended?: string[];
  fbName?: string | null;
  fbProfilePic?: string | null;
}
```

#### 3b. Event handler (lines ~324–347)

Accept both `debug_token` and `verify_token` step names. Replace the existing block:

```ts
if (
  (e.step === "debug_token" || e.step === "verify_token") &&
  e.status === "ok" &&
  e.data
) {
  const d = e.data as {
    isValid?: boolean;
    appId?: string | null;
    application?: string | null;
    userId?: string | null;
    type?: string | null;
    expiresAt?: number | null;
    scopes?: string[];
    missingRequired?: string[];
    missingRecommended?: string[];
    fbName?: string | null;
  };
  setTokenInfo((prev) => ({
    ...(prev ?? {}),
    isValid: d.isValid,
    appId: d.appId ?? null,
    application: d.application ?? null,
    userId: d.userId ?? prev?.userId ?? null,
    type: d.type ?? null,
    expiresAt: d.expiresAt ?? null,
    scopes: d.scopes ?? prev?.scopes ?? [],
    missingRequired: d.missingRequired ?? [],
    missingRecommended: d.missingRecommended ?? [],
    fbName: d.fbName ?? prev?.fbName ?? null,
  }));
}
```

Delete the `e.step === "debug_token" && e.status === "skipped"` branch (lines 345–347) entirely — verification is no longer skipped.

#### 3c. Render (lines ~1573–1639)

Drop the `tokenInfo.debugSkipped ? … : …` ternary. Always render the inner block. Add a new "Quyền thiếu" row when `missingRequired.length > 0` or `missingRecommended.length > 0`. Insert before the existing `tokenInfo.scopes` block (~line 1659):

```tsx
{tokenInfo.missingRequired && tokenInfo.missingRequired.length > 0 && (
  <>
    <dt style={{ color: "var(--accent)" }}>Thiếu (bắt buộc)</dt>
    <dd className="mono" style={{ margin: 0, color: "var(--accent)", fontSize: 10 }}>
      {tokenInfo.missingRequired.join(", ")}
    </dd>
  </>
)}
{tokenInfo.missingRecommended && tokenInfo.missingRecommended.length > 0 && (
  <>
    <dt style={{ color: "var(--muted)" }}>Nên có thêm</dt>
    <dd className="mono" style={{ margin: 0, fontSize: 10 }}>
      {tokenInfo.missingRecommended.join(", ")}
    </dd>
  </>
)}
```

The "App"/"Type"/"Hết hạn" rows continue to render only when their values are present (already guarded with `&&`), so they will simply be hidden in the appless path — no extra logic needed.

## Error code → Vietnamese message mapping

| FB code | FB subcode | `kind` | UI message (Vietnamese) |
|---|---|---|---|
| 190 | 458 | invalid | Token không hợp lệ hoặc đã bị thu hồi. Vui lòng dán token mới. |
| 190 | 463 | expired | Token đã hết hạn. Vui lòng vào Graph API Explorer tạo token mới. |
| 190 | 467 | expired | Token đã hết hạn. Vui lòng vào Graph API Explorer tạo token mới. |
| 190 | (other) | invalid | Token không hợp lệ hoặc đã bị thu hồi. Vui lòng dán token mới. |
| 102 | — | invalid | Token không hợp lệ hoặc đã bị thu hồi. Vui lòng dán token mới. |
| 10 | — | permission | Token thiếu quyền truy cập (`{message}`). Hãy cấp lại với scope `pages_show_list`, `pages_read_engagement`. |
| 200 | — | permission | (same as 10) |
| 299 | — | permission | (same as 10) |
| 4 / 17 / 32 / 613 | — | rate_limit | Facebook đang giới hạn truy cập. Hãy thử lại sau ít phút. |
| (no graph payload) | — | network | Không gọi được Graph API: `{message}`. |
| anything else | — | other | Lỗi Graph API (#code/subcode): `{message}`. |

Note: `pages_show_list` is the only **required** scope for `/me/accounts` to return any pages. `pages_read_engagement` and `pages_manage_metadata` are **recommended** so insights and per-page tokens are usable downstream — their absence is informational, not blocking.

## Test cases (for the tester subagent)

Unit tests in `app/src/lib/facebook.test.ts` (or co-located, follow existing convention):

1. `parseGraphError` — Error with `.graph={code:190,error_subcode:463}` → `kind:"expired"`.
2. `parseGraphError` — Error with `.graph={code:10}` → `kind:"permission"`.
3. `parseGraphError` — plain Error (no `.graph`) → `kind:"network"`, message preserved.
4. `parseGraphError` — Error with `.graph.code:4` → `kind:"rate_limit"`.
5. `mapTokenErrorToVi` — each `kind` returns expected Vietnamese substring (`hết hạn`, `không hợp lệ`, `thiếu quyền`, `giới hạn`, `Graph API`).
6. `verifyTokenWithoutAppCreds` — mock `fetch` so `/me` 200s and `/me/permissions` returns granted `pages_show_list` only → `missingRequired:[]`, `missingRecommended:["pages_read_engagement","pages_manage_metadata"]`.
7. `verifyTokenWithoutAppCreds` — mock `/me` returns 400 with `{error:{code:190,error_subcode:463}}` → `ok:false, step:"me", error.kind:"expired"`.
8. `verifyTokenWithoutAppCreds` — mock `/me` ok, `/me/permissions` returns no `pages_show_list` → `missingRequired:["pages_show_list"]`.

Integration test (route handler):

9. POST to `/api/fanpages/sync` with NDJSON Accept and a token, with FB_APP_ID unset → first non-init event has `step: "verify_token"` and `status: "ok"|"error"`, never `"skipped"`.
10. POST with token returning 463 from `/me` → final `done` event has `ok:false` and `error` containing `"hết hạn"`.
11. POST with token missing `pages_show_list` → final `done` event has `ok:false` and `error` containing `"thiếu quyền bắt buộc"`.

UI test (manual, screenshot-based):

12. With FB_APP_ID unset, paste a valid token → "Debug" row no longer reads "bỏ qua"; instead shows valid status + scope summary.
13. Token missing `pages_show_list` → red "Thiếu (bắt buộc)" row appears; sync stops with toast.

## Constraints honored

- **YAGNI**: only adds two functions + one type. No registry, no factory, no error class hierarchy.
- **KISS**: kind is a flat enum; mapping is a switch.
- **DRY**: `mapTokenErrorToVi` centralises the Vietnamese strings; both the route and any future caller use it.
- **No new deps**, **no DB changes**, **no streaming protocol changes** (existing `step` events, just a new step name).
- **Next.js 16 compliant**: route handler signature, `Response`/`NextResponse` usage, and `runtime = "nodejs"` directive are all preserved untouched. NDJSON streaming via `ReadableStream` is unchanged.

## Estimated effort

30–45 minutes for an implementer:
- 10 min: `facebook.ts` additions + `graphFetch` tweak.
- 10 min: route step swap + error wrapping at two failure sites.
- 10 min: UI interface, handler, render diff.
- 5–15 min: test plumbing (depends on existing test infra).

## Unresolved questions

1. Is there an existing test runner / harness in this project? (Not visible in `package.json` from the file listing — the implementer should confirm before adding the unit tests above. If absent, the integration tests can be done via curl + manual screenshot.)
2. Should the route also call `verifyTokenWithoutAppCreds` in addition to `debug_token` when FB_APP_ID is configured, to surface scope gaps? Currently `debug_token` returns scopes but not the granted/declined distinction in all cases — out of scope for this fix; flag for follow-up.
3. The `cause` carry-through in `runStep` (mentioned as an alternative in §2) is a small refactor that would let `mapTokenErrorToVi` see the original `.graph` payload at `fetch_me`/`fetch_me_accounts` failure sites. The current plan uses string-only fallback (kind=`"network"`). If product wants exact subcode-driven messages at those sites too, do the `cause` change in the same PR.
