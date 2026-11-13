export class MicrosoftError extends Error {
  constructor(
    message: string, public readonly code: string, public readonly status: number,
    public readonly retryAfterSeconds = 0,
  ) { super(message); this.name = "MicrosoftError"; }
}

export function requiresMicrosoftAuth(error: unknown): boolean {
  return error instanceof MicrosoftError &&
    ["invalid_grant", "interaction_required", "consent_required", "NO_TOKEN", "CLIENT_CHANGED"].includes(error.code);
}

export async function microsoftJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(8000) });
  } catch {
    throw new MicrosoftError("Microsoft chưa phản hồi. Đang chờ thử lại.", "temporarily_unavailable", 503, 3);
  }
  const data = await response.json().catch(() => null);
  if (response.ok && data) return data as T;
  const code = typeof data?.error === "string" ? data.error : data?.error?.code || "upstream_error";
  const retryHeader = response.headers.get("retry-after");
  const retryAfter = retryHeader && /^\d+$/.test(retryHeader)
    ? Number(retryHeader)
    : retryHeader ? Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000) : 0;
  let message = "Không đọc được email từ Microsoft. Hãy thử lại.";
  if (response.status === 429) message = "Microsoft đang giới hạn lượt đọc thư. Vui lòng chờ.";
  else if (["invalid_client", "unauthorized_client", "invalid_scope", "invalid_resource"].includes(code)) {
    message = "Cấu hình ứng dụng Microsoft chưa hợp lệ. Quản trị viên cần kiểm tra Client ID, secret và quyền Mail.Read.";
  } else if (response.status === 403) message = "Ứng dụng chưa có quyền đọc thư. Hãy kết nối Microsoft lại và cấp quyền Mail.Read.";
  else if (["invalid_grant", "interaction_required", "consent_required"].includes(code)) message = "Microsoft yêu cầu kết nối lại. Hãy bấm Get Token.";
  // Never expose upstream descriptions, which can contain private details.
  throw new MicrosoftError(message, code, response.ok ? 502 : response.status,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : response.status === 429 ? 5 : 0);
}
