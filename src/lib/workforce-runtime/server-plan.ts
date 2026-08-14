/**
 * T5-P0A — Server-authored deterministic plan seam（workforce-plan/v1）
 *
 * 设计法则（T5 §3/§4）：**只有一条验证链**。LLM planner 与 server-authored plan
 * 必须穿过同一组校验器，绝不允许出现 validateLLMPlan() / validateServerPlan() 两套标准。
 *
 *   LLM Planner ─┐
 *                ├─→ sanitizePlannerOutput（Zod + 工具白名单 + step 上限）
 *   Server Plan ─┘        ↓
 *                  validateWorkforcePlanGraph（重复 id / 依赖闭包 / 环 / 前向引用）★本轮新增，两条路径共用
 *                         ↓
 *                  applyWorkforceTaskSpecs（worker registry / taskKind / synthesis 规则 / resources）
 *                         ↓
 *                  persistPlanAndSteps（事务 + fence）
 *                         ↓
 *                      Runtime
 *
 * 本文件不写库、不调用模型、不引入第二套 runtime——只做纯校验与形状编译。
 *
 * 为什么 graph 校验是本轮新增：审计确认既有链路**没有**依赖闭包/环检测
 * （applyWorkforceTaskSpecs 不做；PlanStepSchema.dependsOn 只是 string[]）。
 * 悬空依赖或环今天只会在 executor 表现为 `blocked_graph` 卡死并烧掉 lease 预算。
 * 确定性计划必须在**落库前**拒绝，因此把这道门补进共享链，两条路径同时受益。
 */

import type { PlannerOutput, PlanStep } from "@/lib/agent-runtime-v2/schemas";

/** server-authored 计划契约版本（与 workforce-task/* 正交：一个描述计划，一个描述任务） */
export const WORKFORCE_PLAN_CONTRACT_VERSION = "workforce-plan/v1" as const;

/** 计划来源（server 权威；客户端不可指定——见 job.ts RESERVED_METADATA_KEYS） */
export const PLAN_SOURCE = {
  LLM_PLANNER: "LLM_PLANNER",
  SERVER_AUTHORED: "SERVER_AUTHORED",
} as const;
export type PlanSource = (typeof PLAN_SOURCE)[keyof typeof PLAN_SOURCE];

/**
 * server-authored 任务描述。刻意与 PlanStep 同构（而不是另造一套 DSL）：
 * 目的是让 server plan 能原样穿过既有验证链，避免"第二套契约"。
 */
export type ServerAuthoredTaskV1 = {
  id: string;
  title: string;
  description: string;
  dependsOn?: string[];
  preferredTool?: string;
  executionMode: PlanStep["executionMode"];
  riskLevel: PlanStep["riskLevel"];
  requiresApproval: boolean;
  expectedOutput: string;
  workerKey?: string;
  taskKind?: "work" | "synthesis";
  resources?: string[];
};

export type ServerAuthoredPlanV1 = {
  contractVersion: typeof WORKFORCE_PLAN_CONTRACT_VERSION;
  objective: string;
  summary: string;
  completionCriteria: Array<{
    id: string;
    description: string;
    verificationType:
      | "tool_result"
      | "database_state"
      | "artifact_exists"
      | "human_approval"
      | "model_judgement";
  }>;
  tasks: ServerAuthoredTaskV1[];
  assumptions?: string[];
};

export type PlanGraphIssue =
  | { code: "DUPLICATE_TASK_ID"; detail: string }
  | { code: "MISSING_DEPENDENCY"; detail: string }
  | { code: "SELF_DEPENDENCY"; detail: string }
  | { code: "FORWARD_DEPENDENCY"; detail: string }
  | { code: "DEPENDENCY_CYCLE"; detail: string };

export type PlanGraphResult =
  | { ok: true }
  | { ok: false; code: PlanGraphIssue["code"]; error: string };

/**
 * 共享 DAG 结构校验（LLM 与 server plan 共用；纯函数）。
 * 检查：重复 id → 自依赖 → 依赖闭包（悬空引用）→ 前向引用 → 环。
 * 任一失败即整计划拒绝（fail-closed，与 applyWorkforceTaskSpecs 同纪律）。
 */
