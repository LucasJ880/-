"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ArrowRight,
  FileText,
  FileSpreadsheet,
  Mail,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Zap,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import {
  TEMPLATE_LABELS,
  TEMPLATE_DESCRIPTIONS,
  TEMPLATE_TYPES,
  type TemplateType,
  type QuoteHeaderData,
  type QuoteLineItemData,
} from "@/lib/quote/types";
import type { CheckItem, CheckSeverity } from "@/lib/quote/rules";

// ── AI Response Types ──

interface AiTemplateResult {
  templateType: TemplateType;
  reason: string;
  confidence: string;
}

interface AiDraftResult {
  title?: string;
  currency?: string;
  tradeTerms?: string;
  paymentTerms?: string;
  deliveryDays?: number;
  validUntil?: string;
  moq?: number | null;
  originCountry?: string;
  lineItems?: Array<{
    category: string;
    itemName: string;
    specification?: string;
    unit?: string;
    quantity: number | null;
    unitPrice: number | null;
    totalPrice: number | null;
    costPrice: number | null;
    remarks?: string;
  }>;
  internalNotes?: string;
  reasoning?: string;
}

interface AiReviewIssue {
  severity: "info" | "warning" | "urgent";
  field: string;
  message: string;
  suggestion: string;
}

interface AiReviewResult {
  overallRisk: "low" | "medium" | "high";
  summary: string;
  issues: AiReviewIssue[];
  strengths: string[];
  suggestions: string[];
}

// ── Panel Props ──

interface Props {
  projectId: string;
  quoteId: string;
  header: QuoteHeaderData;
  lines: QuoteLineItemData[];
  checks: CheckItem[];
  onTemplateChange: (t: TemplateType) => void;
  onApplyCheckAction: (check: CheckItem) => void;
  onApplyDraft: (draft: AiDraftResult) => void;
  onAiReviewChange?: (risk: "low" | "medium" | "high" | null) => void;
  status: string;
}

const SEVERITY_STYLE: Record<CheckSeverity, { icon: typeof CheckCircle2; color: string; bg: string }> = {
  passed: { icon: CheckCircle2, color: "text-[#2e7a56]", bg: "bg-[rgba(46,122,86,0.06)]" },
  info: { icon: Info, color: "text-accent", bg: "bg-[rgba(43,96,85,0.06)]" },
  warning: { icon: AlertTriangle, color: "text-[#9a6a2f]", bg: "bg-[rgba(154,106,47,0.06)]" },
  urgent: { icon: AlertTriangle, color: "text-[#a63d3d]", bg: "bg-[rgba(166,61,61,0.06)]" },
};

const RISK_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  low: { color: "text-[#2e7a56]", bg: "bg-[rgba(46,122,86,0.08)]", label: "低风险" },
  medium: { color: "text-[#9a6a2f]", bg: "bg-[rgba(154,106,47,0.08)]", label: "中风险" },
  high: { color: "text-[#a63d3d]", bg: "bg-[rgba(166,61,61,0.08)]", label: "高风险" },
};

const TEMPLATES = Object.values(TEMPLATE_TYPES) as TemplateType[];
const MAX_VISIBLE_ISSUES = 5;

