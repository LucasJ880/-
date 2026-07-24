"use client";

/**
 * Phase 3B-A：助手任务七态卡片（Commit 4 + Commit 6 收敛文案 / 安全重试）
 * Runtime V2：展示 AgentRunStep / 优先客户 / 动作计数（不混用 Legacy AgentTask）
 */

import { useState, type ComponentType } from "react";
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  AlertCircle,
  Ban,
  ShieldCheck,
  RefreshCw,
  ListTodo,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  assistantStatusLabel,
  type AssistantRunStatusDto,
  type AssistantTaskStatus,
} from "@/lib/assistant/run-status-types";
import {
  formatRuntimeV2ActionCounts,
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
  waiting_for_confirmation:
    "border-amber-300/80 bg-amber-50 text-amber-950",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-[rgba(166,61,61,0.25)] bg-[#fff7f7] text-[#a63d3d]",
  cancelled: "border-black/10 bg-[#f3f4f3] text-[#68706c]",
};

const INTENT_LABEL: Record<string, string> = {
  daily_business_brief: "今日简报",
  customer_followup_task: "客户跟进",
  gmail_email_draft: "邮件草稿",
  unsupported_action: "能力边界",
  general_answer: "对话",
  assistant_dispatch: "助手任务",
  sales_followup_triage: "销售跟进处理",
};

export function assistantRunCardSummary(run: AssistantRunStatusDto): string | null {
  const isV2 = preferRuntimeV2Steps(run) || run.runtimeVersion === "v2";
  if (isV2) {
    const s = run.actionSummary;
    const awaitingSteps =
      run.awaitingApprovalStepCount ??
      (run.runtimeSteps?.filter((x) => x.status === "awaiting_approval").length ??
        0);
    if (s) {
      return formatRuntimeV2ActionCounts({
        awaitingApprovalSteps: awaitingSteps,
        pendingActions: s.pending + s.approved,
        executedActions: s.executed,
        rejectedActions: s.rejected,
        failedActions: s.failed,
      });
    }
    if (awaitingSteps > 0) {
      return formatRuntimeV2ActionCounts({
        awaitingApprovalSteps: awaitingSteps,
        pendingActions: run.pendingActionIds?.length ?? 0,
        executedActions: 0,
        rejectedActions: 0,
        failedActions: 0,
      });
    }
  }

  if (run.resultSummary && !["scenario_placeholder", "no_actions"].includes(run.resultSummary)) {
    if (
      /项|完成|取消|失败|过期|等待/.test(run.resultSummary) ||
      run.resultSummary.includes("任务已结束")
    ) {
      return run.resultSummary;
    }
  }
  const s = run.actionSummary;
  if (!s || s.total === 0) {
    if (run.status === "failed" && run.retryKind === "manual_review") {
      return "该动作可能已影响外部系统。请先检查后再重新生成操作。";
    }
    return run.resultSummary && run.resultSummary !== "scenario_placeholder"
      ? run.resultSummary
      : null;
  }
  if (run.status === "waiting_for_confirmation") {
    const open = s.pending + s.approved;
    return open === 1
      ? "还剩 1 项动作等待确认"
      : `还剩 ${open} 项动作等待确认`;
  }
  if (run.status === "completed" && run.partialCompletion) {
    return `${s.executed} 项已完成，${s.rejected} 项已取消`;
  }
  if (run.status === "completed") {
    return "所有确认动作已完成";
  }
  if (run.status === "cancelled") {
    return "所有待确认动作已取消";
  }
  if (run.status === "failed") {
    if (s.expired > 0 && s.executed === 0) {
      return "确认已过期，请重新生成操作。";
    }
    if (run.partialSideEffects) {
      return "部分动作已执行，另有动作失败。已完成的操作不会自动回滚。";
    }
    return "动作执行失败。";
  }
  return null;
}

export interface AssistantTaskCardProps {
  run: AssistantRunStatusDto;
  stepTitles?: string[];
  className?: string;
  onRetry?: (run: AssistantRunStatusDto) => void | Promise<void>;
}

export function AssistantTaskCard({
  run,
  stepTitles,
  className,
  onRetry,
}: AssistantTaskCardProps) {
  const [retrying, setRetrying] = useState(false);
  const Icon = STATUS_ICON[run.status];
  const spinning = run.status === "planning" || run.status === "running";
  const intentLabel =
    (run.intent && INTENT_LABEL[run.intent]) || run.intent || "助手任务";
  const summary = assistantRunCardSummary(run);
  const showV2Steps = preferRuntimeV2Steps(run);
  const prioritizeStepIndex =
    run.runtimeSteps?.findIndex(
      (s) =>
        s.stepKey === "s5_prioritize" ||
        s.title.includes("优先客户") ||
        s.title.includes("选出最多"),
    ) ?? -1;

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
      data-testid="assistant-task-card"
      data-status={run.status}
      data-runtime-version={run.runtimeVersion ?? "v1"}
      data-can-retry={run.canRetry ? "true" : "false"}
    >
      <div className="flex items-start gap-3 px-3 py-3 sm:px-3.5">
        <div
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-black/5 bg-white/70",
          )}
        >
          <Icon
            size={16}
            className={cn(spinning && "animate-spin")}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-semibold tracking-tight">
              {assistantStatusLabel(run.status)}
            </span>
            <span className="rounded-md bg-white/60 px-1.5 py-0.5 text-[11px] font-medium text-[#4a524e]">
              {intentLabel}
            </span>
            {run.runtimeVersion === "v2" ? (
              <span className="rounded-md bg-white/60 px-1.5 py-0.5 text-[11px] font-medium text-[#4a524e]">
                Runtime V2
              </span>
            ) : null}
          </div>
          {run.currentStep?.title && !showV2Steps ? (
            <p className="mt-1 text-[12px] leading-5 text-[#4a524e]">
              当前步骤：{run.currentStep.title}
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
          {run.errorCode && run.status === "failed" ? (
            <p className="mt-1 text-[12px] font-medium text-[#a63d3d]">
              错误码：{run.errorCode}
            </p>
          ) : null}
        </div>
      </div>

      {(run.objective || run.planSummary) && run.runtimeVersion === "v2" ? (
        <div className="border-t border-black/[0.06] bg-white/35 px-3 py-2 sm:px-3.5">
          {run.objective ? (
            <>
              <p className="text-[11px] font-medium text-[#68706c]">目标</p>
              <p className="mt-0.5 text-[12px] leading-5 text-[#3d4541]">
                {run.objective}
              </p>
            </>
          ) : null}
          {run.planSummary ? (
            <>
              <p
                className={cn(
                  "text-[11px] font-medium text-[#68706c]",
                  run.objective && "mt-2",
                )}
              >
                计划
              </p>
              <p className="mt-0.5 text-[12px] leading-5 text-[#3d4541]">
                {run.planSummary}
              </p>
            </>
          ) : null}
        </div>
      ) : run.planSummary ? (
        <div className="border-t border-black/[0.06] bg-white/35 px-3 py-2 sm:px-3.5">
          <p className="text-[11px] font-medium text-[#68706c]">当前计划</p>
          <p className="mt-0.5 line-clamp-3 text-[12px] leading-5 text-[#3d4541]">
            {run.planSummary}
          </p>
        </div>
      ) : null}

      {showV2Steps ? (
        <div className="border-t border-black/[0.06] bg-white/40 px-3 py-2.5 sm:px-3.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[#68706c]">
            <ListTodo size={12} />
            执行步骤（{run.runtimeSteps!.length}）
          </div>
          <ol className="space-y-2" data-testid="runtime-v2-steps">
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
                      <span className="font-medium">
                        {i + 1}. {step.title}
                      </span>
                      {tool ? (
                        <span className="text-[#68706c]"> · {tool}</span>
                      ) : null}
                      {typeof step.attemptCount === "number" &&
                      step.attemptCount > 0 ? (
                        <span className="text-[#68706c]">
                          {" "}
                          · 尝试 {step.attemptCount}
                        </span>
                      ) : null}
                      {step.requiresApproval ? (
                        <span className="text-[#68706c]"> · 需确认</span>
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
                  {i === prioritizeStepIndex &&
                  run.prioritizedCustomers &&
                  run.prioritizedCustomers.length > 0 ? (
                    <ul
                      className="mt-1.5 space-y-1.5 rounded-lg border border-black/[0.06] bg-white/70 px-2.5 py-2"
                      data-testid="runtime-v2-priority"
                    >
                      {run.prioritizedCustomers.map((c) => (
                        <li key={c.customerName} className="min-w-0">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-medium text-[#252927]">
                              {c.customerName}
                            </span>
                            <span className="text-[11px] text-[#68706c]">
                              评分 {c.score}
                            </span>
                          </div>
                          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[11px] text-[#4a524e]">
                            {topReasons(c.reasons, 3).map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                          </ul>
                          {c.evidenceRefs.length > 0 ? (
                            <p className="mt-0.5 text-[10px] text-[#9aa19e]">
                              证据：{c.evidenceRefs.slice(0, 4).join(" · ")}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {run.verificationLabel ? (
            <p
              className="mt-2 text-[11px] leading-4 text-[#4a524e]"
              data-testid="runtime-v2-verifier"
            >
              验证：{run.verificationLabel}
            </p>
          ) : null}
        </div>
      ) : stepTitles && stepTitles.length > 0 ? (
        <div className="border-t border-black/[0.06] bg-white/40 px-3 py-2.5 sm:px-3.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[#68706c]">
            <ListTodo size={12} />
            步骤
          </div>
          <ol className="space-y-1">
            {stepTitles.slice(0, 6).map((title, i) => (
              <li
                key={`${i}-${title}`}
                className="truncate text-[12px] leading-5 text-[#3d4541]"
              >
                {i + 1}. {title}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {run.status === "waiting_for_confirmation" && !showV2Steps ? (
        <div className="border-t border-amber-200/80 bg-amber-50/80 px-3 py-2.5 text-[12px] leading-5 text-amber-950 sm:px-3.5">
          需要你确认后才会写入。请在下方确认卡中操作。
        </div>
      ) : null}

      {run.status === "waiting_for_confirmation" && showV2Steps ? (
        <div className="border-t border-amber-200/80 bg-amber-50/80 px-3 py-2 text-[12px] leading-5 text-amber-950 sm:px-3.5">
          写操作待确认：请在下方审批卡中逐项确认或拒绝。
        </div>
      ) : null}

      {run.status === "failed" ? (
        <div className="border-t border-black/[0.06] bg-white/50 px-3 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))] sm:px-3.5 sm:pb-2.5">
          {run.canRetry && onRetry ? (
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={retrying}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#2b6055]/25 bg-white px-3 text-[13px] font-medium text-[#2b6055] transition-colors hover:bg-[#edf3f1] active:bg-[#e2ebe8] disabled:opacity-60"
            >
              {retrying ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {retrying ? "重试中…" : "重试"}
            </button>
          ) : (
            <p className="text-center text-[12px] leading-5 text-[#68706c]">
              {run.retryKind === "manual_review"
                ? "请检查后重新生成操作（不可自动重试）"
                : "请重新发送消息以生成新操作"}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
