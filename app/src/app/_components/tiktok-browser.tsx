"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { EyeOff, Loader2, Monitor, Play, Square } from "lucide-react";
import { postJson, safeJson } from "@/lib/req-body";
import { confirmDialog, notify } from "./notify";

// Browser actions for the TikTok accounts table: open the account's Camoufox
// window on a connected Windows machine, close it, or "Ẩn bài" (switch every
// public post to Only me). Setup — proxies, machines, history — stays on /browser.

type Kind = "open" | "close" | "hide";
interface Device { id: string; name: string; version: string; lastSeenAt: number }
interface Profile { accountId: number; deviceId: string; status: string; updatedAt: number }
interface Job { id: string; kind: string; accountId: number | null; state: string; error: string | null; result: string | null; createdAt: number }
interface State { now: number; owner: number; devices: Device[]; profiles: Profile[]; jobs: Job[] }
interface HideResult { changed: number; skipped: number; message: string; status: string | null }

const ACTIVE = ["queued", "claimed", "running"];
const OPEN_STATUSES = ["starting", "open", "needs_verification", "unverified", "logged_in", "wrong_account"];
const STATUS_LABEL: Record<string, string> = {
  starting: "Đang mở trình duyệt", open: "Đã mở", needs_verification: "Cần xác minh", unverified: "Chưa xác minh tài khoản",
  logged_in: "Đã đăng nhập", wrong_account: "Nhầm tài khoản",
};
const ERROR_TEXT: Record<string, string> = {
  HIDE_MANUAL: "Chưa vào được TikTok Studio đúng tài khoản — kiểm tra cửa sổ rồi chạy lại",
  HIDE_FAILED: "Chưa ẩn hết bài — chạy lại, bài đã riêng tư sẽ được bỏ qua",
  CLOSED: "Cửa sổ bị đóng trước khi xong", INTERRUPTED: "Đã dừng giữa chừng", CONFIG_CHANGED: "Cấu hình đổi — gửi lại lệnh",
  PROFILE_BUSY: "Hồ sơ đang bận hoặc còn khóa", PROXY_FAILED: "Proxy lỗi trên máy Windows", BROWSER_FAILED: "Không mở được trình duyệt",
};
const KIND_TEXT: Record<Kind, string> = { open: "mở trình duyệt", close: "đóng trình duyệt", hide: "ẩn bài" };

const versionAtLeast = (v: string, min: [number, number, number]) => {
  if (!/^\d+\.\d+\.\d+$/.test(v)) return false;
  const p = v.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (p[i] !== min[i]) return p[i] > min[i];
  return true;
};
function parseHide(job?: Job): HideResult | null {
  if (!job?.result) return null;
  try { return JSON.parse(job.result) as HideResult; } catch { return null; }
}

export interface AccountBrowserView {
  tone: "good" | "warn" | "danger" | "neutral";
  label: string;
  detail?: string;
  busy: boolean;
  hasWindow: boolean;
  hiding: boolean;
  /** Jobs the machine has not picked up yet; "Đóng" cancels them instead of closing a window. */
  pendingJobIds: string[];
}

