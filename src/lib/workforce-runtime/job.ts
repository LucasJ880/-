/**
 * Workforce Job 创建入口（Phase 2A §3–4）
 *
 * Job = root AgentRun（runType="workforce_job"）；jobId = rootRunId = runId。
 * 必须走 createAgentRun（复用配额治理 / trace / AgentSession / 幂等），
 * 禁止直接 db.agentRun.create()。
 *
 * Owner 注入（§4）：root Job 上
 *   actor = { type:"USER", id:userId, userId }（发起人）
 *   owner = { type:"USER", id:userId }（问责人，跨整棵 run 树不变）
 * Phase 2A 不创建 AI Job Owner。
 */

import { db } from "@/lib/db";
import {
  createAgentRun,
  mergeAgentRunMetadata,
  appendAgentRunEvent,
} from "@/lib/agent-runtime/run";
import { getOrCreateAgentSession } from "@/lib/agent-runtime/session";
import {
  normalizeRuntimeContext,
  runtimeContextToTelemetry,
  type AIRuntimeContext,
} from "@/lib/ai/runtime-context";
import { WORKFORCE_JOB_RUN_TYPE } from "./constants";
import { isWorkforceRuntimeEnabled } from "./flags";
import {
  PLAN_SOURCE,
  WORKFORCE_PLAN_CONTRACT_VERSION,
  type ServerAuthoredPlanV1,
} from "./server-plan";
import { compileServerAuthoredPlan, type CompiledPlan } from "./plan-compile";
import { WORKFORCE_TASK_CONTRACT_WRITE_VERSION } from "./task-contract";
import { getRuntimeV2Limits } from "@/lib/agent-runtime-v2/flags";

export type CreateWorkforceJobInput = {
  orgId: string;
  /** Human Owner = 发起人（Phase 2A Owner 恒为 USER） */
  userId: string;
  /** 平台角色（feature flag role allowlist 判定用） */
  role?: string | null;
  goal: string;
  channel?: string;
  threadId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  traceId?: string | null;
  userMessageId?: string | null;
  source?: string;
  /**
   * T1B（§11）：可选业务身份元数据（如 workDomain/trigger/requestId），
   * 与 goal 同事务写入 metadata——避免"创建后补写"与首个规划 slice 的
   * 竞态。server-only：仅浅层、有界、且不得覆盖保留键（fail-closed）。
   */
  extraMetadata?: Record<string, unknown>;
  /**
   * T5-P0A：server-authored deterministic plan（可选）。
   *
   * **只能由受信服务端代码构造**——API/客户端无法经此传入任意 DAG：
   * 该字段不在任何请求体解析路径上，且 planSource 等провenance 键已进
   * RESERVED_METADATA_KEYS（extraMetadata 无法伪造）。
   *
   * 提供时：计划先过与 LLM planner **完全相同**的验证链（见 plan-compile.ts），
   * 校验失败 → 零 DB 写入直接返回 ok:false（不留孤儿 run）；
   * 校验通过 → run 创建后同步落 planJson + steps，processor 的
   * `if (!run.planJson)` 守卫因此天然跳过 planner（planner LLM 调用 = 0）。
   */
  plan?: ServerAuthoredPlanV1;
  /** server plan 的 executionMode/preferredTool 白名单（与 planner 同一 scope 工具集） */
  planTools?: Array<{ name: string }>;
  /**
   * T5-P0C-C：**server 权威** workDomain（canonical = Project.workDomain）。
   *
   * 刻意做成独立具名参数而非 extraMetadata 的一个键——workDomain 决定执行期
   * ToolDomain（进而决定模块门与允许角色），是权限真相的一部分，
   * 绝不能经 generic client metadata 通道定义。该键已列入 RESERVED_METADATA_KEYS，
   * 任何调用方尝试经 extraMetadata 传入都会被整体拒绝（fail-closed）。
   */
  workDomain?: string | null;
};

/**
 * metadata 保留键：extraMetadata 不得覆盖（server 构造语义）。
 * T5-P0A 追加 plan provenance 键——防止调用方伪造 planSource=SERVER_AUTHORED。
 */
