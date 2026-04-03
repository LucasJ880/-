"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ExternalLink,
  Shield,
  TrendingUp,
  AlertTriangle,
  FileText,
  Globe,
  Clock,
  Building2,
  MapPin,
  DollarSign,
  Hash,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  PenLine,
  Send,
  RotateCcw,
  ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api-fetch";

interface ExternalRef {
  system: string;
  externalId: string;
  url: string | null;
}

interface FullReport {
  title?: string;
  description?: string;
  strengths?: string[];
  weaknesses?: string[];
  requirements_met?: string[];
  requirements_gap?: string[];
  competitive_landscape?: string;
  pricing_guidance?: string;
  timeline_notes?: string;
  [key: string]: unknown;
}

interface Intelligence {
  recommendation: string;
  riskLevel: string;
  fitScore: number;
  summary: string | null;
  fullReportUrl: string | null;
  fullReportJson: string | null;
  reportMarkdown: string | null;
  reportStatus?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  reviewScore?: number | null;
}

interface ProjectDocument {
  id: string;
  title: string;
  url: string;
  fileType: string;
}

interface BidToGoProject {
  projectId?: string;
  sourceSystem: string | null;
  sourcePlatform: string | null;
  clientOrganization: string | null;
  location: string | null;
  estimatedValue: number | null;
  currency: string | null;
  solicitationNumber: string | null;
  tenderStatus: string | null;
  dueDate: string | null;
  externalRef: ExternalRef | null;
  intelligence: Intelligence | null;
  documents: ProjectDocument[];
}

const REPORT_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-gray-100 text-gray-600" },
  ai_generated: { label: "AI 已生成", cls: "bg-blue-50 text-blue-700" },
  in_review: { label: "审核中", cls: "bg-amber-50 text-amber-700" },
  approved: { label: "已通过", cls: "bg-emerald-50 text-emerald-700" },
  needs_revision: { label: "需修改", cls: "bg-red-50 text-red-700" },
  delivered: { label: "已交付", cls: "bg-violet-50 text-violet-700" },
};

const RECOMMENDATION_MAP: Record<string, { label: string; cls: string }> = {
  pursue: { label: "建议跟进", cls: "bg-success-light text-success-text" },
  review_carefully: { label: "需仔细评估", cls: "bg-warning-light text-warning-text" },
  low_probability: { label: "低概率", cls: "bg-[rgba(110,125,118,0.08)] text-muted" },
  skip: { label: "建议跳过", cls: "bg-danger-light text-danger-text" },
};

const RISK_MAP: Record<string, { label: string; cls: string }> = {
  low: { label: "低风险", cls: "text-success-text" },
  medium: { label: "中风险", cls: "text-warning-text" },
  high: { label: "高风险", cls: "text-danger-text" },
  unassessed: { label: "未评估", cls: "text-muted" },
};

const STATUS_MAP: Record<string, string> = {
  new: "新建",
  under_review: "审阅中",
  qualification_check: "资质验证",
  pursuing: "跟进中",
  supplier_inquiry: "供应商询价",
  supplier_quote: "供应商报价",
  bid_preparation: "投标准备",
  bid_submitted: "已投标",
  won: "中标",
  lost: "未中标",
  passed: "已放弃",
  archived: "已归档",
};

const FILE_ICON_MAP: Record<string, string> = {
  pdf: "📄",
  doc: "📝",
  docx: "📝",
  xlsx: "📊",
  xls: "📊",
  link: "🔗",
};

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

import { daysRemainingToronto } from "@/lib/time";

function daysUntil(dateStr: string): number {
  return daysRemainingToronto(dateStr);
}

