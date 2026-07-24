import { createCompletion } from "@/lib/ai/client";
import { getRuntimeV2Limits } from "./flags";
import {
  PlannerOutputSchema,
  type PlannerOutput,
  type ToolDescriptor,
} from "./schemas";
import { RUNTIME_V2_TOOL_CATALOG } from "./tool-catalog";

export type PlannerInput = {
  orgId: string;
  userId: string;
  userRole: string;
  channel: string;
  goal: string;
  conversationContext?: unknown;
  currentCustomerId?: string;
  currentQuoteId?: string;
  currentProjectId?: string;
  availableTools?: ToolDescriptor[];
};

export type PlannerResult =
  | { ok: true; plan: PlannerOutput; source: "template" | "model" }
  | { ok: false; error: string; clarification?: string };

function allowedToolSet(tools: ToolDescriptor[]): Set<string> {
  return new Set(tools.map((t) => t.name));
}

/** 裁剪并校验：非法 tool 清除 preferredTool；超步数截断 */
export function sanitizePlannerOutput(
  raw: unknown,
  tools: ToolDescriptor[],
  maxSteps: number,
): PlannerResult {
  const parsed = PlannerOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `Invalid planner output: ${parsed.error.message}` };
  }
  const allow = allowedToolSet(tools);
  let steps = parsed.data.steps.map((s) => {
    if (s.preferredTool && !allow.has(s.preferredTool)) {
      return { ...s, preferredTool: undefined };
    }
    return s;
  });
  if (steps.length > maxSteps) {
    steps = steps.slice(0, maxSteps);
  }
  if (steps.length === 0) {
    return { ok: false, error: "Planner produced zero steps" };
  }
  // reject if any preferredTool still invalid (shouldn't)
  for (const s of steps) {
    if (s.preferredTool && !allow.has(s.preferredTool)) {
      return { ok: false, error: `Illegal tool in plan: ${s.preferredTool}` };
    }
  }
  const plan: PlannerOutput = { ...parsed.data, steps };
  if (plan.needsClarification && plan.clarificationQuestion) {
    return {
      ok: false,
      error: "clarification_required",
      clarification: plan.clarificationQuestion,
    };
  }
  return { ok: true, plan, source: "template" };
}

/** 黄金场景确定性计划（仍经 Zod + sanitize，不直写业务） */
export function buildSalesFollowupGoldenPlan(): PlannerOutput {
  return {
    objective: "梳理最近销售跟进并准备最多 3 个高优先级客户的可审批动作",
    summary:
      "查询 Pipeline 与客户/报价证据，运行跟进与报价风险分析，选出最多 3 个客户，准备任务、跟进日期与 Gmail 草稿，全部经 PendingAction 审批。",
    assumptions: [
      "当前组织为用户 activeOrg",
      "写操作必须经 PendingAction",
      "Gmail 仅创建草稿",
    ],
    missingInformation: [],
    needsClarification: false,
    completionCriteria: [
      {
        id: "c1",
        description: "已读取 Pipeline 与近期商机证据",
        verificationType: "tool_result",
      },
      {
        id: "c2",
        description: "已运行跟进/报价分析并选出 ≤3 个优先客户",
        verificationType: "tool_result",
      },
      {
        id: "c3",
        description: "写操作均已通过 PendingAction 审批并真实落库/建草稿",
        verificationType: "database_state",
      },
      {
        id: "c4",
        description: "最终报告明确完成项与未完成项",
        verificationType: "model_judgement",
      },
    ],
    steps: [
      {
        id: "s1_pipeline",
        title: "查询销售 Pipeline",
        description: "读取当前组织 Pipeline 概览",
        dependsOn: [],
        preferredTool: "sales_get_pipeline",
        executionMode: "read",
        riskLevel: "LOW",
        requiresApproval: false,
        expectedOutput: "pipeline 阶段统计",
      },
      {
        id: "s2_opportunities",
        title: "列出近期商机",
        description: "拉取活跃商机列表",
        dependsOn: ["s1_pipeline"],
        preferredTool: "sales_list_opportunities",
        executionMode: "read",
        riskLevel: "LOW",
        requiresApproval: false,
        expectedOutput: "商机列表",
      },
      {
        id: "s3_followup_analysis",
        title: "跟进优先级分析",
        description: "运行 CustomerFollowupGrader",
        dependsOn: ["s2_opportunities"],
        preferredTool: "sales_customer_followup_analysis",
        executionMode: "analysis",
        riskLevel: "LOW",
        requiresApproval: false,
        expectedOutput: "跟进优先级结果",
      },
      {
        id: "s4_quote_risk",
        title: "报价风险分析",
        description: "运行 QuoteRiskGrader",
        dependsOn: ["s2_opportunities"],
        preferredTool: "sales_quote_risk_analysis",
        executionMode: "analysis",
        riskLevel: "LOW",
        requiresApproval: false,
        expectedOutput: "报价风险结果",
      },
      {
        id: "s5_prioritize",
        title: "选出最多 3 个优先客户",
        description: "合并分析证据并排序",
        dependsOn: ["s3_followup_analysis", "s4_quote_risk"],
        preferredTool: "sales_prioritize_followups",
        executionMode: "analysis",
        riskLevel: "LOW",
        requiresApproval: false,
        expectedOutput: "≤3 个客户及策略",
      },
      {
        id: "s6_followup_tasks",
        title: "准备跟进任务",
        description: "为优先客户创建 CRM 跟进任务草稿",
        dependsOn: ["s5_prioritize"],
        preferredTool: "grader_create_followup_task",
        executionMode: "write",
        riskLevel: "HIGH",
        requiresApproval: true,
        expectedOutput: "PendingAction 任务草稿",
      },
      {
        id: "s7_followup_dates",
        title: "准备跟进日期调整",
        description: "为需要改期的商机生成跟进日期 PendingAction",
        dependsOn: ["s5_prioritize"],
        preferredTool: "sales_update_followup",
        executionMode: "write",
        riskLevel: "HIGH",
        requiresApproval: true,
        expectedOutput: "PendingAction 日期调整",
      },
      {
        id: "s8_gmail_drafts",
        title: "准备 Gmail 草稿",
        description: "为优先客户创建邮件草稿 PendingAction",
        dependsOn: ["s5_prioritize"],
        preferredTool: "gmail_create_draft",
        executionMode: "write",
        riskLevel: "HIGH",
        requiresApproval: true,
        expectedOutput: "PendingAction Gmail 草稿",
      },
    ],
  };
}

