/**
 * Mention Gateway — Channel Context Resolver（M1）
 *
 *   (provider, channelId, threadId?) ──fixture──▶ ChannelContextBinding
 *     ──▶ binding.organizationId === identity.orgId（否则 CHANNEL_ORG_MISMATCH）
 *     ──▶ resolveAgentScope（业务对象归属 + 用户访问权，fail-closed）
 *     ──▶ 只读上下文块（buildProjectAiContextBlock(light, expectedOrgId)）
 *
 * 没有显式绑定 → CONTEXT_UNRESOLVED，绝不进入 Agent Runtime；禁止由模型猜测业务对象。
 * 本仓库中 tender 即带招投标字段的 Project，因此 tender 绑定按 projectId 走 scope 校验。
 */

import type {
  AgentScopeContext,
  ResolveAgentScopeResult,
} from "@/lib/agent-scope/types";
import type { ResolveAgentScopeInput } from "@/lib/agent-scope/resolve";
import type { ResolvedMentionIdentity } from "./identity";
import type { ChannelContextBinding, MentionEvent, MentionProvider } from "./types";

/** M2-B：绑定查找三态 —— found / none / fail_closed（ACTIVE 行校验失败或 DB 源异常；绝不 fallback） */
export type ChannelBindingLookup =
  | { status: "found"; binding: ChannelContextBinding }
  | { status: "none" }
  | { status: "fail_closed"; reason: string };

export interface ContextDeps {
  /** B1：providerTenantId 是渠道边界的一部分；expectedOrgId 供 DB 源在行上做 org fail-closed 校验 */
  lookupChannelBinding(
    provider: MentionProvider,
    providerTenantId: string,
    channelId: string,
    threadId: string | undefined,
    expectedOrgId: string,
  ): Promise<ChannelBindingLookup>;
  resolveAgentScope(input: ResolveAgentScopeInput): Promise<ResolveAgentScopeResult>;
  /** 只读上下文块；失败返回空串（不阻断；工具层仍强制 scope） */
  buildContextBlock(input: {
    binding: ChannelContextBinding;
    orgId: string;
  }): Promise<string>;
}

export interface ResolvedMentionContext {
  binding: ChannelContextBinding;
  scope: AgentScopeContext;
  contextBlock: string;
}

export type ContextDenyReason =
  | "no_binding"
  | "binding_invalid"
  | "binding_lookup_failed"
  | "binding_org_mismatch"
  | "scope_denied"
  | "scope_org_mismatch";

export type ResolveMentionContextResult =
  | { ok: true; context: ResolvedMentionContext }
  | {
      ok: false;
      code: "CONTEXT_UNRESOLVED" | "CHANNEL_ORG_MISMATCH" | "SCOPE_DENIED";
      reason: ContextDenyReason;
      /** resolveAgentScope 的 deny code（仅日志） */
      scopeCode?: string;
    };

/** 纯函数：binding 的组织声明必须等于真实 membership org */
export function verifyBindingOrganization(
  binding: ChannelContextBinding,
  identityOrgId: string,
): boolean {
  return (
    typeof binding.organizationId === "string" &&
    binding.organizationId.length > 0 &&
    binding.organizationId === identityOrgId
  );
}

/** 纯函数：绑定 → scope 请求（不信任 binding 之外的任何输入） */
export function bindingToScopeInput(
  binding: ChannelContextBinding,
  identity: { userId: string; role: string; orgId: string },
  extra: { threadId?: string; sessionId?: string; agentRunId?: string },
): ResolveAgentScopeInput | null {
  const contextId = (binding.contextId ?? "").trim();
  if (!contextId) return null;
  const base: ResolveAgentScopeInput = {
    user: { id: identity.userId, role: identity.role },
    orgId: identity.orgId,
    channel: "messaging",
    threadId: extra.threadId ?? null,
    sessionId: extra.sessionId ?? null,
    agentRunId: extra.agentRunId ?? null,
  };
  switch (binding.contextType) {
    case "project":
    case "tender":
      return { ...base, projectId: contextId };
    case "sales":
      return { ...base, customerId: contextId };
    default:
      return null;
  }
}

export async function resolveMentionContext(
  event: MentionEvent,
  identity: ResolvedMentionIdentity,
  deps: ContextDeps,
  extra: { sessionId?: string; agentRunId?: string } = {},
): Promise<ResolveMentionContextResult> {
  const lookup = await deps.lookupChannelBinding(
    event.provider,
    event.providerTenantId,
    event.channel.id,
    event.threadId,
    identity.orgId,
  );
  if (lookup.status === "fail_closed") {
    // ACTIVE 行校验失败 / DB 源不可用：fail closed，对外统一 CONTEXT_UNRESOLVED，
    // 绝不 fallback channel / fixture（B4：损坏的 thread override 不得被绕过）
    return { ok: false, code: "CONTEXT_UNRESOLVED", reason: "binding_lookup_failed" };
  }
  if (lookup.status === "none") {
    return { ok: false, code: "CONTEXT_UNRESOLVED", reason: "no_binding" };
  }
  const binding = lookup.binding;
  if (!verifyBindingOrganization(binding, identity.orgId)) {
    return {
      ok: false,
      code: "CHANNEL_ORG_MISMATCH",
      reason: "binding_org_mismatch",
    };
  }

  const scopeInput = bindingToScopeInput(
    binding,
    { userId: identity.user.id, role: identity.user.role, orgId: identity.orgId },
    { threadId: event.threadId, ...extra },
  );
  if (!scopeInput) {
    return { ok: false, code: "CONTEXT_UNRESOLVED", reason: "binding_invalid" };
  }

  const scoped = await deps.resolveAgentScope(scopeInput);
  if (!scoped.ok) {
    return {
      ok: false,
      code: "SCOPE_DENIED",
      reason: "scope_denied",
      scopeCode: scoped.code,
    };
  }
  if (scoped.scope.orgId !== identity.orgId || scoped.scope.hasMembership !== true) {
    return { ok: false, code: "SCOPE_DENIED", reason: "scope_org_mismatch" };
  }
  // 业务对象必须真正落到 scope 上（project/tender → projectId；sales → customerId）
  const objectBound =
    binding.contextType === "sales"
      ? scoped.scope.customerId === binding.contextId
      : scoped.scope.projectId === binding.contextId;
  if (!objectBound) {
    return { ok: false, code: "SCOPE_DENIED", reason: "scope_denied" };
  }

  let contextBlock = "";
  try {
    contextBlock = await deps.buildContextBlock({ binding, orgId: identity.orgId });
  } catch {
    contextBlock = "";
  }

  return { ok: true, context: { binding, scope: scoped.scope, contextBlock } };
}

/** 真实依赖（懒加载） */
export function createDefaultContextDeps(input: {
  lookupChannelBinding: ContextDeps["lookupChannelBinding"];
}): ContextDeps {
  return {
    lookupChannelBinding: input.lookupChannelBinding,
    async resolveAgentScope(scopeInput) {
      const { resolveAgentScope } = await import("@/lib/agent-scope/resolve");
      return resolveAgentScope(scopeInput);
    },
    async buildContextBlock({ binding, orgId }) {
      if (binding.contextType === "sales") return "";
      const { buildProjectAiContextBlock } = await import(
        "@/lib/projects/project-ai-context"
      );
      const block = await buildProjectAiContextBlock(binding.contextId, {
        light: true,
        expectedOrgId: orgId,
      });
      return (block ?? "").slice(0, 6000);
    },
  };
}
