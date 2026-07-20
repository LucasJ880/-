/**
 * Supervisor Engine — 主管调度入口（不替换 Agent Runtime）
 *
 * LangGraph 负责节点编排；技能执行仍走 runSkill；状态落 AgentRun.supervisorState。
 */

import { db } from "@/lib/db";
import {
  completeAgentRun,
  failAgentRun,
  updateAgentRunStatus,
} from "@/lib/agent-runtime/run";
import { markAgentRunAwaitingApproval } from "@/lib/agent-runtime/pending-link";
import { getSupervisorLimits } from "./config";
import { routeComplexity } from "./complexity-router";
import { buildSupervisorContext } from "./context-builder";
import { createSupervisorPlan, plannerOutputToSteps } from "./planner";
import { validateSupervisorPlan } from "./plan-validator";
import { observeStepResult } from "./observer";
import { replanSupervisor } from "./replanner";
import {
  emitSupervisorEvent,
  loadSupervisorState,
  saveSupervisorState,
} from "./persist";
import {
  buildValidatedFinalSummary,
  defaultKnowledgeRetrieval,
  formatSummaryForUser,
} from "./summarize";
import { getEmbeddingHealth } from "@/lib/ai/embedding";
import {
  executeWorkerStep,
  stepFingerprint,
} from "./workers/run-worker";
import { findWorkerForSkill } from "./worker-registry";
import type {
  SupervisorPageContext,
  SupervisorRunResult,
  SupervisorState,
  SupervisorStep,
} from "./types";
import { isSupervisorEnabled } from "./flags";

function initialState(input: {
  sessionId: string;
  runId: string;
  orgId: string;
  userId: string;
  userRole?: string;
  content: string;
  pageContext?: SupervisorPageContext;
}): SupervisorState {
  const limits = getSupervisorLimits();
  return {
    sessionId: input.sessionId,
    runId: input.runId,
    orgId: input.orgId,
    userId: input.userId,
    userRole: input.userRole,
    originalRequest: input.content,
    objective: input.content,
    pageContext: input.pageContext,
    resolvedContext: {},
    mode: "direct",
    plan: [],
    currentStepIndex: 0,
    observations: [],
    artifacts: [],
    pendingActionIds: [],
    status: "understanding",
    stepCount: 0,
    replanCount: 0,
    skillCallCount: 0,
    maxSteps: limits.maxSteps,
    maxReplans: limits.maxReplans,
    maxSkillCalls: limits.maxSkillCalls,
    userVisibleTimeline: ["正在理解目标"],
    executedFingerprints: [],
    knowledgeRetrieval: defaultKnowledgeRetrieval(),
    modelTelemetry: [],
  };
}

function syncKnowledgeRetrieval(state: SupervisorState): void {
  const health = getEmbeddingHealth();
  const sources = state.knowledgeRetrieval?.sourcesUsed?.length
    ? state.knowledgeRetrieval.sourcesUsed
    : ["CRM", "项目", "结构化业务数据"];
  if (health.status !== "available") {
    state.knowledgeRetrieval = {
      status: health.status === "unavailable" ? "unavailable" : "degraded",
      reason: health.reason || "embedding 模型不可用",
      sourcesUsed: sources.filter((s) => s !== "企业知识库"),
    };
  } else if (!state.knowledgeRetrieval) {
    state.knowledgeRetrieval = defaultKnowledgeRetrieval(sources);
  }
}

async function loadOrgSkillSlugs(orgId: string): Promise<Set<string>> {
  const rows = await db.agentSkill.findMany({
    where: { orgId, isActive: true },
    select: { slug: true },
  });
  return new Set(rows.map((r) => r.slug));
}

