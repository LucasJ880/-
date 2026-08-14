/**
 * T5-P0A §4 — 唯一验证链（SHARED PLAN VALIDATION）
 *
 * LLM planner 与 server-authored plan **必须**穿过同一组校验器。本文件是那条链的
 * 唯一实现；processor（LLM 路径）与 job（server 路径）都只能调用这里，
 * 禁止任何一侧另写 validateXxxPlan()。
 *
 *   raw plan
 *     ↓ sanitizePlannerOutput   Zod（PlannerOutputSchema）+ preferredTool 白名单 + step 上限
 *     ↓ validateWorkforcePlanGraph  重复 id / 自依赖 / 依赖闭包 / 前向引用 / 环   ← 本轮新增，两路共用
 *     ↓ applyWorkforceTaskSpecs     worker registry / taskKind / synthesis 规则 / resources 消毒
 *   PlannerOutput（每 step 携带 server 构造的 workforceTask spec）
 *
 * 审计事实：graph 校验此前**不存在**于该链路——悬空依赖/环只会在 executor 表现为
 * `blocked_graph` 卡死并烧掉 lease 与重试预算。确定性计划必须落库前拒绝，
 * 因此补进共享链，LLM 路径同时受益。
 */

import { sanitizePlannerOutput } from "@/lib/agent-runtime-v2/planner";
import type {
  PlannerOutput,
  ToolDescriptor,
} from "@/lib/agent-runtime-v2/schemas";
import { applyWorkforceTaskSpecs } from "./task-contract";
import {
  serverPlanToPlannerOutput,
  validateWorkforcePlanGraph,
  type ServerAuthoredPlanV1,
} from "./server-plan";

export type CompiledPlan = {
  plan: PlannerOutput;
  taskCount: number;
  validationMs: number;
};

export type CompileWorkforcePlanResult =
  | { ok: true; compiled: CompiledPlan }
  | { ok: false; code: string; error: string };

/**
 * 共享编译入口。`raw` 可以是 LLM 原始输出，也可以是 server-authored 计划
 * 转出的 PlannerOutput——两者走完全相同的三道门。
 */
export function compileWorkforcePlan(input: {
  raw: unknown;
  tools: ToolDescriptor[];
  maxSteps: number;
}): CompileWorkforcePlanResult {
  const startedAt = Date.now();

  // 门 1：Zod + 工具白名单 + step 上限（既有 planner 消毒器，两路共用）
  const sanitized = sanitizePlannerOutput(input.raw, input.tools, input.maxSteps);
  if (!sanitized.ok) {
    return {
      ok: false,
      code: sanitized.clarification ? "PLAN_CLARIFICATION_REQUIRED" : "PLAN_SCHEMA_INVALID",
      error: sanitized.error,
    };
  }

  // 门 2：DAG 结构（本轮新增，共享）
  const graph = validateWorkforcePlanGraph(sanitized.plan.steps);
  if (!graph.ok) {
    return { ok: false, code: graph.code, error: graph.error };
  }

  // 门 3：worker registry / taskKind / synthesis / resources（既有，共享）
  const adapted = applyWorkforceTaskSpecs(sanitized.plan);
  if (!adapted.ok) {
    return { ok: false, code: adapted.code, error: adapted.error };
  }

  return {
    ok: true,
    compiled: {
      plan: adapted.plan,
      taskCount: adapted.plan.steps.length,
      validationMs: Date.now() - startedAt,
    },
  };
}

/** server-authored 计划编译（形状转换 → 共享三道门）。纯函数，零 DB。 */
export function compileServerAuthoredPlan(input: {
  plan: ServerAuthoredPlanV1;
  tools: ToolDescriptor[];
  maxSteps: number;
}): CompileWorkforcePlanResult {
  const shaped = serverPlanToPlannerOutput(input.plan);
  if (!shaped.ok) {
    return { ok: false, code: shaped.code, error: shaped.error };
  }

  // T5-P1：server-authored 计划**绝不允许被静默截断**。
  // sanitizePlannerOutput 对超出 maxSteps 的计划直接 slice——那对 LLM 计划是
  // 合理的降级，对确定性计划却是致命的：实测中 9 节点计划被截成 8，
  // finalize 步骤消失，分析永远停在 AGENT_ANALYZING 且无任何报错。
  // 因此这里显式 fail-closed，宁可拒绝也不产出残缺 DAG。
  if (shaped.plan.steps.length > input.maxSteps) {
    return {
      ok: false,
      code: "SERVER_PLAN_EXCEEDS_MAX_STEPS",
      error: `server-authored 计划有 ${shaped.plan.steps.length} 个任务，超过运行时上限 ${input.maxSteps}（AGENT_RUNTIME_V2_MAX_STEPS）。禁止静默截断——请提高上限或缩减 DAG。`,
    };
  }
  return compileWorkforcePlan({
    raw: shaped.plan,
    tools: input.tools,
    maxSteps: input.maxSteps,
  });
}
