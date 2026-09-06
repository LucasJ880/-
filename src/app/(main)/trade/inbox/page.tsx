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
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { getTradeProspectStageLabel } from "@/lib/trade/stage";

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
}

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
  const [draftFor, setDraftFor] = useState<Thread | null>(null);
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
      const data = (await res.json()) as { items: Thread[]; counts: { pending: number; total: number }; capabilities?: { emailSend?: boolean } };
      setThreads(data.items ?? []);
      setCounts(data.counts ?? { pending: 0, total: 0 });
      setEmailSend(Boolean(data.capabilities?.emailSend));
    } else {
      setThreads([]);
    }
    setLoading(false);
  }, [orgId, ambiguous, filter]);

  useEffect(() => {
    if (orgLoading) return;
    void load();
  }, [load, orgLoading]);

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
                        onOpenDraft={() => setDraftFor(t)}
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
                        <span className="inline-flex items-center gap-1 text-emerald-500"><CheckCircle2 size={11} /> 已回复</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Link href={`/trade/prospects/${t.prospectId}`} className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-accent/50 hover:text-accent">
                      打开线索
                    </Link>
                    <Link href={quoteHref} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:border-accent/50 hover:text-accent">
                      <FileText size={12} /> 新建报价
                    </Link>
                    {!t.replied && (
                      <button
                        type="button"
                        disabled={marking === t.prospectId}
                        onClick={() => void markHandled(t)}
                        className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-[color:var(--on-accent)] transition hover:bg-accent-hover disabled:opacity-50"
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

      {draftFor && draftFor.analysis?.replyDraft && (
        <ReplyDraftModal
          thread={draftFor}
          emailSend={emailSend}
          orgId={orgId}
          onClose={() => setDraftFor(null)}
          onDone={(msg) => {
            setDraftFor(null);
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

function ReplyDraftModal({
  thread,
  emailSend,
  orgId,
  onClose,
  onDone,
}: {
  thread: Thread;
  emailSend: boolean;
  orgId: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const draft = thread.analysis!.replyDraft!;
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [showZh, setShowZh] = useState(false);
  const [sending, setSending] = useState<"send" | "mark_sent" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (mode: "send" | "mark_sent") => {
    setSending(mode);
    setErr(null);
    try {
      const res = await apiFetch(`/api/trade/inbox/${thread.prospectId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, subject, body, mode }),
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
            <h2 className="text-base font-semibold text-foreground">回复草稿 · {thread.companyName}</h2>
            <p className="mt-0.5 text-xs text-muted">AI 起草，你改定后再发。{draft.askedQuestions.length ? `已包含追问：${draft.askedQuestions.slice(0, 3).join("；")}` : ""}</p>
          </div>
          <button type="button" onClick={() => setShowZh((v) => !v)} className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground">
            {showZh ? "看英文" : "看中文对照"}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:outline-none" />
          {showZh ? (
            <div className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm leading-relaxed text-foreground/90">
              {draft.subjectZh && <p className="mb-2 font-medium">{draft.subjectZh}</p>}
              {draft.bodyZh || "（无中文对照）"}
            </div>
          ) : (
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground focus:border-blue-500 focus:outline-none" />
          )}
        </div>
        {err && <p className="mt-2 text-xs text-red-500">{err}</p>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={onClose} className="text-xs text-muted hover:text-foreground">取消</button>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void copy()} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent/50 hover:text-accent">复制草稿</button>
            <button type="button" disabled={sending !== null} onClick={() => void submit("mark_sent")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent/50 hover:text-accent disabled:opacity-50">
              {sending === "mark_sent" ? "…" : "已在别处发送，标记"}
            </button>
            <button
              type="button"
              disabled={sending !== null || !emailSend || !thread.contactEmail}
              title={!emailSend ? "邮件发送未配置（RESEND）" : !thread.contactEmail ? "该线索没有邮箱" : ""}
              onClick={() => void submit("send")}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-50"
            >
              {sending === "send" ? "发送中…" : "发送邮件"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

