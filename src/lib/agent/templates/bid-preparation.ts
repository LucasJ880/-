/**
 * 投标准备流程模板 — 6 步
 */

import type { FlowTemplate } from "../types";

export const BID_PREPARATION_TEMPLATE: FlowTemplate = {
  id: "bid_preparation",
  name: "投标准备流程",
  description: "从项目分析到报价生成的完整投标准备流程",
  taskType: "bid_preparation",
  matchKeywords: ["投标", "报价", "投标准备", "准备报价", "做报价", "生成报价"],
  steps: [
    {
      skillId: "project_understanding",
      title: "加载项目上下文",
      description: "获取项目详情、任务统计、供应商记录和 AI 历史记忆",
      riskLevel: "low",
      requiresApproval: false,
    },
    {
      skillId: "quote_template_recommend",
      title: "推荐报价模板",
      description: "根据项目类型和客户自动推荐最合适的报价模板",
      riskLevel: "low",
      requiresApproval: false,
    },
    {
      skillId: "quote_draft_generate",
      title: "生成报价草稿",
      description: "基于项目资料和供应商报价生成完整的报价草稿",
      riskLevel: "medium",
      requiresApproval: true,
      inputMapping: { templateType: "steps[1].output.recommendation.templateType" },
    },
    {
      skillId: "quote_review",
      title: "报价审查",
      description: "使用规则引擎和 AI 对报价进行风险审查",
      riskLevel: "low",
      requiresApproval: false,
    },
    {
      skillId: "progress_summary",
      title: "生成投标摘要",
      description: "汇总项目进展和报价状态，生成结构化摘要",
      riskLevel: "low",
      requiresApproval: false,
    },
    {
      skillId: "risk_scan",
      title: "最终风险扫描",
      description: "对项目进行全面风险扫描，确保无遗漏",
      riskLevel: "low",
      requiresApproval: false,
    },
  ],
};