function ReportList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h5 className="text-xs font-semibold text-muted">{label}</h5>
      <ul className="mt-1 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-foreground">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/50" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FullReportInline({ report }: { report: FullReport }) {
  return (
    <div className="space-y-4">
      {report.title && (
        <h4 className="text-sm font-semibold text-foreground">{report.title}</h4>
      )}
      {report.description && (
        <p className="text-sm leading-relaxed text-foreground/80">{report.description}</p>
      )}
      {(report.strengths?.length || report.weaknesses?.length) ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {report.strengths && (
            <ReportList label="优势 / Strengths" items={report.strengths} />
          )}
          {report.weaknesses && (
            <ReportList label="风险 / Weaknesses" items={report.weaknesses} />
          )}
        </div>
      ) : null}
      {(report.requirements_met?.length || report.requirements_gap?.length) ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {report.requirements_met && (
            <ReportList label="已满足要求" items={report.requirements_met} />
          )}
          {report.requirements_gap && (
            <ReportList label="需补充 / 缺口" items={report.requirements_gap} />
          )}
        </div>
      ) : null}
      {(report.competitive_landscape || report.pricing_guidance || report.timeline_notes) ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {report.competitive_landscape && (
            <div>
              <h5 className="text-xs font-semibold text-muted">竞争格局</h5>
              <p className="mt-1 text-sm text-foreground/80">{report.competitive_landscape}</p>
            </div>
          )}
          {report.pricing_guidance && (
            <div>
              <h5 className="text-xs font-semibold text-muted">定价参考</h5>
              <p className="mt-1 text-sm text-foreground/80">{report.pricing_guidance}</p>
            </div>
          )}
          {report.timeline_notes && (
            <div>
              <h5 className="text-xs font-semibold text-muted">时间线备注</h5>
              <p className="mt-1 text-sm text-foreground/80">{report.timeline_notes}</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FullReportSection({
  markdown,
  json,
  url,
}: {
  markdown: string | null;
  json: string | null;
  url: string | null;
}) {
  const [expanded, setExpanded] = useState(true);

  let report: FullReport | null = null;
  if (json) {
    try {
      report = JSON.parse(json);
    } catch { /* ignore */ }
  }

  let reportMd = markdown || null;
  if (!reportMd && report && typeof report.report_markdown === "string") {
    reportMd = report.report_markdown as string;
  }

  const hasStructuredContent = report && (
    report.description ||
    report.strengths?.length ||
    report.weaknesses?.length ||
    report.requirements_met?.length ||
    report.requirements_gap?.length ||
    report.competitive_landscape ||
    report.pricing_guidance ||
    report.timeline_notes
  );

  const hasContent = reportMd || hasStructuredContent || url;
  if (!hasContent) return null;

  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-background">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-foreground hover:bg-accent/5 transition-colors rounded-lg"
      >
        <span>完整分析报告</span>
        <div className="flex items-center gap-2">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[11px] font-normal text-muted hover:text-accent"
              title="在新窗口打开"
            >
              <ExternalLink size={11} />
            </a>
          )}
          {expanded ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/60 px-4 py-4">
          {reportMd ? (
            <article className="prose prose-sm max-w-none prose-headings:text-foreground prose-p:text-foreground/80 prose-li:text-foreground/80 prose-strong:text-foreground prose-table:text-sm prose-th:bg-accent/5 prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5 prose-blockquote:border-accent/30 prose-blockquote:text-muted">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {reportMd}
              </ReactMarkdown>
            </article>
          ) : hasStructuredContent && report ? (
            <FullReportInline report={report} />
          ) : url ? (
            <div className="text-center py-4">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-accent hover:bg-accent/5 transition-colors"
              >
                <ExternalLink size={14} />
                在新窗口查看完整报告
              </a>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function IntelligenceReviewPanel({
  projectId,
  intelligence,
  onUpdate,
}: {
  projectId: string;
  intelligence: Intelligence;
  onUpdate?: () => void;
}) {
  const [notes, setNotes] = useState(intelligence.reviewNotes || "");
  const [score, setScore] = useState(intelligence.reviewScore ?? 0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(intelligence.reportStatus || "ai_generated");

  const patchReview = useCallback(
    async (reportStatus: string, extraNotes?: string) => {
      setLoading(true);
      try {
        await apiJson(`/api/projects/${projectId}/intelligence/review`, {
          method: "PATCH",
          body: JSON.stringify({
            reportStatus,
            reviewNotes: extraNotes ?? notes,
            ...(score > 0 ? { reviewScore: score } : {}),
          }),
        });
        setStatus(reportStatus);
        onUpdate?.();
      } catch (e) {
        console.error("审核更新失败", e);
      } finally {
        setLoading(false);
      }
    },
    [projectId, notes, score, onUpdate],
  );

  const statusInfo = REPORT_STATUS_MAP[status] || REPORT_STATUS_MAP.ai_generated;

  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-background p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClipboardCheck size={15} className="text-accent" />
          报告审核
        </h4>
        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-medium", statusInfo.cls)}>
          {statusInfo.label}
        </span>
      </div>

      {intelligence.reviewedBy && (
        <p className="text-xs text-muted">
          审核人：{intelligence.reviewedBy}
          {intelligence.reviewedAt && (
            <> · {new Date(intelligence.reviewedAt).toLocaleString("zh-CN")}</>
          )}
        </p>
      )}

      {/* 评分 */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">评分：</span>
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setScore(v)}
            className={cn(
              "h-6 w-6 rounded text-xs font-medium transition-colors",
              score >= v
                ? "bg-accent text-white"
                : "bg-background border border-border text-muted hover:border-accent/50",
            )}
          >
            {v}
          </button>
        ))}
      </div>

      {/* 审核备注 */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="审核备注：修改建议、风险备注、是否允许交付…"
        rows={2}
        className="w-full rounded-lg border border-border bg-card-bg px-3 py-2 text-sm placeholder:text-muted/60 focus:border-accent/50 focus:outline-none"
      />

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-2">
        {status !== "in_review" && status !== "approved" && status !== "delivered" && (
          <button
            type="button"
            disabled={loading}
            onClick={() => patchReview("in_review")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
          >
            <PenLine size={12} /> 开始审核
          </button>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={() => patchReview("approved")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-50"
        >
          <CheckCircle2 size={12} /> 通过
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => patchReview("needs_revision")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50"
        >
          <RotateCcw size={12} /> 需修改
        </button>
        {status === "approved" && (
          <button
            type="button"
            disabled={loading}
            onClick={() => patchReview("delivered")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50"
          >
            <Send size={12} /> 标记已交付
          </button>
        )}
      </div>
    </div>
  );
}

export function BidToGoIntelligenceCard({
  project,
  onUpdate,
}: {
  project: BidToGoProject;
  onUpdate?: () => void;
}) {
  const isBidToGo = project.sourceSystem === "bidtogo";
  if (!isBidToGo && !project.intelligence) return null;

  const { externalRef, intelligence, documents } = project;
  const daysLeft = project.dueDate ? daysUntil(project.dueDate) : null;

  return (
    <div className="space-y-4">
      {/* Source banner */}
      {isBidToGo ? (
        <div className="flex items-center gap-2 rounded-xl border border-accent/20 bg-accent-light px-4 py-2.5 text-sm">
          <Globe size={16} className="text-accent" />
          <span className="font-semibold text-accent">BidToGo</span>
          <span className="text-muted">·</span>
          <span className="text-foreground">外部招标情报</span>
          {project.sourcePlatform && (
            <>
              <span className="text-muted">·</span>
              <span className="text-muted">来源：{project.sourcePlatform}</span>
            </>
          )}
          {externalRef?.url && (
            <a
              href={externalRef.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              查看原始链接 <ExternalLink size={12} />
            </a>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-2.5 text-sm">
          <TrendingUp size={16} className="text-violet-600" />
          <span className="font-semibold text-violet-600">AI 情报分析</span>
          <span className="text-muted">·</span>
          <span className="text-foreground">基于上传文件自动生成</span>
        </div>
      )}

      {/* Project meta info */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {project.clientOrganization && (
          <div className="rounded-lg border border-border bg-card-bg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Building2 size={12} /> 发标机构
            </div>
            <p className="mt-1 text-sm font-medium">{project.clientOrganization}</p>
          </div>
        )}
        {project.location && (
          <div className="rounded-lg border border-border bg-card-bg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <MapPin size={12} /> 项目地点
            </div>
            <p className="mt-1 text-sm font-medium">{project.location}</p>
          </div>
        )}
        {project.estimatedValue != null && project.currency && (
          <div className="rounded-lg border border-border bg-card-bg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <DollarSign size={12} /> 预估金额
            </div>
            <p className="mt-1 text-sm font-medium">
              {formatCurrency(project.estimatedValue, project.currency)}
            </p>
          </div>
        )}
        {project.solicitationNumber && (
          <div className="rounded-lg border border-border bg-card-bg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Hash size={12} /> 招标编号
            </div>
            <p className="mt-1 text-sm font-medium">{project.solicitationNumber}</p>
          </div>
        )}
        {daysLeft !== null && (
          <div className="rounded-lg border border-border bg-card-bg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Clock size={12} /> 截止倒计时
            </div>
            <p
              className={cn(
                "mt-1 text-sm font-bold",
                daysLeft <= 3 ? "text-danger-text" : daysLeft <= 7 ? "text-warning-text" : "text-foreground"
              )}
            >
              {daysLeft > 0 ? `${daysLeft} 天` : daysLeft === 0 ? "今天" : `已过期 ${Math.abs(daysLeft)} 天`}
            </p>
          </div>
        )}
        {project.tenderStatus && (
          <div className="rounded-lg border border-border bg-card-bg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <Shield size={12} /> 流程状态
            </div>
            <p className="mt-1 text-sm font-medium">
              {STATUS_MAP[project.tenderStatus] || project.tenderStatus}
            </p>
          </div>
        )}
      </div>

      {/* AI Intelligence */}
      {intelligence && (
        <div className="rounded-xl border border-border bg-card-bg p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp size={16} className="text-accent" />
            AI 情报分析
          </h3>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium",
                RECOMMENDATION_MAP[intelligence.recommendation]?.cls || "bg-background text-muted"
              )}
            >
              {RECOMMENDATION_MAP[intelligence.recommendation]?.label || intelligence.recommendation}
            </span>
            <span className="flex items-center gap-1 text-sm">
              <AlertTriangle
                size={14}
                className={RISK_MAP[intelligence.riskLevel]?.cls || "text-muted"}
              />
              <span className={RISK_MAP[intelligence.riskLevel]?.cls || "text-muted"}>
                {RISK_MAP[intelligence.riskLevel]?.label || intelligence.riskLevel}
              </span>
            </span>
            <span className="text-sm">
              匹配度：
              <span
                className={cn(
                  "font-bold",
                  intelligence.fitScore >= 70
                    ? "text-success-text"
                    : intelligence.fitScore >= 40
                      ? "text-warning-text"
                      : "text-muted"
                )}
              >
                {intelligence.fitScore}%
              </span>
            </span>
          </div>
          {intelligence.summary && (
            <p className="mt-3 rounded-lg bg-background p-3 text-sm leading-relaxed text-foreground">
              {intelligence.summary}
            </p>
          )}
          <FullReportSection markdown={intelligence.reportMarkdown} json={intelligence.fullReportJson} url={intelligence.fullReportUrl} />

          {/* 审核面板 */}
          {project.projectId && (
            <IntelligenceReviewPanel
              projectId={project.projectId}
              intelligence={intelligence}
              onUpdate={onUpdate}
            />
          )}
        </div>
      )}

      {/* Documents — only for BidToGo since uploaded projects use ProjectFileManager */}
      {isBidToGo && documents.length > 0 && (
        <div className="rounded-xl border border-border bg-card-bg p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <FileText size={16} className="text-accent" />
            相关文档
          </h3>
          <ul className="mt-3 space-y-2">
            {documents.map((doc) => (
              <li key={doc.id}>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:bg-background"
                >
                  <span className="text-base">
                    {FILE_ICON_MAP[doc.fileType] || "📎"}
                  </span>
                  <span className="flex-1 font-medium">{doc.title}</span>
                  <span className="rounded bg-background px-1.5 py-0.5 text-[10px] uppercase text-muted">
                    {doc.fileType}
                  </span>
                  <ExternalLink size={12} className="text-muted" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
