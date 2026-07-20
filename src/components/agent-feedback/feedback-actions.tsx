"use client";

import { useState } from "react";
import { Check, Pencil, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { FeedbackReasonDialog } from "./feedback-reason-dialog";
import { EditDiffReview } from "./edit-diff-review";

export type FeedbackDecision = "accepted" | "edited" | "rejected" | "deferred";

export interface AgentFeedbackPayload {
  taskType: string;
  humanDecision: FeedbackDecision;
  aiOutputRef: Record<string, unknown>;
  aiOutputSnapshot?: unknown;
  humanEditedOutput?: unknown;
  reasonCode?: string;
  reasonText?: string;
  feedbackScope?: "personal_only" | "team_candidate" | "do_not_learn";
  agentRunId?: string;
  skillExecutionId?: string;
  pendingActionId?: string;
  skillSlug?: string;
  workerType?: string;
}

interface Props {
  taskType: string;
  aiOutputRef: Record<string, unknown>;
  aiOutputSnapshot?: unknown;
  agentRunId?: string;
  skillExecutionId?: string;
  pendingActionId?: string;
  skillSlug?: string;
  workerType?: string;
  disabled?: boolean;
  onSubmit: (payload: AgentFeedbackPayload) => Promise<void>;
  className?: string;
}

export function FeedbackActions({
  taskType,
  aiOutputRef,
  aiOutputSnapshot,
  agentRunId,
  skillExecutionId,
  pendingActionId,
  skillSlug,
  workerType,
  disabled,
  onSubmit,
  className,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const base = {
    taskType,
    aiOutputRef,
    aiOutputSnapshot,
    agentRunId,
    skillExecutionId,
    pendingActionId,
    skillSlug,
    workerType,
  };

  const run = async (payload: AgentFeedbackPayload) => {
    setBusy(true);
    try {
      await onSubmit(payload);
      setDone(payload.humanDecision);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const label: Record<string, string> = {
      accepted: "已接受",
      edited: "已记录修改",
      rejected: "已拒绝",
      deferred: "稍后处理",
    };
    return (
      <div className={cn("text-[12px] text-[#68706c]", className)}>
        反馈已保存：{label[done] || done}（默认仅用于个人学习）
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="mr-1 text-[11px] font-medium text-[#68706c]">对建议</span>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() =>
          run({ ...base, humanDecision: "accepted", feedbackScope: "personal_only" })
        }
        className="inline-flex min-h-7 items-center gap-1 rounded-md border border-emerald-700/20 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
      >
        <Check size={12} /> 接受
      </button>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setEditOpen(true)}
        className="inline-flex min-h-7 items-center gap-1 rounded-md border border-black/[0.08] bg-[#f4f5f5] px-2.5 py-1 text-[11px] font-medium text-[#202422] hover:bg-[#e9ebea] disabled:opacity-50"
      >
        <Pencil size={12} /> 修改后使用
      </button>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setRejectOpen(true)}
        className="inline-flex min-h-7 items-center gap-1 rounded-md border border-red-700/20 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-900 hover:bg-red-100 disabled:opacity-50"
      >
        <X size={12} /> 拒绝
      </button>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() =>
          run({ ...base, humanDecision: "deferred", feedbackScope: "personal_only" })
        }
        className="inline-flex min-h-7 items-center gap-1 rounded-md border border-black/[0.08] px-2.5 py-1 text-[11px] font-medium text-[#68706c] hover:bg-[#f4f5f5] disabled:opacity-50"
      >
        <Clock size={12} /> 稍后
      </button>

      <FeedbackReasonDialog
        open={rejectOpen}
        title="拒绝原因"
        requireReason
        onClose={() => setRejectOpen(false)}
        onConfirm={async ({ reasonCode, reasonText, feedbackScope }) => {
          setRejectOpen(false);
          await run({
            ...base,
            humanDecision: "rejected",
            reasonCode,
            reasonText,
            feedbackScope,
          });
        }}
      />

      <EditDiffReview
        open={editOpen}
        aiOutput={aiOutputSnapshot ?? aiOutputRef}
        onClose={() => setEditOpen(false)}
        onConfirm={async ({ edited, reasonCode, reasonText, feedbackScope }) => {
          setEditOpen(false);
          await run({
            ...base,
            humanDecision: "edited",
            humanEditedOutput: edited,
            reasonCode,
            reasonText,
            feedbackScope,
          });
        }}
      />
    </div>
  );
}
