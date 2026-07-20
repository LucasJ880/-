"use client";

import { useState } from "react";
import { FeedbackReasonDialog } from "./feedback-reason-dialog";

interface Props {
  open: boolean;
  aiOutput: unknown;
  onClose: () => void;
  onConfirm: (input: {
    edited: string;
    reasonCode?: string;
    reasonText?: string;
    feedbackScope: "personal_only" | "team_candidate" | "do_not_learn";
  }) => void | Promise<void>;
}

function toEditable(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v ?? "");
  }
}

export function EditDiffReview({ open, aiOutput, onClose, onConfirm }: Props) {
  const [edited, setEdited] = useState(() => toEditable(aiOutput));
  const [reasonOpen, setReasonOpen] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-xl border border-black/[0.08] bg-white p-4 shadow-lg">
        <h3 className="text-[15px] font-semibold text-[#171a19]">修改后使用</h3>
        <p className="mt-1 text-[12px] text-[#68706c]">
          左侧为 AI 原稿摘要；请在下方填写你最终使用的版本。系统只保存结构化差异与必要快照。
        </p>
        <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-[#f4f5f5] p-2 text-[11px] text-[#68706c]">
          {toEditable(aiOutput).slice(0, 800)}
        </pre>
        <textarea
          value={edited}
          onChange={(e) => setEdited(e.target.value)}
          className="mt-2 w-full rounded-md border border-black/[0.1] px-2 py-1.5 text-[13px]"
          rows={6}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-[#68706c] hover:bg-[#f4f5f5]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => setReasonOpen(true)}
            className="rounded-md bg-[#202422] px-3 py-1.5 text-[12px] font-medium text-white"
          >
            继续
          </button>
        </div>
      </div>

      <FeedbackReasonDialog
        open={reasonOpen}
        title="修改原因与学习范围"
        onClose={() => setReasonOpen(false)}
        onConfirm={async (r) => {
          setReasonOpen(false);
          await onConfirm({ edited, ...r });
        }}
      />
    </div>
  );
}
