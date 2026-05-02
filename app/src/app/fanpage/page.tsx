"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface FbAccountOption {
  id: number;
  username: string;
  fbName: string | null;
  fbProfilePic: string | null;
  hasToken: boolean;
  lastSyncError: string | null;
}

interface FanpageRow {
  id: number;
  fbAccountId: number;
  insightGroupId: number | null;
  pageId: string;
  name: string;
  category: string | null;
  pictureUrl: string | null;
  coverUrl: string | null;
  link: string | null;
  username: string | null;
  fanCount: number | null;
  followersCount: number | null;
  verificationStatus: string | null;
  hasPageToken: boolean;
  insightsJson: string | null;
  lastSyncedAt: number | null;
  lastSyncError: string | null;
  monetizationStatus: string | null;
  monetizationError: string | null;
  earningsValue: number | null;
  earningsCurrency: string | null;
  earningsRangeStart: number | null;
  earningsRangeEnd: number | null;
  earningsUpdatedAt: number | null;
  ownerUsername: string | null;
  ownerFbName: string | null;
  groupName: string | null;
  groupColor: string | null;
}

interface GroupRow {
  id: number;
  name: string;
  color: string;
  description: string | null;
  count: number;
}

interface InsightMetric {
  period: string;
  values: Array<{ value: number | Record<string, number>; end_time: string }>;
}

type InsightsMap = Record<string, InsightMetric[]>;

type SortKey =
  | "name"
  | "followers"
  | "fans"
  | "reach"
  | "impressions"
  | "videoViews"
  | "earnings"
  | "group"
  | "owner"
  | "lastSync";
type SortDir = "asc" | "desc";
type GroupFilter = "all" | "none" | number;

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("vi-VN");
}

/**
 * Format a micro-unit earnings value as `$1,234.56`. Returns "—" when:
 *   • value is null (never synced or sync failed)
 *   • status is "eligible" / "not_monetized" / "missing_scope" — the zero
 *     amount in those cases is implicit, not measured; rendering "$0" is
 *     misleading because it suggests measurement, not absence.
 * For status="monetized" with $0, returns "$0.00" — distinguishes "measured
 * zero" (e.g. window before earnings started) from "absent" ("—").
 */
