/**
 * Phase 1.1 — AIRuntimeContext（Model Runtime 统一执行上下文契约）
 *
 * 职责边界：
 * - 只承载「谁发起 / 谁执行 / 代表谁 / 属于哪个 Job/Task/Run 树 / 业务实体 / trace」
 *   等 correlation 与身份信息，供模型调用、Tool 执行、审批、审计、遥测共用。
 * - 不承载权限决策：capability / data scope / approval policy 仍由
 *   Tool Runtime（canInvokeTool + toolPolicy + scopeGuard + approval-gate）负责。
 * - 全部字段 optional：legacy 调用方不提供时系统行为不变（向后兼容）。
 *
 * Hard Rule：本上下文只能由可信服务端代码构造（session / AgentScopeContext /
 * AgentRun 记录），绝不允许来自 LLM 输出或客户端请求体。
 */

import { createTraceId } from "@/lib/capabilities/trace-context";
import type { AgentScopeContext } from "@/lib/agent-scope/types";

export type AIActorType = "USER" | "AGENT" | "SYSTEM" | "AUTOMATION";
export type AIOwnerType = "USER" | "AGENT";

export interface AIRuntimeActor {
  type: AIActorType;
  /** actor 主键：USER→userId；AGENT→agent 标识；SYSTEM/AUTOMATION→来源标识（如 cron:xxx） */
  id?: string;
  /** 代表哪个人类用户执行（AGENT/AUTOMATION 场景下的 on-behalf-of） */
  userId?: string;
}

export interface AIRuntimeAgent {
  /** Agent 标识（Prisma Agent.key / skill slug / 未来数字员工 id） */
  id?: string;
  /** Agent 角色语义（如 tender-compliance） */
  role?: string;
}

export interface AIRuntimeOwner {
  type?: AIOwnerType;
  id?: string;
}

/**
 * Model Runtime 统一执行上下文。
 * 命名对齐现有代码：organizationId 使用现有 orgId 习惯。
 */
export interface AIRuntimeContext {
  // Tenant
  orgId?: string;
  workspaceId?: string;

  // 身份三元组：Actor ≠ Agent ≠ Owner
  actor?: AIRuntimeActor;
  agent?: AIRuntimeAgent;
  owner?: AIRuntimeOwner;

  // Durable work correlation（Phase 1.1 仅作关联标识，无 Job Engine）
  jobId?: string;
  taskId?: string;

  // Run 树
  runId?: string;
  parentRunId?: string;
  rootRunId?: string;

  // 业务实体
  projectId?: string;
  customerId?: string;
  vendorId?: string;
  tenderId?: string;
  orderId?: string;

  // 会话
  threadId?: string;
  sessionId?: string;
  channel?: string;

  // Observability
  traceId?: string;
  /** 遥测调用点标签（recordAiCall.source） */
  source?: string;
}

/** 规范化：trim、生成缺省 traceId、推导 rootRunId（root = 自身 runId） */
export function normalizeRuntimeContext(
  input: AIRuntimeContext | undefined,
): AIRuntimeContext | undefined {
  if (!input) return undefined;
  const trim = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  const runId = trim(input.runId);
  const parentRunId = trim(input.parentRunId);
  const rootRunId =
    trim(input.rootRunId) ?? (parentRunId ? undefined : runId);
  return {
    ...input,
    orgId: trim(input.orgId),
    workspaceId: trim(input.workspaceId),
    jobId: trim(input.jobId),
    taskId: trim(input.taskId),
    runId,
    parentRunId,
    rootRunId,
    projectId: trim(input.projectId),
    customerId: trim(input.customerId),
    vendorId: trim(input.vendorId),
    tenderId: trim(input.tenderId),
    orderId: trim(input.orderId),
    threadId: trim(input.threadId),
    sessionId: trim(input.sessionId),
    channel: trim(input.channel),
    traceId: trim(input.traceId) ?? createTraceId(),
    source: trim(input.source),
  };
}

/**
 * 从 Phase 1 AgentScopeContext 桥接（服务端已校验的 scope → 执行上下文）。
 * actor 默认 USER（Web 会话人类请求者）。
 */
export function runtimeContextFromScope(
  scope: AgentScopeContext,
  extra?: Partial<AIRuntimeContext>,
): AIRuntimeContext {
  return normalizeRuntimeContext({
    orgId: scope.orgId,
    workspaceId: scope.workspaceId,
    actor: { type: "USER", id: scope.principalUserId, userId: scope.principalUserId },
    projectId: scope.projectId,
    customerId: scope.customerId,
    threadId: scope.threadId,
    sessionId: scope.sessionId,
    channel: scope.channel,
    traceId: scope.traceId,
    runId: scope.agentRunId,
    ...extra,
  })!;
}

/**
 * 派生子 Run 上下文（Run 树 correlation，Phase 1.1 不做真正 delegation）：
 * - 继承 traceId / org / job / task / 业务实体
 * - parentRunId = 父 runId；rootRunId = 父 rootRunId ?? 父 runId
 */
export function deriveChildRunContext(
  parent: AIRuntimeContext,
  child: {
    runId: string;
    actor?: AIRuntimeActor;
    agent?: AIRuntimeAgent;
    owner?: AIRuntimeOwner;
    source?: string;
  },
): AIRuntimeContext {
  return {
    ...parent,
    runId: child.runId,
    parentRunId: parent.runId,
    rootRunId: parent.rootRunId ?? parent.runId ?? child.runId,
    actor: child.actor ?? parent.actor,
    agent: child.agent ?? parent.agent,
    owner: child.owner ?? parent.owner,
    source: child.source ?? parent.source,
  };
}

