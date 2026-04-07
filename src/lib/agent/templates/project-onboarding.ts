/**
 * 项目入驻流程模板 — 新项目上传文档后的自动处理链路
 *
 * 文档摘要 → 情报分析 → 供应链分析 → 进展摘要
 */

import type { FlowTemplate } from "../types";

export const PROJECT_ONBOARDING_TEMPLATE: FlowTemplate = {
  id: "project_onboarding",
  name: "项目入驻",
  description: "新项目上传文档后，自动完成文档摘要、情报分析、供应链分析和进展摘要",
  taskType: "project_onboarding",
  matchKeywords: ["入驻", "新项目", "项目初始化", "上传完成", "开始分析"],
  steps: [
    {
      skillId: "document_summary",
      title: "文档批量摘要",
      description: "为项目中所有已解析文档生成 AI 结构化摘要",
      riskLevel: "low",
      requiresApproval: false,
    },
    {
      skillId: "intelligence_report",
      title: "生成招标情报分析",
      description: "基于文档内容生成 12 章节投标深度情报报告（融合投标策略专家视角）",
      riskLevel: "low",
      requiresApproval: false,
    },
    {
      skillId: "supply_chain_analysis",
      title: "供应链可行性分析",
      description: "分析供应链可行性、供应商风险、物流方案、合规要求和成本结构",
      riskLevel: "low",
      requiresApproval: false,
    },
    {
      skillId: "progress_summary",
      title: "生成项目进展摘要",
      description: "汇总项目当前状态，输出结构化进展报告（融合项目管理专家视角）",
      riskLevel: "low",
      requiresApproval: false,
    },
  ],
};