function fmtMicros(
  micros: number | null | undefined,
  currency?: string | null,
  status?: string | null,
): string {
  if (micros == null) return "—";
  if (status && status !== "monetized") return "—";
  const amount = micros / 1_000_000;
  const sym = currency === "USD" || !currency ? "$" : "";
  if (amount === 0) return `${sym}0.00`;
  if (amount < 0.01) return `${sym}<0.01`;
  return `${sym}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monetizationLabel(
  status: string | null | undefined,
  hasToken?: boolean,
): {
  text: string;
  color: string;
} {
  switch (status) {
    case "monetized":
      return { text: "✓ Đang kiếm tiền", color: "var(--good, #2d8a4e)" };
    case "eligible":
      return { text: "○ Đủ điều kiện · $0", color: "var(--muted)" };
    case "not_monetized":
      return { text: "✗ Chưa bật kiếm tiền", color: "var(--accent)" };
    case "missing_scope":
      return { text: "⚠ Thiếu quyền insights", color: "var(--accent)" };
    case "unknown":
      return { text: "? Sync lỗi — thử lại", color: "var(--muted)" };
    default:
      // null status — never been checked
      return {
        text: hasToken === false ? "— chưa có token" : "— chưa kiểm tra",
        color: "var(--muted)",
      };
  }
}

function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "vừa xong";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return d.toLocaleDateString("vi-VN");
}

function sumMetric(m: InsightMetric | undefined): number | null {
  if (!m) return null;
  let total = 0;
  for (const v of m.values) {
    if (typeof v.value === "number") total += v.value;
    else if (v.value && typeof v.value === "object") {
      for (const k of Object.keys(v.value)) total += v.value[k] ?? 0;
    }
  }
  return total;
}

function parseInsights(json: string | null): {
  reach: number | null;
  impressions: number | null;
  videoViews: number | null;
} {
  if (!json) return { reach: null, impressions: null, videoViews: null };
  try {
    const map = JSON.parse(json) as InsightsMap;
    return {
      reach: sumMetric(map["page_impressions_unique"]?.[0]),
      impressions: sumMetric(map["page_impressions"]?.[0]),
      videoViews: sumMetric(map["page_video_views"]?.[0]),
    };
  } catch {
    return { reach: null, impressions: null, videoViews: null };
  }
}

type StepStatus = "running" | "ok" | "error" | "skipped";

interface StepState {
  step: string;
  label: string;
  status: StepStatus;
  detail?: string;
  error?: string;
  durationMs?: number;
}

interface TokenInfo {
  preview?: string;
  length?: number;
  source?: "direct" | "stored";
  isValid?: boolean;
  appId?: string | null;
  application?: string | null;
  userId?: string | null;
  type?: string | null;
  expiresAt?: number | null;
  scopes?: string[];
  missingRequired?: string[];
  missingRecommended?: string[];
  fbName?: string | null;
  fbProfilePic?: string | null;
}

export default function FanpagePage() {
  const [accounts, setAccounts] = useState<FbAccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | "all">("all");
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [manualToken, setManualToken] = useState("");
  const [rows, setRows] = useState<FanpageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [search, setSearch] = useState("");
  // Default-sort by most-recently-synced so users see fresh data on top.
  const [sortKey, setSortKey] = useState<SortKey>("lastSync");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [steps, setSteps] = useState<StepState[]>([]);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  // Group management modal state
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupEditingId, setGroupEditingId] = useState<number | null>(null);
  const [groupFormName, setGroupFormName] = useState("");
  const [groupFormColor, setGroupFormColor] = useState("#5e6ad2");
  const [groupFormDesc, setGroupFormDesc] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  // Page-assignment sub-mode: when set, the group modal swaps the form area
  // for a page picker scoped to that group.
  const [groupAssignId, setGroupAssignId] = useState<number | null>(null);
  const [groupAssignSelected, setGroupAssignSelected] = useState<Set<number>>(new Set());
  const [groupAssignSearch, setGroupAssignSearch] = useState("");
  // Selected pages while CREATING a new group inline. Submitting the create
  // form assigns these pages to the freshly-created group atomically.
  const [createAssignSelected, setCreateAssignSelected] = useState<Set<number>>(new Set());
  const [createAssignSearch, setCreateAssignSearch] = useState("");

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch(
        "/api/facebook/accounts?page=1&sort=username&dir=asc",
        { cache: "no-store" },
      );
      const data = (await res.json()) as {
        rows: Array<{
          id: number;
          username: string;
          fbName: string | null;
          fbProfilePic: string | null;
          hasToken: boolean;
          lastSyncError: string | null;
        }>;
      };
      setAccounts(data.rows);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/insight-groups", { cache: "no-store" });
      const data = (await res.json()) as { groups: GroupRow[] };
      setGroups(data.groups);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadFanpages = useCallback(async () => {
    setLoading(true);
    try {
      const q =
        typeof selectedAccountId === "number"
          ? `?accountId=${selectedAccountId}`
          : "";
      const res = await fetch(`/api/fanpages${q}`, { cache: "no-store" });
      const data = (await res.json()) as { rows: FanpageRow[] };
      setRows(data.rows ?? []);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  const resetGroupForm = useCallback(() => {
    setGroupEditingId(null);
    setGroupFormName("");
    setGroupFormColor("#5e6ad2");
    setGroupFormDesc("");
    setCreateAssignSelected(new Set());
    setCreateAssignSearch("");
  }, []);

  const startEditGroup = useCallback((g: GroupRow) => {
    setGroupEditingId(g.id);
    setGroupFormName(g.name);
    setGroupFormColor(g.color);
    setGroupFormDesc(g.description ?? "");
  }, []);

  const submitGroup = useCallback(async () => {
    const name = groupFormName.trim();
    if (!name) {
      alert("Tên nhóm không được trống");
      return;
    }
    setGroupBusy(true);
    try {
      const payload = {
        name,
        color: groupFormColor,
        description: groupFormDesc.trim(),
      };
      const res =
        groupEditingId == null
          ? await fetch("/api/insight-groups", {
              method: "POST",
              headers: { "X-Body": JSON.stringify(payload) },
            })
          : await fetch(`/api/insight-groups/${groupEditingId}`, {
              method: "PATCH",
              headers: { "X-Body": JSON.stringify(payload) },
            });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Lỗi" }));
        alert(err.error ?? "Lỗi");
        return;
      }
      // When creating, also assign any pages picked inline so the new group
      // starts populated. Skip when editing — use the per-row "Gán page"
      // button there instead.
      let assignedCount = 0;
      if (groupEditingId == null && createAssignSelected.size > 0) {
        const data = (await res.json().catch(() => ({}))) as {
          group?: { id?: number };
        };
        const newId = data.group?.id;
        if (typeof newId === "number") {
          await Promise.all(
            Array.from(createAssignSelected).map((pageRowId) =>
              fetch(`/api/fanpages/${pageRowId}`, {
                method: "PATCH",
                headers: { "X-Body": JSON.stringify({ insightGroupId: newId }) },
              }),
            ),
          );
          assignedCount = createAssignSelected.size;
        }
      }
      resetGroupForm();
      await loadGroups();
      if (assignedCount > 0) {
        await loadFanpages();
        setMessage(`Tạo nhóm "${name}" + gán ${assignedCount} fanpage`);
      }
    } finally {
      setGroupBusy(false);
    }
  }, [
    groupFormName,
    groupFormColor,
    groupFormDesc,
    groupEditingId,
    createAssignSelected,
    resetGroupForm,
    loadGroups,
    loadFanpages,
  ]);

  const deleteGroup = useCallback(
    async (id: number, count: number) => {
      const msg =
        count > 0
          ? `Xóa nhóm này? ${count} fanpage sẽ chuyển về "không nhóm".`
          : "Xóa nhóm này?";
      if (!confirm(msg)) return;
      setGroupBusy(true);
      try {
        await fetch(`/api/insight-groups/${id}`, { method: "DELETE" });
        if (groupEditingId === id) resetGroupForm();
        await loadGroups();
        await loadFanpages();
      } finally {
        setGroupBusy(false);
      }
    },
    [groupEditingId, resetGroupForm, loadGroups, loadFanpages],
  );

  const openAssignPages = useCallback(
    (groupId: number) => {
      // Pre-tick pages already in this group so user sees current state.
      const current = new Set(
        rows.filter((r) => r.insightGroupId === groupId).map((r) => r.id),
      );
      setGroupAssignId(groupId);
      setGroupAssignSelected(current);
      setGroupAssignSearch("");
      // Exit edit mode so form doesn't visually compete with picker.
      resetGroupForm();
    },
    [rows, resetGroupForm],
  );

  const cancelAssignPages = useCallback(() => {
    setGroupAssignId(null);
    setGroupAssignSelected(new Set());
    setGroupAssignSearch("");
  }, []);

  const submitAssignPages = useCallback(async () => {
    if (groupAssignId == null) return;
    setGroupBusy(true);
    setError("");
    try {
      const targetGroupId = groupAssignId;
      // Compute diff against the current state in `rows`:
      //   • toAdd  = newly-ticked pages whose current group ≠ targetGroupId
      //   • toRemove = pages already in this group but now unticked → set null
      const toAdd: number[] = [];
      const toRemove: number[] = [];
      for (const r of rows) {
        const wasIn = r.insightGroupId === targetGroupId;
        const willBeIn = groupAssignSelected.has(r.id);
        if (!wasIn && willBeIn) toAdd.push(r.id);
        else if (wasIn && !willBeIn) toRemove.push(r.id);
      }
      const tasks: Promise<Response>[] = [];
      for (const id of toAdd) {
        tasks.push(
          fetch(`/api/fanpages/${id}`, {
            method: "PATCH",
            headers: { "X-Body": JSON.stringify({ insightGroupId: targetGroupId }) },
          }),
        );
      }
      for (const id of toRemove) {
        tasks.push(
          fetch(`/api/fanpages/${id}`, {
            method: "PATCH",
            headers: { "X-Body": JSON.stringify({ insightGroupId: null }) },
          }),
        );
      }
      await Promise.all(tasks);
      setMessage(
        `Cập nhật nhóm: thêm ${toAdd.length} · bỏ ${toRemove.length} fanpage`,
      );
      cancelAssignPages();
      await loadFanpages();
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGroupBusy(false);
    }
  }, [groupAssignId, groupAssignSelected, rows, cancelAssignPages, loadFanpages, loadGroups]);

  const syncForAccount = useCallback(
    async (fbAccountId: number, silent = false): Promise<boolean> => {
      if (!silent) {
        setSyncing(true);
        setMessage("");
        setError("");
      }
      try {
        const res = await fetch("/api/fanpages/sync", {
          method: "POST",
          headers: { "X-Body": JSON.stringify({ fbAccountId }) },
        });
        const data = (await res.json()) as {
          ok?: boolean;
          pagesFound?: number;
          inserted?: number;
          updated?: number;
          error?: string;
        };
        if (!res.ok || data.error) {
          if (!silent) setError(data.error ?? `Lỗi ${res.status}`);
          return false;
        }
        if (!silent) {
          setMessage(
            `Đã tải ${data.pagesFound ?? 0} fanpage · thêm ${data.inserted ?? 0} · cập nhật ${data.updated ?? 0}`,
          );
        }
        return true;
      } catch (e) {
        if (!silent) setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        if (!silent) setSyncing(false);
      }
    },
    [],
  );

  const syncWithManualToken = useCallback(async () => {
    if (!manualToken.trim()) {
      setError("Nhập token trước khi sync");
      return;
    }
    setSyncing(true);
    setMessage("");
    setError("");
    setSteps([]);
    setTokenInfo(null);
    try {
      const body: { token: string; fbAccountId?: number } = {
        token: manualToken.trim(),
      };
      if (typeof selectedAccountId === "number") body.fbAccountId = selectedAccountId;
      const res = await fetch("/api/fanpages/sync", {
        method: "POST",
        headers: { "X-Body": JSON.stringify(body), Accept: "application/x-ndjson" },
      });
      if (!res.ok || !res.body) {
        let msg = `Lỗi ${res.status}`;
        try {
          const errData = (await res.json()) as { error?: string };
          if (errData.error) msg = errData.error;
        } catch {}
        setError(msg);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalEvent:
        | {
            type: "done";
            ok?: boolean;
            pagesFound?: number;
            inserted?: number;
            updated?: number;
            error?: string;
          }
        | null = null;

      const handleEvent = (ev: Record<string, unknown>) => {
        if (ev.type === "init") {
          setTokenInfo({
            preview: ev.tokenPreview as string,
            length: ev.tokenLength as number,
            source: ev.source as "direct" | "stored",
          });
          return;
        }
        if (ev.type === "step") {
          const e = ev as unknown as StepState & {
            data?: Record<string, unknown>;
          };
          setSteps((prev) => {
            const idx = prev.findIndex((p) => p.step === e.step);
            const next: StepState = {
              step: e.step,
              label: e.label,
              status: e.status,
              detail: e.detail,
              error: e.error,
              durationMs: e.durationMs,
            };
            if (idx >= 0) {
              const copy = prev.slice();
              copy[idx] = next;
              return copy;
            }
            return [...prev, next];
          });
          // Hydrate tokenInfo from token-verification steps (debug_token when
          // FB_APP_ID is set, verify_token otherwise) and /me.
          if (
            (e.step === "debug_token" || e.step === "verify_token") &&
            e.status === "ok" &&
            e.data
          ) {
            const d = e.data as {
              isValid?: boolean;
              appId?: string | null;
              application?: string | null;
              userId?: string | null;
              fbName?: string | null;
              type?: string | null;
              expiresAt?: number | null;
              scopes?: string[];
              missingRequired?: string[];
              missingRecommended?: string[];
            };
            setTokenInfo((prev) => ({
              ...(prev ?? {}),
              isValid: d.isValid,
              appId: d.appId ?? null,
              application: d.application ?? null,
              userId: d.userId ?? prev?.userId ?? null,
              fbName: d.fbName ?? prev?.fbName ?? null,
              type: d.type ?? null,
              expiresAt: d.expiresAt ?? null,
              scopes: d.scopes ?? prev?.scopes ?? [],
              missingRequired: d.missingRequired ?? [],
              missingRecommended: d.missingRecommended ?? [],
            }));
          }
          if (e.step === "fetch_me" && e.status === "ok" && e.data) {
            const d = e.data as {
              fbUserId?: string;
              fbName?: string;
              fbProfilePic?: string | null;
            };
            setTokenInfo((prev) => ({
              ...(prev ?? {}),
              userId: d.fbUserId ?? prev?.userId ?? null,
              fbName: d.fbName ?? null,
              fbProfilePic: d.fbProfilePic ?? null,
            }));
          }
          return;
        }
        if (ev.type === "done") {
          finalEvent = ev as typeof finalEvent;
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            handleEvent(JSON.parse(line) as Record<string, unknown>);
          } catch {
            // Ignore malformed line; stream continues.
          }
        }
      }
      // Flush trailing buffer (server should always end with \n, but be safe).
      const tail = buf.trim();
      if (tail) {
        try {
          handleEvent(JSON.parse(tail) as Record<string, unknown>);
        } catch {}
      }

      if (!finalEvent) {
        setError("Stream kết thúc không có sự kiện done");
        return;
      }
      const ev = finalEvent as {
        ok?: boolean;
        error?: string;
        pagesFound?: number;
        inserted?: number;
        updated?: number;
      };
      if (!ev.ok) {
        setError(ev.error ?? "Sync thất bại");
        return;
      }
      setMessage(
        `Đã tải ${ev.pagesFound ?? 0} fanpage · thêm ${ev.inserted ?? 0} · cập nhật ${ev.updated ?? 0}`,
      );
      await loadFanpages();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [manualToken, selectedAccountId, loadFanpages]);

  const refreshInsightsOne = useCallback(
    async (fanpageId: number) => {
      setSyncing(true);
      try {
        const res = await fetch(`/api/fanpages/${fanpageId}/insights`, {
          method: "POST",
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok || data.error) {
          setError(data.error ?? `Lỗi insights ${res.status}`);
          return;
        }
        await loadFanpages();
      } finally {
        setSyncing(false);
      }
    },
    [loadFanpages],
  );

  const refreshInsightsBatch = useCallback(async () => {
    setSyncing(true);
    setMessage("");
    setError("");
    try {
      const ids =
        selected.size > 0
          ? Array.from(selected)
          : rows.filter((r) => r.hasPageToken).map((r) => r.id);
      const res = await fetch("/api/fanpages/insights/batch", {
        method: "POST",
        headers: { "X-Body": JSON.stringify({ ids, days: 365 }) },
      });
      const data = (await res.json()) as {
        total: number;
        okCount: number;
        errCount: number;
        skipCount: number;
        error?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error ?? `Lỗi ${res.status}`);
      } else {
        setMessage(
          `Reach 365d: ${data.okCount}/${data.total} OK · ${data.errCount} lỗi · ${data.skipCount} bỏ qua`,
        );
        await loadFanpages();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [selected, rows, loadFanpages]);

  const syncEarningsBatch = useCallback(async () => {
    setSyncing(true);
    setMessage("");
    setError("");
    try {
      const ids =
        selected.size > 0
          ? Array.from(selected)
          : rows.filter((r) => r.hasPageToken).map((r) => r.id);
      const res = await fetch("/api/fanpages/sync-earnings", {
        method: "POST",
        headers: { "X-Body": JSON.stringify({ ids, days: 365 }) },
      });
      const data = (await res.json()) as {
        total: number;
        okCount: number;
        errCount: number;
        skipCount: number;
        monetizedCount: number;
        totalMicros: number;
        error?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error ?? `Lỗi ${res.status}`);
      } else {
        const totalUsd = (data.totalMicros / 1_000_000).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        setMessage(
          `Doanh thu 365d: ${data.monetizedCount}/${data.okCount} monetized · $${totalUsd} · ${data.errCount} lỗi · ${data.skipCount} bỏ qua`,
        );
        await loadFanpages();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [selected, rows, loadFanpages]);

  const updateGroup = useCallback(
    async (fanpageId: number, groupId: number | null) => {
      const res = await fetch(`/api/fanpages/${fanpageId}`, {
        method: "PATCH",
        headers: { "X-Body": JSON.stringify({ insightGroupId: groupId }) },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Lỗi" }));
        setError(d.error ?? `Lỗi ${res.status}`);
        return;
      }
      await loadFanpages();
      await loadGroups();
    },
    [loadFanpages, loadGroups],
  );

  const bulkAssignGroup = useCallback(
    async (groupId: number | null) => {
      if (selected.size === 0) return;
      const label = groupId == null ? "bỏ nhóm" : `đổi nhóm`;
      if (!confirm(`${label} cho ${selected.size} fanpage?`)) return;
      setSyncing(true);
      try {
        await Promise.all(
          Array.from(selected).map((id) =>
            fetch(`/api/fanpages/${id}`, {
              method: "PATCH",
              headers: { "X-Body": JSON.stringify({ insightGroupId: groupId }) },
            }),
          ),
        );
        setSelected(new Set());
        await loadFanpages();
        await loadGroups();
      } finally {
        setSyncing(false);
      }
    },
    [selected, loadFanpages, loadGroups],
  );

  const bulkReassignAccount = useCallback(
    async (fbAccountId: number) => {
      if (selected.size === 0) return;
      const acc = accounts.find((a) => a.id === fbAccountId);
      const target = acc ? (acc.fbName ?? `@${acc.username}`) : `id=${fbAccountId}`;
      if (!confirm(`Chuyển ${selected.size} fanpage sang tài khoản "${target}"?`))
        return;
      setSyncing(true);
      setMessage("");
      setError("");
      try {
        await Promise.all(
          Array.from(selected).map((id) =>
            fetch(`/api/fanpages/${id}`, {
              method: "PATCH",
              headers: { "X-Body": JSON.stringify({ fbAccountId }) },
            }),
          ),
        );
        setSelected(new Set());
        setMessage(`Đã chuyển ${selected.size} fanpage sang ${target}`);
        await loadFanpages();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSyncing(false);
      }
    },
    [selected, accounts, loadFanpages],
  );

  const refreshAvatarSelected = useCallback(async () => {
    if (selected.size === 0) return;
    setSyncing(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/fanpages/refresh-avatar", {
        method: "POST",
        headers: { "X-Body": JSON.stringify({ ids: Array.from(selected) }) },
      });
      const data = (await res.json()) as {
        total?: number;
        okCount?: number;
        errCount?: number;
        skipCount?: number;
        error?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error ?? `Lỗi ${res.status}`);
      } else {
        setMessage(
          `AVT: ${data.okCount}/${data.total} OK · ${data.errCount ?? 0} lỗi · ${data.skipCount ?? 0} bỏ qua`,
        );
        await loadFanpages();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [selected, loadFanpages]);

  const deleteSelected = useCallback(async () => {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Xóa vĩnh viễn ${selected.size} fanpage? Reach lịch sử & post liên quan cũng bị xóa.`,
      )
    ) {
      return;
    }
    setSyncing(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/fanpages/bulk-delete", {
        method: "POST",
        headers: { "X-Body": JSON.stringify({ ids: Array.from(selected) }) },
      });
      const data = (await res.json()) as { deleted?: number; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? `Lỗi ${res.status}`);
      } else {
        setMessage(`Đã xóa ${data.deleted ?? 0} fanpage`);
        setSelected(new Set());
        await loadFanpages();
        await loadGroups();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [selected, loadFanpages, loadGroups]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadAccounts();
      if (cancelled) return;
      await loadGroups();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAccounts, loadGroups]);

  // Load local fanpages on mount and whenever the user switches account.
  // We DO NOT auto-pull from Facebook — that re-inserts pages the user has
  // explicitly deleted. The "↻ Làm mới" button still triggers a manual sync.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadFanpages();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, loadFanpages]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filteredRows = rows.filter((r) => {
      if (groupFilter === "none" && r.insightGroupId != null) return false;
      if (typeof groupFilter === "number" && r.insightGroupId !== groupFilter)
        return false;
      if (q) {
        const hay =
          `${r.name} ${r.username ?? ""} ${r.ownerFbName ?? ""} ${r.ownerUsername ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const withInsights = filteredRows.map((r) => ({
      r,
      ins: parseInsights(r.insightsJson),
    }));
    const sign = sortDir === "asc" ? 1 : -1;
    withInsights.sort((a, b) => {
      const cmpNum = (x: number | null | undefined, y: number | null | undefined) => {
        const xn = x ?? -Infinity;
        const yn = y ?? -Infinity;
        return xn === yn ? 0 : xn < yn ? -sign : sign;
      };
      const cmpStr = (x: string | null | undefined, y: string | null | undefined) => {
        const xs = (x ?? "").toLowerCase();
        const ys = (y ?? "").toLowerCase();
        return xs === ys ? 0 : xs < ys ? -sign : sign;
      };
      switch (sortKey) {
        case "name":
          return cmpStr(a.r.name, b.r.name);
        case "followers":
          return cmpNum(a.r.followersCount, b.r.followersCount);
        case "fans":
          return cmpNum(a.r.fanCount, b.r.fanCount);
        case "reach":
          return cmpNum(a.ins.reach, b.ins.reach);
        case "impressions":
          return cmpNum(a.ins.impressions, b.ins.impressions);
        case "videoViews":
          return cmpNum(a.ins.videoViews, b.ins.videoViews);
        case "earnings":
          return cmpNum(a.r.earningsValue, b.r.earningsValue);
        case "group":
          return cmpStr(a.r.groupName, b.r.groupName);
        case "owner":
          return cmpStr(a.r.ownerFbName ?? a.r.ownerUsername, b.r.ownerFbName ?? b.r.ownerUsername);
        case "lastSync":
          return cmpNum(a.r.lastSyncedAt, b.r.lastSyncedAt);
      }
    });
    return withInsights;
  }, [rows, groupFilter, search, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "name" || k === "owner" || k === "group" ? "asc" : "desc");
    }
  }

  function toggleOne(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const allVisibleIds = filtered.map((f) => f.r.id);
  const allSelected =
    allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id));
  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allVisibleIds));
    }
  }

  const totalFollowers = useMemo(
    () => rows.reduce((s, r) => s + (r.followersCount ?? 0), 0),
    [rows],
  );
  const totalEarnings = useMemo(
    () => rows.reduce((s, r) => s + (r.earningsValue ?? 0), 0),
    [rows],
  );
  const monetizedCount = useMemo(
    () => rows.filter((r) => r.monetizationStatus === "monetized").length,
    [rows],
  );
  const totalReach = useMemo(
    () =>
      rows.reduce((s, r) => {
        const v = parseInsights(r.insightsJson).reach;
        return s + (v ?? 0);
      }, 0),
    [rows],
  );

  const filterChips: Array<{ key: GroupFilter; label: string; color?: string; count: number }> = [
    { key: "all", label: "Tất cả", count: rows.length },
    ...groups.map((g) => ({
      key: g.id as GroupFilter,
      label: g.name,
      color: g.color,
      count: g.count,
    })),
    {
      key: "none" as GroupFilter,
      label: "Chưa phân nhóm",
      count: rows.filter((r) => r.insightGroupId == null).length,
    },
  ];

  return (
    <>
      <header
        className="page-header"
        style={{ paddingBottom: 10, marginBottom: 12, alignItems: "center" }}
      >
        <div
          className="page-header-left"
          style={{ display: "flex", alignItems: "center", gap: 14 }}
        >
          <h1 className="h1-serif" style={{ fontSize: 20, margin: 0 }}>
            Quản lý Fanpage
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
            {groups.length} nhóm · {rows.length} fanpage · {fmtNum(totalFollowers)} followers ·{" "}
            {fmtNum(totalReach)} reach
            {totalEarnings > 0 && (
              <>
                {" · "}
                <span style={{ color: "var(--good, #2d8a4e)", fontWeight: 600 }}>
                  {fmtMicros(totalEarnings, "USD")} ({monetizedCount} monetized)
                </span>
              </>
            )}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            onClick={() => setGroupModalOpen(true)}
            className="btn"
            style={{ padding: "8px 14px", fontSize: 12 }}
            title="Tạo / chỉnh sửa / xoá nhóm fanpage"
          >
            Quản lý nhóm
          </button>
          <Link
            href="/insights/reach"
            className="btn"
            style={{ padding: "8px 14px", fontSize: 12 }}
          >
            Reach Dashboard
          </Link>
          <select
            className="input"
            value={selectedAccountId === "all" ? "all" : String(selectedAccountId)}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedAccountId(v === "all" ? "all" : Number(v));
            }}
            style={{ minWidth: 200, fontSize: 12, padding: "7px 10px" }}
          >
            <option value="all">— Tất cả tài khoản —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.fbName ? `${a.fbName} (@${a.username})` : `@${a.username}`}
                {a.hasToken ? "" : " · chưa có token"}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (typeof selectedAccountId === "number") {
                syncForAccount(selectedAccountId).then(() => loadFanpages());
              } else {
                (async () => {
                  setSyncing(true);
                  setMessage("");
                  setError("");
                  const tokenAccounts = accounts.filter((a) => a.hasToken);
                  let ok = 0;
                  let fail = 0;
                  for (const acc of tokenAccounts) {
                    const r = await syncForAccount(acc.id, true);
                    if (r) ok++;
                    else fail++;
                  }
                  setSyncing(false);
                  setMessage(
                    `Sync xong ${ok}/${tokenAccounts.length} tài khoản${fail ? ` · lỗi ${fail}` : ""}`,
                  );
                  await loadFanpages();
                })();
              }
            }}
            disabled={syncing || loading}
            className="btn btn-primary"
            style={{ padding: "8px 16px", fontSize: 12 }}
          >
            {syncing ? "Đang sync…" : "↻ Làm mới"}
          </button>
        </div>
      </header>

      {/* Token sync row */}
      <section
        className="section"
        style={{ padding: "10px 14px", marginBottom: 12 }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--muted)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Token:
          </span>
          <input
            type="password"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            placeholder="EAABs…"
            className="input"
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 140,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              padding: "7px 10px",
            }}
          />
          <button
            onClick={syncWithManualToken}
            disabled={syncing || !manualToken.trim()}
            className="btn btn-accent"
            style={{ padding: "7px 14px", fontSize: 12 }}
          >
            {syncing ? "…" : "Sync"}
          </button>
          <button
            onClick={refreshInsightsBatch}
            disabled={syncing || loading || rows.length === 0}
            className="btn"
            style={{ padding: "7px 14px", fontSize: 12 }}
            title={
              selected.size > 0
                ? `Tải reach cho ${selected.size} fanpage đã chọn`
                : "Tải reach cho toàn bộ fanpage có token"
            }
          >
            ⟳ Reach {selected.size > 0 ? `(${selected.size})` : "tất cả"}
          </button>
          <button
            onClick={syncEarningsBatch}
            disabled={syncing || loading || rows.length === 0}
            className="btn"
            style={{ padding: "7px 14px", fontSize: 12 }}
            title={
              selected.size > 0
                ? `Cập nhật doanh thu 365 ngày cho ${selected.size} fanpage đã chọn`
                : "Cập nhật doanh thu (in-stream ads + subscriptions + live) 365 ngày cho toàn bộ fanpage có token"
            }
          >
            $ Doanh thu {selected.size > 0 ? `(${selected.size})` : "tất cả"}
          </button>
          {message && (
            <span
              className="mono"
              style={{
                color: "var(--good)",
                fontSize: 10,
                letterSpacing: "0.06em",
              }}
            >
              {message}
            </span>
          )}
          {error && (
            <span
              className="mono"
              style={{
                color: "var(--accent)",
                fontSize: 10,
                letterSpacing: "0.06em",
              }}
            >
              ⚠ {error}
            </span>
          )}
        </div>
        {(steps.length > 0 || tokenInfo) && (
          <SyncProgressPanel
            steps={steps}
            tokenInfo={tokenInfo}
            onClear={() => {
              setSteps([]);
              setTokenInfo(null);
              setMessage("");
              setError("");
            }}
          />
        )}
      </section>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {filterChips.map((c) => {
          const on = groupFilter === c.key;
          return (
            <button
              key={String(c.key)}
              onClick={() => setGroupFilter(c.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 999,
                border: on
                  ? `1px solid ${c.color ?? "var(--ink)"}`
                  : "1px solid var(--line)",
                background: on ? (c.color ?? "var(--ink)") : "transparent",
                color: on ? "#fff" : "var(--ink)",
                fontSize: 11,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {c.color && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: c.color,
                    display: "inline-block",
                    opacity: on ? 0 : 1,
                  }}
                />
              )}
              <span>{c.label}</span>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  opacity: 0.7,
                }}
              >
                {c.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Toolbar: search + bulk actions */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm tên fanpage / username / chủ…"
          className="input"
          style={{ flex: "1 1 260px", minWidth: 220, fontSize: 12, padding: "6px 10px" }}
        />
        {selected.size > 0 && (
          <>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.05em" }}
            >
              Đã chọn {selected.size}
            </span>
            <select
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") return;
                if (v === "none") bulkAssignGroup(null);
                else bulkAssignGroup(Number(v));
                e.currentTarget.value = "";
              }}
              className="input"
              style={{ fontSize: 12, padding: "7px 10px" }}
            >
              <option value="">Gán nhóm…</option>
              <option value="none">— Bỏ nhóm —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") return;
                bulkReassignAccount(Number(v));
                e.currentTarget.value = "";
              }}
              className="input"
              style={{ fontSize: 12, padding: "7px 10px", minWidth: 160 }}
              title="Chuyển fanpage đã chọn sang tài khoản FB khác"
            >
              <option value="">Chuyển sang TK…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fbName ? `${a.fbName} (@${a.username})` : `@${a.username}`}
                </option>
              ))}
            </select>
            <button
              onClick={refreshAvatarSelected}
              disabled={syncing}
              className="btn"
              style={{ padding: "7px 14px", fontSize: 12 }}
              title="Làm mới avatar (FB CDN URL hết hạn sau vài ngày)"
            >
              {syncing ? "…" : "↻ Lấy AVT"}
            </button>
            <button
              onClick={deleteSelected}
              disabled={syncing}
              className="btn"
              style={{
                padding: "7px 14px",
                fontSize: 12,
                color: "var(--accent)",
                borderColor: "var(--accent)",
              }}
              title="Xóa các fanpage đã chọn (xóa cả posts/snapshots liên quan)"
            >
              {syncing ? "…" : `Xóa (${selected.size})`}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="btn"
              style={{ padding: "7px 14px", fontSize: 12 }}
            >
              Bỏ chọn
            </button>
          </>
        )}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Chọn tất cả"
                />
              </th>
              <th style={{ width: 44 }} className="right">
                STT
              </th>
              <SortableTh
                label="Fanpage"
                sortKey="name"
                active={sortKey}
                dir={sortDir}
                onToggle={toggleSort}
              />
              <SortableTh
                label="Nhóm"
                sortKey="group"
                active={sortKey}
                dir={sortDir}
                onToggle={toggleSort}
                width={150}
              />
              <SortableTh
                label="Followers"
                sortKey="followers"
                active={sortKey}
                dir={sortDir}
                onToggle={toggleSort}
                align="right"
                width={110}
              />
              <SortableTh
                label="Likes"
                sortKey="fans"
                active={sortKey}
                dir={sortDir}
                onToggle={toggleSort}
                align="right"
                width={100}
              />
              <SortableTh
                label="Reach 28d"
                sortKey="reach"
                active={sortKey}
                dir={sortDir}
                onToggle={toggleSort}
                align="right"
                width={110}
              />
              <SortableTh
                label="Impressions"
                sortKey="impressions"
                active={sortKey}
                dir={sortDir}
                onToggle={toggleSort}
                align="right"
                width={120}
              />
              <SortableTh
                label="Video views"
                sortKey="videoViews"
                active={sortKey}
                dir={sortDir}
                onToggle={toggleSort}
                align="right"
                width={110}
              />
              <SortableTh
                label="Doanh thu 365d"
                sortKey="earnings"
                active={sortKey}
                dir={sortDir}
                onToggle={toggleSort}
                align="right"
                width={120}
              />
              <SortableTh
                label="Chủ"
                sortKey="owner"
                active={sortKey}
                dir={sortDir}
                onToggle={toggleSort}
                width={140}
              />
              <SortableTh
                label="Sync"
                sortKey="lastSync"
                active={sortKey}
                dir={sortDir}
                onToggle={toggleSort}
                width={100}
              />
              <th style={{ width: 80 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={13} style={{ padding: 56, textAlign: "center" }}>
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
                    {rows.length === 0
                      ? "Chưa có fanpage — chọn tài khoản có token rồi bấm Làm mới"
                      : "Không khớp bộ lọc"}
                  </div>
                </td>
              </tr>
            )}
            {filtered.map(({ r, ins }, idx) => (
              <tr key={r.id} className={selected.has(r.id) ? "selected" : ""}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleOne(r.id)}
                  />
                </td>
                <td className="right">
                  <span className="mono-num text-muted">{idx + 1}</span>
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {r.pictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.pictureUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="avatar"
                      />
                    ) : (
                      <span className="avatar-fallback">
                        {r.name[0]?.toUpperCase() ?? "?"}
                      </span>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <a
                        href={r.link ?? `https://facebook.com/${r.pageId}`}
                        target="_blank"
                        rel="noreferrer"
                        title={r.name}
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontSize: 15,
                          color: "var(--ink)",
                          letterSpacing: "-0.01em",
                          textDecoration: "none",
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 260,
                        }}
                      >
                        {r.name}
                        {r.verificationStatus &&
                          r.verificationStatus !== "not_verified" && (
                            <span
                              className="chip"
                              style={{
                                background: "var(--good)",
                                color: "#fff",
                                marginLeft: 6,
                                fontSize: 9,
                              }}
                            >
                              ✓
                            </span>
                          )}
                      </a>
                      {r.username && (
                        <div
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: "var(--muted)",
                          }}
                        >
                          @{r.username}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td>
                  <select
                    value={r.insightGroupId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateGroup(r.id, v === "" ? null : Number(v));
                    }}
                    style={{
                      background: r.groupColor ?? "transparent",
                      color: r.groupColor ? "#fff" : "var(--muted)",
                      border: r.groupColor
                        ? `1px solid ${r.groupColor}`
                        : "1px solid var(--line)",
                      borderRadius: 4,
                      padding: "3px 6px",
                      fontSize: 11,
                      fontFamily: "inherit",
                      cursor: "pointer",
                      maxWidth: 140,
                    }}
                  >
                    <option value="">— Chưa nhóm —</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="right">
                  <span className="mono-num">{fmtNum(r.followersCount)}</span>
                </td>
                <td className="right">
                  <span className="mono-num text-muted">{fmtNum(r.fanCount)}</span>
                </td>
                <td className="right">
                  <span
                    className="mono-num"
                    style={{ color: ins.reach == null ? "var(--muted)" : "var(--ink)" }}
                  >
                    {fmtNum(ins.reach)}
                  </span>
                </td>
                <td className="right">
                  <span
                    className="mono-num"
                    style={{
                      color: ins.impressions == null ? "var(--muted)" : "var(--ink)",
                    }}
                  >
                    {fmtNum(ins.impressions)}
                  </span>
                </td>
                <td className="right">
                  <span
                    className="mono-num"
                    style={{
                      color: ins.videoViews == null ? "var(--muted)" : "var(--ink)",
                    }}
                  >
                    {fmtNum(ins.videoViews)}
                  </span>
                </td>
                <td className="right">
                  {(() => {
                    const lbl = monetizationLabel(r.monetizationStatus, r.hasPageToken);
                    const titleParts: string[] = [];
                    if (r.monetizationError) titleParts.push(r.monetizationError);
                    if (r.earningsUpdatedAt) {
                      titleParts.push(
                        `cập nhật: ${new Date(r.earningsUpdatedAt * 1000).toLocaleString("vi-VN")}`,
                      );
                    }
                    return (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 2,
                        }}
                        title={titleParts.join(" · ") || "Chưa sync doanh thu"}
                      >
                        <span
                          className="mono-num"
                          style={{
                            color:
                              r.monetizationStatus === "monetized"
                                ? "var(--good, #2d8a4e)"
                                : "var(--muted)",
                            fontWeight:
                              r.monetizationStatus === "monetized" ? 600 : 400,
                          }}
                        >
                          {fmtMicros(
                            r.earningsValue,
                            r.earningsCurrency,
                            r.monetizationStatus,
                          )}
                        </span>
                        <span
                          className="mono"
                          style={{
                            fontSize: 9,
                            color: lbl.color,
                            letterSpacing: "0.04em",
                          }}
                        >
                          {lbl.text}
                        </span>
                      </div>
                    );
                  })()}
                </td>
                <td>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--muted)",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 130,
                    }}
                    title={r.ownerFbName ?? r.ownerUsername ?? ""}
                  >
                    {r.ownerFbName ?? (r.ownerUsername ? `@${r.ownerUsername}` : "—")}
                  </span>
                </td>
                <td>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: r.lastSyncError ? "var(--accent)" : "var(--muted)",
                      letterSpacing: "0.04em",
                    }}
                    title={r.lastSyncError ?? ""}
                  >
                    {r.lastSyncError ? "⚠ lỗi" : fmtTime(r.lastSyncedAt)}
                  </span>
                </td>
                <td>
                  <button
                    className="btn"
                    style={{ padding: "5px 10px", fontSize: 11 }}
                    onClick={() => refreshInsightsOne(r.id)}
                    disabled={!r.hasPageToken || syncing}
                    title={r.hasPageToken ? "Tải reach 28 ngày" : "Chưa có page token"}
                  >
                    ⟳ Reach
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {groupModalOpen && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setGroupModalOpen(false);
              resetGroupForm();
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Quản lý nhóm fanpage"
        >
          <div className="modal" style={{ maxWidth: 720 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 18,
                gap: 12,
              }}
            >
              <div>
                <h2 className="h2-serif" style={{ margin: 0 }}>
                  {groupAssignId != null ? (
                    <>Gán <em>page vào nhóm</em></>
                  ) : groupEditingId == null ? (
                    <>Tạo <em>nhóm mới</em></>
                  ) : (
                    <>Cập nhật <em>nhóm</em></>
                  )}
                </h2>
                <div className="section-label" style={{ marginTop: 4 }}>
                  {groupAssignId != null
                    ? `Nhóm: ${groups.find((g) => g.id === groupAssignId)?.name ?? "?"} · ${groupAssignSelected.size} đã chọn`
                    : groups.length === 0
                      ? "Chưa có nhóm nào"
                      : `${groups.length} nhóm · ${groups.reduce((s, g) => s + g.count, 0)} fanpage đã phân`}
                </div>
              </div>
              <button
                onClick={() => {
                  setGroupModalOpen(false);
                  resetGroupForm();
                }}
                className="btn"
                style={{ padding: "6px 12px", fontSize: 12 }}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>

            {groupAssignId == null ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 14,
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <div className="section-label" style={{ marginBottom: 6 }}>
                      Tên nhóm
                    </div>
                    <input
                      className="input"
                      value={groupFormName}
                      onChange={(e) => setGroupFormName(e.target.value)}
                      placeholder="Ví dụ: Fanpage VN, e-commerce…"
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <div className="section-label" style={{ marginBottom: 6 }}>
                      Màu
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      {[
                        "#5e6ad2",
                        "#2f6bb0",
                        "#2d8a4e",
                        "#b88c3a",
                        "#d94a1f",
                        "#c23e6f",
                        "#7a4e9c",
                        "#6b7a44",
                      ].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setGroupFormColor(c)}
                          aria-label={`Chọn màu ${c}`}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 999,
                            background: c,
                            border:
                              groupFormColor === c
                                ? "3px solid var(--ink)"
                                : "1px solid var(--line)",
                            cursor: "pointer",
                          }}
                        />
                      ))}
                      <input
                        type="color"
                        value={groupFormColor}
                        onChange={(e) => setGroupFormColor(e.target.value)}
                        style={{
                          width: 30,
                          height: 26,
                          border: "1px solid var(--line)",
                          background: "transparent",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div className="section-label" style={{ marginBottom: 6 }}>
                    Mô tả (tuỳ chọn)
                  </div>
                  <input
                    className="input"
                    value={groupFormDesc}
                    onChange={(e) => setGroupFormDesc(e.target.value)}
                    placeholder="Mục đích / ghi chú nhóm này"
                    style={{ width: "100%" }}
                  />
                </div>

                {/* Inline page picker — only shown when CREATING a new group.
                    Editing existing → use the per-row "Gán page" button. */}
                {groupEditingId == null && (
                  <div style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        marginBottom: 6,
                        gap: 8,
                      }}
                    >
                      <div className="section-label">
                        Gán fanpage vào nhóm mới (tuỳ chọn)
                      </div>
                      <span
                        className="mono"
                        style={{ fontSize: 11, color: "var(--muted)" }}
                      >
                        Đã chọn {createAssignSelected.size} / {rows.length}
                      </span>
                    </div>
                    <input
                      className="input"
                      placeholder="Tìm fanpage…"
                      value={createAssignSearch}
                      onChange={(e) => setCreateAssignSearch(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "7px 10px",
                        fontSize: 12,
                        marginBottom: 6,
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        marginBottom: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      {(() => {
                        const q = createAssignSearch.trim().toLowerCase();
                        const visible = q
                          ? rows.filter(
                              (r) =>
                                r.name.toLowerCase().includes(q) ||
                                (r.username ?? "").toLowerCase().includes(q),
                            )
                          : rows;
                        return (
                          <>
                            <button
                              onClick={() =>
                                setCreateAssignSelected(
                                  new Set(visible.map((r) => r.id)),
                                )
                              }
                              className="btn"
                              style={{ padding: "4px 10px", fontSize: 11 }}
                            >
                              Chọn tất cả ({visible.length})
                            </button>
                            <button
                              onClick={() =>
                                setCreateAssignSelected(new Set())
                              }
                              className="btn"
                              style={{ padding: "4px 10px", fontSize: 11 }}
                            >
                              Bỏ chọn
                            </button>
                          </>
                        );
                      })()}
                    </div>
                    <div
                      style={{
                        maxHeight: 220,
                        overflowY: "auto",
                        border: "1px solid var(--line)",
                        borderRadius: 6,
                        padding: 6,
                      }}
                    >
                      {(() => {
                        const q = createAssignSearch.trim().toLowerCase();
                        const visible = q
                          ? rows.filter(
                              (r) =>
                                r.name.toLowerCase().includes(q) ||
                                (r.username ?? "").toLowerCase().includes(q),
                            )
                          : rows;
                        if (visible.length === 0) {
                          return (
                            <div
                              style={{
                                padding: 16,
                                textAlign: "center",
                                color: "var(--muted)",
                                fontStyle: "italic",
                                fontSize: 12,
                              }}
                            >
                              {rows.length === 0
                                ? "Chưa có fanpage nào — sync trước rồi quay lại"
                                : "Không khớp"}
                            </div>
                          );
                        }
                        return visible.map((r) => {
                          const checked = createAssignSelected.has(r.id);
                          const currentGroup =
                            r.insightGroupId != null
                              ? groups.find((g) => g.id === r.insightGroupId)
                              : null;
                          return (
                            <label
                              key={r.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "5px 8px",
                                borderRadius: 4,
                                cursor: "pointer",
                                background: checked
                                  ? "var(--accent-soft, rgba(94,106,210,0.08))"
                                  : "transparent",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setCreateAssignSelected((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(r.id)) next.delete(r.id);
                                    else next.add(r.id);
                                    return next;
                                  });
                                }}
                                style={{ margin: 0, width: 14, height: 14 }}
                              />
                              {r.pictureUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={r.pictureUrl}
                                  alt=""
                                  width={22}
                                  height={22}
                                  style={{ borderRadius: 4, flexShrink: 0 }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 22,
                                    height: 22,
                                    borderRadius: 4,
                                    background: "var(--line)",
                                    flexShrink: 0,
                                  }}
                                />
                              )}
                              <span
                                style={{
                                  fontSize: 12,
                                  color: "var(--ink)",
                                  flex: 1,
                                  minWidth: 0,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {r.name}
                              </span>
                              {currentGroup && (
                                <span
                                  className="mono"
                                  style={{
                                    fontSize: 9,
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    background: currentGroup.color + "22",
                                    color: currentGroup.color,
                                    whiteSpace: "nowrap",
                                  }}
                                  title={`Đang ở nhóm "${currentGroup.name}" — tick sẽ chuyển sang nhóm mới`}
                                >
                                  ● {currentGroup.name}
                                </span>
                              )}
                            </label>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    marginBottom: 24,
                  }}
                >
                  <button
                    onClick={submitGroup}
                    disabled={groupBusy}
                    className="btn btn-accent"
                  >
                    {groupBusy
                      ? "Đang lưu…"
                      : groupEditingId == null
                        ? createAssignSelected.size > 0
                          ? `Tạo nhóm + gán ${createAssignSelected.size} page`
                          : "Tạo nhóm"
                        : "Lưu thay đổi"}
                  </button>
                  {groupEditingId != null && (
                    <button
                      onClick={resetGroupForm}
                      disabled={groupBusy}
                      className="btn"
                    >
                      Huỷ
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Page-assignment picker */}
                <div style={{ marginBottom: 10 }}>
                  <input
                    className="input"
                    placeholder="Tìm fanpage theo tên / username…"
                    value={groupAssignSearch}
                    onChange={(e) => setGroupAssignSearch(e.target.value)}
                    style={{ width: "100%", padding: "8px 12px", fontSize: 13 }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: 10,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  {(() => {
                    const q = groupAssignSearch.trim().toLowerCase();
                    const visible = q
                      ? rows.filter(
                          (r) =>
                            r.name.toLowerCase().includes(q) ||
                            (r.username ?? "").toLowerCase().includes(q),
                        )
                      : rows;
                    return (
                      <>
                        <button
                          onClick={() =>
                            setGroupAssignSelected(
                              new Set(visible.map((r) => r.id)),
                            )
                          }
                          className="btn"
                          style={{ padding: "5px 10px", fontSize: 11 }}
                        >
                          Chọn tất cả ({visible.length})
                        </button>
                        <button
                          onClick={() => setGroupAssignSelected(new Set())}
                          className="btn"
                          style={{ padding: "5px 10px", fontSize: 11 }}
                        >
                          Bỏ chọn
                        </button>
                        <span
                          className="mono"
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            letterSpacing: "0.04em",
                          }}
                        >
                          Đã chọn {groupAssignSelected.size} / {rows.length} page
                        </span>
                      </>
                    );
                  })()}
                </div>
                <div
                  style={{
                    maxHeight: 320,
                    overflowY: "auto",
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    padding: 6,
                    marginBottom: 14,
                  }}
                >
                  {(() => {
                    const q = groupAssignSearch.trim().toLowerCase();
                    const visible = q
                      ? rows.filter(
                          (r) =>
                            r.name.toLowerCase().includes(q) ||
                            (r.username ?? "").toLowerCase().includes(q),
                        )
                      : rows;
                    if (visible.length === 0) {
                      return (
                        <div
                          style={{
                            padding: 24,
                            textAlign: "center",
                            color: "var(--muted)",
                            fontStyle: "italic",
                          }}
                        >
                          Không khớp
                        </div>
                      );
                    }
                    return visible.map((r) => {
                      const checked = groupAssignSelected.has(r.id);
                      const currentGroup =
                        r.insightGroupId != null
                          ? groups.find((g) => g.id === r.insightGroupId)
                          : null;
                      const isInOther =
                        r.insightGroupId != null &&
                        r.insightGroupId !== groupAssignId;
                      return (
                        <label
                          key={r.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "6px 8px",
                            borderRadius: 4,
                            cursor: "pointer",
                            background: checked
                              ? "var(--accent-soft, rgba(94,106,210,0.08))"
                              : "transparent",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setGroupAssignSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(r.id)) next.delete(r.id);
                                else next.add(r.id);
                                return next;
                              });
                            }}
                            style={{ margin: 0, width: 15, height: 15 }}
                          />
                          {r.pictureUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={r.pictureUrl}
                              alt=""
                              width={26}
                              height={26}
                              style={{ borderRadius: 4, flexShrink: 0 }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 26,
                                height: 26,
                                borderRadius: 4,
                                background: "var(--line)",
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                color: "var(--ink)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                fontWeight: 500,
                              }}
                            >
                              {r.name}
                            </div>
                            {r.username && (
                              <div
                                className="mono"
                                style={{
                                  fontSize: 10,
                                  color: "var(--muted)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                @{r.username}
                              </div>
                            )}
                          </div>
                          {currentGroup && (
                            <span
                              className="mono"
                              style={{
                                fontSize: 9,
                                padding: "2px 6px",
                                borderRadius: 999,
                                background: isInOther
                                  ? "rgba(217,74,31,0.12)"
                                  : currentGroup.color + "22",
                                color: currentGroup.color,
                                letterSpacing: "0.04em",
                                whiteSpace: "nowrap",
                              }}
                              title={
                                isInOther
                                  ? `Đang ở nhóm "${currentGroup.name}" — tick sẽ chuyển sang nhóm này`
                                  : "Đang ở nhóm này"
                              }
                            >
                              ● {currentGroup.name}
                            </span>
                          )}
                        </label>
                      );
                    });
                  })()}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    marginBottom: 24,
                  }}
                >
                  <button
                    onClick={submitAssignPages}
                    disabled={groupBusy}
                    className="btn btn-accent"
                  >
                    {groupBusy ? "Đang lưu…" : "Lưu thay đổi"}
                  </button>
                  <button
                    onClick={cancelAssignPages}
                    disabled={groupBusy}
                    className="btn"
                  >
                    Huỷ
                  </button>
                </div>
              </>
            )}

            <div className="divider" style={{ margin: "8px 0 16px" }} />

            <h3
              className="h2-serif"
              style={{ margin: "0 0 10px", fontSize: 18 }}
            >
              Danh sách <em>nhóm</em>
            </h3>

            <div className="table-wrap" style={{ maxHeight: 320 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>Màu</th>
                    <th>Tên</th>
                    <th>Mô tả</th>
                    <th className="right" style={{ width: 70 }}>
                      Page
                    </th>
                    <th style={{ width: 130 }}>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        style={{
                          padding: 32,
                          textAlign: "center",
                          color: "var(--muted)",
                          fontStyle: "italic",
                          fontFamily: "var(--font-serif)",
                        }}
                      >
                        Chưa có nhóm — tạo nhóm đầu tiên ở form phía trên
                      </td>
                    </tr>
                  )}
                  {groups.map((g) => (
                    <tr
                      key={g.id}
                      className={groupEditingId === g.id ? "selected" : ""}
                    >
                      <td>
                        <span
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 999,
                            background: g.color,
                            display: "inline-block",
                            border: "1px solid var(--line)",
                          }}
                        />
                      </td>
                      <td>
                        <span
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontSize: 15,
                            color: "var(--ink)",
                          }}
                        >
                          {g.name}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>
                          {g.description || "—"}
                        </span>
                      </td>
                      <td className="right">
                        <span className="mono-num">{g.count}</span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            onClick={() => openAssignPages(g.id)}
                            disabled={groupBusy}
                            className="btn"
                            style={{
                              padding: "7px 14px",
                              fontSize: 12,
                              borderColor: g.color,
                              color: g.color,
                            }}
                            title="Chọn page để thêm/bỏ vào nhóm này"
                          >
                            Gán page
                          </button>
                          <button
                            onClick={() => startEditGroup(g)}
                            disabled={groupBusy}
                            className="btn"
                            style={{ padding: "7px 14px", fontSize: 12 }}
                          >
                            Sửa
                          </button>
                          <button
                            onClick={() => deleteGroup(g.id, g.count)}
                            disabled={groupBusy}
                            className="btn btn-danger"
                            style={{ padding: "7px 14px", fontSize: 12 }}
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function statusGlyph(s: StepStatus): string {
  switch (s) {
    case "running":
      return "◌";
    case "ok":
      return "✓";
    case "error":
      return "⚠";
    case "skipped":
      return "·";
  }
}

