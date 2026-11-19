"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppWindow, ChevronDown, Clock, ExternalLink, Layers, Square, X } from "lucide-react";
import { postJson, safeJson } from "@/lib/req-body";
import { confirmDialog, notify } from "./notify";

// Floating "browser threads" dock on every page: a pill with how many windows run
// out of the allowed threads; "Quản lý" opens a floating panel listing every running
// thread and the queue, with Đóng / Hủy / Đóng tất cả. The full table lives on /browser.

interface Device { id: string; name: string; lastSeenAt: number; maxWindows: number }
interface Profile { accountId: number; deviceId: string; status: string; updatedAt: number; username: string | null }
interface Job { id: string; kind: string; accountId: number | null; state: string; result: string | null; createdAt: number; deviceId: string; username: string | null }
interface State { now: number; devices: Device[]; profiles: Profile[]; jobs: Job[] }

const OPEN = ["starting", "open", "needs_verification", "unverified", "logged_in", "wrong_account"];
const STATUS: Record<string, string> = { starting: "Đang mở", open: "Đã mở", needs_verification: "Cần xác minh", unverified: "Chưa xác minh", logged_in: "Đã đăng nhập", wrong_account: "Nhầm tài khoản" };
const KIND: Record<string, string> = { open: "Mở trình duyệt", hide: "Ẩn bài", close: "Đóng" };
const PANEL_KEY = "browser-dock-open";

