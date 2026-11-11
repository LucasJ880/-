"use client";

/**
 * W-1 询价发送卡 — 原地审批面板
 *
 * 能否批准取审批中心对同一张卡的判定（服务端算好的 approval.canApprove）；
 * 批准 / 驳回直接调审批中心既有接口，批准在请求内同步执行，响应里就是「已发出 N/N：…」。
 * 驳回后把这轮草稿标为已取消，免得留下一轮看似可手工发送的草稿。
 *
 * T-1：variant="chase" 用于催单 / 缺字段追问卡（每张一封，design D13）——文案换成催单的；
 * 驳回只让这一封不发出，**不**把轮次标为已取消；结果带 source="chase"。
 */

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, ChevronRight, Mail, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-fetch";
import { notifyPendingActionsChanged } from "@/lib/hooks/use-pending-approvals-badge";
import {
  approvalStatusNote,
  chaseErrorText,
  chaseOutcomeFromMessage,
  chasePanelCopy,
  friendlyExecutionError,
  type ChaseCardKind,
} from "@/lib/tender-rfq/web-entry-pure";
import { cn } from "@/lib/utils";
import type { RfqApprovalInfo, RfqEmailPreview, RfqFollowUpCardView } from "./rfq-web-entry-types";

/** sent = 全部发出；partial = 部分发出（有失败）；skipped = 批准了但不需要发（催单：这家已回复等）；error = 一封都没发出或决策失败 */
export type RfqDecisionOutcome = { kind: "sent" | "partial" | "skipped" | "rejected" | "error"; text: string; source?: "rfq" | "chase" };

type Props = {
  projectId: string;
  inquiryId: string;
  roundNumber: number | null;
  approval: RfqApprovalInfo | null;
  emails: RfqEmailPreview[];
  /** 每次决策之后回调（成功、驳回、失败都会调），父组件刷新轮次并保留结果文字——本面板随后可能被卸载 */
  onDone: (outcome: RfqDecisionOutcome) => void;
  className?: string;
  /** rfq = 询价发送卡（默认）；chase = 催单 / 追问卡 */
  variant?: "rfq" | "chase";
  /** variant="chase" 时必填 */
  chase?: { kind: ChaseCardKind; chaseIndex: number; supplierName: string };
  /** RFQ-AUTO-1：这张发询价卡带的跟进授权——批准它即一并批准这些后续邮件，所以必须在这里让人看到 */
  followUp?: RfqFollowUpCardView | null;
  /** 跟进授权的功能现在是关的：授权照样显示，但注明关闭期间不会自动发、重新打开后恢复生效 */
  followUpSuspended?: boolean;
};

type Outcome = RfqDecisionOutcome | null;

const NETWORK_ERROR = "网络出错了，请重试；不确定是否已发出时，先刷新看轮次状态再操作。";

