"use client";

/**
 * 询盘收件箱 — 外贸员唯一的进线入口
 * 官网表单 / WhatsApp / 微信 / 邮件回复 的进线按买家聚合，待回复优先。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  FileText,
  Globe,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  CheckCircle2,
  PenLine,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { getTradeProspectStageLabel } from "@/lib/trade/stage";
import { approvalRecipientDiffers, replyButtonFor, replySubjectFor, type ApprovalDraft } from "@/lib/trade/reply-target";

interface AnalysisSummary {
  status: string;
  intent: string | null;
  buyerType: string | null;
  summary: string | null;
  products: string[];
  quantity: string | null;
  missingInfo: string[];
  compliance: { code: string; title: string; severity: string }[];
  redFlags: { code: string; title: string; severity: string }[];
  researchStatus: string | null;
  designStatus?: string | null;
  replyDraft?: { subject: string; body: string; subjectZh: string; bodyZh: string; language: string; askedQuestions: string[] } | null;
  quoteSuggestion?: {
    items: { productName: string; specification: string; quantity: number; unitPriceSuggested: number | null; matchedSku: string | null }[];
    moq: string | null;
    leadTimeDays: number | null;
    incoterm: string;
  } | null;
  sampleAdvice?: { recommend: boolean; mode: string; reasons: string[]; suggestedFeeUsd: number | null } | null;
}

const SAMPLE_MODE_LABEL: Record<string, string> = {
  free: "免费寄样",
  paid_deductible: "收样品费，首单抵扣",
  paid: "按实收样品费+运费",
  decline: "暂不寄样",
};

const INTENT_LABEL: Record<string, string> = {
  rfq: "询价",
  sample: "要样品",
  info: "问信息",
  partnership: "谈合作",
  spam: "疑似垃圾",
  unclear: "意图不明",
};
const BUYER_LABEL: Record<string, string> = {
  importer: "进口商",
  brand: "品牌方",
  hotel: "酒店",
  retailer: "零售商",
  agent: "中间商",
  individual: "个人",
  unknown: "",
};

interface Thread {
  prospectId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  country: string | null;
  stage: string;
  source: string;
  score: number | null;
  channel: string;
  lastInboundAt: string;
  lastInboundSubject: string | null;
  lastInboundExcerpt: string;
  inboundCount: number;
  replied: boolean;
  waitingMinutes: number | null;
  analysis?: AnalysisSummary | null;
  waitingSample?: {
    sampleId: string;
    productName: string;
    followUpDueAt: string | null;
    overdue: boolean;
  } | null;
}

/** 买家最后一封来信（全文），来自 GET /api/trade/inbox/focus */
interface LastInbound {
  subject: string | null;
  content: string;
  channel: string;
  createdAt: string;
}

/** 打开着的回复窗口：useDraft = 预填 AI 草稿（「查看回复草稿」），否则空白（「写回复」「再写一封」） */
interface ReplyTarget {
  thread: Thread;
  useDraft: boolean;
  /** 深链已经取到全文时直接带进来，窗口不用再取 */
  lastInbound?: LastInbound | null;
  /** NAV-3：从待批草稿卡进来时带的这份草稿原文；有它就按「改草稿再发」打开 */
  approvalDraft?: ApprovalDraft | null;
}

/** NAV-6：只持查看外贸键的成员看到的说明（卡片不出回复按钮、草稿窗口只读、深链不开窗口） */
const READ_ONLY_NOTICE = "你的岗位只能查看询盘，不能回复";
/** NAV-3：带着待批草稿 id 进来，但这份草稿已经处理过、过期或不属于这位买家 */
const APPROVAL_GONE_NOTICE = "这份待批草稿已经处理过或已失效，可以直接在下面写回复";
/** NAV-3：「改草稿再发」窗口的说明 */
const APPROVAL_EDIT_HINT = "这是等审批的那份 AI 草稿，改好后点「发送邮件」。发出后那份草稿自动作废，不用再去批准；从这里发出的是普通文本邮件。";

const hasReplyDraft = (t: Thread) => t.analysis?.status === "done" && Boolean(t.analysis.replyDraft);

