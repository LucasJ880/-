/**
 * Mention Gateway 测试夹具：全部依赖注入，不触达 DB / 模型 / 网络。
 */

import type { AgentRunOptions, AgentRunResult } from "@/lib/agent-core/types";
import type { AgentScopeContext } from "@/lib/agent-scope/types";
import type { AgentTenantResolved } from "@/lib/tenancy/resolve-agent-tenant";
import { MockChannelAdapter } from "../adapters/mock";
import { DuplicateEventGuard, type MentionGatewayDeps } from "../handle";
import type { IdentityDeps, MentionUserRecord } from "../identity";
import type { ContextDeps } from "../context";
import type { ChannelContextBinding, MentionGatewayErrorCode } from "../types";

export const ORG_A = "org_a";
export const ORG_B = "org_b";
export const USER_A = "user_a"; // Org A 成员（org_member）
export const USER_B = "user_b"; // Org B 成员
export const USER_NO_ORG = "user_no_org"; // 有账号，无 membership
export const USER_INACTIVE_MEMBER = "user_inactive_member"; // membership 已停用
export const USER_DISABLED = "user_disabled"; // 账号停用
export const USER_MULTI = "user_multi"; // A+B 双 org，activeOrgId 指向 A
export const PROJECT_A = "project_a"; // 属 Org A
export const PROJECT_B = "project_b"; // 属 Org B
export const CUSTOMER_A = "customer_a"; // 属 Org A

export const TEST_ENV = {
  MENTION_GATEWAY_ENABLED: "1",
  MENTION_GATEWAY_MOCK_ENABLED: "1",
  NODE_ENV: "test",
} as const;

export let pass = 0;
export let fail = 0;

export function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

