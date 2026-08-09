/**
 * Phase 2C-1 — Unified Human Pause/Resume Contract（设计 §17）
 *
 * resumeWorkforceJob()：Workforce Job 从等待态（awaiting_approval / needs_human）
 * 恢复的**单一入口**。approval 触发源收敛到这里（resumeRuntimeV2AfterApproval
 * 对 workforce_job 只做 reconcile，requeue 统一经本函数），消除
 * assistant-reconcile / supervisor / V2 三线顺序竞态。
 *
 * 关键性质（设计 §17）：
 * - 步骤 1–10 幂等可重入：重复触发在状态断言处短路，或在 CAS requeue 处落败；
 * - duplicate resume 由 requeue CAS + 下游 claimRunLease 天然去重；
 * - cancelled 断言优先级最高（防 resume-after-cancel）；
 * - metadata 只取身份锚点（initiatedByUserId），一切权限现查
 *   （resolveRuntimeV2Principal：user.active + membership.active）；
 * - attempts 不惩罚（恢复是有效进展，2A BLOCKER 2 语义）。
 *
 * 2C-2 挂载点（本片不实现）：resource freshness（§9）/ scope 重查（§17.7）/
 * approval freshness（§10）三道门在步骤 5 与 10 之间插入。
 *
 * 过期审批 reconcile（设计 §8E）：expireOverdueApprovals 标记过期后调用
 * reconcileWorkforceRunsAfterApprovalExpiry —— 过期 ≠ 拒绝 ≠ 自动重新申请，
 * run 从 awaiting_approval 转 needs_human 交人决定，不再永久卡死。
 */

import { db } from "@/lib/db";
import { appendAgentRunEvent } from "@/lib/agent-runtime/run";
import {
  runtimeFromRunMetadata,
  runtimeContextToTelemetry,
} from "@/lib/ai/runtime-context";
import {
  WORKFORCE_JOB_RUN_TYPE,
  WORKFORCE_ACTIVE_STATUSES,
} from "./constants";

export type WorkforceResumeTrigger =
  | "approval_decided"
  | "clarification_answered"
  | "auth_completed"
  | "manual"
  | "scheduled";

/** 允许 resume 的等待态（设计 §4：等待 ≠ 失败） */
export const WORKFORCE_RESUMABLE_STATUSES = [
  "awaiting_approval",
  "needs_human",
] as const;

export type WorkforceResumeResult =
  /** CAS requeue 成功，job.resumed 已写入 */
  | { ok: true; status: "requeued" }
  /** 幂等短路：已在队列/执行中（含并发触发时 CAS 落败） */
  | { ok: true; status: "already_active" }
  /** 人工要求未满足（如仍有 pending PendingAction）——保持等待，无副作用 */
  | { ok: false; status: "waiting_human"; reason: string }
  /** 终态/取消/非 workforce_job——拒绝恢复 */
  | { ok: false; status: "not_resumable"; reason: string }
  /** 门禁拦截（principal 失效等）——已 park 并写 job.resume_blocked */
  | { ok: false; status: "blocked"; blockedBy: "principal"; reason: string };

function stepActionIds(step: {
  pendingActionId: string | null;
  evidenceJson: unknown;
}): string[] {
  const fromEvidence = (
    step.evidenceJson as { pendingActionIds?: string[] } | null
  )?.pendingActionIds;
  if (Array.isArray(fromEvidence) && fromEvidence.length > 0) {
    return fromEvidence.filter((x): x is string => typeof x === "string");
  }
  return step.pendingActionId ? [step.pendingActionId] : [];
}

