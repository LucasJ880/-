/**
 * Mention Gateway — canonical entry：handleMentionEvent（M1）
 *
 * 调用链（任一步失败 → fail-closed + 结构化错误）：
 *   1 flags → 2 event → 3 mention → 4 audience → 5 idempotency
 *   → 6 identity(+membership/tenant) → 7 binding → 8 binding org → 9 business context
 *   → 10 scope → 11 session → 12 AgentRun → 13 tools(allowlist) → 14 runAgent
 *   → 15 events → 16 complete → 17 adapter.sendMessage（initiating user only）
 *
 * 复用：agent-core runAgent（ToolRegistry canonical 链）、AgentSession / AgentRun /
 * AgentRunEvent、resolveAgentTenant、resolveAgentScope。
 * 不复用 / 不接入：Runtime V2 executor、旧渠道会话壳（缺租户字段）、记忆写入、外部发送。
 */

import type { AgentRunOptions, AgentRunResult } from "@/lib/agent-core/types";
import type {
  AgentErrorCode,
  AgentRunEventType,
  AgentRunStatus,
} from "@/lib/agent-runtime/types";
import type { AIRuntimeContext } from "@/lib/ai/runtime-context";
import { runtimeContextFromScope } from "@/lib/ai/runtime-context";
import { logger } from "@/lib/common/logger";
import {
  createDefaultContextDeps,
  resolveMentionContext,
  type ContextDeps,
} from "./context";
import { getDefaultMentionFixtureStore } from "./fixtures";
import {
  isMentionGatewayEnabledWithEnv,
  isMentionMockEnabledWithEnv,
  resolveMentionGatewayMaxRiskWithEnv,
  type MentionGatewayFlagEnv,
} from "./flags";
import {
  createDefaultIdentityDeps,
  resolveMentionIdentity,
  type IdentityDeps,
} from "./identity";
import {
  MENTION_AGENT_ID,
  MENTION_AUDIENCE_POLICY,
  buildMentionRunOptions,
  evaluateAudience,
} from "./policy";
import {
  buildMentionSessionKey,
  buildMentionUserMessageId,
  getOrCreateMentionSession,
  type MentionSessionKey,
} from "./session";
import type {
  ChannelAdapter,
  MentionEvent,
  MentionGatewayErrorCode,
  MentionHandleFailure,
  MentionHandleResult,
  MentionReplyTarget,
  MentionStage,
} from "./types";

// ── 幂等（进程内，best-effort；跨实例由 AgentRun.userMessageId 兜底）──────────

export class DuplicateEventGuard {
  private seen = new Map<string, number>();
  constructor(private readonly max = 5000) {}

