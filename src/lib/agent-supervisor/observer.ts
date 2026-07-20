/**
 * Observer — 检查步骤结果并给出决策（确定性 + 可选 LLM）
 */

import {
  ObserverOutputSchema,
  type ObserverOutput,
  type SupervisorState,
  type WorkerResult,
} from "./types";

export function observeStepResult(input: {
  state: SupervisorState;
  stepId: string;
  workerResult: WorkerResult;
}): ObserverOutput {
  const { state, workerResult } = input;
  const pendingActionIds = workerResult.pendingActionIds || [];

  if (!workerResult.ok) {
    if (state.replanCount < state.maxReplans) {
      return ObserverOutputSchema.parse({
        decision: "replan",
        reason: workerResult.error || "技能执行失败，尝试调整计划",
        factsLearned: [],
        uncertainties: [workerResult.error || "执行失败"],
        questions: [],
        recommendedChanges: ["跳过失败技能或换只读研究步骤"],
        pendingActionIds,
      });
    }
    return ObserverOutputSchema.parse({
      decision: "fail",
      reason: workerResult.error || "技能失败且无法再规划",
      pendingActionIds,
    });
  }

  if (pendingActionIds.length > 0) {
    return ObserverOutputSchema.parse({
      decision: "wait_approval",
      reason: "已产生待审批动作，需人工确认后才能继续依赖执行结果的步骤",
      factsLearned: [workerResult.summary.slice(0, 200)],
      pendingActionIds,
    });
  }

  // 当前步骤在引擎里已标 completed；只统计仍待执行的步骤
  const remaining = state.plan.filter(
    (s) => s.status === "pending" || s.status === "running",
  ).length;

  // 无剩余步骤才完成（不可用 <=1，否则两步计划会在第一步后误判完成）
  if (remaining === 0) {
    return ObserverOutputSchema.parse({
      decision: "complete",
      reason: "计划步骤已完成",
      factsLearned: [workerResult.summary.slice(0, 200)],
      pendingActionIds,
    });
  }

  const text = `${workerResult.content}\n${workerResult.summary}`;

  // 投标：去留为 no / abandon / 致命强制缺口 → 重规划，不继续完整执行计划
  if (workerResult.skillSlug === "tender-bid-no-bid") {
    const abandon =
      /\"recommendation\"\s*:\s*\"(no|abandon)\"/i.test(text) ||
      /\"decision\"\s*:\s*\"(no|abandon|conditional)\"/i.test(text) ||
      /不建议投标|建议放弃|bid\s*:\s*false|致命|mandatory.*missing|无法在截止日前/i.test(
        text,
      );
    if (abandon) {
      return ObserverOutputSchema.parse({
        decision: "replan",
        reason:
          "去留判断偏不投或存在致命强制缺口，停止无意义合规展开，改为风险说明与收尾",
        factsLearned: ["投标建议偏不投或存在致命缺口"],
        recommendedChanges: [
          "取消或跳过强制条件矩阵的完整执行",
          "输出 abandon/conditional 与缺口清单",
        ],
        pendingActionIds,
      });
    }
  }

  // 销售：管道已有高价值待跟进机会 → 优先行动，跳过无关拓客
  if (workerResult.skillSlug === "sales-pipeline-forecast") {
    const hasHot =
      /高概率|hot|commit|超过\s*14\s*天|未跟进|at risk|最值得推进/i.test(text) ||
      /\"probability\"\s*:\s*0\.[7-9]/i.test(text) ||
      /\"amount\"\s*:\s*[1-9][0-9]{3,}/.test(text);
    const hasProspectingPending = state.plan.some(
      (s) =>
        s.status === "pending" &&
        /prospect|获客|icp|新潜客|拓客/i.test(
          `${s.skillSlug} ${s.objective}`,
        ),
    );
    if (hasHot && hasProspectingPending) {
      return ObserverOutputSchema.parse({
        decision: "replan",
        reason:
          "已有高价值/逾期跟进机会，应优先 next-best-action，取消无关新潜客开发",
        factsLearned: ["管道中存在高价值或逾期未跟进机会"],
        recommendedChanges: [
          "保留或插入 sales-next-best-action",
          "移除新潜客/ICP 拓客步骤",
        ],
        pendingActionIds,
      });
    }
  }

  return ObserverOutputSchema.parse({
    decision: "continue",
    reason: "步骤成功，继续下一步",
    factsLearned: [workerResult.summary.slice(0, 200)],
    pendingActionIds,
  });
}
