"use client";

import { useMemo, useState } from "react";
import { postJson, safeJson } from "@/lib/req-body";
import { Check, ExternalLink, Eye, Loader2, Plus, Search, Sparkles } from "lucide-react";
import type { NicheChannel, NicheVideo } from "@/lib/nexlev";

// "Tìm ngách" panel on Bookmark Key: search YouTube niches through NexLev
// (/api/nexlev) and save the channels you like as YouTube bookmarks.
//   Chủ đề        — YouTube search, channels or videos (1 quota / page)
//   Kênh tương tự — channels like a competitor, with stats (20 quota)
//   Phân tích ngách — similar channels + their outlier videos (20 quota)
// Number filters (subs, outlier) run in the browser on the loaded results.

type Mode = "search" | "similar" | "niche";
type Group = { id: number; name: string };

interface Result {
  source?: { id: string; title: string | null };
  channels: NicheChannel[];
  videos: NicheVideo[];
  continuation?: string | null;
  totalVideos?: number | null;
}

const MODES: { id: Mode; label: string; cost: number; hint: string }[] = [
  { id: "search", label: "Theo chủ đề", cost: 1, hint: "Gõ chủ đề, tìm kênh hoặc video trên YouTube." },
  { id: "similar", label: "Kênh tương tự", cost: 20, hint: "Dán link kênh đối thủ — lấy các kênh cùng ngách kèm số liệu." },
  { id: "niche", label: "Phân tích ngách", cost: 20, hint: "Dán link kênh — xem video bùng nổ (outlier) của cả ngách." },
];

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n);

const ytChannelUrl = (id: string) => `https://www.youtube.com/channel/${id}`;

