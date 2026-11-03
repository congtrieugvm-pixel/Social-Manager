"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ArrowUpDown,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Film,
  Folder,
  FolderOpen,
  Play,
  MoreHorizontal,
  Inbox,
  SearchX,
  FolderMinus,
  Globe,
  Image as ImageIcon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  Tag,
  Trash2,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { generateTotpCode } from "@/lib/totp";
import { encodeBodyHeader } from "@/lib/req-body";
import { confirmDialog, notify, promptDialog } from "./_components/notify";
import { SkeletonRows } from "./_components/skeleton";
import { DensityToggle } from "./_components/density-toggle";
import { Sheet } from "./_components/sheet";

interface Video {
  id: string;
  caption: string;
  coverUrl: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  postedAt: number;
}

interface AccountRow {
  id: number;
  username: string;
  note: string | null;
  avatarUrl: string | null;
  followerCount: number | null;
  followingCount: number | null;
  videoCount: number | null;
  lastVideos: Video[] | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  hasPassword: boolean;
  hasEmail: boolean;
  has2fa: boolean;
  hasEmailPassword: boolean;
  createdAt: string;
  groupId: number | null;
  groupName: string | null;
  groupColor: string | null;
  statusId: number | null;
  statusName: string | null;
  statusColor: string | null;
  countryId: number | null;
  countryName: string | null;
  countryCode: string | null;
  countryColor: string | null;
  machineId: number | null;
  machineName: string | null;
  machineColor: string | null;
  employeeId: number | null;
  employeeName: string | null;
  employeeColor: string | null;
}

interface GroupRow {
  id: number;
  name: string;
  color: string;
  description: string | null;
  count: number;
}

interface StatusRow {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  count: number;
}

interface CountryRow {
  id: number;
  name: string;
  code: string | null;
  color: string;
  sortOrder: number;
  count: number;
}

interface MachineRow {
  id: number;
  name: string;
  color: string;
  note: string | null;
  sortOrder: number;
  count: number;
}

interface EmployeeRow {
  id: number;
  name: string;
  color: string;
  note: string | null;
  sortOrder: number;
  count: number;
}

interface DetailResponse {
  id: number;
  username: string;
  password: string | null;
  email: string | null;
  twofa: string | null;
  emailPassword: string | null;
  note: string | null;
  avatarUrl: string | null;
  lastVideos: Video[] | null;
  hasMsToken?: boolean;
  msEmail?: string | null;
  groupId: number | null;
  groupName: string | null;
  statusId: number | null;
  statusName: string | null;
  countryId: number | null;
  countryName: string | null;
  machineId: number | null;
  machineName: string | null;
  employeeId: number | null;
  employeeName: string | null;
}

type GroupFilter = "all" | "none" | number;

type SortKey =
  | "createdAt"
  | "username"
  | "group"
  | "status"
  | "country"
  | "machine"
  | "employee"
  | "follower"
  | "video";
type SortDir = "asc" | "desc";

/** Lists that classify accounts — each has its own management page. */
const CATALOG: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/groups", label: "Nhóm", icon: Folder },
  { href: "/statuses", label: "Trạng thái", icon: Tag },
  { href: "/countries", label: "Quốc gia", icon: Globe },
  { href: "/machines", label: "Máy", icon: Smartphone },
  { href: "/employees", label: "Nhân viên", icon: BriefcaseBusiness },
];

/** One bulk "change X" picker in the selection bar; resets after each pick. */
function BulkSelect({
  label,
  clearLabel,
  options,
  onPick,
}: {
  label: string;
  clearLabel?: string;
  options: Array<{ value: number; label: string }>;
  onPick: (value: number | null) => void;
}) {
  return (
    <select
      className="input bulk-select"
      value=""
      aria-label={label}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        onPick(v === "none" ? null : Number(v));
        e.target.value = "";
      }}
    >
      <option value="">{label}…</option>
      {clearLabel && <option value="none">{clearLabel}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

type ExportField = "username" | "password" | "email" | "twofa" | "emailPassword";

const EXPORT_FIELD_LABELS: Record<ExportField, string> = {
  username: "User",
  password: "Pass",
  email: "Email",
  twofa: "2FA",
  emailPassword: "Pass Email",
};

interface CtxMenuState {
  x: number;
  y: number;
  id: number;
  username: string;
  loading: boolean;
  detail: {
    username: string;
    password: string | null;
    email: string | null;
    twofa: string | null;
    emailPassword: string | null;
    hasMsToken: boolean;
    msEmail: string | null;
    groupId: number | null;
    groupName: string | null;
  } | null;
  error: string | null;
  hotmail: HotmailState;
  fetchAction: "follow" | "video" | null;
  fetchMessage: string | null;
  fetchError: string | null;
  browserLogin: "idle" | "loading";
  browserLoginMessage: string | null;
  browserLoginError: string | null;
}

type HotmailState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "needs-auth"; authUrl: string; message?: string }
  | { phase: "waiting-popup" }
  | {
      phase: "result";
      code: string;
      subject: string;
      from: string | null;
      receivedAt: string;
      snippet: string;
    }
  | { phase: "error"; message: string };

interface HistoryEntry {
  value: string | null;
  changedAt: number;
}

interface EditState {
  id: number;
  loading: boolean;
  saving: boolean;
  error: string | null;
  username: string;
  password: string;
  email: string;
  twofa: string;
  emailPassword: string;
  note: string;
  passwordHistory: HistoryEntry[];
  emailPasswordHistory: HistoryEntry[];
  showPassword: boolean;
  showEmailPassword: boolean;
}

const PAGE_SIZE = 50;

