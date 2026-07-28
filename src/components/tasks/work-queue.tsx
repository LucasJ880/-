"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  normalizeTaskStatus,
  partitionWorkQueue,
  TASK_STATUS_META,
  TASK_STATUS_VALUES,
  type TaskStatusValue,
} from "@/lib/tasks";
import { cn, TASK_PRIORITY, type TaskPriority } from "@/lib/utils";
import { TaskDrawer } from "@/components/tasks/task-drawer";

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  waitingOn: string | null;
  waitingUntil: string | null;
  blockedReason: string | null;
  completedAt: string | null;
  updatedAt: string;
  project: { id: string; name: string; color: string } | null;
  assignee: { id: string; name: string } | null;
  creator?: { id: string; name: string } | null;
};

type ListResponse = {
  items: TaskRow[];
  total: number | null;
  page: number | null;
  pageSize: number;
  view: "mine" | "team";
  canToggleTeamView: boolean;
};

function statusLabel(s: string): string {
  return TASK_STATUS_META[s as TaskStatusValue]?.label ?? s;
}

function formatDue(iso: string | null): string {
  if (!iso) return "无截止";
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function waitingSummary(t: TaskRow): string | null {
  if (t.status === "blocked") return t.blockedReason || "缺少阻塞原因";
  if (t.status === "waiting_external" || t.status === "waiting_internal") {
    const base = t.waitingOn || "缺少等待对象";
    if (t.waitingUntil) return `${base} · 跟进 ${formatDue(t.waitingUntil)}`;
    return base;
  }
  return null;
}

export function WorkQueue() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const view = (searchParams.get("view") === "team" ? "team" : "mine") as
    | "mine"
    | "team";
  const status = searchParams.get("status") || "";
  const due = searchParams.get("due") || "";
  const bucket = searchParams.get("bucket") || "";
  const search = searchParams.get("search") || searchParams.get("q") || "";
  const projectId =
    searchParams.get("projectId") || searchParams.get("project") || "";
  const focusId = searchParams.get("focus") || searchParams.get("open") || "";

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(search);
  const [drawerId, setDrawerId] = useState<string | null>(focusId || null);
  const [drawerOpen, setDrawerOpen] = useState(Boolean(focusId));
  const [statusEditId, setStatusEditId] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<TaskStatusValue>("todo");
  const [blockedReason, setBlockedReason] = useState("");
  const [waitingOn, setWaitingOn] = useState("");
  const [waitingUntil, setWaitingUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (!v) sp.delete(k);
        else sp.set(k, v);
      }
      router.replace(`/tasks?${sp.toString()}`);
    },
    [router, searchParams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const sp = new URLSearchParams();
      sp.set("view", view);
      sp.set("pageSize", "50");
      if (status) sp.set("status", status);
      if (due) sp.set("due", due);
      if (bucket) sp.set("bucket", bucket);
      if (search) sp.set("search", search);
      if (projectId) sp.set("projectId", projectId);
      const res = await apiFetch(`/api/tasks?${sp.toString()}`);
      if (res.status === 403) {
        setError("无权查看该视图");
        setData(null);
        return;
      }
      if (!res.ok) throw new Error(`load ${res.status}`);
      const json = (await res.json()) as ListResponse;
      setData(json);
    } catch {
      setError("任务加载失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [view, status, due, bucket, search, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  useEffect(() => {
    if (focusId) {
      setDrawerId(focusId);
      setDrawerOpen(true);
    }
  }, [focusId]);

  const groups = useMemo(() => {
    const items = data?.items ?? [];
    return partitionWorkQueue(items);
  }, [data]);

  const patchStatus = async (task: TaskRow) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { status: nextStatus };
      if (nextStatus === "blocked") body.blockedReason = blockedReason.trim();
      if (
        nextStatus === "waiting_external" ||
        nextStatus === "waiting_internal"
      ) {
        body.waitingOn = waitingOn.trim();
        body.waitingUntil = waitingUntil || null;
      }
      const res = await apiFetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "更新失败");
      setStatusEditId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
    } finally {
      setSaving(false);
    }
  };

  const createTask = async () => {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "创建失败");
      }
      setNewTitle("");
      setCreateOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const renderRow = (t: TaskRow) => {
    const summary = waitingSummary(t);
    const editing = statusEditId === t.id;
    return (
      <li
        key={t.id}
        className="border-b border-[var(--border)] py-3 last:border-b-0"
      >
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <button
              type="button"
              className="text-left text-[14px] font-medium hover:text-[var(--accent)]"
              onClick={() => {
                setDrawerId(t.id);
                setDrawerOpen(true);
              }}
            >
              <span className="mr-2 text-[11px] uppercase text-[var(--muted)]">
                {TASK_PRIORITY[t.priority as TaskPriority]?.label || t.priority}
              </span>
              {t.title}
            </button>
            <p className="text-[12px] text-[var(--muted)]">
              <span
                className={cn(
                  "mr-1 rounded px-1.5 py-0.5",
                  TASK_STATUS_META[t.status as TaskStatusValue]?.color,
                )}
              >
                {statusLabel(t.status)}
              </span>
              {formatDue(t.dueDate)}
              {t.assignee ? ` · ${t.assignee.name}` : " · 未指派"}
              {t.project ? ` · ${t.project.name}` : " · 无项目"}
              {" · 来源未记录"}
              {` · 更新 ${formatDue(t.updatedAt)}`}
            </p>
            {summary ? (
              <p className="text-[12px] text-amber-800">{summary}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[12px]"
              onClick={() => {
                setStatusEditId(t.id);
                setNextStatus(normalizeTaskStatus(t.status) || "todo");
                setBlockedReason(t.blockedReason || "");
                setWaitingOn(t.waitingOn || "");
                setWaitingUntil(
                  t.waitingUntil ? t.waitingUntil.slice(0, 16) : "",
                );
              }}
            >
              改状态
            </button>
            {t.project ? (
              <Link
                href={`/projects/${t.project.id}`}
                className="rounded-md px-2.5 py-1 text-[12px] text-[var(--accent)] hover:underline"
              >
                项目
              </Link>
            ) : null}
          </div>
        </div>
        {editing ? (
          <div className="mt-3 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
            <select
              value={nextStatus}
              onChange={(e) =>
                setNextStatus(e.target.value as TaskStatusValue)
              }
              className="w-full rounded-md border border-[var(--border)] bg-[var(--card-bg)] px-2 py-1.5 text-[13px]"
            >
              {TASK_STATUS_VALUES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_META[s].label}
                </option>
              ))}
            </select>
            {nextStatus === "blocked" ? (
              <input
                value={blockedReason}
                onChange={(e) => setBlockedReason(e.target.value)}
                placeholder="阻塞原因（必填）"
                className="w-full rounded-md border border-[var(--border)] px-2 py-1.5 text-[13px]"
              />
            ) : null}
            {nextStatus === "waiting_external" ||
            nextStatus === "waiting_internal" ? (
              <>
                <input
                  value={waitingOn}
                  onChange={(e) => setWaitingOn(e.target.value)}
                  placeholder="等待对象（必填）"
                  className="w-full rounded-md border border-[var(--border)] px-2 py-1.5 text-[13px]"
                />
                <input
                  type="datetime-local"
                  value={waitingUntil}
                  onChange={(e) => setWaitingUntil(e.target.value)}
                  className="w-full rounded-md border border-[var(--border)] px-2 py-1.5 text-[13px]"
                />
              </>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void patchStatus(t)}
                className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] text-[var(--on-accent)]"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => setStatusEditId(null)}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[12px]"
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
      </li>
    );
  };

  const Section = ({
    title,
    items,
  }: {
    title: string;
    items: TaskRow[];
  }) => (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between border-b border-[var(--border)] pb-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="text-[12px] text-[var(--muted)]">{items.length}</span>
      </div>
      {items.length ? (
        <ul>{items.map(renderRow)}</ul>
      ) : (
        <p className="py-3 text-[13px] text-[var(--muted)]">暂无</p>
      )}
    </section>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 md:px-6">
      <header className="flex flex-col gap-3 border-b border-[var(--border)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">我的工作</h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            统一工作队列 · 逾期、阻塞与等待优先处理
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data?.canToggleTeamView ? (
            <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-[12px]">
              <button
                type="button"
                className={cn(
                  "rounded-md px-3 py-1.5",
                  view === "mine"
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "text-[var(--muted)]",
                )}
                onClick={() => setParams({ view: "mine" })}
              >
                我的工作
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-md px-3 py-1.5",
                  view === "team"
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "text-[var(--muted)]",
                )}
                onClick={() => setParams({ view: "team" })}
              >
                团队工作
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px]"
          >
            筛选
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px]"
            aria-label="刷新"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] text-[var(--on-accent)]"
          >
            <Plus size={14} /> 新建
          </button>
        </div>
      </header>

      {filtersOpen ? (
        <div className="grid gap-2 rounded-xl border border-[var(--border)] p-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setParams({ search: searchDraft || null });
            }}
            placeholder="搜索标题…"
            className="rounded-md border border-[var(--border)] px-2 py-1.5 text-[13px] sm:col-span-2"
          />
          <select
            value={status}
            onChange={(e) => setParams({ status: e.target.value || null })}
            className="rounded-md border border-[var(--border)] px-2 py-1.5 text-[13px]"
          >
            <option value="">全部状态</option>
            {TASK_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_META[s].label}
              </option>
            ))}
          </select>
          <select
            value={due}
            onChange={(e) => setParams({ due: e.target.value || null })}
            className="rounded-md border border-[var(--border)] px-2 py-1.5 text-[13px]"
          >
            <option value="">全部时间</option>
            <option value="overdue">已逾期</option>
            <option value="today">今天到期</option>
            <option value="upcoming">未到期</option>
            <option value="none">无截止日期</option>
          </select>
          <select
            value={bucket}
            onChange={(e) => setParams({ bucket: e.target.value || null })}
            className="rounded-md border border-[var(--border)] px-2 py-1.5 text-[13px]"
          >
            <option value="">全部分组</option>
            <option value="open">开放中</option>
            <option value="waiting">等待中</option>
            <option value="blocked">阻塞</option>
            <option value="closed">已完成/取消</option>
          </select>
          <button
            type="button"
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] text-[var(--on-accent)]"
            onClick={() => setParams({ search: searchDraft || null })}
          >
            应用搜索
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          {error}
        </p>
      ) : null}

      {createOpen ? (
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] p-3 sm:flex-row">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="新任务标题"
            className="flex-1 rounded-md border border-[var(--border)] px-2 py-1.5 text-[13px]"
            autoFocus
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => void createTask()}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] text-[var(--on-accent)]"
          >
            创建
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(false)}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[12px]"
          >
            取消
          </button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
        </div>
      ) : (
        <div className="space-y-8">
          <Section title="需要立即处理" items={groups.urgent} />
          <Section title="进行中的工作" items={groups.active} />
          <Section title="等待中的工作" items={groups.waiting} />
          <Section title="阻塞工作" items={groups.blocked} />
          <Section title="最近完成" items={groups.recent_done.slice(0, 20)} />
          {data?.total != null ? (
            <p className="text-[12px] text-[var(--muted)]">
              当前筛选共 {data.total} 条（本页最多 {data.pageSize} 条）
            </p>
          ) : null}
        </div>
      )}

      <TaskDrawer
        taskId={drawerId}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerId(null);
        }}
      />
    </div>
  );
}