export function QuoteAiPanel({
  projectId,
  quoteId,
  header,
  lines,
  checks,
  onTemplateChange,
  onApplyCheckAction,
  onApplyDraft,
  onAiReviewChange,
  status,
}: Props) {
  // Adaptive initial section: empty → template, has data → checks, confirmed → review
  const [expandedSection, setExpandedSection] = useState<string | null>(() => {
    if (status !== "draft") return "review";
    if (lines.length === 0) return "template";
    return "checks";
  });
  const [showPassedChecks, setShowPassedChecks] = useState(false);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [showAllReviewIssues, setShowAllReviewIssues] = useState(false);

  // AI states
  const [aiTemplate, setAiTemplate] = useState<AiTemplateResult | null>(null);
  const [aiTemplateLoading, setAiTemplateLoading] = useState(false);
  const [aiTemplateFetched, setAiTemplateFetched] = useState(false);

  const [aiDraft, setAiDraft] = useState<AiDraftResult | null>(null);
  const [aiDraftLoading, setAiDraftLoading] = useState(false);
  const [aiDraftApplied, setAiDraftApplied] = useState(false);

  const [aiReview, setAiReview] = useState<AiReviewResult | null>(null);
  const [aiReviewLoading, setAiReviewLoading] = useState(false);

  const issues = checks.filter((c) => c.severity !== "passed");
  const passed = checks.filter((c) => c.severity === "passed");
  const visibleIssues = showAllIssues ? issues : issues.slice(0, MAX_VISIBLE_ISSUES);
  const hiddenIssueCount = issues.length - MAX_VISIBLE_ISSUES;

  const toggle = (key: string) =>
    setExpandedSection((prev) => (prev === key ? null : key));

  // ── Auto-trigger: Template Recommendation on mount ──
  const fetchAiTemplate = useCallback(async () => {
    setAiTemplateLoading(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quotes/ai/recommend-template`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setAiTemplate(data);
      }
    } catch {
      // ignore
    } finally {
      setAiTemplateLoading(false);
      setAiTemplateFetched(true);
    }
  }, [projectId]);

  useEffect(() => {
    if (status === "draft" && !aiTemplateFetched) {
      fetchAiTemplate();
    }
  }, [status, aiTemplateFetched, fetchAiTemplate]);

  // ── AI: Draft Generation ──
  const fetchAiDraft = useCallback(async () => {
    setAiDraftLoading(true);
    setAiDraftApplied(false);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quotes/ai/generate-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateType: header.templateType }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiDraft(data.draft);
        setExpandedSection("ai");
      }
    } catch {
      // ignore
    } finally {
      setAiDraftLoading(false);
    }
  }, [projectId, header.templateType]);

  // ── AI: Deep Review ──
  const fetchAiReview = useCallback(async () => {
    setAiReviewLoading(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quotes/${quoteId}/ai/review`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setAiReview(data.review);
        setExpandedSection("review");
        onAiReviewChange?.(data.review?.overallRisk ?? null);
      }
    } catch {
      // ignore
    } finally {
      setAiReviewLoading(false);
    }
  }, [projectId, quoteId, onAiReviewChange]);

  const handleApplyDraft = () => {
    if (!aiDraft) return;
    onApplyDraft(aiDraft);
    setAiDraftApplied(true);
    // After applying draft, auto-switch to checks
    setExpandedSection("checks");
  };

  const [autoFlowLoading, setAutoFlowLoading] = useState(false);

  const handleAutoFlow = async () => {
    setAutoFlowLoading(true);
    try {
      const result = await apiJson<{ taskId?: string }>("/api/agent/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "帮我生成完整报价",
          projectId,
          templateId: "bid_preparation",
        }),
      });
      if (result.taskId) {
        await apiFetch(`/api/agent/tasks/${result.taskId}/execute`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      }
    } catch {
      // silent
    } finally {
      setAutoFlowLoading(false);
    }
  };

  return (
    <div className="flex w-80 shrink-0 flex-col gap-3">
      {/* ── AI 自动流入口 ── */}
      {lines.length === 0 && status === "draft" && (
        <button
          onClick={handleAutoFlow}
          disabled={autoFlowLoading}
          className="flex items-center justify-center gap-2 rounded-xl border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-sm font-medium text-blue-600 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
        >
          {autoFlowLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Zap size={14} />
          )}
          {autoFlowLoading ? "正在创建 AI 任务..." : "一键生成完整报价"}
        </button>
      )}

      {/* ── 区块 1: 模板选择 ── */}
      <PanelSection
        title="报价模板"
        icon={<ClipboardCheck size={13} />}
        open={expandedSection === "template"}
        onToggle={() => toggle("template")}
      >
        <div className="space-y-1.5">
          {/* AI 推荐加载中 */}
          {aiTemplateLoading && (
            <div className="mb-2 flex items-center gap-1.5 rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-[10px] text-accent">
              <Loader2 size={10} className="animate-spin" />
              正在分析项目类型...
            </div>
          )}

          {/* AI 推荐结果 */}
          {aiTemplate && (
            <div className="mb-2 rounded-md border border-accent/20 bg-accent/5 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-accent">
                <Sparkles size={10} />
                已识别：建议使用{TEMPLATE_LABELS[aiTemplate.templateType as TemplateType] ?? aiTemplate.templateType}
              </div>
              <p className="mt-1 text-[10px] text-muted leading-snug">
                依据：{aiTemplate.reason}
              </p>
              <span className={cn(
                "mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px]",
                aiTemplate.confidence === "high" ? "bg-[rgba(46,122,86,0.1)] text-[#2e7a56]" :
                aiTemplate.confidence === "medium" ? "bg-[rgba(154,106,47,0.1)] text-[#9a6a2f]" :
                "bg-muted/10 text-muted"
              )}>
                置信度：{aiTemplate.confidence === "high" ? "高" : aiTemplate.confidence === "medium" ? "中" : "低"}
              </span>
            </div>
          )}

          {/* 模板无推荐、加载失败或完成后不显示推荐 */}
          {!aiTemplate && aiTemplateFetched && !aiTemplateLoading && (
            <button
              type="button"
              onClick={fetchAiTemplate}
              disabled={status !== "draft"}
              className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-border/40 px-3 py-1.5 text-[10px] text-muted hover:bg-muted/5 disabled:opacity-50"
            >
              <RefreshCw size={9} />
              重新分析
            </button>
          )}

          {TEMPLATES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTemplateChange(t)}
              disabled={status !== "draft"}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                header.templateType === t
                  ? "border-accent/40 bg-accent/5"
                  : "border-border/40 hover:border-accent/20 hover:bg-muted/5",
                status !== "draft" && "opacity-60"
              )}
            >
              <div className={cn(
                "mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2",
                header.templateType === t
                  ? "border-accent bg-accent"
                  : "border-muted/40"
              )} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{TEMPLATE_LABELS[t]}</span>
                  {aiTemplate?.templateType === t && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent">
                      <Sparkles size={8} />
                      AI 推荐
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[10px] text-muted leading-snug">
                  {TEMPLATE_DESCRIPTIONS[t]}
                </p>
              </div>
            </button>
          ))}
        </div>
      </PanelSection>

      {/* ── 区块 2: 报价检查 ── */}
      <PanelSection
        title="报价检查"
        icon={<AlertTriangle size={13} />}
        badge={issues.length > 0 ? `${issues.length} 项` : passed.length > 0 ? "通过" : undefined}
        badgeColor={issues.some((i) => i.severity === "urgent") ? "urgent" : issues.length > 0 ? "warning" : "passed"}
        open={expandedSection === "checks"}
        onToggle={() => toggle("checks")}
      >
        {issues.length === 0 && passed.length === 0 ? (
          <div className="py-2 text-center text-[10px] text-muted">
            待填写报价数据后自动检查
          </div>
        ) : (
          <div className="space-y-1">
            {visibleIssues.map((check) => {
              const style = SEVERITY_STYLE[check.severity];
              const Icon = style.icon;
              return (
                <div key={check.id} className={cn("rounded-md border border-border/30 px-3 py-2", style.bg)}>
                  <div className="flex items-start gap-2">
                    <Icon size={12} className={cn("mt-0.5 shrink-0", style.color)} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium">{check.message}</div>
                      {check.suggestion && (
                        <p className="mt-0.5 text-[10px] text-muted">{check.suggestion}</p>
                      )}
                      {check.actionType && status === "draft" && (
                        <button
                          type="button"
                          onClick={() => onApplyCheckAction(check)}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/20"
                        >
                          <ArrowRight size={9} />
                          {check.actionType === "insert_line" ? "插入此项" :
                           check.actionType === "set_field" ? "应用建议" :
                           "调整"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {hiddenIssueCount > 0 && !showAllIssues && (
              <button
                type="button"
                onClick={() => setShowAllIssues(true)}
                className="flex w-full items-center justify-center gap-1 py-1 text-[10px] text-accent hover:text-accent/80"
              >
                <ChevronDown size={10} />
                查看全部（还有 {hiddenIssueCount} 项）
              </button>
            )}

            {passed.length > 0 && (
              <button
                type="button"
                onClick={() => setShowPassedChecks(!showPassedChecks)}
                className="flex w-full items-center gap-1.5 px-1 py-1 text-[10px] text-muted hover:text-foreground"
              >
                {showPassedChecks ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                {passed.length} 项已通过
              </button>
            )}

            {showPassedChecks && passed.map((check) => (
              <div key={check.id} className="flex items-center gap-2 px-3 py-1 text-[11px] text-[#2e7a56]">
                <CheckCircle2 size={10} />
                {check.message}
              </div>
            ))}
          </div>
        )}
      </PanelSection>

      {/* ── 区块 3: AI 草稿生成 ── */}
      <PanelSection
        title="AI 草稿生成"
        icon={<Zap size={13} />}
        open={expandedSection === "ai"}
        onToggle={() => toggle("ai")}
      >
        {!aiDraft ? (
          <div className="space-y-2">
            <p className="text-[10px] text-muted leading-snug">
              基于项目资料、询价记录和供应商报价，自动生成结构化报价草稿。生成后需确认方可写入。
            </p>
            <button
              type="button"
              onClick={fetchAiDraft}
              disabled={aiDraftLoading || status !== "draft"}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-accent/20 bg-accent/5 px-3 py-2.5 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {aiDraftLoading ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  正在生成...
                </>
              ) : (
                <>
                  <Sparkles size={12} />
                  生成报价草稿
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-md border border-accent/20 bg-accent/5 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-accent">
                <Sparkles size={10} />
                已生成草稿 · 待确认
              </div>
              {aiDraft.title && (
                <p className="mt-1 text-xs font-medium">{aiDraft.title}</p>
              )}
              {aiDraft.lineItems && (
                <p className="mt-0.5 text-[10px] text-muted">
                  {aiDraft.lineItems.length} 个行项目
                  {aiDraft.lineItems.filter((li) => li.unitPrice != null).length > 0 && " · 含价格建议"}
                </p>
              )}
              {aiDraft.reasoning && (
                <p className="mt-1 text-[10px] text-muted leading-snug">
                  依据：{aiDraft.reasoning}
                </p>
              )}
            </div>

            {aiDraft.lineItems && aiDraft.lineItems.length > 0 && (
              <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-border/30 p-2">
                {aiDraft.lineItems.map((li, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    <span className="w-4 text-right text-muted">{i + 1}</span>
                    <span className="flex-1 truncate font-medium">{li.itemName}</span>
                    {li.totalPrice != null && (
                      <span className="tabular-nums text-muted">{li.totalPrice.toLocaleString()}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              {!aiDraftApplied ? (
                <button
                  type="button"
                  onClick={handleApplyDraft}
                  disabled={status !== "draft"}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent/10 px-3 py-2 text-xs font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
                >
                  <ArrowRight size={11} />
                  应用到报价单
                </button>
              ) : (
                <div className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[rgba(46,122,86,0.08)] px-3 py-2 text-xs font-medium text-[#2e7a56]">
                  <CheckCircle2 size={11} />
                  已应用
                </div>
              )}
              <button
                type="button"
                onClick={fetchAiDraft}
                disabled={aiDraftLoading || status !== "draft"}
                className="flex items-center gap-1 rounded-md border border-border/40 px-2 py-2 text-[10px] text-muted hover:bg-muted/5 disabled:opacity-50"
                title="重新生成"
              >
                {aiDraftLoading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              </button>
            </div>
          </div>
        )}
      </PanelSection>

      {/* ── 区块 4: AI 深度审查 ── */}
      <PanelSection
        title="AI 深度审查"
        icon={<ShieldCheck size={13} />}
        badge={aiReview ? RISK_STYLE[aiReview.overallRisk]?.label : undefined}
        badgeColor={aiReview?.overallRisk === "high" ? "urgent" : aiReview?.overallRisk === "medium" ? "warning" : undefined}
        open={expandedSection === "review"}
        onToggle={() => toggle("review")}
      >
        {!aiReview ? (
          <div className="space-y-2">
            <p className="text-[10px] text-muted leading-snug">
              {lines.length === 0
                ? "待添加行项目后可进行 AI 深度审查。"
                : "检查报价完整性、合理性和竞争力。建议在确认前执行。"
              }
            </p>
            <button
              type="button"
              onClick={fetchAiReview}
              disabled={aiReviewLoading || lines.length === 0}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-accent/20 bg-accent/5 px-3 py-2.5 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {aiReviewLoading ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  审查中...
                </>
              ) : (
                <>
                  <ShieldCheck size={12} />
                  开始 AI 审查
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {/* 风险总结 */}
            <div className={cn(
              "rounded-md border px-3 py-2",
              aiReview.overallRisk === "high"
                ? "border-[rgba(166,61,61,0.3)] bg-[rgba(166,61,61,0.05)]"
                : aiReview.overallRisk === "medium"
                  ? "border-[rgba(154,106,47,0.3)] bg-[rgba(154,106,47,0.05)]"
                  : "border-[rgba(46,122,86,0.3)] bg-[rgba(46,122,86,0.05)]"
            )}>
              <div className={cn(
                "flex items-center gap-1.5 text-[10px] font-medium",
                RISK_STYLE[aiReview.overallRisk]?.color
              )}>
                {aiReview.overallRisk === "high" ? <AlertCircle size={10} /> :
                 aiReview.overallRisk === "medium" ? <AlertTriangle size={10} /> :
                 <CheckCircle2 size={10} />}
                {RISK_STYLE[aiReview.overallRisk]?.label}
              </div>
              <p className="mt-1 text-xs font-medium">{aiReview.summary}</p>
            </div>

            {/* 发现问题 - 折叠超5条 */}
            {aiReview.issues.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-medium text-muted uppercase tracking-wider">
                  发现 {aiReview.issues.length} 个问题
                </div>
                {(showAllReviewIssues ? aiReview.issues : aiReview.issues.slice(0, MAX_VISIBLE_ISSUES)).map((issue, i) => {
                  const sev = issue.severity as CheckSeverity;
                  const style = SEVERITY_STYLE[sev] ?? SEVERITY_STYLE.info;
                  const Icon = style.icon;
                  return (
                    <div key={i} className={cn("rounded-md border border-border/30 px-3 py-2", style.bg)}>
                      <div className="flex items-start gap-2">
                        <Icon size={11} className={cn("mt-0.5 shrink-0", style.color)} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium">{issue.message}</div>
                          <p className="mt-0.5 text-[10px] text-muted">{issue.suggestion}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {aiReview.issues.length > MAX_VISIBLE_ISSUES && !showAllReviewIssues && (
                  <button
                    type="button"
                    onClick={() => setShowAllReviewIssues(true)}
                    className="flex w-full items-center justify-center gap-1 py-1 text-[10px] text-accent hover:text-accent/80"
                  >
                    <ChevronDown size={10} />
                    查看全部（还有 {aiReview.issues.length - MAX_VISIBLE_ISSUES} 项）
                  </button>
                )}
              </div>
            )}

            {/* 优势 - 默认折叠 */}
            {aiReview.strengths.length > 0 && (
              <CollapsibleList
                title={`${aiReview.strengths.length} 项表现良好`}
                items={aiReview.strengths}
                renderItem={(s) => (
                  <div className="flex items-center gap-1.5 px-1 text-[10px] text-[#2e7a56]">
                    <CheckCircle2 size={9} className="shrink-0" />
                    {s}
                  </div>
                )}
              />
            )}

            {/* 改进建议 - 默认折叠 */}
            {aiReview.suggestions.length > 0 && (
              <CollapsibleList
                title={`${aiReview.suggestions.length} 项改进建议`}
                items={aiReview.suggestions}
                renderItem={(s) => (
                  <div className="flex items-start gap-1.5 px-1 text-[10px] text-muted">
                    <Info size={9} className="mt-0.5 shrink-0 text-accent" />
                    {s}
                  </div>
                )}
              />
            )}

            <button
              type="button"
              onClick={() => { setShowAllReviewIssues(false); fetchAiReview(); }}
              disabled={aiReviewLoading}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border/40 px-3 py-2 text-[10px] text-muted hover:bg-muted/5 disabled:opacity-50"
            >
              {aiReviewLoading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              重新审查
            </button>
          </div>
        )}
      </PanelSection>

      {/* ── 区块 5: 输出选项 ── */}
      {status === "confirmed" && (
        <PanelSection
          title="输出版本"
          icon={<FileText size={13} />}
          open={expandedSection === "export"}
          onToggle={() => toggle("export")}
        >
          <div className="space-y-1.5">
            <ExportButton icon={<FileText size={12} />} label="客户报价单" desc="不含成本明细，正式对外报价" />
            <ExportButton icon={<FileSpreadsheet size={12} />} label="内部成本表" desc="含完整成本结构和利润率" />
            <ExportButton icon={<Mail size={12} />} label="报价邮件" desc="基于报价数据生成商务邮件" />
          </div>
        </PanelSection>
      )}
    </div>
  );
}

// ── 子组件 ──

function PanelSection({
  title,
  icon,
  badge,
  badgeColor,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  badge?: string;
  badgeColor?: "warning" | "urgent" | "passed";
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className="text-accent/70">{icon}</span>
        <span className="flex-1 text-xs font-semibold uppercase tracking-wider text-muted">
          {title}
        </span>
        {badge && (
          <span className={cn(
            "rounded-full px-1.5 py-0.5 text-[9px] font-medium",
            badgeColor === "urgent"
              ? "bg-[rgba(166,61,61,0.1)] text-[#a63d3d]"
              : badgeColor === "passed"
                ? "bg-[rgba(46,122,86,0.1)] text-[#2e7a56]"
                : "bg-[rgba(154,106,47,0.1)] text-[#9a6a2f]"
          )}>
            {badge}
          </span>
        )}
        {open ? <ChevronDown size={12} className="text-muted" /> : <ChevronRight size={12} className="text-muted" />}
      </button>
      {open && (
        <div className="border-t border-border/30 px-3 pb-3 pt-2">
          {children}
        </div>
      )}
    </div>
  );
}

function CollapsibleList<T>({
  title,
  items,
  renderItem,
}: {
  title: string;
  items: T[];
  renderItem: (item: T, idx: number) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 py-0.5 text-[10px] font-medium text-muted hover:text-foreground"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {title}
      </button>
      {open && (
        <div className="mt-0.5 space-y-0.5">
          {items.map((item, i) => (
            <div key={i}>{renderItem(item, i)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportButton({ icon, label, desc }: { icon: React.ReactNode; label: string; desc: string }) {
  return (
    <button
      type="button"
      className="flex w-full items-start gap-2.5 rounded-md border border-border/40 px-3 py-2 text-left hover:bg-muted/5"
    >
      <span className="mt-0.5 text-accent">{icon}</span>
      <div>
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[10px] text-muted">{desc}</div>
      </div>
    </button>
  );
}
