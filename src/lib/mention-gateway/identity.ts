/**
 * Mention Gateway — Identity Resolver（M1）
 *
 *   externalUserId ──fixture──▶ userId ──DB──▶ User(active)
 *     ──DB──▶ active memberships ──▶ orgId（activeOrg ∈ memberships，或唯一 membership）
 *     ──resolveAgentTenant──▶ orgRole / hasMembership / modulesJson / toolPolicy / workspaceIds
 *
 * 任一环节失败 → IDENTITY_OR_MEMBERSHIP_DENIED（fail-closed）。
 * 本文件不得构造 hasMembership / role / orgId；全部来自查询结果。
 * 所有查询只读（不写 activeOrgId，不写 binding）。
 */

import type { AgentTenantResolved } from "@/lib/tenancy/resolve-agent-tenant";
import { VERIFIED_IDENTITY_METHODS } from "./types";
import type { MentionEvent, MentionProvider } from "./types";

export interface MentionUserRecord {
  id: string;
  role: string;
  name: string | null;
  status: string;
  activeOrgId: string | null;
}

/** 身份查找结果（M2-A）：DB 源必须带真实 status / method；fixture 源返回 test-safe ACTIVE 语义 */
export interface ExternalIdentityLookup {
  userId: string;
  /** 缺省视为 fixture test-safe（等价 ACTIVE）；DB 源恒为真实值 */
  status?: string;
  verificationMethod?: string | null;
}

export interface IdentityDeps {
  /** fixture / DB：外部三元组 → 身份记录（只读，不更新 lastSeenAt） */
  lookupExternalIdentity(
    provider: MentionProvider,
    providerTenantId: string,
    externalUserId: string,
  ): Promise<ExternalIdentityLookup | null>;
  loadUser(userId: string): Promise<MentionUserRecord | null>;
  /** 用户的 active OrganizationMember（org 未归档）的 orgId 列表 —— 不含平台管理员特权视角 */
  listActiveMembershipOrgIds(userId: string): Promise<string[]>;
  resolveAgentTenant(
    user: { id: string; role: string },
    orgId: string,
  ): Promise<AgentTenantResolved | { error: string; status: number }>;
}

export interface ResolvedMentionIdentity {
  user: MentionUserRecord;
  orgId: string;
  tenant: AgentTenantResolved;
}

export type IdentityDenyReason =
  | "unknown_external_user"
  | "identity_not_active"
  | "identity_unverified"
  | "identity_lookup_error"
  | "user_not_found"
  | "user_inactive"
  | "caller_mismatch"
  | "no_active_membership"
  | "org_ambiguous"
  | "tenant_error"
  | "no_membership";

export type ResolveMentionIdentityResult =
  | { ok: true; identity: ResolvedMentionIdentity }
  | {
      ok: false;
      code: "IDENTITY_OR_MEMBERSHIP_DENIED";
      /** 内部原因（仅日志；不得回传给调用方） */
      reason: IdentityDenyReason;
    };

export interface ResolveMentionIdentityOptions {
  /**
   * Mock API 的调用者（已登录用户）。非平台管理员时，fixture 解析出的用户
   * 必须等于调用者本人（防止借 fixture 冒充他人）。
   */
  caller?: { userId: string; isPlatformAdmin: boolean };
  /**
   * M2-A：要求已验证身份（缺省 true，安全默认）。
   * true 时 `verificationMethod === "LEGACY_SELF_ASSERTED"` 的 ACTIVE 身份仍拒绝。
   */
  requireVerifiedIdentity?: boolean;
}

function deny(reason: IdentityDenyReason): ResolveMentionIdentityResult {
  return { ok: false, code: "IDENTITY_OR_MEMBERSHIP_DENIED", reason };
}

