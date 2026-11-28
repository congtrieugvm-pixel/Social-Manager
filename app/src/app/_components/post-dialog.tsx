"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { postJson, safeJson } from "@/lib/req-body";
import { confirmDialog, notify } from "./notify";

// "Đăng bài" from the TikTok accounts tab: pick a saved scenario (kịch bản) and post for the
// selected accounts. The Windows machine opens each account's own browser (saved login, or it
// logs in), posts, and closes it. A scenario's folder is shared: its videos are split across the
// accounts, each video posted once.

export interface Scenario {
  id: number; name: string; folder: string; caption: string; perAccount: number;
  timeMode: "now" | "time" | "window"; atMin: number | null; startMin: number | null; endMin: number | null; deleteAfter: number;
}
type Draft = Omit<Scenario, "id" | "deleteAfter"> & { id?: number; deleteAfter: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (min: number | null | undefined) => (min == null ? "" : `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`);
const toMin = (v: string) => { const [h, m] = v.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const BLANK: Draft = { name: "", folder: "", caption: "", perAccount: 1, timeMode: "now", atMin: 20 * 60, startMin: 9 * 60, endMin: 21 * 60, deleteAfter: false };
const LAST_KEY = "post-scenario-last";

export function describeScenario(s: Pick<Scenario, "perAccount" | "timeMode" | "atMin" | "startMin" | "endMin" | "deleteAfter">) {
  const when = s.timeMode === "now" ? "Đăng ngay" : s.timeMode === "time" ? `Lên lịch ${hhmm(s.atMin)}` : `Ngẫu nhiên ${hhmm(s.startMin)}–${hhmm(s.endMin)}`;
  return `${s.perAccount} bài/tài khoản · ${when}${s.deleteAfter ? " · xóa file sau khi đăng" : ""}`;
}

export function PostDialog({ count, deviceName, onClose, onPost }: {
  count: number; deviceName: string; onClose: () => void; onPost: (scenarioId: number) => Promise<void>;
}) {
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (pick?: number) => {
    const res = await fetch("/api/browser/scenarios", { cache: "no-store" });
    const data = await safeJson<{ scenarios: Scenario[] }>(res);
    if (data.error) { notify.error(data.error); setScenarios([]); return; }
    setScenarios(data.scenarios);
    let last: number | null = null;
    try { last = Number(localStorage.getItem(LAST_KEY)) || null; } catch { /* storage blocked */ }
    const want = pick ?? selected ?? last;
    setSelected(data.scenarios.some((x) => x.id === want) ? want : data.scenarios[0]?.id ?? null);
    if (!data.scenarios.length) setDraft({ ...BLANK });
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const current = scenarios?.find((x) => x.id === selected) ?? null;

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await postJson("/api/browser/scenarios/save", { ...draft });
      const data = await safeJson<{ id: number }>(res);
      if (data.error) { notify.error(data.error); return; }
      notify.success(draft.id ? "Đã lưu kịch bản" : "Đã tạo kịch bản");
      setDraft(null);
      await load(data.id);
    } finally { setBusy(false); }
  }
  async function remove(s: Scenario) {
    if (!(await confirmDialog({ title: "Xóa kịch bản", message: `Xóa kịch bản "${s.name}"? Video đã đăng không bị ảnh hưởng.`, confirmLabel: "Xóa", danger: true }))) return;
    setBusy(true);
    try {
      const data = await safeJson(await postJson("/api/browser/scenarios/delete", { id: s.id }));
      if (data.error) { notify.error(data.error); return; }
      await load();
    } finally { setBusy(false); }
  }
  async function post() {
    if (!current) return;
    try { localStorage.setItem(LAST_KEY, String(current.id)); } catch { /* storage blocked */ }
    setBusy(true);
    try { await onPost(current.id); onClose(); } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal ps-modal" role="dialog" aria-modal="true" aria-labelledby="ps-title">
        <h2 id="ps-title" className="h2-serif">{draft ? (draft.id ? "Sửa kịch bản đăng" : "Tạo kịch bản đăng") : "Đăng bài"}</h2>
        {scenarios === null ? (
          <p className="dialog-msg"><Loader2 size={15} className="spin" aria-hidden="true" /> Đang tải kịch bản…</p>
        ) : draft ? (
          <ScenarioForm draft={draft} setDraft={setDraft} busy={busy} canGoBack={scenarios.length > 0}
            onCancel={() => setDraft(null)} onSave={() => void save()} />
        ) : (
          <>
            <p className="dialog-msg">
              Chọn kịch bản rồi bấm Đăng. Máy <b>{deviceName}</b> sẽ tự mở trình duyệt của từng tài khoản (dùng đăng nhập đã lưu, hoặc tự đăng nhập), đăng bài rồi đóng lại.
            </p>
            <div className="ps-list" role="radiogroup" aria-label="Kịch bản đăng">
              {scenarios.map((s) => (
                <div key={s.id} className={`ps-item${s.id === selected ? " on" : ""}`}>
                  <label className="ps-pick">
                    <input type="radio" name="ps" checked={s.id === selected} onChange={() => setSelected(s.id)} />
                    <span className="ps-text">
                      <b>{s.name}</b>
                      <small>{describeScenario({ ...s, deleteAfter: s.deleteAfter })}</small>
                      <small className="ps-folder" title={s.folder}>{s.folder}</small>
                    </span>
                  </label>
                  <button type="button" className="btn btn-quiet btn-icon" title="Sửa kịch bản" aria-label={`Sửa ${s.name}`} disabled={busy}
                    onClick={() => setDraft({ ...s, deleteAfter: !!s.deleteAfter })}><Pencil size={14} aria-hidden="true" /></button>
                  <button type="button" className="btn btn-quiet btn-icon" title="Xóa kịch bản" aria-label={`Xóa ${s.name}`} disabled={busy}
                    onClick={() => void remove(s)}><Trash2 size={14} aria-hidden="true" /></button>
                </div>
              ))}
            </div>
            <button type="button" className="btn ps-new" disabled={busy} onClick={() => setDraft({ ...BLANK })}><Plus size={15} aria-hidden="true" />Tạo kịch bản mới</button>
            {current && (
              <p className="ps-summary">
                Đăng cho <b>{count}</b> tài khoản · video được chia từ thư mục chung, mỗi video chỉ đăng 1 lần — cần ít nhất <b>{count * current.perAccount}</b> video chưa đăng.
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn" disabled={busy} onClick={onClose}>Hủy</button>
              <button type="button" className="btn btn-primary" disabled={busy || !current} onClick={() => void post()}>
                {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}Đăng {count} tài khoản
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ScenarioForm({ draft, setDraft, busy, canGoBack, onCancel, onSave }: {
  draft: Draft; setDraft: (d: Draft) => void; busy: boolean; canGoBack: boolean; onCancel: () => void; onSave: () => void;
}) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const validWindow = draft.timeMode !== "window" || (draft.startMin ?? 0) < (draft.endMin ?? 0);
  const ok = draft.name.trim() && /^[A-Za-z]:\\/.test(draft.folder.trim()) && validWindow;
  return (
    <form className="ps-form" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(); }}>
      <label className="dialog-field"><span>Tên kịch bản</span>
        <input className="input" required maxLength={60} value={draft.name} placeholder="VD: Đăng tối 20h" onChange={(e) => set({ name: e.target.value })} /></label>
      <label className="dialog-field"><span>Thư mục video trên máy Windows</span>
        <input className="input" required value={draft.folder} placeholder="D:\Videos\Kenh-A" onChange={(e) => set({ folder: e.target.value })} />
        <small className="ps-help">Video trong thư mục được chia cho các tài khoản đã chọn, mỗi video chỉ đăng 1 lần (theo thứ tự tên file).</small></label>
      <label className="dialog-field"><span>Caption</span>
        <textarea className="input" rows={3} maxLength={2200} value={draft.caption} placeholder="Để trống = dùng tên file làm caption" onChange={(e) => set({ caption: e.target.value })} /></label>
      <div className="ps-grid">
        <label className="dialog-field"><span>Số bài / tài khoản</span>
          <input className="input" type="number" min={1} max={10} value={draft.perAccount}
            onChange={(e) => set({ perAccount: Math.min(10, Math.max(1, Math.floor(Number(e.target.value) || 1))) })} /></label>
        <label className="dialog-field"><span>Thời gian</span>
          <select className="input" value={draft.timeMode} onChange={(e) => set({ timeMode: e.target.value as Draft["timeMode"] })}>
            <option value="now">Đăng ngay</option>
            <option value="time">Lên lịch giờ cố định</option>
            <option value="window">Ngẫu nhiên trong khung giờ</option>
          </select></label>
      </div>
      {draft.timeMode === "time" && (
        <label className="dialog-field"><span>Giờ đăng mỗi ngày</span>
          <input className="input" type="time" value={hhmm(draft.atMin)} onChange={(e) => set({ atMin: toMin(e.target.value) })} />
          <small className="ps-help">Lần tới của giờ này (hôm nay nếu còn kịp, không thì ngày mai). Tài khoản cách nhau 1 phút, bài cách nhau 10 phút.</small></label>
      )}
      {draft.timeMode === "window" && (
        <div className="ps-grid">
          <label className="dialog-field"><span>Từ</span><input className="input" type="time" value={hhmm(draft.startMin)} onChange={(e) => set({ startMin: toMin(e.target.value) })} /></label>
          <label className="dialog-field"><span>Đến</span><input className="input" type="time" value={hhmm(draft.endMin)} onChange={(e) => set({ endMin: toMin(e.target.value) })} /></label>
          {!validWindow && <small className="ps-help ps-bad">Giờ bắt đầu phải trước giờ kết thúc.</small>}
        </div>
      )}
      <label className="ps-check"><input type="checkbox" checked={draft.deleteAfter} onChange={(e) => set({ deleteAfter: e.target.checked })} />Xóa file khỏi thư mục sau khi TikTok xác nhận đăng thành công</label>
      <div className="dialog-actions">
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>{canGoBack ? "Quay lại" : "Hủy"}</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !ok}>{busy && <Loader2 size={15} className="spin" aria-hidden="true" />}Lưu kịch bản</button>
      </div>
    </form>
  );
}