export async function resumeWorkforceJob(input: {
  orgId: string;
  runId: string;
  trigger: WorkforceResumeTrigger;
  /** 触发恢复的人（审批人/回答人）——仅记录，绝不成为执行身份 */
  humanActorUserId?: string | null;
}): Promise<WorkforceResumeResult> {
  const { orgId, runId, trigger } = input;

  // 1. load Job + runType 断言
  const run = await db.agentRun.findFirst({
    where: { id: runId, orgId },
  });
  if (!run) {
    return { ok: false, status: "not_resumable", reason: "RUN_NOT_FOUND" };
  }
  if (run.runType !== WORKFORCE_JOB_RUN_TYPE) {
    return { ok: false, status: "not_resumable", reason: "NOT_WORKFORCE_JOB" };
  }

  // 2. resumable state 断言——cancelled 优先级最高（防 resume-after-cancel）
  if (run.status === "cancelled" || run.status === "failed" || run.status === "completed") {
    await appendAgentRunEvent({
      orgId,
      runId,
      eventType: "job.resume_blocked",
      title: "恢复被拒绝：Job 已处于终态",
      payload: { blockedBy: "state", detail: run.status, trigger },
      visibleToUser: false,
    });
    return {
      ok: false,
      status: "not_resumable",
      reason: `TERMINAL_STATE:${run.status}`,
    };
  }
  if (
    run.status === "queued" ||
    (WORKFORCE_ACTIVE_STATUSES as readonly string[]).includes(run.status)
  ) {
    // 幂等：已恢复/执行中，重复触发无害且不写事件
    return { ok: true, status: "already_active" };
  }
  if (
    !(WORKFORCE_RESUMABLE_STATUSES as readonly string[]).includes(run.status)
  ) {
    return {
      ok: false,
      status: "not_resumable",
      reason: `NOT_RESUMABLE_STATE:${run.status}`,
    };
  }

  // 3. restore runtime identity（19 字段；只取身份/correlation，不取权限）
  const runtime = runtimeFromRunMetadata(run);
  const correlation = runtimeContextToTelemetry(runtime);

  // 4. resolve current principal（user.active + membership 现查，非快照）
  const { resolveRuntimeV2Principal } = await import(
    "@/lib/agent-runtime-v2/principal"
  );
  const principal = await resolveRuntimeV2Principal({
    orgId,
    runId,
    approvalActorUserId: input.humanActorUserId ?? null,
  });
  if (!principal.ok) {
    // park needs_human(PERMISSION_CHANGED)：等待态无租约，用状态 CAS 保原子
    const parked = await db.agentRun.updateMany({
      where: {
        id: runId,
        orgId,
        runType: WORKFORCE_JOB_RUN_TYPE,
        status: { in: [...WORKFORCE_RESUMABLE_STATUSES] },
      },
      data: {
        status: "needs_human",
        errorCode: principal.code,
        errorMessage: principal.error,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        attempts: 0,
      },
    });
    if (parked.count > 0) {
      await appendAgentRunEvent({
        orgId,
        runId,
        eventType: "job.resume_blocked",
        title: "恢复被拦截：执行主体身份失效",
        payload: {
          blockedBy: "principal",
          detail: principal.code,
          trigger,
          correlation,
        },
        visibleToUser: false,
      });
      await appendAgentRunEvent({
        orgId,
        runId,
        eventType: "job.waiting_human",
        title: "执行主体身份失效，需要人工处理",
        payload: {
          humanRequirement: { type: "PERMISSION_CHANGED", detail: principal.code },
          correlation,
        },
        visibleToUser: true,
      });
    }
    return {
      ok: false,
      status: "blocked",
      blockedBy: "principal",
      reason: principal.code,
    };
  }

  // 5. human requirement resolved 检查（approval 分支）：
  //    关联 PendingAction 必须全部离开 pending，且 awaiting 步骤已被 reconcile
  //    为终态（reconcile 由 resumeRuntimeV2AfterApproval / 过期 reconcile 先行）。
  //    未满足 → 保持等待（幂等，重复触发无害，不写事件）。
  const pendingActions = await db.pendingAction.count({
    where: { agentRunId: runId, orgId, status: "pending" },
  });
  if (pendingActions > 0) {
    return {
      ok: false,
      status: "waiting_human",
      reason: `PENDING_ACTIONS:${pendingActions}`,
    };
  }
  const awaitingSteps = await db.agentRunStep.count({
    where: { runId, orgId, status: "awaiting_approval" },
  });
  if (awaitingSteps > 0) {
    return {
      ok: false,
      status: "waiting_human",
      reason: `UNRECONCILED_AWAITING_STEPS:${awaitingSteps}`,
    };
  }

  // 6–8. 2C-2 挂载点：resource freshness（§9）/ scope 重查 / approval
  //      freshness（§10）在此插入；本片（2C-1）不实现。
  // 9. Task checkpoint 无需动作：steps 即 checkpoint，claim 后
  //    refreshReadySteps 从 step statuses 全量重算 ready 集合。

  // 10. CAS requeue：attempts 不惩罚（恢复是有效进展，2A 语义）。
  //     count=0 = 并发触发已处理 → 幂等 already_active。
  const requeued = await db.agentRun.updateMany({
    where: {
      id: runId,
      orgId,
      runType: WORKFORCE_JOB_RUN_TYPE,
      status: { in: [...WORKFORCE_RESUMABLE_STATUSES] },
    },
    data: {
      status: "queued",
      nextAttemptAt: new Date(),
      leaseExpiresAt: null,
      attempts: 0,
    },
  });
  if (requeued.count === 0) {
    return { ok: true, status: "already_active" };
  }

  await appendAgentRunEvent({
    orgId,
    runId,
    eventType: "job.resumed",
    title: "Workforce Job 已恢复",
    payload: {
      // §18 统一结构
      trigger,
      principalUserId: principal.userId,
      humanActorUserId: input.humanActorUserId ?? null,
      // 兼容别名（2A job.resumed 既有字段名，消费方/测试不破）
      executionPrincipalUserId: principal.userId,
      approvalActorUserId: input.humanActorUserId ?? null,
      correlation,
    },
    visibleToUser: true,
  });

  // 11–12. durable processor claim + continue：由下一个 cron slice 的
  //        claimRunLease（原子 CAS）完成——多触发源并发最多一个 claim 成功。
  return { ok: true, status: "requeued" };
}