function elapsed(from: number, now: number) {
  const s = Math.max(0, now - from);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)} phút`;
  return `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`;
}
function hideText(job?: Job) {
  if (!job?.result) return null;
  try { const r = JSON.parse(job.result) as { changed: number; skipped: number; message?: string }; return { count: `${r.changed} đã ẩn · ${r.skipped} vốn riêng tư`, message: r.message }; } catch { return null; }
}

export function BrowserDock() {
  const pathname = usePathname();
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => { try { setOpen(localStorage.getItem(PANEL_KEY) === "1"); } catch { /* storage blocked */ } }, []);
  const toggle = (value: boolean) => { setOpen(value); try { localStorage.setItem(PANEL_KEY, value ? "1" : "0"); } catch { /* storage blocked */ } };

  const refresh = useCallback(async () => {
    const res = await fetch("/api/browser/state", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data = await safeJson<State>(res);
    if (!data.error) setState(data);
  }, []);

  const running = state ? state.profiles.filter((p) => OPEN.includes(p.status)) : [];
  const queued = state ? state.jobs.filter((j) => ["queued", "claimed"].includes(j.state) && j.kind !== "close" && !running.some((p) => p.accountId === j.accountId)) : [];
  const busy = running.length > 0 || queued.length > 0;

  // Fast while something runs or the panel is open, slow when idle, paused in background tabs.
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!live) return;
      if (!document.hidden) await refresh();
      if (live) timer = setTimeout(tick, busy || open ? 3000 : 15000);
    };
    void tick();
    return () => { live = false; clearTimeout(timer); };
  }, [refresh, busy, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") toggle(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!state || !state.devices.length || pathname.startsWith("/login")) return null;

  const online = state.devices.filter((d) => d.lastSeenAt >= state.now - 60);
  const limit = online.reduce((sum, d) => sum + d.maxWindows, 0);
  const deviceName = (id: string) => state.devices.find((d) => d.id === id)?.name ?? "Máy đã gỡ";
  const activeJob = (accountId: number) => state.jobs.find((j) => j.accountId === accountId && ["claimed", "running"].includes(j.state) && j.kind !== "open" && j.kind !== "close");

  async function call(route: string, body: unknown) {
    const res = await postJson("/api/browser/" + route, body);
    const value = await safeJson<{ results?: { ok: boolean; error?: string }[] }>(res);
    if (!res.ok || value.error) throw new Error(value.error || "Thao tác thất bại");
    const failed = value.results?.find((r) => !r.ok);
    if (failed) throw new Error(failed.error || "Thao tác thất bại");
  }
  async function closeOne(p: Profile) {
    for (const j of state!.jobs) if (j.accountId === p.accountId && ["queued", "claimed"].includes(j.state)) await call("jobs/cancel", { id: j.id }).catch(() => {});
    await call("jobs", { kind: "close", ids: [p.accountId], deviceId: p.deviceId });
  }
  async function run(work: () => Promise<void>, done: string) {
    setWorking(true);
    try { await work(); notify.success(done); } catch (e) { notify.error(e instanceof Error ? e.message : "Thao tác thất bại"); }
    finally { setWorking(false); await refresh(); }
  }
  async function closeAll() {
    const total = running.length + queued.length;
    if (!total || !(await confirmDialog({ title: "Đóng tất cả luồng", message: `Đóng ${running.length} cửa sổ và hủy ${queued.length} lệnh đang chờ?`, confirmLabel: "Đóng tất cả", danger: true }))) return;
    await run(async () => {
      for (const j of queued) await call("jobs/cancel", { id: j.id }).catch(() => {});
      const byDevice = new Map<string, number[]>();
      for (const p of running) byDevice.set(p.deviceId, [...(byDevice.get(p.deviceId) ?? []), p.accountId]);
      for (const [deviceId, ids] of byDevice) for (let i = 0; i < ids.length; i += 20) await call("jobs", { kind: "close", ids: ids.slice(i, i + 20), deviceId });
    }, "Đã gửi lệnh đóng tất cả");
  }

  return <>
    <button type="button" className={`bd-pill${busy ? " is-busy" : ""}${open ? " is-open" : ""}`} aria-expanded={open} aria-controls="browser-dock" onClick={() => toggle(!open)}
      title="Luồng trình duyệt đang chạy">
      <span className="bd-dot" aria-hidden="true" />
      <Layers size={16} aria-hidden="true" />
      <span className="bd-count"><b>{running.length}</b>/{limit || "–"} luồng</span>
      {queued.length > 0 && <span className="bd-queue">{queued.length} chờ</span>}
      <span className="bd-manage">{open ? <ChevronDown size={15} aria-hidden="true" /> : "Quản lý"}</span>
    </button>

    {open && <section id="browser-dock" className="bd-panel" role="dialog" aria-label="Quản lý luồng trình duyệt">
      <header className="bd-head">
        <div><h2>Luồng trình duyệt</h2><p>{running.length} đang chạy · {queued.length} đang chờ</p></div>
        <button type="button" className="btn btn-icon" aria-label="Thu nhỏ" onClick={() => toggle(false)}><X size={16} /></button>
      </header>

      <div className="bd-devices">
        {state.devices.map((d) => {
          const used = state.profiles.filter((p) => p.deviceId === d.id && OPEN.includes(p.status)).length;
          const isOnline = online.includes(d);
          return <div key={d.id} className="bd-device">
            <span className={`bd-status ${isOnline ? "on" : "off"}`} aria-hidden="true" />
            <span className="bd-device-name">{d.name}</span>
            <span className="bd-device-use">{isOnline ? `${used}/${d.maxWindows} luồng` : "Offline"}</span>
            <meter min={0} max={d.maxWindows} value={Math.min(used, d.maxWindows)} aria-label={`${d.name}: ${used} trên ${d.maxWindows} luồng`} />
          </div>;
        })}
      </div>

      <div className="bd-list">
        {running.length > 0 && <h3>Đang chạy</h3>}
        {running.map((p) => {
          const job = activeJob(p.accountId);
          const hide = job?.kind === "hide" ? hideText(job) : null;
          const warn = ["needs_verification", "wrong_account", "unverified"].includes(p.status);
          return <div key={p.accountId} className="bd-row">
            <AppWindow size={16} className="bd-row-icon" aria-hidden="true" />
            <div className="bd-row-main">
              <div className="bd-row-top"><b>@{p.username ?? p.accountId}</b><span className={`bd-tag ${warn ? "warn" : "good"}`}>{STATUS[p.status] ?? p.status}</span></div>
              <small>{job ? `${KIND[job.kind] ?? job.kind}${hide ? ` · ${hide.count}` : ""}` : "Đang mở, không chạy lệnh"} · {deviceName(p.deviceId)} · {elapsed(job?.createdAt ?? p.updatedAt, state.now)}</small>
              {hide?.message && <small className="bd-msg">{hide.message}</small>}
            </div>
            <button type="button" className="btn btn-quiet bd-act" disabled={working} aria-label={`Đóng @${p.username}`} onClick={() => void run(() => closeOne(p), `Đã gửi lệnh đóng @${p.username}`)}><Square size={13} />Đóng</button>
          </div>;
        })}

        {queued.length > 0 && <h3>Đang chờ luồng trống</h3>}
        {queued.map((j) => <div key={j.id} className="bd-row is-queued">
          <Clock size={16} className="bd-row-icon" aria-hidden="true" />
          <div className="bd-row-main">
            <div className="bd-row-top"><b>@{j.username ?? j.accountId}</b><span className="bd-tag">{j.state === "claimed" ? "Máy đã nhận" : "Chờ"}</span></div>
            <small>{KIND[j.kind] ?? j.kind} · {deviceName(j.deviceId)} · chờ {elapsed(j.createdAt, state.now)}</small>
          </div>
          <button type="button" className="btn btn-quiet bd-act" disabled={working || j.state !== "queued"} onClick={() => void run(() => call("jobs/cancel", { id: j.id }), `Đã hủy lệnh của @${j.username}`)}>Hủy</button>
        </div>)}

        {!running.length && !queued.length && <div className="bd-empty"><Layers size={26} aria-hidden="true" /><b>Không có luồng nào đang chạy</b><span>Mở trình duyệt hoặc Ẩn bài từ danh sách TikTok.</span></div>}
      </div>

      <footer className="bd-foot">
        <Link href="/browser" className="btn btn-quiet" onClick={() => toggle(false)}><ExternalLink size={14} />Chỉnh số luồng</Link>
        <button type="button" className="btn bd-danger" disabled={working || (!running.length && !queued.length)} onClick={() => void closeAll()}>Đóng tất cả</button>
      </footer>
    </section>}
  </>;
}
