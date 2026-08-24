/**
 * Mention Gateway — M1 Fixture（内存 / 环境变量；不落库、无 migration）
 *
 * fixture 只负责两件事，且都只是「声明」：
 *   1. externalUserId → 青砚 userId   （不产生 membership / role / orgId）
 *   2. channelId(+threadId) → ChannelContextBinding（organizationId 必须被复验）
 *
 * 真实 membership / organization / role 由 identity.ts 经 resolveAgentTenant 查询；
 * binding.organizationId 由 context.ts 与用户真实 org 比对（不同 → CHANNEL_ORG_MISMATCH）。
 *
 * 加载来源：
 *   - 代码注册（测试）：registerMockIdentity / registerMockChannelBinding
 *   - 环境变量（开发 / Preview）：MENTION_GATEWAY_MOCK_FIXTURE_JSON
 *     { "identities": [{ "externalUserId": "mock-user-1", "userId": "<User.id>" }],
 *       "bindings":   [{ "channelId": "mock-project-1", "threadId"?: "...",
 *                        "organizationId": "<Organization.id>",
 *                        "contextType": "project" | "tender" | "sales", "contextId": "<id>" }] }
 */

import { z } from "zod";
import type { ChannelContextBinding, MentionProvider } from "./types";

export interface MentionIdentityFixture {
  provider: MentionProvider;
  /** M2-A：provider 租户边界；mock 缺省 "mock" */
  providerTenantId?: string;
  externalUserId: string;
  userId: string;
}

const IdentityFixtureSchema = z.object({
  provider: z.literal("mock").optional(),
  providerTenantId: z.string().min(1).max(128).optional(),
  externalUserId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
});

const BindingFixtureSchema = z.object({
  provider: z.literal("mock").optional(),
  channelId: z.string().min(1).max(128),
  threadId: z.string().min(1).max(128).optional(),
  organizationId: z.string().min(1).max(128),
  contextType: z.enum(["project", "tender", "sales"]),
  contextId: z.string().min(1).max(128),
});

export const MentionFixtureSetSchema = z.object({
  identities: z.array(IdentityFixtureSchema).max(200).default([]),
  bindings: z.array(BindingFixtureSchema).max(200).default([]),
});

export type MentionFixtureSet = z.infer<typeof MentionFixtureSetSchema>;

function identityKey(
  provider: string,
  providerTenantId: string,
  externalUserId: string,
): string {
  return `${provider}:${providerTenantId}:${externalUserId}`;
}

function bindingKey(
  provider: string,
  channelId: string,
  threadId: string | undefined,
): string {
  return `${provider}:${channelId}:${threadId ?? "-"}`;
}

/** 内存 fixture 存储（可多实例，便于测试隔离） */
export class MentionFixtureStore {
  private identities = new Map<string, MentionIdentityFixture>();
  private bindings = new Map<string, ChannelContextBinding>();

  registerIdentity(fixture: MentionIdentityFixture): void {
    this.identities.set(
      identityKey(
        fixture.provider,
        fixture.providerTenantId ?? "mock",
        fixture.externalUserId,
      ),
      fixture,
    );
  }

  registerBinding(binding: ChannelContextBinding): void {
    this.bindings.set(
      bindingKey(binding.provider, binding.channelId, binding.threadId),
      binding,
    );
  }

  /**
   * 只返回 userId + test-safe 身份语义（fixture 视为已验证 ACTIVE，仅存在于非生产 mock 流）；
   * 不返回任何 org / role / membership —— 这些仍由真实查询推导。
   */
  lookupIdentity(
    provider: MentionProvider,
    providerTenantId: string,
    externalUserId: string,
  ): {
    userId: string;
    status: "ACTIVE";
    verificationMethod: "ADMIN_PROVISIONED";
  } | null {
    const hit = this.identities.get(
      identityKey(provider, providerTenantId, externalUserId),
    );
    return hit
      ? {
          userId: hit.userId,
          status: "ACTIVE",
          verificationMethod: "ADMIN_PROVISIONED",
        }
      : null;
  }

  /** 线程级绑定优先，其次频道级；都没有 → null（上层 → CONTEXT_UNRESOLVED） */
  lookupBinding(
    provider: MentionProvider,
    channelId: string,
    threadId?: string,
  ): ChannelContextBinding | null {
    if (threadId) {
      const thread = this.bindings.get(bindingKey(provider, channelId, threadId));
      if (thread) return { ...thread };
    }
    const channel = this.bindings.get(bindingKey(provider, channelId, undefined));
    return channel ? { ...channel } : null;
  }

  loadSet(set: MentionFixtureSet): void {
    for (const id of set.identities) {
      this.registerIdentity({
        provider: id.provider ?? "mock",
        providerTenantId: id.providerTenantId ?? "mock",
        externalUserId: id.externalUserId,
        userId: id.userId,
      });
    }
    for (const b of set.bindings) {
      this.registerBinding({
        provider: b.provider ?? "mock",
        channelId: b.channelId,
        threadId: b.threadId,
        organizationId: b.organizationId,
        contextType: b.contextType,
        contextId: b.contextId,
      });
    }
  }

  clear(): void {
    this.identities.clear();
    this.bindings.clear();
  }

  size(): { identities: number; bindings: number } {
    return { identities: this.identities.size, bindings: this.bindings.size };
  }
}

/** 进程级默认存储（Mock API 使用） */
const defaultStore = new MentionFixtureStore();

export function getDefaultMentionFixtureStore(): MentionFixtureStore {
  return defaultStore;
}

export function registerMockIdentity(fixture: MentionIdentityFixture): void {
  defaultStore.registerIdentity(fixture);
}

export function registerMockChannelBinding(binding: ChannelContextBinding): void {
  defaultStore.registerBinding(binding);
}

export function clearMockFixtures(): void {
  defaultStore.clear();
}

/**
 * 解析环境变量 fixture；非法 JSON / 不符合 schema → 返回 null（不抛，不加载任何条目）。
 */
export function parseMentionFixtureJson(raw: string | undefined): MentionFixtureSet | null {
  if (!raw || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = MentionFixtureSetSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

let envFixtureLoaded = false;

/** 幂等：只在首次调用时从 env 加载进默认存储 */
export function loadMockFixturesFromEnv(
  env: Record<string, string | undefined> = process.env,
  store: MentionFixtureStore = defaultStore,
): { loaded: boolean; identities: number; bindings: number } {
  if (store === defaultStore && envFixtureLoaded) {
    const size = store.size();
    return { loaded: false, ...size };
  }
  const set = parseMentionFixtureJson(env.MENTION_GATEWAY_MOCK_FIXTURE_JSON);
  if (store === defaultStore) envFixtureLoaded = true;
  if (!set) {
    const size = store.size();
    return { loaded: false, ...size };
  }
  store.loadSet(set);
  const size = store.size();
  return { loaded: true, ...size };
}
