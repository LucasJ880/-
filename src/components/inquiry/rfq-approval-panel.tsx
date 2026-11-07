"use client";

/**
 * W-1 询价发送卡 — 原地审批面板
 *
 * 能否批准取审批中心对同一张卡的判定（服务端算好的 approval.canApprove）；
 * 批准 / 驳回直接调审批中心既有接口，批准在请求内同步执行，响应里就是「已发出 N/N：…」。
 * 驳回后把这轮草稿标为已取消，免得留下一轮看似可手工发送的草稿。
 */

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, ChevronRight, Mail, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { notifyPendingActionsChanged } from "@/lib/hooks/use-pending-approvals-badge";
import { cn } from "@/lib/utils";
import type { RfqApprovalInfo, RfqEmailPreview } from "./rfq-web-entry-types";

type Props = {
  projectId: string;
  inquiryId: string;
  roundNumber: number | null;
  approval: RfqApprovalInfo | null;
  emails: RfqEmailPreview[];
  /** 批准（已发出）或驳回之后回调，父组件刷新轮次 */
  onDone: () => void;
  className?: string;
};

type Outcome = { kind: "sent" | "rejected" | "error"; text: string } | null;

export function RfqApprovalPanel({ projectId, inquiryId, roundNumber, approval, emails, onDone, className }: Props) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const canApprove = !!approval?.canApprove;
  const canReject = !!approval?.canReject;

  async function decide(action: "approve" | "reject") {
    if (!approval) return;
    setBusy(action);
    setOutcome(null);
    try {
      const res = await apiFetch(`/api/capabilities/approvals/${encodeURIComponent(approval.approvalId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: `${action}:${approval.approvalId}:${Date.now()}`,
          expectedPayloadHash: approval.payloadHash ?? undefined,
          note: action === "reject" ? "项目页驳回询价发送" : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      if (!data.ok) {
        setOutcome({ kind: "error", text: data.error || data.message || "没有成功，请稍后再试，或去审批中心处理。" });
        return;
      }
      if (action === "reject") {
        // 驳回后这一轮不会发出：把草稿轮次标为已取消（draft → canceled 是合法流转）
        await apiFetch(`/api/projects/${projectId}/inquiries/${inquiryId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "canceled" }),
        }).catch(() => undefined);
        setOutcome({ kind: "rejected", text: "已驳回，这一轮不会发出。需要的话重新「问供应商要价」。" });
      } else {
        setOutcome({ kind: "sent", text: data.message || "已批准并发出。" });
      }
      notifyPendingActionsChanged();
      onDone();
    } catch {
      setOutcome({ kind: "error", text: "网络出错了，请重试；不确定是否已发出时，先刷新看轮次状态再操作。" });
    } finally {
      setBusy(null);
      setConfirmReject(false);
    }
  }

  return (
    <div className={cn("space-y-3 rounded-lg border border-accent/25 bg-accent/[0.04] p-4", className)}>
      <div className="flex items-start gap-2">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {roundNumber ? `第 ${roundNumber} 轮询价` : "这轮询价"}等待批准，批准后立即从授权邮箱发出
          </p>
          <p className="mt-0.5 text-xs text-muted">共 {emails.length} 封，批准前不会发出任何邮件。点开可以看每家收到的正文。</p>
        </div>
      </div>

      {emails.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-md border border-border bg-background">
          {emails.map((e, i) => {
            const open = openIdx === i;
            return (
              <li key={`${e.to}-${i}`}>
                <button
                  type="button"
                  onClick={() => setOpenIdx(open ? null : i)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
                  aria-expanded={open}
                >
                  {open ? <ChevronDown size={12} className="text-muted" /> : <ChevronRight size={12} className="text-muted" />}
                  <Mail size={12} className="text-accent/70" />
                  <span className="font-medium text-foreground">{e.supplierName}</span>
                  <span className="truncate text-muted">{e.to}</span>
                </button>
                {open && (
                  <div className="border-t border-border/60 px-3 py-2">
                    <p className="text-xs font-medium text-foreground">{e.subject}</p>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-muted">
                      {e.body}
                    </pre>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {outcome ? (
        <p
          className={cn(
            "flex items-start gap-1.5 text-xs",
            outcome.kind === "error" ? "text-danger" : outcome.kind === "rejected" ? "text-muted" : "text-accent",
          )}
          role="status"
        >
          {outcome.kind === "sent" ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : outcome.kind === "error" ? <XCircle size={14} className="mt-px shrink-0" /> : null}
          {outcome.text}
        </p>
      ) : null}

      {canApprove ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="accent" loading={busy === "approve"} loadingText="正在发出…" disabled={busy !== null} onClick={() => decide("approve")}>
            批准并发送
          </Button>
          {canReject &&
            (confirmReject ? (
              <span className="inline-flex items-center gap-2 text-xs text-muted">
                确认驳回？这一轮会取消。
                <Button size="sm" variant="destructive" loading={busy === "reject"} disabled={busy !== null} onClick={() => decide("reject")}>
                  确认驳回
                </Button>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirmReject(false)}>
                  先不
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setConfirmReject(true)}>
                驳回
              </Button>
            ))}
        </div>
      ) : (
        <p className="text-xs text-muted">
          需要有审批权限的同事（组织管理员或项目负责人）批准。
          {approval ? (
            <>
              {" "}
              <Link href={approval.href} className="text-accent underline-offset-4 hover:underline">
                在审批中心查看这张卡
              </Link>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}