async function runPlanLoop(state: SupervisorState): Promise<SupervisorState> {
  const started = Date.now();
  const limits = getSupervisorLimits();

  while (true) {
    syncKnowledgeRetrieval(state);

    if (Date.now() - started > limits.timeoutMs) {
      state.status = "completed";
      state.waitingReason = "超时，返回部分结果";
      state.finalSummary = await buildValidatedFinalSummary(state);
      state.userVisibleTimeline.push("超时，已整理已完成部分");
      break;
    }

    if (state.skillCallCount >= state.maxSkillCalls) {
      state.status = "completed";
      state.finalSummary = await buildValidatedFinalSummary(state);
      state.userVisibleTimeline.push("已达技能调用上限，停止并汇总");
      break;
    }

    const next = state.plan.find((s) => s.status === "pending");
    if (!next) {
      state.status = "completed";
      state.decision = { type: "complete", reason: "无更多步骤" };
      state.finalSummary = await buildValidatedFinalSummary(state);
      break;
    }

    // 依赖未完成则跳过/等待
    const depsOk = next.dependsOn.every((dep) => {
      const d = state.plan.find((s) => s.id === dep);
      return d && (d.status === "completed" || d.status === "skipped");
    });
    if (!depsOk) {
      // 若依赖失败则跳过
      const depFailed = next.dependsOn.some((dep) => {
        const d = state.plan.find((s) => s.id === dep);
        return d?.status === "failed";
      });
      if (depFailed) {
        next.status = "skipped";
        continue;
      }
      // 依赖仍 pending：若前面都不是 pending 则有问题
      break;
    }

    const fp = stepFingerprint(next);
    if (state.executedFingerprints.includes(fp)) {
      next.status = "skipped";
      state.userVisibleTimeline.push(`跳过重复技能：${next.skillSlug}`);
      continue;
    }

    next.status = "running";
    state.status = "running";
    state.currentStepIndex = next.order - 1;
    state.stepCount += 1;
    state.userVisibleTimeline.push(
      `${next.worker} 数字员工正在执行：${next.objective.slice(0, 40)}`,
    );
    await saveSupervisorState(state);
    await emitSupervisorEvent({
      orgId: state.orgId,
      runId: state.runId,
      eventType: "supervisor.step_started",
      title: `步骤 ${next.order} 开始`,
      payload: { stepId: next.id, worker: next.worker, skillSlug: next.skillSlug },
    });

    const workerResult = await executeWorkerStep({
      workerId: next.worker,
      step: next,
      orgId: state.orgId,
      userId: state.userId,
      runId: state.runId,
      userRole: state.userRole,
    });

    state.skillCallCount += 1;
    state.executedFingerprints.push(fp);
    // 技能输出中暴露 embedding/知识库失败时，显式标记降级
    const blob = `${workerResult.content}\n${workerResult.summary}\n${workerResult.error || ""}`;
    if (
      /text-embedding|embedding|企业知识库|org.?knowledge|vector search/i.test(
        blob,
      ) &&
      /403|model_not_found|does not have access|PermissionDenied/i.test(blob)
    ) {
      state.knowledgeRetrieval = {
        status: "unavailable",
        reason: "企业知识库向量检索不可用（embedding 模型无权限或失败）",
        sourcesUsed: ["CRM", "项目", "结构化业务数据"],
      };
    }
    syncKnowledgeRetrieval(state);

    if (workerResult.ok) {
      next.status = "completed";
      next.resultRef = { skillExecutionId: workerResult.skillExecutionId };
      next.resultSummary = workerResult.summary.slice(0, 400);
      state.artifacts.push({
        id: workerResult.skillExecutionId || next.id,
        kind: "skill_result",
        stepId: next.id,
        title: next.skillSlug,
        content: workerResult.summary,
        skillExecutionId: workerResult.skillExecutionId,
      });
    } else {
      next.status = "failed";
      next.error = workerResult.error;
    }

    if (workerResult.pendingActionIds.length) {
      state.pendingActionIds = Array.from(
        new Set([...state.pendingActionIds, ...workerResult.pendingActionIds]),
      );
    }

    const observation = observeStepResult({
      state,
      stepId: next.id,
      workerResult,
    });
    state.observations.push({
      stepId: next.id,
      at: new Date().toISOString(),
      success: workerResult.ok,
      summary: workerResult.summary,
      factsLearned: observation.factsLearned,
      pendingActionIds: observation.pendingActionIds,
      decision: observation.decision,
    });

    await emitSupervisorEvent({
      orgId: state.orgId,
      runId: state.runId,
      eventType: "supervisor.observation_created",
      title: `观察：${observation.decision}`,
      payload: { stepId: next.id, decision: observation.decision },
      visibleToUser: false,
    });

    if (observation.decision === "wait_approval") {
      next.status = "waiting_for_approval";
      state.status = "waiting_for_approval";
      state.waitingReason = observation.reason;
      state.decision = {
        type: "wait_approval",
        reason: observation.reason,
        pendingActionIds: state.pendingActionIds,
      };
      state.userVisibleTimeline.push("等待审批");
      await saveSupervisorState(state);
      await markAgentRunAwaitingApproval(state.orgId, state.runId);
      break;
    }

    if (observation.decision === "ask_user") {
      state.status = "waiting_for_user";
      state.waitingReason = observation.reason;
      state.decision = {
        type: "ask_user",
        reason: observation.reason,
        questions: observation.questions,
      };
      state.userVisibleTimeline.push("需要你确认");
      await saveSupervisorState(state);
      await updateAgentRunStatus(state.orgId, state.runId, "awaiting_approval");
      break;
    }

    if (observation.decision === "replan") {
      state = await replanSupervisor(state, observation.reason);
      await emitSupervisorEvent({
        orgId: state.orgId,
        runId: state.runId,
        eventType: "supervisor.replan_started",
        title: "重新规划",
        payload: { reason: observation.reason, replanCount: state.replanCount },
      });
      if (state.status === "failed") break;
      state.status = "running";
      await saveSupervisorState(state);
      continue;
    }

    if (observation.decision === "fail") {
      state.status = "failed";
      state.error = observation.reason;
      state.decision = { type: "fail", reason: observation.reason };
      break;
    }

    if (observation.decision === "complete") {
      // 标记剩余 pending 为 skipped（若观察认为已完成）
      for (const s of state.plan) {
        if (s.status === "pending") s.status = "skipped";
      }
      state.status = "completed";
      state.decision = { type: "complete", reason: observation.reason };
      state.finalSummary = await buildValidatedFinalSummary(state);
      break;
    }

    // continue
    await saveSupervisorState(state);
  }

  if (
    !state.finalSummary &&
    (state.status === "completed" ||
      state.status === "failed" ||
      state.status === "waiting_for_approval")
  ) {
    state.finalSummary = await buildValidatedFinalSummary(state);
  }
  state.userVisibleTimeline.push(
    state.status === "waiting_for_approval"
      ? "等待审批"
      : state.status === "failed"
        ? "任务未完全成功"
        : "正在整理最终建议",
  );
  await saveSupervisorState(state);
  return state;
}

