"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeBodyHeader } from "@/lib/req-body";
import { confirmDialog } from "@/app/_components/notify";
import { MessageSquarePlus, Play, Plus, X } from "lucide-react";
import { SkeletonCard } from "@/app/_components/skeleton";

// Insight "Comment tự động": rules (a Page or a Page group + several comment
// texts). Every new post of those Pages gets one random text as a comment
// from the Page, checked every 5 minutes by the server cron. Also shows the
// latest comments / errors and a "Chạy ngay" button.

interface Page {
  id: string;
  name: string;
  tokenIds: number[];
}

interface Group {
  id: number;
  name: string;
  color: string;
}

interface Rule {
  id: number;
  targetType: "page" | "group";
  targetId: string;
  comments: string[];
  enabled: boolean;
  activeSince: number;
  backfillDays: number;
  gapMinutes: number;
  lastRunAt: number | null;
  stats: { ok: number; error: number; last: number | null };
}

interface LogRow {
  id: number;
  ruleId: number | null;
  pageId: string;
  postId: string;
  postMessage: string | null;
  comment: string | null;
  commentId: string | null;
  status: "ok" | "error";
  error: string | null;
  createdAt: number;
}

interface Summary {
  pagesChecked: number;
  newPosts: number;
  commented: number;
  failed: number;
  skipped: number;
  errors: string[];
}