export function validateWorkforcePlanGraph(
  steps: Array<{ id: string; dependsOn?: string[] }>,
): PlanGraphResult {
  const ids = new Set<string>();
  for (const s of steps) {
    const id = (s.id ?? "").trim();
    if (!id) {
      return { ok: false, code: "DUPLICATE_TASK_ID", error: "任务 id 不可为空" };
    }
    if (ids.has(id)) {
      return { ok: false, code: "DUPLICATE_TASK_ID", error: `重复任务 id：${id}` };
    }
    ids.add(id);
  }

  const indexById = new Map<string, number>();
  steps.forEach((s, i) => indexById.set((s.id ?? "").trim(), i));

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const id = (s.id ?? "").trim();
    for (const raw of s.dependsOn ?? []) {
      const dep = (raw ?? "").trim();
      if (!dep) continue;
      if (dep === id) {
        return { ok: false, code: "SELF_DEPENDENCY", error: `任务自依赖：${id}` };
      }
      if (!ids.has(dep)) {
        return {
          ok: false,
          code: "MISSING_DEPENDENCY",
          error: `任务 ${id} 依赖不存在的任务：${dep}`,
        };
      }
      // 前向引用：依赖必须先于自身出现（保证拓扑顺序可读，同时天然排除大部分环）
      if ((indexById.get(dep) ?? -1) > i) {
        return {
          ok: false,
          code: "FORWARD_DEPENDENCY",
          error: `任务 ${id} 依赖了后出现的任务：${dep}（计划必须按拓扑顺序排列）`,
        };
      }
    }
  }

  // 显式环检测（DFS 三色）——即便未来放宽前向引用规则也仍然安全
  const adjacency = new Map<string, string[]>();
  for (const s of steps) {
    adjacency.set(
      (s.id ?? "").trim(),
      (s.dependsOn ?? []).map((d) => (d ?? "").trim()).filter(Boolean),
    );
  }
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const id of adjacency.keys()) color.set(id, WHITE);

  const visit = (node: string, stack: string[]): string[] | null => {
    color.set(node, GRAY);
    for (const dep of adjacency.get(node) ?? []) {
      const c = color.get(dep) ?? WHITE;
      if (c === GRAY) return [...stack, node, dep];
      if (c === WHITE) {
        const found = visit(dep, [...stack, node]);
        if (found) return found;
      }
    }
    color.set(node, BLACK);
    return null;
  };

  for (const id of adjacency.keys()) {
    if ((color.get(id) ?? WHITE) === WHITE) {
      const cycle = visit(id, []);
      if (cycle) {
        return {
          ok: false,
          code: "DEPENDENCY_CYCLE",
          error: `依赖成环：${cycle.join(" → ")}`,
        };
      }
    }
  }

  return { ok: true };
}

export type ServerPlanShapeResult =
  | { ok: true; plan: PlannerOutput }
  | { ok: false; code: string; error: string };

/** server plan → PlannerOutput（仅形状转换；不做语义放行，随后仍须过完整验证链） */
export function serverPlanToPlannerOutput(
  plan: ServerAuthoredPlanV1,
): ServerPlanShapeResult {
  if (plan?.contractVersion !== WORKFORCE_PLAN_CONTRACT_VERSION) {
    return {
      ok: false,
      code: "PLAN_CONTRACT_VERSION_UNSUPPORTED",
      error: `不支持的计划契约版本：${String(plan?.contractVersion)}（期望 ${WORKFORCE_PLAN_CONTRACT_VERSION}）`,
    };
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    return { ok: false, code: "PLAN_EMPTY", error: "server-authored 计划不能为空" };
  }
  const steps = plan.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    dependsOn: t.dependsOn ?? [],
    ...(t.preferredTool ? { preferredTool: t.preferredTool } : {}),
    executionMode: t.executionMode,
    riskLevel: t.riskLevel,
    requiresApproval: t.requiresApproval,
    expectedOutput: t.expectedOutput,
    ...(t.workerKey ? { workerKey: t.workerKey } : {}),
    ...(t.taskKind ? { taskKind: t.taskKind } : {}),
    ...(t.resources && t.resources.length > 0 ? { resources: t.resources } : {}),
  }));
  return {
    ok: true,
    plan: {
      objective: plan.objective,
      summary: plan.summary,
      assumptions: plan.assumptions ?? [],
      missingInformation: [],
      needsClarification: false,
      completionCriteria: plan.completionCriteria,
      steps,
    } as PlannerOutput,
  };
}
