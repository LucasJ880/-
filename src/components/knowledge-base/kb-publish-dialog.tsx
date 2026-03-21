"use client";

import { useState } from "react";
import { Loader2, Rocket, X } from "lucide-react";

interface KbPublishDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (remark: string) => Promise<void>;
  kbName: string;
  kbKey: string;
  versionNumber: number | null;
  documentCount: number;
  targetEnv: string;
}

export function KbPublishDialog({
  open,
  onClose,
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

  if (!open) return null;

  async function handleConfirm() {
    setLoading(true);
    setError("");
    try {
      await onConfirm(remark.trim());
      setRemark("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发布失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border border-border bg-card-bg p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold">
            <Rocket size={18} className="text-accent" />
            知识库发布确认
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-background"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-3 rounded-lg border border-border bg-background p-3 text-sm">
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

        <p className="mt-3 text-xs text-muted">
          发布将把当前 test 知识库快照（含全部活跃文档）同步到 {targetEnv} 环境
        </p>

        <div className="mt-4">
          <label className="text-xs text-muted">发布备注（可选）</label>
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="说明本次发布的原因..."
          />
        </div>

        {error && <p className="mt-2 text-sm text-[#a63d3d]">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-background"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || versionNumber == null}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
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
          </button>
        </div>
      </div>
    </div>
  );
}
