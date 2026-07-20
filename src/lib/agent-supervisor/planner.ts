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
      maxTokens: 2800,
      temperature: 0.2,
      timeoutMs: 45_000,
    });

    const cleaned = result.content
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      // JSON 截断：再要一次更短的计划
      const repair = await callSupervisorCompletion("repair", {
        systemPrompt:
          "你只输出合法 JSON 计划，steps 最多 3 个，每个字段尽量短。不要 markdown。",
        userPrompt: [
          `目标：${state.objective}`,
          `候选技能：${(state.complexity?.candidateSkills || []).join(", ")}`,
          `上次输出无法解析：${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          `请重新输出完整 JSON。`,
        ].join("\n"),
        orgId: state.orgId,
        userId: state.userId,
        maxTokens: 1200,
        temperature: 0.1,
        timeoutMs: 30_000,
      });
      parsed = JSON.parse(
        repair.content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim(),
      );
      result.fallbackUsed = true;
      result.fallbackReason = `planner_json_repair: ${
        parseErr instanceof Error ? parseErr.message : String(parseErr)
      }`;
      result.actualModel = repair.actualModel;
    }
    let plan = PlannerOutputSchema.parse(parsed);

    // 模型步骤过少但候选充足时，用规则计划补齐（仍计为 llm，因主规划来自模型）
    const candidateList = state.complexity?.candidateSkills || [];
    if (plan.steps.length < 2 && candidateList.length >= 2) {
      const enriched = heuristicPlan(state);
      plan = PlannerOutputSchema.parse({
        ...plan,
        steps: enriched.steps,
        assumptions: [
          ...(plan.assumptions || []),
          "模型步骤偏少，已按候选技能补齐多步计划",
        ],
      });
    }

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
    // 超时/中止：再试一次（callSupervisorCompletion 内已处理 403；此处覆盖 abort）
    if (/aborted|timeout|超时/i.test(reason)) {
      try {
        const retry = await callSupervisorCompletion("planner", {
          systemPrompt: PLANNER_SYSTEM_PROMPT,
          userPrompt: [
            `目标：${state.objective}`,
            `候选技能：${(state.complexity?.candidateSkills || []).join(", ")}`,
            `最多步骤：${state.maxSteps}`,
            "只输出简洁 JSON 计划。",
          ].join("\n"),
          orgId: state.orgId,
          userId: state.userId,
          maxTokens: 1000,
          temperature: 0.1,
          timeoutMs: 45_000,
        });
        const cleaned = retry.content
          .replace(/```json\s*/g, "")
          .replace(/```\s*/g, "")
          .trim();
        const plan = PlannerOutputSchema.parse(JSON.parse(cleaned));
        logger.warn("supervisor.planner.retry_ok", {
          reason,
          actualModel: retry.actualModel,
        });
        return {
          plan,
          source: "llm",
          modelMeta: {
            requestedModel: retry.requestedModel,
            actualModel: retry.actualModel,
            fallbackUsed: true,
            fallbackReason: `planner_timeout_retry: ${reason}`,
          },
        };
      } catch {
        /* fall through to rules */
      }
    }
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