export default function NichePanel(props: {
  groups: Group[];
  savedIds: Set<string>;
  onSaved: (channels: unknown[]) => void;
}) {
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"channel" | "video" | "shorts">("channel");
  const [uploadDate, setUploadDate] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [channel, setChannel] = useState("");
  const [level, setLevel] = useState<1 | 2>(1);
  const [shortsOnly, setShortsOnly] = useState(false);
  const [busy, setBusy] = useState<"run" | "more" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [lastSearch, setLastSearch] = useState<Record<string, unknown> | null>(null);
  const [usedQuota, setUsedQuota] = useState(0);

  // Browser-side number filters
  const [minSubs, setMinSubs] = useState("");
  const [maxSubs, setMaxSubs] = useState("");
  const [minOutlier, setMinOutlier] = useState("");
  const [sort, setSort] = useState<"default" | "subs-asc" | "subs-desc" | "views-per-video">("default");

  const [groupId, setGroupId] = useState<number | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [justSaved, setJustSaved] = useState<Set<string>>(new Set());

  const cur = MODES.find((m) => m.id === mode)!;
  const canRun = mode === "search" ? query.trim().length > 0 : channel.trim().length > 0;

  async function run(more = false) {
    if (busy || (!more && !canRun)) return;
    setBusy(more ? "more" : "run");
    setError(null);
    const body: Record<string, unknown> =
      more && lastSearch
        ? { ...lastSearch, token: result?.continuation }
        : mode === "search"
          ? { mode, query, type, uploadDate: uploadDate || undefined, sortBy: sortBy || undefined }
          : mode === "similar"
            ? { mode, channel, level, channelType: shortsOnly ? "short" : "all" }
            : { mode, channel };
    try {
      const res = await postJson("/api/nexlev", body);
      const data = await safeJson<Result>(res);
      if (data.error) {
        setError(data.error);
        return;
      }
      setUsedQuota((q) => q + cur.cost);
      if (more && result) {
        setResult({
          ...result,
          channels: [...result.channels, ...data.channels.filter((c) => !result.channels.some((x) => x.channelId === c.channelId))],
          videos: [...result.videos, ...data.videos],
          continuation: data.continuation ?? null,
        });
      } else {
        setResult(data);
        setLastSearch(mode === "search" ? body : null);
      }
    } finally {
      setBusy(null);
    }
  }

  async function save(c: { channelId: string }) {
    if (saving.has(c.channelId)) return;
    setSaving((s) => new Set(s).add(c.channelId));
    try {
      const res = await postJson("/api/youtube/channels", { links: [ytChannelUrl(c.channelId)], groupId });
      const data = await safeJson<{ results: { status: string; channel?: unknown; error?: string }[] }>(res);
      const r = data.results?.[0];
      if (data.error || r?.status === "error") {
        setError(data.error ?? r?.error ?? "Không lưu được kênh");
        return;
      }
      if (r?.channel) props.onSaved([r.channel]);
      setJustSaved((s) => new Set(s).add(c.channelId));
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(c.channelId);
        return n;
      });
    }
  }

  const isSaved = (id: string | null) => !!id && (props.savedIds.has(id) || justSaved.has(id));

  const channels = useMemo(() => {
    if (!result) return [];
    const lo = Number(minSubs) || 0;
    const hi = Number(maxSubs) || Infinity;
    const list = result.channels.filter((c) => c.subs == null ? !minSubs && !maxSubs : c.subs >= lo && c.subs <= hi);
    const vpv = (c: NicheChannel) => (c.views && c.videos ? c.views / c.videos : 0);
    if (sort === "subs-asc") list.sort((a, b) => (a.subs ?? Infinity) - (b.subs ?? Infinity));
    if (sort === "subs-desc") list.sort((a, b) => (b.subs ?? 0) - (a.subs ?? 0));
    if (sort === "views-per-video") list.sort((a, b) => vpv(b) - vpv(a));
    return list;
  }, [result, minSubs, maxSubs, sort]);

  const videos = useMemo(() => {
    if (!result) return [];
    const min = Number(minOutlier) || 0;
    const lo = Number(minSubs) || 0;
    const hi = Number(maxSubs) || Infinity;
    return result.videos.filter(
      (v) => (v.outlier ?? Infinity) >= min && (v.channelSubs == null || (v.channelSubs >= lo && v.channelSubs <= hi)),
    );
  }, [result, minOutlier, minSubs, maxSubs]);

  const hasStats = result?.channels.some((c) => c.subs != null) || result?.videos.some((v) => v.channelSubs != null);
  const hasOutlier = result?.videos.some((v) => v.outlier != null);

  return (
    <section className="card nx" aria-labelledby="nx-title">
      <div className="nx-head">
        <div>
          <h2 id="nx-title" className="nx-title">
            <Sparkles size={16} aria-hidden="true" /> Tìm ngách · NexLev
          </h2>
          <p className="nx-hint">{cur.hint}</p>
        </div>
        {usedQuota > 0 && (
          <span className="nx-quota" title="Quota NexLev đã dùng trong phiên này">
            Đã dùng {usedQuota} quota
          </span>
        )}
      </div>

      <div className="btn-group nx-modes" role="tablist" aria-label="Cách tìm">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            className={`btn-seg${mode === m.id ? " active" : ""}`}
            onClick={() => {
              setMode(m.id);
              setError(null);
            }}
          >
            {m.label} <span className="nx-cost">{m.cost}q</span>
          </button>
        ))}
      </div>

      <form
        className="nx-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {mode === "search" ? (
          <>
            <label className="nx-field nx-grow">
              <span>Chủ đề</span>
              <input className="input" aria-label="Chủ đề" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="vd: stoic philosophy, kể chuyện lịch sử, AI tools…" />
            </label>
            <label className="nx-field">
              <span>Tìm</span>
              <select className="select" aria-label="Tìm" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="channel">Kênh</option>
                <option value="video">Video dài</option>
                <option value="shorts">Shorts</option>
              </select>
            </label>
            <label className="nx-field">
              <span>Đăng trong</span>
              <select className="select" aria-label="Đăng trong" value={uploadDate} onChange={(e) => setUploadDate(e.target.value)}>
                <option value="">Mọi lúc</option>
                <option value="today">Hôm nay</option>
                <option value="week">Tuần này</option>
                <option value="month">Tháng này</option>
                <option value="year">Năm nay</option>
              </select>
            </label>
            <label className="nx-field">
              <span>Sắp xếp</span>
              <select className="select" aria-label="Sắp xếp" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="">Liên quan</option>
                <option value="views">Nhiều view</option>
                <option value="date">Mới nhất</option>
                <option value="popularity">Phổ biến</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="nx-field nx-grow">
              <span>Kênh gốc</span>
              <input className="input" aria-label="Kênh gốc" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="https://www.youtube.com/@tenkenh hoặc UC…" />
            </label>
            {mode === "similar" && (
              <>
                <label className="nx-field">
                  <span>Mức tìm</span>
                  <select className="select" aria-label="Mức tìm" value={level} onChange={(e) => setLevel(Number(e.target.value) as 1 | 2)}>
                    <option value={1}>Nhanh</option>
                    <option value={2}>Vừa (lâu hơn)</option>
                  </select>
                </label>
                <label className="yt-check nx-check">
                  <input type="checkbox" checked={shortsOnly} onChange={(e) => setShortsOnly(e.target.checked)} /> Chỉ kênh Shorts
                </label>
              </>
            )}
          </>
        )}
        <button type="submit" className="btn btn-primary nx-run" disabled={!canRun || !!busy}>
          {busy === "run" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
          {busy === "run" ? (mode === "search" ? "Đang tìm…" : "Đang phân tích… (có thể 1–2 phút)") : `Tìm · ${cur.cost} quota`}
        </button>
      </form>

      {error && (
        <div role="alert" className="nx-error">
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="nx-toolbar">
            <div className="nx-summary">
              {result.source?.title && (
                <span>
                  Gốc: <strong>{result.source.title}</strong> ·{" "}
                </span>
              )}
              {result.channels.length > 0 && <span>{channels.length}/{result.channels.length} kênh</span>}
              {result.channels.length > 0 && result.videos.length > 0 && " · "}
              {result.videos.length > 0 && <span>{videos.length}/{result.videos.length} video</span>}
            </div>
            <div className="nx-filters">
              {hasStats && (
                <>
                  <label className="nx-mini">
                    Sub từ
                    <input className="input" inputMode="numeric" value={minSubs} onChange={(e) => setMinSubs(e.target.value.replace(/\D/g, ""))} placeholder="0" />
                  </label>
                  <label className="nx-mini">
                    đến
                    <input className="input" inputMode="numeric" value={maxSubs} onChange={(e) => setMaxSubs(e.target.value.replace(/\D/g, ""))} placeholder="∞" />
                  </label>
                </>
              )}
              {hasOutlier && (
                <label className="nx-mini">
                  Outlier ≥
                  <input className="input" inputMode="decimal" value={minOutlier} onChange={(e) => setMinOutlier(e.target.value.replace(/[^\d.]/g, ""))} placeholder="2" />
                </label>
              )}
              {hasStats && result.channels.length > 0 && (
                <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sắp xếp kênh">
                  <option value="default">Mặc định</option>
                  <option value="subs-asc">Sub ít → nhiều</option>
                  <option value="subs-desc">Sub nhiều → ít</option>
                  <option value="views-per-video">View / video cao</option>
                </select>
              )}
              <select className="select" value={groupId ?? ""} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)} aria-label="Lưu vào nhóm">
                <option value="">Lưu vào: không nhóm</option>
                {props.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    Lưu vào: {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {result.channels.length === 0 && result.videos.length === 0 && (
            <div className="nx-empty">Không có kết quả. Thử từ khoá rộng hơn, đổi “Tìm” sang Video, hoặc dùng một kênh gốc khác.</div>
          )}

          {channels.length > 0 && (
            <div className="nx-grid">
              {channels.map((c) => (
                <ChannelResult key={c.channelId} c={c} saved={isSaved(c.channelId)} saving={saving.has(c.channelId)} onSave={() => void save(c)} />
              ))}
            </div>
          )}
          {result.channels.length > 0 && channels.length === 0 && <div className="nx-empty">Không kênh nào khớp bộ lọc số sub.</div>}

          {videos.length > 0 && (
            <ul className="nx-videos">
              {videos.map((v, i) => (
                <VideoRow
                  key={`${v.videoId}-${i}`}
                  v={v}
                  saved={isSaved(v.channelId)}
                  saving={!!v.channelId && saving.has(v.channelId)}
                  onSave={() => v.channelId && void save({ channelId: v.channelId })}
                />
              ))}
            </ul>
          )}

          {result.continuation && lastSearch && (
            <button className="btn nx-more" onClick={() => void run(true)} disabled={!!busy}>
              {busy === "more" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}
              Tải thêm · 1 quota
            </button>
          )}
        </>
      )}
    </section>
  );
}

