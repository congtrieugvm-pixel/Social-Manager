"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { patchJson, postJson, safeJson } from "@/lib/req-body";

// Bookmark Key: saved links of any kind. YouTube channels, TikTok profiles
// and sites with an RSS/Atom feed are tracked: a small red badge counts items
// published since the bookmark was last opened, and opening it (or an item)
// clears it. Other links are just saved with their title and icon. Bookmarks
// go into groups that carry a note. Tracked ones are re-checked when older
// than 30 minutes, every 30 minutes while the page is open, or on demand.

interface Video {
  id: string;
  title: string;
  published: string;
  /** Item link; YouTube items have none (built from the video id). */
  url?: string;
}

interface Channel {
  id: number;
  channelId: string;
  kind: Kind;
  title: string;
  handle: string | null;
  avatar: string | null;
  url: string;
  groupId: number | null;
  note: string | null;
  videos: Video[];
  lastSeenAt: number;
  checkedAt: number | null;
  checkError: string | null;
  unread: number;
}

interface Group {
  id: number;
  name: string;
  color: string;
  note: string | null;
}

type Kind = "youtube" | "tiktok" | "feed" | "link";

const KIND_LABEL: Record<Kind, string> = { youtube: "YouTube", tiktok: "TikTok", feed: "RSS", link: "Link" };
const ITEM_NOUN: Record<Kind, string> = { youtube: "video", tiktok: "video", feed: "bài", link: "bài" };

type AddResult = { input: string; status: "added" | "exists" | "error"; channel?: Channel; error?: string };

const STALE_S = 30 * 60;
const REFRESH_CHUNK = 8; // = server MAX in /api/youtube/refresh
const COLORS = ["#5e6ad2", "#3fb950", "#d29922", "#f85149", "#db61a2", "#39c5cf", "#a371f7", "#8a8a8a"];
const UNGROUPED = -1;

function ago(iso: string | number): string {
  const t = typeof iso === "number" ? iso * 1000 : Date.parse(iso);
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} ngày trước`;
  return new Date(t).toLocaleDateString("vi-VN");
}

const isNew = (v: Video, c: Channel) => Date.parse(v.published) / 1000 > c.lastSeenAt;
const itemUrl = (v: Video, c: Channel) => v.url ?? (c.kind === "youtube" ? `https://www.youtube.com/watch?v=${v.id}` : c.url);
const tracked = (c: Channel) => c.kind !== "link";

