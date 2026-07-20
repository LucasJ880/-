/**
 * Replanner — 保留已完成步骤，最多 2 次；按 Observer 建议过滤无关步骤
 */

import type { SupervisorState, SupervisorStep } from "./types";
import { createSupervisorPlan, plannerOutputToSteps } from "./planner";

function shouldDropStep(step: SupervisorStep, reason: string): boolean {
  const blob = `${step.skillSlug} ${step.objective}`.toLowerCase();
  if (
    /取消强制条件|跳过强制|abandon|致命|不投|偏不投/.test(reason) &&
    /mandatory|compliance|强制条件|合规矩阵/.test(blob)
  ) {
    return true;
  }
  if (
    /取消.*潜客|移除.*拓客|无关.*获客|优先.*next-best|优先行动/.test(reason) &&
    /prospect|获客|icp|新潜客|拓客/.test(blob)
  ) {
    return true;
  }
  return false;
}

/** 确定性应用 Observer 建议：跳过已排入但不该继续的步骤 */
export function applyObserverPlanAdjustments(
  plan: SupervisorStep[],
  reason: string,
): SupervisorStep[] {
  return plan.map((s) => {
    if (s.status !== "pending") return s;
    if (shouldDropStep(s, reason)) {
      return {
        ...s,
        status: "skipped" as const,
        resultSummary: `根据观察结果跳过：${reason.slice(0, 120)}`,
      };
    }
    return s;
  });
}

export async function replanSupervisor(
  state: SupervisorState,
  reason: string,
): Promise<SupervisorState> {
  if (state.replanCount >= state.maxReplans) {
    return {
      ...state,
      status: "failed",
      error: `已达最大重规划次数（${state.maxReplans}）：${reason}`,
      decision: { type: "fail", reason },
    };
  }

  // 先对现有 pending 做确定性裁剪（动态规划证据）
  const adjustedExisting = applyObserverPlanAdjustments(state.plan, reason);

  const retained = adjustedExisting.filter(
    (s) =>
      s.status === "completed" ||
      s.status === "failed" ||
      s.status === "skipped",
  );

  // 若裁剪后已无 pending，且原因是放弃投标，直接收尾，不再拉无关步骤
  const stillPending = adjustedExisting.filter((s) => s.status === "pending");
  if (
    stillPending.length === 0 ||
    (/不投|abandon|致命|强制缺口/.test(reason) &&
      retained.some((s) => s.skillSlug === "tender-bid-no-bid"))
  ) {
    // 确保 next-best-action 在销售热机会场景存在
    let plan = adjustedExisting;
    if (
      /优先.*next-best|高价值|逾期/.test(reason) &&
      !plan.some((s) => s.skillSlug === "sales-next-best-action")
    ) {
      plan = [
        ...plan,
        {
          id: `replan-${state.replanCount + 1}-nba`,
          order: plan.length + 1,
          worker: "sales" as const,
          skillSlug: "sales-next-best-action",
          objective: "针对高价值/逾期机会给出本周行动",
          input: { objective: state.objective },
          dependsOn: [],
          status: "pending" as const,
          mayCreatePendingAction: true,
        },
      ];
    }
    return {
      ...state,
      plan: plan.map((s, i) => ({ ...s, order: i + 1 })),
      currentStepIndex: retained.filter((s) => s.status === "completed").length,
      replanCount: state.replanCount + 1,
      status: "replanning",
      decision: { type: "replan", reason },
      userVisibleTimeline: [
        ...state.userVisibleTimeline,
        `发现新情况，已调整计划（第 ${state.replanCount + 1} 次）：${reason.slice(0, 80)}`,
      ],
    };
  }

  const { plan, modelMeta } = await createSupervisorPlan({
    ...state,
    objective: `${state.objective}（重规划原因：${reason}）`,
  });

  let fresh = plannerOutputToSteps(plan).filter(
    (s) =>
      !retained.some(
        (c) => c.skillSlug === s.skillSlug && c.objective === s.objective,
      ),
  );
  fresh = applyObserverPlanAdjustments(fresh, reason).filter(
    (s) => s.status === "pending",
  );

  const merged: SupervisorStep[] = [
    ...retained,
    ...fresh.map((s, i) => ({
      ...s,
      id: `replan-${state.replanCount + 1}-step-${i + 1}`,
      order: retained.length + i + 1,
      status: "pending" as const,
    })),
  ].slice(0, state.maxSteps);

  const renumbered = merged.map((s, i) => ({ ...s, order: i + 1 }));

  return {
    ...state,
    plan: renumbered,
    currentStepIndex: retained.filter((s) => s.status === "completed").length,
    replanCount: state.replanCount + 1,
    status: "replanning",
    decision: { type: "replan", reason },
    modelTelemetry: modelMeta
      ? [
          ...(state.modelTelemetry || []),
          { purpose: "planner" as const, ...modelMeta },
        ]
      : state.modelTelemetry,
    userVisibleTimeline: [
      ...state.userVisibleTimeline,
      `发现新情况，正在调整计划（第 ${state.replanCount + 1} 次）`,
    ],
  };
}
