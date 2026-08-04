"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CirclePlay,
  ClipboardList,
  Clock3,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSalesCurrentOrgId } from "@/lib/hooks/use-sales-current-org-id";
import { withSalesOrgId } from "@/lib/sales/sales-client-org";
import type {
  SalesActionDto,
  SalesActionMetrics,
  SalesActionSyncDto,
} from "./sales-action-types";

function dueLabel(value: string | null): { text: string; overdue: boolean } {
  if (!value) return { text: "未设截止时间", overdue: false };
  const due = new Date(value);
  const overdue = due.getTime() < Date.now();
  return {
    text: `${overdue ? "已逾期 · " : "截止 "}${due.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
    overdue,
  };
}

export function SalesActionLoopPanel() {
  const { orgId } = useSalesCurrentOrgId();
  const [actions, setActions] = useState<SalesActionDto[]>([]);
  const [metrics, setMetrics] = useState<SalesActionMetrics | null>(null);
  const [latestSync, setLatestSync] = useState<SalesActionSyncDto | null>(null);
  const [reps, setReps] = useState<Array<{ id: string; name: string }>>([]);
  const [canManualSync, setCanManualSync] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [finishTarget, setFinishTarget] = useState<{ id: string; mode: "completed" | "dismissed" } | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch("/api/sales/actions?status=active");
      if (!response.ok) return;
      const data = await response.json();
      setActions(Array.isArray(data.actions) ? data.actions : []);
      setMetrics(data.metrics ?? null);
      setLatestSync(data.latestSync ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    apiFetch("/api/sales/reps")
      .then(async (response) => {
        setCanManualSync(response.ok);
        return response.ok ? response.json() : { reps: [] };
      })
      .then((data) => setReps(Array.isArray(data.reps) ? data.reps : []))
      .catch(() => setReps([]));
  }, [load]);

  async function syncNow() {
    if (!orgId) return;
    setSyncing(true);
    try {
      const response = await apiFetch("/api/sales/actions/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withSalesOrgId(orgId, {})),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "扫描失败");
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "扫描失败");
    } finally {
      setSyncing(false);
    }
  }

  async function updateAction(id: string, body: Record<string, unknown>) {
    if (!orgId) return;
    setUpdatingId(id);
    try {
      const response = await apiFetch(`/api/sales/actions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withSalesOrgId(orgId, body)),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "更新失败");
      setFinishTarget(null);
      setNote("");
      await load();
    } catch (error) {
      alert(error instanceof Error ? error.message : "更新失败");
    } finally {
      setUpdatingId(null);
    }
  }

  if (
    !loading &&
    actions.length === 0 &&
    !metrics?.completed &&
    !metrics?.dismissed &&
    !latestSync
  ) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card-bg">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <ClipboardList size={17} />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">数字员工行动闭环</h2>
            <p className="text-xs text-muted">每项建议都有负责人、截止时间和处理结果</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {latestSync && (
            <span
              className="text-[10px] text-muted"
              title={latestSync.truncated ? "本轮达到扫描上限，未自动关闭旧行动" : undefined}
            >
              {latestSync.status === "failed"
                ? "自动扫描失败"
                : `自动扫描于 ${new Date(latestSync.completedAt ?? latestSync.startedAt).toLocaleString("zh-CN", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`}
              {latestSync.truncated ? " · 已启用保守保护" : ""}
            </span>
          )}
          {canManualSync && (
            <Button size="sm" variant="outline" disabled={syncing} onClick={() => void syncNow()}>
              <RefreshCw className={cn("mr-1 h-3.5 w-3.5", syncing && "animate-spin")} />立即扫描
            </Button>
          )}
          {metrics && (
            <div className="grid grid-cols-3 gap-2 text-center text-[10px] sm:flex sm:gap-4">
              <span><b className="block text-sm text-foreground">{metrics.open}</b>处理中</span>
              <span className={metrics.overdue ? "text-red-700" : undefined}><b className="block text-sm">{metrics.overdue}</b>已逾期</span>
              <span><b className="block text-sm text-foreground">{metrics.completionRate == null ? "–" : `${metrics.completionRate}%`}</b>有效完成率</span>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>
      ) : (
        <div className="divide-y divide-border">
          {actions.slice(0, 8).map((action) => {
            const due = dueLabel(action.dueAt);
            const finishing = finishTarget?.id === action.id;
            return (
              <article key={action.id} className="px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", action.priority === "urgent" ? "bg-red-500" : action.priority === "high" ? "bg-amber-500" : "bg-blue-500")} />
                      <p className="text-sm font-medium text-foreground">{action.title}</p>
                      <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted">{action.status === "in_progress" ? "处理中" : "待处理"}</span>
                    </div>
                    {action.description && <p className="mt-1 text-xs text-muted">{action.description}</p>}
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                      {reps.length > 0 ? (
                        <label className="inline-flex items-center gap-1">
                          负责人：
                          <select
                            value={action.assignedTo?.id ?? ""}
                            onChange={(event) => void updateAction(action.id, { assignedToId: event.target.value || null })}
                            disabled={updatingId === action.id}
                            className="rounded border border-border bg-card-bg px-1 py-0.5 text-[11px]"
                            aria-label={`${action.customer.name}行动负责人`}
                          >
                            <option value="">未分配</option>
                            {action.assignedTo && !reps.some((rep) => rep.id === action.assignedTo?.id) && (
                              <option value={action.assignedTo.id}>{action.assignedTo.name}</option>
                            )}
                            {reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
                          </select>
                        </label>
                      ) : (
                        <span>负责人：{action.assignedTo?.name ?? "未分配"}</span>
                      )}
                      <span className={cn("inline-flex items-center gap-1", due.overdue && "font-medium text-red-700")}><Clock3 size={11} />{due.text}</span>
                      <Link href={`/sales/customers/${action.customer.id}`} className="inline-flex items-center gap-1 text-accent">客户详情 <ArrowRight size={11} /></Link>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {action.status === "open" && (
                      <Button size="sm" variant="outline" disabled={updatingId === action.id} onClick={() => void updateAction(action.id, { status: "in_progress" })}>
                        <CirclePlay className="mr-1 h-3.5 w-3.5" />开始处理
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => { setFinishTarget({ id: action.id, mode: "dismissed" }); setNote(""); }}><XCircle className="mr-1 h-3.5 w-3.5" />忽略</Button>
                    <Button size="sm" onClick={() => { setFinishTarget({ id: action.id, mode: "completed" }); setNote(""); }}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />完成</Button>
                  </div>
                </div>
                {finishing && (
                  <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-background/50 p-3 sm:flex-row">
                    <input
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder={finishTarget.mode === "completed" ? "填写处理结果，例如：客户确认周五量房" : "填写忽略原因，例如：客户已明确暂停"}
                      className="min-h-10 flex-1 rounded-lg border border-border bg-card-bg px-3 text-base outline-none sm:text-sm"
                    />
                    <Button
                      disabled={!note.trim() || updatingId === action.id}
                      onClick={() => void updateAction(action.id, finishTarget.mode === "completed" ? { status: "completed", resolutionNote: note } : { status: "dismissed", dismissedReason: note })}
                    >
                      {updatingId === action.id && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                      确认{finishTarget.mode === "completed" ? "完成" : "忽略"}
                    </Button>
                    <Button variant="outline" onClick={() => { setFinishTarget(null); setNote(""); }}>取消</Button>
                  </div>
                )}
              </article>
            );
          })}
          {actions.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">当前没有待处理行动</p>}
        </div>
      )}
    </section>
  );
}