/** One poll for the whole table. Fast while something is moving, slow when idle, paused in background tabs. */
export function useTikTokBrowser(usernames: (id: number) => string | undefined) {
  const [state, setState] = useState<State | null>(null);
  const [deviceId, setDeviceIdState] = useState("");
  const [sending, setSending] = useState<Kind | null>(null);
  const picked = useRef(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/browser/state", { cache: "no-store" });
    if (!res.ok) return;
    const data = await safeJson<State>(res);
    if (data.error) return;
    setState(data);
    if (!picked.current) {
      const online = data.devices.filter((d) => d.lastSeenAt >= data.now - 60);
      let saved: string | null = null;
      try { saved = localStorage.getItem(`browser-device-${data.owner}`); } catch { /* storage blocked */ }
      const choice = data.devices.find((d) => d.id === saved)?.id ?? (online.length === 1 ? online[0].id : "");
      if (choice) { picked.current = true; setDeviceIdState(choice); }
    }
  }, []);

  const moving = !!state && (state.jobs.some((j) => ACTIVE.includes(j.state)) || state.profiles.some((p) => p.status === "starting"));
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!live) return;
      if (!document.hidden) await refresh().catch(() => {});
      if (live) timer = setTimeout(tick, moving ? 3000 : 15000);
    };
    void tick();
    return () => { live = false; clearTimeout(timer); };
  }, [refresh, moving]);

  const setDeviceId = useCallback((id: string) => {
    picked.current = true;
    setDeviceIdState(id);
    if (state) try { localStorage.setItem(`browser-device-${state.owner}`, id); } catch { /* storage blocked */ }
  }, [state]);

  const online = useMemo(() => state?.devices.filter((d) => d.lastSeenAt >= state.now - 60) ?? [], [state]);
  const device = online.find((d) => d.id === deviceId) ?? null;

  const views = useMemo(() => {
    const map = new Map<number, AccountBrowserView>();
    if (!state) return map;
    const profiles = new Map(state.profiles.map((p) => [p.accountId, p]));
    const latest = new Map<string, Job>(); // newest job per account+kind (jobs come newest first)
    // Cancelled/expired jobs never ran: keep showing the last real outcome instead.
    for (const j of state.jobs) if (j.accountId != null && !["cancelled", "expired"].includes(j.state) && !latest.has(`${j.accountId}:${j.kind}`)) latest.set(`${j.accountId}:${j.kind}`, j);
    const ids = new Set<number>([...profiles.keys(), ...state.jobs.map((j) => j.accountId).filter((v): v is number => v != null)]);
    for (const id of ids) {
      const profile = profiles.get(id);
      const hide = latest.get(`${id}:hide`);
      const open = latest.get(`${id}:open`);
      const hideActive = !!hide && ACTIVE.includes(hide.state);
      const hasWindow = !!profile && OPEN_STATUSES.includes(profile.status);
      const r = parseHide(hide);
      const pendingJobIds = state.jobs.filter((j) => j.accountId === id && ["queued", "claimed"].includes(j.state) && j.kind !== "close").map((j) => j.id);
      let view: AccountBrowserView | null = null;
      if (hideActive) {
        view = { tone: "warn", busy: true, hasWindow, hiding: true, pendingJobIds,
          label: hide!.state === "running" ? (r ? `Đang ẩn bài · ${r.changed} đã ẩn` : "Đang ẩn bài") : "Chờ máy ẩn bài",
          detail: r?.message || "Máy Windows rảnh có thể mất 15 giây để nhận lệnh" };
      } else if (open && ["queued", "claimed"].includes(open.state)) {
        view = { tone: "warn", busy: true, hasWindow, hiding: false, pendingJobIds, label: "Chờ máy mở trình duyệt" };
      } else if (hasWindow) {
        view = { tone: profile!.status === "logged_in" ? "good" : profile!.status === "starting" ? "warn" : "danger", busy: profile!.status === "starting",
          hasWindow, hiding: false, pendingJobIds, label: STATUS_LABEL[profile!.status] ?? profile!.status,
          detail: profile!.status === "needs_verification" ? "Hoàn tất CAPTCHA/OTP trong cửa sổ trình duyệt" : undefined };
      } else if (hide && r) {
        view = hide.state === "done"
          ? { tone: "good", busy: false, hasWindow, hiding: false, pendingJobIds, label: `Đã ẩn bài · ${r.changed} bài`, detail: `${r.skipped} bài vốn đã riêng tư` }
          : { tone: "danger", busy: false, hasWindow, hiding: false, pendingJobIds, label: "Ẩn bài chưa xong", detail: (hide.error && ERROR_TEXT[hide.error]) || r.message };
      } else if (hide && hide.state === "error") {
        view = { tone: "danger", busy: false, hasWindow, hiding: false, pendingJobIds, label: "Ẩn bài lỗi", detail: (hide.error && ERROR_TEXT[hide.error]) || undefined };
      }
      if (view) map.set(id, view);
    }
    return map;
  }, [state]);

  /** Queue a job for each account (20 per request, as the server allows). */
  const run = useCallback(async (kind: Kind, ids: number[]) => {
    if (!ids.length || sending) return;
    if (!device) { notify.warn("Chưa có máy Windows online. Mở chương trình trên máy Windows rồi thử lại."); return; }
    let targets = ids;
    let cancelled = 0;
    if (kind === "close") {
      // Not picked up yet → cancel the queued job; a window that exists (or a running hide) → close it.
      const pending = ids.flatMap((id) => views.get(id)?.pendingJobIds ?? []);
      targets = ids.filter((id) => { const v = views.get(id); return !!v && (v.hasWindow || (v.hiding && !v.pendingJobIds.length)); });
      if (!targets.length && !pending.length) { notify.info("Các tài khoản đã chọn không có cửa sổ hay lệnh nào đang chạy."); return; }
      setSending(kind);
      try {
        for (const id of pending) {
          const res = await postJson("/api/browser/jobs/cancel", { id });
          if (res.ok) cancelled++;
        }
      } finally { setSending(null); }
      if (cancelled) notify.success(`Đã hủy ${cancelled} lệnh chưa chạy.`);
      if (!targets.length) { await refresh().catch(() => {}); return; }
    }
    if (kind === "hide") {
      if (!versionAtLeast(device.version, [1, 0, 4])) { notify.warn("Cập nhật chương trình Windows lên 1.0.4 để dùng Ẩn bài."); return; }
      const who = targets.length === 1 ? `@${usernames(targets[0]) ?? targets[0]}` : `${targets.length} tài khoản`;
      const ok = await confirmDialog({
        title: "Ẩn bài sang Chỉ mình tôi",
        message: `Máy ${device.name} sẽ mở TikTok Studio và chuyển TOÀN BỘ bài công khai của ${who} sang Chỉ mình tôi. Bài đã riêng tư giữ nguyên. Bấm “Đóng” để dừng giữa chừng.`,
        confirmLabel: "Ẩn bài",
      });
      if (!ok) return;
    }
    setSending(kind);
    const failed: string[] = [];
    let sent = 0;
    try {
      for (let i = 0; i < targets.length; i += 20) {
        const chunk = targets.slice(i, i + 20);
        const res = await postJson("/api/browser/jobs", { kind, ids: chunk, deviceId: device.id, autofill: true });
        const data = await safeJson<{ results: { id: number; ok: boolean; error?: string }[] }>(res);
        if (data.error) { failed.push(data.error); continue; }
        for (const r of data.results) r.ok ? sent++ : failed.push(`@${usernames(r.id) ?? r.id}: ${r.error}`);
      }
    } finally {
      setSending(null);
    }
    if (sent) notify.success(`Đã gửi lệnh ${KIND_TEXT[kind]} cho ${sent} tài khoản${kind === "close" ? "" : ". Máy rảnh có thể mất 15 giây để nhận"}.`);
    if (failed.length) notify.error(failed.slice(0, 3).join(" · ") + (failed.length > 3 ? ` · và ${failed.length - 3} lỗi khác` : ""));
    await refresh().catch(() => {});
  }, [device, sending, usernames, views, refresh]);

  return { state, online, device, deviceId, setDeviceId, views, run, sending };
}
export type TikTokBrowser = ReturnType<typeof useTikTokBrowser>;