function statusColor(s: StepStatus): string {
  switch (s) {
    case "running":
      return "var(--accent)";
    case "ok":
      return "var(--good)";
    case "error":
      return "var(--accent)";
    case "skipped":
      return "var(--muted)";
  }
}

function fmtExpires(ts: number | null | undefined): string {
  if (ts == null) return "không hết hạn";
  if (ts === 0) return "không hết hạn";
  const d = new Date(ts * 1000);
  const diff = ts * 1000 - Date.now();
  const days = Math.round(diff / 86_400_000);
  const abs = d.toLocaleString("vi-VN");
  if (diff < 0) return `${abs} (đã hết hạn)`;
  if (days < 1) return `${abs} (còn <1 ngày)`;
  return `${abs} (còn ${days} ngày)`;
}

function SyncProgressPanel({
  steps,
  tokenInfo,
  onClear,
}: {
  steps: StepState[];
  tokenInfo: TokenInfo | null;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px",
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "var(--bg-warm, var(--paper))",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 320px)",
        gap: 14,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            Tiến trình sync
          </span>
          <button
            onClick={onClear}
            className="btn"
            style={{ padding: "2px 8px", fontSize: 10 }}
          >
            Ẩn
          </button>
        </div>
        {steps.length === 0 ? (
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
            Đang khởi động…
          </div>
        ) : (
          <ol
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {steps.map((s) => (
              <li
                key={s.step}
                style={{
                  display: "grid",
                  gridTemplateColumns: "16px minmax(0, 1fr) auto",
                  gap: 8,
                  alignItems: "baseline",
                  fontSize: 12,
                }}
              >
                <span
                  className="mono"
                  style={{ color: statusColor(s.status), textAlign: "center" }}
                >
                  {statusGlyph(s.status)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color:
                        s.status === "skipped" ? "var(--muted)" : "var(--ink)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.label}
                  </div>
                  {s.detail && (
                    <div
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: "var(--muted)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {s.detail}
                    </div>
                  )}
                  {s.error && (
                    <div
                      className="mono"
                      style={{
                        fontSize: 10,
                        color: "var(--accent)",
                        letterSpacing: "0.04em",
                        wordBreak: "break-word",
                        whiteSpace: "normal",
                      }}
                    >
                      ⚠ {s.error}
                    </div>
                  )}
                </div>
                <span
                  className="mono"
                  style={{ fontSize: 10, color: "var(--muted)" }}
                >
                  {s.durationMs != null ? `${s.durationMs}ms` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {tokenInfo && (
        <div
          style={{
            borderLeft: "1px solid var(--line)",
            paddingLeft: 12,
            minWidth: 0,
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
            Token
          </div>
          <dl
            style={{
              margin: 0,
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              columnGap: 10,
              rowGap: 3,
              fontSize: 11,
            }}
          >
            {tokenInfo.preview && (
              <>
                <dt style={{ color: "var(--muted)" }}>Preview</dt>
                <dd
                  className="mono"
                  style={{
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={tokenInfo.preview}
                >
                  {tokenInfo.preview}
                </dd>
              </>
            )}
            {tokenInfo.length != null && (
              <>
                <dt style={{ color: "var(--muted)" }}>Độ dài</dt>
                <dd className="mono" style={{ margin: 0 }}>
                  {tokenInfo.length} ký tự
                </dd>
              </>
            )}
            {tokenInfo.source && (
              <>
                <dt style={{ color: "var(--muted)" }}>Nguồn</dt>
                <dd className="mono" style={{ margin: 0 }}>
                  {tokenInfo.source === "direct" ? "user paste" : "đã lưu"}
                </dd>
              </>
            )}
            {tokenInfo.isValid != null && (
              <>
                <dt style={{ color: "var(--muted)" }}>Hợp lệ</dt>
                <dd
                  className="mono"
                  style={{
                    margin: 0,
                    color: tokenInfo.isValid
                      ? "var(--good)"
                      : "var(--accent)",
                  }}
                >
                  {tokenInfo.isValid ? "✓ valid" : "⚠ invalid"}
                </dd>
              </>
            )}
            {tokenInfo.application && (
              <>
                <dt style={{ color: "var(--muted)" }}>App</dt>
                <dd
                  className="mono"
                  style={{
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={`${tokenInfo.application} (${tokenInfo.appId ?? "?"})`}
                >
                  {tokenInfo.application}
                </dd>
              </>
            )}
            {tokenInfo.type && (
              <>
                <dt style={{ color: "var(--muted)" }}>Type</dt>
                <dd className="mono" style={{ margin: 0 }}>
                  {tokenInfo.type}
                </dd>
              </>
            )}
            {tokenInfo.expiresAt != null && (
              <>
                <dt style={{ color: "var(--muted)" }}>Hết hạn</dt>
                <dd
                  className="mono"
                  style={{ margin: 0, fontSize: 10 }}
                  title={String(tokenInfo.expiresAt)}
                >
                  {fmtExpires(tokenInfo.expiresAt)}
                </dd>
              </>
            )}
            {tokenInfo.missingRequired && tokenInfo.missingRequired.length > 0 && (
              <>
                <dt style={{ color: "var(--accent)" }}>Thiếu (bắt buộc)</dt>
                <dd
                  className="mono"
                  style={{ margin: 0, color: "var(--accent)", fontSize: 10 }}
                >
                  {tokenInfo.missingRequired.join(", ")}
                </dd>
              </>
            )}
            {tokenInfo.missingRecommended && tokenInfo.missingRecommended.length > 0 && (
              <>
                <dt style={{ color: "var(--muted)" }}>Nên có thêm</dt>
                <dd className="mono" style={{ margin: 0, fontSize: 10 }}>
                  {tokenInfo.missingRecommended.join(", ")}
                </dd>
              </>
            )}
            {tokenInfo.userId && (
              <>
                <dt style={{ color: "var(--muted)" }}>FB user</dt>
                <dd
                  className="mono"
                  style={{
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={tokenInfo.userId}
                >
                  {tokenInfo.fbName
                    ? `${tokenInfo.fbName} (${tokenInfo.userId})`
                    : tokenInfo.userId}
                </dd>
              </>
            )}
            {tokenInfo.scopes && tokenInfo.scopes.length > 0 && (
              <>
                <dt style={{ color: "var(--muted)" }}>Scopes</dt>
                <dd
                  className="mono"
                  style={{
                    margin: 0,
                    fontSize: 10,
                    lineHeight: 1.45,
                    wordBreak: "break-word",
                  }}
                >
                  {tokenInfo.scopes.join(", ")}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </div>
  );
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
