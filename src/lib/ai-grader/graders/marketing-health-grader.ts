/**
 * MarketingHealthGrader — 复用统一 GraderResult 输出 Growth Center 健康度。
 * 纯只读、严格 orgId 隔离；真实写动作仍走 Finding → Task / PendingAction。
 */
import { getMarketingDashboard } from "@/lib/marketing/query-dashboard";
import type { GraderIssue, GraderResult, RiskLevel } from "../types";

function severityToRisk(severity: string): RiskLevel {
  if (severity === "critical") return "CRITICAL";
  if (severity === "high") return "HIGH";
  if (severity === "medium") return "MEDIUM";
  return "LOW";
}

export async function runMarketingHealthGrader(ctx: { orgId: string; userId: string }): Promise<GraderResult> {
  if (!ctx.orgId || !ctx.userId) throw new Error("MarketingHealthGrader 缺少 orgId / userId");
  const dashboard = await getMarketingDashboard(ctx.orgId);
  const profileIssue: GraderIssue[] = dashboard.profile?.validationStatus === "valid" ? [] : [{
    severity: "CRITICAL",
    category: "brand_truth_invalid",
    title: "企业事实中心尚未通过校验",
    description: "暂停自动检测，先确认地域、行业、产品、标准 NAP 与竞争对手。",
    evidence: `validationScore=${dashboard.profile?.validationScore ?? 0}`,
  }];
  const findingIssues: GraderIssue[] = dashboard.highPriorityFindings.map((finding) => ({
    severity: severityToRisk(finding.severity),
    category: `marketing_${finding.dimension.toLowerCase()}`,
    title: finding.title,
    description: finding.description ?? `${finding.dimension} 发现高优先级问题。`,
    evidence: `findingId=${finding.id}; confidence=${finding.confidence}`,
  }));
  const issues = [...profileIssue, ...findingIssues].slice(0, 8);
  const riskLevel: RiskLevel = issues.some((issue) => issue.severity === "CRITICAL") ? "CRITICAL" : issues.some((issue) => issue.severity === "HIGH") ? "HIGH" : issues.some((issue) => issue.severity === "MEDIUM") ? "MEDIUM" : "LOW";
  const score = dashboard.summary.marketPresence ?? 0;
  return {
    score,
    riskLevel,
    summary: dashboard.summary.marketPresence == null ? "企业事实或营销体检尚未完成。" : `市场存在度 ${score}/100，增长执行力 ${dashboard.summary.growthExecution}/100。`,
    issues,
    suggestedActions: [],
    evidence: dashboard.latestAudit ? [{ sourceType: "TASK", sourceId: dashboard.latestAudit.id, text: `最近营销体检置信度 ${dashboard.latestAudit.confidence}%` }] : [],
  };
}
