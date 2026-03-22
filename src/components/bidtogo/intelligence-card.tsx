"use client";

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
} from "lucide-react";
import { cn } from "@/lib/utils";

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
}

interface ProjectDocument {
  id: string;
  title: string;
  url: string;
  fileType: string;
}

interface BidToGoProject {
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
  supplier_quote: "供应商询价",
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
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
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

function FullReportSection({ json }: { json: string | null }) {
  if (!json) return null;

  let report: FullReport;
  try {
    report = JSON.parse(json);
  } catch {
    return null;
  }

  const hasStructuredContent =
    report.strengths?.length ||
    report.weaknesses?.length ||
    report.requirements_met?.length ||
    report.requirements_gap?.length ||
    report.competitive_landscape ||
    report.pricing_guidance ||
    report.timeline_notes;

  if (!hasStructuredContent && !report.description) return null;

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-border/60 bg-background p-4">
      {report.title && (
        <h4 className="text-sm font-semibold text-foreground">{report.title}</h4>
      )}
      {report.description && (
        <p className="text-sm leading-relaxed text-foreground/80">{report.description}</p>
      )}
      {(report.strengths?.length || report.weaknesses?.length) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {report.strengths && (
            <ReportList label="优势 / Strengths" items={report.strengths} />
          )}
          {report.weaknesses && (
            <ReportList label="风险 / Weaknesses" items={report.weaknesses} />
          )}
        </div>
      )}
      {(report.requirements_met?.length || report.requirements_gap?.length) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {report.requirements_met && (
            <ReportList label="已满足要求" items={report.requirements_met} />
          )}
          {report.requirements_gap && (
            <ReportList label="需补充 / 缺口" items={report.requirements_gap} />
          )}
        </div>
      )}
      {(report.competitive_landscape || report.pricing_guidance || report.timeline_notes) && (
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
      )}
    </div>
  );
}

export function BidToGoIntelligenceCard({ project }: { project: BidToGoProject }) {
  if (!project.sourceSystem || project.sourceSystem !== "bidtogo") return null;

  const { externalRef, intelligence, documents } = project;
  const daysLeft = project.dueDate ? daysUntil(project.dueDate) : null;

  return (
    <div className="space-y-4">
      {/* Source banner */}
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
          <FullReportSection json={intelligence.fullReportJson} />
          {intelligence.fullReportUrl && (
            <a
              href={intelligence.fullReportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
            >
              查看完整分析报告 <ExternalLink size={14} />
            </a>
          )}
        </div>
      )}

      {/* Documents */}
      {documents.length > 0 && (
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
