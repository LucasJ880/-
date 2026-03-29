/**
 * 风险扫描 Skill — 复用 proactive/scanner 进行项目风险检测
 */

import { scanProjectsForUser } from "@/lib/proactive/scanner";
import { registerSkill } from "./registry";
import type { SkillContext, SkillResult, CheckReport, CheckIssue } from "../types";

async function execute(ctx: SkillContext): Promise<SkillResult> {
  try {
    const scanResult = await scanProjectsForUser(ctx.userId, "admin");

    const projectSuggestions = scanResult.suggestions.filter(
      (s) => s.projectId === ctx.projectId
    );

    const issues: CheckIssue[] = projectSuggestions.map((s) => ({
      level: s.severity === "urgent" ? "urgent" as const : s.severity === "warning" ? "warning" as const : "info" as const,
      message: s.title,
      suggestion: s.description,
    }));

    const blockers = issues.filter((i) => i.level === "urgent");
    const score = Math.max(0, 100 - blockers.length * 25 - issues.length * 5);

    const checkReport: CheckReport = {
      passed: blockers.length === 0,
      score,
      issues,
      blockers,
    };

    return {
      success: true,
      data: {
        suggestions: projectSuggestions,
        scannedAt: scanResult.scannedAt,
        totalProjectsScanned: scanResult.projectCount,
      },
      summary: `风险扫描完成：发现 ${issues.length} 项风险（${blockers.length} 项紧急）`,
      checkReport,
    };
  } catch (err) {
    return {
      success: false,
      data: {},
      summary: "风险扫描失败",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

registerSkill({
  id: "risk_scan",
  name: "风险扫描",
  domain: "risk",
  description: "扫描项目截止日、阶段卡顿、供应商未回复、任务逾期等风险，生成风险评分和建议",
  riskLevel: "low",
  requiresApproval: false,
  inputDescription: "projectId, userId",
  outputDescription: "suggestions[], checkReport (score, issues, blockers)",
  execute,
});