export function RfqApprovalPanel({ projectId, inquiryId, roundNumber, approval, emails, onDone, className, variant = "rfq", chase, followUp, followUpSuspended }: Props) {
  const isChase = variant === "chase" && !!chase;
  const source: RfqDecisionOutcome["source"] = isChase ? "chase" : "rfq";
  const chaseCopy = isChase ? chasePanelCopy({ ...chase, roundNumber }) : null;
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [openTemplate, setOpenTemplate] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  // 有了决策结果就不再给按钮：批准执行失败时执行器已把卡作废，再点只会得到「当前状态不支持」
  const decided = outcome !== null && outcome.text !== NETWORK_ERROR;
  const statusNote = approval ? approvalStatusNote(approval.status) : null;
  const canApprove = !!approval?.canApprove && !decided && !statusNote;
  const canReject = !!approval?.canReject && !decided && !statusNote;

  async function decide(action: "approve" | "reject") {
    if (!approval) return;
    setBusy(action);
    setOutcome(null);
    try {
      // 显式带卡所属企业：apiFetch 默认带的是组织切换器里选的企业，跨企业看项目时会找不到这张卡
      const res = await apiFetch(`/api/capabilities/approvals/${encodeURIComponent(approval.approvalId)}/${action}?orgId=${encodeURIComponent(approval.orgId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: `${action}:${approval.approvalId}:${Date.now()}`,
          expectedPayloadHash: approval.payloadHash ?? undefined,
          note: action === "reject" ? (chaseCopy ? chaseCopy.rejectNote : "项目页驳回询价发送") : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      if (!data.ok) {
        // 执行失败时执行器会把卡标为 failed（卡作废）；刷新让父组件拿到新状态，文字由父组件保留
        const failed: RfqDecisionOutcome = {
          kind: "error",
          source,
          text:
            action === "approve"
              ? friendlyExecutionError(isChase ? chaseErrorText(data.error || data.message || "") : data.error || data.message || "")
              : data.error || data.message || "驳回没有成功，请去审批中心处理。",
        };
        setOutcome(failed);
        notifyPendingActionsChanged();
        onDone(failed);
        return;
      }
      if (action === "reject") {
        // 询价发送卡被驳回 → 这一轮不会发出：把草稿轮次标为已取消（draft → canceled 是合法流转）。
        // 催单卡被驳回只是这一封不发，轮次照常（T-1）。
        if (!isChase) {
          await apiFetch(`/api/projects/${projectId}/inquiries/${inquiryId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "canceled" }),
          }).catch(() => undefined);
        }
        const done: RfqDecisionOutcome = {
          kind: "rejected",
          source,
          text: chaseCopy ? chaseCopy.rejected : "已驳回，这一轮不会发出。需要的话重新「问供应商要价」。",
        };
        setOutcome(done);
        notifyPendingActionsChanged();
        onDone(done);
      } else {
        let done: RfqDecisionOutcome;
        if (isChase) {
          const r = chaseOutcomeFromMessage(data.message);
          done = { kind: r.kind, text: r.text, source };
        } else {
          const text = friendlySent(data.message);
          done = { kind: text.includes("失败：") ? "partial" : "sent", text, source };
        }
        setOutcome(done);
        notifyPendingActionsChanged();
        onDone(done);
      }
    } catch {
      setOutcome({ kind: "error", text: NETWORK_ERROR, source });
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
            {chaseCopy ? chaseCopy.heading : `${roundNumber ? `第 ${roundNumber} 轮询价` : "这轮询价"}等待批准，批准后立即从授权邮箱发出`}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {chaseCopy ? "批准前不会发出。点开可以看这封的正文。" : `共 ${emails.length} 封，批准前不会发出任何邮件。点开可以看每家收到的正文。`}
          </p>
        </div>
      </div>

      {!isChase && followUp && (
        <div className="space-y-2 rounded-md border border-[#9a6a2f]/30 bg-[#9a6a2f]/[0.05] p-3" data-testid="rfq-followup-authorization">
          <p className="text-xs font-medium text-foreground">批准这张卡，同时批准以下后续邮件</p>
          <p className="text-xs text-foreground/85">{followUp.summaryZh}</p>
          <p className="text-xs text-muted">这些邮件到点由系统发出，不再逐封问你；正文就是下面的固定模板，只发给这一轮的原收件人。轮次里随时可以「停止自动跟进」。</p>
          {followUpSuspended && (
            <p className="text-xs text-[#9a6a2f]" data-testid="rfq-followup-suspended">
              自动跟进的功能现在是关闭的：关闭期间这些邮件仍会逐封等你批。但这份授权写在这张卡里——功能重新打开后，它会恢复生效。
            </p>
          )}
          <ul className="divide-y divide-border/60 rounded-md border border-border bg-background">
            {followUp.templates.map((t) => {
              const open = openTemplate === t.key;
              return (
                <li key={t.key}>
                  <button type="button" onClick={() => setOpenTemplate(open ? null : t.key)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs" aria-expanded={open}>
                    {open ? <ChevronDown size={12} className="text-muted" /> : <ChevronRight size={12} className="text-muted" />}
                    <span className="text-foreground">{t.labelZh}</span>
                  </button>
                  {open && (
                    <div className="border-t border-border/60 px-3 py-2">
                      <p className="text-xs font-medium text-foreground">{t.subject}</p>
                      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-muted">{t.body}</pre>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
            outcome.kind === "error"
              ? "text-danger"
              : outcome.kind === "partial"
                ? "text-[#9a6a2f]"
                : outcome.kind === "rejected" || outcome.kind === "skipped"
                  ? "text-muted"
                  : "text-accent",
          )}
          role="status"
        >
          {outcome.kind === "sent" ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : outcome.kind === "error" ? <XCircle size={14} className="mt-px shrink-0" /> : null}
          {outcome.text}
        </p>
      ) : null}

      {statusNote && !outcome ? <p className="text-xs text-muted">{statusNote}</p> : null}

      {decided && outcome?.kind === "error" && approval ? (
        <p className="text-xs text-muted">
          <Link href={approval.href} className="text-accent underline-offset-4 hover:underline">
            在审批中心查看这张卡
          </Link>
        </p>
      ) : null}

      {decided || statusNote ? null : canApprove ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="accent" loading={busy === "approve"} loadingText="正在发出…" disabled={busy !== null} onClick={() => decide("approve")}>
            批准并发送
          </Button>
          {canReject &&
            (confirmReject ? (
              <span className="inline-flex items-center gap-2 text-xs text-muted">
                {chaseCopy ? chaseCopy.rejectConfirm : "确认驳回？这一轮会取消。"}
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
          {isChase ? "需要项目负责人或组织管理员批准。" : "需要组织管理员批准。"}
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

/** 批准成功的执行摘要（「已发出 3/3：A、B、C」）；部分失败时把英文错误换成人话 */
function friendlySent(message: string | undefined): string {
  if (!message) return "已批准并发出。";
  return message.includes("失败：") ? friendlyExecutionError(message) : message;
}
