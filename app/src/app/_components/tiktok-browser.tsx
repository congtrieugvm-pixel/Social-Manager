"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Clapperboard, EyeOff, Globe, Loader2, Monitor, Play, Send, Square } from "lucide-react";
import { postJson, safeJson } from "@/lib/req-body";
import { confirmDialog, notify } from "./notify";
import { PostDialog } from "./post-dialog";

// Browser actions for the TikTok accounts table: open the account's Camoufox
// window on a connected Windows machine, close it, or "Ẩn bài" (switch every
// public post to Only me). Setup — proxies, machines, history — stays on /browser.

type Kind = "open" | "close" | "hide" | "feed" | "post";
interface Device { id: string; name: string; version: string; lastSeenAt: number }
/** loggedInAt: when this profile last signed in to TikTok (null = no saved login). */
interface Profile { accountId: number; deviceId: string; status: string; updatedAt: number; loggedInAt?: number | null }
interface Job { id: string; kind: string; accountId: number | null; state: string; error: string | null; result: string | null; createdAt: number }
interface Proxy { id: number; name: string; enabled: number }
interface State { now: number; owner: number; devices: Device[]; profiles: Profile[]; jobs: Job[]; proxies?: Proxy[] }
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
  POST_MANUAL: "Chưa đăng nhập được hoặc không vào được trang đăng bài — mở trình duyệt kiểm tra rồi đăng lại",
  POST_UNKNOWN: "Đã bấm Đăng nhưng chưa thấy TikTok xác nhận — kiểm tra trang cá nhân trước khi đăng lại",
  POST_SCHEDULE_MANUAL: "Không đặt được giờ lên lịch — đã dừng để không đăng sai giờ",
  FOLDER_EMPTY: "Thư mục đã hết video chưa đăng", FOLDER_INVALID: "Không tìm thấy thư mục trên máy Windows",
  UPLOAD_FAILED: "TikTok tải video lên không được (đã tự thử lại) hoặc quá chậm — thường do mạng/proxy; video được trả lại hàng chờ để đăng lần sau",
};
const KIND_TEXT: Record<Kind, string> = { open: "mở trình duyệt", close: "đóng trình duyệt", hide: "ẩn bài", feed: "lướt feed", post: "đăng bài" };
interface PostResult { posted: number; total: number; error?: string }
function parsePost(job?: Job): PostResult | null {
  if (!job?.result) return null;
  try { return JSON.parse(job.result) as PostResult; } catch { return null; }
}

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
interface FeedResult { watched: number; liked: number; message: string; status: string | null }
function parseFeed(job?: Job): FeedResult | null {
  if (!job?.result) return null;
  try { return JSON.parse(job.result) as FeedResult; } catch { return null; }
}