/**
 * §8E — 过期 PendingAction 的 run/step reconcile（纯增量）。
 *
 * expireOverdueApprovals 把过期草稿标 failed 之后调用本函数：
 * - 仅处理 runType=workforce_job 且仍卡在 awaiting_approval 的 run
 *   （legacy runtime_v2 / assistant 行为不变）；
 * - awaiting 步骤：关联 action 全部离开 pending → step failed
 *   (errorCode=approval_expired)，审批状态快照并入 outputJson；
 * - run 的关联 pending action 清零后 → CAS 转 needs_human +
 *   job.waiting_human(humanRequirement: APPROVAL_REQUIRED/expired)。
 *   过期 ≠ 拒绝 ≠ 自动重新申请——由人决定重发起或放弃（§13 loop guard）。
 * - 幂等：重复调用时 run 已离开 awaiting_approval，直接跳过。
 */
export async function reconcileWorkforceRunsAfterApprovalExpiry(
  expiredActions: {
    id: string;
    orgId: string | null;
    agentRunId: string | null;
  }[],
): Promise<{ reconciledRuns: number }> {
  const byRun = new Map<string, { orgId: string; actionIds: string[] }>();
  for (const a of expiredActions) {
    if (!a.agentRunId || !a.orgId) continue;
    const entry = byRun.get(a.agentRunId) ?? { orgId: a.orgId, actionIds: [] };
    entry.actionIds.push(a.id);
    byRun.set(a.agentRunId, entry);
  }

  // 自愈兜底：某轮 reconcile 异常后，过期 action 已离开 pending、不会再
  // 进入本轮集合——额外扫描仍卡 awaiting_approval 的 workforce run 中
  // 已有过期失败记录的关联 action，保证跨 cron 轮次收敛（幂等）。
  // （PendingAction.agentRunId 为普通列，无 relation——分两步查。）
  const stuckWorkforceRuns = await db.agentRun.findMany({
    where: { runType: WORKFORCE_JOB_RUN_TYPE, status: "awaiting_approval" },
    select: { id: true, orgId: true },
    take: 100,
  });
  if (stuckWorkforceRuns.length > 0) {
    const stuckCandidates = await db.pendingAction.findMany({
      where: {
        status: "failed",
        failureReason: "已过期",
        agentRunId: { in: stuckWorkforceRuns.map((r) => r.id) },
      },
      select: { id: true, orgId: true, agentRunId: true },
      take: 200,
    });
    for (const a of stuckCandidates) {
      if (!a.agentRunId || !a.orgId) continue;
      const entry = byRun.get(a.agentRunId) ?? {
        orgId: a.orgId,
        actionIds: [],
      };
      if (!entry.actionIds.includes(a.id)) entry.actionIds.push(a.id);
      byRun.set(a.agentRunId, entry);
    }
  }

  if (byRun.size === 0) return { reconciledRuns: 0 };

  const { reconcilePendingActionsForStep, shouldSkipReconcile } = await import(
    "@/lib/agent-runtime-v2/reconcile-approval"
  );

  let reconciledRuns = 0;
  for (const [runId, { orgId, actionIds }] of byRun) {
    const run = await db.agentRun.findFirst({
      where: {
        id: runId,
        orgId,
        runType: WORKFORCE_JOB_RUN_TYPE,
        status: "awaiting_approval",
      },
    });
    if (!run) continue; // 非 workforce / 已离开等待态（幂等）

    const steps = await db.agentRunStep.findMany({
      where: { runId, orgId, status: "awaiting_approval" },
    });
    for (const step of steps) {
      if (shouldSkipReconcile(step.status)) continue;
      const ids = stepActionIds(step);
      const actions = await db.pendingAction.findMany({
        where: { id: { in: ids }, orgId },
        select: { id: true, status: true },
      });
      const decision = reconcilePendingActionsForStep({
        expectedPendingActionIds: ids,
        found: actions,
      });
      // 仍有 pending/approved 未决 action → 该步骤继续等待
      if (decision.stepStatus === "awaiting_approval") continue;

      await db.agentRunStep.update({
        where: { id: step.id },
        data: {
          status: "failed",
          errorCode: "approval_expired",
          errorMessage: "审批已过期，动作未执行",
          completedAt: new Date(),
          outputJson: JSON.parse(
            JSON.stringify({
              ...(typeof step.outputJson === "object" && step.outputJson
                ? step.outputJson
                : {}),
              approvalStatuses: actions,
              reconcile: decision,
              expiredActionIds: actionIds.filter((id) => ids.includes(id)),
            }),
          ),
        },
      });
    }

    // run 级：关联 pending action 清零后才转 needs_human（部分过期时继续等）
    const stillPending = await db.pendingAction.count({
      where: { agentRunId: runId, orgId, status: "pending" },
    });
    if (stillPending > 0) continue;

    const runtime = runtimeFromRunMetadata(run);
    const parked = await db.agentRun.updateMany({
      where: { id: runId, orgId, status: "awaiting_approval" },
      data: {
        status: "needs_human",
        errorCode: "approval_expired",
        errorMessage: "审批已过期，需要人工决定重新发起或放弃",
        leaseExpiresAt: null,
        nextAttemptAt: null,
        attempts: 0,
      },
    });
    if (parked.count === 0) continue;

    await appendAgentRunEvent({
      orgId,
      runId,
      eventType: "job.waiting_human",
      title: "审批已过期，需要人工处理",
      payload: {
        humanRequirement: {
          type: "APPROVAL_REQUIRED",
          detail: "expired",
          refs: { pendingActionIds: actionIds },
        },
        correlation: runtimeContextToTelemetry(runtime),
      },
      visibleToUser: true,
    });
    reconciledRuns += 1;
  }
  return { reconciledRuns };
}
