/**
 * 子能力调度 — 仅当 Plan 点名时调用，不无条件跑四个 Grader
 */

import type { AgentPlan } from "./plan";
import { appendAgentRunEvent } from "./run";

export type CapabilityName =
  | "grader.daily_brief"
  | "grader.customer_followup"
  | "grader.quote_risk"
  | "grader.project_health";

const INTENT_TO_CAPABILITY: Record<string, CapabilityName> = {
  daily_brief: "grader.daily_brief",
  customer: "grader.customer_followup",
  quote: "grader.quote_risk",
  project: "grader.project_health",
};

/** 从 Plan 解析要跑的子能力（最多 1 个，保守） */
export function resolvePlanCapability(plan: AgentPlan): CapabilityName | null {
  for (const s of plan.skills) {
    const name = s.trim().toLowerCase();
    if (
      name === "grader.daily_brief" ||
      name === "grader.customer_followup" ||
      name === "grader.quote_risk" ||
      name === "grader.project_health"
    ) {
      return name;
    }
    if (name === "daily_brief" || name === "daily-brief") {
      return "grader.daily_brief";
    }
    if (name === "customer_followup" || name === "followup") {
      return "grader.customer_followup";
    }
    if (name === "quote_risk" || name === "quote") {
      return "grader.quote_risk";
    }
    if (name === "project_health" || name === "project") {
      return "grader.project_health";
    }
  }

  // 仅当意图明确且 needsTools 时，才按 intent 映射（避免闲聊误触）
  if (plan.needsTools || plan.complexity !== "simple") {
    const mapped = INTENT_TO_CAPABILITY[plan.intent];
    if (mapped) return mapped;
  }

  return null;
}

export async function runNamedCapability(input: {
  orgId: string;
  userId: string;
  channel: string;
  externalUserId: string;
  runId: string;
  capability: CapabilityName;
  plan: AgentPlan;
}): Promise<string> {
  const { orgId, userId, channel, externalUserId, runId, capability, plan } =
    input;

  await appendAgentRunEvent({
    orgId,
    runId,
    eventType: "skill.started",
    title: `子能力 ${capability}`,
    payload: { capability },
    visibleToUser: true,
  });

  const base = { userId, orgId, channel, externalUserId, agentRunId: runId };
  let text = "";

  try {
    switch (capability) {
      case "grader.daily_brief": {
        const m = await import("@/lib/ai-grader/wechat-daily-brief");
        text = await m.runDailyBriefForWeChat(base);
        break;
      }
      case "grader.customer_followup": {
        const m = await import("@/lib/ai-grader/wechat-customer-followup");
        text = await m.runCustomerFollowupForWeChat({
          ...base,
          intent: plan.entities.customerId
            ? { mode: "CUSTOMER", customerId: plan.entities.customerId }
            : { mode: "GLOBAL" },
        });
        break;
      }
      case "grader.quote_risk": {
        const m = await import("@/lib/ai-grader/wechat-quote-risk");
        text = await m.runQuoteRiskForWeChat({
          ...base,
          intent: plan.entities.quoteId
            ? { mode: "QUOTE", quoteId: plan.entities.quoteId }
            : { mode: "GLOBAL" },
        });
        break;
      }
      case "grader.project_health": {
        const m = await import("@/lib/ai-grader/wechat-project-health");
        text = await m.runProjectHealthForWeChat({
          ...base,
          intent: plan.entities.projectId
            ? { mode: "PROJECT", projectId: plan.entities.projectId }
            : { mode: "GLOBAL" },
        });
        break;
      }
      default:
        text = "暂不支持该子能力。";
    }

    await appendAgentRunEvent({
      orgId,
      runId,
      eventType: "skill.completed",
      title: `${capability} 完成`,
      visibleToUser: false,
    });
    return text;
  } catch (error) {
    await appendAgentRunEvent({
      orgId,
      runId,
      eventType: "run.failed",
      title: "子能力失败",
      payload: {
        capability,
        error: error instanceof Error ? error.message : String(error),
      },
      visibleToUser: true,
    });
    throw error;
  }
}
