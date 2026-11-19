"use client";

import { useMemo, useState } from "react";
import { postJson, safeJson } from "@/lib/req-body";
import { Check, ExternalLink, Eye, Loader2, Plus, Search, Sparkles } from "lucide-react";
import type { NicheChannel, NicheVideo } from "@/lib/nexlev";

// "Tìm ngách" panel on Bookmark Key: search YouTube niches through NexLev
// (/api/nexlev) and save the channels you like as YouTube bookmarks.
//   Niche Finder    — NexLev's curated channel DB, semantic + rich filters (MCP)
//   Outliers        — faceless videos far above their channel average (MCP)
//   Chủ đề          — live YouTube search (1 quota / page)
//   Kênh tương tự   — channels like a competitor, with stats (20 quota)
//   Phân tích ngách — similar channels + their outlier videos (20 quota)
// Server-side filters go to NexLev; the toolbar filters run on loaded results.

type Mode = "finder" | "outliers" | "search" | "similar" | "niche";
type Group = { id: number; name: string };

interface Result {
  source?: { id: string; title: string | null };
  channels: NicheChannel[];
  videos: NicheVideo[];
  continuation?: string | null;
  hasMore?: boolean;
  total?: number | null;
  topicTags?: string[];
}

const MODES: { id: Mode; label: string; cost: string; hint: string; mcp?: boolean }[] = [
  { id: "finder", label: "Niche Finder", cost: "MCP", mcp: true, hint: "Tìm kênh trong kho 50.000+ kênh NexLev theo ý nghĩa chủ đề, lọc sub, doanh thu, RPM, faceless…" },
  { id: "outliers", label: "Outliers", cost: "MCP", mcp: true, hint: "Video faceless vượt xa trung bình kênh của nó — tín hiệu một format đang ăn." },
  { id: "search", label: "YouTube", cost: "1q", hint: "Tìm trực tiếp trên YouTube theo chủ đề (kênh, video dài, Shorts)." },
  { id: "similar", label: "Kênh tương tự", cost: "20q", hint: "Dán link kênh đối thủ — lấy các kênh cùng ngách kèm số liệu." },
  { id: "niche", label: "Phân tích ngách", cost: "20q", hint: "Dán link kênh — xem video bùng nổ của cả ngách quanh kênh đó." },
];
const QUOTA: Partial<Record<Mode, number>> = { search: 1, similar: 20, niche: 20 };

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(Math.round(n));
const usd = (n: number | null | undefined) => (n == null ? "—" : `$${fmt(n)}`);
const ytChannelUrl = (id: string) => `https://www.youtube.com/channel/${id}`;

/** "90" → YYYY-MM-DD of 90 days ago, "" → undefined. */
const since = (days: string) => (days ? new Date(Date.now() - Number(days) * 86400000).toISOString().slice(0, 10) : undefined);
const numOrUndef = (s: string) => (s.trim() && Number.isFinite(Number(s)) ? Number(s) : undefined);
const digits = (s: string) => s.replace(/[^\d.]/g, "");

