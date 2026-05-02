"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { generateTotpCode } from "@/lib/totp";

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
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [search, setSearch] = useState("");
  const [pickFrom, setPickFrom] = useState<number>(1);
  const [pickTo, setPickTo] = useState<number>(10);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [exportOpen, setExportOpen] = useState(false);
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
  const [totpTick, setTotpTick] = useState(0);
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
    if (!ctxMenu?.detail?.twofa) return;
    const id = setInterval(() => setTotpTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [ctxMenu?.detail?.twofa]);

  useEffect(() => {
    if (!ctxMenu) return;
    function close() {
      setCtxMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
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
      alert(`Không có tài khoản nào có STT từ ${from} đến ${to} trên trang hiện tại`);
      return;
    }
    setSelected(new Set(ids));
  }

  async function runFetchBulk(endpoint: "fetch-follow" | "fetch-videos" | "fetch-avatar") {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      alert("Chưa chọn tài khoản nào");
      return;
    }
    setAction(endpoint);
    try {
      const res = await fetch(`/api/accounts/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      alert(`Hoàn tất: ${data.success}/${data.total} thành công · ${data.failed} lỗi`);
      await load();
    } catch (e) {
      alert("Lỗi: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAction(null);
    }
  }

  async function moveSelectedToGroup(newGroupId: number | null) {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      alert("Chưa chọn tài khoản nào");
      return;
    }
    await fetch(`/api/accounts/move-group`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, groupId: newGroupId }),
    });
    setSelected(new Set());
    await load();
  }

  async function updateSelectedStatus(statusId: number | null) {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      alert("Chưa chọn tài khoản nào");
      return;
    }
    await fetch(`/api/accounts/bulk-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, statusId }),
    });
    setSelected(new Set());
    await load();
  }

  async function updateSelectedCountry(countryId: number | null) {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      alert("Chưa chọn tài khoản nào");
      return;
    }
    await fetch(`/api/accounts/bulk-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, countryId }),
    });
    setSelected(new Set());
    await load();
  }

  async function updateSelectedMachine(machineId: number | null) {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      alert("Chưa chọn tài khoản nào");
      return;
    }
    await fetch(`/api/accounts/bulk-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, machineId }),
    });
    setSelected(new Set());
    await load();
  }

  async function updateSelectedEmployee(employeeId: number | null) {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      alert("Chưa chọn tài khoản nào");
      return;
    }
    await fetch(`/api/accounts/bulk-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, employeeId }),
    });
    setSelected(new Set());
    await load();
  }

  async function removeSelectedFromGroup() {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      alert("Chưa chọn tài khoản nào");
      return;
    }
    if (!confirm(`Xóa ${ids.length} tài khoản khỏi nhóm hiện tại?`)) return;
    await moveSelectedToGroup(null);
  }

  async function deleteSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      alert("Chưa chọn tài khoản nào");
      return;
    }
    if (
      !confirm(
        `Xóa vĩnh viễn ${ids.length} tài khoản? Hành động này không thể hoàn tác.`
      )
    )
      return;
    setAction("delete");
    try {
      const res = await fetch(`/api/accounts/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Lỗi" }));
        alert(err.error ?? "Lỗi xóa tài khoản");
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
      alert("Chưa chọn tài khoản nào");
      return;
    }
    setExportOpen(true);
    setExportBusy(true);
    setExportText("");
    setExportCount(0);
    try {
      const res = await fetch(`/api/accounts/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, delimiter: exportDelimiter, fields: exportFields }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Lỗi" }));
        alert(err.error ?? "Lỗi xuất dữ liệu");
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, delimiter: nextDelimiter, fields: nextFields }),
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: edit.username.trim(),
          password: edit.password,
          email: edit.email,
          twofa: edit.twofa,
          emailPassword: edit.emailPassword,
          note: edit.note,
        }),
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
      alert(
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
    if (!confirm("Ngắt kết nối Hotmail (xoá OAuth token) cho tài khoản này?")) return;
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusId }),
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ countryId }),
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineId }),
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId }),
    });
  }

  async function triggerAutoFetch() {
    if (!confirm("Đồng bộ ngay tất cả tài khoản? (follower + 3 video gần nhất)")) return;
    setAction("auto-fetch");
    try {
      const res = await fetch("/api/scheduler", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Lỗi" }));
        alert(err.error ?? "Lỗi");
        return;
      }
      alert("Đã khởi chạy đồng bộ ở nền. Refresh để xem kết quả sau vài phút.");
    } finally {
      setAction(null);
    }
  }

  async function moveOneToGroup(id: number, newGroupId: number | null) {
    await fetch(`/api/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: newGroupId }),
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
    const name = window.prompt("Tên nhóm mới:")?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: "#2d5a3d", description: "" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Lỗi" }));
        alert(err.error ?? "Không tạo được nhóm");
        return;
      }
      const created = (await res.json()) as { id: number };
      const listRes = await fetch("/api/groups", { cache: "no-store" });
      if (listRes.ok) {
        const data = (await listRes.json()) as { groups: GroupRow[] };
        setGroups(data.groups);
      }
      await moveOneToGroup(id, created.id);
    } catch (e) {
      alert("Lỗi: " + (e instanceof Error ? e.message : String(e)));
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
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
                fetchError: result?.error ?? "Lỗi không xác định",
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    await load();
  }

  async function deleteAccount(id: number) {
    if (!confirm("Xóa tài khoản này?")) return;
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
      <header
        className="page-header"
        style={{
          paddingBottom: 10,
          marginBottom: 12,
          alignItems: "center",
        }}
      >
        <div className="page-header-left" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <h1 className="h1-serif" style={{ fontSize: 20, margin: 0 }}>
            Danh sách tài khoản
          </h1>
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            {groups.length} nhóm · {statusesList.length} trạng thái
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Link href="/groups" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            Nhóm
          </Link>
          <Link href="/statuses" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            Trạng thái
          </Link>
          <Link href="/countries" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            Quốc gia
          </Link>
          <Link href="/machines" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            Máy
          </Link>
          <Link href="/employees" className="btn" style={{ padding: "6px 12px", fontSize: 10 }}>
            Nhân viên
          </Link>
          <Link href="/import" className="btn btn-primary" style={{ padding: "6px 14px", fontSize: 11 }}>
            + Import
          </Link>
        </div>
      </header>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {filterChips.map((chip) => {
          const active = groupFilter === chip.key;
          return (
            <button
              key={String(chip.key)}
              onClick={() => setGroupFilter(chip.key)}
              className="pill"
              style={{
                cursor: "pointer",
                borderColor: active ? "var(--ink)" : "var(--line-strong)",
                background: active ? "var(--ink)" : "var(--bg-2)",
                color: active ? "var(--bg)" : "var(--ink-soft)",
                padding: "4px 10px",
                fontSize: 10,
              }}
            >
              {chip.color && (
                <span
                  className="dot"
                  style={{
                    background: chip.color,
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    display: "inline-block",
                    marginRight: 5,
                  }}
                />
              )}
              {chip.label}
              {chip.count > 0 && (
                <span
                  className="mono"
                  style={{
                    marginLeft: 6,
                    fontSize: 9,
                    opacity: 0.7,
                    letterSpacing: "0.08em",
                  }}
                >
                  {chip.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <section className="section" style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "8px 12px",
            marginBottom: 12,
            border: "1px solid var(--line)",
            borderRadius: 10,
            background: "var(--paper)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "nowrap",
              overflowX: "auto",
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--muted)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {selected.size > 0
                ? `Đã chọn ${selected.size} / ${filtered.length}`
                : total > 0
                  ? `${total.toLocaleString()} tài khoản · ${page}/${totalPages}`
                  : `Chưa có tài khoản`}
            </span>
            <input
              type="search"
              placeholder="Tìm username hoặc note…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input"
              style={{
                flex: 1,
                minWidth: 180,
                maxWidth: 360,
                padding: "6px 12px",
                fontSize: 12,
              }}
            />
            <div style={{ flex: 1 }} />
            <button
              onClick={() => runFetchBulk("fetch-follow")}
              disabled={action !== null || selected.size === 0}
              className="btn btn-accent"
              style={{ padding: "6px 12px", fontSize: 10, flexShrink: 0 }}
            >
              {action === "fetch-follow" ? "Đang lấy…" : "Lấy Follow"}
            </button>
            <button
              onClick={() => runFetchBulk("fetch-avatar")}
              disabled={action !== null || selected.size === 0}
              title="Chỉ làm mới avatar — dùng khi avt bị mất / hết hạn URL"
              className="btn"
              style={{ padding: "6px 12px", fontSize: 10, flexShrink: 0 }}
            >
              {action === "fetch-avatar" ? "Đang lấy…" : "Lấy AVT"}
            </button>
            <button
              onClick={() => runFetchBulk("fetch-videos")}
              disabled={action !== null || selected.size === 0}
              className="btn btn-primary"
              style={{ padding: "6px 12px", fontSize: 10, flexShrink: 0 }}
            >
              {action === "fetch-videos" ? "Đang lấy…" : "Lấy Video"}
            </button>
            <button
              onClick={triggerAutoFetch}
              disabled={action !== null}
              title="Đồng bộ tất cả tài khoản ngay (follower + 3 video)"
              className="btn"
              style={{ padding: "6px 12px", fontSize: 10, flexShrink: 0 }}
            >
              {action === "auto-fetch" ? "Đang kích hoạt…" : "Đồng bộ 4h"}
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="btn"
              style={{ padding: "6px 12px", fontSize: 10, flexShrink: 0 }}
            >
              Refresh
            </button>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "nowrap",
              overflowX: "auto",
              paddingTop: 2,
              borderTop: "1px solid var(--line)",
              marginTop: 2,
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 9,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--muted)",
                whiteSpace: "nowrap",
                paddingRight: 4,
                flexShrink: 0,
              }}
            >
              Bulk
            </span>
            <select
              className="input"
              value=""
              disabled={selected.size === 0}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                moveSelectedToGroup(v === "none" ? null : Number(v));
                e.target.value = "";
              }}
              style={{ width: "auto", minWidth: 120, padding: "5px 8px", fontSize: 11, flexShrink: 0 }}
            >
              <option value="">Chuyển nhóm…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value=""
              disabled={selected.size === 0}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                updateSelectedStatus(v === "none" ? null : Number(v));
                e.target.value = "";
              }}
              style={{ width: "auto", minWidth: 130, padding: "5px 8px", fontSize: 11, flexShrink: 0 }}
            >
              <option value="">Đổi trạng thái…</option>
              <option value="none">— Bỏ trạng thái —</option>
              {statusesList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value=""
              disabled={selected.size === 0}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                updateSelectedCountry(v === "none" ? null : Number(v));
                e.target.value = "";
              }}
              style={{ width: "auto", minWidth: 130, padding: "5px 8px", fontSize: 11, flexShrink: 0 }}
            >
              <option value="">Đổi quốc gia…</option>
              <option value="none">— Bỏ quốc gia —</option>
              {countriesList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ? `${c.code} · ${c.name}` : c.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value=""
              disabled={selected.size === 0}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                updateSelectedMachine(v === "none" ? null : Number(v));
                e.target.value = "";
              }}
              style={{ width: "auto", minWidth: 120, padding: "5px 8px", fontSize: 11, flexShrink: 0 }}
            >
              <option value="">Đổi máy…</option>
              <option value="none">— Bỏ máy —</option>
              {machinesList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value=""
              disabled={selected.size === 0}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                updateSelectedEmployee(v === "none" ? null : Number(v));
                e.target.value = "";
              }}
              style={{ width: "auto", minWidth: 130, padding: "5px 8px", fontSize: 11, flexShrink: 0 }}
            >
              <option value="">Đổi nhân viên…</option>
              <option value="none">— Bỏ nhân viên —</option>
              {employeesList.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
            <button
              onClick={openExportSelected}
              disabled={selected.size === 0 || exportBusy}
              title="Xuất thông tin tài khoản đã chọn (User|Pass|Email|2FA|Pass Email)"
              className="btn"
              style={{ padding: "5px 10px", fontSize: 10, flexShrink: 0 }}
            >
              {exportBusy ? "Đang xuất…" : `Xuất (${selected.size})`}
            </button>
            <button
              onClick={removeSelectedFromGroup}
              disabled={selected.size === 0}
              title="Xóa khỏi nhóm (giữ tài khoản)"
              className="btn"
              style={{ padding: "5px 10px", fontSize: 10, flexShrink: 0 }}
            >
              Bỏ nhóm
            </button>
            <button
              onClick={deleteSelected}
              disabled={action !== null || selected.size === 0}
              title="Xóa vĩnh viễn các tài khoản đã chọn"
              className="btn btn-danger"
              style={{ padding: "5px 10px", fontSize: 10, flexShrink: 0 }}
            >
              {action === "delete" ? "Đang xóa…" : "Xóa vĩnh viễn"}
            </button>
            <div style={{ flex: 1 }} />
            <div
              style={{
                display: "inline-flex",
                alignItems: "stretch",
                border: "1px solid var(--line-strong)",
                borderRadius: 6,
                overflow: "hidden",
                background: "var(--bg-1)",
                flexShrink: 0,
              }}
            >
              <input
                type="number"
                min={1}
                value={pickFrom}
                onChange={(e) => setPickFrom(Number(e.target.value) || 1)}
                title="Từ STT"
                placeholder="Từ"
                style={{
                  width: 46,
                  background: "transparent",
                  border: 0,
                  color: "var(--ink)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  textAlign: "center",
                  padding: "0 4px",
                  outline: "none",
                }}
              />
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "0 4px",
                  color: "var(--muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  borderLeft: "1px solid var(--line)",
                  borderRight: "1px solid var(--line)",
                }}
              >
                →
              </span>
              <input
                type="number"
                min={1}
                value={pickTo}
                onChange={(e) => setPickTo(Number(e.target.value) || 1)}
                title="Đến STT"
                placeholder="Đến"
                style={{
                  width: 46,
                  background: "transparent",
                  border: 0,
                  color: "var(--ink)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  textAlign: "center",
                  padding: "0 4px",
                  outline: "none",
                }}
              />
              <button
                onClick={pickRange}
                disabled={filtered.length === 0}
                title={`Chọn tài khoản có STT từ ${pickFrom} đến ${pickTo}`}
                style={{
                  border: 0,
                  borderLeft: "1px solid var(--line-strong)",
                  background: "var(--bg-2)",
                  color: "var(--ink)",
                  padding: "5px 10px",
                  fontSize: 10,
                  fontFamily: "var(--font-sans)",
                  fontWeight: 500,
                  cursor: filtered.length === 0 ? "not-allowed" : "pointer",
                  opacity: filtered.length === 0 ? 0.4 : 1,
                }}
              >
                Chọn {pickFrom}→{pickTo}
              </button>
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
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
                <th style={{ width: 50 }} className="right">STT</th>
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
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={11} style={{ padding: 56, textAlign: "center" }}>
                    <div className="section-label" style={{ marginBottom: 12 }}>
                      Trống
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontSize: 18,
                        fontStyle: "italic",
                        color: "var(--muted)",
                      }}
                    >
                      {total === 0 ? (
                        <>
                          Chưa có tài khoản. <Link href="/import" className="text-accent">Import ngay →</Link>
                        </>
                      ) : (
                        "Không tìm thấy kết quả"
                      )}
                    </div>
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
                      onChange={() => toggleOne(r.id)}
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
                                fontFamily: "var(--font-mono)",
                                fontSize: 9,
                                letterSpacing: "0.02em",
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
                          fontFamily: "var(--font-mono)",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
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
                letterSpacing: "0.08em",
                textTransform: "uppercase",
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
                    @{detail.username} ↗
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
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--accent)",
                }}
              >
                Xem trên TikTok →
              </a>
            </div>
          </div>
        </div>
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
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
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
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
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
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
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
                  fontFamily: "var(--font-mono)",
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
                {copiedLabel === "export" ? "✓ Đã copy" : "Copy tất cả"}
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
                  fontSize: 10,
                  letterSpacing: "0.12em",
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
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
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
                      fontSize: 10,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
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
                      background: "rgba(224,91,91,0.08)",
                      border: "1px solid rgba(224,91,91,0.4)",
                      borderRadius: 6,
                      color: "#e05b5b",
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

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
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
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
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
              @{ctxMenu.username} ↗
            </a>
          </div>
          {ctxMenu.loading && (
            <div style={{ padding: "10px 10px", color: "var(--muted)" }}>
              Đang tải…
            </div>
          )}
          {ctxMenu.error && (
            <div style={{ padding: "10px", color: "#e05b5b" }}>
              {ctxMenu.error}
            </div>
          )}
          {ctxMenu.detail && (() => {
            const d = ctxMenu.detail;
            void totpTick; // subscribe to tick so countdown refreshes
            const totp = d.twofa ? generateTotpCode(d.twofa) : null;
            const totpRemaining = totp
              ? Math.max(1, Math.ceil(totp.remainingMs / 1000))
              : 0;
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
                  <span className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>✎</span>
                </button>

                <div style={{ padding: "6px 10px 4px" }}>
                  <div
                    className="mono"
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
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
                    style={{ flex: 1, padding: "5px 8px", fontSize: 10 }}
                  >
                    {ctxMenu.fetchAction === "follow" ? "Đang lấy…" : "Lấy Follow"}
                  </button>
                  <button
                    disabled={ctxMenu.fetchAction !== null}
                    onClick={() => runFetchOne(ctxMenu.id, "video")}
                    className="btn btn-primary"
                    style={{ flex: 1, padding: "5px 8px", fontSize: 10 }}
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
                      color: "#e05b5b",
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
                          fontSize: 10,
                          color: copied ? "var(--accent)" : "var(--muted)",
                        }}
                      >
                        {copied ? "✓" : disabled ? "—" : ""}
                      </span>
                    </button>
                  );
                })}
                <button
                  disabled={!totp}
                  onClick={() => {
                    if (totp) copyText(totp.code, `ctx-${ctxMenu.id}-totp`);
                  }}
                  title={
                    d.twofa && !totp
                      ? "Secret 2FA không hợp lệ (không phải Base32 / otpauth URI)"
                      : totp
                      ? `Mã còn hiệu lực ${totpRemaining}s`
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
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {totp && (
                      <>
                        <span
                          className="mono"
                          style={{
                            fontSize: 11,
                            letterSpacing: "0.1em",
                            color: "var(--accent)",
                          }}
                        >
                          {totp.code.replace(/(\d{3})(\d{3})/, "$1 $2")}
                        </span>
                        <span
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: totpRemaining <= 5 ? "#e05b5b" : "var(--muted)",
                          }}
                        >
                          {totpRemaining}s
                        </span>
                      </>
                    )}
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        color:
                          copiedLabel === `ctx-${ctxMenu.id}-totp`
                            ? "var(--accent)"
                            : "var(--muted)",
                      }}
                    >
                      {copiedLabel === `ctx-${ctxMenu.id}-totp`
                        ? "✓"
                        : totp
                        ? ""
                        : "—"}
                    </span>
                  </span>
                </button>
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
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: "var(--muted)" }}
                    >
                      ↗
                    </span>
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
                        color: "#e05b5b",
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
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    borderRadius: 4,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--line)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg-1)")}
                >
                  <span>Copy full</span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color:
                        copiedLabel === `ctx-${ctxMenu.id}-full`
                          ? "var(--accent)"
                          : "var(--muted)",
                      textTransform: "none",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {copiedLabel === `ctx-${ctxMenu.id}-full`
                      ? "✓"
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
          style={{ fontSize: 10, color: "var(--muted)" }}
        >
          {hasToken ? (msEmail ?? "✓") : "✱"}
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
                letterSpacing: "0.14em",
                color: "var(--accent)",
                fontWeight: 600,
              }}
            >
              {result.code.replace(/(\d{3})(\d{3})/, "$1 $2")}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 10,
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
            style={{ fontSize: 10, color: copied ? "var(--accent)" : "var(--muted)" }}
          >
            {copied ? "✓ copied" : "copy"}
          </span>
        </div>
      )}
      {needsAuth?.message && (
        <div
          className="mono"
          style={{ fontSize: 10, color: "var(--muted)", padding: "2px 6px 4px" }}
        >
          {needsAuth.message}
        </div>
      )}
      {error && (
        <div
          className="mono"
          style={{
            fontSize: 10,
            color: "#e05b5b",
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
            fontSize: 10,
            padding: "2px 6px 6px",
            letterSpacing: "0.06em",
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
  const arrow = isActive ? (dir === "asc" ? "↑" : "↓") : "";
  return (
    <th
      onClick={() => onToggle(sortKey)}
      className={align === "right" ? "right" : undefined}
      style={{
        cursor: "pointer",
        userSelect: "none",
        width,
        color: isActive ? "var(--accent)" : undefined,
      }}
      title={`Sắp xếp theo ${label}`}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span>{label}</span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: isActive ? "var(--accent)" : "var(--line-strong)",
            minWidth: 10,
          }}
        >
          {arrow || "⇅"}
        </span>
      </span>
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
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
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
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
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
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
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
            style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}
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
                fontSize: 10,
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
