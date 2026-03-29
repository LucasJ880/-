/**
 * 审查层 — 独立于执行层，只产出检查报告，不修改数据
 */

import type { SkillResult, CheckReport, CheckIssue } from "./types";

/**
 * 对步骤执行结果进行审查
 *
 * 如果 Skill 自带 checkReport（如 quote_review、risk_scan），直接使用。
 * 否则基于通用规则生成报告。
 */
export function runStepCheck(
  skillId: string,
  result: SkillResult
): CheckReport {
  // Skill 自带审查结果时直接返回
  if (result.checkReport) {
    return result.checkReport;
  }

  // 执行失败
  if (!result.success) {
    return {
      passed: false,
      score: 0,
      issues: [
        {
          level: "urgent",
          message: `步骤执行失败：${result.error ?? result.summary}`,
        },
      ],
      blockers: [
        {
          level: "urgent",
          message: `步骤执行失败：${result.error ?? result.summary}`,
        },
      ],
    };
  }

  // 通用成功检查
  const issues: CheckIssue[] = [];

  // 检查输出数据是否为空
  if (
    !result.data ||
    (typeof result.data === "object" && Object.keys(result.data).length === 0)
  ) {
    issues.push({
      level: "warning",
      message: "步骤执行成功但输出数据为空",
      suggestion: "请检查步骤逻辑是否正确",
    });
  }

  // 检查摘要是否有意义
  if (!result.summary || result.summary.length < 5) {
    issues.push({
      level: "info",
      message: "步骤摘要信息不完整",
    });
  }

  const blockers = issues.filter((i) => i.level === "urgent");
  const score = Math.max(
    0,
    100 - blockers.length * 30 - issues.length * 5
  );

  return {
    passed: blockers.length === 0,
    score,
    issues,
    blockers,
  };
}
