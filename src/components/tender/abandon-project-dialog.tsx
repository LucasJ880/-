"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AbandonProjectDialog({
  projectId,
  projectName,
  currentStage,
  open,
  onOpenChange,
  onSuccess,
}: AbandonProjectDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError("");
    setSubmitting(false);
  }, [open]);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 border-border bg-card p-0 sm:max-w-md">
        <div className="border-b border-border px-6 pb-4 pt-2">
          <DialogHeader className="flex flex-row items-start gap-3 space-y-0 pr-8 text-left">
            <div className="shrink-0 rounded-lg bg-danger-light p-2">
              <AlertTriangle className="h-5 w-5 text-danger" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-bold text-foreground">放弃项目</DialogTitle>
              <DialogDescription className="mt-1.5 text-xs text-muted">
                此操作将终止项目进展
              </DialogDescription>
            </div>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="rounded-lg border border-danger/15 bg-danger-bg px-4 py-3">
            <p className="text-sm text-foreground">
              确定要放弃项目 <strong>「{projectName}」</strong> 吗？
            </p>
            <p className="mt-1 text-xs text-muted">
              当前阶段：
              <span className="font-medium text-danger">
                {STAGE_LABELS[currentStage] ?? currentStage}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted">
              放弃后项目状态将标记为已放弃，此记录将被保留以便后续统计分析。
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="abandon-reason" className="text-sm font-semibold text-foreground">
              放弃原因
              <span className="ml-1 text-xs font-normal text-muted">（可选）</span>
            </Label>
            <textarea
              id="abandon-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：客户取消招标、不符合资质要求、价格无竞争力…"
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted/60 focus-visible:border-danger focus-visible:ring-2 focus-visible:ring-danger/15"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-danger/20 bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-border bg-background/60 px-6 py-4 sm:rounded-b-2xl sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type="button" variant="destructive" disabled={submitting} onClick={handleSubmit}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            确认放弃
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
