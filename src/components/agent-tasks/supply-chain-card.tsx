"use client";

import {
  Ship,
  Package,
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Truck,
  DollarSign,
  ClipboardList,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface SupplierAssessment {
  existingSupplierCount?: number;
  riskLevel?: string;
  singleSourceRisks?: string[];
  recommendations?: string[];
}

interface Logistics {
  recommendedMode?: string;
  estimatedLeadTimeDays?: number;
  costFactors?: string[];
  risks?: string[];
}

interface Compliance {
  requiredCertifications?: string[];
  tariffConsiderations?: string;
  criticalIssues?: string[];
}

interface CostCategory {
  name: string;
  percentage: string;
  note?: string;
}

interface CostBreakdown {
  categories?: CostCategory[];
  marginEstimate?: string;
}

interface ActionItem {
  action: string;
  priority?: string;
  deadline?: string;
}

export interface SupplyChainData {
  feasibility?: string;
  feasibilityLabel?: string;
  sourcingStrategy?: string;
  supplierAssessment?: SupplierAssessment;
  logistics?: Logistics;
  compliance?: Compliance;
  costBreakdown?: CostBreakdown;
  actionItems?: ActionItem[];
  executiveSummary?: string;
  rawAnalysis?: string;
}

interface Props {
  data: SupplyChainData;
  stepTitle?: string;
}

const FEASIBILITY_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  high:   { color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", label: "可行性高" },
  medium: { color: "text-amber-700",   bg: "bg-amber-50 border-amber-200",     label: "可行性中等" },
  low:    { color: "text-red-700",     bg: "bg-red-50 border-red-200",         label: "可行性低" },
};

const PRIORITY_DOT: Record<string, string> = {
  high:   "bg-red-500",
  medium: "bg-amber-500",
  low:    "bg-slate-400",
};

export function SupplyChainCard({ data, stepTitle }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (data.rawAnalysis && !data.feasibility) {
    return (
      <div className="rounded-lg border border-border/40 bg-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Ship className="h-4 w-4 text-blue-500" />
          <span className="text-sm font-medium">{stepTitle ?? "供应链分析"}</span>
        </div>
        <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
          {data.rawAnalysis.slice(0, 800)}
          {data.rawAnalysis.length > 800 && "..."}
        </div>
      </div>
    );
  }

  const fc = FEASIBILITY_CONFIG[data.feasibility ?? ""] ?? FEASIBILITY_CONFIG.medium;

  return (
    <div className="rounded-lg border border-border/40 bg-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
      >
        <Ship className="h-4 w-4 text-blue-500 flex-shrink-0" />
        <span className="text-sm font-medium flex-1 text-left">
          {stepTitle ?? "供应链分析"}
        </span>
        {data.feasibility && (
          <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", fc.bg, fc.color)}>
            {fc.label}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* Summary bar */}
      {data.feasibilityLabel && (
        <div className="px-4 pb-2 -mt-1">
          <p className="text-xs text-muted-foreground">{data.feasibilityLabel}</p>
        </div>
      )}

      {expanded && (
        <div className="border-t border-border/30 px-4 py-3 space-y-4">
          {/* Executive Summary */}
          {data.executiveSummary && (
            <div className="text-xs text-foreground leading-relaxed bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200/50 rounded-md px-3 py-2">
              {data.executiveSummary}
            </div>
          )}

          {/* Sourcing Strategy */}
          {data.sourcingStrategy && (
            <InfoRow icon={Package} label="采购模式" value={data.sourcingStrategy} />
          )}

          {/* Supplier Assessment */}
          {data.supplierAssessment && (
            <Section icon={TrendingUp} title="供应商评估">
              <div className="space-y-1.5">
                {data.supplierAssessment.existingSupplierCount !== undefined && (
                  <p className="text-xs text-muted-foreground">
                    现有供应商: <span className="text-foreground font-medium">{data.supplierAssessment.existingSupplierCount} 家</span>
                    {data.supplierAssessment.riskLevel && (
                      <RiskBadge level={data.supplierAssessment.riskLevel} />
                    )}
                  </p>
                )}
                <TagList items={data.supplierAssessment.singleSourceRisks} variant="warning" />
                <TagList items={data.supplierAssessment.recommendations} variant="info" />
              </div>
            </Section>
          )}

          {/* Logistics */}
          {data.logistics && (
            <Section icon={Truck} title="物流方案">
              <div className="space-y-1.5">
                {data.logistics.recommendedMode && (
                  <p className="text-xs text-muted-foreground">
                    推荐方式: <span className="text-foreground font-medium">{data.logistics.recommendedMode}</span>
                  </p>
                )}
                {data.logistics.estimatedLeadTimeDays !== undefined && data.logistics.estimatedLeadTimeDays > 0 && (
                  <p className="text-xs text-muted-foreground">
                    预计交期: <span className="text-foreground font-medium">{data.logistics.estimatedLeadTimeDays} 天</span>
                  </p>
                )}
                <TagList items={data.logistics.costFactors} variant="neutral" />
                <TagList items={data.logistics.risks} variant="warning" />
              </div>
            </Section>
          )}

          {/* Compliance */}
          {data.compliance && (
            <Section icon={ShieldCheck} title="合规要求">
              <div className="space-y-1.5">
                <TagList items={data.compliance.requiredCertifications} variant="info" />
                {data.compliance.tariffConsiderations && (
                  <p className="text-xs text-muted-foreground">{data.compliance.tariffConsiderations}</p>
                )}
                {data.compliance.criticalIssues && data.compliance.criticalIssues.length > 0 && (
                  <div className="space-y-1">
                    {data.compliance.criticalIssues.map((issue, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs text-red-600">
                        <XCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                        {issue}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Cost Breakdown */}
          {data.costBreakdown && (
            <Section icon={DollarSign} title="成本结构">
              {data.costBreakdown.categories && data.costBreakdown.categories.length > 0 && (
                <div className="space-y-1">
                  {data.costBreakdown.categories.map((cat, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{cat.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-foreground font-medium">{cat.percentage}</span>
                        {cat.note && <span className="text-muted-foreground text-[10px]">({cat.note})</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {data.costBreakdown.marginEstimate && (
                <p className="text-xs text-emerald-600 font-medium mt-1.5">
                  预估利润空间: {data.costBreakdown.marginEstimate}
                </p>
              )}
            </Section>
          )}

          {/* Action Items */}
          {data.actionItems && data.actionItems.length > 0 && (
            <Section icon={ClipboardList} title="行动建议">
              <div className="space-y-1.5">
                {data.actionItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className={cn("mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0", PRIORITY_DOT[item.priority ?? "medium"])} />
                    <div className="flex-1">
                      <span className="text-foreground">{item.action}</span>
                      {item.deadline && (
                        <span className="text-muted-foreground ml-1.5">· {item.deadline}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">{title}</span>
      </div>
      <div className="ml-5">{children}</div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{label}:</span>
      <span className="text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    high:   { bg: "bg-red-100",   text: "text-red-700",   label: "高风险" },
    medium: { bg: "bg-amber-100", text: "text-amber-700", label: "中风险" },
    low:    { bg: "bg-green-100", text: "text-green-700", label: "低风险" },
  };
  const c = cfg[level] ?? cfg.medium;
  return <span className={cn("ml-2 text-[10px] px-1.5 py-0.5 rounded", c.bg, c.text)}>{c.label}</span>;
}

function TagList({ items, variant }: { items?: string[]; variant: "warning" | "info" | "neutral" }) {
  if (!items || items.length === 0) return null;
  const colorMap = {
    warning: "text-amber-600",
    info: "text-blue-600",
    neutral: "text-muted-foreground",
  };
  const iconMap = {
    warning: AlertTriangle,
    info: CheckCircle2,
    neutral: Package,
  };
  const Icon = iconMap[variant];
  return (
    <div className="space-y-0.5">
      {items.map((item, i) => (
        <div key={i} className={cn("flex items-start gap-1.5 text-xs", colorMap[variant])}>
          <Icon className="h-3 w-3 flex-shrink-0 mt-0.5" />
          {item}
        </div>
      ))}
    </div>
  );
}
