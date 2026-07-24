"use client";

import { Check, Eye, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { primaryConfirmLabel, stickyBarLabel } from "@/lib/assistant/inline-approval-model";

type Props = {
  pendingCount: number;
  selectedCount: number;
  busy?: boolean;
  onViewDetails: () => void;
  onReject: () => void;
  onConfirm: () => void;
  className?: string;
};

export function StickyApprovalBar({
  pendingCount,
  selectedCount,
  busy,
  onViewDetails,
  onReject,
  onConfirm,
  className,
}: Props) {
  if (pendingCount <= 0) return null;

  return (
    <div
      className={cn(
        // 置于消息区与输入框之间，滚动消息时始终可见且不遮挡输入
        "z-20 shrink-0 border-t border-amber-200/90 bg-amber-50/95 px-3 py-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur-md supports-[backdrop-filter]:bg-amber-50/85",
        className,
      )}
      data-testid="sticky-approval-bar"
    >
      <div className="mx-auto flex w-full max-w-[920px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] font-semibold text-amber-950">
          {stickyBarLabel(pendingCount)}
        </p>
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={onViewDetails}
            disabled={busy}
            className="hidden min-h-12 items-center justify-center gap-1.5 rounded-lg border border-amber-300/80 bg-white px-3 text-[13px] font-medium text-amber-950 disabled:opacity-50 sm:inline-flex"
          >
            <Eye size={14} />
            查看详情
          </button>
          <button
            type="button"
            data-testid="sticky-reject"
            onClick={onReject}
            disabled={busy || selectedCount === 0}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 text-[13px] font-medium text-[#4a524e] disabled:opacity-50 sm:flex-none sm:px-4"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
            拒绝
          </button>
          <button
            type="button"
            data-testid="sticky-confirm"
            onClick={onConfirm}
            disabled={busy || selectedCount === 0}
            className="inline-flex min-h-12 flex-[1.4] items-center justify-center gap-1.5 rounded-lg bg-[#2b6055] px-3 text-[13px] font-semibold text-white disabled:opacity-50 sm:flex-none sm:min-w-[9.5rem]"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            {busy ? "处理中…" : primaryConfirmLabel(selectedCount)}
          </button>
        </div>
      </div>
    </div>
  );
}
