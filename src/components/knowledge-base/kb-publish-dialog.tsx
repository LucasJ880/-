"use client";

import { useState } from "react";
import { Loader2, Rocket } from "lucide-react";
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

interface KbPublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (remark: string) => Promise<void>;
  kbName: string;
  kbKey: string;
  versionNumber: number | null;
  documentCount: number;
  targetEnv: string;
}

export function KbPublishDialog({
  open,
  onOpenChange,
  onConfirm,
  kbName,
  kbKey,
  versionNumber,
  documentCount,
  targetEnv,
}: KbPublishDialogProps) {
  const [remark, setRemark] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    setLoading(true);
    setError("");
    try {
      await onConfirm(remark.trim());
      setRemark("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md [&>button:last-child]:hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket size={18} className="text-accent" />
            知识库发布确认
          </DialogTitle>
          <DialogDescription className="text-xs">
            发布将把当前 test 知识库快照（含全部活跃文档）同步到 {targetEnv} 环境
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-lg border border-border bg-background p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">知识库</span>
            <span className="font-medium">{kbName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Key</span>
            <code className="rounded bg-card-bg px-1.5 text-xs">{kbKey}</code>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">当前 KB 版本</span>
            <span className="font-medium">
              {versionNumber != null ? `v${versionNumber}` : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">文档数量</span>
            <span className="font-medium">{documentCount} 篇</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">目标环境</span>
            <span className="rounded bg-[rgba(46,122,86,0.08)] px-2 py-0.5 text-xs font-medium text-[#2e7a56]">
              {targetEnv}
            </span>
          </div>
        </div>

        <div>
          <Label htmlFor="kb-publish-remark" className="text-xs text-muted">
            发布备注（可选）
          </Label>
          <textarea
            id="kb-publish-remark"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="说明本次发布的原因..."
          />
        </div>

        {error && <p className="text-sm text-[#a63d3d]">{error}</p>}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="accent"
            onClick={handleConfirm}
            disabled={loading || versionNumber == null}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                发布中...
              </>
            ) : (
              <>
                <Rocket size={14} />
                确认发布
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
