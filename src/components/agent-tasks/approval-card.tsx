"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Check,
  X,
  SkipForward,
  Loader2,
  Timer,
  AlertOctagon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface Props {
  taskId: string;
  step: {
    id: string;
    title: string;
    riskLevel: string;
    agentName: string;
    outputSummary: string | null;
    deadlineAt?: string | null;
    approvalStatus?: string | null;
  };
  onAction: () => void;
}

export function ApprovalCard({ taskId, step, onAction }: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);

  const handleApprove = useCallback(async () => {
    setLoading("approve");
    try {
      await apiFetch(
        `/api/agent/tasks/${taskId}/steps/${step.id}/approve`,
        { method: "POST", body: JSON.stringify({}) }
      );
      onAction();
    } catch {
      // silent
    } finally {
      setLoading(null);
    }
  }, [taskId, step.id, onAction]);

  const handleReject = useCallback(async () => {
    setLoading("reject");
    try {
      await apiFetch(
        `/api/agent/tasks/${taskId}/steps/${step.id}/reject`,
        { method: "POST", body: JSON.stringify({ note: rejectNote }) }
      );
      onAction();
    } catch {
      // silent
    } finally {
      setLoading(null);
    }
  }, [taskId, step.id, rejectNote, onAction]);

  const isHigh = step.riskLevel === "high";
  const isEscalated = step.approvalStatus === "escalated";
  const countdown = useCountdown(step.deadlineAt ?? null);

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        isEscalated
          ? "border-red-600/40 bg-red-500/10"
          : isHigh
          ? "border-red-500/30 bg-red-500/5"
          : "border-amber-500/30 bg-amber-500/5"
      )}
    >
      {/* 标题 */}
      <div className="flex items-center gap-2 mb-2">
        {isEscalated ? (
          <AlertOctagon className="h-4 w-4 text-red-600" />
        ) : isHigh ? (
          <ShieldAlert className="h-4 w-4 text-red-500" />
        ) : (
          <ShieldCheck className="h-4 w-4 text-amber-500" />
        )}
        <span className="text-sm font-medium text-foreground">
          {isEscalated ? "⚠ 已超时升级：" : "待审批："}
          {step.title}
        </span>
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded",
            isEscalated
              ? "bg-red-600/15 text-red-700"
              : isHigh
              ? "bg-red-500/10 text-red-600"
              : "bg-amber-500/10 text-amber-600"
          )}
        >
          {isEscalated ? "已超时" : isHigh ? "高风险" : "中风险"}
        </span>
        {countdown && !isEscalated && (
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1 text-[10px] font-medium",
              countdown.urgent ? "text-red-600" : "text-muted-foreground"
            )}
          >
            <Timer size={10} />
            {countdown.label}
          </span>
        )}
      </div>

      {/* AI 说明 */}
      {step.outputSummary && (
        <div className="text-xs text-muted-foreground mb-3 leading-relaxed">
          {step.outputSummary}
        </div>
      )}

      {/* 驳回理由输入 */}
      {showReject && (
        <textarea
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder="请输入驳回原因（可选）"
          className="w-full h-16 rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-red-500 resize-none mb-2"
        />
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleApprove}
          disabled={!!loading}
          className="flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
        >
          {loading === "approve" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          确认执行
        </button>

        {!showReject ? (
          <button
            onClick={() => setShowReject(true)}
            disabled={!!loading}
            className="flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
          >
            <X className="h-3 w-3" />
            驳回
          </button>
        ) : (
          <button
            onClick={handleReject}
            disabled={!!loading}
            className="flex items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
          >
            {loading === "reject" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <X className="h-3 w-3" />
            )}
            确认驳回
          </button>
        )}

        <button
          onClick={() => { setShowReject(false); setRejectNote(""); }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
        >
          {showReject ? "取消" : ""}
        </button>
      </div>
    </div>
  );
}

function useCountdown(deadlineIso: string | null) {
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!deadlineIso) return;
    timerRef.current = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [deadlineIso]);

  if (!deadlineIso) return null;

  const deadline = new Date(deadlineIso).getTime();
  const diff = deadline - now;

  if (diff <= 0) return { label: "已超时", urgent: true };

  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return { label: `剩余 ${days} 天 ${hours % 24} 小时`, urgent: false };
  }

  if (hours > 0) {
    return { label: `剩余 ${hours} 小时 ${minutes} 分`, urgent: hours < 4 };
  }

  return { label: `剩余 ${minutes} 分钟`, urgent: true };
}