  /** 首次出现返回 true 并登记；重复返回 false */
  markIfNew(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.set(key, Date.now());
    if (this.seen.size > this.max) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  has(key: string): boolean {
    return this.seen.has(key);
  }

  clear(): void {
    this.seen.clear();
  }
}

export function buildMentionEventKey(event: MentionEvent): string {
  return `${event.provider}:${event.eventId}`;
}

// ── 依赖注入面 ─────────────────────────────────────────────────────────────

export interface MentionRuntimeDeps {
  getOrCreateSession(key: MentionSessionKey): Promise<{ id: string }>;
  createRun(input: {
    orgId: string;
    sessionId: string;
    userMessageId: string;
    runType: string;
    intent: string;
    projectId?: string | null;
    metadata: Record<string, unknown>;
    runtime?: AIRuntimeContext;
  }): Promise<{ run: { id: string }; reused: boolean }>;
  appendEvent(input: {
    orgId: string;
    runId: string;
    eventType: AgentRunEventType;
    title?: string;
    payload?: Record<string, unknown>;
    visibleToUser?: boolean;
  }): Promise<unknown>;
  emitOutput(input: { orgId: string; runId: string; output: string }): Promise<unknown>;
  updateRunStatus(
    orgId: string,
    runId: string,
    status: AgentRunStatus,
    patch?: { intent?: string; metadata?: Record<string, unknown> },
  ): Promise<unknown>;
  completeRun(orgId: string, runId: string): Promise<unknown>;
  failRun(
    orgId: string,
    runId: string,
    error: { code: AgentErrorCode; message: string },
  ): Promise<unknown>;
  runAgent(options: AgentRunOptions): Promise<AgentRunResult>;
}

export interface MentionGatewayDeps {
  identity: IdentityDeps;
  context: ContextDeps;
  runtime: MentionRuntimeDeps;
  duplicateGuard: DuplicateEventGuard;
  now(): Date;
}

const defaultDuplicateGuard = new DuplicateEventGuard();

/** 真实依赖（全部懒加载；只在真正执行时触达 DB / 模型） */
export function createDefaultMentionGatewayDeps(): MentionGatewayDeps {
  const store = getDefaultMentionFixtureStore();
  return {
    identity: createDefaultIdentityDeps({
      lookupExternalIdentity: async (provider, externalUserId) =>
        store.lookupIdentity(provider, externalUserId),
    }),
    context: createDefaultContextDeps({
      lookupChannelBinding: async (provider, channelId, threadId) =>
        store.lookupBinding(provider, channelId, threadId),
    }),
    runtime: {
      getOrCreateSession: (key) => getOrCreateMentionSession(key),
      async createRun(input) {
        const { createAgentRun } = await import("@/lib/agent-runtime/run");
        return createAgentRun(input);
      },
      async appendEvent(input) {
        const { appendAgentRunEvent } = await import("@/lib/agent-runtime/run");
        return appendAgentRunEvent(input);
      },
      async emitOutput(input) {
        const { emitAgentOutputEvent } = await import("@/lib/agent-runtime/observe");
        return emitAgentOutputEvent({ ...input, outputType: "text" });
      },
      async updateRunStatus(orgId, runId, status, patch) {
        const { updateAgentRunStatus } = await import("@/lib/agent-runtime/run");
        return updateAgentRunStatus(orgId, runId, status, patch);
      },
      async completeRun(orgId, runId) {
        const { completeAgentRunRespectingApprovals } = await import(
          "@/lib/agent-runtime/pending-link"
        );
        return completeAgentRunRespectingApprovals(orgId, runId);
      },
      async failRun(orgId, runId, error) {
        const { failAgentRun } = await import("@/lib/agent-runtime/run");
        return failAgentRun(orgId, runId, error);
      },
      async runAgent(options) {
        // 工具注册为 side-effect import；与 Web Operator / agent-core chat 同一 Registry
        await import("@/lib/agent-core/tools");
        const { runAgent } = await import("@/lib/agent-core");
        return runAgent(options);
      },
    },
    duplicateGuard: defaultDuplicateGuard,
    now: () => new Date(),
  };
}

// ── 入口 ───────────────────────────────────────────────────────────────────

export interface HandleMentionInput {
  raw: unknown;
  adapter: ChannelAdapter;
  deps?: Partial<MentionGatewayDeps>;
  env?: MentionGatewayFlagEnv;
  /** Mock API 调用者（已登录用户）；非平台管理员必须与 fixture 解析出的用户一致 */
  caller?: { userId: string; isPlatformAdmin: boolean };
  abortSignal?: AbortSignal;
}

const SAFE_MESSAGES: Record<MentionGatewayErrorCode, string> = {
  GATEWAY_DISABLED: "Mention Gateway 未启用",
  MOCK_DISABLED: "Mock 入口未启用或当前环境不允许",
  INVALID_EVENT: "事件格式不合法",
  NOT_MENTIONED: "消息未 @青砚，已忽略",
  AUDIENCE_DENIED: "本渠道形态不受支持：只允许私聊或私有线程中的 @提及",
  DUPLICATE_EVENT: "该事件已处理过",
  IDENTITY_OR_MEMBERSHIP_DENIED: "无法确认你的青砚身份或组织成员资格",
  CONTEXT_UNRESOLVED: "当前频道未绑定业务上下文，无法处理",
  CHANNEL_ORG_MISMATCH: "当前频道绑定的组织与你的工作组织不一致",
  SCOPE_DENIED: "无权访问当前频道绑定的业务对象",
  SESSION_FAILED: "会话初始化失败，请稍后重试",
  RUN_CREATE_FAILED: "任务创建失败，请稍后重试",
  RUN_FAILED: "这次 @提及没有完成处理，请稍后重试",
  DELIVERY_FAILED: "回复投递失败，请稍后重试",
};

const FAILURE_DM = "这次 @提及没有完成处理，我已保留任务记录，请稍后重试。";

function failure(
  status: MentionHandleFailure["status"],
  code: MentionGatewayErrorCode,
  stage: MentionStage,
  extra?: { runId?: string; message?: string },
): MentionHandleFailure {
  return {
    ok: false,
    status,
    code,
    message: extra?.message ?? SAFE_MESSAGES[code],
    stage,
    runId: extra?.runId,
  };
}

function replyTarget(event: MentionEvent): MentionReplyTarget {
  return {
    provider: event.provider,
    externalUserId: event.externalUserId,
    channelId: event.channel.id,
    threadId: event.threadId,
    audience: MENTION_AUDIENCE_POLICY.audience,
  };
}

export async function handleMentionEvent(
  input: HandleMentionInput,
): Promise<MentionHandleResult> {
  const env = input.env ?? process.env;
  const defaults = createDefaultMentionGatewayDeps();
  const deps: MentionGatewayDeps = {
    identity: input.deps?.identity ?? defaults.identity,
    context: input.deps?.context ?? defaults.context,
    runtime: input.deps?.runtime ?? defaults.runtime,
    duplicateGuard: input.deps?.duplicateGuard ?? defaults.duplicateGuard,
    now: input.deps?.now ?? defaults.now,
  };
  const adapter = input.adapter;

  // 1 flags
  if (!isMentionGatewayEnabledWithEnv(env)) {
    return failure("rejected", "GATEWAY_DISABLED", "flags");
  }
  if (adapter.provider === "mock" && !isMentionMockEnabledWithEnv(env)) {
    return failure("rejected", "MOCK_DISABLED", "flags");
  }

  // 2 event（含 schema 校验 + 受众预检）
  const received = adapter.receiveEvent(input.raw);
  if (!received.ok) {
    return failure(
      "rejected",
      received.code,
      received.code === "AUDIENCE_DENIED" ? "audience" : "event",
      { message: received.message },
    );
  }
  const event = received.event;
  if (event.provider !== adapter.provider) {
    return failure("rejected", "INVALID_EVENT", "event");
  }

  // 3 mention
  if (!event.mentionedAgent) {
    return failure("ignored", "NOT_MENTIONED", "mention");
  }

  // 4 audience（二次确认：类型层已收窄，此处防适配器实现漂移）
  const audience = evaluateAudience(event.channel.type);
  if (!audience.ok) {
    return failure("rejected", "AUDIENCE_DENIED", "audience", { message: audience.message });
  }

  // 5 idempotency（进程内）
  if (!deps.duplicateGuard.markIfNew(buildMentionEventKey(event))) {
    return failure("duplicate", "DUPLICATE_EVENT", "idempotency");
  }

  // 6 identity + membership / tenant
  const identity = await resolveMentionIdentity(event, deps.identity, {
    caller: input.caller,
  });
  if (!identity.ok) {
    logger.warn("mention_gateway.identity_denied", {
      provider: event.provider,
      eventId: event.eventId,
      reason: identity.reason,
    });
    return failure("rejected", identity.code, "identity");
  }
  const { user, orgId, tenant } = identity.identity;

  // 7–10 binding → binding org → business context → scope
  const context = await resolveMentionContext(event, identity.identity, deps.context);
  if (!context.ok) {
    logger.warn("mention_gateway.context_denied", {
      provider: event.provider,
      eventId: event.eventId,
      code: context.code,
      reason: context.reason,
      scopeCode: context.scopeCode,
    });
    const stage: MentionStage =
      context.code === "CONTEXT_UNRESOLVED"
        ? context.reason === "no_binding"
          ? "binding"
          : "context"
        : context.code === "CHANNEL_ORG_MISMATCH"
          ? "binding_org"
          : "scope";
    return failure("rejected", context.code, stage);
  }
  const { binding, scope, contextBlock } = context.context;

  // 11 session（线程级逻辑键，复用 AgentSession 表）
  let sessionId: string;
  try {
    const session = await deps.runtime.getOrCreateSession(
      buildMentionSessionKey(event, { orgId, userId: user.id }),
    );
    sessionId = session.id;
  } catch (e) {
    logger.error("mention_gateway.session_failed", {
      eventId: event.eventId,
      err: e instanceof Error ? e.message : String(e),
    });
    return failure("failed", "SESSION_FAILED", "session");
  }

  // 12 AgentRun（userMessageId 幂等：reused → duplicate，不再执行）
  const baseRuntime = runtimeContextFromScope(
    { ...scope, sessionId },
    {
      agent: { id: MENTION_AGENT_ID, role: "mention_gateway" },
      channel: `mention:${event.provider}`,
      source: "mention-gateway",
    },
  );
  let runId: string;
  try {
    const created = await deps.runtime.createRun({
      orgId,
      sessionId,
      userMessageId: buildMentionUserMessageId(event),
      runType: "conversation",
      intent: "mention",
      projectId: scope.projectId ?? null,
      runtime: baseRuntime,
      metadata: {
        source: "mention_gateway",
        provider: event.provider,
        channelId: event.channel.id,
        channelType: event.channel.type,
        threadId: event.threadId ?? null,
        eventId: event.eventId,
        contextType: binding.contextType,
        contextId: binding.contextId,
        audience: MENTION_AUDIENCE_POLICY.audience,
      },
    });
    if (created.reused) {
      return failure("duplicate", "DUPLICATE_EVENT", "idempotency", {
        runId: created.run.id,
      });
    }
    runId = created.run.id;
  } catch (e) {
    logger.error("mention_gateway.run_create_failed", {
      eventId: event.eventId,
      err: e instanceof Error ? e.message : String(e),
    });
    return failure("failed", "RUN_CREATE_FAILED", "run");
  }

  const safeEvent = async (
    eventType: AgentRunEventType,
    title: string,
    payload: Record<string, unknown>,
    visibleToUser = false,
  ) => {
    try {
      await deps.runtime.appendEvent({
        orgId,
        runId,
        eventType,
        title,
        payload: { schemaVersion: 1, source: "mention_gateway", provider: event.provider, ...payload },
        visibleToUser,
      });
    } catch (e) {
      logger.warn("mention_gateway.event_failed", {
        runId,
        eventType,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const deliverFailureNotice = async () => {
    try {
      await adapter.sendMessage(replyTarget(event), FAILURE_DM);
    } catch {
      /* 失败通知本身失败不再升级 */
    }
  };

  // 15 events：MENTION_CONTEXT_RESOLVED → 复用 context.loading / context.loaded
  await safeEvent("context.loading", "解析频道上下文", { schemaVersion: 1 });
  await safeEvent("context.loaded", "频道上下文已就绪", {
    contextType: binding.contextType,
    contextId: binding.contextId,
    projectRole: scope.projectRole ?? null,
    types: ["channel_binding", "agent_scope", ...(contextBlock ? ["project_block"] : [])],
    contextTypes: ["channel_binding", "agent_scope", ...(contextBlock ? ["project_block"] : [])],
    sourceCount: contextBlock ? 3 : 2,
    projectId: scope.projectId ?? null,
    customerId: scope.customerId ?? null,
  });

  // 13 tools：显式 allowlist + maxRisk 天花板 + 真实租户字段
  let options: AgentRunOptions;
  try {
    options = buildMentionRunOptions({
      event,
      user: { id: user.id, role: user.role, name: user.name },
      tenant,
      scope: { ...scope, sessionId, agentRunId: runId },
      contextType: binding.contextType,
      contextId: binding.contextId,
      contextBlock,
      sessionId,
      runId,
      maxRisk: resolveMentionGatewayMaxRiskWithEnv(env),
      abortSignal: input.abortSignal,
      hooks: {
        onToolStart: async (info) => {
          await safeEvent(
            "tool.started",
            `调用 ${info.name}`,
            {
              name: info.name,
              round: info.round,
              toolCallId: info.toolCallId?.trim() || `tool:${info.name}:${info.round}`,
            },
            true,
          );
        },
        onToolCall: async (info) => {
          const ok = info.result?.success !== false;
          await safeEvent("tool.completed", `${info.name} 完成`, {
            name: info.name,
            toolCallId: info.toolCallId?.trim() || `tool:${info.name}:${info.round}`,
            ok,
            durationMs: info.durationMs,
            resultType: ok ? "ok" : "error",
            errorCode: ok ? null : "tool_failed",
          });
        },
      },
    });
  } catch (e) {
    logger.error("mention_gateway.options_failed", {
      runId,
      err: e instanceof Error ? e.message : String(e),
    });
    await deps.runtime
      .failRun(orgId, runId, { code: "org_forbidden", message: "tenant/scope invariant failed" })
      .catch(() => {});
    return failure("failed", "RUN_FAILED", "tools", { runId });
  }

  try {
    await deps.runtime.updateRunStatus(orgId, runId, "running", {
      intent: "mention",
      metadata: {
        maxRisk: options.maxRisk,
        toolAllowlistCount: options.tools?.length ?? 0,
      },
    });
  } catch (e) {
    logger.warn("mention_gateway.status_update_failed", {
      runId,
      err: e instanceof Error ? e.message : String(e),
    });
  }

  // 14 runAgent（agent-core 引擎；Registry canonical 链）
  await safeEvent("response.started", "生成回复", { maxRisk: options.maxRisk }, true);
  let result: AgentRunResult;
  try {
    result = await deps.runtime.runAgent(options);
  } catch (e) {
    logger.error("mention_gateway.agent_failed", {
      runId,
      err: e instanceof Error ? e.message : String(e),
    });
    await safeEvent("response.failed", "回复生成失败", { errorCode: "model_failed" });
    await deps.runtime
      .failRun(orgId, runId, {
        code: "model_failed",
        message: e instanceof Error ? e.message : "runAgent failed",
      })
      .catch(() => {});
    await deliverFailureNotice();
    return failure("failed", "RUN_FAILED", "agent", { runId });
  }

  const responseText = (result.content ?? "").trim() || "（本次没有生成可展示的回复）";
  try {
    await deps.runtime.emitOutput({ orgId, runId, output: responseText });
  } catch (e) {
    logger.warn("mention_gateway.output_event_failed", {
      runId,
      err: e instanceof Error ? e.message : String(e),
    });
  }

  // 16 complete
  try {
    await deps.runtime.completeRun(orgId, runId);
  } catch (e) {
    logger.warn("mention_gateway.complete_failed", {
      runId,
      err: e instanceof Error ? e.message : String(e),
    });
  }

  // 17 deliver（仅 initiating user）；MENTION_RESPONSE_SENT → response.completed(delivered)
  let delivered = false;
  try {
    const sent = await adapter.sendMessage(replyTarget(event), responseText);
    delivered = sent.ok;
    if (!sent.ok) {
      await safeEvent("response.failed", "回复投递失败", {
        delivered: false,
        audience: MENTION_AUDIENCE_POLICY.audience,
        errorCode: "delivery_failed",
      });
      return failure("failed", "DELIVERY_FAILED", "deliver", { runId });
    }
  } catch (e) {
    await safeEvent("response.failed", "回复投递失败", {
      delivered: false,
      audience: MENTION_AUDIENCE_POLICY.audience,
      errorCode: "delivery_failed",
      err: e instanceof Error ? e.message : String(e),
    });
    return failure("failed", "DELIVERY_FAILED", "deliver", { runId });
  }
  await safeEvent("response.completed", "回复已送达", {
    delivered: true,
    audience: MENTION_AUDIENCE_POLICY.audience,
    toolCalls: result.toolCalls?.length ?? 0,
    rounds: result.rounds,
  });

  logger.info("mention_gateway.completed", {
    provider: event.provider,
    eventId: event.eventId,
    runId,
    toolCalls: result.toolCalls?.length ?? 0,
  });

  return {
    ok: true,
    status: "completed",
    runId,
    sessionId,
    context: { type: binding.contextType, id: binding.contextId },
    response: responseText,
    audience: MENTION_AUDIENCE_POLICY.audience,
    delivered,
    toolCalls: result.toolCalls?.length ?? 0,
    maxRisk: options.maxRisk ?? "l0_read",
  };
}
