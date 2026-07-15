"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FilePenLine,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  WandSparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EMAIL_SCENES } from "./types";
import type { AlertItem, BriefingData, InlineEmail } from "./types";
import { sanitizeHtml } from "@/lib/common/sanitize";
import { useSalesCurrentOrgId } from "@/lib/hooks/use-sales-current-org-id";
import {
  isSalesOrgCreateBlocked,
  salesOrgCreateBlockedHint,
  withSalesOrgId,
} from "@/lib/sales/sales-client-org";

const SIGNAL_LABELS: Record<string, string> = {
  followup_due: "跟进日期已到",
  quote_pending: "报价发送后未回复",
  viewed_not_signed: "客户已查看报价",
  stale_opportunity: "商机长时间无互动",
  new_lead_stale: "新线索尚未联系",
};

function formatGeneratedAt(value?: string) {
  if (!value) return "刚刚同步";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AiAlertPanel() {
  const { orgId, ambiguous, loading: orgLoading } = useSalesCurrentOrgId();
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [emails, setEmails] = useState<Record<string, InlineEmail>>({});
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [emailSendingId, setEmailSendingId] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<Set<string>>(new Set());
  const [reviewTarget, setReviewTarget] = useState<InlineEmail | null>(null);
  const [refineInput, setRefineInput] = useState("");
  const [refining, setRefining] = useState(false);

  const loadBriefing = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/sales/daily-briefing");
      if (!res.ok) throw new Error(`briefing ${res.status}`);
      const data = await res.json();
      if (data?.briefing && typeof data.briefing === "object") {
        setBriefing(data.briefing);
      }
    } catch (err) {
      console.warn("[SalesActionDesk] loadBriefing failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBriefing();
  }, [loadBriefing]);

  const pushToWechat = async () => {
    setPushing(true);
    try {
      await apiFetch("/api/sales/daily-briefing", { method: "POST" });
    } finally {
      setPushing(false);
    }
  };

  const openEmailDraft = async (item: AlertItem) => {
    const customerId = item.action?.payload?.customerId;
    const scene = EMAIL_SCENES[item.category];
    if (!customerId || !scene) return;

    if (isSalesOrgCreateBlocked(orgLoading, ambiguous, orgId)) {
      alert(salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? "当前无法生成草稿");
      return;
    }

    if (emails[customerId]) {
      setReviewTarget(emails[customerId]);
      return;
    }

    setDraftingId(customerId);
    try {
      const res = await apiFetch("/api/sales/email-compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withSalesOrgId(orgId!, { customerId, scene })),
      });
      const data = await res.json();
      if (!res.ok || !data.email) throw new Error(data.error || "草稿生成失败");
      const draft: InlineEmail = { ...data.email, customerId };
      setEmails((current) => ({ ...current, [customerId]: draft }));
      setReviewTarget(draft);
    } catch (err) {
      alert(err instanceof Error ? err.message : "草稿生成失败");
    } finally {
      setDraftingId(null);
    }
  };

  const handleRefine = async () => {
    if (!reviewTarget || !refineInput.trim() || !orgId) return;
    setRefining(true);
    try {
      const res = await apiFetch("/api/sales/email-compose?action=refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          withSalesOrgId(orgId, {
            currentSubject: reviewTarget.subject,
            currentHtml: reviewTarget.html,
            refinement: refineInput.trim(),
          }),
        ),
      });
      const data = await res.json();
      if (!res.ok || !data.email) throw new Error(data.error || "草稿优化失败");
      const updated = {
        ...reviewTarget,
        subject: data.email.subject,
        html: data.email.html,
      };
      setEmails((current) => ({ ...current, [updated.customerId]: updated }));
      setReviewTarget(updated);
      setRefineInput("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "草稿优化失败");
    } finally {
      setRefining(false);
    }
  };

  const sendReviewedEmail = async () => {
    if (!reviewTarget || !orgId) return;
    setEmailSendingId(reviewTarget.customerId);
    try {
      const res = await apiFetch("/api/sales/email-compose?action=send-approved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          withSalesOrgId(orgId, {
            customerId: reviewTarget.customerId,
            scene: reviewTarget.scene,
            quoteId: reviewTarget.quoteId,
            approvedSubject: reviewTarget.subject,
            approvedHtml: reviewTarget.html,
          }),
        ),
      });
      const data = await res.json();
      if (!res.ok || !data.sent) throw new Error(data.error || "发送失败");
      setEmailSent((current) => new Set(current).add(reviewTarget.customerId));
      setReviewTarget(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "发送失败");
    } finally {
      setEmailSendingId(null);
    }
  };

  const items = useMemo(
    () => (Array.isArray(briefing?.urgentItems) ? briefing.urgentItems : []),
    [briefing],
  );
  const urgentCount = items.filter((item) => item.severity === "urgent").length;
  const warningCount = items.filter((item) => item.severity === "warning").length;

  if (!briefing && !loading) return null;

  return (
    <>
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card-bg">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex min-w-0 items-center gap-3 text-left"
            aria-expanded={expanded}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-accent-soft text-accent">
              <ClipboardCheck size={17} />
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">销售行动台</span>
                {urgentCount > 0 && (
                  <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-semibold text-danger">
                    {urgentCount} 项高优先
                  </span>
                )}
                {warningCount > 0 && (
                  <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning">
                    {warningCount} 项待推进
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                基于 CRM 信号整理，所有外发内容均需人工确认
              </span>
            </span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={pushToWechat}
              disabled={pushing || !briefing}
              className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 text-xs font-medium text-foreground hover:bg-background disabled:opacity-50 sm:flex-none"
            >
              {pushing ? <Loader2 size={13} className="animate-spin" /> : <Smartphone size={13} />}
              推送今日重点
            </button>
            <button
              type="button"
              onClick={loadBriefing}
              disabled={loading}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-border text-muted hover:bg-background hover:text-foreground disabled:opacity-50"
              aria-label="刷新销售行动"
              title="刷新销售行动"
            >
              <RefreshCw size={14} className={cn(loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {expanded && briefing && (
          <div>
            <div className="grid grid-cols-3 border-b border-border bg-background/40">
              {[
                ["活跃商机", briefing.stats.activeOpportunities ?? 0],
                ["本月签单", briefing.stats.signedThisMonth ?? 0],
                ["今日预约", briefing.stats.todayAppointments ?? 0],
              ].map(([label, value], index) => (
                <div
                  key={String(label)}
                  className={cn("px-3 py-3", index > 0 && "border-l border-border")}
                >
                  <p className="text-[10px] text-muted sm:text-xs">{label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</p>
                </div>
              ))}
            </div>

            {items.length > 0 ? (
              <div className="divide-y divide-border">
                {items.slice(0, 8).map((item, index) => {
                  const customerId = item.action?.payload?.customerId;
                  const canEmail = Boolean(customerId && EMAIL_SCENES[item.category]);
                  const isSent = customerId ? emailSent.has(customerId) : false;
                  const isDrafting = draftingId === customerId;

                  return (
                    <article key={`${item.category}-${customerId ?? index}`} className="px-4 py-3.5">
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "mt-1 h-2 w-2 shrink-0 rounded-full",
                            item.severity === "urgent" ? "bg-danger" : "bg-warning",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{item.title}</p>
                              {item.description && (
                                <p className="mt-1 text-xs leading-5 text-muted">{item.description}</p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-quaternary">
                                <span className="inline-flex items-center gap-1">
                                  <AlertCircle size={11} />
                                  触发依据：{SIGNAL_LABELS[item.category] ?? "业务数据变化"}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Clock3 size={11} />
                                  {formatGeneratedAt(briefing.generatedAt)} 更新
                                </span>
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                              {customerId && (
                                <Link
                                  href={`/sales/customers/${customerId}`}
                                  className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 text-xs font-medium text-foreground hover:bg-background"
                                >
                                  客户详情
                                  <ArrowRight size={12} />
                                </Link>
                              )}
                              {canEmail && !isSent && (
                                <button
                                  type="button"
                                  onClick={() => openEmailDraft(item)}
                                  disabled={isDrafting}
                                  className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-foreground px-3 text-xs font-medium text-white hover:bg-foreground/90 disabled:opacity-50"
                                >
                                  {isDrafting ? <Loader2 size={13} className="animate-spin" /> : <FilePenLine size={13} />}
                                  {emails[customerId!] ? "审阅草稿" : "生成跟进草稿"}
                                </button>
                              )}
                              {canEmail && isSent && (
                                <span className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-success-bg px-3 text-xs font-medium text-success">
                                  <CheckCircle2 size={13} />
                                  已发送
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-8 text-center">
                <ShieldCheck size={22} className="mx-auto text-success" />
                <p className="mt-2 text-sm font-medium text-foreground">当前没有高优先销售动作</p>
                <p className="mt-1 text-xs text-muted">系统会持续关注跟进日期、报价状态和客户互动。</p>
              </div>
            )}
          </div>
        )}
      </section>

      <Dialog open={Boolean(reviewTarget)} onOpenChange={(open) => !open && setReviewTarget(null)}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail size={18} />
              跟进邮件审阅
            </DialogTitle>
            <DialogDescription>
              发送前请核对收件人、主题和正文。系统不会自动发送。
            </DialogDescription>
          </DialogHeader>

          {reviewTarget && (
            <div className="mt-2 space-y-4">
              <div className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-background/50 p-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                <span className="text-xs text-muted">收件人</span>
                <span className="break-all text-sm font-medium text-foreground">{reviewTarget.to}</span>
                <label htmlFor="review-email-subject" className="text-xs text-muted sm:pt-2">邮件主题</label>
                <input
                  id="review-email-subject"
                  value={reviewTarget.subject}
                  onChange={(event) =>
                    setReviewTarget((current) => current ? { ...current, subject: event.target.value } : current)
                  }
                  className="min-h-10 w-full rounded-[var(--radius-md)] border border-border bg-white px-3 text-base outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm"
                />
              </div>

              <div className="overflow-hidden rounded-[var(--radius-md)] border border-border">
                <div className="border-b border-border bg-background/60 px-3 py-2 text-xs font-medium text-muted">
                  正文预览
                </div>
                <div
                  className="max-h-64 overflow-y-auto bg-white p-4 text-sm leading-6 text-foreground"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(reviewTarget.html) }}
                />
              </div>

              <div className="rounded-[var(--radius-md)] border border-border p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
                  <WandSparkles size={14} className="text-accent" />
                  智能改写
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={refineInput}
                    onChange={(event) => setRefineInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        handleRefine();
                      }
                    }}
                    placeholder="例如：更简短，加入本周可预约量房"
                    className="min-h-10 flex-1 rounded-[var(--radius-md)] border border-border px-3 text-base outline-none focus:border-accent/40 focus:ring-2 focus:ring-accent/10 sm:text-sm"
                    disabled={refining}
                  />
                  <Button onClick={handleRefine} disabled={refining || !refineInput.trim()} variant="outline">
                    {refining ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <WandSparkles className="mr-1 h-4 w-4" />}
                    优化草稿
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="mt-4 gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setReviewTarget(null)}>暂不发送</Button>
            <Button
              onClick={sendReviewedEmail}
              disabled={!reviewTarget?.subject.trim() || emailSendingId === reviewTarget?.customerId}
            >
              {emailSendingId === reviewTarget?.customerId ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1 h-4 w-4" />
              )}
              确认并发送
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
