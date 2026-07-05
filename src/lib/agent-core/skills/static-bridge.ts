/**
 * 静态技能桥接层（A-P2：Agent 三栈合并）
 *
 * 把 lib/agent/skills 的 10 个静态技能收敛到 agent-core 执行路径：
 * - 技能实现文件保留为叶子模块（纯函数 + AI 调用，不依赖 orchestrator/executor）
 * - 运行入口统一走本模块 runStaticSkill()：
 *   - agent-core 工具注册（tools/project-skills.ts）
 *   - ai-bid-package 两个 route
 * - lib/agent 的 orchestrator/executor 不再是必经路径，A-P4 退役
 *
 * 10 个技能的去向：
 * - 9 个桥接为 project 域工具（见 STATIC_SKILL_TOOL_NAMES）
 * - sales_followup 不桥接：能力已被 agent-core sales 域现有工具覆盖
 *   （secretary_scan_followups / sales_update_followup / sales_get_coaching）
 */

import { db } from "@/lib/db";
import { getSkill } from "@/lib/agent/skills";
import "@/lib/agent/skills/index";
import type { SkillResult } from "@/lib/agent/types";

/** 静态技能 ID → agent-core 工具名 */
export const STATIC_SKILL_TOOL_NAMES: Record<string, string> = {
  project_understanding: "project_understanding",
  progress_summary: "project_progress_summary",
  risk_scan: "project_risk_scan",
  intelligence_report: "project_intelligence_report",
  document_summary: "project_document_summary",
  tender_analysis: "project_tender_analysis",
  supply_chain_analysis: "project_supply_chain_analysis",
  quote: "project_bid_quote",
  email_draft: "project_inquiry_email_draft",
};

export interface RunStaticSkillArgs {
  projectId: string;
  userId: string;
  /**
   * 提供时强制校验项目归属组织（工具调用路径必传）。
   * legacy 项目 orgId 为 null 时放行，与现有项目访问语义一致。
   */
  orgId?: string;
  input?: Record<string, unknown>;
}

/**
 * 统一静态技能执行入口。
 * 返回原 SkillResult 结构，调用方自行决定持久化方式
 * （工具路径包装为 ToolExecutionResult；ai-bid-package 写 AgentTaskStep）。
 */
export async function runStaticSkill(
  skillId: string,
  args: RunStaticSkillArgs,
): Promise<SkillResult> {
  const skill = getSkill(skillId);
  if (!skill) {
    return {
      success: false,
      data: {},
      summary: `静态技能未注册: ${skillId}`,
      error: `未知静态技能: ${skillId}`,
    };
  }

  const project = await db.project.findUnique({
    where: { id: args.projectId },
    select: { id: true, orgId: true },
  });
  if (!project) {
    return { success: false, data: {}, summary: "项目不存在", error: "Project not found" };
  }
  if (args.orgId && project.orgId && project.orgId !== args.orgId) {
    return {
      success: false,
      data: {},
      summary: "项目不属于当前组织",
      error: "Project does not belong to current organization",
    };
  }

  return skill.execute({
    projectId: args.projectId,
    userId: args.userId,
    // 桥接路径没有 AgentTask 语义；现有技能实现不消费这两个字段
    taskId: "",
    stepId: "",
    input: args.input ?? {},
  });
}
