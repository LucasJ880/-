"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Star,
  Globe,
  Mail,
  User,
  Building2,
  Sparkles,
  FileText,
  Send,
  Copy,
  CheckCircle2,
  MessageSquare,
  Clock,
  AlertCircle,
  Plus,
  History,
  Calendar,
  Edit3,
  Trash2,
  Eye,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import {
  parseResearchBundle,
  type ResearchReport,
  type ScoringProfileV1,
} from "@/lib/trade/research-bundle";

function researchSourceKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    search: "搜索",
    homepage: "官网",
    about: "关于我们",
    products: "产品",
    collections: "系列",
    contact: "联系",
    compliance: "合规/认证",
    news: "资讯",
    blog: "博客",
    site_page: "站内页",
  };
  return labels[kind] ?? kind;
}

// ── Types ───────────────────────────────────────────────────

function hasResearchContent(report: ResearchReport | null): boolean {
  if (!report) return false;
  return Object.values(report).some((v) => String(v ?? "").trim().length > 0);
}

interface Prospect {
  id: string;
  campaignId: string;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactTitle: string | null;
  website: string | null;
  country: string | null;
  source: string;
  researchReport: Record<string, string> | null;
  score: number | null;
  scoreReason: string | null;
  stage: string;
  outreachSubject: string | null;
  outreachBody: string | null;
  outreachLang: string | null;
  outreachSentAt: string | null;
  followUpCount: number;
  createdAt: string;
  messages: Message[];
}

interface Message {
  id: string;
  direction: string;
  channel: string;
  subject: string | null;
  content: string;
  intent: string | null;
  sentiment: string | null;
  createdAt: string;
}

const STAGE_LABELS: Record<string, string> = {
  new: "新线索",
  researched: "已研究",
  qualified: "合格",
  unqualified: "不合格",
  outreach_draft: "邮件草稿",
  outreach_sent: "已发送",
  replied: "已回复",
  interested: "感兴趣",
  negotiating: "谈判中",
  won: "成交",
  lost: "丢失",
  no_response: "未回复",
};

const TRADE_ORG_ID = "default";

const SCORE_DIM_LABELS: Record<string, string> = {
  productFit: "产品契合",
  channelFit: "渠道契合",
  complianceVisibility: "合规可见度",
  reachability: "可触达性",
};

const WATCH_PAGE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "products", label: "产品页" },
  { value: "collections", label: "集合页" },
  { value: "news", label: "新闻/公告" },
  { value: "blog", label: "博客" },
  { value: "about", label: "公司介绍" },
  { value: "careers", label: "招聘" },
  { value: "custom", label: "自定义" },
];

interface WatchTargetRow {
  id: string;
  url: string;
  pageType: string;
  isActive: boolean;
  lastContentHash: string | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  lastFetchError: string | null;
}

interface SignalRow {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  evidenceJson: unknown;
}

const STAGE_COLORS: Record<string, string> = {
  new: "bg-zinc-500/15 text-zinc-400",
  qualified: "bg-emerald-500/15 text-emerald-400",
  unqualified: "bg-red-500/15 text-red-400",
  outreach_draft: "bg-amber-500/15 text-amber-400",
  outreach_sent: "bg-violet-500/15 text-violet-400",
  replied: "bg-cyan-500/15 text-cyan-400",
  interested: "bg-emerald-500/15 text-emerald-400",
  negotiating: "bg-orange-500/15 text-orange-400",
  won: "bg-emerald-600/20 text-emerald-300",
  lost: "bg-red-600/20 text-red-300",
};

const INTENT_LABELS: Record<string, string> = {
  interested: "感兴趣",
  question: "询问细节",
  objection: "提出异议",
  request_sample: "要求样品",
  not_interested: "不感兴趣",
  ooo: "不在办公室",
  unclear: "意图不明",
};

const REPORT_LABELS: Record<string, string> = {
  companyOverview: "公司概况",
  products: "主营产品",
  marketPosition: "市场地位",
  importHistory: "采购特征",
  contactInfo: "联系方式",
  matchAnalysis: "匹配度分析",
  recommendations: "接触策略建议",
};

// ── Page ────────────────────────────────────────────────────