/** 遥测投影：附加到 recordAiCall / 结构化日志的扁平字段 */
export function runtimeContextToTelemetry(
  ctx: AIRuntimeContext | undefined,
): Record<string, string | undefined> {
  if (!ctx) return {};
  return {
    traceId: ctx.traceId,
    runId: ctx.runId,
    parentRunId: ctx.parentRunId,
    rootRunId: ctx.rootRunId,
    orgId: ctx.orgId,
    actorType: ctx.actor?.type,
    actorId: ctx.actor?.id,
    agentId: ctx.agent?.id,
    ownerType: ctx.owner?.type,
    ownerId: ctx.owner?.id,
    jobId: ctx.jobId,
    taskId: ctx.taskId,
    projectId: ctx.projectId,
    channel: ctx.channel,
  };
}

/**
 * AgentRun.metadata correlation 契约（与 traceContextToMetadata 合并使用）。
 * 只写有值字段，避免污染 metadata。
 */
export function runtimeContextToRunMetadata(
  ctx: AIRuntimeContext | undefined,
): Record<string, unknown> {
  if (!ctx) return {};
  const out: Record<string, unknown> = {};
  if (ctx.rootRunId) out.rootRunId = ctx.rootRunId;
  if (ctx.jobId) out.jobId = ctx.jobId;
  if (ctx.taskId) out.taskId = ctx.taskId;
  if (ctx.actor) {
    out.actorType = ctx.actor.type;
    if (ctx.actor.id) out.actorId = ctx.actor.id;
    if (ctx.actor.userId) out.actorUserId = ctx.actor.userId;
  }
  if (ctx.agent?.id) out.agentId = ctx.agent.id;
  if (ctx.agent?.role) out.agentRole = ctx.agent.role;
  if (ctx.owner?.type) out.ownerType = ctx.owner.type;
  if (ctx.owner?.id) out.ownerId = ctx.owner.id;
  if (ctx.customerId) out.customerId = ctx.customerId;
  if (ctx.vendorId) out.vendorId = ctx.vendorId;
  if (ctx.tenderId) out.tenderId = ctx.tenderId;
  if (ctx.orderId) out.orderId = ctx.orderId;
  if (ctx.channel) out.channel = ctx.channel;
  return out;
}

const ACTOR_TYPES: readonly AIActorType[] = [
  "USER",
  "AGENT",
  "SYSTEM",
  "AUTOMATION",
];
const OWNER_TYPES: readonly AIOwnerType[] = ["USER", "AGENT"];

function metaRecord(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

/**
 * Phase 2A（Workforce Runtime）：从 AgentRun 行 + metadata 恢复受信执行上下文。
 *
 * 安全边界（Hard Rule）：
 * - metadata 只承载 identity / correlation（谁发起、代表谁、属于哪棵 run 树），
 *   **不是授权快照**。resume/续跑方拿到本上下文后，必须重新走当前
 *   membership / capability / data scope / tool policy / approval 检查
 *   （如 resolveRuntimeV2Principal + executor 内 canInvokeTool），
 *   禁止把 metadata 里的历史角色/权限/审批决定当作仍然有效。
 * - 列值优先于 metadata（runId/orgId/traceId/parentRunId 以 DB 列为准）。
 */
export function runtimeFromRunMetadata(run: {
  id: string;
  orgId: string;
  sessionId?: string | null;
  traceId?: string | null;
  parentRunId?: string | null;
  metadata?: unknown;
}): AIRuntimeContext {
  const meta = metaRecord(run.metadata);
  const str = (key: string): string | undefined => {
    const v = meta[key];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };

  const actorTypeRaw = str("actorType");
  const actorType = ACTOR_TYPES.find((t) => t === actorTypeRaw);
  const actor: AIRuntimeActor | undefined = actorType
    ? { type: actorType, id: str("actorId"), userId: str("actorUserId") }
    : undefined;

  const agentId = str("agentId");
  const agentRole = str("agentRole");
  const agent: AIRuntimeAgent | undefined =
    agentId || agentRole ? { id: agentId, role: agentRole } : undefined;

  const ownerTypeRaw = str("ownerType");
  const ownerType = OWNER_TYPES.find((t) => t === ownerTypeRaw);
  const owner: AIRuntimeOwner | undefined =
    ownerType || str("ownerId")
      ? { type: ownerType, id: str("ownerId") }
      : undefined;

  const parentRunId =
    (run.parentRunId && run.parentRunId.trim()) || str("parentRunId");

  return normalizeRuntimeContext({
    orgId: run.orgId,
    workspaceId: str("workspaceId"),
    actor,
    agent,
    owner,
    jobId: str("jobId"),
    taskId: str("taskId"),
    runId: run.id,
    parentRunId,
    rootRunId: str("rootRunId"),
    projectId: str("projectId"),
    customerId: str("customerId"),
    vendorId: str("vendorId"),
    tenderId: str("tenderId"),
    orderId: str("orderId"),
    threadId: str("threadId"),
    sessionId: (run.sessionId && run.sessionId.trim()) || str("sessionId"),
    channel: str("channel"),
    traceId: (run.traceId && run.traceId.trim()) || str("traceId"),
    source: str("source"),
  })!;
}

/** 从 AgentRun.metadata 读取 rootRunId（历史数据允许缺失） */
export function readRootRunIdFromUnknown(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const v = (metadata as Record<string, unknown>).rootRunId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