export default function YoutubePage() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<number | null>(null); // null = all
  const [query, setQuery] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [refreshing, setRefreshing] = useState<{ done: number; total: number } | null>(null);
  const refreshingRef = useRef(false);
  const channelsRef = useRef<Channel[] | null>(null);
  channelsRef.current = channels;

  const load = useCallback(async () => {
    const res = await fetch("/api/youtube/channels", { cache: "no-store" });
    const data = await safeJson<{ channels: Channel[]; groups: Group[] }>(res);
    if (data.error) {
      setError(data.error);
      setChannels((c) => c ?? []);
      return null;
    }
    setError(null);
    setChannels(data.channels);
    setGroups(data.groups);
    return data.channels;
  }, []);

  const mergeChannels = useCallback((list: Channel[]) => {
    const byId = new Map(list.map((c) => [c.id, c]));
    setChannels((cur) => (cur ? cur.map((c) => byId.get(c.id) ?? c) : cur));
  }, []);

  const refresh = useCallback(
    async (ids?: number[]) => {
      if (refreshingRef.current) return;
      const all = ids ?? (channelsRef.current ?? []).filter(tracked).map((c) => c.id);
      if (!all.length) return;
      refreshingRef.current = true;
      setRefreshing({ done: 0, total: all.length });
      const chunks: number[][] = [];
      for (let i = 0; i < all.length; i += REFRESH_CHUNK) chunks.push(all.slice(i, i + REFRESH_CHUNK));
      let done = 0;
      let next = 0;
      try {
        await Promise.all(
          Array.from({ length: Math.min(2, chunks.length) }, async () => {
            while (next < chunks.length) {
              const chunk = chunks[next++];
              const res = await postJson("/api/youtube/refresh", { ids: chunk });
              const data = await safeJson<{ channels: Channel[] }>(res);
              if (data.error) setError(data.error);
              else mergeChannels(data.channels);
              done += chunk.length;
              setRefreshing({ done, total: all.length });
            }
          }),
        );
      } finally {
        refreshingRef.current = false;
        setRefreshing(null);
      }
    },
    [mergeChannels],
  );

  // Load, then re-check feeds that are older than 30 minutes; repeat while open.
  useEffect(() => {
    const checkStale = () => {
      const now = Date.now() / 1000;
      const stale = (channelsRef.current ?? []).filter((c) => tracked(c) && (!c.checkedAt || now - c.checkedAt > STALE_S)).map((c) => c.id);
      if (stale.length) void refresh(stale);
    };
    void load().then(checkStale);
    const t = setInterval(checkStale, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load, refresh]);

  const markSeen = useCallback((c: Channel) => {
    if (!c.unread) return;
    const now = Math.ceil(Date.now() / 1000); // same rounding as the server
    setChannels((cur) => (cur ? cur.map((x) => (x.id === c.id ? { ...x, unread: 0, lastSeenAt: now } : x)) : cur));
    void fetch(`/api/youtube/channels/${c.id}`, { method: "POST" })
      .then((r) => safeJson<{ channel: Channel }>(r))
      .then((d) => d.channel && mergeChannels([d.channel]));
  }, [mergeChannels]);

  const updateChannel = useCallback(
    async (c: Channel, patch: { groupId?: number | null; note?: string }) => {
      const res = await patchJson(`/api/youtube/channels/${c.id}`, patch);
      const data = await safeJson<{ channel: Channel }>(res);
      if (data.error) setError(data.error);
      else mergeChannels([data.channel]);
    },
    [mergeChannels],
  );

  const removeChannel = useCallback(async (c: Channel) => {
    if (!confirm(`Xoá "${c.title}" khỏi Bookmark?`)) return;
    const res = await fetch(`/api/youtube/channels/${c.id}`, { method: "DELETE" });
    const data = await safeJson(res);
    if (data.error) setError(data.error);
    else setChannels((cur) => (cur ? cur.filter((x) => x.id !== c.id) : cur));
  }, []);

  const stats = useMemo(() => {
    const m = new Map<number, { count: number; unread: number }>();
    for (const c of channels ?? []) {
      const k = c.groupId ?? UNGROUPED;
      const s = m.get(k) ?? { count: 0, unread: 0 };
      s.count++;
      s.unread += c.unread;
      m.set(k, s);
    }
    return m;
  }, [channels]);

  const totalUnread = useMemo(() => (channels ?? []).reduce((s, c) => s + c.unread, 0), [channels]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (channels ?? [])
      .filter((c) => filter === null || (c.groupId ?? UNGROUPED) === filter)
      .filter((c) => !onlyNew || c.unread > 0)
      .filter((c) => !q || [c.title, c.handle ?? "", c.note ?? "", c.url].some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => b.unread - a.unread || (b.videos[0]?.published ?? "").localeCompare(a.videos[0]?.published ?? ""));
  }, [channels, filter, onlyNew, query]);

  const activeGroup = filter !== null && filter !== UNGROUPED ? groups.find((g) => g.id === filter) : undefined;

  return (
    <>
      <header className="page-header">
        <div className="page-header-left">
          <span className="eyebrow">Bookmark · Lưu link & theo dõi bài mới</span>
          <h1 className="h1-serif">
            Bookmark <em>Key</em>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => void refresh()} disabled={!!refreshing || !channels?.some(tracked)}>
            {refreshing ? `Đang kiểm tra ${refreshing.done}/${refreshing.total}…` : "⟳ Kiểm tra bài mới"}
          </button>
          <button className={`btn${showGroups ? " btn-accent" : ""}`} onClick={() => setShowGroups((v) => !v)}>
            Nhóm ({groups.length})
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd((v) => !v)}>
            + Thêm link
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="card yt-alert">
          {error}
          <button className="btn" onClick={() => setError(null)}>Đóng</button>
        </div>
      )}

      {showAdd && (
        <AddForm
          groups={groups}
          defaultGroup={activeGroup?.id ?? null}
          onAdded={(list) => {
            setChannels((cur) => {
              const have = new Set((cur ?? []).map((c) => c.id));
              return [...list.filter((c) => !have.has(c.id)), ...(cur ?? [])];
            });
          }}
        />
      )}

      {showGroups && (
        <GroupManager
          groups={groups}
          stats={stats}
          onChange={(g) => setGroups(g)}
          onDeleted={(id) => {
            setChannels((cur) => (cur ? cur.map((c) => (c.groupId === id ? { ...c, groupId: null } : c)) : cur));
            if (filter === id) setFilter(null);
          }}
          onError={setError}
        />
      )}

      <div className="yt-bar">
        <div className="yt-groups">
          <GroupChip label="Tất cả" active={filter === null} count={channels?.length ?? 0} unread={totalUnread} onClick={() => setFilter(null)} />
          {groups.map((g) => (
            <GroupChip
              key={g.id}
              label={g.name}
              color={g.color}
              active={filter === g.id}
              count={stats.get(g.id)?.count ?? 0}
              unread={stats.get(g.id)?.unread ?? 0}
              onClick={() => setFilter(g.id)}
            />
          ))}
          {(stats.get(UNGROUPED)?.count ?? 0) > 0 && groups.length > 0 && (
            <GroupChip
              label="Chưa có nhóm"
              active={filter === UNGROUPED}
              count={stats.get(UNGROUPED)?.count ?? 0}
              unread={stats.get(UNGROUPED)?.unread ?? 0}
              onClick={() => setFilter(UNGROUPED)}
            />
          )}
        </div>
        <div className="yt-tools">
          <input className="input" placeholder="Tìm tên / link / ghi chú…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label className="yt-check">
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> Chỉ mục có bài mới
          </label>
        </div>
      </div>

      {activeGroup?.note && (
        <div className="card yt-group-note" style={{ borderLeftColor: activeGroup.color }}>
          <strong>{activeGroup.name}:</strong> {activeGroup.note}
        </div>
      )}

      {channels === null ? (
        <div className="card mono" style={{ color: "var(--muted)", fontSize: 12 }}>Đang tải…</div>
      ) : channels.length === 0 ? (
        <div className="card" style={{ color: "var(--muted)", lineHeight: 1.6 }}>
          Chưa có link nào. Bấm <strong>+ Thêm link</strong> và dán link bất kì. Kênh YouTube, TikTok @profile và trang có RSS sẽ báo số đỏ khi có bài mới.
        </div>
      ) : visible.length === 0 ? (
        <div className="card" style={{ color: "var(--muted)" }}>Không có link nào khớp bộ lọc.</div>
      ) : (
        <div className="yt-grid">
          {visible.map((c) => (
            <ChannelCard
              key={c.id}
              c={c}
              groups={groups}
              onSeen={markSeen}
              onUpdate={updateChannel}
              onRemove={removeChannel}
              onRefresh={() => void refresh([c.id])}
            />
          ))}
        </div>
      )}
    </>
  );
}