export default function ProspectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isSuperAdmin } = useCurrentUser();
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [loading, setLoading] = useState(true);
  const [researching, setResearching] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [replySubject, setReplySubject] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);
  const [replyResult, setReplyResult] = useState<{ intent: string; suggestedAction: string; draftReply?: string } | null>(null);
  const [timeline, setTimeline] = useState<{ id: string; action: string; detail: string | null; createdAt: string }[]>([]);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showChannelSend, setShowChannelSend] = useState(false);
  const [editingStage, setEditingStage] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState(false);
  const [newFollowUpDate, setNewFollowUpDate] = useState("");
  const [watchTargets, setWatchTargets] = useState<WatchTargetRow[]>([]);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [watchUrl, setWatchUrl] = useState("");
  const [watchPageType, setWatchPageType] = useState("custom");
  const [watchBusy, setWatchBusy] = useState(false);
  const [checkingWatchId, setCheckingWatchId] = useState<string | null>(null);
  const [rebaselineWatchId, setRebaselineWatchId] = useState<string | null>(null);

  const loadProspect = useCallback(async () => {
    const res = await apiFetch(`/api/trade/prospects/${id}`);
    if (res.ok) setProspect(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadProspect();
  }, [loadProspect]);

  const loadWatchData = useCallback(async () => {
    const [r1, r2] = await Promise.all([
      apiFetch(`/api/trade/watch-targets?orgId=${encodeURIComponent(TRADE_ORG_ID)}&prospectId=${encodeURIComponent(id)}`),
      apiFetch(`/api/trade/signals?orgId=${encodeURIComponent(TRADE_ORG_ID)}&prospectId=${encodeURIComponent(id)}&limit=20`),
    ]);
    if (r1.ok) {
      const d = (await r1.json()) as { items?: WatchTargetRow[] };
      setWatchTargets(d.items ?? []);
    }
    if (r2.ok) {
      const d = (await r2.json()) as { items?: SignalRow[] };
      setSignals(d.items ?? []);
    }
  }, [id]);

  useEffect(() => {
    void loadWatchData();
  }, [loadWatchData]);

  const handleAddWatch = async () => {
    if (!watchUrl.trim()) return;
    setWatchBusy(true);
    try {
      const res = await apiFetch("/api/trade/watch-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: TRADE_ORG_ID,
          prospectId: id,
          url: watchUrl.trim(),
          pageType: watchPageType,
        }),
      });
      if (res.ok) {
        setWatchUrl("");
        await loadWatchData();
      } else {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(err?.error ?? "添加失败");
      }
    } finally {
      setWatchBusy(false);
    }
  };

  function messageForWatchCheckResult(
    result: { kind: string; message?: string; signalId?: string } | null,
  ): string {
    if (!result) return "检查完成";
    switch (result.kind) {
      case "fetch_error":
        return `抓取失败：${result.message ?? "未知错误"}`;
      case "baseline_set":
        return "已建立首次基线（未生成信号）。";
      case "no_change":
        return "页面文本与上次一致，无新信号。";
      case "changed":
        return `已检测到变化并生成弱信号（signalId: ${result.signalId ?? "—"}）。`;
      case "changed_suppressed":
        return "页面已变化，但在 24 小时冷却期内未重复创建同类型信号；基线与检查时间已更新。";
      default:
        return `检查完成（${result.kind}）`;
    }
  }

  const handleCheckWatch = async (targetId: string) => {
    setCheckingWatchId(targetId);
    try {
      const res = await apiFetch(
        `/api/trade/watch-targets/${targetId}/check?orgId=${encodeURIComponent(TRADE_ORG_ID)}`,
        { method: "POST" },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          result?: { kind: string; message?: string; signalId?: string };
        };
        await loadWatchData();
        alert(messageForWatchCheckResult(data.result ?? null));
      } else {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(err?.error ?? "检查失败");
      }
    } finally {
      setCheckingWatchId(null);
    }
  };

  const handleRebaselineWatch = async (targetId: string) => {
    setRebaselineWatchId(targetId);
    try {
      const res = await apiFetch(
        `/api/trade/watch-targets/${targetId}/rebaseline?orgId=${encodeURIComponent(TRADE_ORG_ID)}`,
        { method: "POST" },
      );
      const data = (await res.json().catch(() => null)) as {
        rebaseline?: { ok: boolean; message?: string };
        error?: string;
      } | null;
      if (res.ok && data?.rebaseline?.ok) {
        await loadWatchData();
        alert("已重置基线：当前页面为新的对比快照（未改动「上次变化」时间）。");
      } else {
        alert(data?.rebaseline?.message ?? data?.error ?? "重置基线失败");
        await loadWatchData();
      }
    } finally {
      setRebaselineWatchId(null);
    }
  };

  const handleToggleWatch = async (targetId: string, isActive: boolean) => {
    await apiFetch(`/api/trade/watch-targets/${targetId}?orgId=${encodeURIComponent(TRADE_ORG_ID)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    await loadWatchData();
  };

  const handleDeleteWatch = async (targetId: string) => {
    if (!confirm("确定删除该监控 URL？")) return;
    await apiFetch(`/api/trade/watch-targets/${targetId}?orgId=${encodeURIComponent(TRADE_ORG_ID)}`, {
      method: "DELETE",
    });
    await loadWatchData();
  };

  const handleResearch = async () => {
    setResearching(true);
    try {
      const researchUrl =
        `/api/trade/prospects/${id}/research` +
        (isSuperAdmin ? "?debugScore=1" : "");
      await apiFetch(researchUrl, { method: "POST" });
      await loadProspect();
    } finally {
      setResearching(false);
    }
  };

  const handleGenerateOutreach = async () => {
    setGenerating(true);
    try {
      await apiFetch(`/api/trade/prospects/${id}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await loadProspect();
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async (mode: "send" | "mark_sent") => {
    setSending(true);
    try {
      const res = await apiFetch(`/api/trade/prospects/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) await loadProspect();
    } finally {
      setSending(false);
    }
  };

  const handleSubmitReply = async () => {
    if (!replyContent.trim()) return;
    setSubmittingReply(true);
    setReplyResult(null);
    try {
      const res = await apiFetch(`/api/trade/prospects/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyContent, subject: replySubject || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        setReplyResult({
          intent: data.classification.intent,
          suggestedAction: data.classification.suggestedAction,
          draftReply: data.draftReply,
        });
        setReplyContent("");
        setReplySubject("");
        await loadProspect();
      }
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleStageChange = async (newStage: string) => {
    await apiFetch(`/api/trade/prospects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: newStage }),
    });
    setEditingStage(false);
    await loadProspect();
  };

  const handleFollowUpChange = async () => {
    if (!newFollowUpDate) return;
    await apiFetch(`/api/trade/prospects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nextFollowUpAt: new Date(newFollowUpDate).toISOString() }),
    });
    setEditingFollowUp(false);
    setNewFollowUpDate("");
    await loadProspect();
  };

  const loadTimeline = async () => {
    const res = await apiFetch(`/api/trade/prospects/${id}/timeline`);
    if (res.ok) setTimeline(await res.json());
  };

  const handleCopyEmail = () => {
    if (!prospect?.outreachBody) return;
    const text = `Subject: ${prospect.outreachSubject}\n\n${prospect.outreachBody}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyProspectId = async () => {
    try {
      await navigator.clipboard.writeText(String(id));
      setIdCopied(true);
      setTimeout(() => setIdCopied(false), 2000);
    } catch {
      alert("复制失败，请手动复制");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!prospect) {
    return <div className="py-20 text-center text-muted">线索不存在</div>;
  }

  const p = prospect;
  const parsed = parseResearchBundle(p.researchReport);
  const report = parsed.report;
  const researchSources = parsed.sources;
  const fieldSourceIds = parsed.fieldSourceIds;
  const scoring: ScoringProfileV1 | undefined = parsed.scoring;
  const hasResearch = hasResearchContent(report);
  const displayScore =
    scoring != null ? scoring.totalFromDimensions : p.score ?? null;
  const scoreOutOfSync =
    p.score != null &&
    scoring != null &&
    Math.abs(p.score - scoring.totalFromDimensions) > 0.05;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => router.back()}
          className="mt-1 rounded-lg p-1.5 text-muted transition hover:text-foreground"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">{p.companyName}</h1>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STAGE_COLORS[p.stage] ?? STAGE_COLORS.new)}>
              {STAGE_LABELS[p.stage] ?? p.stage}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
            {p.contactName && (
              <span className="flex items-center gap-1"><User size={10} />{p.contactName}{p.contactTitle ? ` · ${p.contactTitle}` : ""}</span>
            )}
            {p.country && <span className="flex items-center gap-1"><Globe size={10} />{p.country}</span>}
            {p.contactEmail && <span className="flex items-center gap-1"><Mail size={10} />{p.contactEmail}</span>}
            {p.website && (
              <a href={p.website} target="_blank" rel="noopener" className="flex items-center gap-1 text-blue-400 hover:underline">
                <Building2 size={10} />{new URL(p.website).hostname}
              </a>
            )}
          </div>
        </div>

        {displayScore !== null && (
          <div className="flex flex-col items-center rounded-xl border border-border/60 bg-card-bg px-4 py-2">
            <div className="flex items-center gap-1">
              <Star size={14} className={displayScore >= 7 ? "text-amber-400" : "text-zinc-500"} />
              <span className={cn("text-xl font-bold", displayScore >= 7 ? "text-amber-400" : "text-muted")}>{displayScore.toFixed(1)}</span>
            </div>
            <span className="text-[10px] text-muted">综合评分</span>
            <span className="text-[9px] text-muted/80">规则维度换算</span>
            {scoreOutOfSync && (
              <span className="mt-1 max-w-[140px] text-center text-[9px] leading-tight text-amber-600">
                存库分与 bundle 不一致，请重新研究同步
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleResearch}
          disabled={researching}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card-bg px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-blue-500/50 disabled:opacity-50"
        >
          {researching ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {researching ? "研究中..." : hasResearch ? "重新研究" : "AI 研究"}
        </button>

        {hasResearch && (
          <button
            onClick={handleGenerateOutreach}
            disabled={generating}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card-bg px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-blue-500/50 disabled:opacity-50"
          >
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {generating ? "生成中..." : p.outreachBody ? "重新生成开发信" : "生成开发信"}
          </button>
        )}

        {(p.stage === "interested" || p.stage === "negotiating" || p.stage === "qualified") && (
          <button
            onClick={() => router.push(`/trade/quotes/new?prospectId=${p.id}&companyName=${encodeURIComponent(p.companyName)}&contactName=${encodeURIComponent(p.contactName ?? "")}&contactEmail=${encodeURIComponent(p.contactEmail ?? "")}&country=${encodeURIComponent(p.country ?? "")}&campaignId=${p.campaignId}`)}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/20"
          >
            <FileText size={12} />
            创建报价单
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <MessageSquare size={12} className="shrink-0" />
          对话里研究请带
          <code className="max-w-[200px] truncate rounded bg-zinc-500/10 px-1 font-mono text-[10px] text-foreground">{id}</code>
        </span>
        <button
          type="button"
          onClick={handleCopyProspectId}
          className="flex items-center gap-0.5 text-blue-400 hover:underline"
        >
          {idCopied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
          {idCopied ? "已复制" : "复制 ID"}
        </button>
        <Link
          href={`/trade/chat?draft=${encodeURIComponent(
            `请用 trade_run_prospect_research 研究本条线索：prospectId 为 ${id}（${p.companyName}）。`,
          )}`}
          className="text-blue-400 hover:underline"
        >
          打开外贸对话（已预填）
        </Link>
      </div>

      {/* Quick Actions: Stage + Follow-up */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Stage switch */}
        <div className="flex items-center gap-1.5">
          <Edit3 size={10} className="text-muted" />
          {editingStage ? (
            <select
              defaultValue={p.stage}
              onChange={(e) => handleStageChange(e.target.value)}
              onBlur={() => setEditingStage(false)}
              autoFocus
              className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground focus:outline-none"
            >
              {Object.entries(STAGE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setEditingStage(true)}
              className="rounded-full px-2 py-0.5 text-[10px] text-muted transition hover:text-foreground"
            >
              切换阶段
            </button>
          )}
        </div>

        <span className="text-border">|</span>

        {/* Follow-up date */}
        <div className="flex items-center gap-1.5">
          <Calendar size={10} className="text-muted" />
          {editingFollowUp ? (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={newFollowUpDate}
                onChange={(e) => setNewFollowUpDate(e.target.value)}
                className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground focus:outline-none"
              />
              <button onClick={handleFollowUpChange} className="text-[10px] text-blue-400 hover:underline">确定</button>
              <button onClick={() => setEditingFollowUp(false)} className="text-[10px] text-muted hover:text-foreground">取消</button>
            </div>
          ) : (
            <button
              onClick={() => setEditingFollowUp(true)}
              className="rounded-full px-2 py-0.5 text-[10px] text-muted transition hover:text-foreground"
            >
              设置跟进时间
            </button>
          )}
        </div>

        <span className="text-border">|</span>

        {/* Send via channel */}
        <button
          onClick={() => setShowChannelSend(!showChannelSend)}
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-muted transition hover:text-foreground"
        >
          <MessageSquare size={10} />
          发消息
        </button>

        <span className="text-border">|</span>

        {/* Timeline toggle */}
        <button
          onClick={async () => {
            setShowTimeline(!showTimeline);
            if (!showTimeline && timeline.length === 0) await loadTimeline();
          }}
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-muted transition hover:text-foreground"
        >
          <History size={10} />
          操作记录
        </button>
      </div>

      {/* Channel Send Panel */}
      {showChannelSend && (
        <ChannelSendPanel prospectId={p.id} onSent={loadProspect} />
      )}

      {/* Timeline */}
      {showTimeline && timeline.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-4">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
            <History size={12} />
            操作记录
          </h3>
          <div className="space-y-1.5">
            {timeline.map((t) => (
              <div key={t.id} className="flex items-start gap-2 text-xs">
                <span className="shrink-0 text-[10px] text-muted">
                  {new Date(t.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="rounded bg-zinc-500/15 px-1 py-0.5 text-[10px] text-zinc-400">{t.action}</span>
                <span className="text-foreground">{t.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Score Reason + P2-alpha 维度 */}
      {(p.scoreReason || scoring) && (
        <div className="space-y-3">
          {p.scoreReason && (
            <div className="rounded-xl border border-border/60 bg-card-bg p-4">
              <h3 className="mb-1 text-xs font-medium text-muted">评分说明</h3>
              <p className="text-xs leading-relaxed text-foreground">{p.scoreReason}</p>
              <p className="mt-2 text-[10px] text-muted">
                总分为四维度加权规则换算，非预测结论；方括号内为可复核的来源 id。
              </p>
            </div>
          )}

          {scoring && scoring.dimensions.length > 0 && (
            <div className="rounded-xl border border-emerald-500/25 bg-card-bg p-4">
              <h3 className="mb-2 text-xs font-medium text-muted">四维度（规则打底）</h3>
              <ul className="space-y-2">
                {scoring.dimensions.map((d) => (
                  <li key={d.key} className="rounded-lg border border-border/50 bg-background/50 text-xs">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 px-2 py-1.5">
                      <span className="font-medium text-foreground">
                        {SCORE_DIM_LABELS[d.key] ?? d.key}
                      </span>
                      <span className="text-[10px] text-muted">
                        {d.score}/{d.max} 分
                      </span>
                    </div>
                    <p className="border-t border-border/40 px-2 py-1.5 text-[11px] leading-snug text-foreground/90">
                      {d.rationale}
                    </p>
                    <details className="border-t border-border/40 px-2 py-1">
                      <summary className="cursor-pointer text-[10px] text-blue-400 hover:underline">
                        查看依据链接（{d.evidenceIds.length} 条来源）
                      </summary>
                      {d.evidenceIds.length === 0 ? (
                        <p className="mt-1 text-[10px] text-muted">本维度无绑定来源片段。</p>
                      ) : (
                        <ul className="mt-1 space-y-1">
                          {d.evidenceIds.map((eid) => {
                            const src = researchSources.find((s) => s.id === eid);
                            if (!src) {
                              return (
                                <li key={eid} className="text-[10px] text-muted">
                                  {eid}（来源列表中未找到，可能为旧数据）
                                </li>
                              );
                            }
                            return (
                              <li key={eid}>
                                <span className="font-mono text-[10px] text-zinc-500">{eid}</span>
                                {" · "}
                                <a
                                  href={src.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="break-all text-[10px] text-blue-400 hover:underline"
                                >
                                  {src.title || src.url}
                                </a>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </details>
                  </li>
                ))}
              </ul>

              {scoring.researchScoreSignals.length > 0 && (
                <div className="mt-3 border-t border-border/40 pt-3">
                  <h4 className="mb-1 text-[10px] font-medium text-muted">公开摘录中的弱信号（非预测）</h4>
                  <ul className="space-y-1.5">
                    {scoring.researchScoreSignals.map((sig, idx) => (
                      <li key={`${sig.type}-${idx}`} className="text-[11px] text-foreground/90">
                        <span className="text-muted">[{sig.strength}]</span> {sig.label}：{sig.detail}
                        <details className="mt-0.5">
                          <summary className="cursor-pointer text-[10px] text-blue-400">来源</summary>
                          <ul className="mt-0.5 space-y-0.5">
                            {sig.evidenceIds.map((eid) => {
                              const src = researchSources.find((s) => s.id === eid);
                              if (!src) return null;
                              return (
                                <li key={eid}>
                                  <a
                                    href={src.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-blue-400 hover:underline"
                                  >
                                    {eid} — {src.title || src.url}
                                  </a>
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {scoring?.unknowns && scoring.unknowns.length > 0 && (
            <div className="rounded-xl border border-zinc-500/30 bg-card-bg p-4">
              <h3 className="mb-2 text-xs font-medium text-muted">信息缺口（保守表述）</h3>
              <p className="mb-2 text-[10px] leading-relaxed text-muted">
                以下仅表示在当前检索到的公开网页与摘要片段中<strong className="text-foreground/80">未明显看到</strong>相关内容，不代表对方一定不具备或不存在。
              </p>
              <ul className="space-y-2">
                {scoring.unknowns.map((u) => (
                  <li key={u.id} className="rounded-lg border border-border/40 bg-background/40 px-2 py-2 text-[11px]">
                    <span className="font-medium text-foreground">{u.topic}</span>
                    <p className="mt-1 leading-snug text-foreground/85">{u.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isSuperAdmin && scoring?.debug && (
            <details className="rounded-xl border border-amber-500/25 bg-zinc-950/40 p-3 text-[10px] text-muted">
              <summary className="cursor-pointer font-medium text-amber-200/90">
                评分调试（内部）
              </summary>
              <p className="mt-2 font-mono leading-relaxed text-foreground/80">
                {scoring.debug.formula}
              </p>
              <p className="mt-1.5 text-foreground/70">{scoring.debug.weightNotes}</p>
              <ul className="mt-2 space-y-1 border-t border-border/30 pt-2">
                {scoring.debug.dimensionLines.map((row) => (
                  <li key={row.key}>
                    <span className="text-amber-200/80">{row.key}</span>
                    <span className="text-foreground/75"> · {row.line}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* P1-alpha：页面监控试点（与研究报告独立） */}
      <div className="rounded-xl border border-amber-500/30 bg-card-bg p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-amber-500" />
          <h3 className="text-sm font-medium text-foreground">页面监控（试点）</h3>
          <span className="text-[10px] text-muted">低频文本指纹 · 弱信号需人工核对</span>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="url"
            value={watchUrl}
            onChange={(e) => setWatchUrl(e.target.value)}
            placeholder="https://…"
            className="min-w-[200px] flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
          />
          <select
            value={watchPageType}
            onChange={(e) => setWatchPageType(e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
          >
            {WATCH_PAGE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleAddWatch()}
            disabled={watchBusy || !watchUrl.trim()}
            className="flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {watchBusy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            添加
          </button>
        </div>
        {watchTargets.length > 0 && (
          <ul className="space-y-2 border-t border-border/40 pt-3">
            {watchTargets.map((w) => (
              <li
                key={w.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-2 py-2 text-xs"
              >
                <label className="flex items-center gap-1 text-muted">
                  <input
                    type="checkbox"
                    checked={w.isActive}
                    onChange={(e) => void handleToggleWatch(w.id, e.target.checked)}
                  />
                  启用
                </label>
                <span className="rounded bg-zinc-500/15 px-1 py-0.5 text-[10px]">{w.pageType}</span>
                <a href={w.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-blue-400 hover:underline">
                  {w.url}
                </a>
                <span className="text-[10px] text-muted">
                  {w.lastCheckedAt
                    ? `查 ${new Date(w.lastCheckedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`
                    : "未检查"}
                </span>
                <span className="text-[10px] text-muted">
                  {w.lastFetchError
                    ? `上次抓取：失败（${w.lastFetchError}）`
                    : w.lastCheckedAt
                      ? "上次抓取：成功"
                      : "尚未成功抓取"}
                </span>
                {w.lastChangedAt && (
                  <span className="text-[10px] text-muted">
                    上次内容变化：{new Date(w.lastChangedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void handleCheckWatch(w.id)}
                  disabled={checkingWatchId === w.id}
                  className="rounded border border-border px-2 py-0.5 text-[10px] hover:border-amber-500/50 disabled:opacity-50"
                >
                  {checkingWatchId === w.id ? <Loader2 size={10} className="animate-spin inline" /> : null}
                  检查
                </button>
                <button
                  type="button"
                  onClick={() => void handleRebaselineWatch(w.id)}
                  disabled={rebaselineWatchId === w.id}
                  className="flex items-center gap-0.5 rounded border border-border px-2 py-0.5 text-[10px] hover:border-emerald-500/50 disabled:opacity-50"
                  title="以当前页面内容为新基线，不产生信号"
                >
                  {rebaselineWatchId === w.id ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                  重置基线
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteWatch(w.id)}
                  className="p-0.5 text-muted hover:text-red-400"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {signals.length > 0 && (
          <div className="border-t border-border/40 pt-3">
            <h4 className="mb-2 text-xs font-medium text-muted">最近变化信号</h4>
            <ul className="space-y-2">
              {signals.map((s) => {
                const ev = s.evidenceJson;
                const evUrl =
                  ev &&
                  typeof ev === "object" &&
                  "url" in ev &&
                  typeof (ev as { url?: unknown }).url === "string"
                    ? (ev as { url: string }).url
                    : null;
                return (
                <li key={s.id} className="rounded-lg border border-border/40 bg-background/50 px-2 py-2 text-xs">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">{s.title}</span>
                    <span className="text-[10px] text-muted">
                      {new Date(s.createdAt).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-foreground/90">{s.description}</p>
                  {evUrl ? (
                    <a
                      href={evUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-[10px] text-blue-400 hover:underline"
                    >
                      打开监测 URL
                    </a>
                  ) : null}
                </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {/* Research Report */}
      {hasResearch && report && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-4">
          <div className="mb-3 flex items-center gap-2">
            <FileText size={14} className="text-blue-400" />
            <h3 className="text-sm font-medium text-foreground">AI 研究报告</h3>
          </div>
          <div className="space-y-3">
            {Object.entries(REPORT_LABELS).map(([key, label]) => {
              const value = report[key as keyof ResearchReport];
              if (!value) return null;
              const refs = fieldSourceIds?.[key as keyof ResearchReport];
              return (
                <div key={key}>
                  <h4 className="mb-0.5 text-xs font-medium text-muted">{label}</h4>
                  {refs && refs.length > 0 && (
                    <p className="mb-0.5 text-[10px] text-muted">引用：{refs.join(", ")}</p>
                  )}
                  <p className="whitespace-pre-wrap text-sm text-foreground">{value}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {researchSources.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-4">
          <div className="mb-2 flex items-center gap-2">
            <Globe size={14} className="text-amber-500" />
            <h3 className="text-sm font-medium text-foreground">参考来源</h3>
            <span className="text-[10px] text-muted">（搜索 / 官网 / 关键站内页）</span>
          </div>
          <ul className="space-y-2">
            {researchSources.map((s) => (
              <li key={s.id} className="rounded-lg border border-border/50 bg-background/80 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[10px] text-muted">{s.id}</span>
                  <span className="rounded bg-zinc-500/15 px-1 py-0.5 text-[10px] text-muted">
                    {researchSourceKindLabel(s.kind)}
                  </span>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 font-medium text-blue-400 hover:underline break-all"
                  >
                    {s.title}
                  </a>
                </div>
                {s.snippet && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-muted">{s.snippet}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Outreach Draft */}
      {p.outreachSubject && p.outreachBody && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail size={14} className="text-violet-400" />
              <h3 className="text-sm font-medium text-foreground">
                {p.outreachSentAt ? "已发送的开发信" : "开发信草稿"}
              </h3>
              {p.outreachSentAt && (
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-400">
                  已发送 {new Date(p.outreachSentAt).toLocaleDateString("zh-CN")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopyEmail}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition hover:text-foreground"
              >
                {copied ? <CheckCircle2 size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {copied ? "已复制" : "复制"}
              </button>
            </div>
          </div>
          <div className="rounded-lg bg-background p-3">
            <p className="mb-2 text-xs font-medium text-muted">Subject: {p.outreachSubject}</p>
            <div className="whitespace-pre-wrap text-sm text-foreground">{p.outreachBody}</div>
          </div>

          {/* Send Actions */}
          {!p.outreachSentAt && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {p.contactEmail && (
                <button
                  onClick={() => handleSend("send")}
                  disabled={sending}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
                >
                  {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  发送到 {p.contactEmail}
                </button>
              )}
              <button
                onClick={() => handleSend("mark_sent")}
                disabled={sending}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-blue-500/50 disabled:opacity-50"
              >
                <CheckCircle2 size={12} />
                标记为已发送
              </button>
            </div>
          )}
        </div>
      )}

      {/* Follow-up Info */}
      {(p.stage === "outreach_sent" || p.stage === "replied" || p.stage === "interested" || p.stage === "negotiating") && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-4">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-amber-400" />
            <h3 className="text-sm font-medium text-foreground">跟进状态</h3>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted">
            <span>已跟进 {p.followUpCount} 次</span>
            {p.outreachSentAt && <span>首次联系: {new Date(p.outreachSentAt).toLocaleDateString("zh-CN")}</span>}
          </div>
        </div>
      )}

      {/* Record Reply Section */}
      {(p.stage === "outreach_sent" || p.stage === "replied" || p.stage === "interested" || p.stage === "negotiating" || p.stage === "no_response") && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare size={14} className="text-cyan-400" />
              <h3 className="text-sm font-medium text-foreground">记录客户回复</h3>
            </div>
            {!showReplyForm && (
              <button
                onClick={() => setShowReplyForm(true)}
                className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-foreground transition hover:border-blue-500/50"
              >
                <Plus size={12} />
                添加回复
              </button>
            )}
          </div>

          {showReplyForm && (
            <div className="space-y-2">
              <input
                value={replySubject}
                onChange={(e) => setReplySubject(e.target.value)}
                placeholder="邮件主题（可选）"
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
              />
              <textarea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                rows={4}
                placeholder="粘贴客户回复的邮件内容，AI 将自动分析意图并生成建议回复..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => { setShowReplyForm(false); setReplyContent(""); setReplySubject(""); }}
                  className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground"
                >
                  取消
                </button>
                <button
                  onClick={handleSubmitReply}
                  disabled={submittingReply || !replyContent.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50"
                >
                  {submittingReply ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {submittingReply ? "AI 分析中..." : "提交 + AI 分析"}
                </button>
              </div>
            </div>
          )}

          {/* AI Classification Result */}
          {replyResult && (
            <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
              <div className="flex items-center gap-2">
                <AlertCircle size={12} className="text-cyan-400" />
                <span className="text-xs font-medium text-cyan-400">AI 分析结果</span>
              </div>
              <div className="mt-2 space-y-1 text-xs text-foreground">
                <p><span className="text-muted">意图：</span>{INTENT_LABELS[replyResult.intent] ?? replyResult.intent}</p>
                <p><span className="text-muted">建议：</span>{replyResult.suggestedAction}</p>
              </div>
              {replyResult.draftReply && (
                <div className="mt-2">
                  <p className="mb-1 text-[10px] text-muted">AI 建议回复草稿：</p>
                  <div className="rounded-lg bg-background p-2 text-xs text-foreground whitespace-pre-wrap">
                    {replyResult.draftReply}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages / Conversation */}
      {p.messages.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">对话记录</h3>
          <div className="space-y-2">
            {p.messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "rounded-lg px-3 py-2 text-sm",
                  m.direction === "outbound"
                    ? "ml-8 bg-blue-500/10 text-foreground"
                    : "mr-8 bg-background text-foreground",
                )}
              >
                <div className="mb-0.5 flex items-center gap-2 text-[10px] text-muted">
                  <span>{m.direction === "outbound" ? "发出" : "收到"}</span>
                  <span>{m.channel}</span>
                  {m.intent && (
                    <span className="rounded bg-zinc-500/20 px-1 py-0.5">{m.intent}</span>
                  )}
                  <span>{new Date(m.createdAt).toLocaleString("zh-CN")}</span>
                </div>
                {m.subject && <p className="mb-1 text-xs font-medium">{m.subject}</p>}
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State for no report */}
      {!hasResearch && (
        <div className="rounded-xl border border-dashed border-border bg-card-bg px-8 py-12 text-center">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="text-sm text-muted">点击「AI 研究」按钮，AI 将自动搜索该公司信息并生成研究报告和评分</p>
        </div>
      )}
    </div>
  );
}

function ChannelSendPanel({ prospectId, onSent }: { prospectId: string; onSent: () => void }) {
  const [channel, setChannel] = useState("whatsapp");
  const [to, setTo] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleSend = async () => {
    if (!to.trim() || !content.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const res = await apiFetch(`/api/trade/channels/${channel}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: "default", prospectId, to, content }),
      });
      if (res.ok) {
        setResult("发送成功");
        setContent("");
        onSent();
      } else {
        const data = await res.json();
        setResult(data.error ?? "发送失败");
      }
    } catch {
      setResult("网络错误");
    } finally {
      setSending(false);
    }
  };

  const CHANNELS = [
    { value: "whatsapp", label: "WhatsApp" },
    { value: "wechat", label: "微信" },
    { value: "wechat_work", label: "企业微信" },
  ];

  return (
    <div className="rounded-xl border border-border/60 bg-card-bg p-4">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-medium text-foreground">
        <MessageSquare size={12} />
        通过消息通道发送
      </h3>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none">
            {CHANNELS.map((ch) => (
              <option key={ch.value} value={ch.value}>{ch.label}</option>
            ))}
          </select>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={channel === "whatsapp" ? "+86138xxxx / +1xxxx" : "OpenID / 用户ID"}
            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
          />
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder="消息内容..."
          className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
        />
        <div className="flex items-center justify-between">
          {result && <span className={cn("text-[10px]", result === "发送成功" ? "text-emerald-400" : "text-red-400")}>{result}</span>}
          <button
            onClick={handleSend}
            disabled={sending || !to.trim() || !content.trim()}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