export async function runSupervisor(input: {
  sessionId: string;
  runId: string;
  orgId: string;
  userId: string;
  userRole?: string;
  content: string;
  pageContext?: SupervisorPageContext;
  forceMode?: "auto" | "quick" | "supervisor" | "project_expert";
}): Promise<SupervisorRunResult> {
  let state = initialState(input);

  try {
    await updateAgentRunStatus(input.orgId, input.runId, "planning");
    state.resolvedContext = await buildSupervisorContext({
      orgId: input.orgId,
      userId: input.userId,
      pageContext: input.pageContext,
    });
    await emitSupervisorEvent({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "supervisor.context_built",
      title: "上下文已装配",
      payload: {
        missing: state.resolvedContext.missingContext || [],
        skillCount: state.resolvedContext.availableSkills?.length || 0,
      },
      visibleToUser: false,
    });

    const complexity = routeComplexity({
      content: input.content,
      pageContext: input.pageContext,
      forceMode: input.forceMode,
    });
    state.complexity = complexity;
    state.mode = complexity.mode;
    state.objective = input.content;
    await emitSupervisorEvent({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "supervisor.mode_selected",
      title:
        complexity.mode === "supervisor" ? "已进入主管模式" : "已进入快速路径",
      payload: complexity,
    });
    state.userVisibleTimeline.push(
      complexity.mode === "supervisor" ? "正在制定计划" : "准备执行单一技能",
    );

    const orgSkills = await loadOrgSkillSlugs(input.orgId);

    if (complexity.mode === "direct") {
      const slug = complexity.candidateSkills[0];
      if (!slug) {
        state.fallbackUsed = true;
        state.status = "failed";
        state.error = "快速路径未匹配到技能，请改用主管模式或更明确的任务";
        await saveSupervisorState(state);
        return {
          ok: false,
          status: state.status,
          text: state.error,
          state,
          pendingActionIds: [],
          fallbackUsed: true,
        };
      }
      const worker = findWorkerForSkill(slug) || "sales";
      const step: SupervisorStep = {
        id: "step-1",
        order: 1,
        worker,
        skillSlug: slug,
        objective: input.content,
        input: {
          objective: input.content,
          ...(input.pageContext?.projectId
            ? { projectId: input.pageContext.projectId }
            : {}),
        },
        dependsOn: [],
        status: "pending",
        mayCreatePendingAction: complexity.requiresApproval,
      };
      state.plan = [step];
      state = await runPlanLoop(state);
    } else {
      state.status = "planning";
      const { plan, source, modelMeta } = await createSupervisorPlan(state);
      if (modelMeta) {
        state.modelTelemetry = [
          ...(state.modelTelemetry || []),
          { purpose: "planner", ...modelMeta },
        ];
      }
      let steps = plannerOutputToSteps(plan);
      const validated = validateSupervisorPlan({
        steps,
        maxSteps: state.maxSteps,
        orgActiveSkillSlugs: orgSkills,
      });
      if (!validated.ok) {
        // 降级：单技能
        state.fallbackUsed = true;
        const slug = complexity.candidateSkills[0];
        if (slug && orgSkills.has(slug)) {
          const worker = findWorkerForSkill(slug) || "sales";
          steps = [
            {
              id: "step-1",
              order: 1,
              worker,
              skillSlug: slug,
              objective: input.content,
              input: { objective: input.content },
              dependsOn: [],
              status: "pending",
              mayCreatePendingAction: true,
            },
          ];
          state.userVisibleTimeline.push("计划校验失败，已降级为单技能");
        } else {
          state.status = "failed";
          state.error = `计划无效：${validated.issues.map((i) => i.message).join("; ")}`;
          await saveSupervisorState(state);
          await failAgentRun(input.orgId, input.runId, {
            code: "model_parse_failed",
            message: state.error,
          });
          return {
            ok: false,
            status: "failed",
            text: state.error,
            state,
            pendingActionIds: [],
          };
        }
      } else {
        steps = validated.steps;
      }

      state.plan = steps;
      state.fallbackUsed = state.fallbackUsed || source === "rules";
      await emitSupervisorEvent({
        orgId: input.orgId,
        runId: input.runId,
        eventType: "supervisor.plan_created",
        title: `计划已创建（${steps.length} 步）`,
        payload: {
          steps: steps.map((s) => ({
            id: s.id,
            worker: s.worker,
            skillSlug: s.skillSlug,
            objective: s.objective,
          })),
          source,
        },
      });
      await updateAgentRunStatus(input.orgId, input.runId, "running");
      state = await runPlanLoop(state);
    }

    syncKnowledgeRetrieval(state);
    if (!state.finalSummary) {
      state.finalSummary = await buildValidatedFinalSummary(state);
    }
    const text =
      state.status === "waiting_for_approval"
        ? `${formatSummaryForUser(state)}\n\n请审批上述草稿后，任务可继续。`
        : state.status === "waiting_for_user"
          ? `${state.waitingReason || "需要你补充信息"}\n${(state.decision && "questions" in state.decision ? state.decision.questions : []).map((q) => `- ${q}`).join("\n")}`
          : formatSummaryForUser(state);

    if (state.status === "completed") {
      await completeAgentRun(input.orgId, input.runId);
      await emitSupervisorEvent({
        orgId: input.orgId,
        runId: input.runId,
        eventType: "supervisor.completed",
        title: "主管任务完成",
        payload: { skillCallCount: state.skillCallCount },
      });
    } else if (state.status === "failed") {
      await failAgentRun(input.orgId, input.runId, {
        code: "tool_failed",
        message: state.error || "主管任务失败",
      });
    }

    await saveSupervisorState(state);
    return {
      ok: state.status === "completed" || state.status === "waiting_for_approval",
      status: state.status,
      text,
      state,
      pendingActionIds: state.pendingActionIds,
      fallbackUsed: state.fallbackUsed,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.status = "failed";
    state.error = message;
    await saveSupervisorState(state);
    await failAgentRun(input.orgId, input.runId, {
      code: "unknown",
      message,
    });
    return {
      ok: false,
      status: "failed",
      text: `主管AI失败，已保留记录：${message}`,
      state,
      pendingActionIds: [],
      fallbackUsed: true,
    };
  }
}

/**
 * 审批后恢复：从 DB 重新读取 PendingAction 状态，不信任前端 approved=true
 */
export async function resumeSupervisorAfterApproval(input: {
  orgId: string;
  runId: string;
  userId: string;
  userRole?: string;
}): Promise<SupervisorRunResult> {
  const state = await loadSupervisorState(input.orgId, input.runId);
  if (!state) {
    return {
      ok: false,
      status: "failed",
      text: "找不到可恢复的主管任务状态",
      state: initialState({
        sessionId: "",
        runId: input.runId,
        orgId: input.orgId,
        userId: input.userId,
        content: "",
      }),
      pendingActionIds: [],
    };
  }

  // 重新校验权限
  if (
    !isSupervisorEnabled({
      userId: input.userId,
      role: input.userRole,
      orgId: input.orgId,
    }) &&
    input.userRole !== "admin" &&
    input.userRole !== "super_admin"
  ) {
    // 仍允许审批人恢复自己的 run
  }

  const pending = await db.pendingAction.findMany({
    where: { agentRunId: input.runId, orgId: input.orgId },
    select: { id: true, status: true },
  });
  const stillPending = pending.filter((p) => p.status === "pending");
  if (stillPending.length > 0) {
    state.status = "waiting_for_approval";
    state.pendingActionIds = stillPending.map((p) => p.id);
    await saveSupervisorState(state);
    return {
      ok: true,
      status: "waiting_for_approval",
      text: "仍有待审批项，暂不能继续。",
      state,
      pendingActionIds: state.pendingActionIds,
    };
  }

  const rejected = pending.filter((p) => p.status === "rejected");
  if (rejected.length > 0) {
    // 拒绝 ≠ 已执行：等待步骤标记 failed，依赖步骤跳过
    const rejectedIds = rejected.map((r) => r.id);
    state.plan = state.plan.map((s) =>
      s.status === "waiting_for_approval"
        ? {
            ...s,
            status: "failed" as const,
            error: "pending_action_rejected",
            resultSummary: `审批已拒绝，不视为已执行（${rejectedIds.join(", ")}）`,
          }
        : s,
    );
    const rejectedStepIds = new Set(
      state.plan
        .filter((s) => s.error === "pending_action_rejected")
        .map((s) => s.id),
    );
    state.plan = state.plan.map((s) => {
      if (s.status !== "pending") return s;
      const blocked = s.dependsOn.some((dep) => rejectedStepIds.has(dep));
      return blocked
        ? {
            ...s,
            status: "skipped" as const,
            resultSummary: "上游审批被拒绝，跳过依赖步骤（不假装动作已执行）",
          }
        : s;
    });
    state.pendingActionIds = [];
    state.userVisibleTimeline.push(
      `有 ${rejected.length} 项审批被拒绝，不会当作已执行`,
    );
    state.observations.push({
      stepId: "approval-rejected",
      at: new Date().toISOString(),
      success: false,
      summary: `PendingAction 已拒绝：${rejectedIds.join(", ")}`,
      factsLearned: ["审批拒绝，动作未执行"],
      pendingActionIds: rejectedIds,
      decision: state.replanCount < state.maxReplans ? "replan" : "complete",
    });
    await emitSupervisorEvent({
      orgId: input.orgId,
      runId: input.runId,
      eventType: "supervisor.approval_rejected",
      title: "审批已拒绝，调整后续",
      payload: { rejectedIds },
    });

    if (state.replanCount < state.maxReplans) {
      let next = await replanSupervisor(
        state,
        "部分审批被拒绝，调整后续计划（不依赖已拒绝动作）",
      );
      next.status = "running";
      await saveSupervisorState(next);
      await updateAgentRunStatus(input.orgId, input.runId, "running");
      next = await runPlanLoop(next);
      const text = formatSummaryForUser(next);
      if (next.status === "completed" || next.status === "failed") {
        if (next.status === "completed") {
          await completeAgentRun(input.orgId, input.runId);
        } else {
          await failAgentRun(input.orgId, input.runId, {
            code: "unknown",
            message: "审批拒绝后重规划未能完成",
          });
        }
      }
      return {
        ok: true,
        status: next.status,
        text,
        state: next,
        pendingActionIds: next.pendingActionIds,
      };
    }

    state.status = "completed";
    state.finalSummary = await buildValidatedFinalSummary(state);
    state.finalSummary.incompleteAndMissing = [
      ...(state.finalSummary.incompleteAndMissing || []),
      ...rejectedIds.map((id) => `已拒绝动作：${id}（未执行）`),
    ];
    await saveSupervisorState(state);
    await completeAgentRun(input.orgId, input.runId);
    return {
      ok: true,
      status: "completed",
      text: formatSummaryForUser(state),
      state,
      pendingActionIds: [],
    };
  }

  // 批准完成：标记等待步骤完成，继续后续
  state.plan = state.plan.map((s) =>
    s.status === "waiting_for_approval"
      ? { ...s, status: "completed" as const }
      : s,
  );
  state.status = "running";
  state.userVisibleTimeline.push("审批完成，正在继续");
  await emitSupervisorEvent({
    orgId: input.orgId,
    runId: input.runId,
    eventType: "supervisor.resumed",
    title: "主管任务已恢复",
  });
  await updateAgentRunStatus(input.orgId, input.runId, "running");
  const continued = await runPlanLoop(state);
  const text = formatSummaryForUser(continued);
  if (continued.status === "completed") {
    await completeAgentRun(input.orgId, input.runId);
  }
  return {
    ok: true,
    status: continued.status,
    text,
    state: continued,
    pendingActionIds: continued.pendingActionIds,
  };
}