function ageShort(unixSec: number): string {
  const s = Math.max(0, Date.now() / 1000 - unixSec);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} phút`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ`;
  return `${Math.round(s / 86400)} ngày`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export default function Dashboard() {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [statusesList, setStatusesList] = useState<StatusRow[]>([]);
  const [countriesList, setCountriesList] = useState<CountryRow[]>([]);
  const [machinesList, setMachinesList] = useState<MachineRow[]>([]);
  const [employeesList, setEmployeesList] = useState<EmployeeRow[]>([]);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [fetchProgress, setFetchProgress] = useState<{ done: number; total: number; retry?: boolean } | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [search, setSearch] = useState("");
  const [pickFrom, setPickFrom] = useState<number>(1);
  const [pickTo, setPickTo] = useState<number>(10);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [idleCfg, setIdleCfg] = useIdleDaysSettings();
  const [idleCfgOpen, setIdleCfgOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((d) => {
        if (!d.contains(e.target as Node)) d.open = false;
      });
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const [exportOpen, setExportOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportText, setExportText] = useState("");
  const [exportCount, setExportCount] = useState(0);
  const [exportDelimiter, setExportDelimiter] = useState("|");
  const [exportFields, setExportFields] = useState<ExportField[]>([
    "username",
    "password",
    "email",
    "twofa",
    "emailPassword",
  ]);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  // Right-click menu positioning: see facebook/page.tsx for the same pattern.
  // Layout effect measures actual menu size and clamps to viewport so the
  // menu doesn't overflow off-screen near edges.
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const [ctxMenuPos, setCtxMenuPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    setCtxMenuPos(null);
  }, [ctxMenu?.id]);
  useLayoutEffect(() => {
    if (!ctxMenu || !ctxMenuRef.current) return;
    const m = ctxMenuRef.current.getBoundingClientRect();
    const margin = 8;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    let top = ctxMenu.y;
    let left = ctxMenu.x;
    if (top + m.height + margin > vh) top = Math.max(margin, vh - m.height - margin);
    if (left + m.width + margin > vw) left = Math.max(margin, vw - m.width - margin);
    setCtxMenuPos((prev) => {
      if (prev && prev.top === top && prev.left === left) return prev;
      return { top, left };
    });
  }, [ctxMenu]);
  const [edit, setEdit] = useState<EditState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      params.set("sort", sortKey);
      params.set("dir", sortDir);
      if (groupFilter === "none") params.set("group", "none");
      else if (groupFilter !== "all") params.set("group", String(groupFilter));

      const [accRes, grpRes, stRes, coRes, maRes, emRes] = await Promise.all([
        fetch(`/api/accounts?${params.toString()}`, { cache: "no-store" }),
        fetch("/api/groups", { cache: "no-store" }),
        fetch("/api/statuses", { cache: "no-store" }),
        fetch("/api/countries", { cache: "no-store" }),
        fetch("/api/machines", { cache: "no-store" }),
        fetch("/api/employees", { cache: "no-store" }),
      ]);
      const accData = (await accRes.json()) as {
        accounts: AccountRow[];
        total: number;
      };
      const grpData = (await grpRes.json()) as { groups: GroupRow[] };
      const stData = (await stRes.json()) as { statuses: StatusRow[] };
      const coData = (await coRes.json()) as { countries: CountryRow[] };
      const maData = (await maRes.json()) as { machines: MachineRow[] };
      const emData = (await emRes.json()) as { employees: EmployeeRow[] };
      setRows(accData.accounts);
      setTotal(accData.total);
      setGroups(grpData.groups);
      setStatusesList(stData.statuses);
      setCountriesList(coData.countries);
      setMachinesList(maData.machines);
      setEmployeesList(emData.employees);
    } finally {
      setLoading(false);
    }
  }, [groupFilter, page, sortKey, sortDir]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [groupFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "createdAt" || key === "follower" || key === "video" ? "desc" : "asc");
    }
  }

  useEffect(() => {
    if (!ctxMenu) return;
    function close() {
      setCtxMenu(null);
    }
    // On phones the menu is a bottom sheet: scrolling inside it, or the
    // keyboard opening (resize), must not close it.
    function onScroll(e: Event) {
      if (ctxMenuRef.current?.contains(e.target as Node)) return;
      if (window.innerWidth <= 768) return;
      close();
    }
    function onResize() {
      if (window.innerWidth > 768) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("click", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  const filtered = search.trim()
    ? rows.filter(
        (r) =>
          r.username.toLowerCase().includes(search.toLowerCase()) ||
          (r.note ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : rows;

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((r) => r.id)));
    }
  }

  // Shift + click selects (or clears) every row between the last click and this one.
  const lastIdxRef = useRef<number | null>(null);
  const shiftRef = useRef(false);
  function toggleAt(idx: number, id: number) {
    const last = lastIdxRef.current;
    if (shiftRef.current && last !== null && last !== idx) {
      const [a, b] = last < idx ? [last, idx] : [idx, last];
      const ids = filtered.slice(a, b + 1).map((x) => x.id);
      const on = !selected.has(id);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const i of ids) {
          if (on) next.add(i);
          else next.delete(i);
        }
        return next;
      });
    } else {
      toggleOne(id);
    }
    lastIdxRef.current = idx;
    shiftRef.current = false;
  }

  // Esc clears the selection (unless a dialog or menu is open, or you are typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || selected.size === 0) return;
      if (document.querySelector('[role="dialog"], details.menu[open], .idle-pop')) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.getAttribute("type") !== "checkbox") return;
      setSelected(new Set());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pickRange() {
    const from = Math.max(1, Math.floor(pickFrom) || 1);
    const to = Math.max(from, Math.floor(pickTo) || from);
    const offset = (page - 1) * PAGE_SIZE;
    const ids: number[] = [];
    filtered.forEach((r, idx) => {
      const stt = offset + idx + 1;
      if (stt >= from && stt <= to) ids.push(r.id);
    });
    if (ids.length === 0) {
      notify(`Không có tài khoản nào có STT từ ${from} đến ${to} trên trang hiện tại`);
      return;
    }
    setSelected(new Set(ids));
  }

  async function runFetchBulk(endpoint: "fetch-follow" | "fetch-videos" | "fetch-avatar") {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      notify("Chưa chọn tài khoản nào");
      return;
    }
    setAction(endpoint);
    setFetchProgress({ done: 0, total: ids.length });
    type Res = { id: number; username?: string; ok: boolean; error?: string; retryable?: boolean };
    const final = new Map<number, Res>();
    // Small chunks (the server takes ≤ 5 per call — Worker subrequest limit),
    // 3 calls in flight. Accounts TikTok refused only temporarily get a
    // second round after a pause.
    const runRound = async (list: number[], countProgress: boolean) => {
      const chunks: number[][] = [];
      for (let i = 0; i < list.length; i += 4) chunks.push(list.slice(i, i + 4));
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, chunks.length) }, async () => {
          while (next < chunks.length) {
            const chunk = chunks[next++];
            let results: Res[];
            try {
              const res = await fetch(`/api/accounts/${endpoint}`, {
                method: "POST",
                headers: { "X-Body": encodeBodyHeader({ ids: chunk }) },
              });
              const data = (await res.json().catch(() => ({}))) as { results?: Res[]; error?: string };
              results = data.results ?? chunk.map((id) => ({ id, ok: false, retryable: true, error: data.error ?? `HTTP ${res.status}` }));
            } catch (e) {
              results = chunk.map((id) => ({ id, ok: false, retryable: true, error: e instanceof Error ? e.message : String(e) }));
            }
            for (const r of results) final.set(r.id, r);
            if (countProgress) setFetchProgress((p) => (p ? { ...p, done: p.done + chunk.length } : p));
          }
        }),
      );
    };
    try {
      await runRound(ids, true);
      const retry = ids.filter((id) => final.get(id)?.ok === false && final.get(id)?.retryable !== false);
      if (retry.length > 0) {
        setFetchProgress({ done: 0, total: retry.length, retry: true });
        await new Promise((r) => setTimeout(r, 2000));
        await runRound(retry, true);
      }
      const all = ids.map((id) => final.get(id)).filter((r): r is Res => !!r);
      const failed = all.filter((r) => !r.ok);
      if (failed.length === 0) {
        notify(`Hoàn tất: ${all.length}/${all.length} thành công`);
      } else {
        const lines = failed.slice(0, 8).map((r) => `• ${r.username ?? `#${r.id}`}: ${r.error ?? "lỗi"}`);
        if (failed.length > 8) lines.push(`… và ${failed.length - 8} tài khoản khác`);
        notify.warn(`Hoàn tất: ${all.length - failed.length}/${all.length} thành công\n\nChưa lấy được:\n${lines.join("\n")}`);
      }
      await load();
    } finally {
      setAction(null);
      setFetchProgress(null);
    }
  }

  const fetchLabel = (endpoint: string, idle: string) =>
    action !== endpoint
      ? idle
      : fetchProgress
        ? `${fetchProgress.retry ? "Thử lại" : "Đang lấy"} ${fetchProgress.done}/${fetchProgress.total}…`
        : "Đang lấy…";
  // Phone action bar: just "3/9" while running (the spinning icon says what is running).
  const fetchLabelShort = (endpoint: string, idle: string) =>
    action !== endpoint ? idle : fetchProgress ? `${fetchProgress.done}/${fetchProgress.total}` : "…";

  async function moveSelectedToGroup(newGroupId: number | null) {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      notify("Chưa chọn tài khoản nào");
      return;
    }
    await fetch(`/api/accounts/move-group`, {
      method: "POST",
      headers: { "X-Body": encodeBodyHeader({ ids, groupId: newGroupId }) },
    });
    setSelected(new Set());
    await load();
  }

  async function updateSelectedStatus(statusId: number | null) {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      notify("Chưa chọn tài khoản nào");
      return;
    }
    await fetch(`/api/accounts/bulk-update`, {
      method: "POST",
      headers: { "X-Body": encodeBodyHeader({ ids, statusId }) },
    });
    setSelected(new Set());
    await load();
  }

  async function updateSelectedCountry(countryId: number | null) {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      notify("Chưa chọn tài khoản nào");
      return;
    }
    await fetch(`/api/accounts/bulk-update`, {
      method: "POST",
      headers: { "X-Body": encodeBodyHeader({ ids, countryId }) },
    });
    setSelected(new Set());
    await load();
  }

  async function updateSelectedMachine(machineId: number | null) {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      notify("Chưa chọn tài khoản nào");
      return;
    }
    await fetch(`/api/accounts/bulk-update`, {
      method: "POST",
      headers: { "X-Body": encodeBodyHeader({ ids, machineId }) },
    });
    setSelected(new Set());
    await load();
  }

  async function updateSelectedEmployee(employeeId: number | null) {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      notify("Chưa chọn tài khoản nào");
      return;
    }
    await fetch(`/api/accounts/bulk-update`, {
      method: "POST",
      headers: { "X-Body": encodeBodyHeader({ ids, employeeId }) },
    });
    setSelected(new Set());
    await load();
  }

  async function removeSelectedFromGroup() {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      notify("Chưa chọn tài khoản nào");
      return;
    }
    if (!(await confirmDialog({ message: `Bỏ ${ids.length} tài khoản khỏi nhóm hiện tại? Tài khoản vẫn được giữ.`, confirmLabel: "Bỏ khỏi nhóm" }))) return;
    await moveSelectedToGroup(null);
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      notify("Chưa chọn tài khoản nào");
      return;
    }
    if (
      !(await confirmDialog({
        title: "Xoá vĩnh viễn",
        message: `Xoá vĩnh viễn ${ids.length} tài khoản? Không thể hoàn tác.`,
        confirmLabel: `Xoá ${ids.length} tài khoản`,
        danger: true,
      }))
    )
      return;
    setAction("delete");
    try {
      const res = await fetch(`/api/accounts/bulk-delete`, {
        method: "POST",
        headers: { "X-Body": encodeBodyHeader({ ids }) },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Lỗi" }));
        notify(err.error ?? "Lỗi xóa tài khoản");
        return;
      }
      setSelected(new Set());
      await load();
    } finally {
      setAction(null);
    }
  }

  async function openExportSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      notify("Chưa chọn tài khoản nào");
      return;
    }
    setExportOpen(true);
    setExportBusy(true);
    setExportText("");
    setExportCount(0);
    try {
      const res = await fetch(`/api/accounts/export`, {
        method: "POST",
        headers: { "X-Body": encodeBodyHeader({ ids, delimiter: exportDelimiter, fields: exportFields }) },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Lỗi" }));
        notify(err.error ?? "Lỗi xuất dữ liệu");
        setExportOpen(false);
        return;
      }
      const data = (await res.json()) as { text: string; count: number };
      setExportText(data.text);
      setExportCount(data.count);
    } finally {
      setExportBusy(false);
    }
  }

  async function regenerateExport(
    nextFields: ExportField[],
    nextDelimiter: string,
  ) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setExportBusy(true);
    try {
      const res = await fetch(`/api/accounts/export`, {
        method: "POST",
        headers: { "X-Body": encodeBodyHeader({ ids, delimiter: nextDelimiter, fields: nextFields }) },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { text: string; count: number };
      setExportText(data.text);
      setExportCount(data.count);
    } finally {
      setExportBusy(false);
    }
  }

  async function copyText(text: string, label: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLabel(label);
      setTimeout(() => setCopiedLabel((v) => (v === label ? null : v)), 1200);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopiedLabel(label);
        setTimeout(() => setCopiedLabel((v) => (v === label ? null : v)), 1200);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  function downloadExport() {
    if (!exportText) return;
    const blob = new Blob([exportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `tiktok-accounts-${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function openEditModal(id: number, username: string) {
    setEdit({
      id,
      loading: true,
      saving: false,
      error: null,
      username,
      password: "",
      email: "",
      twofa: "",
      emailPassword: "",
      note: "",
      passwordHistory: [],
      emailPasswordHistory: [],
      showPassword: false,
      showEmailPassword: false,
    });
    try {
      const res = await fetch(`/api/accounts/${id}`, { cache: "no-store" });
      if (!res.ok) {
        setEdit((prev) =>
          prev && prev.id === id
            ? { ...prev, loading: false, error: "Không tải được thông tin" }
            : prev,
        );
        return;
      }
      const d = await res.json();
      setEdit((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              loading: false,
              username: d.username ?? username,
              password: d.password ?? "",
              email: d.email ?? "",
              twofa: d.twofa ?? "",
              emailPassword: d.emailPassword ?? "",
              note: d.note ?? "",
              passwordHistory: Array.isArray(d.passwordHistory) ? d.passwordHistory : [],
              emailPasswordHistory: Array.isArray(d.emailPasswordHistory)
                ? d.emailPasswordHistory
                : [],
            }
          : prev,
      );
    } catch {
      setEdit((prev) =>
        prev && prev.id === id
          ? { ...prev, loading: false, error: "Lỗi mạng" }
          : prev,
      );
    }
  }

  async function saveEdit() {
    if (!edit) return;
    setEdit((prev) => (prev ? { ...prev, saving: true, error: null } : prev));
    try {
      const res = await fetch(`/api/accounts/${edit.id}`, {
        method: "PATCH",
        headers: {
          "X-Body": encodeBodyHeader({
            username: edit.username.trim(),
            password: edit.password,
            email: edit.email,
            twofa: edit.twofa,
            emailPassword: edit.emailPassword,
            note: edit.note,
          }),
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Lỗi" }));
        setEdit((prev) =>
          prev ? { ...prev, saving: false, error: err.error ?? "Lỗi lưu" } : prev,
        );
        return;
      }
      setEdit(null);
      await load();
    } catch (e) {
      setEdit((prev) =>
        prev
          ? { ...prev, saving: false, error: e instanceof Error ? e.message : "Lỗi mạng" }
          : prev,
      );
    }
  }

  async function fetchHotmailCode(accountId: number) {
    setCtxMenu((prev) =>
      prev && prev.id === accountId
        ? { ...prev, hotmail: { phase: "loading" } }
        : prev,
    );
    try {
      const res = await fetch(`/api/accounts/${accountId}/hotmail-code`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (data.needsAuth && data.authUrl) {
        setCtxMenu((prev) =>
          prev && prev.id === accountId
            ? {
                ...prev,
                hotmail: {
                  phase: "needs-auth",
                  authUrl: data.authUrl,
                  message: data.error,
                },
              }
            : prev,
        );
        return;
      }
      if (!res.ok) {
        setCtxMenu((prev) =>
          prev && prev.id === accountId
            ? {
                ...prev,
                hotmail: {
                  phase: "error",
                  message: data.error ?? `Lỗi HTTP ${res.status}`,
                },
              }
            : prev,
        );
        return;
      }
      const code: string = data.code;
      if (code) {
        copyText(code, `hotmail-${accountId}`);
      }
      setCtxMenu((prev) =>
        prev && prev.id === accountId
          ? {
              ...prev,
              hotmail: {
                phase: "result",
                code,
                subject: data.subject ?? "",
                from: data.from ?? null,
                receivedAt: data.receivedAt ?? "",
                snippet: data.snippet ?? "",
              },
            }
          : prev,
      );
    } catch (e) {
      setCtxMenu((prev) =>
        prev && prev.id === accountId
          ? {
              ...prev,
              hotmail: {
                phase: "error",
                message: e instanceof Error ? e.message : "Lỗi mạng",
              },
            }
          : prev,
      );
    }
  }

  function openOAuthPopup(authUrl: string, accountId: number) {
    const w = 520;
    const h = 640;
    const left = (window.screenX ?? 0) + ((window.outerWidth ?? 1024) - w) / 2;
    const top = (window.screenY ?? 0) + ((window.outerHeight ?? 768) - h) / 2;
    const popup = window.open(
      authUrl,
      "ms-oauth",
      `width=${w},height=${h},left=${left},top=${top}`,
    );
    if (!popup) {
      notify(
        "Trình duyệt chặn popup. Vui lòng cho phép popup cho site này rồi thử lại.",
      );
      return;
    }
    setCtxMenu((prev) =>
      prev && prev.id === accountId
        ? { ...prev, hotmail: { phase: "waiting-popup" } }
        : prev,
    );

    function onMessage(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      const payload = ev.data as
        | { type?: string; ok?: boolean; accountId?: number; message?: string }
        | undefined;
      if (!payload || payload.type !== "ms-oauth-result") return;
      if (payload.accountId !== accountId) return;
      window.removeEventListener("message", onMessage);
      if (payload.ok) {
        // Retry fetch automatically.
        fetchHotmailCode(accountId);
      } else {
        setCtxMenu((prev) =>
          prev && prev.id === accountId
            ? {
                ...prev,
                hotmail: {
                  phase: "error",
                  message: payload.message || "OAuth thất bại",
                },
              }
            : prev,
        );
      }
    }
    window.addEventListener("message", onMessage);
  }

  async function disconnectHotmail(accountId: number) {
    if (!(await confirmDialog({ message: "Ngắt kết nối Hotmail của tài khoản này? Lần sau phải đăng nhập Hotmail lại.", confirmLabel: "Ngắt kết nối", danger: true }))) return;
    await fetch(`/api/accounts/${accountId}/hotmail-code`, { method: "DELETE" });
    setCtxMenu((prev) =>
      prev && prev.id === accountId
        ? {
            ...prev,
            detail: prev.detail
              ? { ...prev.detail, hasMsToken: false, msEmail: null }
              : prev.detail,
            hotmail: { phase: "idle" },
          }
        : prev,
    );
  }

  async function openRowContextMenu(
    e: React.MouseEvent,
    row: AccountRow,
  ) {
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    setCtxMenu({
      x,
      y,
      id: row.id,
      username: row.username,
      loading: true,
      detail: null,
      error: null,
      hotmail: { phase: "idle" },
      fetchAction: null,
      fetchMessage: null,
      fetchError: null,
      browserLogin: "idle",
      browserLoginMessage: null,
      browserLoginError: null,
    });
    try {
      const res = await fetch(`/api/accounts/${row.id}`, { cache: "no-store" });
      if (!res.ok) {
        setCtxMenu((prev) =>
          prev && prev.id === row.id
            ? { ...prev, loading: false, error: "Lỗi tải thông tin" }
            : prev,
        );
        return;
      }
      const data = (await res.json()) as DetailResponse;
      setCtxMenu((prev) =>
        prev && prev.id === row.id
          ? {
              ...prev,
              loading: false,
              detail: {
                username: data.username,
                password: data.password,
                email: data.email,
                twofa: data.twofa,
                emailPassword: data.emailPassword,
                hasMsToken: !!data.hasMsToken,
                msEmail: data.msEmail ?? null,
                groupId: data.groupId ?? null,
                groupName: data.groupName ?? null,
              },
            }
          : prev,
      );
    } catch {
      setCtxMenu((prev) =>
        prev && prev.id === row.id
          ? { ...prev, loading: false, error: "Lỗi mạng" }
          : prev,
      );
    }
  }

  async function updateRowStatus(id: number, statusId: number | null) {
    // Optimistic update
    const st = statusId != null ? statusesList.find((s) => s.id === statusId) : null;
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              statusId,
              statusName: st?.name ?? null,
              statusColor: st?.color ?? null,
            }
          : r
      )
    );
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "X-Body": encodeBodyHeader({ statusId }) },
    });
  }

  async function updateRowCountry(id: number, countryId: number | null) {
    const c = countryId != null ? countriesList.find((x) => x.id === countryId) : null;
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              countryId,
              countryName: c?.name ?? null,
              countryCode: c?.code ?? null,
              countryColor: c?.color ?? null,
            }
          : r
      )
    );
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "X-Body": encodeBodyHeader({ countryId }) },
    });
  }

  async function updateRowMachine(id: number, machineId: number | null) {
    const m = machineId != null ? machinesList.find((x) => x.id === machineId) : null;
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              machineId,
              machineName: m?.name ?? null,
              machineColor: m?.color ?? null,
            }
          : r
      )
    );
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "X-Body": encodeBodyHeader({ machineId }) },
    });
  }

  async function updateRowEmployee(id: number, employeeId: number | null) {
    const e = employeeId != null ? employeesList.find((x) => x.id === employeeId) : null;
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              employeeId,
              employeeName: e?.name ?? null,
              employeeColor: e?.color ?? null,
            }
          : r
      )
    );
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "X-Body": encodeBodyHeader({ employeeId }) },
    });
  }

  async function triggerAutoFetch() {
    if (!(await confirmDialog({ title: "Đồng bộ tất cả", message: "Lấy follower và 3 video gần nhất cho mọi tài khoản ngay bây giờ?", confirmLabel: "Đồng bộ" }))) return;
    setAction("auto-fetch");
    try {
      const res = await fetch("/api/scheduler", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Lỗi" }));
        notify(err.error ?? "Lỗi");
        return;
      }
      notify("Đã khởi chạy đồng bộ ở nền. Refresh để xem kết quả sau vài phút.");
    } finally {
      setAction(null);
    }
  }

  async function moveOneToGroup(id: number, newGroupId: number | null) {
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "X-Body": encodeBodyHeader({ groupId: newGroupId }) },
    });
    if (detail && detail.id === id) {
      const g = newGroupId ? groups.find((gr) => gr.id === newGroupId) : null;
      setDetail({ ...detail, groupId: newGroupId, groupName: g?.name ?? null });
    }
    setCtxMenu((prev) => {
      if (!prev || prev.id !== id || !prev.detail) return prev;
      const g = newGroupId ? groups.find((gr) => gr.id === newGroupId) : null;
      return {
        ...prev,
        detail: {
          ...prev.detail,
          groupId: newGroupId,
          groupName: g?.name ?? null,
        },
      };
    });
    await load();
  }

  async function createGroupFromCtx(id: number) {
    const name = (await promptDialog({ title: "Tạo nhóm mới", label: "Tên nhóm", placeholder: "Ví dụ: Tài khoản Việt Nam", confirmLabel: "Tạo nhóm" }))?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "X-Body": encodeBodyHeader({ name, color: "#2d5a3d", description: "" }) },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Lỗi" }));
        notify(err.error ?? "Không tạo được nhóm");
        return;
      }
      const created = ((await res.json()) as { group: { id: number } }).group;
      const listRes = await fetch("/api/groups", { cache: "no-store" });
      if (listRes.ok) {
        const data = (await listRes.json()) as { groups: GroupRow[] };
        setGroups(data.groups);
      }
      await moveOneToGroup(id, created.id);
    } catch (e) {
      notify("Lỗi: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function startHotmailBrowserLogin(id: number) {
    setCtxMenu((prev) =>
      prev && prev.id === id
        ? {
            ...prev,
            browserLogin: "loading",
            browserLoginMessage: null,
            browserLoginError: null,
          }
        : prev,
    );
    try {
      const res = await fetch(`/api/accounts/${id}/hotmail-login`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setCtxMenu((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                browserLogin: "idle",
                browserLoginMessage: data.message ?? "Đã mở trình duyệt",
                browserLoginError: null,
              }
            : prev,
        );
      } else {
        setCtxMenu((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                browserLogin: "idle",
                browserLoginMessage: null,
                browserLoginError: data.error ?? "Lỗi mở trình duyệt",
              }
            : prev,
        );
      }
    } catch (e) {
      setCtxMenu((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              browserLogin: "idle",
              browserLoginMessage: null,
              browserLoginError: e instanceof Error ? e.message : String(e),
            }
          : prev,
      );
    }
  }

  async function runFetchOne(id: number, kind: "follow" | "video") {
    const endpoint = kind === "follow" ? "fetch-follow" : "fetch-videos";
    setCtxMenu((prev) =>
      prev && prev.id === id
        ? { ...prev, fetchAction: kind, fetchMessage: null, fetchError: null }
        : prev,
    );
    try {
      const res = await fetch(`/api/accounts/${endpoint}`, {
        method: "POST",
        headers: { "X-Body": encodeBodyHeader({ ids: [id] }) },
      });
      const data = await res.json();
      const result = data.results?.[0];
      if (result?.ok) {
        const msg =
          kind === "follow"
            ? `Follow: ${fmtNum(result.follower)} · Video: ${fmtNum(result.videoCount)}`
            : `Đã cập nhật ${result.count ?? 0} video`;
        setCtxMenu((prev) =>
          prev && prev.id === id
            ? { ...prev, fetchAction: null, fetchMessage: msg, fetchError: null }
            : prev,
        );
        await load();
      } else {
        setCtxMenu((prev) =>
          prev && prev.id === id
            ? {
                ...prev,
                fetchAction: null,
                fetchMessage: null,
                fetchError: result?.error ?? data.error ?? "Lỗi không xác định",
              }
            : prev,
        );
      }
    } catch (e) {
      setCtxMenu((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              fetchAction: null,
              fetchMessage: null,
              fetchError: e instanceof Error ? e.message : String(e),
            }
          : prev,
      );
    }
  }

  async function openDetail(id: number) {
    const res = await fetch(`/api/accounts/${id}`, { cache: "no-store" });
    const data = (await res.json()) as DetailResponse;
    setDetail(data);
  }

  async function saveNote(id: number, note: string) {
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "X-Body": encodeBodyHeader({ note }) },
    });
    await load();
  }

  async function deleteAccount(id: number) {
    if (!(await confirmDialog({ message: "Xoá tài khoản này? Không thể hoàn tác.", confirmLabel: "Xoá", danger: true }))) return;
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    setDetail(null);
    await load();
  }

  function copy(text: string | null) {
    if (!text) return;
    navigator.clipboard.writeText(text);
  }

  const filterChips: Array<{ key: GroupFilter; label: string; color?: string; count: number }> = [
    { key: "all", label: "Tất cả", count: total },
    ...groups.map((g) => ({ key: g.id as GroupFilter, label: g.name, color: g.color, count: g.count })),
    { key: "none" as GroupFilter, label: "Chưa phân nhóm", count: 0 },
  ];

  return (
    <>
      <header className="page-header tt-head">
        <div className="page-header-left">
          <h1 className="h1-serif">Tài khoản TikTok</h1>
          <p className="tt-sub">
            {total.toLocaleString("vi-VN")} tài khoản · {groups.length} nhóm · {statusesList.length} trạng thái
          </p>
        </div>
        <div className="tt-head-phone only-phone">
          <Link href="/import" className="btn btn-primary" aria-label="Nhập tài khoản">
            <Plus size={18} aria-hidden="true" />
            Nhập
          </Link>
          <details className="menu">
            <summary className="btn btn-icon" aria-label="Thao tác khác">
              <MoreHorizontal size={20} aria-hidden="true" />
            </summary>
            <div className="menu-pop" role="menu">
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                disabled={action !== null}
                onClick={(e) => {
                  (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
                  triggerAutoFetch();
                }}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Đồng bộ tất cả tài khoản
              </button>
              <label className="menu-item">
                <input type="checkbox" checked={idleCfg.enabled} onChange={(e) => setIdleCfg({ ...idleCfg, enabled: e.target.checked })} />
                Hiện số ngày chưa đăng
              </label>
              <div className="menu-sep" role="separator" />
              {CATALOG.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} role="menuitem" className="menu-item">
                  <Icon size={16} aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </div>
          </details>
        </div>
        <div className="tt-head-actions only-wide">
          <details className="menu">
            <summary className="btn" aria-label="Danh mục">
              <SlidersHorizontal size={15} aria-hidden="true" />
              <span className="btn-label">Danh mục</span>
              <ChevronDown size={14} aria-hidden="true" />
            </summary>
            <div className="menu-pop" role="menu">
              {CATALOG.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  role="menuitem"
                  className="menu-item"
                  onClick={(e) => ((e.currentTarget.closest("details") as HTMLDetailsElement).open = false)}
                >
                  <Icon size={16} aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </div>
          </details>
          <button
            onClick={triggerAutoFetch}
            disabled={action !== null}
            title="Lấy follower và 3 video mới nhất cho mọi tài khoản ngay bây giờ"
            aria-label="Đồng bộ tất cả"
            className="btn"
          >
            <RefreshCw size={15} aria-hidden="true" className={action === "auto-fetch" ? "spin" : undefined} />
            <span className="btn-label">{action === "auto-fetch" ? "Đang đồng bộ…" : "Đồng bộ tất cả"}</span>
          </button>
          <Link href="/import" className="btn btn-primary">
            <Plus size={16} aria-hidden="true" />
            Nhập tài khoản
          </Link>
        </div>
      </header>

      <div className="fchips" role="tablist" aria-label="Lọc theo nhóm">
        {filterChips.map((chip) => {
          const active = groupFilter === chip.key;
          return (
            <button
              key={String(chip.key)}
              role="tab"
              aria-selected={active}
              onClick={() => setGroupFilter(chip.key)}
              className={`fchip${active ? " active" : ""}`}
            >
              {chip.color && <span className="fchip-dot" style={{ background: chip.color }} />}
              {chip.label}
              {chip.count > 0 && <span className="fchip-count">{chip.count}</span>}
            </button>
          );
        })}
      </div>

      <section className="section" style={{ marginBottom: 20 }}>
        <div className={`tt-toolbar${selected.size > 0 ? " has-selection" : ""}`}>
          <div className="tt-row">
            <label className="search-field">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                placeholder="Tìm username hoặc ghi chú"
                aria-label="Tìm tài khoản (phím tắt /)"
                data-search
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {!search && <kbd title="Bấm / để tìm">/</kbd>}
            </label>
            <span className="tt-count">
              {total > 0 ? `${total.toLocaleString("vi-VN")} tài khoản · trang ${page}/${totalPages}` : "Chưa có tài khoản"}
            </span>
            <span className="tt-spacer" />
            <div className="range-pick" title="Chọn nhanh các tài khoản theo số thứ tự trên trang này">
              <span>Chọn STT</span>
              <input type="number" min={1} value={pickFrom} onChange={(e) => setPickFrom(Number(e.target.value) || 1)} aria-label="Từ STT" />
              <span aria-hidden="true">–</span>
              <input type="number" min={1} value={pickTo} onChange={(e) => setPickTo(Number(e.target.value) || 1)} aria-label="Đến STT" />
              <button type="button" onClick={pickRange} disabled={filtered.length === 0}>
                Chọn
              </button>
            </div>
            <DensityToggle />
            <button onClick={load} disabled={loading} className="btn btn-icon" aria-label="Tải lại danh sách" title="Tải lại danh sách">
              <RotateCw size={15} aria-hidden="true" className={loading ? "spin" : undefined} />
            </button>
            <span className="only-wide">
              <IdleDaysMenu cfg={idleCfg} onChange={setIdleCfg} open={idleCfgOpen} onOpenChange={setIdleCfgOpen} />
            </span>
          </div>

          {selected.size > 0 ? (
            <div className="tt-selbar only-wide" role="toolbar" aria-label="Thao tác với tài khoản đã chọn">
              <span className="tt-selcount">
                <b>{selected.size}</b> đã chọn
              </span>
              <button className="btn btn-quiet" onClick={() => setSelected(new Set())} title="Bỏ chọn (Esc)">
                <X size={14} aria-hidden="true" />
                Bỏ chọn
              </button>
              <span className="tt-sep" aria-hidden="true" />
              <button onClick={() => runFetchBulk("fetch-videos")} disabled={action !== null} className="btn btn-primary">
                <Film size={15} aria-hidden="true" />
                {fetchLabel("fetch-videos", "Lấy video")}
              </button>
              <button onClick={() => runFetchBulk("fetch-follow")} disabled={action !== null} className="btn btn-accent">
                <UsersRound size={15} aria-hidden="true" />
                {fetchLabel("fetch-follow", "Lấy follow")}
              </button>
              <button
                onClick={() => runFetchBulk("fetch-avatar")}
                disabled={action !== null}
                title="Chỉ làm mới ảnh đại diện — dùng khi ảnh bị mất hoặc hết hạn"
                className="btn"
              >
                <ImageIcon size={15} aria-hidden="true" />
                {fetchLabel("fetch-avatar", "Lấy ảnh đại diện")}
              </button>
              <span className="tt-sep" aria-hidden="true" />
              <BulkSelect
                label="Chuyển nhóm"
                onPick={(v) => moveSelectedToGroup(v)}
                options={groups.map((g) => ({ value: g.id, label: g.name }))}
              />
              <BulkSelect
                label="Đổi trạng thái"
                clearLabel="Bỏ trạng thái"
                onPick={(v) => updateSelectedStatus(v)}
                options={statusesList.map((s) => ({ value: s.id, label: s.name }))}
              />
              <BulkSelect
                label="Đổi quốc gia"
                clearLabel="Bỏ quốc gia"
                onPick={(v) => updateSelectedCountry(v)}
                options={countriesList.map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))}
              />
              <BulkSelect
                label="Đổi máy"
                clearLabel="Bỏ máy"
                onPick={(v) => updateSelectedMachine(v)}
                options={machinesList.map((m) => ({ value: m.id, label: m.name }))}
              />
              <BulkSelect
                label="Đổi nhân viên"
                clearLabel="Bỏ nhân viên"
                onPick={(v) => updateSelectedEmployee(v)}
                options={employeesList.map((emp) => ({ value: emp.id, label: emp.name }))}
              />
              <span className="tt-sep" aria-hidden="true" />
              <button
                onClick={openExportSelected}
                disabled={exportBusy}
                title="Xuất thông tin đăng nhập của tài khoản đã chọn"
                className="btn"
              >
                <Download size={15} aria-hidden="true" />
                {exportBusy ? "Đang xuất…" : "Xuất"}
              </button>
              <button onClick={() => setTransferOpen(true)} title="Chuyển hoặc sao chép tài khoản đã chọn sang user khác" className="btn">
                <ArrowRightLeft size={15} aria-hidden="true" />
                Chuyển user
              </button>
              <button onClick={removeSelectedFromGroup} title="Bỏ khỏi nhóm, vẫn giữ tài khoản" className="btn">
                <FolderMinus size={15} aria-hidden="true" />
                Bỏ nhóm
              </button>
              <button onClick={deleteSelected} disabled={action !== null} className="btn btn-danger">
                <Trash2 size={15} aria-hidden="true" />
                {action === "delete" ? "Đang xoá…" : "Xoá"}
              </button>
            </div>
          ) : (
            <p className="tt-hint only-wide">
              Chọn tài khoản trong bảng (giữ <kbd>Shift</kbd> để chọn cả dải), hoặc chọn theo STT, để lấy dữ liệu, đổi nhóm, xuất hay xoá.
            </p>
          )}
        </div>

        <div className="table-wrap only-wide">
          <table className="table tt-table">
            <thead>
              <tr>
                <th style={{ width: 44 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Chọn tất cả"
                  />
                </th>
                <th style={{ width: 56 }} className="right">STT</th>
                <SortableTh
                  label="Tài khoản"
                  sortKey="username"
                  active={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                />
                <th style={{ width: 220 }}>3 video gần nhất</th>
                <SortableTh
                  label="Nhóm"
                  sortKey="group"
                  active={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                />
                <SortableTh
                  label="Follower"
                  sortKey="follower"
                  active={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  align="right"
                />
                <SortableTh
                  label="Trạng thái"
                  sortKey="status"
                  active={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  width={160}
                />
                <SortableTh
                  label="Quốc gia"
                  sortKey="country"
                  active={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  width={150}
                />
                <SortableTh
                  label="Máy"
                  sortKey="machine"
                  active={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  width={140}
                />
                <SortableTh
                  label="Nhân viên"
                  sortKey="employee"
                  active={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  width={140}
                />
                <SortableTh
                  label="Video"
                  sortKey="video"
                  active={sortKey}
                  dir={sortDir}
                  onToggle={toggleSort}
                  align="right"
                />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && loading && <SkeletonRows rows={8} cols={11} />}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={11} className="empty-cell">
                    {search.trim() ? (
                      <div className="empty-state">
                        <SearchX size={28} aria-hidden="true" />
                        <h3>Không có tài khoản khớp “{search.trim()}”</h3>
                        <p>Thử tìm theo phần khác của username hoặc ghi chú.</p>
                        <button className="btn" onClick={() => setSearch("")}>Xoá tìm kiếm</button>
                      </div>
                    ) : groupFilter !== "all" ? (
                      <div className="empty-state">
                        <FolderOpen size={28} aria-hidden="true" />
                        <h3>{groupFilter === "none" ? "Mọi tài khoản đều đã có nhóm" : "Nhóm này chưa có tài khoản"}</h3>
                        <p>Chọn tài khoản ở “Tất cả” rồi dùng “Chuyển nhóm” để thêm vào nhóm.</p>
                        <button className="btn" onClick={() => setGroupFilter("all")}>Xem tất cả tài khoản</button>
                      </div>
                    ) : (
                      <div className="empty-state">
                        <Inbox size={28} aria-hidden="true" />
                        <h3>Chưa có tài khoản TikTok nào</h3>
                        <p>Dán danh sách tài khoản (username, mật khẩu, email…) để bắt đầu quản lý.</p>
                        <Link href="/import" className="btn btn-primary">
                          <Plus size={16} aria-hidden="true" />
                          Nhập tài khoản
                        </Link>
                      </div>
                    )}
                  </td>
                </tr>
              )}
              {filtered.map((r, idx) => (
                <tr
                  key={r.id}
                  className={selected.has(r.id) ? "selected" : ""}
                  onContextMenu={(e) => openRowContextMenu(e, r)}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      aria-label={`Chọn @${r.username}`}
                      onClick={(e) => (shiftRef.current = e.shiftKey)}
                      onChange={() => toggleAt(idx, r.id)}
                    />
                  </td>
                  <td className="right">
                    <span className="mono-num text-muted">
                      {(page - 1) * PAGE_SIZE + idx + 1}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <button
                        onClick={() => openDetail(r.id)}
                        title="Xem chi tiết"
                        style={{
                          background: "transparent",
                          border: 0,
                          padding: 0,
                          cursor: "pointer",
                        }}
                      >
                        {r.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.avatarUrl}
                            alt={r.username}
                            referrerPolicy="no-referrer"
                            className="avatar"
                          />
                        ) : (
                          <span className="avatar-fallback">
                            {r.username[0]?.toUpperCase() || "?"}
                          </span>
                        )}
                      </button>
                      <a
                        href={`https://www.tiktok.com/@${r.username}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Mở TikTok trong tab mới"
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontSize: 16,
                          color: "var(--ink)",
                          letterSpacing: "-0.01em",
                          textDecoration: "none",
                        }}
                        onMouseEnter={(e) =>
                          ((e.target as HTMLAnchorElement).style.color = "var(--accent)")
                        }
                        onMouseLeave={(e) =>
                          ((e.target as HTMLAnchorElement).style.color = "var(--ink)")
                        }
                      >
                        @{r.username}
                      </a>
                      {idleCfg.enabled && <IdleDaysBadge videos={r.lastVideos} cfg={idleCfg} />}
                    </div>
                  </td>
                  <td>
                    {r.lastVideos && r.lastVideos.length > 0 ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        {r.lastVideos.slice(0, 3).map((v) => (
                          <a
                            key={v.id}
                            href={`https://www.tiktok.com/@${r.username}/video/${v.id}`}
                            target="_blank"
                            rel="noreferrer"
                            title={`${v.caption}\n${fmtNum(v.viewCount)} views · ${fmtNum(v.likeCount)} likes`}
                            style={{ position: "relative", display: "inline-block", textDecoration: "none" }}
                          >
                            {v.coverUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={v.coverUrl}
                                alt=""
                                referrerPolicy="no-referrer"
                                className="video-thumb"
                              />
                            ) : (
                              <span className="video-thumb-placeholder" />
                            )}
                            <span
                              style={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                bottom: 0,
                                padding: "2px 3px",
                                textAlign: "center",
                                fontVariantNumeric: "tabular-nums",
                                fontSize: 10,
                                fontWeight: 600,
                                color: "#fff",
                                background:
                                  "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 60%, rgba(0,0,0,0) 100%)",
                                borderBottomLeftRadius: 4,
                                borderBottomRightRadius: 4,
                                lineHeight: 1.2,
                                pointerEvents: "none",
                              }}
                            >
                              {fmtNum(v.viewCount)}
                            </span>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    {r.groupName ? (
                      <span
                        className="chip"
                        style={{
                          borderColor: r.groupColor ?? "var(--line)",
                          color: r.groupColor ?? "var(--ink)",
                          background: "transparent",
                        }}
                      >
                        <span
                          className="dot"
                          style={{
                            background: r.groupColor ?? "var(--muted)",
                            width: 6,
                            height: 6,
                            borderRadius: 999,
                            display: "inline-block",
                            marginRight: 6,
                          }}
                        />
                        {r.groupName}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="right">
                    <span className="mono-num">{fmtNum(r.followerCount)}</span>
                  </td>
                  <td>
                    <div
                      style={{
                        position: "relative",
                        display: "inline-flex",
                        alignItems: "center",
                        minWidth: 160,
                      }}
                    >
                      <span
                        className="dot"
                        style={{
                          background: r.statusColor ?? "var(--line)",
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          display: "inline-block",
                          marginRight: 8,
                          flexShrink: 0,
                        }}
                      />
                      <select
                        value={r.statusId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateRowStatus(r.id, v === "" ? null : Number(v));
                        }}
                        className="input"
                        style={{
                          padding: "4px 8px",
                          fontSize: 12,
                          minWidth: 140,
                          color: r.statusColor ?? "var(--muted)",
                          borderColor: r.statusColor ?? "var(--line)",
                        }}
                      >
                        <option value="">— Chưa đặt —</option>
                        {statusesList.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    <div
                      style={{
                        position: "relative",
                        display: "inline-flex",
                        alignItems: "center",
                        minWidth: 130,
                      }}
                    >
                      <span
                        className="dot"
                        style={{
                          background: r.countryColor ?? "var(--line)",
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          display: "inline-block",
                          marginRight: 8,
                          flexShrink: 0,
                        }}
                      />
                      <select
                        value={r.countryId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateRowCountry(r.id, v === "" ? null : Number(v));
                        }}
                        className="input"
                        style={{
                          padding: "4px 8px",
                          fontSize: 12,
                          minWidth: 120,
                          color: r.countryColor ?? "var(--muted)",
                          borderColor: r.countryColor ?? "var(--line)",
                        }}
                      >
                        <option value="">— Chưa đặt —</option>
                        {countriesList.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.code ? `${c.code} · ${c.name}` : c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    <div
                      style={{
                        position: "relative",
                        display: "inline-flex",
                        alignItems: "center",
                        minWidth: 120,
                      }}
                    >
                      <span
                        style={{
                          background: r.machineColor ?? "var(--line)",
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          display: "inline-block",
                          marginRight: 8,
                          flexShrink: 0,
                        }}
                      />
                      <select
                        value={r.machineId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateRowMachine(r.id, v === "" ? null : Number(v));
                        }}
                        className="input"
                        style={{
                          padding: "4px 8px",
                          fontSize: 12,
                          minWidth: 110,
                          color: r.machineColor ?? "var(--muted)",
                          borderColor: r.machineColor ?? "var(--line)",
                        }}
                      >
                        <option value="">— Chưa đặt —</option>
                        {machinesList.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    <div
                      style={{
                        position: "relative",
                        display: "inline-flex",
                        alignItems: "center",
                        minWidth: 120,
                      }}
                    >
                      <span
                        style={{
                          background: r.employeeColor ?? "var(--line)",
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          display: "inline-block",
                          marginRight: 8,
                          flexShrink: 0,
                        }}
                      />
                      <select
                        value={r.employeeId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateRowEmployee(r.id, v === "" ? null : Number(v));
                        }}
                        className="input"
                        style={{
                          padding: "4px 8px",
                          fontSize: 12,
                          minWidth: 110,
                          color: r.employeeColor ?? "var(--muted)",
                          borderColor: r.employeeColor ?? "var(--line)",
                        }}
                      >
                        <option value="">— Chưa đặt —</option>
                        {employeesList.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="right">
                    <span className="mono-num text-muted">{fmtNum(r.videoCount)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Phones: one card per account instead of the wide table. */}
        <div className="m-list only-phone" aria-label="Danh sách tài khoản">
          {filtered.length > 0 && (
            <div className="m-listbar">
              <label className="m-selectall-box">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.size > 0 && !allSelected;
                  }}
                  onChange={toggleAll}
                />
                <span>{allSelected ? "Bỏ chọn tất cả" : `Chọn tất cả (${filtered.length})`}</span>
              </label>
              <select
                className="input m-sortpick"
                aria-label="Sắp xếp"
                value={`${sortKey}:${sortDir}`}
                onChange={(e) => {
                  const [k, d] = e.target.value.split(":") as [SortKey, SortDir];
                  setSortKey(k);
                  setSortDir(d);
                }}
              >
                <option value="createdAt:desc">Mới thêm</option>
                <option value="follower:desc">Follower nhiều</option>
                <option value="follower:asc">Follower ít</option>
                <option value="video:desc">Nhiều video</option>
                <option value="username:asc">Tên A → Z</option>
                <option value="group:asc">Theo nhóm</option>
                <option value="status:asc">Theo trạng thái</option>
              </select>
            </div>
          )}
          {filtered.length === 0 && loading &&
            Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="m-card" aria-hidden="true">
                <span className="sk sk-dot" style={{ width: 40, height: 40, borderRadius: "50%" }} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <span className="sk" style={{ width: "55%" }} />
                  <span className="sk" style={{ width: "35%" }} />
                </div>
              </div>
            ))}
          {filtered.length === 0 && !loading && (
            <div className="card empty-state">
              <Inbox size={28} aria-hidden="true" />
              <h3>{search.trim() ? `Không có tài khoản khớp “${search.trim()}”` : total === 0 ? "Chưa có tài khoản TikTok nào" : "Không có tài khoản trong mục này"}</h3>
              {search.trim() ? (
                <button className="btn" onClick={() => setSearch("")}>Xoá tìm kiếm</button>
              ) : total === 0 ? (
                <Link href="/import" className="btn btn-primary">
                  <Plus size={16} aria-hidden="true" />
                  Nhập tài khoản
                </Link>
              ) : (
                <button className="btn" onClick={() => setGroupFilter("all")}>Xem tất cả tài khoản</button>
              )}
            </div>
          )}
          {filtered.map((r, idx) => {
            const on = selected.has(r.id);
            return (
              <article key={r.id} className={`m-card${on ? " selected" : ""}`}>
                <label className="m-check">
                  <input type="checkbox" checked={on} onChange={() => toggleAt(idx, r.id)} aria-label={`Chọn @${r.username}`} />
                </label>
                <div
                  role="button"
                  tabIndex={0}
                  className="m-main"
                  onClick={(e) => {
                    if (selected.size > 0) return toggleAt(idx, r.id);
                    // The avatar / @username is a real link (below); the rest opens details.
                    if ((e.target as HTMLElement).closest("a")) return;
                    openDetail(r.id);
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                      e.preventDefault();
                      if (selected.size > 0) toggleAt(idx, r.id);
                      else openDetail(r.id);
                    }
                  }}
                >
                  {/* A real <a> (not window.open): phones hand it to the TikTok app or open
                      the profile normally instead of a blank tab. */}
                  <a
                    className="m-row"
                    href={`https://www.tiktok.com/@${r.username}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      if (selected.size > 0) e.preventDefault(); // selecting: tap = toggle only
                    }}
                  >
                    {r.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.avatarUrl} alt="" referrerPolicy="no-referrer" className="avatar m-avatar" />
                    ) : (
                      <span className="avatar-fallback m-avatar">{r.username[0]?.toUpperCase() || "?"}</span>
                    )}
                    <span className="m-text">
                      <span className="m-title">@{r.username}</span>
                      <span className="m-meta">
                        <b>{fmtNum(r.followerCount)}</b> follower
                        {r.videoCount != null && <> · <b>{fmtNum(r.videoCount)}</b> video</>}
                      </span>
                    </span>
                  </a>
                  <span className="m-tags">
                    {idleCfg.enabled && <IdleDaysBadge videos={r.lastVideos} cfg={idleCfg} />}
                    {r.groupName && (
                      <span className="m-tag">
                        <span className="fchip-dot" style={{ background: r.groupColor ?? "var(--dim)" }} />
                        {r.groupName}
                      </span>
                    )}
                    {r.statusName && (
                      <span className="m-tag" style={{ color: r.statusColor ?? undefined, borderColor: r.statusColor ?? undefined }}>
                        {r.statusName}
                      </span>
                    )}
                    {r.countryCode && <span className="m-tag">{r.countryCode}</span>}
                  </span>
                  {r.note && <span className="m-note">{r.note}</span>}
                </div>
                <button
                  type="button"
                  className="m-more"
                  aria-label={`Thao tác cho @${r.username}`}
                  onClick={(e) => {
                    // Keep this tap from reaching the "click outside closes the menu" listener.
                    e.stopPropagation();
                    openRowContextMenu(e, r);
                  }}
                >
                  <MoreHorizontal size={20} aria-hidden="true" />
                </button>
                <div className="m-videos">
                  {r.lastVideos && r.lastVideos.length > 0 ? (
                    r.lastVideos.slice(0, 3).map((v) => (
                      <a
                        key={v.id}
                        href={`https://www.tiktok.com/@${r.username}/video/${v.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="m-video"
                        aria-label={`Video ${v.caption ? `“${v.caption.slice(0, 40)}”` : ""} — ${fmtNum(v.viewCount)} lượt xem`}
                      >
                        {v.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={v.coverUrl} alt="" referrerPolicy="no-referrer" loading="lazy" />
                        ) : (
                          <span className="m-video-ph" />
                        )}
                        <span className="m-video-views">
                          <Play size={10} aria-hidden="true" fill="currentColor" />
                          {fmtNum(v.viewCount)}
                        </span>
                        {v.postedAt > 0 && <span className="m-video-age">{ageShort(v.postedAt)}</span>}
                      </a>
                    ))
                  ) : (
                    <span className="m-videos-empty">
                      {r.lastVideos ? "Không có video công khai" : "Chưa lấy video"}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {/* Phones: selection actions pinned above the tab bar. */}
        {selected.size > 0 && (
          <div className="m-actionbar only-phone" role="toolbar" aria-label="Thao tác với tài khoản đã chọn">
            <button type="button" className="m-ab-count" onClick={() => setSelected(new Set())} aria-label="Bỏ chọn">
              <X size={18} aria-hidden="true" />
              <b>{selected.size}</b>
            </button>
            <button onClick={() => runFetchBulk("fetch-videos")} disabled={action !== null} className="btn btn-primary">
              <Film size={16} aria-hidden="true" className={action === "fetch-videos" ? "spin-soft" : undefined} />
              <span className="m-ab-label" aria-live="polite">{fetchLabelShort("fetch-videos", "Lấy video")}</span>
            </button>
            <button onClick={() => runFetchBulk("fetch-follow")} disabled={action !== null} className="btn btn-accent">
              <span className="m-ab-label" aria-live="polite">{fetchLabelShort("fetch-follow", "Follow")}</span>
            </button>
            <button className="btn m-ab-more" onClick={() => setActionsOpen(true)} aria-label="Thêm thao tác" title="Thêm thao tác">
              <MoreHorizontal size={20} aria-hidden="true" />
            </button>
          </div>
        )}
        <Sheet open={actionsOpen && selected.size > 0} title={`${selected.size} tài khoản đã chọn`} onClose={() => setActionsOpen(false)}>
          <div className="sheet-actions">
            <button className="sheet-btn" disabled={action !== null} onClick={() => { setActionsOpen(false); runFetchBulk("fetch-avatar"); }}>
              <ImageIcon size={20} aria-hidden="true" /> Lấy ảnh đại diện
            </button>
            <button className="sheet-btn" disabled={exportBusy} onClick={() => { setActionsOpen(false); openExportSelected(); }}>
              <Download size={20} aria-hidden="true" /> Xuất thông tin đăng nhập
            </button>
            <button className="sheet-btn" onClick={() => { setActionsOpen(false); setTransferOpen(true); }}>
              <ArrowRightLeft size={20} aria-hidden="true" /> Chuyển sang user khác
            </button>
            <button className="sheet-btn" onClick={() => { setActionsOpen(false); removeSelectedFromGroup(); }}>
              <FolderMinus size={20} aria-hidden="true" /> Bỏ khỏi nhóm
            </button>
          </div>
          <div className="sheet-fields">
            <BulkSelect label="Chuyển nhóm" onPick={(v) => { setActionsOpen(false); moveSelectedToGroup(v); }} options={groups.map((g) => ({ value: g.id, label: g.name }))} />
            <BulkSelect label="Đổi trạng thái" clearLabel="Bỏ trạng thái" onPick={(v) => { setActionsOpen(false); updateSelectedStatus(v); }} options={statusesList.map((x) => ({ value: x.id, label: x.name }))} />
            <BulkSelect label="Đổi quốc gia" clearLabel="Bỏ quốc gia" onPick={(v) => { setActionsOpen(false); updateSelectedCountry(v); }} options={countriesList.map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))} />
            <BulkSelect label="Đổi máy" clearLabel="Bỏ máy" onPick={(v) => { setActionsOpen(false); updateSelectedMachine(v); }} options={machinesList.map((m) => ({ value: m.id, label: m.name }))} />
            <BulkSelect label="Đổi nhân viên" clearLabel="Bỏ nhân viên" onPick={(v) => { setActionsOpen(false); updateSelectedEmployee(v); }} options={employeesList.map((emp) => ({ value: emp.id, label: emp.name }))} />
          </div>
          <button className="sheet-btn danger" disabled={action !== null} onClick={() => { setActionsOpen(false); deleteSelected(); }}>
            <Trash2 size={20} aria-hidden="true" /> Xoá vĩnh viễn {selected.size} tài khoản
          </button>
        </Sheet>

        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 20,
              paddingTop: 20,
              borderTop: "1px solid var(--line)",
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--muted)",
              }}
            >
              Trang {page} / {totalPages} · {total.toLocaleString()} tài khoản
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="btn"
                style={{ padding: "6px 12px", fontSize: 11 }}
              >
                ‹‹
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn"
                style={{ padding: "6px 12px", fontSize: 11 }}
              >
                ‹ Trước
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn"
                style={{ padding: "6px 12px", fontSize: 11 }}
              >
                Sau ›
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="btn"
                style={{ padding: "6px 12px", fontSize: 11 }}
              >
                ››
              </button>
            </div>
          </div>
        )}
      </section>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 20,
              }}
            >
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  Chi tiết tài khoản
                </div>
                <h2
                  className="h2-serif"
                  style={{ fontSize: 28 }}
                >
                  <a
                    href={`https://www.tiktok.com/@${detail.username}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Mở TikTok trong tab mới"
                    style={{ color: "inherit", textDecoration: "none" }}
                    onMouseEnter={(e) =>
                      ((e.target as HTMLAnchorElement).style.color = "var(--accent)")
                    }
                    onMouseLeave={(e) =>
                      ((e.target as HTMLAnchorElement).style.color = "inherit")
                    }
                  >
                    @{detail.username} <ExternalLink size={13} aria-hidden="true" style={{ verticalAlign: "-1px" }} />
                  </a>
                </h2>
              </div>
              <button
                onClick={() => setDetail(null)}
                aria-label="Đóng"
                style={{
                  background: "transparent",
                  border: 0,
                  fontSize: 22,
                  color: "var(--muted)",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <div className="section-label" style={{ marginBottom: 6 }}>
                  Nhóm
                </div>
                <select
                  className="input"
                  value={detail.groupId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    moveOneToGroup(detail.id, v === "" ? null : Number(v));
                  }}
                  style={{ width: "100%" }}
                >
                  <option value="">— Không nhóm —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="section-label" style={{ marginBottom: 6 }}>
                  Trạng thái
                </div>
                <select
                  className="input"
                  value={detail.statusId ?? ""}
                  onChange={async (e) => {
                    const v = e.target.value;
                    const newId = v === "" ? null : Number(v);
                    await updateRowStatus(detail.id, newId);
                    const st = newId != null ? statusesList.find((s) => s.id === newId) : null;
                    setDetail({ ...detail, statusId: newId, statusName: st?.name ?? null });
                  }}
                  style={{ width: "100%" }}
                >
                  <option value="">— Chưa đặt —</option>
                  {statusesList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="section-label" style={{ marginBottom: 6 }}>
                  Quốc gia
                </div>
                <select
                  className="input"
                  value={detail.countryId ?? ""}
                  onChange={async (e) => {
                    const v = e.target.value;
                    const newId = v === "" ? null : Number(v);
                    await updateRowCountry(detail.id, newId);
                    const c = newId != null ? countriesList.find((x) => x.id === newId) : null;
                    setDetail({ ...detail, countryId: newId, countryName: c?.name ?? null });
                  }}
                  style={{ width: "100%" }}
                >
                  <option value="">— Chưa đặt —</option>
                  {countriesList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code ? `${c.code} · ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="section-label" style={{ marginBottom: 6 }}>
                  Máy
                </div>
                <select
                  className="input"
                  value={detail.machineId ?? ""}
                  onChange={async (e) => {
                    const v = e.target.value;
                    const newId = v === "" ? null : Number(v);
                    await updateRowMachine(detail.id, newId);
                    const m = newId != null ? machinesList.find((x) => x.id === newId) : null;
                    setDetail({ ...detail, machineId: newId, machineName: m?.name ?? null });
                  }}
                  style={{ width: "100%" }}
                >
                  <option value="">— Chưa đặt —</option>
                  {machinesList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="section-label" style={{ marginBottom: 6 }}>
                  Nhân viên
                </div>
                <select
                  className="input"
                  value={detail.employeeId ?? ""}
                  onChange={async (e) => {
                    const v = e.target.value;
                    const newId = v === "" ? null : Number(v);
                    await updateRowEmployee(detail.id, newId);
                    const emp = newId != null ? employeesList.find((x) => x.id === newId) : null;
                    setDetail({ ...detail, employeeId: newId, employeeName: emp?.name ?? null });
                  }}
                  style={{ width: "100%" }}
                >
                  <option value="">— Chưa đặt —</option>
                  {employeesList.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="section-label" style={{ marginBottom: 10 }}>
              Credentials
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(
                [
                  ["Password", detail.password],
                  ["Email", detail.email],
                  ["2FA", detail.twofa],
                  ["Email password", detail.emailPassword],
                ] as const
              ).map(([label, val]) => (
                <div key={label} className="cred-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cred-label">{label}</div>
                    <div className="cred-value">{val || "—"}</div>
                  </div>
                  {val && (
                    <button onClick={() => copy(val)} className="btn" style={{ padding: "6px 12px" }}>
                      Copy
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="divider" />

            <div className="section-label" style={{ marginBottom: 8 }}>
              Note
            </div>
            <textarea
              defaultValue={detail.note ?? ""}
              onBlur={(e) => saveNote(detail.id, e.target.value)}
              rows={3}
              className="textarea"
              style={{ minHeight: 80, fontFamily: "var(--font-sans)", fontSize: 13 }}
            />

            <div
              style={{
                marginTop: 20,
                paddingTop: 20,
                borderTop: "1px solid var(--line)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <button
                onClick={() => deleteAccount(detail.id)}
                className="btn btn-danger"
              >
                Xóa tài khoản
              </button>
              <a
                href={`https://www.tiktok.com/@${detail.username}`}
                target="_blank"
                rel="noreferrer"
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--accent)",
                }}
              >
                Xem trên TikTok <ExternalLink size={14} aria-hidden="true" style={{ verticalAlign: "-2px" }} />
              </a>
            </div>
          </div>
        </div>
      )}

      {transferOpen && (
        <TransferModal
          ids={Array.from(selected)}
          onClose={() => setTransferOpen(false)}
          onDone={async (mode) => {
            if (mode === "move") setSelected(new Set());
            await load();
          }}
        />
      )}

      {exportOpen && (
        <div className="modal-overlay" onClick={() => setExportOpen(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 720, width: "90%" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 16,
              }}
            >
              <div>
                <div
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  Xuất tài khoản
                </div>
                <h2
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: 22,
                    margin: "6px 0 0",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {exportCount > 0 ? `${exportCount} tài khoản` : "Đang xuất…"}
                </h2>
              </div>
              <button
                onClick={() => setExportOpen(false)}
                className="btn"
                style={{ padding: "4px 10px", fontSize: 11 }}
              >
                Đóng
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <label
                className="mono"
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                Trường:
              </label>
              {(Object.keys(EXPORT_FIELD_LABELS) as ExportField[]).map((f) => {
                const checked = exportFields.includes(f);
                return (
                  <label
                    key={f}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked
                          ? exportFields.filter((x) => x !== f)
                          : [...exportFields, f];
                        if (next.length === 0) return;
                        setExportFields(next);
                        regenerateExport(next, exportDelimiter);
                      }}
                    />
                    {EXPORT_FIELD_LABELS[f]}
                  </label>
                );
              })}
              <div style={{ flex: 1 }} />
              <label
                className="mono"
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                Delimiter:
              </label>
              <input
                value={exportDelimiter}
                onChange={(e) => {
                  const v = e.target.value || "|";
                  setExportDelimiter(v);
                  regenerateExport(exportFields, v);
                }}
                maxLength={4}
                className="input"
                style={{
                  width: 48,
                  padding: "4px 6px",
                  fontSize: 12,
                  textAlign: "center",
                }}
              />
            </div>

            <textarea
              value={exportText}
              readOnly
              placeholder={exportBusy ? "Đang tải…" : ""}
              className="input"
              style={{
                width: "100%",
                minHeight: 240,
                maxHeight: "50vh",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                lineHeight: 1.5,
                padding: 10,
                whiteSpace: "pre",
                overflow: "auto",
              }}
              onFocus={(e) => e.currentTarget.select()}
            />

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 12,
                alignItems: "center",
              }}
            >
              <button
                onClick={() => copyText(exportText, "export")}
                disabled={!exportText || exportBusy}
                className="btn"
                style={{ padding: "6px 14px", fontSize: 11 }}
              >
                {copiedLabel === "export" ? <><Check size={14} aria-hidden="true" /> Đã chép</> : "Chép tất cả"}
              </button>
              <button
                onClick={downloadExport}
                disabled={!exportText || exportBusy}
                className="btn"
                style={{ padding: "6px 14px", fontSize: 11 }}
              >
                Tải .txt
              </button>
              <div
                className="mono"
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginLeft: "auto",
                }}
              >
                Định dạng: {exportFields.map((f) => EXPORT_FIELD_LABELS[f]).join(exportDelimiter)}
              </div>
            </div>
          </div>
        </div>
      )}

      {edit && (
        <div
          onClick={() => !edit.saving && setEdit(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 1100,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 60,
            overflow: "auto",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--paper)",
              border: "1px solid var(--line-strong)",
              borderRadius: 8,
              width: "min(640px, 92vw)",
              padding: 20,
              boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <div>
                <div
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  Sửa tài khoản
                </div>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    color: "var(--ink)",
                    marginTop: 2,
                  }}
                >
                  @{edit.username || "…"}
                </div>
              </div>
              <button
                disabled={edit.saving}
                onClick={() => setEdit(null)}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "var(--muted)",
                  cursor: "pointer",
                  fontSize: 18,
                }}
              >
                ×
              </button>
            </div>

            {edit.loading ? (
              <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)" }}>
                Đang tải…
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <EditField
                  label="Username"
                  value={edit.username}
                  onChange={(v) => setEdit((p) => (p ? { ...p, username: v } : p))}
                  mono
                />
                <EditField
                  label="Password"
                  value={edit.password}
                  onChange={(v) => setEdit((p) => (p ? { ...p, password: v } : p))}
                  type={edit.showPassword ? "text" : "password"}
                  mono
                  rightAction={{
                    label: edit.showPassword ? "Ẩn" : "Hiện",
                    onClick: () =>
                      setEdit((p) => (p ? { ...p, showPassword: !p.showPassword } : p)),
                  }}
                />
                {edit.passwordHistory.length > 0 && (
                  <HistoryList
                    label="Mật khẩu gần nhất"
                    entries={edit.passwordHistory}
                    copy={(v) => copyText(v, `edit-pw-hist-${Date.now()}`)}
                  />
                )}
                <EditField
                  label="Email"
                  value={edit.email}
                  onChange={(v) => setEdit((p) => (p ? { ...p, email: v } : p))}
                  mono
                />
                <EditField
                  label="2FA secret"
                  value={edit.twofa}
                  onChange={(v) => setEdit((p) => (p ? { ...p, twofa: v } : p))}
                  mono
                />
                <EditField
                  label="Email password"
                  value={edit.emailPassword}
                  onChange={(v) =>
                    setEdit((p) => (p ? { ...p, emailPassword: v } : p))
                  }
                  type={edit.showEmailPassword ? "text" : "password"}
                  mono
                  rightAction={{
                    label: edit.showEmailPassword ? "Ẩn" : "Hiện",
                    onClick: () =>
                      setEdit((p) =>
                        p ? { ...p, showEmailPassword: !p.showEmailPassword } : p,
                      ),
                  }}
                />
                {edit.emailPasswordHistory.length > 0 && (
                  <HistoryList
                    label="Email password gần nhất"
                    entries={edit.emailPasswordHistory}
                    copy={(v) => copyText(v, `edit-epw-hist-${Date.now()}`)}
                  />
                )}
                <div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 12,
                      color: "var(--muted)",
                      marginBottom: 4,
                    }}
                  >
                    Note
                  </div>
                  <textarea
                    value={edit.note}
                    onChange={(e) =>
                      setEdit((p) => (p ? { ...p, note: e.target.value } : p))
                    }
                    rows={3}
                    className="textarea"
                    style={{ width: "100%", minHeight: 60 }}
                  />
                </div>

                {edit.error && (
                  <div
                    style={{
                      padding: "8px 10px",
                      background: "var(--danger-soft)",
                      border: "1px solid rgba(224,91,91,0.4)",
                      borderRadius: 6,
                      color: "var(--danger)",
                      fontSize: 12,
                    }}
                  >
                    {edit.error}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                    marginTop: 6,
                    paddingTop: 12,
                    borderTop: "1px solid var(--line)",
                  }}
                >
                  <button
                    disabled={edit.saving}
                    onClick={() => setEdit(null)}
                    className="btn"
                  >
                    Hủy
                  </button>
                  <button
                    disabled={edit.saving || !edit.username.trim()}
                    onClick={saveEdit}
                    className="btn btn-primary"
                  >
                    {edit.saving ? "Đang lưu…" : "Lưu"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {ctxMenu && <div className="ctx-backdrop only-phone" onClick={() => setCtxMenu(null)} aria-hidden="true" />}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="ctx-menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: "fixed",
            top: ctxMenuPos?.top ?? ctxMenu.y,
            left: ctxMenuPos?.left ?? ctxMenu.x,
            maxHeight: "calc(100vh - 16px)",
            overflowY: "auto",
            zIndex: 1000,
            background: "var(--paper)",
            border: "1px solid var(--line-strong)",
            borderRadius: 6,
            minWidth: 220,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            padding: 4,
            fontSize: 12,
          }}
        >
          <div
            className="mono"
            style={{
              padding: "6px 10px 8px",
              fontSize: 12,
              color: "var(--muted)",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
            }}
          >
            <a
              href={`https://www.tiktok.com/@${ctxMenu.username}`}
              target="_blank"
              rel="noreferrer"
              title="Mở TikTok trong tab mới"
              style={{ color: "inherit", textDecoration: "none" }}
              onMouseEnter={(e) =>
                ((e.target as HTMLAnchorElement).style.color = "var(--accent)")
              }
              onMouseLeave={(e) =>
                ((e.target as HTMLAnchorElement).style.color = "var(--muted)")
              }
            >
              @{ctxMenu.username} <ExternalLink size={13} aria-hidden="true" style={{ verticalAlign: "-1px" }} />
            </a>
          </div>
          {ctxMenu.loading && (
            <div style={{ padding: "10px 10px", color: "var(--muted)" }}>
              Đang tải…
            </div>
          )}
          {ctxMenu.error && (
            <div style={{ padding: "10px", color: "var(--danger)" }}>
              {ctxMenu.error}
            </div>
          )}
          {ctxMenu.detail && (() => {
            const d = ctxMenu.detail;
            const items: Array<{
              label: string;
              value: string | null;
              tag: string;
            }> = [
              { label: "Copy User", value: d.username, tag: "user" },
              { label: "Copy Pass", value: d.password, tag: "pass" },
              { label: "Copy Email", value: d.email, tag: "email" },
              { label: "Copy 2FA (secret)", value: d.twofa, tag: "2fa" },
              { label: "Copy Pass Email", value: d.emailPassword, tag: "pmail" },
            ];
            const fullLine = [
              d.username ?? "",
              d.password ?? "",
              d.email ?? "",
              d.twofa ?? "",
              d.emailPassword ?? "",
            ].join("|");
            return (
              <div>
                <button
                  onClick={() => {
                    const target = { id: ctxMenu.id, username: ctxMenu.username };
                    setCtxMenu(null);
                    openEditModal(target.id, target.username);
                  }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    textAlign: "left",
                    padding: "7px 10px",
                    background: "transparent",
                    border: 0,
                    color: "var(--ink)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontFamily: "var(--font-sans)",
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-1)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span>Sửa thông tin…</span>
                  <Pencil size={14} aria-hidden="true" style={{ color: "var(--muted)" }} />
                </button>

                <div style={{ padding: "6px 10px 4px" }}>
                  <div
                    className="mono"
                    style={{
                      fontSize: 12,
                      color: "var(--muted)",
                      marginBottom: 4,
                    }}
                  >
                    Nhóm
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <select
                      className="input"
                      value={d.groupId ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__new__") {
                          createGroupFromCtx(ctxMenu.id);
                          return;
                        }
                        moveOneToGroup(ctxMenu.id, v === "" ? null : Number(v));
                      }}
                      style={{ flex: 1, padding: "4px 6px", fontSize: 11 }}
                    >
                      <option value="">— Không nhóm —</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                      <option value="__new__">+ Tạo nhóm mới…</option>
                    </select>
                  </div>
                </div>

                <div style={{ padding: "4px 10px 6px", display: "flex", gap: 6 }}>
                  <button
                    disabled={ctxMenu.fetchAction !== null}
                    onClick={() => runFetchOne(ctxMenu.id, "follow")}
                    className="btn btn-accent"
                    style={{ flex: 1, padding: "5px 8px", fontSize: 12 }}
                  >
                    {ctxMenu.fetchAction === "follow" ? "Đang lấy…" : "Lấy Follow"}
                  </button>
                  <button
                    disabled={ctxMenu.fetchAction !== null}
                    onClick={() => runFetchOne(ctxMenu.id, "video")}
                    className="btn btn-primary"
                    style={{ flex: 1, padding: "5px 8px", fontSize: 12 }}
                  >
                    {ctxMenu.fetchAction === "video" ? "Đang lấy…" : "Lấy Video"}
                  </button>
                </div>
                {ctxMenu.fetchMessage && (
                  <div
                    style={{
                      padding: "2px 10px 6px",
                      fontSize: 11,
                      color: "var(--accent)",
                    }}
                  >
                    {ctxMenu.fetchMessage}
                  </div>
                )}
                {ctxMenu.fetchError && (
                  <div
                    style={{
                      padding: "2px 10px 6px",
                      fontSize: 11,
                      color: "var(--danger)",
                    }}
                  >
                    {ctxMenu.fetchError}
                  </div>
                )}

                <div
                  style={{
                    borderTop: "1px solid var(--line)",
                    margin: "4px -4px",
                  }}
                />
                {items.map((it) => {
                  const disabled = !it.value;
                  const copied = copiedLabel === `ctx-${ctxMenu.id}-${it.tag}`;
                  return (
                    <button
                      key={it.tag}
                      disabled={disabled}
                      onClick={() => {
                        if (it.value) {
                          copyText(it.value, `ctx-${ctxMenu.id}-${it.tag}`);
                        }
                      }}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        width: "100%",
                        textAlign: "left",
                        padding: "7px 10px",
                        background: "transparent",
                        border: 0,
                        color: disabled ? "var(--muted)" : "var(--ink)",
                        cursor: disabled ? "not-allowed" : "pointer",
                        fontSize: 12,
                        fontFamily: "var(--font-sans)",
                        borderRadius: 4,
                      }}
                      onMouseEnter={(e) => {
                        if (!disabled) e.currentTarget.style.background = "var(--bg-1)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span>{it.label}</span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 12,
                          color: copied ? "var(--accent)" : "var(--muted)",
                        }}
                      >
                        {copied ? <Check size={14} aria-hidden="true" /> : disabled ? "—" : ""}
                      </span>
                    </button>
                  );
                })}
                <TotpMenuButton
                  secret={d.twofa}
                  copied={copiedLabel === `ctx-${ctxMenu.id}-totp`}
                  onCopy={(code) => copyText(code, `ctx-${ctxMenu.id}-totp`)}
                />
                <div style={{ padding: "4px 4px 0" }}>
                  <button
                    disabled={ctxMenu.browserLogin === "loading" || !d.email}
                    onClick={() => startHotmailBrowserLogin(ctxMenu.id)}
                    title={
                      d.email
                        ? "Mở Chromium, tự điền email/mật khẩu; cookie lưu lại cho lần sau"
                        : "Tài khoản chưa có email"
                    }
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      width: "100%",
                      textAlign: "left",
                      padding: "7px 6px",
                      background: "transparent",
                      border: 0,
                      color:
                        ctxMenu.browserLogin === "loading" || !d.email
                          ? "var(--muted)"
                          : "var(--ink)",
                      cursor:
                        ctxMenu.browserLogin === "loading"
                          ? "progress"
                          : !d.email
                          ? "not-allowed"
                          : "pointer",
                      fontSize: 12,
                      fontFamily: "var(--font-sans)",
                      borderRadius: 4,
                    }}
                    onMouseEnter={(e) => {
                      if (ctxMenu.browserLogin !== "loading" && d.email)
                        e.currentTarget.style.background = "var(--bg-1)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <span>
                      {ctxMenu.browserLogin === "loading"
                        ? "Đang mở Chromium…"
                        : "Login Hotmail (Chromium)"}
                    </span>
                    <ExternalLink size={14} aria-hidden="true" style={{ color: "var(--muted)" }} />
                  </button>
                  {ctxMenu.browserLoginMessage && (
                    <div
                      style={{
                        padding: "0 6px 4px",
                        fontSize: 11,
                        color: "var(--accent)",
                      }}
                    >
                      {ctxMenu.browserLoginMessage}
                    </div>
                  )}
                  {ctxMenu.browserLoginError && (
                    <div
                      style={{
                        padding: "0 6px 4px",
                        fontSize: 11,
                        color: "var(--danger)",
                        wordBreak: "break-word",
                      }}
                    >
                      {ctxMenu.browserLoginError}
                    </div>
                  )}
                </div>

                <HotmailMenuRow
                  state={ctxMenu.hotmail}
                  hasToken={d.hasMsToken}
                  msEmail={d.msEmail}
                  onFetch={() => fetchHotmailCode(ctxMenu.id)}
                  onAuth={(url) => openOAuthPopup(url, ctxMenu.id)}
                  onDisconnect={() => disconnectHotmail(ctxMenu.id)}
                  onCopyCode={(code) =>
                    copyText(code, `hotmail-${ctxMenu.id}`)
                  }
                  copied={copiedLabel === `hotmail-${ctxMenu.id}`}
                />
                <div
                  style={{
                    borderTop: "1px solid var(--line-strong)",
                    margin: "8px -4px 0",
                  }}
                />
                <button
                  onClick={() => copyText(fullLine, `ctx-${ctxMenu.id}-full`)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 10px",
                    marginTop: 4,
                    background: "var(--bg-1)",
                    border: 0,
                    color: "var(--accent)",
                    cursor: "pointer",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--line)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-1)")}
                >
                  <span>Copy full</span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 12,
                      color:
                        copiedLabel === `ctx-${ctxMenu.id}-full`
                          ? "var(--accent)"
                          : "var(--muted)",
                      textTransform: "none",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {copiedLabel === `ctx-${ctxMenu.id}-full`
                      ? <Check size={14} aria-hidden="true" />
                      : "user|pass|email|2fa|pmail"}
                  </span>
                </button>
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
}

