"use client";

/**
 * Runtime V2 Workbench：目标/状态 → 分析结果 →（审批由外层 Panel）→ 简化进度 → 技术步骤 → Verifier
 */

import { useState, type ComponentType, type ReactNode } from "react";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  ListTodo,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  assistantStatusLabel,
  type AssistantRunStatusDto,
  type AssistantTaskStatus,
} from "@/lib/assistant/run-status-types";
import {
  formatAwaitingCopy,
  simplifyEvidenceRefs,
  USER_PROGRESS_LABEL,
  deriveUserProgress,
} from "@/lib/assistant/inline-approval-model";
import {
  preferRuntimeV2Steps,
  runtimeV2StepStatusLabel,
  topReasons,
} from "@/lib/assistant/runtime-v2-ui";

const STATUS_ICON: Record<
  AssistantTaskStatus,
  ComponentType<{ size?: number; className?: string }>
> = {
  received: CircleDashed,
  planning: Loader2,
  running: Loader2,
  waiting_for_confirmation: ShieldCheck,
  completed: CheckCircle2,
  failed: AlertCircle,
  cancelled: Ban,
};

const STATUS_TONE: Record<AssistantTaskStatus, string> = {
  received: "border-[#2b6055]/15 bg-[#f6f8f7] text-[#2b6055]",
  planning: "border-[#2b6055]/20 bg-[#edf3f1] text-[#2b6055]",
  running: "border-[#2b6055]/25 bg-[#edf3f1] text-[#1f4f46]",
  waiting_for_confirmation: "border-amber-300/80 bg-amber-50 text-amber-950",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-[rgba(166,61,61,0.25)] bg-[#fff7f7] text-[#a63d3d]",
  cancelled: "border-black/10 bg-[#f3f4f3] text-[#68706c]",
};

export function runtimeV2WorkbenchSummary(
  run: AssistantRunStatusDto,
  pendingActionCount?: number,
): string | null {
  const awaitingSteps =
    run.awaitingApprovalStepCount ??
    (run.runtimeSteps?.filter((x) => x.status === "awaiting_approval").length ??
      0);
  const s = run.actionSummary;
  const pending =
    pendingActionCount ??
    (s ? s.pending + s.approved : run.pendingActionIds?.length ?? 0);
  return (
    formatAwaitingCopy({
      awaitingApprovalSteps: awaitingSteps,
      pendingActions: pending,
      executedActions: s?.executed ?? 0,
      rejectedActions: s?.rejected ?? 0,
      failedActions: s?.failed ?? 0,
    }) || null
  );
}

type Props = {
  run: AssistantRunStatusDto;
  pendingActionCount?: number;
  analyzedOpportunityCount?: number | null;
  /** 插在分析结果与简化进度之间（Inline Approval Panel） */
  approvalSlot?: ReactNode;
  onRetry?: (run: AssistantRunStatusDto) => void | Promise<void>;
  className?: string;
};

export function RuntimeV2Workbench({
  run,
  pendingActionCount,
  analyzedOpportunityCount,
  approvalSlot,
  onRetry,
  className,
}: Props) {
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const Icon = STATUS_ICON[run.status];
  const spinning = run.status === "planning" || run.status === "running";
  const summary = runtimeV2WorkbenchSummary(run, pendingActionCount);
  const customers = run.prioritizedCustomers ?? [];
  const progress = deriveUserProgress({
    runStatus:
      typeof (run as { rawStatus?: string }).rawStatus === "string"
        ? ((run as { rawStatus?: string }).rawStatus as string)
        : run.status === "waiting_for_confirmation"
          ? "awaiting_approval"
          : run.status === "completed"
            ? "completed"
            : run.status === "failed"
              ? "failed"
              : run.status === "running"
                ? "executing"
                : run.status,
    assistantStatus: run.status,
    steps: run.runtimeSteps,
    hasPendingActions: (pendingActionCount ?? 0) > 0,
  });

  const handleRetry = async () => {
    if (!run.canRetry || !onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry(run);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border shadow-xs",
        STATUS_TONE[run.status],
        className,
      )}
      data-testid="runtime-v2-workbench"
      data-status={run.status}
      data-runtime-version="v2"
    >
      {/* 1. 顶部：目标与状态 */}
      <div className="flex items-start gap-3 px-3 py-3 sm:px-3.5">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-black/5 bg-white/70">
          <Icon size={16} className={cn(spinning && "animate-spin")} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-semibold tracking-tight">
              {assistantStatusLabel(run.status)}
            </span>
            <span className="rounded-md bg-white/60 px-1.5 py-0.5 text-[11px] font-medium text-[#4a524e]">
              销售跟进
            </span>
          </div>
          {run.objective ? (
            <p className="mt-1 text-[12px] leading-5 text-[#3d4541]">
              {run.objective}
            </p>
          ) : run.planSummary ? (
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[#3d4541]">
              {run.planSummary}
            </p>
          ) : null}
          {summary ? (
            <p
              className="mt-1 text-[12px] leading-5 text-[#4a524e]"
              data-testid="assistant-task-summary"
            >
              {summary}
            </p>
          ) : null}
        </div>
      </div>

      {/* 2. 分析结果 */}
      {customers.length > 0 ? (
        <div
          className="border-t border-black/[0.06] bg-white/45 px-3 py-2.5 sm:px-3.5"
          data-testid="runtime-v2-analysis"
        >
          <p className="text-[11px] font-medium text-[#68706c]">分析结果</p>
          <p className="mt-1 text-[12px] text-[#4a524e]">
            {typeof analyzedOpportunityCount === "number"
              ? `已分析 ${analyzedOpportunityCount} 个商机，`
              : null}
            选出 {customers.length} 个优先客户
          </p>
          <ul className="mt-2 space-y-2">
            {customers.map((c) => (
              <li key={c.customerName} className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold text-[#171a19]">
                    {c.customerName}
                  </span>
                  <span className="text-[12px] font-medium text-[#2b6055]">
                    {c.score} 分
                  </span>
                </div>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[12px] leading-5 text-[#4a524e]">
                  {topReasons(c.reasons, 3).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {c.evidenceRefs.length > 0 ? (
                  <p className="mt-0.5 text-[10px] text-[#9aa19e]">
                    依据：{simplifyEvidenceRefs(c.evidenceRefs).join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 3. Inline Approval */}
      {approvalSlot ? (
        <div className="border-t border-black/[0.06] bg-white/30 px-2 py-2 sm:px-2.5">
          {approvalSlot}
        </div>
      ) : run.status === "waiting_for_confirmation" ? (
        <div
          className="border-t border-amber-200/80 bg-amber-50/80 px-3 py-2.5 text-[12px] text-amber-950 sm:px-3.5"
          data-testid="inline-approval-missing"
        >
          正在同步待确认动作…若长时间无按钮，请刷新本页（不要只依赖右上角「待我确认」）。
        </div>
      ) : null}

      {/* 4–5. 简化进度 + 可展开技术步骤 */}
      <div className="border-t border-black/[0.06] bg-white/40 px-3 py-2.5 sm:px-3.5">
        <p className="mb-2 text-[11px] font-medium text-[#68706c]">进度</p>
        <ol className="space-y-1.5" data-testid="runtime-v2-user-progress">
          {progress.stages.map((s) => (
            <li
              key={s.id}
              className={cn(
                "flex items-center gap-2 text-[12px]",
                s.active && "font-semibold text-[#171a19]",
                s.done && !s.active && "text-[#68706c]",
                !s.done && !s.active && "text-[#9aa19e]",
              )}
              data-active={s.active ? "true" : "false"}
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  s.active && "bg-[#2b6055]",
                  s.done && !s.active && "bg-[#2b6055]/40",
                  !s.done && !s.active && "bg-[#c5cac7]",
                )}
              />
              {USER_PROGRESS_LABEL[s.id]}
            </li>
          ))}
        </ol>

        {preferRuntimeV2Steps(run) ? (
          <>
            <button
              type="button"
              className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-medium text-[#2b6055]"
              onClick={() => setShowAllSteps((v) => !v)}
              data-testid="toggle-all-steps"
            >
              <ListTodo size={12} />
              {showAllSteps
                ? "收起技术步骤"
                : `查看全部 ${run.runtimeSteps!.length} 个步骤`}
              {showAllSteps ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {showAllSteps ? (
              <ol
                className="mt-2 space-y-1.5 border-t border-black/[0.05] pt-2"
                data-testid="runtime-v2-steps"
              >
                {run.runtimeSteps!.map((step, i) => {
                  const tool = step.preferredTool ?? step.toolName;
                  return (
                    <li
                      key={`${step.stepKey ?? i}-${step.title}`}
                      className="text-[12px] leading-5 text-[#3d4541]"
                      data-step-status={step.status}
                    >
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1">
                          {i + 1}. {step.title}
                          {tool ? (
                            <span className="text-[#68706c]"> · {tool}</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-[11px] text-[#68706c]">
                          {runtimeV2StepStatusLabel(step.status)}
                        </span>
                      </div>
                      {step.errorMessage ? (
                        <p className="mt-0.5 pl-4 text-[11px] text-[#a63d3d]">
                          {step.errorMessage}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </>
        ) : null}
      </div>

      {/* 6. Verifier */}
      {run.verificationLabel ? (
        <div
          className="border-t border-black/[0.06] bg-white/50 px-3 py-2 text-[12px] leading-5 text-[#3d4541] sm:px-3.5"
          data-testid="runtime-v2-verifier"
        >
          <span className="font-medium text-[#68706c]">验证结果 · </span>
          {run.verificationLabel}
        </div>
      ) : null}

      {run.status === "failed" ? (
        <div className="border-t border-black/[0.06] bg-white/50 px-3 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] sm:px-3.5">
          {run.canRetry && onRetry ? (
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={retrying}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#2b6055]/25 bg-white px-3 text-[13px] font-medium text-[#2b6055] disabled:opacity-60"
            >
              {retrying ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {retrying ? "重试中…" : "重试"}
            </button>
          ) : (
            <p className="text-center text-[12px] text-[#68706c]">
              请重新发送消息以生成新操作
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
