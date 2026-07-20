"use client";

import { useState } from "react";

const REASONS: Array<{ code: string; label: string }> = [
  { code: "wrong_priority", label: "优先级不对" },
  { code: "missing_context", label: "缺少上下文" },
  { code: "incorrect_fact", label: "事实有误" },
  { code: "tone_too_formal", label: "语气太正式" },
  { code: "tone_too_casual", label: "语气太随意" },
  { code: "too_long", label: "太长" },
  { code: "too_short", label: "太短" },
  { code: "wrong_channel", label: "渠道不对" },
  { code: "wrong_timing", label: "时机不对" },
  { code: "compliance_risk", label: "合规风险" },
  { code: "customer_relationship_context", label: "客户关系背景" },
  { code: "business_judgment", label: "业务判断" },
  { code: "duplicate_action", label: "重复动作" },
  { code: "other", label: "其他" },
];

interface Props {
  open: boolean;
  title: string;
  requireReason?: boolean;
  onClose: () => void;
  onConfirm: (input: {
    reasonCode?: string;
    reasonText?: string;
    feedbackScope: "personal_only" | "team_candidate" | "do_not_learn";
  }) => void | Promise<void>;
}

export function FeedbackReasonDialog({
  open,
  title,
  requireReason,
  onClose,
  onConfirm,
}: Props) {
  const [reasonCode, setReasonCode] = useState("business_judgment");
  const [reasonText, setReasonText] = useState("");
  const [scope, setScope] = useState<
    "personal_only" | "team_candidate" | "do_not_learn"
  >("personal_only");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-black/[0.08] bg-white p-4 shadow-lg">
        <h3 className="text-[15px] font-semibold text-[#171a19]">{title}</h3>
        <p className="mt-1 text-[12px] text-[#68706c]">
          默认只用于你的个人偏好学习；可选授权为部门经验候选，或标记不用于学习。
        </p>

        <label className="mt-3 block text-[11px] font-medium text-[#68706c]">
          原因
        </label>
        <select
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          className="mt-1 w-full rounded-md border border-black/[0.1] px-2 py-1.5 text-[13px]"
        >
          {REASONS.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </select>

        <textarea
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          placeholder="可选补充（简短即可）"
          className="mt-2 w-full rounded-md border border-black/[0.1] px-2 py-1.5 text-[13px]"
          rows={2}
        />

        <label className="mt-3 block text-[11px] font-medium text-[#68706c]">
          学习范围
        </label>
        <div className="mt-1 space-y-1.5 text-[12px] text-[#202422]">
          {(
            [
              ["personal_only", "仅个人偏好（默认）"],
              ["team_candidate", "可作为部门经验候选"],
              ["do_not_learn", "不用于学习"],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="flex items-center gap-2">
              <input
                type="radio"
                name="scope"
                checked={scope === v}
                onChange={() => setScope(v)}
              />
              {label}
            </label>
          ))}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[12px] text-[#68706c] hover:bg-[#f4f5f5]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              if (requireReason && !reasonCode) return;
              void onConfirm({
                reasonCode,
                reasonText: reasonText.trim() || undefined,
                feedbackScope: scope,
              });
            }}
            className="rounded-md bg-[#202422] px-3 py-1.5 text-[12px] font-medium text-white"
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
