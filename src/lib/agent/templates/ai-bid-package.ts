/**
 * AI 一键生成投标方案 — 4 步轻量模板
 *
 * 顺序执行：文档摘要 → 情报分析 → 报价草稿 → 邮件草稿
 */

import type { FlowTemplate } from "../types";

export const AI_BID_PACKAGE_TEMPLATE: FlowTemplate = {
  id: "ai_bid_package",
  name: "AI 一键投标方案",
  description: "自动生成文档摘要、情报分析、报价草稿和邮件草稿",
  taskType: "ai_bid_package",
  matchKeywords: ["一键投标", "投标方案", "一键生成"],
  steps: [
    {
      skillId: "document_summary",
      title: "文档摘要",
      description: "批量生成项目文档的 AI 摘要",
      riskLevel: "low",
      requiresApproval: false,
    },
    {
      skillId: "intelligence_report",
      title: "情报分析",
      description: "生成投标深度情报分析报告",
      riskLevel: "low",
      requiresApproval: false,
    },
    {
      skillId: "quote",
      title: "报价草稿",
      description: "根据项目资料生成报价草稿",
      riskLevel: "medium",
      requiresApproval: false,
      inputMapping: { action: "'draft'" },
    },
    {
      skillId: "email_draft",
      title: "邮件草稿",
      description: "生成投标相关邮件草稿",
      riskLevel: "low",
      requiresApproval: false,
    },
  ],
};