export default function NichePanel(props: { groups: Group[]; savedIds: Set<string>; onSaved: (channels: unknown[]) => void }) {
  const [mode, setMode] = useState<Mode>("finder");
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("");

  // Niche Finder filters
  const [fMinSubs, setFMinSubs] = useState("");
  const [fMaxSubs, setFMaxSubs] = useState("");
  const [fRevenue, setFRevenue] = useState("");
  const [fRpm, setFRpm] = useState("");
  const [fAge, setFAge] = useState("");
  const [fActive, setFActive] = useState("30");
  const [fFaceless, setFFaceless] = useState(false);
  const [fMonetized, setFMonetized] = useState(false);
  const [fShorts, setFShorts] = useState(false);
  const [fSort, setFSort] = useState("");
  // Outlier filters
  const [oMin, setOMin] = useState("3");
  const [oMaxSubs, setOMaxSubs] = useState("");
  const [oType, setOType] = useState("");
  const [oSince, setOSince] = useState("90");
  const [oSort, setOSort] = useState("");
  // YouTube search / similar
  const [type, setType] = useState<"channel" | "video" | "shorts">("channel");
  const [uploadDate, setUploadDate] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [level, setLevel] = useState<1 | 2>(1);
  const [shortsOnly, setShortsOnly] = useState(false);

  const [busy, setBusy] = useState<"run" | "more" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [lastBody, setLastBody] = useState<Record<string, unknown> | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [usedQuota, setUsedQuota] = useState(0);
  const [mcpCalls, setMcpCalls] = useState(0);

  // Browser-side filters on loaded results
  const [minSubs, setMinSubs] = useState("");
  const [maxSubs, setMaxSubs] = useState("");
  const [minOutlier, setMinOutlier] = useState("");
  const [sort, setSort] = useState<"default" | "subs-asc" | "subs-desc" | "views-per-video" | "revenue">("default");

  const [groupId, setGroupId] = useState<number | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [justSaved, setJustSaved] = useState<Set<string>>(new Set());

  const cur = MODES.find((m) => m.id === mode)!;
  const needsChannel = mode === "similar" || mode === "niche";
  const canRun = needsChannel ? channel.trim().length > 0 : mode === "search" ? query.trim().length > 0 : true;

  function buildBody(): Record<string, unknown> {
    switch (mode) {
      case "finder":
        return {
          mode,
          query,
          minSubscribers: numOrUndef(fMinSubs),
          maxSubscribers: numOrUndef(fMaxSubs),
          minMonthlyRevenue: numOrUndef(fRevenue),
          minRpm: numOrUndef(fRpm),
          channelCreatedAfter: since(fAge),
          lastUploadAfter: since(fActive),
          isFaceless: fFaceless || undefined,
          isMonetizationEnabled: fMonetized || undefined,
          isShortsOnly: fShorts || undefined,
          sortBy: fSort || undefined,
        };
      case "outliers":
        return {
          mode,
          query,
          minOutlierScore: numOrUndef(oMin),
          maxSubscribers: numOrUndef(oMaxSubs),
          videoType: oType || undefined,
          minUploadDate: since(oSince),
          sortBy: !query.trim() && oSort ? oSort : undefined,
        };
      case "search":
        return { mode, query, type, uploadDate: uploadDate || undefined, sortBy: sortBy || undefined };
      case "similar":
        return { mode, channel, level, channelType: shortsOnly ? "short" : "all" };
      case "niche":
        return { mode, channel };
    }
  }

  async function run(more = false) {
    if (busy || (!more && !canRun)) return;
    const body = more && lastBody ? { ...lastBody } : buildBody();
    const nextPage = more ? pageNo + 1 : 1;
    if (more) {
      if (body.mode === "search") body.token = result?.continuation;
      else body.page = nextPage;
    }
    setBusy(more ? "more" : "run");
    setError(null);
    try {
      const res = await postJson("/api/nexlev", body);
      const data = await safeJson<Result>(res);
      if (data.error) {
        setError(data.error);
        return;
      }
      const m = body.mode as Mode;
      if (MODES.find((x) => x.id === m)?.mcp) setMcpCalls((n) => n + 1);
      else setUsedQuota((q) => q + (QUOTA[m] ?? 0));
      setPageNo(nextPage);
      if (more && result) {
        setResult({
          ...result,
          channels: [...result.channels, ...data.channels.filter((c) => !result.channels.some((x) => x.channelId === c.channelId))],
          videos: [...result.videos, ...data.videos.filter((v) => !result.videos.some((x) => x.videoId === v.videoId))],
          continuation: data.continuation ?? null,
          hasMore: data.hasMore,
        });
      } else {
        setResult(data);
        setLastBody(body);
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
    const list = result.channels.filter((c) => (c.subs == null ? !minSubs && !maxSubs : c.subs >= lo && c.subs <= hi));
    const vpv = (c: NicheChannel) => c.avgViews ?? (c.views && c.videos ? c.views / c.videos : 0);
    if (sort === "subs-asc") list.sort((a, b) => (a.subs ?? Infinity) - (b.subs ?? Infinity));
    if (sort === "subs-desc") list.sort((a, b) => (b.subs ?? 0) - (a.subs ?? 0));
    if (sort === "views-per-video") list.sort((a, b) => vpv(b) - vpv(a));
    if (sort === "revenue") list.sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
    return list;
  }, [result, minSubs, maxSubs, sort]);

  const videos = useMemo(() => {
    if (!result) return [];
    const min = Number(minOutlier) || 0;
    const lo = Number(minSubs) || 0;
    const hi = Number(maxSubs) || Infinity;
    return result.videos.filter((v) => (v.outlier ?? Infinity) >= min && (v.channelSubs == null || (v.channelSubs >= lo && v.channelSubs <= hi)));
  }, [result, minOutlier, minSubs, maxSubs]);

  const hasStats = result?.channels.some((c) => c.subs != null) || result?.videos.some((v) => v.channelSubs != null);
  const hasOutlier = result?.videos.some((v) => v.outlier != null);
  const hasRevenue = result?.channels.some((c) => c.revenue != null);
  const canMore = !!lastBody && (lastBody.mode === "search" ? !!result?.continuation : !!result?.hasMore);

  return (
    <section className="card nx" aria-labelledby="nx-title">
      <div className="nx-head">
        <div>
          <h2 id="nx-title" className="nx-title">
            <Sparkles size={16} aria-hidden="true" /> Tìm ngách · NexLev
          </h2>
          <p className="nx-hint">{cur.hint}</p>
        </div>
        {(usedQuota > 0 || mcpCalls > 0) && (
          <span className="nx-quota" title="Đã dùng trong phiên này: quota API và lượt gọi MCP (giới hạn theo tuần)">
            {[usedQuota > 0 && `${usedQuota} quota`, mcpCalls > 0 && `${mcpCalls} lượt MCP`].filter(Boolean).join(" · ")}
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
            {m.label} <span className="nx-cost">{m.cost}</span>
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
        {needsChannel ? (
          <label className="nx-field nx-grow">
            <span>Kênh gốc</span>
            <input className="input" aria-label="Kênh gốc" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="https://www.youtube.com/@tenkenh hoặc UC…" />
          </label>
        ) : (
          <label className="nx-field nx-grow">
            <span>{mode === "search" ? "Chủ đề" : "Chủ đề (để trống = duyệt theo bộ lọc)"}</span>
            <input
              className="input"
              aria-label="Chủ đề"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === "outliers" ? "vd: reddit revenge stories, ancient history AI narrated…" : "vd: stoic philosophy, kể chuyện lịch sử, true crime UK…"}
            />
          </label>
        )}

        {mode === "finder" && (
          <>
            <NumField label="Sub từ" value={fMinSubs} onChange={setFMinSubs} placeholder="0" />
            <NumField label="Sub đến" value={fMaxSubs} onChange={setFMaxSubs} placeholder="∞" />
            <NumField label="Doanh thu ≥ $/tháng" value={fRevenue} onChange={setFRevenue} placeholder="vd 500" />
            <NumField label="RPM ≥ $" value={fRpm} onChange={setFRpm} placeholder="vd 5" />
            <SelectField label="Kênh tạo trong" value={fAge} onChange={setFAge} options={[["", "Mọi lúc"], ["90", "3 tháng"], ["180", "6 tháng"], ["365", "1 năm"], ["730", "2 năm"]]} />
            <SelectField label="Còn đăng trong" value={fActive} onChange={setFActive} options={[["", "Bất kỳ"], ["7", "7 ngày"], ["30", "30 ngày"], ["90", "90 ngày"]]} />
            <SelectField
              label="Sắp xếp"
              value={fSort}
              onChange={setFSort}
              options={[["", "Liên quan"], ["subscribers", "Sub"], ["avgViewsPerVideo", "View TB/video"], ["totalRevenue", "Doanh thu"], ["createdAt", "Mới vào NexLev"]]}
            />
            <div className="nx-checks">
              <label className="yt-check"><input type="checkbox" checked={fFaceless} onChange={(e) => setFFaceless(e.target.checked)} /> Faceless</label>
              <label className="yt-check"><input type="checkbox" checked={fMonetized} onChange={(e) => setFMonetized(e.target.checked)} /> Đã bật kiếm tiền</label>
              <label className="yt-check"><input type="checkbox" checked={fShorts} onChange={(e) => setFShorts(e.target.checked)} /> Chỉ Shorts</label>
            </div>
          </>
        )}

        {mode === "outliers" && (
          <>
            <NumField label="Outlier tối thiểu (×)" value={oMin} onChange={setOMin} placeholder="3" />
            <NumField label="Sub kênh tối đa" value={oMaxSubs} onChange={setOMaxSubs} placeholder="vd 50000" />
            <SelectField label="Loại" value={oType} onChange={setOType} options={[["", "Tất cả"], ["long", "Video dài"], ["shorts", "Shorts"]]} />
            <SelectField label="Đăng trong" value={oSince} onChange={setOSince} options={[["", "Mọi lúc"], ["30", "30 ngày"], ["90", "90 ngày"], ["365", "1 năm"]]} />
            <SelectField
              label={query.trim() ? "Sắp xếp (theo độ liên quan)" : "Sắp xếp"}
              value={query.trim() ? "" : oSort}
              onChange={setOSort}
              disabled={!!query.trim()}
              options={[["", "Outlier cao"], ["videoViews", "Nhiều view"], ["videoPublishedAt", "Mới đăng"], ["channelSubCount", "Kênh lớn"]]}
            />
          </>
        )}

        {mode === "search" && (
          <>
            <SelectField label="Tìm" value={type} onChange={(v) => setType(v as typeof type)} options={[["channel", "Kênh"], ["video", "Video dài"], ["shorts", "Shorts"]]} />
            <SelectField label="Đăng trong" value={uploadDate} onChange={setUploadDate} options={[["", "Mọi lúc"], ["today", "Hôm nay"], ["week", "Tuần này"], ["month", "Tháng này"], ["year", "Năm nay"]]} />
            <SelectField label="Sắp xếp" value={sortBy} onChange={setSortBy} options={[["", "Liên quan"], ["views", "Nhiều view"], ["date", "Mới nhất"], ["popularity", "Phổ biến"]]} />
          </>
        )}

        {mode === "similar" && (
          <>
            <SelectField label="Mức tìm" value={String(level)} onChange={(v) => setLevel(Number(v) as 1 | 2)} options={[["1", "Nhanh"], ["2", "Vừa (lâu hơn)"]]} />
            <label className="yt-check nx-check">
              <input type="checkbox" checked={shortsOnly} onChange={(e) => setShortsOnly(e.target.checked)} /> Chỉ kênh Shorts
            </label>
          </>
        )}

        <button type="submit" className="btn btn-primary nx-run" disabled={!canRun || !!busy}>
          {busy === "run" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}
          {busy === "run" ? (needsChannel ? "Đang phân tích… (có thể 1–2 phút)" : "Đang tìm…") : cur.mcp ? "Tìm" : `Tìm · ${QUOTA[mode]} quota`}
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
              {result.channels.length > 0 && (
                <span>
                  {channels.length}/{result.channels.length} kênh
                </span>
              )}
              {result.channels.length > 0 && result.videos.length > 0 && " · "}
              {result.videos.length > 0 && (
                <span>
                  {videos.length}/{result.videos.length} video
                </span>
              )}
              {result.total != null && result.total > 0 && <span className="nx-total"> · NexLev có {fmt(result.total)}{result.hasMore ? "+" : ""} kết quả</span>}
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
                  <input className="input" inputMode="decimal" value={minOutlier} onChange={(e) => setMinOutlier(digits(e.target.value))} placeholder="2" />
                </label>
              )}
              {hasStats && result.channels.length > 0 && (
                <select className="select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sắp xếp kênh">
                  <option value="default">Mặc định</option>
                  <option value="subs-asc">Sub ít → nhiều</option>
                  <option value="subs-desc">Sub nhiều → ít</option>
                  <option value="views-per-video">View / video cao</option>
                  {hasRevenue && <option value="revenue">Doanh thu cao</option>}
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

          {result.topicTags && result.topicTags.length > 0 && (
            <div className="nx-tags" aria-label="Chủ đề liên quan">
              {result.topicTags.map((t) => (
                <button key={t} type="button" className="nx-tag nx-tag-btn" onClick={() => setQuery(t)} title="Dùng làm chủ đề tìm">
                  {t}
                </button>
              ))}
            </div>
          )}

          {result.channels.length === 0 && result.videos.length === 0 && (
            <div className="nx-empty">Không có kết quả. Thử bỏ bớt bộ lọc, dùng chủ đề rộng hơn, hoặc để trống chủ đề để duyệt theo số liệu.</div>
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

          {canMore && (
            <button className="btn nx-more" onClick={() => void run(true)} disabled={!!busy}>
              {busy === "more" ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}
              Tải thêm{lastBody?.mode === "search" ? " · 1 quota" : ""}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function NumField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="nx-field nx-num">
      <span>{label}</span>
      <input className="input" aria-label={label} inputMode="decimal" value={value} onChange={(e) => onChange(digits(e.target.value))} placeholder={placeholder} />
    </label>
  );
}

function SelectField(props: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; disabled?: boolean }) {
  return (
    <label className="nx-field">
      <span>{props.label}</span>
      <select className="select" aria-label={props.label} value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
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
  const vpv = c.avgViews ?? (c.views && c.videos ? Math.round(c.views / c.videos) : null);
  const finder = c.revenue !== undefined; // Niche Finder rows carry money stats
  const stats: [string, string][] = finder
    ? [
        ["Sub", fmt(c.subs)],
        ["View/video", fmt(vpv)],
        ["$/tháng", usd(c.revenue)],
        ["RPM", c.rpm == null ? "—" : `$${c.rpm}`],
      ]
    : [
        ["Sub", fmt(c.subs)],
        ["View", fmt(c.views)],
        ["Video", fmt(c.videos)],
        ["View/video", fmt(vpv)],
      ];
  const showStats = c.subs != null || c.views != null || c.videos != null;
  // Category + tags, case-insensitively de-duplicated.
  const topics = [...new Map([c.category, ...c.tags].filter((t): t is string => !!t).map((t) => [t.toLowerCase(), t])).values()].slice(0, 5);
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
          <div className="nx-meta">{[c.handle, c.country, c.lastUpload && `đăng ${c.lastUpload}`].filter(Boolean).join(" · ") || c.channelId}</div>
        </div>
        <SaveButton saved={saved} saving={saving} onSave={onSave} />
      </div>

      {showStats && (
        <dl className="nx-stats">
          {stats.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {c.similarity != null && (
        <div className="nx-sim" title={finder ? "Độ khớp với chủ đề" : "Độ giống kênh gốc"}>
          <span>{finder ? "Độ khớp" : "Độ giống"}</span>
          <div className="nx-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.similarity} aria-label={finder ? "Độ khớp với chủ đề" : "Độ giống kênh gốc"}>
            <i style={{ width: `${Math.min(100, Math.max(0, c.similarity))}%` }} />
          </div>
          <b>{Math.round(c.similarity)}</b>
        </div>
      )}

      <div className="nx-tags">
        {c.outlier != null && c.outlier >= 1 && <span className={`nx-tag nx-flag${c.outlier >= 2 ? " hot" : ""}`}>Outlier ×{c.outlier}</span>}
        {c.faceless && <span className="nx-tag nx-flag">Faceless</span>}
        {c.monetized === true && <span className="nx-tag nx-flag">Kiếm tiền</span>}
        {c.monetized === false && <span className="nx-tag">Chưa kiếm tiền</span>}
        {c.uploadsPerWeek != null && c.uploadsPerWeek > 0 && <span className="nx-tag">{c.uploadsPerWeek} video/tuần</span>}
        {c.avgLength && <span className="nx-tag">TB {c.avgLength}</span>}
        {c.ageDays != null && <span className="nx-tag">{c.ageDays < 365 ? `${c.ageDays} ngày tuổi` : `${(c.ageDays / 365).toFixed(1)} năm`}</span>}
        {c.hasShorts && <span className="nx-tag">có Shorts</span>}
        {topics.map((t) => (
          <span key={t} className="nx-tag">
            {t}
          </span>
        ))}
      </div>

      {c.description && !showStats && <p className="nx-desc">{c.description}</p>}
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
          {v.channelAvg != null && <span>TB kênh {fmt(v.channelAvg)}</span>}
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
