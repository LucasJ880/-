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
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import {
  parseResearchBundle,
  type ResearchReport,
  type ScoringProfileV1,
} from "@/lib/trade/research-bundle";
import {
  effectiveResearchStatusDisplay,
  isEvidenceWeakDisplay,
} from "@/lib/trade/research-status-display";
import type { WebsiteCandidateJson } from "@/lib/trade/website-candidate-scoring";
import {
  TRADE_PROSPECT_STAGE_OPTIONS,
  getTradeProspectStageLabel,
  getTradeProspectStageTone,
  normalizeTradeProspectStage,
} from "@/lib/trade/stage";
import { ConvertTradeQuoteToSalesQuoteDialog } from "../../convert-trade-quote-to-sales-dialog";

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
  researchStatus: string | null;
  websiteCandidates: unknown;
  websiteConfidence: number | null;
  websiteCandidateSource: string | null;
  websiteVerifiedAt: string | null;
  websiteVerifiedBy: string | null;
  researchWarnings: unknown;
  crawlStatus: string | null;
  crawlSourceType: string | null;
  sourcesCount: number | null;
  lastResearchError: string | null;
  lastResearchedAt: string | null;
  outreachSubject: string | null;
  outreachBody: string | null;
  outreachLang: string | null;
  outreachSentAt: string | null;
  followUpCount: number;
  createdAt: string;
  convertedToSalesCustomerId?: string | null;
  convertedToSalesOpportunityId?: string | null;
  convertedAt?: string | null;
  convertedById?: string | null;
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