/** 纯函数：从真实 membership 列表与 activeOrgId 选出唯一 org；不确定即 null */
export function pickMembershipOrg(
  membershipOrgIds: readonly string[],
  activeOrgId: string | null,
): { orgId: string } | { orgId: null; reason: "no_active_membership" | "org_ambiguous" } {
  if (membershipOrgIds.length === 0) {
    return { orgId: null, reason: "no_active_membership" };
  }
  if (activeOrgId && membershipOrgIds.includes(activeOrgId)) {
    return { orgId: activeOrgId };
  }
  if (membershipOrgIds.length === 1) {
    return { orgId: membershipOrgIds[0] };
  }
  return { orgId: null, reason: "org_ambiguous" };
}

export async function resolveMentionIdentity(
  event: MentionEvent,
  deps: IdentityDeps,
  options: ResolveMentionIdentityOptions = {},
): Promise<ResolveMentionIdentityResult> {
  let mapped: ExternalIdentityLookup | null;
  try {
    mapped = await deps.lookupExternalIdentity(
      event.provider,
      event.providerTenantId,
      event.externalUserId,
    );
  } catch {
    // DB 源不可用 → fail closed，绝不 fallback fixture（对外统一 DENY，不泄漏内部状态）
    return deny("identity_lookup_error");
  }
  if (!mapped?.userId) return deny("unknown_external_user");

  // M2-A：持久化身份的状态门（fixture 源返回 test-safe ACTIVE，同一路径统一执行）
  if (mapped.status !== undefined && mapped.status !== "ACTIVE") {
    return deny("identity_not_active");
  }
  // B4 fail-closed：持久身份（带 status 的形状）在 REQUIRE_VERIFIED 下必须
  // ACTIVE 且 method ∈ VERIFIED_IDENTITY_METHODS 白名单——
  // ACTIVE+null 与 ACTIVE+LEGACY_SELF_ASSERTED 一律拒绝（不再用「黑名单 LEGACY」判定）。
  const requireVerified = options.requireVerifiedIdentity ?? true;
  if (requireVerified && mapped.status !== undefined) {
    const method = mapped.verificationMethod ?? null;
    if (
      method === null ||
      !(VERIFIED_IDENTITY_METHODS as readonly string[]).includes(method)
    ) {
      return deny("identity_unverified");
    }
  }

  const caller = options.caller;
  if (caller && !caller.isPlatformAdmin && caller.userId !== mapped.userId) {
    return deny("caller_mismatch");
  }

  const user = await deps.loadUser(mapped.userId);
  if (!user) return deny("user_not_found");
  if (user.status !== "active") return deny("user_inactive");

  const membershipOrgIds = await deps.listActiveMembershipOrgIds(user.id);
  const picked = pickMembershipOrg(membershipOrgIds, user.activeOrgId);
  if (picked.orgId === null) return deny(picked.reason);

  const tenant = await deps.resolveAgentTenant(
    { id: user.id, role: user.role },
    picked.orgId,
  );
  if ("error" in tenant) return deny("tenant_error");
  if (tenant.hasMembership !== true) return deny("no_membership");
  if (tenant.orgId !== picked.orgId) return deny("tenant_error");

  return { ok: true, identity: { user, orgId: tenant.orgId, tenant } };
}

/** 真实依赖（懒加载，避免测试导入时拉起 DB 模块） */
export function createDefaultIdentityDeps(input: {
  lookupExternalIdentity: IdentityDeps["lookupExternalIdentity"];
}): IdentityDeps {
  return {
    lookupExternalIdentity: input.lookupExternalIdentity,
    async loadUser(userId) {
      const { db } = await import("@/lib/db");
      const row = await db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          name: true,
          status: true,
          activeOrgId: true,
        },
      });
      return row ?? null;
    },
    async listActiveMembershipOrgIds(userId) {
      const { db } = await import("@/lib/db");
      const rows = await db.organizationMember.findMany({
        where: {
          userId,
          status: "active",
          org: { status: { not: "archived" } },
        },
        select: { orgId: true },
      });
      return rows.map((r) => r.orgId);
    },
    async resolveAgentTenant(user, orgId) {
      const { resolveAgentTenant } = await import(
        "@/lib/tenancy/resolve-agent-tenant"
      );
      return resolveAgentTenant(user, orgId);
    },
  };
}