function HotmailMenuRow({
  state,
  hasToken,
  msEmail,
  onFetch,
  onAuth,
  onDisconnect,
  onCopyCode,
  copied,
}: {
  state: HotmailState;
  hasToken: boolean;
  msEmail: string | null;
  onFetch: () => void;
  onAuth: (url: string) => void;
  onDisconnect: () => void;
  onCopyCode: (code: string) => void;
  copied: boolean;
}) {
  const isLoading = state.phase === "loading" || state.phase === "waiting-popup";
  const result = state.phase === "result" ? state : null;
  const needsAuth = state.phase === "needs-auth" ? state : null;
  const error = state.phase === "error" ? state : null;

  const primaryLabel = (() => {
    if (state.phase === "loading") return "Đang lấy…";
    if (state.phase === "waiting-popup") return "Đang chờ đăng nhập…";
    if (needsAuth) return hasToken ? "Đăng nhập lại Microsoft" : "Kết nối Hotmail";
    if (result) return "Lấy lại code";
    return "Lấy code Hotmail";
  })();

  const handlePrimary = () => {
    if (isLoading) return;
    if (needsAuth) {
      onAuth(needsAuth.authUrl);
      return;
    }
    onFetch();
  };

  return (
    <div style={{ padding: "4px 4px 0" }}>
      <button
        onClick={handlePrimary}
        disabled={isLoading}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          width: "100%",
          textAlign: "left",
          padding: "7px 6px",
          background: "transparent",
          border: 0,
          color: isLoading ? "var(--muted)" : "var(--ink)",
          cursor: isLoading ? "progress" : "pointer",
          fontSize: 12,
          fontFamily: "var(--font-sans)",
          borderRadius: 4,
        }}
        onMouseEnter={(e) => {
          if (!isLoading) e.currentTarget.style.background = "var(--bg-1)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <span>{primaryLabel}</span>
        <span
          className="mono"
          style={{ fontSize: 12, color: "var(--muted)" }}
        >
          {hasToken ? (msEmail ?? <Check size={14} aria-hidden="true" />) : "Chưa kết nối"}
        </span>
      </button>
      {result && (
        <div
          onClick={() => onCopyCode(result.code)}
          style={{
            margin: "2px 2px 4px",
            padding: "6px 8px",
            background: "var(--bg-1)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            cursor: "pointer",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
          title={result.subject}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span
              className="mono"
              style={{
                fontSize: 14,
                color: "var(--accent)",
                fontWeight: 600,
              }}
            >
              {result.code.replace(/(\d{3})(\d{3})/, "$1 $2")}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 12,
                color: "var(--muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {result.from || "—"} · {relativeAgo(result.receivedAt)}
            </span>
          </div>
          <span
            className="mono"
            style={{ fontSize: 12, color: copied ? "var(--accent)" : "var(--muted)" }}
          >
            {copied ? "Đã chép" : "Chép"}
          </span>
        </div>
      )}
      {needsAuth?.message && (
        <div
          className="mono"
          style={{ fontSize: 12, color: "var(--muted)", padding: "2px 6px 4px" }}
        >
          {needsAuth.message}
        </div>
      )}
      {error && (
        <div
          className="mono"
          style={{
            fontSize: 12,
            color: "var(--danger)",
            padding: "2px 6px 4px",
            wordBreak: "break-word",
          }}
        >
          {error.message}
        </div>
      )}
      {hasToken && !isLoading && (
        <button
          onClick={onDisconnect}
          style={{
            background: "transparent",
            border: 0,
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: 12,
            padding: "2px 6px 6px",
          }}
          title="Xoá OAuth token"
        >
          Ngắt kết nối {msEmail ? `(${msEmail})` : ""}
        </button>
      )}
    </div>
  );
}

function relativeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s trước`;
  if (s < 3600) return `${Math.floor(s / 60)}m trước`;
  if (s < 86400) return `${Math.floor(s / 3600)}h trước`;
  return `${Math.floor(s / 86400)}d trước`;
}

function SortableTh({
  label,
  sortKey,
  active,
  dir,
  onToggle,
  align,
  width,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onToggle: (k: SortKey) => void;
  align?: "right";
  width?: number;
}) {
  const isActive = active === sortKey;
  const Arrow = isActive ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th
      className={align === "right" ? "right" : undefined}
      style={{ width }}
      aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className={`th-sort${isActive ? " active" : ""}`} onClick={() => onToggle(sortKey)} title={`Sắp xếp theo ${label}`}>
        <span>{label}</span>
        <Arrow size={13} aria-hidden="true" />
      </button>
    </th>
  );
}

function EditField({
  label,
  value,
  onChange,
  mono,
  type = "text",
  rightAction,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  type?: string;
  rightAction?: { label: string; onClick: () => void };
}) {
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 12,
          color: "var(--muted)",
          marginBottom: 4,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{label}</span>
        {rightAction && (
          <button
            onClick={rightAction.onClick}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {rightAction.label}
          </button>
        )}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
        style={{
          width: "100%",
          fontFamily: mono ? "var(--font-mono)" : undefined,
          fontSize: 13,
        }}
        spellCheck={false}
        autoComplete="off"
      />
    </div>
  );
}

function HistoryList({
  label,
  entries,
  copy,
}: {
  label: string;
  entries: HistoryEntry[];
  copy: (v: string) => void;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: "var(--bg-1)",
        border: "1px solid var(--line)",
        borderRadius: 6,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 12,
          color: "var(--muted)",
          marginBottom: 6,
        }}
      >
        {label} ({entries.length})
      </div>
      {entries.map((e, i) => (
        <div
          key={`${e.changedAt}-${i}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 0",
            borderTop: i === 0 ? "none" : "1px dashed var(--line)",
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink)",
              flex: 1,
              wordBreak: "break-all",
            }}
          >
            {e.value || "—"}
          </span>
          <span
            className="mono"
            style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}
          >
            {new Date(e.changedAt * 1000).toLocaleString("vi-VN", {
              day: "2-digit",
              month: "2-digit",
              year: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {e.value && (
            <button
              onClick={() => copy(e.value as string)}
              style={{
                background: "transparent",
                border: "1px solid var(--line-strong)",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: 12,
                padding: "2px 6px",
                borderRadius: 4,
              }}
              title="Copy"
            >
              copy
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// Give the selected accounts to another app user — move (they leave this
// list) or copy (both users keep one). Server: /api/accounts/transfer.
function TransferModal({
  ids,
  onClose,
  onDone,
}: {
  ids: number[];
  onClose: () => void;
  onDone: (mode: "move" | "copy") => Promise<void>;
}) {
  const [toUsername, setToUsername] = useState("");
  const [mode, setMode] = useState<"move" | "copy">("move");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    done: number;
    to: string;
    mode: "move" | "copy";
    skipped: Array<{ username: string; reason: string }>;
  } | null>(null);

  async function submit() {
    if (!toUsername.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts/transfer", {
        method: "POST",
        headers: { "X-Body": encodeBodyHeader({ ids, toUsername: toUsername.trim(), mode }) },
      });
      const data = await res.json().catch(() => ({ error: `Lỗi ${res.status}` }));
      if (!res.ok || data.error) {
        setError(data.error ?? `Lỗi ${res.status}`);
        return;
      }
      setResult(data);
      await onDone(mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, width: "90%" }}>
        <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
          Chuyển tài khoản
        </div>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 22, margin: "6px 0 16px", letterSpacing: "-0.01em" }}>
          {ids.length} tài khoản sang user khác
        </h2>

        {result ? (
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ color: "var(--good)" }}>
              Đã {result.mode === "move" ? "chuyển" : "sao chép"} {result.done} tài khoản cho <b>{result.to}</b>.
            </div>
            {result.skipped.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ color: "var(--warn)" }}>Bỏ qua {result.skipped.length}:</div>
                <ul style={{ margin: "4px 0 0 18px", maxHeight: 180, overflowY: "auto", color: "var(--muted)" }}>
                  {result.skipped.map((s) => (
                    <li key={s.username}>
                      <span className="mono" style={{ color: "var(--ink-soft)" }}>{s.username}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ marginTop: 16, textAlign: "right" }}>
              <button className="btn btn-primary" onClick={onClose} style={{ padding: "6px 14px", fontSize: 12 }}>
                Xong
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="section-label" style={{ display: "block", marginBottom: 6 }}>
              Username của user nhận
            </label>
            <input
              className="input"
              value={toUsername}
              onChange={(e) => setToUsername(e.target.value)}
              placeholder="vd: nhanvien01"
              autoFocus
              style={{ width: "100%" }}
            />
            <div style={{ display: "grid", gap: 8, margin: "16px 0", fontSize: 13 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                <input type="radio" checked={mode === "move"} onChange={() => setMode("move")} />
                <span>
                  <b>Chuyển</b> — tài khoản rời khỏi danh sách của bạn, sang user nhận.
                </span>
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                <input type="radio" checked={mode === "copy"} onChange={() => setMode("copy")} />
                <span>
                  <b>Sao chép</b> — user nhận có một bản, bạn vẫn giữ bản của mình.
                </span>
              </label>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, marginBottom: 14 }}>
              Toàn bộ thông tin được chuyển (pass, email, 2FA, lịch sử, token Hotmail, ghi chú, số liệu). Nhóm /
              trạng thái / quốc gia / máy / nhân viên là danh mục riêng của bạn nên được để trống bên user nhận.
              Tài khoản user nhận đã có sẽ được bỏ qua.
            </div>
            {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={onClose} style={{ padding: "6px 14px", fontSize: 12 }}>
                Hủy
              </button>
              <button className="btn btn-primary" disabled={!toUsername.trim() || busy} style={{ padding: "6px 14px", fontSize: 12 }}>
                {busy ? "Đang xử lý…" : mode === "move" ? "Chuyển" : "Sao chép"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// "Copy 2FA code" row of the account context menu. Owns its 1-second tick so
// the countdown repaints only this row — the tick used to live in the page
// and re-rendered the whole account list every second while the menu was open.
function TotpMenuButton({
  secret,
  copied,
  onCopy,
}: {
  secret: string | null;
  copied: boolean;
  onCopy: (code: string) => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!secret) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [secret]);
  const totp = secret ? generateTotpCode(secret) : null;
  const remaining = totp ? Math.max(1, Math.ceil(totp.remainingMs / 1000)) : 0;
  return (
    <button
      disabled={!totp}
      onClick={() => {
        if (totp) onCopy(totp.code);
      }}
      title={
        secret && !totp
          ? "Secret 2FA không hợp lệ (không phải Base32 / otpauth URI)"
          : totp
          ? `Mã còn hiệu lực ${remaining}s`
          : "Tài khoản chưa có secret 2FA"
      }
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        width: "100%",
        textAlign: "left",
        padding: "7px 10px",
        background: "transparent",
        border: 0,
        color: totp ? "var(--ink)" : "var(--muted)",
        cursor: totp ? "pointer" : "not-allowed",
        fontSize: 12,
        fontFamily: "var(--font-sans)",
        borderRadius: 4,
      }}
      onMouseEnter={(e) => {
        if (totp) e.currentTarget.style.background = "var(--bg-1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span>Copy 2FA code</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {totp && (
          <>
            <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>
              {totp.code.replace(/(\d{3})(\d{3})/, "$1 $2")}
            </span>
            <span className="mono" style={{ fontSize: 12, color: remaining <= 5 ? "var(--danger)" : "var(--muted)" }}>
              {remaining}s
            </span>
          </>
        )}
        <span className="mono" style={{ fontSize: 12, color: copied ? "var(--accent)" : "var(--muted)" }}>
          {copied ? <Check size={14} aria-hidden="true" /> : totp ? "" : "—"}
        </span>
      </span>
    </button>
  );
}

// ── Số ngày chưa đăng video ──────────────────────────────────────────────
// Tính từ video mới nhất trong "3 video gần nhất" (cập nhật khi bấm Lấy Video
// hoặc Đồng bộ 4h). Cài đặt lưu trên trình duyệt này.

interface IdleDaysSettings {
  enabled: boolean;
  /** Chỉ hiện khi từ N ngày trở lên (0 = luôn hiện) */
  minDays: number;
  /** Tô đỏ khi từ N ngày trở lên */
  warnDays: number;
}

const IDLE_KEY = "tt_idle_days_v1";
const IDLE_DEFAULT: IdleDaysSettings = { enabled: true, minDays: 0, warnDays: 3 };

function useIdleDaysSettings(): [IdleDaysSettings, (c: IdleDaysSettings) => void] {
  const [cfg, setCfg] = useState<IdleDaysSettings>(IDLE_DEFAULT);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(IDLE_KEY) || "null");
      if (saved && typeof saved === "object") setCfg({ ...IDLE_DEFAULT, ...saved });
    } catch {}
  }, []);
  const update = useCallback((c: IdleDaysSettings) => {
    setCfg(c);
    try {
      localStorage.setItem(IDLE_KEY, JSON.stringify(c));
    } catch {}
  }, []);
  return [cfg, update];
}

