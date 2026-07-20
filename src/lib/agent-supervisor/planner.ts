/**
 * Planner — 生成多步计划（Zod 校验；模型失败后才规则降级）
 */

import { isAIConfigured } from "@/lib/ai/config";
import { callSupervisorCompletion } from "./model-resolve";
import {
  PlannerOutputSchema,
  type PlannerOutput,
  type SupervisorState,
  type SupervisorStep,
} from "./types";
import { workerSummariesForPrompt } from "./worker-registry";
import { PLANNER_SYSTEM_PROMPT } from "./prompts/planner";
import { logger } from "@/lib/common/logger";

function heuristicPlan(state: SupervisorState): PlannerOutput {
  const skills =
    state.complexity?.candidateSkills?.length
      ? state.complexity.candidateSkills
      : ["sales-pipeline-forecast", "sales-next-best-action"];

  const worker =
    (state.complexity?.candidateWorker as SupervisorStep["worker"]) ||
    "sales";

  const steps = skills.slice(0, state.maxSteps).map((slug, i) => ({
    id: `step-${i + 1}`,
    order: i + 1,
    worker:
      slug.startsWith("tender-")
        ? ("tender" as const)
        : slug.startsWith("marketing-") || slug.startsWith("mmm-")
          ? slug.startsWith("mmm-")
            ? ("analytics" as const)
            : ("marketing" as const)
          : worker === "tender" ||
              worker === "marketing" ||
              worker === "analytics"
            ? worker
            : ("sales" as const),
    skillSlug: slug,
    objective: `${state.objective}（步骤 ${i + 1}）`,
    input: {
      objective: state.objective,
      ...(state.pageContext?.projectId
        ? { projectId: state.pageContext.projectId }
        : {}),
    },
    dependsOn: i === 0 ? [] : [`step-${i}`],
    mayCreatePendingAction: i === skills.length - 1,
  }));

  return PlannerOutputSchema.parse({
    objective: state.objective,
    assumptions: ["基于当前组织已启用技能与页面上下文"],
    completionCriteria: ["完成计划步骤并输出管理摘要"],
    steps,
    expectedApprovalPoints: steps
      .filter((s) => s.mayCreatePendingAction)
      .map((s) => s.id),
    missingInformation: state.resolvedContext.missingContext || [],
  });
}

export async function createSupervisorPlan(
  state: SupervisorState,
): Promise<{
  plan: PlannerOutput;
  source: "llm" | "rules";
  modelMeta?: {
    requestedModel: string;
    actualModel: string;
    fallbackUsed: boolean;
    fallbackReason?: string;
  };
}> {
  const fallback = heuristicPlan(state);
  if (!isAIConfigured()) {
    logger.warn("supervisor.planner.rules_fallback", {
      reason: "AI 未配置",
      requestedModel: null,
    });
    return { plan: fallback, source: "rules" };
  }

  try {
    const skillsText = (state.resolvedContext.availableSkills || [])
      .map((s) => `${s.slug}（${s.name}）`)
      .join(", ");
    const skillsHint = skillsText || "(unknown - use candidate skills only)";
    const candidates = (state.complexity?.candidateSkills || []).join(", ");
    const missing =
      (state.resolvedContext.missingContext || []).join("; ") || "none";
    const userPrompt = [
      `目标：${state.objective}`,
      `原始请求：${state.originalRequest}`,
      `组织：${JSON.stringify(state.resolvedContext.organization || {})}`,
      `页面实体：${JSON.stringify(state.resolvedContext.currentEntity || {})}`,
      `缺失：${missing}`,
      "可用 Worker：",
      workerSummariesForPrompt(),
      `当前组织已启用相关技能：${skillsHint}`,
      `候选技能：${candidates}`,
      `最多步骤：${state.maxSteps}`,
      "只输出 JSON。",
    ].join("\n");

    const result = await callSupervisorCompletion("planner", {
      systemPrompt: PLANNER_SYSTEM_PROMPT,
      userPrompt,
      orgId: state.orgId,
      userId: state.userId,
      maxTokens: 1600,
      temperature: 0.2,
      timeoutMs: 20_000,
    });

    const cleaned = result.content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const plan = PlannerOutputSchema.parse(parsed);
    const modelMeta = {
      requestedModel: result.requestedModel,
      actualModel: result.actualModel,
      fallbackUsed: result.fallbackUsed,
      fallbackReason: result.fallbackReason,
    };
    logger.info("supervisor.planner.llm_ok", modelMeta);
    return { plan, source: "llm", modelMeta };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("supervisor.planner.rules_fallback", {
      reason,
      requestedModel: "see prior model logs",
    });
    return { plan: fallback, source: "rules" };
  }
}

export function plannerOutputToSteps(plan: PlannerOutput): SupervisorStep[] {
  return plan.steps.map((s) => ({
    ...s,
    status: "pending" as const,
    input: s.input || {},
    dependsOn: s.dependsOn || [],
    mayCreatePendingAction: Boolean(s.mayCreatePendingAction),
  }));
}