const CHANNEL_META: Record<string, { label: string; icon: typeof Mail; cls: string }> = {
  website: { label: "官网", icon: Globe, cls: "bg-indigo-500/15 text-indigo-400" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, cls: "bg-emerald-500/15 text-emerald-400" },
  wechat: { label: "微信", icon: MessageCircle, cls: "bg-green-500/15 text-green-400" },
  wechat_work: { label: "企业微信", icon: MessageCircle, cls: "bg-blue-500/15 text-blue-400" },
  email: { label: "邮件", icon: Mail, cls: "bg-zinc-500/15 text-zinc-300" },
};

function waitingLabel(minutes: number): { text: string; urgent: boolean } {
  if (minutes < 60) return { text: `等了 ${minutes} 分钟`, urgent: minutes >= 5 };
  if (minutes < 60 * 24) return { text: `等了 ${Math.round(minutes / 60)} 小时`, urgent: true };
  return { text: `等了 ${Math.round(minutes / 1440)} 天`, urgent: true };
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

function AnalysisBlock({ a }: { a: AnalysisSummary }) {
  if (a.status === "pending") {
    return <p className="mt-2 text-[11px] text-muted">AI 正在分析这条询盘…</p>;
  }
  if (a.status === "failed") {
    return <p className="mt-2 text-[11px] text-muted">AI 分析暂时失败，可打开线索手动处理。</p>;
  }
  const critical = a.compliance.filter((c) => c.severity === "critical");
  const warn = a.compliance.filter((c) => c.severity === "warn");
  const highFlags = a.redFlags.filter((f) => f.severity === "critical");
  const otherFlags = a.redFlags.filter((f) => f.severity !== "critical");
  return (
    <div className="mt-2 rounded-lg border border-border/60 bg-background/50 p-2.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-1.5">
        {a.intent && (
          <span className={cn("rounded-full px-2 py-0.5 font-medium", a.intent === "rfq" || a.intent === "sample" ? "bg-emerald-500/15 text-emerald-500" : a.intent === "spam" ? "bg-red-500/15 text-red-500" : "bg-zinc-500/15 text-zinc-400")}>
            {INTENT_LABEL[a.intent] ?? a.intent}
          </span>
        )}
        {a.buyerType && BUYER_LABEL[a.buyerType] && (
          <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-muted">{BUYER_LABEL[a.buyerType]}</span>
        )}
        {a.products.length > 0 && (
          <span className="text-foreground/90">{a.products.slice(0, 3).join(" / ")}{a.quantity ? ` · ${a.quantity}` : ""}</span>
        )}
        {a.researchStatus === "triggered" && <span className="text-muted">· 买家研究已触发</span>}
      </div>
      {a.summary && <p className="mt-1 whitespace-pre-line leading-relaxed text-muted">{a.summary}</p>}
      {(critical.length > 0 || warn.length > 0) && (
        <ul className="mt-1.5 space-y-0.5">
          {critical.map((c) => (
            <li key={c.code} className="font-medium text-red-500">⚠ {c.title}</li>
          ))}
          {warn.map((c) => (
            <li key={c.code} className="text-amber-500">• {c.title}</li>
          ))}
        </ul>
      )}
      {a.redFlags.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {highFlags.map((f) => (
            <li key={f.code} className="font-medium text-red-500">🚩 {f.title}</li>
          ))}
          {otherFlags.map((f) => (
            <li key={f.code} className="text-muted">🚩 {f.title}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TradeInboxPage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [counts, setCounts] = useState({ pending: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState<string | null>(null);
  const [emailSend, setEmailSend] = useState(false);
  // NAV-6：能不能回复由接口给出（capabilities.reply）；返回之前按不能处理，回复按钮随卡片一起出现
  const [canReply, setCanReply] = useState(false);
  const [replyFor, setReplyFor] = useState<ReplyTarget | null>(null);
  const [focusNotice, setFocusNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const load = useCallback(async () => {
    if (!orgId || ambiguous) {
      setThreads([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await apiFetch(
      `/api/trade/inbox?orgId=${encodeURIComponent(orgId)}&filter=${filter}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { items: Thread[]; counts: { pending: number; total: number }; capabilities?: { emailSend?: boolean; reply?: boolean } };
      setThreads(data.items ?? []);
      setCounts(data.counts ?? { pending: 0, total: 0 });
      setEmailSend(Boolean(data.capabilities?.emailSend));
      setCanReply(Boolean(data.capabilities?.reply));
    } else {
      setThreads([]);
    }
    setLoading(false);
  }, [orgId, ambiguous, filter]);

  useEffect(() => {
    if (orgLoading) return;
    void load();
  }, [load, orgLoading]);

  // NAV-1c 深链：/trade/inbox?prospect=<线索 id> 或 ?opportunity=<商机 id> → 取这位买家的会话并直接打开回复窗口。
  // 走单会话接口，所以不在当前筛选、90 天窗口或 200 条上限里的买家也打得开；找不到就提示、列表照常。
  useEffect(() => {
    if (orgLoading || !orgId || ambiguous) return;
    const params = new URLSearchParams(window.location.search);
    const prospectId = params.get("prospect");
    const opportunityId = params.get("opportunity");
    // NAV-3：从待批草稿卡进来时还带着这份草稿的 id
    const approvalId = params.get("approval");
    if (!prospectId && !opportunityId) return;
    let cancelled = false;
    void (async () => {
      const target = prospectId ? `prospectId=${encodeURIComponent(prospectId)}` : `opportunityId=${encodeURIComponent(opportunityId ?? "")}`;
      const withApproval = approvalId ? `&approvalId=${encodeURIComponent(approvalId)}` : "";
      const res = await apiFetch(`/api/trade/inbox/focus?orgId=${encodeURIComponent(orgId)}&${target}${withApproval}`).catch(() => null);
      if (cancelled) return;
      if (res?.ok) {
        const data = (await res.json()) as { thread: Thread; lastInbound: LastInbound | null; approvalDraft?: ApprovalDraft | null; capabilities?: { emailSend?: boolean; reply?: boolean } };
        if (cancelled) return;
        if (data.capabilities) setEmailSend(Boolean(data.capabilities.emailSend));
        const approvalDraft = approvalId ? (data.approvalDraft ?? null) : null;
        const mayReply = Boolean(data.capabilities?.reply);
        setCanReply(mayReply);
        // NAV-6：不能回复的成员不开回复窗口，只提示
        if (mayReply) {
          setReplyFor({
            thread: data.thread,
            // NAV-3：带着待批草稿 id 进来的，不预填收件箱自己的分析草稿——取到待批草稿就用它，没取到就空白
            useDraft: approvalId ? false : replyButtonFor({ replied: data.thread.replied, hasDraft: hasReplyDraft(data.thread) }).useDraft,
            lastInbound: data.lastInbound,
            approvalDraft,
          });
          if (approvalId && !approvalDraft) setFocusNotice(APPROVAL_GONE_NOTICE);
        } else {
          setFocusNotice(READ_ONLY_NOTICE);
        }
      } else {
        setFocusNotice("没有找到这位买家的询盘会话");
      }
      // 去掉地址里的参数：刷新或返回时不再反复弹窗
      router.replace("/trade/inbox");
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, ambiguous, orgLoading, router]);

  // 标记已处理：记一次跟进（今天已联系，3 天后再看），线索从待回复移出
  const markHandled = async (t: Thread) => {
    if (!orgId) return;
    setMarking(t.prospectId);
    try {
      const next = new Date();
      next.setDate(next.getDate() + 3);
      await apiFetch(`/api/trade/prospects/${t.prospectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          lastContactAt: new Date().toISOString(),
          nextFollowUpAt: next.toISOString(),
        }),
      });
      await apiFetch(`/api/trade/prospects/${t.prospectId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          direction: "outbound",
          channel: t.channel,
          content: "已在系统外回复买家（收件箱标记）",
        }),
      }).catch(() => {});
      await load();
    } finally {
      setMarking(null);
    }
  };

  const createQuoteDraft = async (t: Thread) => {
    if (!orgId) return;
    setBusy(`quote:${t.prospectId}`);
    try {
      const res = await apiFetch(`/api/trade/inbox/${t.prospectId}/quote-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(data.error || "生成失败");
        return;
      }
      router.push(`/trade/quotes/${data.quoteId}`);
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async (t: Thread) => {
    if (!orgId) return;
    setBusy(`design:${t.prospectId}`);
    try {
      const res = await apiFetch(`/api/trade/inbox/${t.prospectId}/design`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) flash(data.error || "重新生成失败");
      else flash("已重新生成");
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!orgId || ambiguous) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted">请先选择当前组织后再查看询盘。</p>
        <button type="button" onClick={() => router.push("/organizations")} className="text-sm text-accent underline-offset-2 hover:underline">
          前往组织
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="询盘收件箱"
        description="官网表单、WhatsApp、微信、邮件回复的进线都在这里，待回复的排最前——询盘当天回。"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card-bg p-1 text-xs">
          <button
            type="button"
            onClick={() => setFilter("pending")}
            className={cn("rounded-md px-3 py-1.5 font-medium transition", filter === "pending" ? "bg-accent text-[color:var(--on-accent)]" : "text-muted hover:text-foreground")}
          >
            待回复 {counts.pending > 0 && <span className="ml-1 rounded-full bg-black/10 px-1.5">{counts.pending}</span>}
          </button>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={cn("rounded-md px-3 py-1.5 font-medium transition", filter === "all" ? "bg-accent text-[color:var(--on-accent)]" : "text-muted hover:text-foreground")}
          >
            全部 <span className="ml-1 text-[10px] opacity-70">{counts.total}</span>
          </button>
        </div>
        <button type="button" onClick={() => void load()} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted transition hover:text-foreground">
          <RefreshCw size={12} /> 刷新
        </button>
      </div>

      {focusNotice && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
          <span>{focusNotice}</span>
          <button type="button" onClick={() => setFocusNotice(null)} className="shrink-0 text-muted hover:text-foreground">
            知道了
          </button>
        </div>
      )}

      {threads.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card-bg px-8 py-16 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="text-sm text-foreground">{filter === "pending" ? "没有待回复的询盘" : "还没有进线"}</p>
          <p className="mt-1 text-xs text-muted">
            官网 Contact Us、WhatsApp、微信的进线会自动出现在这里；也可以在
            <Link href="/trade/prospects" className="mx-1 text-accent hover:underline">线索资产</Link>
            手动录入买家。
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {threads.map((t) => {
            const meta = CHANNEL_META[t.channel] ?? CHANNEL_META.email;
            const Icon = meta.icon;
            const wait = !t.replied && t.waitingMinutes !== null ? waitingLabel(t.waitingMinutes) : null;
            // 每张卡片都有回复按钮：有草稿时是分析块里的「查看回复草稿」；没有草稿是「写回复」，已回复是「再写一封」
            const replyButton = replyButtonFor({ replied: t.replied, hasDraft: hasReplyDraft(t) });
            const quoteHref = `/trade/quotes/new?prospectId=${encodeURIComponent(t.prospectId)}&companyName=${encodeURIComponent(t.companyName)}${t.contactName ? `&contactName=${encodeURIComponent(t.contactName)}` : ""}${t.contactEmail ? `&contactEmail=${encodeURIComponent(t.contactEmail)}` : ""}${t.country ? `&country=${encodeURIComponent(t.country)}` : ""}`;
            return (
              <li key={t.prospectId} className={cn("rounded-xl border bg-card-bg p-4", wait?.urgent ? "border-amber-500/40" : "border-border/60")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", meta.cls)}>
                        <Icon size={11} /> {meta.label}
                      </span>
                      <Link href={`/trade/prospects/${t.prospectId}`} className="text-sm font-semibold text-foreground hover:underline">
                        {t.companyName}
                      </Link>
                      {t.contactName && <span className="text-xs text-muted">{t.contactName}</span>}
                      {t.country && <span className="text-xs text-muted">· {t.country}</span>}
                      <span className="rounded bg-[rgba(110,125,118,0.08)] px-1.5 py-0.5 text-[10px] text-muted">
                        {getTradeProspectStageLabel(t.stage)}
                      </span>
                      {t.score !== null && <span className="text-[10px] text-muted">评分 {t.score.toFixed(1)}</span>}
                      {t.waitingSample && (
                        <Link
                          href={`/trade/samples/${t.waitingSample.sampleId}`}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            t.waitingSample.overdue
                              ? "bg-amber-500/15 text-amber-500"
                              : "bg-blue-500/15 text-blue-400",
                          )}
                        >
                          {t.waitingSample.overdue ? "寄样已逾期" : "已寄出、等买家回"}
                        </Link>
                      )}
                    </div>
                    {t.lastInboundSubject && (
                      <p className="mt-1.5 text-xs font-medium text-foreground/90">{t.lastInboundSubject}</p>
                    )}
                    <p className="mt-1 text-xs leading-relaxed text-muted">{t.lastInboundExcerpt}</p>
                    {t.analysis && <AnalysisBlock a={t.analysis} />}
                    {t.analysis && t.analysis.status === "done" && (
                      <DesignBlock
                        a={t.analysis}
                        busy={busy}
                        prospectId={t.prospectId}
                        onOpenDraft={() => setReplyFor({ thread: t, useDraft: true })}
                        onQuote={() => void createQuoteDraft(t)}
                        onRegenerate={() => void regenerate(t)}
                      />
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                      <span className="inline-flex items-center gap-1"><Clock size={11} /> {timeAgo(t.lastInboundAt)}</span>
                      <span>{t.inboundCount} 条进线</span>
                      {wait ? (
                        <span className={cn("font-medium", wait.urgent ? "text-amber-500" : "text-muted")}>{wait.text}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-500"><CheckCircle2 size={11} /> 我方已回复</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {canReply && replyButton.kind !== "draft" && (
                      <button
                        type="button"
                        onClick={() => setReplyFor({ thread: t, useDraft: false })}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                          replyButton.kind === "write"
                            ? "bg-accent text-[color:var(--on-accent)] hover:bg-accent-hover"
                            : "border border-border text-foreground hover:border-accent/50 hover:text-accent",
                        )}
                      >
                        <PenLine size={12} /> {replyButton.label}
                      </button>
                    )}
                    <Link href={`/trade/prospects/${t.prospectId}`} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-accent/50 hover:text-accent">
                      打开线索
                    </Link>
                    <Link href={quoteHref} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-accent/50 hover:text-accent">
                      <FileText size={12} /> 新建报价
                    </Link>
                    <Link
                      href={`/trade/samples/new?prospectId=${encodeURIComponent(t.prospectId)}&recipientName=${encodeURIComponent(t.contactName ?? "")}&recipientEmail=${encodeURIComponent(t.contactEmail ?? "")}&destination=${encodeURIComponent(t.country ?? "")}${t.analysis?.quoteSuggestion?.items[0]?.productName ? `&productName=${encodeURIComponent(t.analysis.quoteSuggestion.items[0].productName)}` : ""}${t.analysis?.quoteSuggestion?.items[0]?.matchedSku ? `&sku=${encodeURIComponent(t.analysis.quoteSuggestion.items[0].matchedSku)}` : ""}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-accent/50 hover:text-accent"
                    >
                      开寄样单
                    </Link>
                    {canReply && !t.replied && (
                      <button
                        type="button"
                        disabled={marking === t.prospectId}
                        onClick={() => void markHandled(t)}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-accent/50 hover:text-accent disabled:opacity-50"
                      >
                        {marking === t.prospectId ? "…" : "已回复，标记"}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-xs text-background shadow-lg">{toast}</div>
      )}

      {replyFor && (
        <ReplyModal
          key={`${replyFor.thread.prospectId}:${replyFor.approvalDraft ? `approval:${replyFor.approvalDraft.pendingActionId}` : replyFor.useDraft ? "draft" : "blank"}`}
          target={replyFor}
          emailSend={emailSend}
          canReply={canReply}
          orgId={orgId}
          onClose={() => setReplyFor(null)}
          onDone={(msg) => {
            setReplyFor(null);
            flash(msg);
            void load();
          }}
        />
      )}
    </div>
  );
}

function DesignBlock({
  a,
  busy,
  prospectId,
  onOpenDraft,
  onQuote,
  onRegenerate,
}: {
  a: AnalysisSummary;
  busy: string | null;
  prospectId: string;
  onOpenDraft: () => void;
  onQuote: () => void;
  onRegenerate: () => void;
}) {
  if (a.designStatus === "pending" || !a.designStatus) {
    return <p className="mt-1.5 text-[11px] text-muted">AI 正在起草回复与报价建议…</p>;
  }
  const q = a.quoteSuggestion;
  const s = a.sampleAdvice;
  return (
    <div className="mt-2 rounded-lg border border-accent/25 bg-accent/5 p-2.5 text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-foreground">AI 已备好（需你确认）</span>
        <button type="button" onClick={onRegenerate} disabled={busy === `design:${prospectId}`} className="text-muted hover:text-foreground disabled:opacity-50">
          {busy === `design:${prospectId}` ? "生成中…" : "重新生成"}
        </button>
      </div>
      {a.designStatus === "failed" && <p className="mt-1 text-muted">生成失败，可点「重新生成」。</p>}
      {s && (
        <p className="mt-1 text-muted">
          寄样：<span className="text-foreground">{SAMPLE_MODE_LABEL[s.mode] ?? s.mode}{s.suggestedFeeUsd ? `（约 $${s.suggestedFeeUsd}）` : ""}</span>
          {s.reasons[0] ? ` — ${s.reasons[0]}` : ""}
        </p>
      )}
      {q && q.items.length > 0 && (
        <p className="mt-1 text-muted">
          报价建议：{q.items.slice(0, 2).map((it) => `${it.productName}${it.quantity ? ` ×${it.quantity}` : ""}${it.unitPriceSuggested !== null ? ` @$${it.unitPriceSuggested}` : "（待填价）"}`).join("；")}
          {q.items.length > 2 ? ` 等 ${q.items.length} 项` : ""}{q.moq ? ` · MOQ ${q.moq}` : ""}{q.leadTimeDays ? ` · ${q.leadTimeDays} 天` : ""} · {q.incoterm}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {a.replyDraft && (
          <button type="button" onClick={onOpenDraft} className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-[color:var(--on-accent)] hover:bg-accent-hover">
            查看回复草稿
          </button>
        )}
        {q && q.items.length > 0 && (
          <button type="button" onClick={onQuote} disabled={busy === `quote:${prospectId}`} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent/50 hover:text-accent disabled:opacity-50">
            {busy === `quote:${prospectId}` ? "创建中…" : "按建议生成报价草稿"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 回复窗口（NAV-1c）：草稿可选。
 *   - useDraft 且会话有 AI 草稿 → 预填草稿，可看中文对照；
 *   - 否则正文留空、主题按来信主题预填 Re:，不调模型。
 * 编辑框上方只读显示买家最后一封来信的主题与全文（先用卡片上的摘要，取到全文后替换）。
 * 只有点「发送邮件」或「已在别处发送，标记」才请求回复接口；打开窗口本身不发任何东西。
 */
function ReplyModal({
  target,
  emailSend,
  canReply,
  orgId,
  onClose,
  onDone,
}: {
  target: ReplyTarget;
  emailSend: boolean;
  /** NAV-6：为否时窗口只读——不能改、不能发、不能标记，只能看与复制 */
  canReply: boolean;
  orgId: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { thread } = target;
  // NAV-3：带着待批草稿进来时，预填的是那份草稿的原文（不是收件箱自己的分析草稿）
  const approval = target.approvalDraft ?? null;
  const draft = approval ? null : target.useDraft ? (thread.analysis?.replyDraft ?? null) : null;
  const [subject, setSubject] = useState(approval ? approval.subject : draft ? draft.subject : replySubjectFor(thread.lastInboundSubject));
  const [body, setBody] = useState(approval ? approval.body : draft ? draft.body : "");
  const recipientDiffers = approval ? approvalRecipientDiffers(approval.to, thread.contactEmail) : false;
  const [showZh, setShowZh] = useState(false);
  const [sending, setSending] = useState<"send" | "mark_sent" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastInbound, setLastInbound] = useState<LastInbound | null>(target.lastInbound ?? null);

  // 来信全文：深链已带进来就不取；从卡片打开时按线索取一次（列表里只有 160 字摘要）
  useEffect(() => {
    if (target.lastInbound !== undefined || !orgId) return;
    let cancelled = false;
    void (async () => {
      const res = await apiFetch(
        `/api/trade/inbox/focus?orgId=${encodeURIComponent(orgId)}&prospectId=${encodeURIComponent(thread.prospectId)}`,
      ).catch(() => null);
      if (cancelled || !res?.ok) return;
      const data = (await res.json()) as { lastInbound: LastInbound | null };
      if (!cancelled) setLastInbound(data.lastInbound);
    })();
    return () => {
      cancelled = true;
    };
  }, [target.lastInbound, orgId, thread.prospectId]);

  const inboundSubject = lastInbound?.subject ?? thread.lastInboundSubject;
  const inboundText = lastInbound?.content ?? thread.lastInboundExcerpt;
  const hasInbound = thread.inboundCount > 0 || Boolean(lastInbound);

  const submit = async (mode: "send" | "mark_sent") => {
    setSending(mode);
    setErr(null);
    try {
      const res = await apiFetch(`/api/trade/inbox/${thread.prospectId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // fromAiDraft：正文来自 AI 草稿（改过也算）；手写为 false，留底消息不标成 AI 草稿
        body: JSON.stringify({ orgId, subject, body, mode, fromAiDraft: Boolean(draft) || Boolean(approval) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "操作失败");
        return;
      }
      onDone(mode === "send" ? "已发送并记入时间线，3 天后提醒跟进" : "已标记发送，3 天后提醒跟进");
    } finally {
      setSending(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setErr(null);
      onDone("草稿已复制，去邮箱/WhatsApp 发送后回来点「标记已发送」");
    } catch {
      setErr("复制失败，请手动选择文本");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-card-bg p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">{approval ? "改草稿再发" : draft ? "回复草稿" : "写回复"} · {thread.companyName}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {!canReply
                ? READ_ONLY_NOTICE
                : approval
                ? APPROVAL_EDIT_HINT
                : draft
                ? `AI 起草，你改定后再发。${draft.askedQuestions.length ? `已包含追问：${draft.askedQuestions.slice(0, 3).join("；")}` : ""}`
                : "自己写回复；发出后记入时间线，这位买家还在等审批的 AI 草稿会自动作废。"}
            </p>
          </div>
          {draft && (
            <button type="button" onClick={() => setShowZh((v) => !v)} className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground">
              {showZh ? "看英文" : "看中文对照"}
            </button>
          )}
        </div>
        {/* NAV-3：草稿原定的收件邮箱与这位买家在收件箱里的邮箱不同——从这里发，发给的是后者 */}
        {approval && recipientDiffers && (
          <p data-reply-recipient-differs className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
            这份草稿原本发给 {approval.to}；从这里发送会发给 {thread.contactEmail}。
          </p>
        )}
        {/* 买家来信原文（只读）：边看边回 */}
        {hasInbound && (
          <div data-reply-inbound className="mt-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2">
            <p className="text-[11px] font-medium text-muted">买家来信</p>
            {inboundSubject && <p className="mt-1 text-xs font-medium text-foreground">{inboundSubject}</p>}
            <div className="mt-1 max-h-[28vh] overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">{inboundText}</div>
          </div>
        )}
        <div className="mt-3 space-y-2">
          <input value={subject} readOnly={!canReply} onChange={(e) => setSubject(e.target.value)} placeholder="主题" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none" />
          {showZh && draft ? (
            <div className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm leading-relaxed text-foreground/90">
              {draft.subjectZh && <p className="mb-2 font-medium">{draft.subjectZh}</p>}
              {draft.bodyZh || "（无中文对照）"}
            </div>
          ) : (
            <textarea value={body} readOnly={!canReply} onChange={(e) => setBody(e.target.value)} rows={draft || approval ? 14 : 10} placeholder={draft || approval ? undefined : "在这里写给买家的回复…"} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground focus:border-blue-500 focus:outline-none" />
          )}
        </div>
        {err && <p className="mt-2 text-xs text-red-500">{err}</p>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onClose} className="text-xs text-muted hover:text-foreground">取消</button>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void copy()} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent/50 hover:text-accent">{draft || approval ? "复制草稿" : "复制内容"}</button>
            {canReply && (
              <>
                <button type="button" disabled={sending !== null || !body.trim()} onClick={() => void submit("mark_sent")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent/50 hover:text-accent disabled:opacity-50">
                  {sending === "mark_sent" ? "…" : "已在别处发送，标记"}
                </button>
                <button
                  type="button"
                  disabled={sending !== null || !emailSend || !thread.contactEmail || !body.trim()}
                  title={!emailSend ? "邮件发送未配置（RESEND）" : !thread.contactEmail ? "该线索没有邮箱" : ""}
                  onClick={() => void submit("send")}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-50"
                >
                  {sending === "send" ? "发送中…" : "发送邮件"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

