"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Bell,
  CheckSquare,
  Clock,
  Eye,
  Filter,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/ui/pagination";
import { NotificationListItem } from "@/components/notification/notification-list-item";
import type { NotificationItem } from "@/components/notification/types";
import { Suspense } from "react";

function NotificationsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [prefHint, setPrefHint] = useState<{
    inApp: boolean;
    onlyHigh: boolean;
    onlyMy: boolean;
  } | null>(null);

  const statusFilter = searchParams.get("status") || "";
  const typeFilter = searchParams.get("type") || "";

  const load = useCallback(
    (p = 1) => {
      setLoading(true);
      const qs = new URLSearchParams({ page: String(p), pageSize: "20" });
      if (statusFilter) qs.set("status", statusFilter);
      if (typeFilter) qs.set("type", typeFilter);
      apiFetch(`/api/notifications?${qs}`)
        .then((r) => r.json())
        .then((d) => {
          setItems(d.data ?? []);
          setTotal(d.total ?? 0);
          setPage(d.page ?? 1);
        })
        .finally(() => setLoading(false));
    },
    [statusFilter, typeFilter]
  );

  useEffect(() => {
    load(1);
  }, [load]);

  useEffect(() => {
    apiFetch("/api/notifications/preferences/me")
      .then((r) => r.json())
      .then((d) => {
        const p = d.preference;
        if (p)
          setPrefHint({
            inApp: p.enableInAppNotifications,
            onlyHigh: p.onlyHighPriority,
            onlyMy: p.onlyMyItems,
          });
      })
      .catch(() => {});
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }, [items, selected.size]);

  const batchOp = useCallback(
    async (action: string, snoozePreset?: string) => {
      if (selected.size === 0) return;
      setBatchBusy(true);
      try {
        const body: Record<string, unknown> = {
          ids: Array.from(selected),
          action,
        };
        if (snoozePreset) body.preset = snoozePreset;
        await apiFetch("/api/notifications/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setSelected(new Set());
        load(page);
      } finally {
        setBatchBusy(false);
      }
    },
    [selected, load, page]
  );

  const handleItemAction = useCallback(
    async (id: string, action: "read" | "done") => {
      await apiFetch(`/api/notifications/${id}/${action}`, { method: "PATCH" });
      load(page);
    },
    [load, page]
  );

  const handleSnooze = useCallback(
    async (id: string, preset: string) => {
      await apiFetch(`/api/notifications/${id}/snooze`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset }),
      });
      load(page);
    },
    [load, page]
  );

  const handleItemClick = useCallback(
    (item: NotificationItem) => {
      if (item.status === "unread") {
        apiFetch(`/api/notifications/${item.id}/read`, { method: "PATCH" });
      }
      if (item.entityType === "task" && item.entityId) {
        router.push(`/tasks/${item.entityId}`);
      } else if (item.entityType === "project" && item.entityId) {
        router.push(`/projects/${item.entityId}`);
      } else if (item.projectId && item.activityId) {
        router.push(`/projects/${item.projectId}?activity=${item.activityId}`);
      } else if (item.projectId) {
        router.push(`/projects/${item.projectId}`);
      }
    },
    [router]
  );

  const setFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.push(`/notifications?${params.toString()}`);
    },
    [router, searchParams]
  );

  const STATUS_TABS = [
    { key: "", label: "全部" },
    { key: "unread", label: "未读" },
    { key: "done", label: "已处理" },
    { key: "snoozed", label: "稍后提醒" },
  ];

  const TYPE_OPTIONS = [
    { key: "", label: "全部类型" },
    { key: "task_due", label: "任务截止" },
    { key: "calendar_event", label: "日程" },
    { key: "followup", label: "跟进" },
    { key: "evaluation_low", label: "低分评估" },
    { key: "feedback", label: "反馈" },
    { key: "runtime_failed", label: "运行失败" },
    { key: "project_update", label: "项目更新" },
    { key: "project_dispatched", label: "项目分发" },
  ];

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="通知中心"
          description="管理您的所有通知和提醒，追踪待处理事项"
        />
        <Link
          href="/settings/notifications"
          className="shrink-0 rounded-lg border border-border bg-[rgba(43,96,85,0.04)] px-3 py-2 text-xs font-medium text-accent transition-colors hover:bg-[rgba(43,96,85,0.08)]"
        >
          通知偏好设置
        </Link>
      </div>

      {prefHint && !prefHint.inApp && (
        <div className="rounded-lg border border-[rgba(154,106,47,0.25)] bg-[rgba(154,106,47,0.06)] px-4 py-3 text-sm text-[#9a6a2f]">
          您已关闭「站内通知」，此处将不展示列表。可在通知偏好中重新开启。
        </div>
      )}
      {prefHint && prefHint.inApp && (prefHint.onlyHigh || prefHint.onlyMy) && (
        <div className="rounded-lg border border-border/80 bg-background/50 px-4 py-2.5 text-xs text-muted">
          当前已开启
          {prefHint.onlyHigh ? "「仅高优先级」" : ""}
          {prefHint.onlyHigh && prefHint.onlyMy ? "、" : ""}
          {prefHint.onlyMy ? "「仅与我相关」" : ""}
          ，部分通知不会出现在列表中。
          <Link href="/settings/notifications" className="ml-1 text-accent hover:underline">
            调整偏好
          </Link>
        </div>
      )}

      {/* tabs + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter("status", tab.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                statusFilter === tab.key
                  ? "bg-accent text-white"
                  : "text-muted hover:bg-[rgba(43,96,85,0.06)] hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Filter size={14} className="text-muted" />
          <select
            value={typeFilter}
            onChange={(e) => setFilter("type", e.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-accent"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* batch actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-accent/20 bg-[rgba(43,96,85,0.03)] px-4 py-2">
          <span className="text-sm text-foreground">
            已选 <span className="font-semibold text-accent">{selected.size}</span> 项
          </span>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              disabled={batchBusy}
              onClick={() => batchOp("mark_read")}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-[rgba(43,96,85,0.08)] disabled:opacity-50"
            >
              <Eye size={12} /> 全部已读
            </button>
            <button
              type="button"
              disabled={batchBusy}
              onClick={() => batchOp("mark_done")}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[#2e7a56] transition-colors hover:bg-[rgba(46,122,86,0.08)] disabled:opacity-50"
            >
              <CheckSquare size={12} /> 全部完成
            </button>
            <button
              type="button"
              disabled={batchBusy}
              onClick={() => batchOp("snooze")}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[#9a6a2f] transition-colors hover:bg-[rgba(154,106,47,0.06)] disabled:opacity-50"
            >
              <Clock size={12} /> 稍后提醒
            </button>
          </div>
        </div>
      )}

      {/* list */}
      <div className="rounded-xl border border-border bg-card-bg">
        {items.length > 0 && (
          <div className="flex items-center border-b border-border px-4 py-2">
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={selected.size === items.length && items.length > 0}
                onChange={selectAll}
                className="accent-accent"
              />
              全选
            </label>
            <span className="ml-auto text-xs text-muted">
              共 {total} 条
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={20} className="animate-spin text-accent" />
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Bell size={32} className="mx-auto mb-3 text-muted/20" />
            <p className="text-sm font-medium text-muted">没有通知</p>
            <p className="mt-1 text-xs text-muted/60">
              {statusFilter === "unread"
                ? "所有通知已读，做得不错！"
                : statusFilter === "done"
                  ? "还没有已处理的通知"
                  : statusFilter === "snoozed"
                    ? "没有稍后提醒的通知"
                    : "暂时没有任何通知"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {items.map((item) => (
              <NotificationListItem
                key={item.id}
                item={item}
                selected={selected.has(item.id)}
                onSelect={toggleSelect}
                onClick={handleItemClick}
                onMarkRead={(id) => handleItemAction(id, "read")}
                onMarkDone={(id) => handleItemAction(id, "done")}
                onSnooze={handleSnooze}
              />
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={(p) => load(p)}
        />
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      }
    >
      <NotificationsContent />
    </Suspense>
  );
}
