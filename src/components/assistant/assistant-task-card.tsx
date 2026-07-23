"use client";

/**
 * Phase 3B-A Commit 4：助手任务七态卡片（移动端优先）
 * 展示 received → … → completed/failed/cancelled；重试仅为骨架。
 */

import type { ComponentType } from "react";
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
import { useToast } from "@/components/ui/toast";
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
};

export interface AssistantTaskCardProps {
  run: AssistantRunStatusDto;
  /** 可选：已可见的步骤标题列表（工具时间线摘要） */
  stepTitles?: string[];
  className?: string;
  /** 重试骨架；未传则 toast 提示后续开放 */
  onRetry?: (run: AssistantRunStatusDto) => void;
}

export function AssistantTaskCard({
  run,
  stepTitles,
  className,
  onRetry,
}: AssistantTaskCardProps) {
  const { toast } = useToast();
  const Icon = STATUS_ICON[run.status];
  const spinning = run.status === "planning" || run.status === "running";
  const intentLabel =
    (run.intent && INTENT_LABEL[run.intent]) || run.intent || "助手任务";

  const handleRetry = () => {
    if (onRetry) {
      onRetry(run);
      return;
    }
    toast("场景恢复与重试将在后续版本开放", "info");
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
          {run.resultSummary && run.resultSummary !== "scenario_placeholder" ? (
            <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-[#4a524e]">
              {run.resultSummary}
            </p>
          ) : null}
          {run.errorCode ? (
            <p className="mt-1 text-[12px] font-medium text-[#a63d3d]">
              错误码：{run.errorCode}
            </p>
          ) : null}
        </div>
      </div>

      {stepTitles && stepTitles.length > 0 ? (
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
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#2b6055]/25 bg-white px-3 text-[13px] font-medium text-[#2b6055] transition-colors hover:bg-[#edf3f1] active:bg-[#e2ebe8]"
          >
            <RefreshCw size={14} />
            重试
          </button>
          <p className="mt-2 text-center text-[11px] text-[#8a918d]">
            重试能力骨架已就位；场景恢复将在后续版本接入。
          </p>
        </div>
      ) : null}
    </div>
  );
}
