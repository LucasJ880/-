"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Loader2,
  Bell,
  Sparkles,
  ChevronDown as ChevronDownIcon,
  AlertTriangle,
  Send,
  Mail,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EMAIL_SCENES } from "./types";
import type { BriefingData, InlineEmail } from "./types";
import { sanitizeHtml } from "@/lib/common/sanitize";
import { useSalesCurrentOrgId } from "@/lib/hooks/use-sales-current-org-id";
import {
  isSalesOrgCreateBlocked,
  salesOrgCreateBlockedHint,
  withSalesOrgId,
} from "@/lib/sales/sales-client-org";

export function AiAlertPanel() {
  const { orgId, ambiguous, loading: orgLoading } = useSalesCurrentOrgId();
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pushing, setPushing] = useState(false);

  const [emails, setEmails] = useState<Record<string, InlineEmail>>({});
  const [emailLoadingSet, setEmailLoadingSet] = useState<Set<string>>(new Set());
  const [emailSendingId, setEmailSendingId] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<Set<string>>(new Set());

  const [refineTarget, setRefineTarget] = useState<InlineEmail | null>(null);
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
      console.warn("[AiAlertPanel] loadBriefing failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBriefing(); }, [loadBriefing]);

  const prevExpandedRef = useRef(false);
  useEffect(() => {
    if (expanded && !prevExpandedRef.current && briefing) {
      if (isSalesOrgCreateBlocked(orgLoading, ambiguous, orgId)) {
        prevExpandedRef.current = expanded;
        return;
      }
      const safeItems = Array.isArray(briefing.urgentItems) ? briefing.urgentItems : [];
      const emailItems = safeItems.filter(
        (i) => i.action?.payload?.customerId && EMAIL_SCENES[i.category],
      );
      for (const item of emailItems) {
        const cid = item.action!.payload!.customerId!;
        if (emails[cid] || emailSent.has(cid)) continue;
        const scene = EMAIL_SCENES[item.category];
        setEmailLoadingSet((s) => new Set(s).add(cid));
        apiFetch("/api/sales/email-compose", {
          method: "POST",
          body: JSON.stringify(withSalesOrgId(orgId!, { customerId: cid, scene })),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d.email) setEmails((prev) => ({ ...prev, [cid]: { ...d.email, customerId: cid } }));
          })
          .catch(() => {})
          .finally(() => setEmailLoadingSet((s) => { const n = new Set(s); n.delete(cid); return n; }));
      }
    }
    prevExpandedRef.current = expanded;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, briefing, orgId, orgLoading, ambiguous]);

  const pushToWechat = async () => {
    setPushing(true);
    try { await apiFetch("/api/sales/daily-briefing", { method: "POST" }); }
    catch {}
    finally { setPushing(false); }
  };

  const handleSendInline = async (customerId: string) => {
    const email = emails[customerId];
    if (!email) return;
    if (isSalesOrgCreateBlocked(orgLoading, ambiguous, orgId)) {
      alert(salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? "无法发送");
      return;
    }
    setEmailSendingId(customerId);
    try {
      const res = await apiFetch("/api/sales/email-compose?action=send", {
        method: "POST",
        body: JSON.stringify(
          withSalesOrgId(orgId!, { customerId, scene: email.scene, quoteId: email.quoteId }),
        ),
      });
      const data = await res.json();
      if (data.sent) {
        setEmailSent((prev) => new Set(prev).add(customerId));
      } else {
        alert(data.error || "发送失败");
      }
    } catch { alert("发送请求失败"); }
    finally { setEmailSendingId(null); }
  };

  const handleRefine = async () => {
    if (!refineTarget || !refineInput.trim()) return;
    if (isSalesOrgCreateBlocked(orgLoading, ambiguous, orgId)) {
      alert(salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? "无法优化");
      return;
    }
    setRefining(true);
    try {
      const res = await apiFetch("/api/sales/email-compose?action=refine", {
        method: "POST",
        body: JSON.stringify(
          withSalesOrgId(orgId!, {
            currentSubject: refineTarget.subject,
            currentHtml: refineTarget.html,
            refinement: refineInput.trim(),
          }),
        ),
      });
      const data = await res.json();
      if (data.email) {
        const updated = { ...refineTarget, subject: data.email.subject, html: data.email.html };
        setEmails((prev) => ({ ...prev, [refineTarget.customerId]: updated }));
        setRefineTarget(updated);
        setRefineInput("");
      }
    } catch { alert("优化失败"); }
    finally { setRefining(false); }
  };

  if (!briefing && !loading) return null;

  const items = Array.isArray(briefing?.urgentItems) ? briefing.urgentItems : [];
  const urgentCount = items.filter((i) => i.severity === "urgent").length;
  const warningCount = items.filter((i) => i.severity === "warning").length;

  return (
    <>
      <div className="rounded-xl border border-border bg-gradient-to-r from-amber-50/80 to-orange-50/60 p-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2 text-left">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100">
              <Sparkles className="h-4 w-4 text-amber-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">AI 销售助手</span>
                {loading && <Loader2 className="h-3 w-3 animate-spin text-muted" />}
                {urgentCount > 0 && (
                  <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">{urgentCount} 紧急</span>
                )}
                {warningCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{warningCount} 注意</span>
                )}
              </div>
              <p className="text-xs text-muted">{briefing ? `今日简报 · ${items.length} 项待处理` : "加载中..."}</p>
            </div>
            <ChevronDownIcon className={cn("h-4 w-4 text-muted transition-transform", expanded && "rotate-180")} />
          </button>
          <div className="flex items-center gap-2">
            <button onClick={pushToWechat} disabled={pushing || !briefing} className="inline-flex items-center gap-1 rounded-lg border border-border bg-white/80 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-white transition-colors disabled:opacity-50">
              <Send className="h-3 w-3" />{pushing ? "推送中..." : "推送微信"}
            </button>
            <button onClick={loadBriefing} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-border bg-white/80 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-white transition-colors disabled:opacity-50">
              <Bell className="h-3 w-3" />刷新
            </button>
          </div>
        </div>

        {expanded && briefing && (
          <div className="mt-4 space-y-3">
            {!orgLoading && ambiguous && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {salesOrgCreateBlockedHint(false, true, null)}
              </div>
            )}
            <div className="rounded-lg bg-white/80 p-3 text-sm whitespace-pre-line text-foreground/80">
              {briefing.aiSummary}
            </div>

            {items.length > 0 && (
              <div className="space-y-3">
                {items.slice(0, 8).map((item, idx) => {
                  const customerId = item.action?.payload?.customerId;
                  const canEmail = customerId && EMAIL_SCENES[item.category];
                  const isSent = customerId ? emailSent.has(customerId) : false;
                  const email = customerId ? emails[customerId] : undefined;
                  const isLoadingEmail = customerId ? emailLoadingSet.has(customerId) : false;
                  const isSending = emailSendingId === customerId;

                  return (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-lg border overflow-hidden",
                        item.severity === "urgent" ? "border-red-200 bg-red-50/60" : "border-amber-200 bg-amber-50/60",
                      )}
                    >
                      <div className="p-3 flex items-start gap-2">
                        <AlertTriangle className={cn("h-4 w-4 mt-0.5 shrink-0", item.severity === "urgent" ? "text-red-500" : "text-amber-500")} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground">{item.title}</p>
                          {item.description && <p className="mt-0.5 text-[11px] text-muted line-clamp-2">{item.description}</p>}
                        </div>
                      </div>

                      {canEmail && !isSent && (
                        <div className="border-t border-border/50 bg-white/80">
                          {isLoadingEmail ? (
                            <div className="p-3 flex items-center gap-2 text-xs text-muted">
                              <Loader2 className="h-3 w-3 animate-spin" /> AI 正在生成跟进邮件...
                            </div>
                          ) : email ? (
                            <div className="p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="text-[11px] text-muted">
                                  To: <span className="text-foreground">{email.to}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => { setRefineTarget(email); setRefineInput(""); }}
                                    className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
                                  >
                                    AI 优化
                                  </button>
                                </div>
                              </div>
                              <p className="text-xs font-medium text-foreground">{email.subject}</p>
                              <div className="rounded border border-border/50 bg-gray-50/50 p-2 text-[11px] text-foreground/70 max-h-24 overflow-y-auto"
                                dangerouslySetInnerHTML={{ __html: sanitizeHtml(email.html) }}
                              />
                              <button
                                onClick={() => handleSendInline(customerId!)}
                                disabled={
                                  isSending ||
                                  isSalesOrgCreateBlocked(orgLoading, ambiguous, orgId)
                                }
                                className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                              >
                                {isSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                {isSending ? "发送中..." : "一键发送"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )}
                      {canEmail && isSent && (
                        <div className="border-t border-emerald-200 bg-emerald-50/80 p-3 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                          <Mail className="h-3.5 w-3.5" /> 跟进邮件已发送
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={!!refineTarget} onOpenChange={() => setRefineTarget(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI 邮件优化
            </DialogTitle>
            <DialogDescription>
              告诉 AI 你想怎么改，和 ChatGPT 一样自然对话
            </DialogDescription>
          </DialogHeader>

          {refineTarget && (
            <div className="space-y-4 mt-2">
              <div className="rounded-lg border border-border p-3 space-y-1">
                <div className="text-xs text-muted">To: {refineTarget.to}</div>
                <p className="text-sm font-medium">{refineTarget.subject}</p>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-gray-50 px-3 py-1.5 text-xs font-medium text-muted border-b">邮件预览</div>
                <div className="p-4 text-sm max-h-48 overflow-y-auto" dangerouslySetInnerHTML={{ __html: sanitizeHtml(refineTarget.html) }} />
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={refineInput}
                  onChange={(e) => setRefineInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRefine(); } }}
                  placeholder="告诉 AI 怎么改… 如：语气更热情一些 / 加上10%折扣信息 / 更简短"
                  className="flex-1 rounded-lg border border-border px-3 py-2 text-sm placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  disabled={refining}
                />
                <Button onClick={handleRefine} disabled={refining || !refineInput.trim()} size="sm">
                  {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button variant="outline" onClick={() => setRefineTarget(null)}>关闭</Button>
            <Button onClick={() => {
              if (refineTarget) {
                handleSendInline(refineTarget.customerId);
                setRefineTarget(null);
              }
            }} disabled={emailSendingId === refineTarget?.customerId}>
              <Send className="h-4 w-4 mr-1" /> 确认发送
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
