"use client";

/**
 * Tender T1B — 一键 AI 分析卡片（任务书 §8/§26/§27/§33）
 *
 * 可复用自包含组件：自取数、自轮询，不依赖父级布局（T1A 未合并期间
 * 挂在 TenderAnalysisPanel 顶部；T1A 合并后随 panel 进入新 5-Tab 布局）。
 * feature flag 关闭（GET 返回 enabled=false）时渲染 null——现有用户
 * 行为原样保持（§37）。
 *
 * 用户永远不需要理解 AgentRun/Task/Handoff：状态用人话，
 * 「查看执行详情」链接到既有 Workforce Job Center（§25/§26）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

type AgentStatusPayload = {
  enabled: boolean;
  job: {
    jobId: string;
    status:
      | "QUEUED"
      | "WORKING"
      | "NEEDS_YOU"
      | "COMPLETED"
      | "PARTIAL"
      | "FAILED"
      | "CANCELLED";
    title?: string;
    progress: {
      totalTasks: number;
      completedTasks: number;
      activeTasks: number;
      blockedTasks: number;
    };
    currentTaskTitle?: string;
    needsYou?: { title?: string; detail?: string };
    finalSummary?: string;
    createdAt: string;
    completedAt?: string;
  } | null;
  latestAnalysisRun: {
    id: string;
    status: string;
    summaryText: string | null;
    completedAt: string | null;
  } | null;
};

const ACTIVE_STATUSES = new Set(["QUEUED", "WORKING"]);

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

type Props = {
  projectId: string;
  /** Job 到达终态时通知父级刷新分析结果（可选） */
  onAnalysisFinished?: () => void;
};

export function TenderAnalysisAgentCard({ projectId, onAnalysisFinished }: Props) {
  const [data, setData] = useState<AgentStatusPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // 同一次"启动意图"内保持稳定（双击共享同一 requestId → 服务端幂等）；
  // 到达终态后重置，允许下一次「重新分析」
  const requestIdRef = useRef<string>(newRequestId());
  const lastTerminalNotifiedRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tender-analysis/agent`);
      if (!res.ok) return;
      const body = (await res.json()) as { agent: AgentStatusPayload };
      setData(body.agent);
    } catch {
      /* 静默：状态轮询失败不打扰用户 */
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const jobStatus = data?.job?.status;
  const isActive = jobStatus ? ACTIVE_STATUSES.has(jobStatus) : false;

  // 活跃期轮询（8s）
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [isActive, load]);

  // 终态通知父级刷新结果 + 重置 requestId
  useEffect(() => {
    const job = data?.job;
    if (!job) return;
    if (ACTIVE_STATUSES.has(job.status)) return;
    if (lastTerminalNotifiedRef.current === job.jobId) return;
    lastTerminalNotifiedRef.current = job.jobId;
    requestIdRef.current = newRequestId();
    onAnalysisFinished?.();
  }, [data, onAnalysisFinished]);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/tender-analysis/agent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(
          (body as { error?: string }).error ?? "操作失败，请稍后重试",
        );
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const start = (restart: boolean) =>
    post({
      action: restart ? "restart" : "start",
      requestId: requestIdRef.current,
    });

  const cancel = () => {
    if (!data?.job) return;
    void post({ action: "cancel", jobId: data.job.jobId });
  };

  // flag 关闭 / 尚未加载：不渲染任何新 UI（legacy 行为原样）
  if (!data || !data.enabled) return null;

  const job = data.job;
  const run = data.latestAnalysisRun;
  const hasHistory = Boolean(job || run);

  let statusLine: string;
  let statusTone: "idle" | "active" | "warn" | "done" | "fail" = "idle";
  if (!job) {
    statusLine = "尚未运行 AI 数字员工分析";
  } else if (job.status === "QUEUED") {
    statusLine = "AI 分析已排队，即将开始";
    statusTone = "active";
  } else if (job.status === "WORKING") {
    statusLine = `AI 分析中 · ${job.progress.completedTasks}/${job.progress.totalTasks} 个任务完成${job.currentTaskTitle ? ` · 当前：${job.currentTaskTitle}` : ""}`;
    statusTone = "active";
  } else if (job.status === "NEEDS_YOU") {
    statusLine = `AI 分析需要处理${job.needsYou?.title ? `：${job.needsYou.title}` : ""}`;
    statusTone = "warn";
  } else if (job.status === "COMPLETED") {
    statusLine = "AI 分析完成，结果已生成";
    statusTone = "done";
  } else if (job.status === "CANCELLED") {
    statusLine = "上次 AI 分析已取消";
    statusTone = "fail";
  } else {
    statusLine = "上次 AI 分析未完成";
    statusTone = "fail";
  }

  const toneClass =
    statusTone === "active"
      ? "text-blue-600"
      : statusTone === "warn"
        ? "text-amber-600"
        : statusTone === "done"
          ? "text-emerald-600"
          : statusTone === "fail"
            ? "text-muted-foreground"
            : "text-muted-foreground";

  return (
    <div
      className="rounded-xl border border-border bg-card p-4 space-y-3"
      data-testid="tender-analysis-agent-card"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">AI 数字员工 · 投标分析</div>
          <div className={`mt-1 text-sm ${toneClass}`}>{statusLine}</div>
          {job?.status === "NEEDS_YOU" && job.needsYou?.detail ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {job.needsYou.detail}
            </div>
          ) : null}
          {job?.status === "COMPLETED" && job.finalSummary ? (
            <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {job.finalSummary}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isActive ? (
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            >
              取消
            </button>
          ) : (
            <button
              type="button"
              onClick={() => start(hasHistory ? true : false)}
              disabled={busy}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {hasHistory ? "重新分析" : "开始 AI 分析"}
            </button>
          )}
        </div>
      </div>
      {actionError ? (
        <div className="text-xs text-red-600">{actionError}</div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {job ? (
          <a href={`/workforce/${job.jobId}`} className="underline-offset-2 hover:underline">
            查看执行详情
          </a>
        ) : null}
        {run && run.status === "REVIEW_REQUIRED" ? (
          <span>分析结果已就绪，请在下方审阅确认</span>
        ) : null}
        {run &&
        run.status === "AGENT_ANALYZING" &&
        job?.status === "COMPLETED" ? (
          <span>正在整理分析记录…</span>
        ) : null}
      </div>
    </div>
  );
}