export interface AccountBrowserView {
  tone: "good" | "warn" | "danger" | "neutral";
  label: string;
  detail?: string;
  busy: boolean;
  hasWindow: boolean;
  hiding: boolean;
  feeding?: boolean;
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
      const feed = latest.get(`${id}:feed`);
      const feedActive = !!feed && ACTIVE.includes(feed.state);
      const post = latest.get(`${id}:post`);
      const postActive = !!post && ACTIVE.includes(post.state);
      const pr = parsePost(post);
      const fr = parseFeed(feed);
      const hideActive = !!hide && ACTIVE.includes(hide.state);
      const hasWindow = !!profile && OPEN_STATUSES.includes(profile.status);
      const r = parseHide(hide);
      const pendingJobIds = state.jobs.filter((j) => j.accountId === id && ["queued", "claimed"].includes(j.state) && j.kind !== "close").map((j) => j.id);
      let view: AccountBrowserView | null = null;
      if (feedActive) {
        view = { tone: "warn", busy: true, hasWindow, hiding: false, feeding: true, pendingJobIds,
          label: feed!.state === "running" ? (fr ? `Đang lướt feed · ${fr.watched} xem, ${fr.liked} tim` : "Đang lướt feed") : "Chờ máy lướt feed",
          detail: fr?.message || "Máy Windows rảnh có thể mất 15 giây để nhận lệnh" };
      } else if (hideActive) {
        view = { tone: "warn", busy: true, hasWindow, hiding: true, pendingJobIds,
          label: hide!.state === "running" ? (r ? `Đang ẩn bài · ${r.changed} đã ẩn` : "Đang ẩn bài") : "Chờ máy ẩn bài",
          detail: r?.message || "Máy Windows rảnh có thể mất 15 giây để nhận lệnh" };
      } else if (postActive) {
        view = { tone: "warn", busy: true, hasWindow, hiding: false, pendingJobIds,
          label: post!.state === "running" ? "Đang đăng bài" : "Chờ máy đăng bài",
          detail: post!.state === "running" ? "Máy Windows đang mở trình duyệt và đăng video" : "Máy rảnh có thể mất 15 giây để nhận lệnh" };
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
      } else if (post && post.state === "done") {
        const full = !pr || pr.posted >= pr.total;
        view = { tone: full ? "good" : "warn", busy: false, hasWindow, hiding: false, pendingJobIds,
          label: pr ? `Đã đăng ${pr.posted}/${pr.total} bài` : "Đã đăng bài",
          detail: !full && pr?.error ? `Dừng sớm: ${ERROR_TEXT[pr.error] ?? pr.error}` : undefined };
      } else if (post && post.state === "error") {
        view = { tone: "danger", busy: false, hasWindow, hiding: false, pendingJobIds, label: "Đăng bài lỗi", detail: (post.error && ERROR_TEXT[post.error]) || undefined };
      }
      if (view) map.set(id, view);
    }
    return map;
  }, [state]);

  /** Queue a job for each account (20 per request, as the server allows). */
  const run = useCallback(async (kind: Kind, ids: number[], extra: Record<string, unknown> = {}) => {
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
    if (kind === "feed") {
      if (!versionAtLeast(device.version, [1, 0, 12])) { notify.warn("Cập nhật chương trình Windows lên 1.0.12 để dùng Lướt feed."); return; }
      const who = targets.length === 1 ? `@${usernames(targets[0]) ?? targets[0]}` : `${targets.length} tài khoản`;
      const minutes = Math.round((Number(extra.durationMs) || 5 * 60 * 1000) / 60000);
      const ok = await confirmDialog({
        title: "Lướt feed như người thật",
        message: `Máy ${device.name} sẽ mở For You của ${who} và tự lướt ~${minutes} phút: xem video theo nhịp người thật, thỉnh thoảng thả tim, con trỏ chuột di chuyển trên trình duyệt. Bấm “Đóng” để dừng.`,
        confirmLabel: "Bắt đầu lướt",
      });
      if (!ok) return;
    }
    if (kind === "post" && !versionAtLeast(device.version, [1, 0, 17])) { notify.warn("Cập nhật chương trình Windows lên 1.0.17 để đăng bài tự mở trình duyệt."); return; }
    setSending(kind);
    const failed: string[] = [];
    let sent = 0;
    try {
      for (let i = 0; i < targets.length; i += 20) {
        const chunk = targets.slice(i, i + 20);
        const body = { kind, ids: chunk, deviceId: device.id, autofill: true, ...extra };
        let res = await postJson("/api/browser/jobs", body);
        // Cloudflare may stop a request that runs over the Free plan's CPU limit (HTML 502/503).
        // The server only writes jobs at the very end and de-duplicates them, so one retry is safe.
        if (res.status === 502 || res.status === 503) { await new Promise((r) => setTimeout(r, 1500)); res = await postJson("/api/browser/jobs", body); }
        const data = await safeJson<{ results: { id: number; ok: boolean; error?: string }[] }>(res);
        if (data.error) { failed.push(data.error); continue; }
        for (const r of data.results) r.ok ? sent++ : failed.push(`@${usernames(r.id) ?? r.id}: ${r.error}`);
      }
    } finally {
      setSending(null);
    }
    if (sent) notify.success(kind === "post"
      ? `Đã gửi lệnh đăng bài cho ${sent} tài khoản. Máy sẽ tự mở trình duyệt (dùng đăng nhập đã lưu), đăng rồi đóng lại.`
      : `Đã gửi lệnh ${KIND_TEXT[kind]} cho ${sent} tài khoản${kind === "close" ? "" : ". Máy rảnh có thể mất 15 giây để nhận"}.`);
    if (failed.length) notify.error(failed.slice(0, 3).join(" · ") + (failed.length > 3 ? ` · và ${failed.length - 3} lỗi khác` : ""));
    await refresh().catch(() => {});
  }, [device, sending, usernames, views, refresh]);

  /** Each account's browser profile (if it ever had one), for the icon next to the username. */
  const profiles = useMemo(() => new Map((state?.profiles ?? []).map((p) => [p.accountId, p])), [state]);

  return { state, online, device, deviceId, setDeviceId, views, profiles, run, sending };
}
export type TikTokBrowser = ReturnType<typeof useTikTokBrowser>;

