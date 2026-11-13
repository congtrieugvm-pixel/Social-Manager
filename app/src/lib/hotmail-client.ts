import { postJson } from "@/lib/req-body";

export interface HotmailCode {
  code: string; messageId: string; subject: string; from: string | null; receivedAt: string;
}
export type HotmailReply = Partial<HotmailCode> & {
  needsAuth?: boolean; error?: string; pending?: boolean; retryable?: boolean; retryAfterSeconds?: number;
};

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function pollHotmailCode(accountId: number, options: {
  signal: AbortSignal;
  previous?: Pick<HotmailCode, "messageId" | "receivedAt">;
  onWaiting: (secondsLeft: number, message?: string) => void;
}, dependencies = {
  now: () => Date.now(),
  sleep: abortableDelay,
  request: (id: number, body: unknown, signal: AbortSignal) => postJson(`/api/accounts/${id}/hotmail-code`, body, { signal }),
}): Promise<HotmailReply> {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(options.signal.reason);
  options.signal.addEventListener("abort", relayAbort, { once: true });
  if (options.signal.aborted) relayAbort();
  const deadline = dependencies.now() + 60_000;
  const timer = setTimeout(() => controller.abort(new Error("Hết thời gian chờ mã (60 giây). Hãy gửi lại mã rồi thử lại.")), 60_000);
  try {
    while (dependencies.now() < deadline) {
      controller.signal.throwIfAborted();
      let response: Response;
      try {
        response = await dependencies.request(accountId, options.previous ? {
          afterMessageId: options.previous.messageId, afterReceivedAt: options.previous.receivedAt,
        } : {}, controller.signal);
      } catch {
        controller.signal.throwIfAborted();
        options.onWaiting(Math.max(0, Math.ceil((deadline - dependencies.now()) / 1000)), "Mất kết nối, đang thử lại…");
        await dependencies.sleep(Math.min(3000, Math.max(0, deadline - dependencies.now())), controller.signal);
        continue;
      }
      const data = await response.json().catch(() => ({})) as HotmailReply;
      controller.signal.throwIfAborted();
      if (data.needsAuth) return data;
      if (response.ok && /^\d{6}$/.test(data.code ?? "") && data.messageId && data.receivedAt) return data;
      if (!data.pending && !data.retryable) throw new Error(data.error || `Không lấy được mã (HTTP ${response.status}).`);
      const seconds = Number(data.retryAfterSeconds);
      const delay = Number.isFinite(seconds) && seconds > 0 ? Math.max(1000, seconds * 1000) : 3000;
      const remaining = deadline - dependencies.now();
      if (delay >= remaining) throw new Error(data.error || "Chưa có mã mới trong 60 giây. Hãy gửi lại mã rồi thử lại.");
      options.onWaiting(Math.ceil(remaining / 1000), data.error);
      await dependencies.sleep(delay, controller.signal);
    }
    throw new Error("Chưa có mã mới trong 60 giây. Hãy gửi lại mã rồi thử lại.");
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", relayAbort);
  }
}