/** Số ngày từ video mới nhất đến hôm nay; null = chưa lấy video, -1 = không có video công khai. */
function idleDays(videos: Video[] | null): { days: number | null; last: number | null } {
  if (!videos) return { days: null, last: null };
  const last = videos.reduce((m, v) => Math.max(m, v.postedAt || 0), 0);
  if (!last) return { days: -1, last: null };
  return { days: Math.max(0, Math.floor((Date.now() / 1000 - last) / 86400)), last };
}

function IdleDaysBadge({ videos, cfg }: { videos: Video[] | null; cfg: IdleDaysSettings }) {
  const { days, last } = idleDays(videos);
  if (days === null) return null;
  if (days >= 0 && days < cfg.minDays) return null;
  const tone = days < 0 || days >= cfg.warnDays ? "warn" : days <= 1 ? "fresh" : "";
  const text = days < 0 ? "Chưa có video" : days === 0 ? "Đăng hôm nay" : `${days} ngày chưa đăng`;
  const title = last ? `Video gần nhất: ${new Date(last * 1000).toLocaleString("vi-VN")}` : "Không thấy video công khai";
  return (
    <span className={`idle-badge ${tone}`} title={title}>
      {text}
    </span>
  );
}

function IdleDaysMenu({
  cfg,
  onChange,
  open,
  onOpenChange,
}: {
  cfg: IdleDaysSettings;
  onChange: (c: IdleDaysSettings) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // The toolbar scrolls horizontally (overflow-x: auto) and would clip an
  // absolutely positioned popover — place it fixed under the button instead.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(16, window.innerWidth - r.right) });
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpenChange(false);
    };
    const hide = () => onOpenChange(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open, onOpenChange]);
  const num = (v: string) => Math.max(0, Math.min(365, Math.floor(Number(v) || 0)));
  return (
    <div ref={ref} className="idle-menu">
      <button
        ref={btnRef}
        type="button"
        className={`btn${cfg.enabled ? " btn-accent" : ""}`}
        style={{ padding: "6px 12px", fontSize: 12, flexShrink: 0 }}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        title="Cài đặt hiển thị số ngày chưa đăng video"
      >
        <Settings2 size={14} aria-hidden="true" />
        <span className="btn-label">Số ngày chưa đăng</span>
      </button>
      {open && pos && (
        <div className="idle-pop" style={{ top: pos.top, right: pos.right }} role="dialog" aria-label="Cài đặt số ngày chưa đăng video">
          <label className="idle-row">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => onChange({ ...cfg, enabled: e.target.checked })} />
            Hiện số ngày chưa đăng video
          </label>
          <label className="idle-row" style={{ opacity: cfg.enabled ? 1 : 0.5 }}>
            Chỉ hiện khi từ
            <input
              type="number"
              min={0}
              max={365}
              className="input"
              disabled={!cfg.enabled}
              value={cfg.minDays}
              onChange={(e) => onChange({ ...cfg, minDays: num(e.target.value) })}
            />
            ngày
          </label>
          <label className="idle-row" style={{ opacity: cfg.enabled ? 1 : 0.5 }}>
            Tô đỏ khi từ
            <input
              type="number"
              min={1}
              max={365}
              className="input"
              disabled={!cfg.enabled}
              value={cfg.warnDays}
              onChange={(e) => onChange({ ...cfg, warnDays: Math.max(1, num(e.target.value)) })}
            />
            ngày
          </label>
          <div className="idle-hint">
            Tính từ video mới nhất đã lấy về. Bấm <b>Lấy Video</b> để cập nhật. Tài khoản chưa lấy video sẽ không hiện số.
          </div>
        </div>
      )}
    </div>
  );
}