/** Selection-bar group: machine picker + Mở / Đăng bài / Ẩn bài / Lướt feed / Đóng. */
export function BrowserBulkActions({ browser, ids }: { browser: TikTokBrowser; ids: number[] }) {
  const { state, online, device, deviceId, setDeviceId, run, sending } = browser;
  const [feedMin, setFeedMin] = useState(5);
  const [posting, setPosting] = useState(false);
  const noMachine = !!state && !online.length;
  const reason = !state ? "Đang tải trạng thái máy Windows…" : noMachine ? "Chưa có máy Windows online" : !device ? "Chọn máy Windows" : "";
  const busy = (k: Kind) => sending === k;
  return (
    <div className="tb-actions" role="group" aria-label="Trình duyệt TikTok">
      {noMachine ? (
        <Link href="/browser" className="tb-device offline" title="Mở Quản lý trình duyệt để kết nối máy Windows">
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
      <button className="btn btn-primary" disabled={!!reason || !!sending} title={reason || "Chọn kịch bản rồi đăng cho các tài khoản đã chọn — máy tự mở trình duyệt, không cần mở trước"} onClick={() => setPosting(true)}>
        {busy("post") ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}Đăng bài
      </button>
      {posting && device && (
        <PostDialog count={ids.length} deviceName={device.name} onClose={() => setPosting(false)}
          onPost={async (scenarioId) => {
            const midnight = new Date(); midnight.setHours(0, 0, 0, 0); // times are this browser's local day
            await run("post", ids, { scenarioId, dayEpoch: Math.floor(midnight.getTime() / 1000) });
          }} />
      )}
      <button className="btn" disabled={!!reason || !!sending} title={reason || "Chuyển toàn bộ bài công khai sang Chỉ mình tôi"} onClick={() => void run("hide", ids)}>
        {busy("hide") ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}Ẩn bài
      </button>
      <span className="tb-feed">
        <button className="btn" disabled={!!reason || !!sending} title={reason || "Mở For You và tự lướt như người thật (xem + thỉnh thoảng like, con trỏ chuột di chuyển)"} onClick={() => void run("feed", ids, { durationMs: feedMin * 60000 })}>
          {busy("feed") ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Clapperboard size={15} aria-hidden="true" />}Lướt feed
        </button>
        <input type="number" min={1} max={60} value={feedMin} aria-label="Số phút lướt feed" title="Số phút lướt feed" disabled={!!sending}
          onChange={(e) => setFeedMin(Math.min(60, Math.max(1, Number(e.target.value) || 5)))} style={{ width: 52 }} className="input" />
        <span className="tb-feed-unit">phút</span>
      </span>
      <button className="btn btn-quiet" disabled={!!reason || !!sending} title={reason || "Đóng cửa sổ (dừng ẩn bài nếu đang chạy)"} onClick={() => void run("close", ids)}>
        {busy("close") ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}Đóng
      </button>
    </div>
  );
}

/** Browser icon next to the username for accounts that have a browser profile on a Windows
 *  machine. Green: its TikTok login is saved in that browser (opening it won't need a login),
 *  whether the window is open or closed. Amber: window open but not signed in yet. Grey: a
 *  profile exists but has no saved login. Hidden if the account never had a browser. */
export function BrowserBadge({ profile }: { profile?: Profile }) {
  if (!profile || profile.status === "revoked") return null;
  const open = OPEN_STATUSES.includes(profile.status);
  const signingIn = open && profile.status !== "logged_in";
  const saved = !signingIn && (profile.status === "logged_in" || !!profile.loggedInAt);
  const tone = signingIn ? " warn" : saved ? " good" : "";
  const since = profile.loggedInAt ? new Date(profile.loggedInAt * 1000).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "";
  const label = signingIn
    ? `Trình duyệt đang mở · ${STATUS_LABEL[profile.status] ?? profile.status}`
    : saved
      ? `Đã lưu đăng nhập trong trình duyệt${open ? " · đang mở" : " — mở lên không cần đăng nhập lại"}${since ? ` (từ ${since})` : ""}`
      : "Có trình duyệt nhưng chưa lưu đăng nhập — lần mở tới sẽ tự đăng nhập";
  return (
    <span className={`tb-browser${tone}`} title={label} aria-label={label} role="img">
      <Globe size={13} aria-hidden="true" />
    </span>
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
      <button type="button" role="menuitem" className="menu-item tb-menu-item" disabled={disabled || !!view?.feeding} title={hint}
        onClick={() => { onDone(); void run("feed", [id], { durationMs: 5 * 60000 }); }}>
        <Clapperboard size={14} aria-hidden="true" />{view?.feeding ? "Đang lướt feed…" : "Lướt feed (5 phút)"}
      </button>
      {item("close", "Đóng trình duyệt", <Square size={13} aria-hidden="true" />, !view?.hasWindow && !view?.hiding && !view?.feeding)}
    </div>
  );
}
