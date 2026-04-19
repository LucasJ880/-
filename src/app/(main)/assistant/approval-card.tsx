"use client";

/**
 * PR4 — AI 待审批草稿的审批卡片
 *
 * 消息下方渲染。点"确认"调 POST /api/ai/pending-actions/:id { decision: "approve" }，
 * 点"取消"调 { decision: "reject" }。
 */

import { useState } from "react";
import { Check, X, Loader2, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { notifyPendingActionsChanged } from "@/lib/hooks/use-pending-approvals-badge";

export interface PendingApproval {
  actionId: string;
  draftType: string;
  title: string;
  preview: string;
  status: "pending" | "executed" | "rejected" | "failed" | "expired";
  failureReason?: string;
}

const DRAFT_TYPE_LABELS: Record<string, string> = {
  "sales.update_followup": "更新跟进时间",
  "sales.update_stage": "推进商机阶段",
  "calendar.create_event": "创建日历事件",
};

interface Props {
  approval: PendingApproval;
  onChange: (next: PendingApproval) => void;
}

export function ApprovalCard({ approval, onChange }: Props) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const typeLabel = DRAFT_TYPE_LABELS[approval.draftType] ?? approval.draftType;

  const handle = async (decision: "approve" | "reject") => {
    if (busy) return;
    setBusy(decision);
    try {
      const res = await apiFetch(`/api/ai/pending-actions/${approval.actionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        onChange({
          ...approval,
          status: "failed",
          failureReason: data.error ?? "操作失败",
        });
        return;
      }
      onChange({
        ...approval,
        status: decision === "approve" ? "executed" : "rejected",
      });
    } catch (err) {
      onChange({
        ...approval,
        status: "failed",
        failureReason: err instanceof Error ? err.message : "网络错误",
      });
    } finally {
      setBusy(null);
      // 不论结果如何，这条草稿都离开了 pending 池，通知全局徽章刷新
      notifyPendingActionsChanged();
    }
  };

  // 已终态
  if (approval.status === "executed") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
        <CheckCircle2 size={14} />
        <span className="font-medium">已执行</span>
        <span className="text-green-600/80">{approval.title}</span>
      </div>
    );
  }

  if (approval.status === "rejected") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-foreground/5 px-3 py-2 text-xs text-muted">
        <X size={14} />
        <span>已取消：{approval.title}</span>
      </div>
    );
  }

  if (approval.status === "failed") {
    return (
      <div className="rounded-xl border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.05)] px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#a63d3d]">
          <AlertCircle size={13} />
          执行失败
        </div>
        <div className="text-xs text-[#a63d3d]/80">
          {approval.failureReason ?? "未知错误"}
        </div>
      </div>
    );
  }

  if (approval.status === "expired") {
    return (
      <div className="rounded-xl border border-border bg-foreground/5 px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
          <Clock size={13} />
          已过期，未执行
        </div>
        <div className="text-xs text-muted/80">{approval.title}</div>
      </div>
    );
  }

  // pending
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 px-3.5 py-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          待确认 · {typeLabel}
        </span>
      </div>
      <div className="mb-1 text-sm font-semibold text-foreground">
        {approval.title}
      </div>
      <div className="mb-3 text-xs leading-relaxed text-muted">
        {approval.preview}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => handle("approve")}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {busy === "approve" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Check size={12} />
          )}
          确认执行
        </button>
        <button
          onClick={() => handle("reject")}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card-bg px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          {busy === "reject" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <X size={12} />
          )}
          取消
        </button>
      </div>
    </div>
  );
}