function GroupChip(props: { label: string; color?: string; active: boolean; count: number; unread: number; onClick: () => void }) {
  return (
    <button className={`yt-chip${props.active ? " active" : ""}`} onClick={props.onClick}>
      {props.color && <span className="yt-dot" style={{ background: props.color }} />}
      {props.label}
      <span className="yt-chip-count">{props.count}</span>
      {props.unread > 0 && <span className="yt-badge">{props.unread > 99 ? "99+" : props.unread}</span>}
    </button>
  );
}

function AddForm({ groups, defaultGroup, onAdded }: { groups: Group[]; defaultGroup: number | null; onAdded: (c: Channel[]) => void }) {
  const [text, setText] = useState("");
  const [groupId, setGroupId] = useState<number | null>(defaultGroup);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<AddResult[]>([]);

  async function submit() {
    const links = text.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!links.length || busy) return;
    setBusy(true);
    setResults([]);
    const out: AddResult[] = [];
    try {
      // 3 links per request: a TikTok profile can take ~8 fetches and a
      // Worker call gets 50 subrequests.
      for (let i = 0; i < links.length; i += 3) {
        const res = await postJson("/api/youtube/channels", { links: links.slice(i, i + 3), groupId });
        const data = await safeJson<{ results: AddResult[] }>(res);
        const part: AddResult[] = data.error
          ? links.slice(i, i + 3).map((input) => ({ input, status: "error" as const, error: data.error }))
          : data.results;
        out.push(...part);
        setResults([...out]);
        onAdded(part.filter((r) => r.status === "added" && r.channel).map((r) => r.channel!));
      }
      const failed = out.filter((r) => r.status === "error").map((r) => r.input);
      setText(failed.join("\n"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card yt-add">
      <textarea
        className="textarea"
        rows={4}
        placeholder={"Dán link bất kì, mỗi dòng 1 link\nhttps://www.youtube.com/@tenkenh\nhttps://www.tiktok.com/@taikhoan\nhttps://vnexpress.net\nhttps://trang-bat-ki.com/bai-viet"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="yt-add-row">
        <select className="select" value={groupId ?? ""} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— Không nhóm —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !text.trim()}>
          {busy ? "Đang thêm…" : "Thêm"}
        </button>
      </div>
      {results.length > 0 && (
        <ul className="yt-results">
          {results.map((r, i) => (
            <li key={i}>
              <span className={`pill${r.status === "added" ? " ok" : r.status === "error" ? " err" : ""}`}>
                {r.status === "added" ? "Đã thêm" : r.status === "exists" ? "Đã có" : "Lỗi"}
              </span>
              <span className="yt-result-text">{r.channel?.title ?? r.input}</span>
              {r.error && <span className="yt-err">{r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupManager(props: {
  groups: Group[];
  stats: Map<number, { count: number; unread: number }>;
  onChange: (g: Group[]) => void;
  onDeleted: (id: number) => void;
  onError: (e: string) => void;
}) {
  const { groups, onChange, onError } = props;
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [note, setNote] = useState("");

  async function create() {
    if (!name.trim()) return;
    const res = await postJson("/api/youtube/groups", { name, color, note });
    const data = await safeJson<{ group: Group }>(res);
    if (data.error) return onError(data.error);
    onChange([...groups, data.group].sort((a, b) => a.name.localeCompare(b.name)));
    setName("");
    setNote("");
  }

  async function save(g: Group, patch: Partial<Group>) {
    const res = await patchJson(`/api/youtube/groups/${g.id}`, patch);
    const data = await safeJson<{ group: Group }>(res);
    if (data.error) return onError(data.error);
    onChange(groups.map((x) => (x.id === g.id ? data.group : x)));
  }

  async function remove(g: Group) {
    if (!confirm(`Xoá nhóm "${g.name}"? Các kênh trong nhóm sẽ thành "Chưa có nhóm".`)) return;
    const res = await fetch(`/api/youtube/groups/${g.id}`, { method: "DELETE" });
    const data = await safeJson(res);
    if (data.error) return onError(data.error);
    onChange(groups.filter((x) => x.id !== g.id));
    props.onDeleted(g.id);
  }

  return (
    <div className="card yt-gm">
      <div className="yt-gm-new">
        <input className="input" placeholder="Tên nhóm mới" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
        <ColorPick value={color} onChange={setColor} />
        <input className="input" placeholder="Ghi chú cho nhóm (tuỳ chọn)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-primary" onClick={() => void create()} disabled={!name.trim()}>Tạo nhóm</button>
      </div>
      {groups.map((g) => (
        <GroupRow key={g.id} g={g} count={props.stats.get(g.id)?.count ?? 0} onSave={save} onRemove={remove} />
      ))}
    </div>
  );
}

function GroupRow({ g, count, onSave, onRemove }: { g: Group; count: number; onSave: (g: Group, p: Partial<Group>) => void; onRemove: (g: Group) => void }) {
  const [name, setName] = useState(g.name);
  const [note, setNote] = useState(g.note ?? "");
  const dirty = name.trim() !== g.name || note.trim() !== (g.note ?? "");
  return (
    <div className="yt-gm-row">
      <ColorPick value={g.color} onChange={(color) => onSave(g, { color })} />
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Tên nhóm" />
      <textarea className="textarea" rows={1} value={note} placeholder="Ghi chú…" onChange={(e) => setNote(e.target.value)} aria-label="Ghi chú nhóm" />
      <span className="yt-chip-count">{count} link</span>
      <button className="btn btn-primary" disabled={!dirty || !name.trim()} onClick={() => onSave(g, { name, note })}>Lưu</button>
      <button className="btn btn-danger" onClick={() => onRemove(g)}>Xoá</button>
    </div>
  );
}

function ColorPick({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="yt-colors" role="radiogroup" aria-label="Màu nhóm">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          className={`yt-color${value === c ? " active" : ""}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

function ChannelCard(props: {
  c: Channel;
  groups: Group[];
  onSeen: (c: Channel) => void;
  onUpdate: (c: Channel, p: { groupId?: number | null; note?: string }) => void;
  onRemove: (c: Channel) => void;
  onRefresh: () => void;
}) {
  const { c, groups, onSeen, onUpdate } = props;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(c.note ?? "");
  useEffect(() => setNote(c.note ?? ""), [c.note]);
  const group = groups.find((g) => g.id === c.groupId);
  const latest = c.videos[0];
  const shown = open ? c.videos : c.videos.slice(0, Math.max(1, Math.min(c.unread, 5)));
  const [iconBroken, setIconBroken] = useState(false);
  const noun = ITEM_NOUN[c.kind] ?? "bài";

  return (
    <div className="card yt-card" style={group ? { borderTopColor: group.color } : undefined}>
      <div className="yt-head">
        <a href={c.url} target="_blank" rel="noreferrer" className="yt-avatar" onClick={() => onSeen(c)}>
          {c.avatar && !iconBroken ? (
            <img src={c.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setIconBroken(true)} />
          ) : (
            <span>{c.title.slice(0, 1).toUpperCase()}</span>
          )}
        </a>
        <div className="yt-title-wrap">
          <a href={c.url} target="_blank" rel="noreferrer" className="yt-title" onClick={() => onSeen(c)} title={c.url}>
            {c.title}
            {c.unread > 0 && <span className="yt-badge" aria-label={`${c.unread} ${noun} mới`}>{c.unread > 99 ? "99+" : c.unread}</span>}
          </a>
          <div className="yt-sub">
            <span className={`yt-kind ${c.kind}`}>{KIND_LABEL[c.kind] ?? "Link"}</span> {c.handle ?? c.channelId}
            {c.checkError ? <span className="yt-err" title={c.checkError}> · lỗi kiểm tra</span> : c.checkedAt ? <> · kiểm tra {ago(c.checkedAt)}</> : null}
          </div>
        </div>
        <div className="yt-actions">
          {tracked(c) && <button className="btn yt-icon" title="Kiểm tra lại" onClick={props.onRefresh}>⟳</button>}
          <button className="btn yt-icon" title="Xoá" onClick={() => props.onRemove(c)}>✕</button>
        </div>
      </div>

      {latest ? (
        <ul className="yt-videos">
          {shown.map((v) => (
            <li key={v.id} className={isNew(v, c) ? "new" : undefined}>
              <a href={itemUrl(v, c)} target="_blank" rel="noreferrer" onClick={() => onSeen(c)}>
                {isNew(v, c) && <span className="yt-new">Mới</span>}
                <span className="yt-vtitle">{v.title}</span>
              </a>
              <span className="yt-when">{ago(v.published)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="yt-sub yt-wrap">{tracked(c) ? `Chưa có ${noun} nào.` : c.url}</div>
      )}
      {c.videos.length > shown.length || open ? (
        <button className="yt-more" onClick={() => setOpen((v) => !v)}>
          {open ? "Thu gọn" : `Xem ${c.videos.length} ${noun} gần nhất`}
        </button>
      ) : null}

      <div className="yt-foot">
        <select className="select" value={c.groupId ?? ""} onChange={(e) => onUpdate(c, { groupId: e.target.value ? Number(e.target.value) : null })} aria-label="Nhóm">
          <option value="">— Không nhóm —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <input
          className="input"
          placeholder="Ghi chú…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note.trim() !== (c.note ?? "") && onUpdate(c, { note })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label="Ghi chú"
        />
      </div>
    </div>
  );
}
