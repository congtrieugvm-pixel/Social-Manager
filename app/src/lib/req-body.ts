// Universal body reader for opennextjs/Cloudflare Workers compatibility.
//
// The Worker runtime via @opennextjs/cloudflare wraps Request body methods
// through unenv's incomplete Node polyfill. EVERY body method
// (req.json/text/blob/arrayBuffer/formData/getReader) throws
// "[unenv] Readable.asyncIterator is not implemented yet!" before delivering
// the body. Until upstream fixes that, we route POST/PATCH bodies through
// the `X-Body` HTTP header instead — JSON-encoded payload that the polyfill
// has no opportunity to break.
//
// Server: call `readBody<T>(req)` instead of `req.json()`. Falls back to the
// real body when the header is absent (so local Node dev still works).
//
// Client: call `postJson(url, body)` / `patchJson(url, body)` instead of
// `fetch(url, { method, body: JSON.stringify(body) })`. Pairs with the
// server helper.

export async function readBody<T = unknown>(req: Request): Promise<T> {
  const header = req.headers.get("x-body");
  if (header !== null) {
    try {
      return JSON.parse(header) as T;
    } catch {
      return {} as T;
    }
  }
  // Fallback for environments where body parsing actually works (local Node).
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

/** Client helper for POST + JSON body via X-Body header. */
export async function postJson(
  url: string,
  body: unknown,
  init: Omit<RequestInit, "method" | "body"> = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    method: "POST",
    headers: {
      ...(init.headers ?? {}),
      "X-Body": JSON.stringify(body ?? {}),
    },
  });
}

/**
 * Safe response → JSON parser. CF Workers occasionally return an empty body
 * (timeout / kill / unhandled throw before the response is flushed). Bare
 * `await res.json()` then crashes with "Unexpected end of JSON input",
 * surfacing as an opaque error to the user. This helper:
 *   - reads the body as text (single consumption),
 *   - returns `{ error }` when body is empty or unparseable,
 *   - hints CF-timeout when the status code suggests it (502/504/524).
 */
export async function safeJson<T = unknown>(
  res: Response,
): Promise<T & { error?: string }> {
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Đọc response lỗi: ${msg}` } as T & { error?: string };
  }
  if (!text) {
    const looksLikeTimeout =
      res.status === 0 ||
      res.status === 502 ||
      res.status === 504 ||
      res.status === 524 ||
      res.status === 408;
    const hint = looksLikeTimeout
      ? "Server timeout (CF Workers ~30s) — chọn ít page hơn hoặc thử lại"
      : `Server không trả response (HTTP ${res.status || "?"})`;
    return { error: hint } as T & { error?: string };
  }
  try {
    return JSON.parse(text) as T & { error?: string };
  } catch {
    return {
      error: `Response không phải JSON (HTTP ${res.status}): ${text.slice(0, 120)}`,
    } as T & { error?: string };
  }
}

/** Client helper for PATCH + JSON body via X-Body header. */
export async function patchJson(
  url: string,
  body: unknown,
  init: Omit<RequestInit, "method" | "body"> = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    method: "PATCH",
    headers: {
      ...(init.headers ?? {}),
      "X-Body": JSON.stringify(body ?? {}),
    },
  });
}