const RESERVED_METADATA_KEYS = new Set([
  "runtimeVersion",
  "goal",
  "initiatedByUserId",
  "threadId",
  "channel",
  "source",
  "jobId",
  "planSource",
  "planContractVersion",
  "taskContractVersion",
  "planTaskCount",
  "plannerLlmCalls",
  // T5-P0C-C：workDomain 是权限真相，只能由具名 server 参数写入
  "workDomain",
]);

function sanitizeExtraMetadata(
  extra: Record<string, unknown> | undefined,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!extra) return { ok: true, value: {} };
  const keys = Object.keys(extra);
  if (keys.length > 16) {
    return { ok: false, error: "EXTRA_METADATA_TOO_LARGE" };
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (RESERVED_METADATA_KEYS.has(key)) {
      return { ok: false, error: `EXTRA_METADATA_RESERVED_KEY:${key}` };
    }
    const v = extra[key];
    const t = typeof v;
    if (v !== null && t !== "string" && t !== "number" && t !== "boolean") {
      return { ok: false, error: `EXTRA_METADATA_INVALID_VALUE:${key}` };
    }
    if (t === "string" && (v as string).length > 500) {
      return { ok: false, error: `EXTRA_METADATA_VALUE_TOO_LONG:${key}` };
    }
    out[key] = v;
  }
  return { ok: true, value: out };
}

export type CreateWorkforceJobResult =
  | {
      ok: true;
      jobId: string;
      runId: string;
      traceId: string | null;
      reused: boolean;
    }
  | { ok: false; error: string };

