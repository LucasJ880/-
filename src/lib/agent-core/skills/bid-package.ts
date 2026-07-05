/**
 * AI 一键投标方案 — agent-core 执行路径（A-P2）
 *
 * 取代 lib/agent/orchestrator.generatePlan 的 ai_bid_package 模板路径：
 * 步骤定义收敛到本模块，任务仍持久化为 AgentTask / AgentTaskStep
 * （前端 AI 工作台读该表，A-P4 再统一收敛展示链路）。
 */

import { db } from "@/lib/db";

interface BidPackageStep {
  skillId: string;
  title: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  agentName: string;
  inputMapping?: Record<string, string>;
}

/** 顺序执行：文档摘要 → 情报分析 → 报价草稿 → 邮件草稿 */
export const BID_PACKAGE_STEPS: BidPackageStep[] = [
  {
    skillId: "document_summary",
    title: "文档摘要",
    description: "批量生成项目文档的 AI 摘要",
    riskLevel: "low",
    requiresApproval: false,
    agentName: "文档摘要",
  },
  {
    skillId: "intelligence_report",
    title: "情报分析",
    description: "生成投标深度情报分析报告",
    riskLevel: "low",
    requiresApproval: false,
    agentName: "招标情报分析",
  },
  {
    skillId: "quote",
    title: "报价草稿",
    description: "根据项目资料生成报价草稿",
    riskLevel: "medium",
    requiresApproval: false,
    agentName: "报价助手",
    inputMapping: { action: "'draft'" },
  },
  {
    skillId: "email_draft",
    title: "邮件草稿",
    description: "生成投标相关邮件草稿",
    riskLevel: "low",
    requiresApproval: false,
    agentName: "询价邮件草稿",
  },
];

export interface CreateBidPackageTaskResult {
  taskId: string;
  taskType: string;
  steps: Array<{ skillId: string; title: string }>;
  source: "template";
}

export async function createBidPackageTask(args: {
  projectId: string;
  userId: string;
}): Promise<CreateBidPackageTaskResult> {
  const task = await db.agentTask.create({
    data: {
      projectId: args.projectId,
      taskType: "ai_bid_package",
      triggerType: "manual",
      intent: "AI 一键生成投标方案",
      riskLevel: "medium",
      status: "queued",
      totalSteps: BID_PACKAGE_STEPS.length,
      requiresApproval: false,
      createdById: args.userId,
      steps: {
        create: BID_PACKAGE_STEPS.map((s, i) => ({
          stepIndex: i,
          skillId: s.skillId,
          agentName: s.agentName,
          title: s.title,
          description: s.description,
          riskLevel: s.riskLevel,
          requiresApproval: s.requiresApproval,
          status: "pending",
          inputJson: s.inputMapping ? JSON.stringify(s.inputMapping) : null,
        })),
      },
    },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });

  return {
    taskId: task.id,
    taskType: "ai_bid_package",
    steps: task.steps.map((s) => ({ skillId: s.skillId, title: s.title })),
    source: "template",
  };
}
