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

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (remark: string) => Promise<void>;
  promptName: string;
  promptKey: string;
  versionNumber: number | null;
  targetEnv: string;
}

export function PromptPublishDialog({
  open,
  onOpenChange,
  onConfirm,
  promptName,
  promptKey,
  versionNumber,
  targetEnv,
}: PublishDialogProps) {
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
      <DialogContent
        className="max-w-md [&>button]:hidden"
        onInteractOutside={(e) => {
          if (loading) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (loading) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Rocket size={18} className="text-accent" />
            发布确认
          </DialogTitle>
          <DialogDescription>
            请确认以下 Prompt 信息与目标环境后再发布。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-lg border border-border bg-background p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Prompt</span>
            <span className="font-medium text-foreground">{promptName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Key</span>
            <code className="rounded bg-card-bg px-1.5 text-xs">{promptKey}</code>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">发布版本</span>
            <span className="font-medium text-foreground">
              {versionNumber != null ? `v${versionNumber}` : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">目标环境</span>
            <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
              {targetEnv}
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="prompt-publish-remark" className="text-xs text-muted">
            发布备注（可选）
          </Label>
          <textarea
            id="prompt-publish-remark"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            placeholder="说明本次发布的原因..."
          />
        </div>

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        <DialogFooter className="gap-2 sm:space-x-0">
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
