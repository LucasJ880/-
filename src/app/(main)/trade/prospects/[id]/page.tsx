"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

// ── Types ───────────────────────────────────────────────────

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
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [loading, setLoading] = useState(true);
  const [researching, setResearching] = useState(false);
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
  const [editingStage, setEditingStage] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState(false);
  const [newFollowUpDate, setNewFollowUpDate] = useState("");

  const loadProspect = useCallback(async () => {
    const res = await apiFetch(`/api/trade/prospects/${id}`);
    if (res.ok) setProspect(await res.json());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadProspect();
  }, [loadProspect]);

  const handleResearch = async () => {
    setResearching(true);
    try {
      await apiFetch(`/api/trade/prospects/${id}/research`, { method: "POST" });
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
  const report = p.researchReport;

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

        {p.score !== null && (
          <div className="flex flex-col items-center rounded-xl border border-border/60 bg-card-bg px-4 py-2">
            <div className="flex items-center gap-1">
              <Star size={14} className={p.score >= 7 ? "text-amber-400" : "text-zinc-500"} />
              <span className={cn("text-xl font-bold", p.score >= 7 ? "text-amber-400" : "text-muted")}>{p.score.toFixed(1)}</span>
            </div>
            <span className="text-[10px] text-muted">AI 评分</span>
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
          {researching ? "研究中..." : report ? "重新研究" : "AI 研究"}
        </button>

        {report && (
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

      {/* Score Reason */}
      {p.scoreReason && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-4">
          <h3 className="mb-1 text-xs font-medium text-muted">评分理由</h3>
          <p className="text-sm text-foreground">{p.scoreReason}</p>
        </div>
      )}

      {/* Research Report */}
      {report && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-4">
          <div className="mb-3 flex items-center gap-2">
            <FileText size={14} className="text-blue-400" />
            <h3 className="text-sm font-medium text-foreground">AI 研究报告</h3>
          </div>
          <div className="space-y-3">
            {Object.entries(REPORT_LABELS).map(([key, label]) => {
              const value = report[key];
              if (!value) return null;
              return (
                <div key={key}>
                  <h4 className="mb-0.5 text-xs font-medium text-muted">{label}</h4>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{value}</p>
                </div>
              );
            })}
          </div>
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
      {!report && (
        <div className="rounded-xl border border-dashed border-border bg-card-bg px-8 py-12 text-center">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="text-sm text-muted">点击「AI 研究」按钮，AI 将自动搜索该公司信息并生成研究报告和评分</p>
        </div>
      )}
    </div>
  );
}