const smallBtn = { padding: "5px 10px", fontSize: 11 } as const;
const BACKFILL: Array<[number, string]> = [
  [0, "Chỉ bài mới"],
  [1, "Thêm bài 1 ngày trước"],
  [3, "Thêm bài 3 ngày trước"],
  [7, "Thêm bài 7 ngày trước"],
  [14, "Thêm bài 14 ngày trước"],
  [30, "Thêm bài 30 ngày trước"],
  [90, "Thêm bài 90 ngày trước"],
];
const GAPS: Array<[number, string]> = [
  [0, "Không chờ"],
  [5, "5 phút"],
  [10, "10 phút"],
  [15, "15 phút"],
  [30, "30 phút"],
  [60, "1 giờ"],
  [120, "2 giờ"],
  [240, "4 giờ"],
];
const gapLabel = (m: number) => GAPS.find(([v]) => v === m)?.[1] ?? `${m} phút`;
const when = (s: number | null) =>
  s ? new Date(s * 1000).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, cache: "no-store", headers: body === undefined ? {} : { "X-Body": encodeBodyHeader(body) } });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export function AutoCommentTab({ pages, groups, assignments }: { pages: Page[]; groups: Group[]; assignments: Record<string, number> }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const pageById = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  const load = useCallback(async () => {
    try {
      const d = await send("/api/insight/autocomment", "GET");
      setRules(d.rules);
      setLog(d.log);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRules((r) => r ?? []);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const targetName = (r: Pick<Rule, "targetType" | "targetId">) =>
    r.targetType === "page"
      ? pageById.get(r.targetId)?.name ?? `Trang ${r.targetId}`
      : groupById.get(Number(r.targetId))?.name ?? `Nhóm #${r.targetId}`;
  const pagesOfRule = (r: Rule) =>
    r.targetType === "page" ? 1 : Object.entries(assignments).filter(([, g]) => String(g) === r.targetId).length;

  async function toggle(r: Rule) {
    // Flip at once; the reload brings the new activeSince (or undoes on error).
    setRules((list) => list?.map((x) => (x.id === r.id ? { ...x, enabled: !r.enabled } : x)) ?? list);
    try {
      await send(`/api/insight/autocomment/${r.id}`, "PATCH", { enabled: !r.enabled });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    await load();
  }
  async function remove(r: Rule) {
    if (!(await confirmDialog({ message: `Xoá cài đặt comment cho "${targetName(r)}"?`, confirmLabel: "Xoá", danger: true }))) return;
    try {
      await send(`/api/insight/autocomment/${r.id}`, "DELETE");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function runNow() {
    setRunning(true);
    setSummary(null);
    try {
      setSummary((await send("/api/insight/autocomment/run", "POST")).summary);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <div className="card ac-intro">
        <div>
          <strong>Comment tự động</strong> — chọn Trang hoặc nhóm Trang và soạn sẵn vài nội dung. Mỗi bài <b>mới lên</b> (bài lên lịch hoặc
          đăng tay, sau khi bật cài đặt) — và tuỳ chọn cả <b>bài cũ</b> — sẽ được Trang comment một nội dung chọn ngẫu nhiên, cách nhau theo khoảng
          bạn chọn. Server kiểm tra 5 phút một lần, mỗi bài chỉ comment 1 lần. Token cần quyền <b>pages_manage_engagement</b>.
        </div>
        <div className="ac-intro-actions">
          <button className="btn" style={smallBtn} onClick={() => void runNow()} disabled={running || !rules?.some((r) => r.enabled)}>
            <Play size={14} aria-hidden="true" />
            {running ? "Đang chạy…" : "Chạy ngay"}
          </button>
          <button className="btn btn-primary" style={smallBtn} onClick={() => setEditing("new")}>
            <Plus size={14} aria-hidden="true" />
            Thêm cài đặt
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="card ac-alert">
          {error}
          <button className="btn" style={smallBtn} onClick={() => setError(null)}>Đóng</button>
        </div>
      )}
      {summary && (
        <div role="status" className="card ac-summary">
          Đã kiểm tra {summary.pagesChecked} Trang · {summary.newPosts} bài mới · <b style={{ color: "var(--good)" }}>{summary.commented} đã comment</b>
          {summary.failed > 0 && <> · <b style={{ color: "var(--danger)" }}>{summary.failed} lỗi</b></>}
          {summary.skipped > 0 && <> · {summary.skipped} để lần sau</>}
          {summary.errors.length > 0 && <div className="ac-sum-err">{summary.errors.slice(0, 3).join(" · ")}</div>}
        </div>
      )}

      {editing && (
        <RuleForm
          rule={editing === "new" ? null : editing}
          pages={pages}
          groups={groups}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      <div className="section-label" style={{ margin: "14px 0 8px" }}>Cài đặt ({rules?.length ?? 0})</div>
      {rules === null ? (
        <SkeletonCard rows={3} />
      ) : rules.length === 0 ? (
        <div className="card empty-state">
          <MessageSquarePlus size={28} aria-hidden="true" />
          <h3>Chưa có cài đặt comment nào</h3>
          <p>Chọn Trang hoặc nhóm Trang và soạn vài nội dung; mỗi bài mới sẽ được Trang comment một nội dung ngẫu nhiên.</p>
          <button className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden="true" />
            Thêm cài đặt
          </button>
        </div>
      ) : (
        <div className="ac-rules">
          {rules.map((r) => {
            const g = r.targetType === "group" ? groupById.get(Number(r.targetId)) : null;
            return (
              <div key={r.id} className={`card ac-rule${r.enabled ? "" : " off"}`} style={g ? { borderLeftColor: g.color } : undefined}>
                <div className="ac-rule-head">
                  <span className={`pill${r.targetType === "group" ? "" : " ok"}`}>{r.targetType === "group" ? "Nhóm" : "Trang"}</span>
                  <b className="ac-rule-name">{targetName(r)}</b>
                  {r.targetType === "group" && <span className="mono ac-dim">{pagesOfRule(r)} Trang</span>}
                  <span style={{ flex: 1 }} />
                  <label className="ac-switch" title={r.enabled ? "Đang bật" : "Đang tắt"}>
                    <input type="checkbox" checked={r.enabled} onChange={() => void toggle(r)} aria-label="Bật / tắt" />
                    {r.enabled ? "Bật" : "Tắt"}
                  </label>
                </div>
                <ol className="ac-texts">
                  {r.comments.slice(0, 3).map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                  {r.comments.length > 3 && <li className="ac-dim">… và {r.comments.length - 3} mẫu khác</li>}
                </ol>
                <div className="ac-rule-foot mono">
                  <span>{r.comments.length} mẫu</span>
                  <span>· đã comment <b style={{ color: "var(--good)" }}>{r.stats.ok}</b></span>
                  {r.stats.error > 0 && <span>· lỗi <b style={{ color: "var(--danger)" }}>{r.stats.error}</b></span>}
                  <span>· {r.enabled ? `áp dụng bài từ ${when(r.activeSince - r.backfillDays * 86400)}` : "đang tắt"}</span>
                  {r.backfillDays > 0 && <span>· gồm bài cũ {r.backfillDays} ngày</span>}
                  {r.gapMinutes > 0 && <span>· cách {gapLabel(r.gapMinutes)}/Trang</span>}
                  <span style={{ flex: 1 }} />
                  <button className="btn" style={smallBtn} onClick={() => setEditing(r)}>Sửa</button>
                  <button className="btn btn-danger" style={smallBtn} onClick={() => void remove(r)}>Xoá</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="section-label" style={{ margin: "18px 0 8px" }}>Comment gần đây</div>
      <div className="table-wrap insight-table-wrap">
        <table className="table ac-log">
          <thead>
            <tr>
              <th>Lúc</th>
              <th>Trang</th>
              <th>Bài viết</th>
              <th>Comment</th>
              <th>Kết quả</th>
            </tr>
          </thead>
          <tbody>
            {log.map((l) => (
              <tr key={l.id}>
                <td className="mono" style={{ whiteSpace: "nowrap", fontSize: 11 }}>{when(l.createdAt)}</td>
                <td>{pageById.get(l.pageId)?.name ?? l.pageId}</td>
                <td className="ac-cell">
                  <a href={`https://www.facebook.com/${l.postId}`} target="_blank" rel="noreferrer">
                    {l.postMessage || "(không có chữ)"}
                  </a>
                </td>
                <td className="ac-cell">{l.comment}</td>
                <td>
                  {l.status === "ok" ? (
                    <span className="pill ok">Đã comment</span>
                  ) : (
                    <span className="pill err" title={l.error ?? ""}>Lỗi</span>
                  )}
                  {l.status === "error" && <div className="ac-err">{l.error}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {log.length === 0 && <div style={{ padding: 16, color: "var(--muted)", fontSize: 12 }}>Chưa có comment nào.</div>}
      </div>
    </>
  );
}

function RuleForm({
  rule,
  pages,
  groups,
  onCancel,
  onSaved,
}: {
  rule: Rule | null;
  pages: Page[];
  groups: Group[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [targetType, setTargetType] = useState<"page" | "group">(rule?.targetType ?? (groups.length ? "group" : "page"));
  const [targetId, setTargetId] = useState(rule?.targetId ?? "");
  const [pageSearch, setPageSearch] = useState("");
  const [texts, setTexts] = useState<string[]>(rule?.comments.length ? rule.comments : ["", ""]);
  const [backfillDays, setBackfillDays] = useState(rule?.backfillDays ?? 0);
  const [gapMinutes, setGapMinutes] = useState(rule?.gapMinutes ?? 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shownPages = pages
    .filter((p) => !pageSearch.trim() || p.name.toLowerCase().includes(pageSearch.trim().toLowerCase()) || p.id === targetId)
    .slice(0, 300);

  async function save() {
    const comments = texts.map((t) => t.trim()).filter(Boolean);
    if (!targetId) return setErr(targetType === "page" ? "Chọn Trang" : "Chọn nhóm Trang");
    if (!comments.length) return setErr("Soạn ít nhất 1 nội dung comment");
    setBusy(true);
    setErr(null);
    try {
      const body = { targetType, targetId, comments, backfillDays, gapMinutes };
      if (rule) await send(`/api/insight/autocomment/${rule.id}`, "PATCH", body);
      else await send("/api/insight/autocomment", "POST", { ...body, enabled: true });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card ac-form">
      <div className="ac-form-row">
        <div className="btn-group" role="tablist" aria-label="Áp dụng cho">
          {(
            [
              ["group", "Nhóm Trang"],
              ["page", "Một Trang"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={targetType === k}
              className={`btn-seg${targetType === k ? " active" : ""}`}
              onClick={() => {
                setTargetType(k);
                setTargetId("");
              }}
            >
              {l}
            </button>
          ))}
        </div>
        {targetType === "group" ? (
          <select className="input" aria-label="Nhóm Trang" value={targetId} onChange={(e) => setTargetId(e.target.value)} style={{ flex: "1 1 220px" }}>
            <option value="">— Chọn nhóm —</option>
            {groups.map((g) => (
              <option key={g.id} value={String(g.id)}>
                {g.name}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input className="input" placeholder="Tìm Trang…" value={pageSearch} onChange={(e) => setPageSearch(e.target.value)} style={{ flex: "1 1 160px" }} />
            <select className="input" aria-label="Trang" value={targetId} onChange={(e) => setTargetId(e.target.value)} style={{ flex: "2 1 240px" }}>
              <option value="">— Chọn Trang ({shownPages.length}) —</option>
              {shownPages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      {targetType === "group" && groups.length === 0 && <div className="ac-dim">Chưa có nhóm Trang — tạo nhóm ở tab Reach hoặc chọn "Một Trang".</div>}

      <div className="ac-opts">
        <label className="ac-opt">
          <span className="ac-opt-label">Bài được comment</span>
          <select className="input" value={backfillDays} onChange={(e) => setBackfillDays(Number(e.target.value))} aria-label="Bài được comment">
            {BACKFILL.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <span className="ac-dim">
            {backfillDays > 0
              ? `Comment cả bài đã đăng trong ${backfillDays} ngày trước khi bật (tối đa 100 bài gần nhất mỗi Trang), mỗi bài 1 lần.`
              : "Chỉ bài lên sau khi bật."}
          </span>
        </label>
        <label className="ac-opt">
          <span className="ac-opt-label">Khoảng cách giữa 2 comment (cùng một Trang)</span>
          <select className="input" value={gapMinutes} onChange={(e) => setGapMinutes(Number(e.target.value))} aria-label="Khoảng cách giữa 2 comment">
            {GAPS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <span className="ac-dim">
            {gapMinutes > 0 ? `Mỗi Trang comment tối đa 1 lần mỗi ${gapLabel(gapMinutes)} — đỡ bị Facebook coi là spam.` : "Comment ngay khi thấy bài (tối đa 15 comment mỗi 5 phút)."}
          </span>
        </label>
      </div>
      <div className="section-label" style={{ marginTop: 4 }}>Nội dung comment — mỗi bài lấy ngẫu nhiên 1 mẫu</div>
      {texts.map((t, i) => (
        <div key={i} className="ac-text-row">
          <span className="mono ac-dim">{i + 1}</span>
          <textarea
            className="textarea"
            rows={2}
            placeholder={i === 0 ? "Ví dụ: Cảm ơn mọi người đã xem! Theo dõi Trang để xem thêm nhé 💛" : "Mẫu khác (tuỳ chọn)"}
            value={t}
            onChange={(e) => setTexts((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
            aria-label={`Mẫu comment ${i + 1}`}
          />
          {texts.length > 1 && (
            <button type="button" className="btn" style={smallBtn} title="Xoá mẫu" onClick={() => setTexts((list) => list.filter((_, j) => j !== i))}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      <div className="ac-form-row">
        <button type="button" className="btn" style={smallBtn} onClick={() => setTexts((l) => [...l, ""])} disabled={texts.length >= 30}>
          + Thêm mẫu
        </button>
        <span style={{ flex: 1 }} />
        {err && <span className="ac-err">{err}</span>}
        <button type="button" className="btn" style={smallBtn} onClick={onCancel}>Huỷ</button>
        <button type="button" className="btn btn-primary" style={smallBtn} onClick={() => void save()} disabled={busy}>
          {busy ? "Đang lưu…" : rule ? "Lưu" : "Lưu & bật"}
        </button>
      </div>
      {!rule && backfillDays === 0 && <div className="ac-dim">Chỉ những bài lên <b>sau khi lưu</b> mới được comment — bài cũ không bị đụng tới.</div>}
    </div>
  );
}