export async function createWorkforceJob(
  input: CreateWorkforceJobInput,
): Promise<CreateWorkforceJobResult> {
  // §25：feature flag / allowlist 强制，未命中即拒绝（不自动路由）
  if (
    !isWorkforceRuntimeEnabled({
      userId: input.userId,
      role: input.role,
      orgId: input.orgId,
    })
  ) {
    return { ok: false, error: "WORKFORCE_RUNTIME_DISABLED" };
  }

  const goal = input.goal.trim();
  if (goal.length < 4) {
    return { ok: false, error: "GOAL_TOO_SHORT" };
  }

  const extra = sanitizeExtraMetadata(input.extraMetadata);
  if (!extra.ok) {
    return { ok: false, error: extra.error };
  }

  // T5-P0A §6：server-authored 计划**先于任何 DB 写入**完成校验。
  // 非法计划 → 零副作用返回，绝不产生"已创建但永远无法执行"的孤儿 run。
  // fail-closed：绝不静默回落 LLM planner（那会掩盖确定性契约缺陷，见 T5 §21）。
  let compiled: CompiledPlan | null = null;
  if (input.plan) {
    const result = compileServerAuthoredPlan({
      plan: input.plan,
      tools: (input.planTools ?? []) as Parameters<
        typeof compileServerAuthoredPlan
      >[0]["tools"],
      maxSteps: getRuntimeV2Limits().maxSteps,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: `DETERMINISTIC_PLAN_INVALID:${result.code}:${result.error}`,
      };
    }
    compiled = result.compiled;
  }

  const channel = input.channel ?? "workforce";
  const session = await getOrCreateAgentSession({
    orgId: input.orgId,
    userId: input.userId,
    channel,
    channelUserId: input.userId,
    channelConversationId: input.threadId ?? null,
  });

  // 受信执行上下文：只能由服务端构造（session 已校验 org/user）
  const runtime: AIRuntimeContext = normalizeRuntimeContext({
    orgId: input.orgId,
    workspaceId: input.workspaceId ?? undefined,
    actor: { type: "USER", id: input.userId, userId: input.userId },
    owner: { type: "USER", id: input.userId },
    projectId: input.projectId ?? undefined,
    threadId: input.threadId ?? undefined,
    sessionId: session.id,
    channel,
    traceId: input.traceId ?? undefined,
    source: input.source ?? "workforce_job",
  })!;

  const created = await createAgentRun({
    orgId: input.orgId,
    sessionId: session.id,
    userMessageId: input.userMessageId ?? undefined,
    runType: WORKFORCE_JOB_RUN_TYPE,
    intent: "workforce_job",
    workspaceId: input.workspaceId ?? null,
    projectId: input.projectId ?? null,
    traceId: input.traceId ?? null,
    runtime,
    metadata: {
      // T1B：业务身份元数据（已消毒；保留键不可覆盖）先展开，
      // server 构造字段殿后（同键恒以 server 值为准）
      ...extra.value,
      runtimeVersion: "v2",
      goal,
      // 执行主体恢复锚点（resolveRuntimeV2Principal 复用；resume 时重新校验）
      initiatedByUserId: input.userId,
      threadId: input.threadId ?? null,
      channel,
      source: runtime.source,
      // T5-P0C-C：server 权威 workDomain（具名参数，非 client metadata）
      ...(input.workDomain ? { workDomain: input.workDomain } : {}),
      // T5-P0A §5/§28：计划来源与契约版本（server 权威、保留键防伪造、可观测）
      planSource: compiled ? PLAN_SOURCE.SERVER_AUTHORED : PLAN_SOURCE.LLM_PLANNER,
      ...(compiled
        ? {
            planContractVersion: WORKFORCE_PLAN_CONTRACT_VERSION,
            taskContractVersion: WORKFORCE_TASK_CONTRACT_WRITE_VERSION,
            planTaskCount: compiled.taskCount,
            plannerLlmCalls: 0,
          }
        : {}),
    },
  });
  const run = created.run;

  if (created.reused) {
    return {
      ok: true,
      jobId: run.id,
      runId: run.id,
      traceId: run.traceId,
      reused: true,
    };
  }

  // T5-P0A §6：server-authored 计划在"入队之前"落库。
  // 顺序刻意如此——planJson + steps 先就位，再把 run 置 queued，
  // 于是 processor 认领时 `if (!run.planJson)` 恒为 false（planner 零调用），
  // 且不存在"已入队但无计划"的可执行孤儿窗口。
  // 持久化失败 → run 直接进终态 failed（绝不留 PENDING forever）。
  if (compiled) {
    try {
      const { persistPlanAndSteps } = await import(
        "@/lib/agent-runtime-v2/persist"
      );
      await persistPlanAndSteps({
        orgId: input.orgId,
        runId: run.id,
        plan: compiled.plan,
      });
    } catch (err) {
      await db.agentRun
        .update({
          where: { id: run.id },
          data: {
            status: "failed",
            errorCode: "deterministic_plan_persist_failed",
            errorMessage: `server-authored 计划持久化失败：${
              err instanceof Error ? err.message : String(err)
            }`.slice(0, 500),
            nextAttemptAt: null,
            leaseExpiresAt: null,
          },
        })
        .catch(() => {});
      return { ok: false, error: "DETERMINISTIC_PLAN_PERSIST_FAILED" };
    }
  }

  // durable queue 就绪：v2 runtime + queued + 立即可认领
  await db.agentRun.update({
    where: { id: run.id },
    data: {
      runtimeVersion: "v2",
      status: "queued",
      nextAttemptAt: new Date(),
      leaseExpiresAt: null,
    },
  });

  // 回写 jobId = rootRunId = run.id（merge，不覆盖既有 correlation）
  await mergeAgentRunMetadata(input.orgId, run.id, { jobId: run.id });

  const correlation = runtimeContextToTelemetry({
    ...runtime,
    runId: run.id,
    rootRunId: run.id,
    jobId: run.id,
    traceId: run.traceId ?? runtime.traceId,
  });

  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: run.id,
    eventType: "job.created",
    title: "Workforce Job 已创建",
    payload: { goal: goal.slice(0, 200), correlation },
    visibleToUser: true,
  });
  await appendAgentRunEvent({
    orgId: input.orgId,
    runId: run.id,
    eventType: "job.queued",
    title: "已进入 Workforce 队列",
    payload: { correlation },
    visibleToUser: true,
  });

  return {
    ok: true,
    jobId: run.id,
    runId: run.id,
    traceId: run.traceId,
    reused: false,
  };
}
