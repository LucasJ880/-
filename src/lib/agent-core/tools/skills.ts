/**
 * 动态技能工具 — 注册到 Agent Core 工具注册表
 *
 * 让 AI Agent 能够在对话中直接调用动态技能。
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

registry.register({
  name: "skill.list",
  description: "列出当前组织的所有可用 AI 技能",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      domain: {
        type: "string",
        description: "按域过滤（trade/sales/project/secretary）",
      },
    },
  },
  execute: async (ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { listOrgSkills } = await import("../skills/runtime");
    const skills = await listOrgSkills(ctx.orgId, {
      domain: ctx.args.domain as string | undefined,
    });
    return {
      success: true,
      data: skills.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        domain: s.domain,
        version: s.version,
      })),
    };
  },
});

registry.register({
  name: "skill.run",
  description: "执行一个动态 AI 技能，需提供技能标识和输入参数",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: "技能标识（如 trade-outreach-email）",
      },
      variables: {
        type: "string",
        description: "JSON 格式的输入变量（如 {\"companyName\":\"ABC Corp\"}）",
      },
    },
    required: ["slug", "variables"],
  },
  riskLevel: "medium",
  execute: async (ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { runSkill } = await import("../skills/runtime");

    let variables: Record<string, string> = {};
    try {
      const raw = ctx.args.variables;
      variables = typeof raw === "string" ? JSON.parse(raw) : (raw as Record<string, string>);
    } catch {
      return { success: false, data: null, error: "variables 参数格式错误，需要 JSON" };
    }

    try {
      const result = await runSkill({
        slug: ctx.args.slug as string,
        variables,
        userId: ctx.userId,
        orgId: ctx.orgId,
      });
      return { success: true, data: { content: result.content, executionId: result.executionId } };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

registry.register({
  name: "skill.create_from_description",
  description: "根据用户描述的工作流，自动创建一个新的 AI 技能",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "工作流描述，如：每周一生成外贸市场分析报告",
      },
    },
    required: ["description"],
  },
  riskLevel: "high",
  execute: async (ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { proposeSkillFromDescription, createSkillFromProposal } = await import(
      "../skills/auto-creator"
    );

    const description = ctx.args.description as string;
    const proposal = await proposeSkillFromDescription(ctx.orgId, description);

    if (!proposal) {
      return { success: false, data: null, error: "无法从描述中提取有效技能" };
    }

    try {
      const skillId = await createSkillFromProposal(ctx.orgId, proposal, ctx.userId);
      return {
        success: true,
        data: {
          skillId,
          name: proposal.name,
          slug: proposal.slug,
          description: proposal.description,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});