export function finish(title: string) {
  console.log("");
  console.log(`${title} 结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

export type Call = { name: string; args: unknown[] };

export interface FakeWorld {
  users: Record<string, MentionUserRecord>;
  /** userId → active membership orgIds */
  memberships: Record<string, string[]>;
  /** fixture：externalUserId → userId */
  identities: Record<string, string>;
  bindings: Record<string, ChannelContextBinding>;
  projects: Record<string, { orgId: string; ownerId: string | null }>;
  customers: Record<string, { orgId: string; createdById: string }>;
}

export function defaultWorld(): FakeWorld {
  return {
    users: {
      [USER_A]: { id: USER_A, role: "sales", name: "Alice", status: "active", activeOrgId: ORG_A },
      [USER_B]: { id: USER_B, role: "sales", name: "Bob", status: "active", activeOrgId: ORG_B },
      [USER_NO_ORG]: { id: USER_NO_ORG, role: "user", name: "Nora", status: "active", activeOrgId: null },
      [USER_INACTIVE_MEMBER]: { id: USER_INACTIVE_MEMBER, role: "sales", name: "Ian", status: "active", activeOrgId: ORG_A },
      [USER_DISABLED]: { id: USER_DISABLED, role: "sales", name: "Dan", status: "disabled", activeOrgId: ORG_A },
      [USER_MULTI]: { id: USER_MULTI, role: "sales", name: "Mia", status: "active", activeOrgId: ORG_A },
    },
    memberships: {
      [USER_A]: [ORG_A],
      [USER_B]: [ORG_B],
      [USER_NO_ORG]: [],
      [USER_INACTIVE_MEMBER]: [], // 停用后的 membership 不再是 active
      [USER_DISABLED]: [ORG_A],
      [USER_MULTI]: [ORG_A, ORG_B],
    },
    identities: {
      "mock-user-a": USER_A,
      "mock-user-b": USER_B,
      "mock-user-no-org": USER_NO_ORG,
      "mock-user-inactive-member": USER_INACTIVE_MEMBER,
      "mock-user-disabled": USER_DISABLED,
      "mock-user-multi": USER_MULTI,
    },
    bindings: {
      "mock:mock-project-a:-": {
        provider: "mock",
        channelId: "mock-project-a",
        organizationId: ORG_A,
        contextType: "project",
        contextId: PROJECT_A,
      },
      "mock:mock-project-b:-": {
        provider: "mock",
        channelId: "mock-project-b",
        organizationId: ORG_B,
        contextType: "project",
        contextId: PROJECT_B,
      },
      // 声明 Org A，但对象其实属于 Org B（跨租户上下文）
      "mock:mock-cross-tenant:-": {
        provider: "mock",
        channelId: "mock-cross-tenant",
        organizationId: ORG_A,
        contextType: "project",
        contextId: PROJECT_B,
      },
      // 绑定指向不存在的项目
      "mock:mock-missing-project:-": {
        provider: "mock",
        channelId: "mock-missing-project",
        organizationId: ORG_A,
        contextType: "project",
        contextId: "project_missing",
      },
      "mock:mock-sales-a:-": {
        provider: "mock",
        channelId: "mock-sales-a",
        organizationId: ORG_A,
        contextType: "sales",
        contextId: CUSTOMER_A,
      },
      "mock:mock-project-a:thread-1": {
        provider: "mock",
        channelId: "mock-project-a",
        threadId: "thread-1",
        organizationId: ORG_A,
        contextType: "tender",
        contextId: PROJECT_A,
      },
    },
    projects: {
      [PROJECT_A]: { orgId: ORG_A, ownerId: USER_A },
      [PROJECT_B]: { orgId: ORG_B, ownerId: USER_B },
    },
    customers: {
      [CUSTOMER_A]: { orgId: ORG_A, createdById: USER_A },
    },
  };
}

export function fakeTenant(orgId: string, overrides?: Partial<AgentTenantResolved>): AgentTenantResolved {
  return {
    orgId,
    orgRole: "org_member",
    hasMembership: true,
    isPlatformAdmin: false,
    modulesJson: null,
    industryPackId: null,
    workspaceIds: [],
    toolPolicy: {} as AgentTenantResolved["toolPolicy"],
    ...overrides,
  };
}

export interface FakeDepsResult {
  deps: MentionGatewayDeps;
  calls: Call[];
  adapter: MockChannelAdapter;
  runOptions: AgentRunOptions[];
  events: { eventType: string; payload?: Record<string, unknown> }[];
  world: FakeWorld;
}

export function makeFakeDeps(options?: {
  world?: FakeWorld;
  runAgent?: (opts: AgentRunOptions) => Promise<AgentRunResult>;
  createRunReused?: (userMessageId: string) => boolean;
}): FakeDepsResult {
  const world = options?.world ?? defaultWorld();
  const calls: Call[] = [];
  const runOptions: AgentRunOptions[] = [];
  const events: { eventType: string; payload?: Record<string, unknown> }[] = [];
  const record = (name: string, ...args: unknown[]) => {
    calls.push({ name, args });
  };
  const seenUserMessageIds = new Set<string>();
  let runSeq = 0;

  const identity: IdentityDeps = {
    async lookupExternalIdentity(provider, externalUserId) {
      record("lookupExternalIdentity", provider, externalUserId);
      const userId = world.identities[externalUserId];
      return userId ? { userId } : null;
    },
    async loadUser(userId) {
      record("loadUser", userId);
      return world.users[userId] ?? null;
    },
    async listActiveMembershipOrgIds(userId) {
      record("listActiveMembershipOrgIds", userId);
      return world.memberships[userId] ?? [];
    },
    async resolveAgentTenant(user, orgId) {
      record("resolveAgentTenant", user, orgId);
      const active = (world.memberships[user.id] ?? []).includes(orgId);
      // 与真实 resolveAgentTenant 一致：无 active membership → hasMembership=false，orgRole 退化 viewer
      return fakeTenant(orgId, {
        hasMembership: active,
        orgRole: active ? "org_member" : "org_viewer",
        isPlatformAdmin: user.role === "admin" || user.role === "super_admin",
      });
    },
  };

  const context: ContextDeps = {
    async lookupChannelBinding(provider, channelId, threadId) {
      record("lookupChannelBinding", provider, channelId, threadId);
      const thread = threadId ? world.bindings[`${provider}:${channelId}:${threadId}`] : undefined;
      const channel = world.bindings[`${provider}:${channelId}:-`];
      const hit = thread ?? channel;
      return hit ? { ...hit } : null;
    },
    async resolveAgentScope(input) {
      record("resolveAgentScope", input);
      const member = (world.memberships[input.user.id] ?? []).includes(input.orgId);
      if (!member) {
        return { ok: false, code: "no_membership", error: "no membership", status: 403 };
      }
      let projectId: string | undefined;
      let projectRole: string | undefined;
      if (input.projectId) {
        const p = world.projects[input.projectId];
        if (!p) return { ok: false, code: "invalid_project", error: "项目不存在", status: 404 };
        if (p.orgId !== input.orgId) {
          return { ok: false, code: "project_org_mismatch", error: "项目不存在", status: 404 };
        }
        projectId = input.projectId;
        projectRole = p.ownerId === input.user.id ? "owner" : "org";
      }
      let customerId: string | undefined;
      if (input.customerId) {
        const c = world.customers[input.customerId];
        if (!c) return { ok: false, code: "invalid_customer", error: "客户不存在", status: 404 };
        if (c.orgId !== input.orgId) {
          return { ok: false, code: "customer_org_mismatch", error: "客户不存在", status: 404 };
        }
        customerId = input.customerId;
      }
      const scope: AgentScopeContext = {
        principalUserId: input.user.id,
        principalPlatformRole: input.user.role,
        orgId: input.orgId,
        orgRole: "org_member",
        isPlatformAdmin: false,
        hasMembership: true,
        projectId,
        projectRole,
        customerId,
        threadId: input.threadId ?? undefined,
        channel: input.channel,
        traceId: "trace-test",
        sessionId: input.sessionId ?? undefined,
        agentRunId: input.agentRunId ?? undefined,
      };
      return { ok: true, scope };
    },
    async buildContextBlock({ binding }) {
      record("buildContextBlock", binding.contextType, binding.contextId);
      return binding.contextType === "sales" ? "" : `项目上下文块(${binding.contextId})`;
    },
  };

  const adapter = new MockChannelAdapter(() => new Date("2026-08-22T12:00:00Z"));

  const deps: MentionGatewayDeps = {
    identity,
    context,
    runtime: {
      async getOrCreateSession(key) {
        record("getOrCreateSession", key);
        return { id: `sess:${key.channelConversationId}` };
      },
      async createRun(input) {
        record("createRun", input);
        const reused =
          options?.createRunReused?.(input.userMessageId) ??
          seenUserMessageIds.has(input.userMessageId);
        if (reused) return { run: { id: "run-reused" }, reused: true };
        seenUserMessageIds.add(input.userMessageId);
        runSeq += 1;
        return { run: { id: `run-${runSeq}` }, reused: false };
      },
      async appendEvent(input) {
        record("appendEvent", input.eventType);
        events.push({ eventType: input.eventType, payload: input.payload });
      },
      async emitOutput(input) {
        record("emitOutput", input.runId);
        events.push({ eventType: "agent.output", payload: { bytes: input.output.length } });
      },
      async updateRunStatus(orgId, runId, status, patch) {
        record("updateRunStatus", orgId, runId, status, patch);
      },
      async completeRun(orgId, runId) {
        record("completeRun", orgId, runId);
      },
      async failRun(orgId, runId, error) {
        record("failRun", orgId, runId, error);
      },
      async runAgent(opts) {
        record("runAgent", opts.tools, opts.maxRisk);
        runOptions.push(opts);
        if (options?.runAgent) return options.runAgent(opts);
        return { content: "这是只读回复", toolCalls: [], model: "fake", rounds: 1 };
      },
    },
    duplicateGuard: new DuplicateEventGuard(),
    now: () => new Date("2026-08-22T12:00:00Z"),
  };

  return { deps, calls, adapter, runOptions, events, world };
}

export function baseRaw(overrides?: Record<string, unknown>) {
  return {
    eventId: "evt-001",
    messageId: "msg-001",
    externalUserId: "mock-user-a",
    channelId: "mock-project-a",
    text: "@Qingyan 这个项目今天有什么需要处理？",
    ...overrides,
  };
}

export function called(calls: Call[], name: string): number {
  return calls.filter((c) => c.name === name).length;
}

export function isCode(
  result: { ok: boolean; code?: MentionGatewayErrorCode },
  code: MentionGatewayErrorCode,
): boolean {
  return result.ok === false && result.code === code;
}
