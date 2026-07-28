"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarPlus, Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function QuoteSentNextSteps({
  open,
  onOpenChange,
  customerId,
  opportunityId,
  quoteUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string | null;
  opportunityId: string | null;
  quoteUrl: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const [followupDone, setFollowupDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const createFollowup = async () => {
    if (!opportunityId) {
      setError("当前报价未关联商机，请到客户详情设置跟进");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const at = new Date();
      at.setDate(at.getDate() + 2);
      at.setHours(10, 0, 0, 0);
      const res = await apiFetch(`/api/sales/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextFollowupAt: at.toISOString() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || "创建跟进失败",
        );
      }
      setFollowupDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建跟进失败");
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    if (!quoteUrl) return;
    try {
      await navigator.clipboard.writeText(quoteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动复制链接");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>报价已发送</DialogTitle>
          <DialogDescription>
            选择下一步，继续推进成交。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 pt-1">
          <button
            type="button"
            disabled={creating || followupDone || !opportunityId}
            onClick={createFollowup}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-left text-[13px] hover:bg-[var(--muted)]/10 disabled:opacity-50"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : followupDone ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <CalendarPlus className="h-4 w-4 text-[var(--accent)]" />
            )}
            {followupDone ? "已创建两天后跟进" : "创建两天后跟进"}
          </button>

          {customerId && (
            <Link
              href={`/sales/customers/${customerId}`}
              onClick={() => onOpenChange(false)}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-[13px] hover:bg-[var(--muted)]/10"
            >
              <ExternalLink className="h-4 w-4 text-[var(--accent)]" />
              返回客户详情
            </Link>
          )}

          <button
            type="button"
            disabled={!quoteUrl}
            onClick={copyLink}
            className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2.5 text-left text-[13px] hover:bg-[var(--muted)]/10 disabled:opacity-50"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Copy className="h-4 w-4 text-[var(--accent)]" />
            )}
            {copied ? "链接已复制" : "复制分享链接"}
          </button>

          {error && (
            <p className="text-[12px] text-red-600">{error}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
