"use client";

/**
 * Phase 3B-A：助手任务七态卡片（Commit 4 + Commit 6 收敛文案 / 安全重试）
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

const STEP_STATUS_LABEL: Record<string, string> = {
  pending: "待开始",
  ready: "就绪",
  running: "进行中",
  awaiting_approval: "等待确认",
  completed: "已完成",
  failed: "失败",
  blocked: "受阻",
  skipped: "已跳过",
};

export function assistantRunCardSummary(run: AssistantRunStatusDto): string | null {
  if (run.resultSummary && !["scenario_placeholder", "no_actions"].includes(run.resultSummary)) {
    // 优先使用服务端用户文案
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
          </div>
          {run.currentStep?.title ? (
            <p className="mt-1 text-[12px] leading-5 text-[#4a524e]">
              当前步骤：{run.currentStep.title}
            </p>
          ) : null}
          {summary ? (
            <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-[#4a524e]">
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

      {run.planSummary ? (
        <div className="border-t border-black/[0.06] bg-white/35 px-3 py-2 sm:px-3.5">
          <p className="text-[11px] font-medium text-[#68706c]">当前计划</p>
          <p className="mt-0.5 line-clamp-3 text-[12px] leading-5 text-[#3d4541]">
            {run.planSummary}
          </p>
        </div>
      ) : null}

      {run.runtimeSteps && run.runtimeSteps.length > 0 ? (
        <div className="border-t border-black/[0.06] bg-white/40 px-3 py-2.5 sm:px-3.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[#68706c]">
            <ListTodo size={12} />
            执行步骤
          </div>
          <ol className="space-y-1">
            {run.runtimeSteps.slice(0, 8).map((step, i) => (
              <li
                key={`${i}-${step.title}`}
                className="flex items-start gap-2 text-[12px] leading-5 text-[#3d4541]"
              >
                <span className="min-w-0 flex-1 truncate">
                  {i + 1}. {step.title}
                  {step.toolName ? (
                    <span className="text-[#68706c]"> · {step.toolName}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[11px] text-[#68706c]">
                  {STEP_STATUS_LABEL[step.status] ?? step.status}
                </span>
              </li>
            ))}
          </ol>
          {run.verificationLabel ? (
            <p className="mt-2 text-[11px] leading-4 text-[#4a524e]">
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

      {run.status === "waiting_for_confirmation" ? (
        <div className="border-t border-amber-200/80 bg-amber-50/80 px-3 py-2.5 text-[12px] leading-5 text-amber-950 sm:px-3.5">
          需要你确认后才会写入。请在下方确认卡中操作。
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
