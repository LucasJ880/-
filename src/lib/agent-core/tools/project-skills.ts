/**
 * project 域工具 — 静态技能桥接（A-P2）
 *
 * 把 lib/agent/skills 中 9 个项目域静态技能注册为 agent-core 工具，
 * 统一经 runStaticSkill() 执行（含项目 org 归属校验）。
 * RBAC 声明见 _policy.ts。
 */

import { registry } from "../tool-registry";
import { runStaticSkill } from "../skills/static-bridge";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
  ToolParameterSchema,
  ToolPropertySchema,
} from "../types";

const PROJECT_ID_PROP: ToolPropertySchema = {
  type: "string",
  description: "项目 ID",
};

function makeParams(
  extra?: Record<string, ToolPropertySchema>,
): ToolParameterSchema {
  return {
    type: "object",
    properties: { projectId: PROJECT_ID_PROP, ...(extra ?? {}) },
    required: ["projectId"],
  };
}

function makeExecute(skillId: string) {
  return async (ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { projectId, ...input } = ctx.args;
    if (typeof projectId !== "string" || !projectId) {
      return { success: false, data: null, error: "缺少 projectId" };
    }
    const result = await runStaticSkill(skillId, {
      projectId,
      userId: ctx.userId,
      orgId: ctx.orgId,
      input: input as Record<string, unknown>,
    });
    return {
      success: result.success,
      data: { summary: result.summary, ...result.data },
      error: result.error,
    };
  };
}

registry.register({
  name: "project_understanding",
  description: "深度理解项目：汇总项目基础信息、文档摘要与 AI 记忆，输出项目上下文",
  domain: "project",
  parameters: makeParams(),
  execute: makeExecute("project_understanding"),
});

registry.register({
  name: "project_progress_summary",
  description: "生成项目进展摘要：整体状态（green/yellow/red）、关键进展、阻塞项、下一步行动",
  domain: "project",
  parameters: makeParams(),
  execute: makeExecute("progress_summary"),
});

registry.register({
  name: "project_risk_scan",
  description: "扫描项目风险并生成改进建议（deadline、缺文件、缺任务、长期未更新等）",
  domain: "project",
  parameters: makeParams(),
  execute: makeExecute("risk_scan"),
});

registry.register({
  name: "project_intelligence_report",
  description: "生成投标情报分析报告：GO / CONDITIONAL GO / NO-GO 建议、风险等级、匹配度评分",
  domain: "project",
  parameters: makeParams(),
  execute: makeExecute("intelligence_report"),
});

registry.register({
  name: "project_document_summary",
  description: "批量为项目已解析文档生成 AI 结构化摘要（项目名、甲方、预算、技术要求、风险等）",
  domain: "project",
  parameters: makeParams(),
  execute: makeExecute("document_summary"),
});

registry.register({
  name: "project_tender_analysis",
  description: "对项目标书文档做深度分析（依赖文档摘要已生成）",
  domain: "project",
  parameters: makeParams(),
  execute: makeExecute("tender_analysis"),
});

registry.register({
  name: "project_supply_chain_analysis",
  description: "项目供应链分析：可行性、采购策略、供应商评估、物流、合规与成本拆解",
  domain: "project",
  parameters: makeParams(),
  execute: makeExecute("supply_chain_analysis"),
});

registry.register({
  name: "project_bid_quote",
  description:
    "项目投标报价助手：recommend 推荐报价模板 / draft 生成报价草稿 / review 审查最新报价（均为草稿，不落正式单）",
  domain: "project",
  parameters: makeParams({
    action: {
      type: "string",
      description: "报价动作，默认 recommend",
      enum: ["recommend", "draft", "review"],
    },
    templateType: {
      type: "string",
      description: "报价模板类型（draft 时可选，recommend 输出可传入）",
    },
    quoteId: {
      type: "string",
      description: "报价单 ID（review 时可选，默认取最新报价）",
    },
  }),
  execute: makeExecute("quote"),
});

registry.register({
  name: "project_inquiry_email_draft",
  description: "为项目询价项生成邮件草稿（只生成草稿，不发送）",
  domain: "project",
  parameters: makeParams({
    inquiryItemId: {
      type: "string",
      description: "询价项 ID（可选，不传则批量生成）",
    },
  }),
  execute: makeExecute("email_draft"),
});
