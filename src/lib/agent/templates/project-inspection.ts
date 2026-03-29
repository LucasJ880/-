/**
 * 项目巡检流程模板 — 4 步
 */

import type { FlowTemplate } from "../types";

export const PROJECT_INSPECTION_TEMPLATE: FlowTemplate = {
  id: "project_inspection",
  name: "项目巡检",
  description: "对项目进行全面的状态检查和风险扫描",
  taskType: "project_inspection",
  matchKeywords: ["巡检", "检查", "扫描", "风险", "项目检查", "项目巡检", "状态检查"],
  steps: [
    {
      skillId: "project_understanding",
      title: "加载项目上下文",
      description: "获取项目详情、任务统计、供应商记录和 AI 历史记忆",
      riskLevel: "low",
      requiresApproval: false,
    },
    {
      skillId: "risk_scan",
      title: "风险扫描",
      description: "扫描截止日、阶段卡顿、供应商未回复、任务逾期等风险",
      riskLevel: "low",
      requiresApproval: false,
    },
    {
      skillId: "progress_summary",
      title: "生成进展摘要",
      description: "聚合所有数据生成结构化的项目进展报告",
      riskLevel: "low",
      requiresApproval: false,
    },
    {
      skillId: "quote_review",
      title: "报价状态检查",
      description: "检查现有报价的完整性和风险（如有报价单）",
      riskLevel: "low",
      requiresApproval: false,
    },
  ],
};
