"use client";

import { AlertTriangle, CheckCircle2, TrendingUp, Sparkles, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { TEMPLATE_LABELS } from "@/lib/quote/types";
import type { TemplateType } from "@/lib/quote/types";
import type { CheckItem } from "@/lib/quote/rules";

interface Props {
  templateType: TemplateType;
  checks: CheckItem[];
  profitMargin: number | null;
  status: string;
  lineCount: number;
  aiReviewRisk?: "low" | "medium" | "high" | null;
}

export function QuoteTopSummary({
  templateType,
  checks,
  profitMargin,
  status,
  lineCount,
  aiReviewRisk,
}: Props) {
  const issues = checks.filter((c) => c.severity !== "passed");
  const urgentCount = checks.filter((c) => c.severity === "urgent").length;
  const passedCount = checks.filter((c) => c.severity === "passed").length;

  const hasUrgent = urgentCount > 0;

  if (status === "confirmed") {
    return (
      <div className="flex items-center gap-4 rounded-lg border border-[rgba(46,122,86,0.25)] bg-[rgba(46,122,86,0.04)] px-4 py-2 text-xs">
        <div className="flex items-center gap-1.5 text-[#2e7a56]">
          <CheckCircle2 size={12} />
          <span className="font-medium">已确认</span>
        </div>
        <div className="h-3 w-px bg-border" />
        <div className="flex items-center gap-1.5 text-foreground">
          <span className="text-muted">模板:</span>
          <span>{TEMPLATE_LABELS[templateType]}</span>
        </div>
        {profitMargin != null && (
          <>
            <div className="h-3 w-px bg-border" />
            <MarginDisplay profitMargin={profitMargin} />
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-muted">
          <FileText size={11} />
          <span>可导出客户版 / 内部版</span>
        </div>
      </div>
    );
  }

  if (lineCount === 0) {
    return (
      <div className="flex items-center gap-4 rounded-lg border border-accent/20 bg-accent/3 px-4 py-2 text-xs">
        <div className="flex items-center gap-1.5 text-foreground">
          <span className="text-muted">模板:</span>
          <span className="text-accent">{TEMPLATE_LABELS[templateType]}</span>
        </div>
        <div className="h-3 w-px bg-border" />
        <div className="flex items-center gap-1.5 text-muted">
          <Sparkles size={11} className="text-accent/60" />
          <span>待填写 · 可使用 AI 生成报价草稿</span>
        </div>
      </div>
    );
  }

  if (hasUrgent) {
    return (
      <div className="flex items-center gap-4 rounded-lg border border-[rgba(166,61,61,0.25)] bg-[rgba(166,61,61,0.04)] px-4 py-2 text-xs">
        <div className="flex items-center gap-1.5 text-[#a63d3d]">
          <AlertTriangle size={12} />
          <span className="font-medium">检测到 {urgentCount} 项高风险</span>
        </div>
        {issues.length > urgentCount && (
          <span className="text-[#9a6a2f]">+ {issues.length - urgentCount} 项待检查</span>
        )}
        <div className="h-3 w-px bg-border" />
        {profitMargin != null && <MarginDisplay profitMargin={profitMargin} />}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border/60 bg-card px-4 py-2 text-xs">
      <div className="flex items-center gap-1.5 text-foreground">
        <span className="text-muted">模板:</span>
        <span className="text-accent">{TEMPLATE_LABELS[templateType]}</span>
      </div>

      <div className="h-3 w-px bg-border" />

      {issues.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={12} className="text-[#9a6a2f]" />
          <span className="font-medium text-[#9a6a2f]">
            {issues.length} 项待检查
          </span>
          {passedCount > 0 && (
            <span className="text-muted">· {passedCount} 项通过</span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-[#2e7a56]">
          <CheckCircle2 size={12} />
          <span className="font-medium">全部通过</span>
        </div>
      )}

      {profitMargin != null && (
        <>
          <div className="h-3 w-px bg-border" />
          <MarginDisplay profitMargin={profitMargin} />
        </>
      )}

      {aiReviewRisk && (
        <>
          <div className="h-3 w-px bg-border" />
          <div className={cn(
            "flex items-center gap-1 rounded-full px-2 py-0.5",
            aiReviewRisk === "high" ? "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]" :
            aiReviewRisk === "medium" ? "bg-[rgba(154,106,47,0.08)] text-[#9a6a2f]" :
            "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
          )}>
            <Sparkles size={9} />
            <span className="font-medium">
              AI 审查: {aiReviewRisk === "high" ? "高风险" : aiReviewRisk === "medium" ? "中风险" : "低风险"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function MarginDisplay({ profitMargin }: { profitMargin: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <TrendingUp size={12} className="text-muted" />
      <span className={cn(
        "font-medium",
        profitMargin < 5 ? "text-[#a63d3d]" :
        profitMargin < 10 ? "text-[#9a6a2f]" :
        "text-[#2e7a56]"
      )}>
        利润率 {profitMargin}%
      </span>
    </div>
  );
}
