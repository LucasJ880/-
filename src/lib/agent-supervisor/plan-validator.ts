/**
 * 计划确定性校验 — 模型输出不能直接执行
 */

import type { SupervisorStep, WorkerId } from "./types";
import { isSkillAllowedForWorker, WORKER_REGISTRY } from "./worker-registry";

export type PlanValidationIssue = {
  code: string;
  message: string;
  fatal: boolean;
};

export type PlanValidationResult = {
  ok: boolean;
  issues: PlanValidationIssue[];
  steps: SupervisorStep[];
};

const FORBIDDEN_TOOL_LIKE =
  /^(sales\.|marketing\.|gmail\.|send_|.*_send_|tool:)/i;

export function validateSupervisorPlan(input: {
  steps: SupervisorStep[];
  maxSteps: number;
  orgActiveSkillSlugs: Set<string>;
}): PlanValidationResult {
  const issues: PlanValidationIssue[] = [];
  let steps = [...input.steps];

  if (steps.length === 0) {
    issues.push({
      code: "empty_plan",
      message: "计划为空",
      fatal: true,
    });
    return { ok: false, issues, steps };
  }

  if (steps.length > input.maxSteps) {
    issues.push({
      code: "too_many_steps",
      message: `步骤超过上限 ${input.maxSteps}`,
      fatal: false,
    });
    steps = steps
      .sort((a, b) => a.order - b.order)
      .slice(0, input.maxSteps)
      .map((s, i) => ({ ...s, order: i + 1 }));
  }

  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.id)) {
      issues.push({
        code: "duplicate_id",
        message: `重复 step id: ${s.id}`,
        fatal: true,
      });
    }
    ids.add(s.id);

    if (!WORKER_REGISTRY[s.worker as WorkerId]) {
      issues.push({
        code: "unknown_worker",
        message: `未知 Worker: ${s.worker}`,
        fatal: true,
      });
      continue;
    }

    if (!isSkillAllowedForWorker(s.worker, s.skillSlug)) {
      issues.push({
        code: "skill_not_in_worker",
        message: `${s.skillSlug} 不在 ${s.worker} 白名单`,
        fatal: true,
      });
    }

    if (
      input.orgActiveSkillSlugs.size > 0 &&
      !input.orgActiveSkillSlugs.has(s.skillSlug)
    ) {
      issues.push({
        code: "skill_not_in_org",
        message: `组织未启用技能: ${s.skillSlug}`,
        fatal: true,
      });
    }

    if (FORBIDDEN_TOOL_LIKE.test(s.skillSlug)) {
      issues.push({
        code: "direct_tool_forbidden",
        message: `禁止直接工具调用: ${s.skillSlug}`,
        fatal: true,
      });
    }

    for (const dep of s.dependsOn) {
      if (!ids.has(dep) && !steps.some((x) => x.id === dep)) {
        // 允许前向引用检查在第二遍
      }
    }
  }

  // 依赖：无环、不依赖未来 order
  const byId = new Map(steps.map((s) => [s.id, s]));
  for (const s of steps) {
    for (const dep of s.dependsOn) {
      const d = byId.get(dep);
      if (!d) {
        issues.push({
          code: "missing_dependency",
          message: `${s.id} 依赖不存在的 ${dep}`,
          fatal: true,
        });
        continue;
      }
      if (d.order >= s.order) {
        issues.push({
          code: "future_dependency",
          message: `${s.id} 不能依赖未来步骤 ${dep}`,
          fatal: true,
        });
      }
    }
  }

  // 简单环检测
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = byId.get(id);
    for (const dep of node?.dependsOn ?? []) {
      if (hasCycle(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const s of steps) {
    if (hasCycle(s.id)) {
      issues.push({
        code: "dependency_cycle",
        message: "步骤依赖存在环",
        fatal: true,
      });
      break;
    }
  }

  // 规范化 order
  steps = steps
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({
      ...s,
      order: i + 1,
      status: s.status || "pending",
      input: s.input || {},
      dependsOn: s.dependsOn || [],
    }));

  const fatal = issues.some((i) => i.fatal);
  return { ok: !fatal, issues, steps };
}