function isSalesFollowupGoal(goal: string): boolean {
  return /销售跟进|跟进处理|最近的?销售|pipeline.*跟进|跟进.*客户/i.test(goal);
}

/**
 * Planner：阶段禁止执行工具。黄金场景用模板；其它目标走模型结构化输出。
 */
export async function planAgentRuntimeV2(
  input: PlannerInput,
): Promise<PlannerResult> {
  const tools = input.availableTools?.length
    ? input.availableTools
    : RUNTIME_V2_TOOL_CATALOG;
  const { maxSteps } = getRuntimeV2Limits();

  if (isSalesFollowupGoal(input.goal)) {
    const result = sanitizePlannerOutput(
      buildSalesFollowupGoldenPlan(),
      tools,
      maxSteps,
    );
    if (result.ok) return { ...result, source: "template" };
    return result;
  }

  // 简单目标：拒绝过度规划
  if (input.goal.trim().length < 8 && !/[?？]/.test(input.goal)) {
    return {
      ok: false,
      error: "clarification_required",
      clarification: "请描述需要完成的具体目标（例如：处理最近的销售跟进）。",
    };
  }

  const toolLines = tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description} (readOnly=${t.readOnly}, approval=${t.requiresApproval})`,
    )
    .join("\n");

  const system = `你是青砚 Agent Runtime Planner。只输出 JSON，不要执行工具。
规则：
- steps 最多 ${maxSteps} 个
- preferredTool 必须来自可用工具列表，否则省略该字段
- 能通过工具查到的信息不要询问用户
- 只有真正阻断执行的缺失信息才设 needsClarification=true
- 写操作 must requiresApproval=true
- 简单查询不要拆超过 3 步`;

  const user = JSON.stringify({
    goal: input.goal,
    orgId: input.orgId,
    userRole: input.userRole,
    channel: input.channel,
    currentCustomerId: input.currentCustomerId,
    availableTools: toolLines,
    schemaHint: {
      objective: "string",
      summary: "string",
      assumptions: ["string"],
      missingInformation: ["string"],
      needsClarification: false,
      completionCriteria: [
        { id: "c1", description: "...", verificationType: "tool_result" },
      ],
      steps: [
        {
          id: "s1",
          title: "...",
          description: "...",
          dependsOn: [],
          preferredTool: "sales_get_pipeline",
          executionMode: "read",
          riskLevel: "LOW",
          requiresApproval: false,
          expectedOutput: "...",
        },
      ],
    },
  });

  try {
    const text = await createCompletion({
      systemPrompt: system,
      userPrompt: user,
      temperature: 0.1,
      maxTokens: 2500,
      orgId: input.orgId,
      userId: input.userId,
    });
    const jsonMatch = text.trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, error: "Planner model returned no JSON" };
    }
    const result = sanitizePlannerOutput(
      JSON.parse(jsonMatch[0]),
      tools,
      maxSteps,
    );
    if (result.ok) return { ...result, source: "model" };
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