interface SalesConversionPreview {
  prospectSummary: {
    id: string;
    companyName: string;
    contactName: string | null;
    contactEmail: string | null;
    website: string | null;
    country: string | null;
    stage: string;
    stageNormalized: string;
    score: number | null;
    researchStatus: string | null;
    campaignName: string;
  };
  proposedCustomer: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    notes: string | null;
  };
  proposedOpportunity: { title: string; stage: string; estimatedValue: number | null; notes: string };
  existingCustomerCandidates: { id: string; name: string; email: string | null; matchReason: string }[];
  existingOpportunityCandidates: { id: string; title: string; stage: string; customerId: string }[];
  latestTradeQuote: { id: string; quoteNumber: string; status: string; totalAmount: number; currency: string } | null;
  warnings: string[];
  canConvert: boolean;
  alreadyConverted: boolean;
  converted: {
    salesCustomerId: string | null;
    salesOpportunityId: string | null;
    convertedAt: string | null;
    convertedById: string | null;
  } | null;
}

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
  const { user, isSuperAdmin } = useCurrentUser();
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
  const [researchBanner, setResearchBanner] = useState<string | null>(null);
  const [confirmUrl, setConfirmUrl] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [salesModalOpen, setSalesModalOpen] = useState(false);
  const [salesPreview, setSalesPreview] = useState<SalesConversionPreview | null>(null);
  const [salesPreviewLoading, setSalesPreviewLoading] = useState(false);
  const [salesMode, setSalesMode] = useState<"create_new" | "use_existing_customer">("create_new");
  const [salesPickCustomerId, setSalesPickCustomerId] = useState("");
  const [salesCreateOpp, setSalesCreateOpp] = useState(true);
  const [salesIncludeQuote, setSalesIncludeQuote] = useState(false);
  const [salesConvertBusy, setSalesConvertBusy] = useState(false);
  const [salesConvertError, setSalesConvertError] = useState<string | null>(null);
  const [tradeQuotes, setTradeQuotes] = useState<
    Array<{ id: string; quoteNumber: string; status: string; totalAmount: number; currency: string }>
  >([]);
  const [tradeQuotesLoading, setTradeQuotesLoading] = useState(false);
  const [sqConvQuoteId, setSqConvQuoteId] = useState<string | null>(null);

  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();

  const loadProspect = useCallback(async () => {
    if (!orgId || ambiguous) {
      setProspect(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await apiFetch(`/api/trade/prospects/${id}?orgId=${encodeURIComponent(orgId)}`);
    if (res.ok) setProspect(await res.json());
    else setProspect(null);
    setLoading(false);
  }, [id, orgId, ambiguous]);

  useEffect(() => {
    if (orgLoading) return;
    if (!orgId || ambiguous) {
      setProspect(null);
      setLoading(false);
      return;
    }
    void loadProspect();
  }, [loadProspect, orgId, ambiguous, orgLoading]);

  const loadTradeQuotes = useCallback(async () => {
    if (!orgId || ambiguous) {
      setTradeQuotes([]);
      return;
    }
    setTradeQuotesLoading(true);
    try {
      const res = await apiFetch(
        `/api/trade/quotes?prospectId=${encodeURIComponent(id)}&orgId=${encodeURIComponent(orgId)}`,
      );
      if (!res.ok) {
        setTradeQuotes([]);
        return;
      }
      const raw = (await res.json()) as unknown;
      const rows = Array.isArray(raw) ? raw : [];
      setTradeQuotes(
        rows.map((q: { id: string; quoteNumber: string; status: string; totalAmount: number; currency: string }) => ({
          id: q.id,
          quoteNumber: q.quoteNumber,
          status: q.status,
          totalAmount: q.totalAmount,
          currency: q.currency,
        })),
      );
    } finally {
      setTradeQuotesLoading(false);
    }
  }, [id, orgId, ambiguous]);

  useEffect(() => {
    if (orgLoading) return;
    if (!orgId || ambiguous) return;
    void loadTradeQuotes();
  }, [loadTradeQuotes, orgId, ambiguous, orgLoading]);

  const openSalesModal = useCallback(async () => {
    if (!orgId || ambiguous) return;
    setSalesConvertError(null);
    setSalesModalOpen(true);
    setSalesPreviewLoading(true);
    setSalesPreview(null);
    setSalesMode("create_new");
    setSalesPickCustomerId("");
    setSalesCreateOpp(true);
    setSalesIncludeQuote(false);
    try {
      const res = await apiFetch(
        `/api/trade/prospects/${id}/conversion-preview?orgId=${encodeURIComponent(orgId)}`,
      );
      const data = (await res.json()) as SalesConversionPreview & { error?: string };
      if (!res.ok) {
        setSalesConvertError(data.error ?? `预览失败（${res.status}）`);
        return;
      }
      setSalesPreview(data);
      const first = data.existingCustomerCandidates?.[0];
      if (first) setSalesPickCustomerId(first.id);
    } finally {
      setSalesPreviewLoading(false);
    }
  }, [id, orgId, ambiguous]);

  const loadWatchData = useCallback(async () => {
    if (!orgId || ambiguous) {
      setWatchTargets([]);
      setSignals([]);
      return;
    }
    const q = encodeURIComponent(orgId);
    const [r1, r2] = await Promise.all([
      apiFetch(`/api/trade/watch-targets?orgId=${q}&prospectId=${encodeURIComponent(id)}`),
      apiFetch(`/api/trade/signals?orgId=${q}&prospectId=${encodeURIComponent(id)}&limit=20`),
    ]);
    if (r1.ok) {
      const d = (await r1.json()) as { items?: WatchTargetRow[] };
      setWatchTargets(d.items ?? []);
    }
    if (r2.ok) {
      const d = (await r2.json()) as { items?: SignalRow[] };
      setSignals(d.items ?? []);
    }
  }, [id, orgId, ambiguous]);

  useEffect(() => {
    if (orgLoading) return;
    if (!orgId || ambiguous) {
      setWatchTargets([]);
      setSignals([]);
      return;
    }
    void loadWatchData();
  }, [loadWatchData, orgId, ambiguous, orgLoading]);

  const handleAddWatch = async () => {
    if (!watchUrl.trim() || !orgId || ambiguous) return;
    setWatchBusy(true);
    try {
      const res = await apiFetch("/api/trade/watch-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
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
        `/api/trade/watch-targets/${targetId}/check?orgId=${encodeURIComponent(orgId!)}`,
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
        `/api/trade/watch-targets/${targetId}/rebaseline?orgId=${encodeURIComponent(orgId!)}`,
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
    await apiFetch(`/api/trade/watch-targets/${targetId}?orgId=${encodeURIComponent(orgId!)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    await loadWatchData();
  };

  const handleDeleteWatch = async (targetId: string) => {
    if (!confirm("确定删除该监控 URL？")) return;
    await apiFetch(`/api/trade/watch-targets/${targetId}?orgId=${encodeURIComponent(orgId!)}`, {
      method: "DELETE",
    });
    await loadWatchData();
  };

  const handleConfirmSalesConvert = async () => {
    if (!orgId || ambiguous) return;
    if (salesMode === "use_existing_customer" && !salesPickCustomerId.trim()) {
      setSalesConvertError("请选择已有销售客户");
      return;
    }
    setSalesConvertBusy(true);
    setSalesConvertError(null);
    try {
      const res = await apiFetch(`/api/trade/prospects/${id}/convert-to-sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          mode: salesMode,
          salesCustomerId: salesMode === "use_existing_customer" ? salesPickCustomerId : undefined,
          createOpportunity: salesCreateOpp,
          includeLatestTradeQuote: salesIncludeQuote,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setSalesConvertError(j.error ?? `转换失败（${res.status}）`);
        return;
      }
      setSalesModalOpen(false);
      setSalesPreview(null);
      await loadProspect();
      await loadTradeQuotes();
    } finally {
      setSalesConvertBusy(false);
    }
  };

  const handleResearch = async () => {
    if (!orgId || ambiguous) return;
    setResearching(true);
    setResearchBanner(null);
    try {
      let researchUrl = `/api/trade/prospects/${id}/research?orgId=${encodeURIComponent(orgId)}`;
      if (isSuperAdmin) researchUrl += "&debugScore=1";
      const res = await apiFetch(researchUrl, { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        researchBundle?: unknown;
      };
      if (res.ok && j.researchBundle) {
        await loadProspect();
        return;
      }
      if (res.ok && (j.code === "website_confirmation_needed" || j.code === "website_needed")) {
        setResearchBanner(j.error ?? "请先确认或补充官网");
        await loadProspect();
        return;
      }
      setResearchBanner(j.error ?? `研究请求失败（${res.status}）`);
      await loadProspect();
    } finally {
      setResearching(false);
    }
  };

  const handleConfirmWebsite = async () => {
    if (!orgId || ambiguous || !confirmUrl.trim()) return;
    setConfirmBusy(true);
    try {
      const res = await apiFetch(`/api/trade/prospects/${id}/confirm-website`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, website: confirmUrl.trim() }),
      });
      if (res.ok) {
        setConfirmUrl("");
        setResearchBanner(null);
        await loadProspect();
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? "确认失败");
      }
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleGenerateOutreach = async () => {
    if (!orgId || ambiguous) return;
    setGenerating(true);
    try {
      await apiFetch(`/api/trade/prospects/${id}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      await loadProspect();
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async (mode: "send" | "mark_sent") => {
    if (!orgId || ambiguous) return;
    setSending(true);
    try {
      const res = await apiFetch(`/api/trade/prospects/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, orgId }),
      });
      if (res.ok) await loadProspect();
    } finally {
      setSending(false);
    }
  };

  const handleSubmitReply = async () => {
    if (!replyContent.trim() || !orgId || ambiguous) return;
    setSubmittingReply(true);
    setReplyResult(null);
    try {
      const res = await apiFetch(`/api/trade/prospects/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: replyContent,
          subject: replySubject || undefined,
          orgId,
        }),
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
    if (!orgId || ambiguous) return;
    await apiFetch(`/api/trade/prospects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: newStage, orgId }),
    });
    setEditingStage(false);
    await loadProspect();
  };

  const handleFollowUpChange = async () => {
    if (!newFollowUpDate || !orgId || ambiguous) return;
    await apiFetch(`/api/trade/prospects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nextFollowUpAt: new Date(newFollowUpDate).toISOString(),
        orgId,
      }),
    });
    setEditingFollowUp(false);
    setNewFollowUpDate("");
    await loadProspect();
  };

  const loadTimeline = async () => {
    if (!orgId || ambiguous) return;
    const res = await apiFetch(`/api/trade/prospects/${id}/timeline?orgId=${encodeURIComponent(orgId)}`);
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

  if (orgLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!orgId || ambiguous) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted">请先选择当前组织后再查看该线索。</p>
        <button
          type="button"
          onClick={() => router.push("/organizations")}
          className="text-sm text-accent underline-offset-2 hover:underline"
        >
          前往组织
        </button>
      </div>
    );
  }

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
  const stageN = normalizeTradeProspectStage(p.stage);
  const showFollowUpFlow =
    ["contacted", "replied", "quoted", "follow_up"].includes(stageN) || !!p.outreachSentAt;
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

  const researchWarnings: string[] =
    Array.isArray(p.researchWarnings) && p.researchWarnings.every((x) => typeof x === "string")
      ? (p.researchWarnings as string[])
      : [];
  const researchDisplayStatus = effectiveResearchStatusDisplay({
    researchStatus: p.researchStatus,
    stage: p.stage,
    score: p.score,
    website: p.website,
    researchReport: p.researchReport,
  });
  const evidenceWeak = isEvidenceWeakDisplay(researchDisplayStatus, researchWarnings);
  const researchIncomplete =
    researchDisplayStatus === "website_candidates_found" ||
    researchDisplayStatus === "low_confidence" ||
    researchDisplayStatus === "website_needed" ||
    researchDisplayStatus === "researching";
  const candidates: WebsiteCandidateJson[] = Array.isArray(p.websiteCandidates)
    ? (p.websiteCandidates as WebsiteCandidateJson[])
    : [];
  const needsConfirm =
    p.researchStatus === "website_candidates_found" || p.researchStatus === "low_confidence";

  const WEBSITE_SOURCE_LABELS: Record<string, string> = {
    user_provided: "用户填写",
    imported: "导入",
    serper_auto_high_confidence: "搜索自动（高置信）",
    serper_candidates_pending: "搜索候选（待确认）",
    manual_confirmed: "人工确认",
  };

  const RESEARCH_STATUS_LABELS_DETAIL: Record<string, string> = {
    pending: "待研究",
    scored: "已打分",
    unscored: "未打分",
    researched: "已研究",
    researched_with_warnings: "已研究（有告警）",
    research_pending: "待研究",
    researching: "研究中",
    website_needed: "需补充官网",
    website_candidates_found: "待确认官网",
    website_confirmed: "官网已确认",
    low_confidence: "官网低置信",
    failed: "研究失败",
    new: "新建",
    unknown: "未知",
  };

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
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", getTradeProspectStageTone(p.stage))}>
              {getTradeProspectStageLabel(p.stage)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
            {p.contactName && (
              <span className="flex items-center gap-1"><User size={10} />{p.contactName}{p.contactTitle ? ` · ${p.contactTitle}` : ""}</span>
            )}
            {p.country && <span className="flex items-center gap-1"><Globe size={10} />{p.country}</span>}
            {p.contactEmail && <span className="flex items-center gap-1"><Mail size={10} />{p.contactEmail}</span>}
            {p.website && (() => {
              try {
                const u = p.website!.startsWith("http") ? p.website! : `https://${p.website}`;
                return (
                  <a href={u} target="_blank" rel="noopener" className="flex items-center gap-1 text-blue-400 hover:underline">
                    <Building2 size={10} />{new URL(u).hostname}
                  </a>
                );
              } catch {
                return (
                  <span className="flex items-center gap-1 text-muted">
                    <Building2 size={10} />{p.website}
                  </span>
                );
              }
            })()}
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
        {researchIncomplete && (
          <span className="self-center text-[10px] text-amber-400">
            当前未完成可采信研究，请先处理官网与证据后再依赖分数/报告。
          </span>
        )}

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

        {(stageN === "qualified" ||
          stageN === "contacted" ||
          stageN === "replied" ||
          stageN === "quoted" ||
          stageN === "follow_up") && (
          <button
            onClick={() => router.push(`/trade/quotes/new?prospectId=${p.id}&companyName=${encodeURIComponent(p.companyName)}&contactName=${encodeURIComponent(p.contactName ?? "")}&contactEmail=${encodeURIComponent(p.contactEmail ?? "")}&country=${encodeURIComponent(p.country ?? "")}&campaignId=${p.campaignId}`)}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/20"
          >
            <FileText size={12} />
            创建报价单
          </button>
        )}
      </div>

      {/* 转入销售 CRM */}
      <div className="rounded-xl border border-border/60 bg-card-bg p-4">
        <div className="mb-2 flex items-center gap-2">
          <Building2 size={14} className="text-violet-400" />
          <h3 className="text-sm font-medium text-foreground">销售 CRM</h3>
        </div>
        {p.convertedToSalesCustomerId || p.convertedAt ? (
          <div className="space-y-2 text-xs text-muted">
            <p className="font-medium text-emerald-400">已转销售</p>
            {p.convertedAt && (
              <p>
                转换时间：{new Date(p.convertedAt).toLocaleString("zh-CN")}
                {p.convertedById && user?.id === p.convertedById ? "（本人）" : p.convertedById ? ` · 操作人 ${p.convertedById.slice(0, 8)}…` : ""}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {p.convertedToSalesCustomerId && (
                <Link
                  href={`/sales/customers/${p.convertedToSalesCustomerId}`}
                  className="inline-flex rounded-lg border border-violet-500/40 px-2 py-1 text-violet-300 hover:bg-violet-500/10"
                >
                  打开销售客户
                </Link>
              )}
            </div>
            {p.convertedToSalesOpportunityId && (
              <p className="font-mono text-[10px] text-muted/90">
                商机 ID：{p.convertedToSalesOpportunityId}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">
              将成熟线索转为销售客户与商机（需确认，不会自动执行）。
            </p>
            <button
              type="button"
              onClick={() => void openSalesModal()}
              className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
            >
              Convert to Sales CRM
            </button>
          </div>
        )}
      </div>

      {/* 外贸报价单 → 销售报价 */}
      <div className="rounded-xl border border-border/60 bg-card-bg p-4">
        <div className="mb-2 flex items-center gap-2">
          <FileText size={14} className="text-emerald-400" />
          <h3 className="text-sm font-medium text-foreground">外贸报价单</h3>
        </div>
        {tradeQuotesLoading ? (
          <div className="flex py-6 justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        ) : tradeQuotes.length === 0 ? (
          <p className="text-xs text-muted">暂无报价单。可在上方「创建报价单」新建。</p>
        ) : (
          <ul className="space-y-2">
            {tradeQuotes.map((q) => (
              <li
                key={q.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/40 px-3 py-2 text-xs"
              >
                <div>
                  <Link href={`/trade/quotes/${q.id}`} className="font-mono text-blue-400 hover:underline">
                    {q.quoteNumber}
                  </Link>
                  <span className="ml-2 text-muted">{q.status}</span>
                  <span className="ml-2 text-foreground">
                    {q.currency}{" "}
                    {q.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {p.convertedToSalesCustomerId ? (
                    <button
                      type="button"
                      className="rounded border border-violet-500/40 px-2 py-1 text-violet-300 hover:bg-violet-500/10"
                      onClick={() => setSqConvQuoteId(q.id)}
                    >
                      转为销售报价
                    </button>
                  ) : (
                    <span className="text-[10px] text-muted">请先将该线索转入 Sales CRM，再转换报价。</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
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

      {researchBanner && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {researchBanner}
        </div>
      )}

      {/* 研究可信度与官网候选 */}
      <div className="rounded-xl border border-border/60 bg-card-bg p-4 space-y-3">
        <h3 className="text-xs font-medium text-muted">研究可信度</h3>
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <span className="text-muted">研究状态：</span>
            <span className="text-foreground">
              {RESEARCH_STATUS_LABELS_DETAIL[researchDisplayStatus] ?? researchDisplayStatus}
            </span>
            {p.researchStatus == null && (
              <span className="ml-1 text-[10px] text-muted">（历史推断）</span>
            )}
          </div>
          <div>
            <span className="text-muted">官网置信度：</span>
            <span className="text-foreground">
              {p.websiteConfidence != null ? `${(p.websiteConfidence * 100).toFixed(0)}%` : "—"}
            </span>
          </div>
          <div className="sm:col-span-2">
            <span className="text-muted">官网来源：</span>
            <span className="text-foreground">
              {p.websiteCandidateSource
                ? WEBSITE_SOURCE_LABELS[p.websiteCandidateSource] ?? p.websiteCandidateSource
                : "—"}
            </span>
            {p.websiteVerifiedAt && (
              <span className="ml-2 text-[10px] text-muted">
                确认于 {new Date(p.websiteVerifiedAt).toLocaleString("zh-CN")}
                {p.websiteVerifiedBy ? ` · ${p.websiteVerifiedBy}` : ""}
              </span>
            )}
          </div>
          <div>
            <span className="text-muted">抓取状态：</span>
            <span className="font-mono text-[11px] text-foreground">{p.crawlStatus ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted">内容来源类型：</span>
            <span className="font-mono text-[11px] text-foreground">{p.crawlSourceType ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted">来源条数：</span>
            <span className="text-foreground">{p.sourcesCount ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted">上次研究时间：</span>
            <span className="text-foreground">
              {p.lastResearchedAt ? new Date(p.lastResearchedAt).toLocaleString("zh-CN") : "—"}
            </span>
          </div>
        </div>
        {researchWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-100">
            <span className="font-medium text-amber-300">告警 </span>
            {researchWarnings.join(" · ")}
          </div>
        )}
        {evidenceWeak && hasResearch && (
          <p className="text-[11px] font-medium text-amber-300">
            证据不足或抓取受限：以下报告请谨慎采信，建议补充站内页或确认官网后再研究。
          </p>
        )}
        {p.lastResearchError && (
          <p className="text-[11px] text-red-300">
            上次错误：{p.lastResearchError}
          </p>
        )}
        {candidates.length > 0 && (
          <div className="space-y-2 border-t border-border/40 pt-3">
            <h4 className="text-[11px] font-medium text-muted">搜索引擎候选官网</h4>
            <ul className="space-y-2">
              {candidates.map((c, idx) => (
                <li key={`${c.url}-${idx}`} className="rounded-lg border border-border/50 bg-background/60 p-2 text-[11px]">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-blue-300">{c.domain}</span>
                    <span className="text-muted">置信 {(c.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <p className="mt-0.5 text-foreground/90">{c.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-muted">{c.snippet}</p>
                  <p className="mt-1 text-[10px] text-muted">
                    {c.reasons.join("；")}
                    {c.rejectedReason ? ` · 排除：${c.rejectedReason}` : ""}
                  </p>
                  <button
                    type="button"
                    className="mt-1 text-[10px] text-blue-400 hover:underline"
                    onClick={() => setConfirmUrl(c.url)}
                  >
                    填入此 URL
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {needsConfirm && (
          <div className="flex flex-col gap-2 border-t border-border/40 pt-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[10px] text-muted">确认官网 URL</label>
              <input
                value={confirmUrl}
                onChange={(e) => setConfirmUrl(e.target.value)}
                placeholder="https://…"
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
              />
            </div>
            <button
              type="button"
              disabled={confirmBusy || !confirmUrl.trim()}
              onClick={() => void handleConfirmWebsite()}
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {confirmBusy ? <Loader2 className="h-3 w-3 animate-spin inline" /> : null}
              确认官网
            </button>
          </div>
        )}
      </div>

      {/* Quick Actions: Stage + Follow-up */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Stage switch */}
        <div className="flex items-center gap-1.5">
          <Edit3 size={10} className="text-muted" />
          {editingStage ? (
            <select
              defaultValue={stageN}
              onChange={(e) => handleStageChange(e.target.value)}
              onBlur={() => setEditingStage(false)}
              autoFocus
              className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground focus:outline-none"
            >
              {TRADE_PROSPECT_STAGE_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
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
        <ChannelSendPanel prospectId={p.id} orgId={orgId} onSent={loadProspect} />
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
            <h3 className="text-sm font-medium text-foreground">
              AI 研究报告
              {evidenceWeak && <span className="ml-2 text-[10px] font-normal text-amber-400">（证据有限）</span>}
            </h3>
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
      {showFollowUpFlow && (
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
      {showFollowUpFlow && (
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
          <p className="text-sm text-muted">
            {researchDisplayStatus === "website_candidates_found" || researchDisplayStatus === "low_confidence"
              ? "请先在上方确认官网后再执行「AI 研究」。"
              : researchDisplayStatus === "website_needed"
                ? "请先补充官网 URL，或在候选列表中确认后再研究。"
                : "点击「AI 研究」按钮，AI 将基于已确认官网与公开来源生成研究报告和评分"}
          </p>
        </div>
      )}

      {salesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card-bg p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">转入销售 CRM</h3>
              <button
                type="button"
                className="text-xs text-muted hover:text-foreground"
                onClick={() => {
                  setSalesModalOpen(false);
                  setSalesPreview(null);
                }}
              >
                关闭
              </button>
            </div>
            {salesPreviewLoading && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted" />
              </div>
            )}
            {salesConvertError && !salesPreviewLoading && (
              <p className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-300">{salesConvertError}</p>
            )}
            {salesPreview && !salesPreviewLoading && (
              <div className="space-y-3 text-xs">
                <div>
                  <p className="font-medium text-foreground">线索摘要</p>
                  <p className="mt-1 text-muted">
                    {salesPreview.prospectSummary.companyName}
                    {salesPreview.prospectSummary.country ? ` · ${salesPreview.prospectSummary.country}` : ""}
                    <br />
                    阶段 {salesPreview.prospectSummary.stageNormalized} · 分 {salesPreview.prospectSummary.score ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-foreground">将创建的客户</p>
                  <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-background/80 p-2 text-[10px] text-muted">
                    {JSON.stringify(salesPreview.proposedCustomer, null, 2)}
                  </pre>
                </div>
                <div>
                  <p className="font-medium text-foreground">将创建的商机</p>
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-background/80 p-2 text-[10px] text-muted">
                    {JSON.stringify(
                      { title: salesPreview.proposedOpportunity.title, stage: salesPreview.proposedOpportunity.stage },
                      null,
                      2,
                    )}
                  </pre>
                </div>
                {salesPreview.latestTradeQuote && (
                  <p className="text-muted">
                    最新外贸报价：{salesPreview.latestTradeQuote.quoteNumber}（{salesPreview.latestTradeQuote.status}）
                  </p>
                )}
                {salesPreview.warnings.length > 0 && (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
                    <p className="font-medium text-amber-200">注意</p>
                    <ul className="mt-1 list-inside list-disc text-amber-100/90">
                      {salesPreview.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <p className="mb-1 font-medium text-foreground">可能重复的销售客户</p>
                  {salesPreview.existingCustomerCandidates.length === 0 ? (
                    <p className="text-muted">未发现高置信候选</p>
                  ) : (
                    <ul className="max-h-32 space-y-1 overflow-y-auto text-muted">
                      {salesPreview.existingCustomerCandidates.map((c) => (
                        <li key={c.id}>
                          <label className="flex cursor-pointer items-start gap-2">
                            <input
                              type="radio"
                              name="salesPickCust"
                              checked={salesPickCustomerId === c.id}
                              onChange={() => {
                                setSalesPickCustomerId(c.id);
                                setSalesMode("use_existing_customer");
                              }}
                            />
                            <span>
                              {c.name} <span className="text-[10px] opacity-70">({c.matchReason})</span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-col gap-2 border-t border-border/40 pt-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="salesMode"
                      checked={salesMode === "create_new"}
                      onChange={() => setSalesMode("create_new")}
                    />
                    创建新客户
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="salesMode"
                      checked={salesMode === "use_existing_customer"}
                      onChange={() => setSalesMode("use_existing_customer")}
                    />
                    使用已有客户（请在上方选中一条）
                  </label>
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={salesCreateOpp} onChange={(e) => setSalesCreateOpp(e.target.checked)} />
                  同时创建商机（推荐）
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={salesIncludeQuote}
                    onChange={(e) => setSalesIncludeQuote(e.target.checked)}
                  />
                  在商机备注中附带最新外贸报价 ID
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    className="rounded-lg border border-border px-3 py-1.5 text-xs"
                    onClick={() => {
                      setSalesModalOpen(false);
                      setSalesPreview(null);
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={salesConvertBusy || salesPreview.alreadyConverted}
                    onClick={() => void handleConfirmSalesConvert()}
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    {salesConvertBusy ? "处理中…" : "确认转换"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <ConvertTradeQuoteToSalesQuoteDialog
        quoteId={sqConvQuoteId}
        orgId={orgId}
        ambiguous={ambiguous}
        open={!!sqConvQuoteId}
        onOpenChange={(open) => {
          if (!open) setSqConvQuoteId(null);
        }}
        onConverted={() => {
          void loadProspect();
          void loadTradeQuotes();
        }}
      />
    </div>
  );
}

function ChannelSendPanel({ prospectId, orgId, onSent }: { prospectId: string; orgId: string; onSent: () => void }) {
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
        body: JSON.stringify({ orgId, prospectId, to, content }),
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
