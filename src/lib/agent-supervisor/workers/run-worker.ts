/**
 * Worker 执行层 — 唯一通过 runSkill 执行技能
 */

import { db } from "@/lib/db";
import { runSkill } from "@/lib/agent-core/skills/runtime";
import { appendAgentRunEvent } from "@/lib/agent-runtime/run";
import {
  getWorker,
  isSkillAllowedForWorker,
  type WorkerConfig,
} from "../worker-registry";
import type { SupervisorStep, WorkerId, WorkerResult } from "../types";

function fingerprint(slug: string, input: Record<string, unknown>): string {
  return `${slug}::${JSON.stringify(input)}`;
}

export function stepFingerprint(step: SupervisorStep): string {
  return fingerprint(step.skillSlug, step.input || {});
}

export async function executeWorkerStep(input: {
  workerId: WorkerId;
  step: SupervisorStep;
  orgId: string;
  userId: string;
  runId: string;
  userRole?: string;
  variables?: Record<string, string>;
}): Promise<WorkerResult> {
  const worker = getWorker(input.workerId);
  const { step, orgId, userId, runId } = input;

  if (!isSkillAllowedForWorker(worker.id, step.skillSlug)) {
    return {
      ok: false,
      skillSlug: step.skillSlug,
      content: "",
      pendingActionIds: [],
      summary: "",
      error: `技能 ${step.skillSlug} 不在 ${worker.displayName} 白名单`,
    };
  }

  // 组织成员校验
  if (input.userRole !== "admin" && input.userRole !== "super_admin") {
    const membership = await db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { status: true },
    });
    if (!membership || membership.status !== "active") {
      return {
        ok: false,
        skillSlug: step.skillSlug,
        content: "",
        pendingActionIds: [],
        summary: "",
        error: "无权访问该组织",
      };
    }
  }

  const skill = await db.agentSkill.findUnique({
    where: { orgId_slug: { orgId, slug: step.skillSlug } },
    select: { id: true, isActive: true, name: true },
  });
  if (!skill || !skill.isActive) {
    return {
      ok: false,
      skillSlug: step.skillSlug,
      content: "",
      pendingActionIds: [],
      summary: "",
      error: `组织未启用技能 ${step.skillSlug}`,
    };
  }

  await appendAgentRunEvent({
    orgId,
    runId,
    eventType: "skill.started",
    title: `${worker.displayName}：${skill.name}`,
    payload: {
      supervisor: true,
      worker: worker.id,
      skillSlug: step.skillSlug,
      stepId: step.id,
    },
    visibleToUser: true,
  });

  const variables: Record<string, string> = {
    objective: step.objective,
    rawMaterials: step.objective,
    ...(input.variables || {}),
  };
  for (const [k, v] of Object.entries(step.input || {})) {
    if (typeof v === "string") variables[k] = v;
    else if (v != null) variables[k] = JSON.stringify(v);
  }

  try {
    const result = await runSkill({
      skillId: skill.id,
      slug: step.skillSlug,
      variables,
      userId,
      orgId,
      agentRunId: runId,
      role: input.userRole,
    });

    const pendingActionIds = (result.pendingActions || []).map((p) => p.id);

    await appendAgentRunEvent({
      orgId,
      runId,
      eventType: "skill.completed",
      title: `${skill.name} 完成`,
      payload: {
        supervisor: true,
        worker: worker.id,
        skillSlug: step.skillSlug,
        stepId: step.id,
        executionId: result.executionId,
        pendingCount: pendingActionIds.length,
      },
      visibleToUser: false,
    });

    const summary =
      typeof result.parsed === "object" && result.parsed
        ? JSON.stringify(result.parsed).slice(0, 1200)
        : (result.content || "").slice(0, 1200);

    return {
      ok: result.success,
      skillSlug: step.skillSlug,
      skillExecutionId: result.executionId,
      content: result.content,
      parsed: result.parsed,
      pendingActionIds,
      summary,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendAgentRunEvent({
      orgId,
      runId,
      eventType: "run.failed",
      title: `${worker.displayName} 技能失败`,
      payload: { stepId: step.id, skillSlug: step.skillSlug, error: message },
      visibleToUser: true,
    });
    return {
      ok: false,
      skillSlug: step.skillSlug,
      content: "",
      pendingActionIds: [],
      summary: "",
      error: message,
    };
  }
}

export function describeWorker(worker: WorkerConfig): string {
  return `${worker.displayName}（${worker.id}）`;
}