function SaveButton({ saved, saving, onSave, label = "Lưu" }: { saved: boolean; saving: boolean; onSave: () => void; label?: string }) {
  if (saved)
    return (
      <span className="pill ok nx-saved">
        <Check size={12} aria-hidden="true" /> Đã lưu
      </span>
    );
  return (
    <button className="btn btn-accent nx-save" onClick={onSave} disabled={saving}>
      {saving ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
      {label}
    </button>
  );
}

function ChannelResult({ c, saved, saving, onSave }: { c: NicheChannel; saved: boolean; saving: boolean; onSave: () => void }) {
  const [broken, setBroken] = useState(false);
  const url = c.handle ? `https://www.youtube.com/${c.handle}` : ytChannelUrl(c.channelId);
  const vpv = c.views && c.videos ? Math.round(c.views / c.videos) : null;
  return (
    <article className="nx-card">
      <div className="nx-card-head">
        <a href={url} target="_blank" rel="noreferrer" className="yt-avatar nx-avatar" aria-label={`Mở kênh ${c.title}`}>
          {c.avatar && !broken ? <img src={c.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <span>{c.title.slice(0, 1).toUpperCase()}</span>}
        </a>
        <div className="nx-name">
          <a href={url} target="_blank" rel="noreferrer" className="nx-link" title={c.title}>
            {c.title} <ExternalLink size={11} aria-hidden="true" />
          </a>
          <div className="nx-meta">
            {[c.handle, c.country, c.lastUpload && `đăng ${c.lastUpload}`].filter(Boolean).join(" · ") || c.channelId}
          </div>
        </div>
        <SaveButton saved={saved} saving={saving} onSave={onSave} />
      </div>

      {(c.subs != null || c.views != null || c.videos != null) && (
        <dl className="nx-stats">
          <div>
            <dt>Sub</dt>
            <dd>{fmt(c.subs)}</dd>
          </div>
          <div>
            <dt>View</dt>
            <dd>{fmt(c.views)}</dd>
          </div>
          <div>
            <dt>Video</dt>
            <dd>{fmt(c.videos)}</dd>
          </div>
          <div>
            <dt>View/video</dt>
            <dd>{fmt(vpv)}</dd>
          </div>
        </dl>
      )}

      {c.similarity != null && (
        <div className="nx-sim" title="Độ giống kênh gốc">
          <span>Độ giống</span>
          <div className="nx-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.similarity} aria-label="Độ giống kênh gốc">
            <i style={{ width: `${Math.min(100, Math.max(0, c.similarity))}%` }} />
          </div>
          <b>{Math.round(c.similarity)}</b>
        </div>
      )}

      {(c.tags.length > 0 || c.avgLength || c.ageDays != null) && (
        <div className="nx-tags">
          {c.avgLength && <span className="nx-tag">TB {c.avgLength}</span>}
          {c.ageDays != null && <span className="nx-tag">{c.ageDays < 365 ? `${c.ageDays} ngày tuổi` : `${(c.ageDays / 365).toFixed(1)} năm`}</span>}
          {c.hasShorts && <span className="nx-tag">có Shorts</span>}
          {c.tags.map((t) => (
            <span key={t} className="nx-tag">
              {t}
            </span>
          ))}
        </div>
      )}

      {c.description && !c.subs && <p className="nx-desc">{c.description}</p>}
    </article>
  );
}

function VideoRow({ v, saved, saving, onSave }: { v: NicheVideo; saved: boolean; saving: boolean; onSave: () => void }) {
  const href = v.isShort ? `https://www.youtube.com/shorts/${v.videoId}` : `https://www.youtube.com/watch?v=${v.videoId}`;
  const hot = (v.outlier ?? 0) >= 2;
  return (
    <li className="nx-video">
      <a href={href} target="_blank" rel="noreferrer" className="nx-thumb" aria-label={`Xem video ${v.title}`}>
        {v.thumb && <img src={v.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        {v.duration && <span className="nx-dur">{v.duration}</span>}
      </a>
      <div className="nx-vbody">
        <a href={href} target="_blank" rel="noreferrer" className="nx-vtitle">
          {v.title}
        </a>
        <div className="nx-meta">
          {v.channelTitle ?? "—"}
          {v.channelSubs != null && ` · ${fmt(v.channelSubs)} sub`}
          {v.published && ` · ${v.published}`}
        </div>
        <div className="nx-vstats">
          <span>
            <Eye size={12} aria-hidden="true" /> {fmt(v.views)} view
          </span>
          {v.vph != null && <span>{fmt(v.vph)} view/giờ</span>}
          {v.outlier != null && (
            <span className={`nx-outlier${hot ? " hot" : ""}`} title="Số lần vượt trung bình của kênh">
              ×{v.outlier}
            </span>
          )}
        </div>
      </div>
      {v.channelId && <SaveButton saved={saved} saving={saving} onSave={onSave} label="Lưu kênh" />}
    </li>
  );
}