/** Selection-bar group: machine picker + Mở / Ẩn bài / Đóng. */
export function BrowserBulkActions({ browser, ids }: { browser: TikTokBrowser; ids: number[] }) {
  const { state, online, device, deviceId, setDeviceId, run, sending } = browser;
  const noMachine = !!state && !online.length;
  const reason = !state ? "Đang tải trạng thái máy Windows…" : noMachine ? "Chưa có máy Windows online" : !device ? "Chọn máy Windows" : "";
  const busy = (k: Kind) => sending === k;
  return (
    <div className="tb-actions" role="group" aria-label="Trình duyệt TikTok">
      {noMachine ? (
        <Link href="/browser" className="tb-device offline" title="Mở Cài đặt trình duyệt để kết nối máy Windows">
          <Monitor size={14} aria-hidden="true" /> Chưa có máy online
        </Link>
      ) : online.length > 1 || (deviceId && !device) ? (
        <label className="tb-device">
          <span className={`tb-dot${device ? " on" : ""}`} aria-hidden="true" />
          <select aria-label="Máy Windows chạy trình duyệt" value={device ? deviceId : ""} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Chọn máy…</option>
            {online.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      ) : device ? (
        <span className="tb-device" title={`Windows · v${device.version}`}>
          <span className="tb-dot on" aria-hidden="true" />{device.name}
        </span>
      ) : null}
      <button className="btn" disabled={!!reason || !!sending} title={reason || "Mở cửa sổ TikTok của các tài khoản đã chọn"} onClick={() => void run("open", ids)}>
        {busy("open") ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}Mở trình duyệt
      </button>
      <button className="btn" disabled={!!reason || !!sending} title={reason || "Chuyển toàn bộ bài công khai sang Chỉ mình tôi"} onClick={() => void run("hide", ids)}>
        {busy("hide") ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}Ẩn bài
      </button>
      <button className="btn btn-quiet" disabled={!!reason || !!sending} title={reason || "Đóng cửa sổ (dừng ẩn bài nếu đang chạy)"} onClick={() => void run("close", ids)}>
        {busy("close") ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}Đóng
      </button>
    </div>
  );
}

/** Compact status under the username; renders nothing when the account never used the browser. */
export function BrowserRowStatus({ view }: { view?: AccountBrowserView }) {
  if (!view) return null;
  return (
    <span className={`tb-status ${view.tone}`} title={view.detail} role="status">
      {view.busy ? <Loader2 size={11} className="spin" aria-hidden="true" /> : view.hiding || view.label.startsWith("Đã ẩn") || view.label.startsWith("Ẩn bài") ? <EyeOff size={11} aria-hidden="true" /> : <span className="tb-dot on" aria-hidden="true" />}
      {view.label}
    </span>
  );
}

/** Items for the row context menu. */
export function BrowserMenuItems({ browser, id, onDone }: { browser: TikTokBrowser; id: number; onDone: () => void }) {
  const { device, run, sending, views } = browser;
  const view = views.get(id);
  const disabled = !device || !!sending;
  const hint = !device ? "Chưa chọn máy Windows online" : undefined;
  const item = (kind: Kind, label: string, icon: React.ReactNode, off = false) => (
    <button type="button" role="menuitem" className="menu-item tb-menu-item" disabled={disabled || off} title={hint}
      onClick={() => { onDone(); void run(kind, [id]); }}>
      {icon}{label}
    </button>
  );
  return (
    <div className="tb-menu" role="group" aria-label="Trình duyệt TikTok">
      <div className="tb-menu-head">Trình duyệt TikTok{device ? ` · ${device.name}` : ""}</div>
      {item("open", view?.hasWindow ? "Trình duyệt đang mở" : "Mở trình duyệt", <Play size={14} aria-hidden="true" />, !!view?.hasWindow)}
      {item("hide", view?.hiding ? "Đang ẩn bài…" : "Ẩn bài (Chỉ mình tôi)", <EyeOff size={14} aria-hidden="true" />, !!view?.hiding)}
      {item("close", "Đóng trình duyệt", <Square size={13} aria-hidden="true" />, !view?.hasWindow && !view?.hiding)}
    </div>
  );
}
