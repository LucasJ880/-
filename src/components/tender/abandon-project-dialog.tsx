"use client";

import { useState } from "react";
import { Loader2, AlertTriangle, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

const STAGE_LABELS: Record<string, string> = {
  initiation: "立项",
  distribution: "项目分发",
  interpretation: "项目解读",
  supplier_inquiry: "供应商询价",
  supplier_quote: "供应商报价",
  submission: "项目提交",
};

interface AbandonProjectDialogProps {
  projectId: string;
  projectName: string;
  currentStage: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function AbandonProjectDialog({
  projectId,
  projectName,
  currentStage,
  onClose,
  onSuccess,
}: AbandonProjectDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");

    try {
      const res = await apiFetch(`/api/projects/${projectId}/abandon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as Record<string, string>).error || "操作失败");
        return;
      }

      onSuccess();
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[#1a2420]/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-md mx-4 rounded-2xl border border-[rgba(166,61,61,0.15)] bg-[#faf8f4] shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[rgba(26,36,32,0.08)] px-6 py-4">
          <div className="rounded-lg bg-[rgba(166,61,61,0.08)] p-2">
            <AlertTriangle className="h-5 w-5 text-[#a63d3d]" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-[#1a2420]">放弃项目</h2>
            <p className="text-xs text-[#6e7d76] mt-0.5">此操作将终止项目进展</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#6e7d76] hover:bg-[rgba(26,36,32,0.06)] hover:text-[#1a2420] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div className="rounded-lg border border-[rgba(166,61,61,0.12)] bg-[rgba(166,61,61,0.04)] px-4 py-3">
            <p className="text-sm text-[#1a2420]">
              确定要放弃项目 <strong>「{projectName}」</strong> 吗？
            </p>
            <p className="text-xs text-[#6e7d76] mt-1">
              当前阶段：<span className="font-medium text-[#a63d3d]">{STAGE_LABELS[currentStage] ?? currentStage}</span>
            </p>
            <p className="text-xs text-[#6e7d76] mt-0.5">
              放弃后项目状态将标记为已放弃，此记录将被保留以便后续统计分析。
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-[#1a2420]">
              放弃原因
              <span className="text-xs font-normal text-[#93A39F] ml-1">（可选）</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：客户取消招标、不符合资质要求、价格无竞争力…"
              rows={3}
              className="w-full rounded-lg border border-[rgba(26,36,32,0.15)] bg-white px-3 py-2.5 text-sm text-[#1a2420] placeholder:text-[#B8C4C0] shadow-sm outline-none focus:border-[#a63d3d] focus:ring-2 focus:ring-[#a63d3d]/15 transition-colors resize-none"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.06)] px-3 py-2.5 text-sm font-medium text-[#a63d3d]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[rgba(26,36,32,0.08)] bg-[#f2f0eb]/60 px-6 py-4 rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-[rgba(26,36,32,0.12)] bg-white px-4 py-2 text-sm font-medium text-[#1a2420] shadow-sm hover:bg-[#f2f0eb] transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#a63d3d] px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#8c3333] transition-colors disabled:opacity-40"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            确认放弃
          </button>
        </div>
      </div>
    </div>
  );
}
