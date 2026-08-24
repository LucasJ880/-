/**
 * Mention Gateway M2-A — ExternalIdentity Lifecycle Service
 *
 * 唯一写入口（API 路由是薄壳；AI / runtime 绝不调用写函数）。
 *
 * 冻结的安全语义：
 * - SELF_LINK = DEFERRED（M3）：没有 proof-of-possession 前不提供自助 link，
 *   防止 identity-key squatting / DoS。
 * - NO BLIND UPSERT：唯一键已被其它用户占用 → CONFLICT，绝不改写 userId；
 *   状态迁移全部显式（verify / relink / disable / enable / revoke）。
 * - ACTIVE 前必过 Provider Tenant Ownership Gate（不可由 body 声明归属）。
 * - EXTERNAL_IDENTITY_DOES_NOT_GRANT_ORG_ACCESS：本服务不写任何 org 授权；
 *   Mention 运行期仍走 user → active OrganizationMember → resolveAgentTenant。
 * - 安全关键写全部 db.$transaction + writeAuditLog(tx)（审计失败 → 整体回滚）。
 * - REVOKED 终态：恢复只能显式 relink；不 physical delete。
 */

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit/logger";
import { PERMISSIONS, hasOrgPermission } from "@/lib/rbac/permissions";
import {
  createDefaultOwnershipDeps,
  resolveProviderTenantOwnership,
  type OwnershipDeps,
} from "./provider-tenant-ownership";
import { EXTERNAL_IDENTITY_PROVIDERS } from "./types";

export interface ExternalIdentityRecord {
  id: string;
  provider: string;
  providerTenantId: string;
  providerUserId: string;
  userId: string;
  status: string;
  verificationMethod: string | null;
  verifiedAt: Date | null;
  verifiedById: string | null;
  linkedAt: Date;
  linkedById: string | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  revokedById: string | null;
  revokeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IdentityServiceErrorCode =
  | "INVALID_PROVIDER"
  | "INVALID_KEY"
  | "PROVIDER_TENANT_UNVERIFIED"
  | "CALLER_FORBIDDEN"
  | "TARGET_USER_NOT_FOUND"
  | "TARGET_USER_INACTIVE"
  | "TARGET_NOT_MEMBER"
  | "IDENTITY_ALREADY_CLAIMED"
  | "IDENTITY_NOT_FOUND"
  | "INVALID_STATE"
  | "IDENTITY_STATE_CHANGED"
  | "OLD_USER_NOT_MANAGEABLE";

export type IdentityServiceResult =
  | { ok: true; identity: ExternalIdentityRecord; outcome: string }
  | { ok: false; code: IdentityServiceErrorCode; message: string };

export interface IdentityServiceCaller {
  userId: string;
  role: string;
}

// ── 纯函数（可单测，无 DB）────────────────────────────────────────────────

/** providerUserId 不以 raw 形态长期进入 AuditLog / 日志：sha256 截断表示 */
export function hashProviderUserId(providerUserId: string): string {
  return createHash("sha256").update(providerUserId).digest("hex").slice(0, 16);
}

export function normalizeIdentityKey(input: {
  provider: string;
  providerTenantId: string;
  providerUserId: string;
}):
  | {
      ok: true;
      provider: string;
      providerTenantId: string;
      providerUserId: string;
    }
  | { ok: false; code: "INVALID_PROVIDER" | "INVALID_KEY" } {
  const provider = (input.provider ?? "").trim();
  const providerTenantId = (input.providerTenantId ?? "").trim();
  const providerUserId = (input.providerUserId ?? "").trim();
  if (!(EXTERNAL_IDENTITY_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, code: "INVALID_PROVIDER" };
  }
  if (!providerTenantId || !providerUserId) {
    return { ok: false, code: "INVALID_KEY" };
  }
  return { ok: true, provider, providerTenantId, providerUserId };
}

export type ProvisionOutcome =
  | "CREATE"
  | "IDEMPOTENT"
  | "NEEDS_VERIFY"
  | "NEEDS_ENABLE"
  | "NEEDS_RELINK"
  | "CONFLICT";

/**
 * §14 唯一键语义：绝不 upsert → change userId。
 * 已存在且属其它用户 → CONFLICT（DB 不修改，不向 caller 泄露 existing userId）。
 */
export function decideProvisionOutcome(
  existing: {
    userId: string;
    status: string;
    verificationMethod: string | null;
  } | null,
  targetUserId: string,
): ProvisionOutcome {
  if (!existing) return "CREATE";
  if (existing.userId !== targetUserId) return "CONFLICT";
  if (existing.status === "REVOKED") return "NEEDS_RELINK";
  if (existing.status === "DISABLED") return "NEEDS_ENABLE";
  if (existing.status === "PENDING") return "NEEDS_VERIFY";
  // ACTIVE
  if (existing.verificationMethod === "ADMIN_PROVISIONED") return "IDEMPOTENT";
  // ACTIVE + LEGACY_SELF_ASSERTED（或未来 provider 方法）→ 显式 verify 升级，不 silent takeover
  return "NEEDS_VERIFY";
}

function err(
  code: IdentityServiceErrorCode,
  message: string,
): { ok: false; code: IdentityServiceErrorCode; message: string } {
  return { ok: false, code, message };
}

// ── B1 Optimistic CAS（TOCTOU 防线）────────────────────────────────────────
//
// 所有生命周期 mutation 均为 read → validate → compare-and-set：
// WHERE id + userId + status + verificationMethod + updatedAt 与读到的快照完全一致
// 才允许写。期间任何并发变更（revoke / relink / verify 升级…）→ 命中数 ≠ 1
// → IDENTITY_STATE_CHANGED（409），不写 AuditLog，调用方需重新读取后再操作。
// 尤其保证：REVOKED 终态不可被 stale 请求覆盖；relink 到新用户后，
// 旧 owner 的 stale self-revoke（快照里的旧 userId 不再匹配）必然 CAS FAIL。

export interface IdentityTransitionPlan {
  /** 事务外读取的完整快照；CAS WHERE 由此构造 */
  before: ExternalIdentityRecord;
  /** 要写入的字段 */
  data: {
    status?: string;
    verificationMethod?: string | null;
    userId?: string;
    verifiedAt?: Date | null;
    verifiedById?: string | null;
    linkedAt?: Date;
    linkedById?: string | null;
    revokedAt?: Date | null;
    revokedById?: string | null;
    revokeReason?: string | null;
  };
  outcome: string;
  audit: {
    callerUserId: string;
    orgId: string | null;
    action: string;
    afterExtra?: Record<string, unknown>;
  };
}

/**
 * 提交一次 CAS 状态迁移（写 + 审计同事务；审计失败整体回滚）。
 * 快照过期 → IDENTITY_STATE_CHANGED，零写入、零审计。
 */
export async function commitIdentityTransition(
  plan: IdentityTransitionPlan,
): Promise<IdentityServiceResult> {
  const { db } = await import("@/lib/db");
  const casMiss = Symbol("cas-miss");
  try {
    const updated = await db.$transaction(async (tx) => {
      const hit = await tx.externalIdentity.updateMany({
        where: {
          id: plan.before.id,
          userId: plan.before.userId,
          status: plan.before.status,
          verificationMethod: plan.before.verificationMethod,
          updatedAt: plan.before.updatedAt,
        },
        data: plan.data,
      });
      if (hit.count !== 1) {
        // 并发修改赢了：本次请求基于陈旧状态，禁止覆盖
        throw casMiss;
      }
      const row = await tx.externalIdentity.findUniqueOrThrow({
        where: { id: plan.before.id },
      });
      await writeAuditLog(tx, {
        userId: plan.audit.callerUserId,
        orgId: plan.audit.orgId,
        action: plan.audit.action,
        targetType: "external_identity",
        targetId: row.id,
        beforeData: auditPayload(plan.before),
        afterData: { ...auditPayload(row), ...(plan.audit.afterExtra ?? {}) },
      });
      return row;
    });
    return { ok: true, identity: updated, outcome: plan.outcome };
  } catch (e) {
    if (e === casMiss) {
      return err(
        "IDENTITY_STATE_CHANGED",
        "身份状态在操作期间已被并发修改，请重新读取后再操作",
      );
    }
    throw e;
  }
}

// ── DB helpers（服务内二次校验；route 守卫之外的 server authority）──────────

async function assertCallerCanManageOrg(
  callerUserId: string,
  managementOrgId: string,
): Promise<{ ok: true; orgRole: string } | { ok: false }> {
  const { db } = await import("@/lib/db");
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId: managementOrgId, userId: callerUserId } },
    select: { role: true, status: true },
  });
  if (!membership || membership.status !== "active") return { ok: false };
  if (!hasOrgPermission(membership.role, PERMISSIONS.ORG_MEMBER_ROLE_CHANGE)) {
    return { ok: false };
  }
  return { ok: true, orgRole: membership.role };
}

/**
 * P1 existence-safe：先按 managementOrg membership 定位（scoped lookup）。
 * 无 membership 行 → 统一 TARGET_USER_NOT_FOUND（404），不区分「用户不存在」
 * 与「用户存在但属其它 org」——不向 Org A 管理员暴露跨 org 用户存在性。
 * 同 org 事实（membership 停用 / 账号停用）允许区分。
 */
async function loadManageableTargetUser(
  targetUserId: string,
  managementOrgId: string,
): Promise<
  | { ok: true; user: { id: string; status: string } }
  | { ok: false; code: IdentityServiceErrorCode; message: string }
> {
  const { db } = await import("@/lib/db");
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId: managementOrgId, userId: targetUserId } },
    select: { status: true, user: { select: { id: true, status: true } } },
  });
  if (!membership) {
    return err("TARGET_USER_NOT_FOUND", "目标用户不存在或不属于当前组织");
  }
  if (membership.status !== "active") {
    return err("TARGET_NOT_MEMBER", "目标用户不是当前组织的在职成员");
  }
  if (membership.user.status !== "active") {
    return err("TARGET_USER_INACTIVE", "目标用户未激活");
  }
  return { ok: true, user: membership.user };
}

function auditPayload(identity: {
  provider: string;
  providerTenantId: string;
  providerUserId: string;
  userId: string;
  status: string;
  verificationMethod: string | null;
}): Record<string, unknown> {
  return {
    provider: identity.provider,
    providerTenantId: identity.providerTenantId,
    providerUserIdHash: hashProviderUserId(identity.providerUserId),
    userId: identity.userId,
    status: identity.status,
    verificationMethod: identity.verificationMethod,
  };
}

/**
 * B2 canonical management scope：user ∈ org 不等于 identity ∈ org
 * （ExternalIdentity 无 orgId，多 org 用户的身份必须按 provider 租户归属切分）。
 * 管理可见性 = ①identity.userId 是 managementOrg 在职成员
 *            + ②provider 租户归属可证明属于 managementOrg（OWNED / INACTIVE）。
 * MISMATCH / UNPROVEN / AMBIGUOUS / UNSUPPORTED → 视同不存在（404，不泄露存在性）。
 * INACTIVE 可 list / disable / revoke；ACTIVE transition（verify/enable/relink）
 * 在各自函数内仍额外要求 OWNED。
 */
const MANAGEABLE_OWNERSHIP: readonly string[] = ["OWNED", "INACTIVE"];

async function resolveManagementOwnership(
  identity: { provider: string; providerTenantId: string },
  managementOrgId: string,
  ownershipDeps?: OwnershipDeps,
) {
  return resolveProviderTenantOwnership(
    {
      provider: identity.provider,
      providerTenantId: identity.providerTenantId,
      targetOrgId: managementOrgId,
    },
    ownershipDeps ?? createDefaultOwnershipDeps(),
  );
}

async function loadManageableIdentity(
  identityId: string,
  managementOrgId: string,
  ownershipDeps?: OwnershipDeps,
): Promise<ExternalIdentityRecord | null> {
  const { db } = await import("@/lib/db");
  const identity = await db.externalIdentity.findUnique({
    where: { id: identityId },
  });
  if (!identity) return null;
  const membership = await db.organizationMember.findUnique({
    where: {
      orgId_userId: { orgId: managementOrgId, userId: identity.userId },
    },
    select: { status: true },
  });
  if (!membership || membership.status !== "active") return null;
  const ownership = await resolveManagementOwnership(
    identity,
    managementOrgId,
    ownershipDeps,
  );
  if (!MANAGEABLE_OWNERSHIP.includes(ownership)) return null;
  return identity;
}

// ── 只读热路径（Mention resolver 使用；不写 lastSeenAt）─────────────────────

export async function lookupExternalIdentityRecord(
  provider: string,
  providerTenantId: string,
  providerUserId: string,
): Promise<{
  userId: string;
  status: string;
  verificationMethod: string | null;
} | null> {
  const { db } = await import("@/lib/db");
  const row = await db.externalIdentity.findUnique({
    where: {
      provider_providerTenantId_providerUserId: {
        provider,
        providerTenantId,
        providerUserId,
      },
    },
    select: { userId: true, status: true, verificationMethod: true },
  });
  return row ?? null;
}

// ── 生命周期写操作 ──────────────────────────────────────────────────────────

export interface AdminProvisionInput {
  caller: IdentityServiceCaller;
  /** 服务端解析的管理 org（requireTenantContext），绝不来自 body */
  managementOrgId: string;
  provider: string;
  providerTenantId: string;
  providerUserId: string;
  targetUserId: string;
  ownershipDeps?: OwnershipDeps;
}

export async function adminProvisionIdentity(
  input: AdminProvisionInput,
): Promise<IdentityServiceResult> {
  const key = normalizeIdentityKey(input);
  if (!key.ok) return err(key.code, "provider / providerTenantId / providerUserId 不合法");

  const caller = await assertCallerCanManageOrg(
    input.caller.userId,
    input.managementOrgId,
  );
  if (!caller.ok) return err("CALLER_FORBIDDEN", "无成员管理权限");

  const target = await loadManageableTargetUser(
    input.targetUserId,
    input.managementOrgId,
  );
  if (!target.ok) return target;

  // §9/§10：ownership 无法证明 → 不创建任何可抢占唯一键的行（含 PENDING）
  const ownership = await resolveProviderTenantOwnership(
    {
      provider: key.provider,
      providerTenantId: key.providerTenantId,
      targetOrgId: input.managementOrgId,
    },
    input.ownershipDeps ?? createDefaultOwnershipDeps(),
  );
  if (ownership !== "OWNED") {
    return err(
      "PROVIDER_TENANT_UNVERIFIED",
      "provider 租户归属未证明，拒绝创建身份",
    );
  }

  const { db } = await import("@/lib/db");
  const existing = await db.externalIdentity.findUnique({
    where: {
      provider_providerTenantId_providerUserId: {
        provider: key.provider,
        providerTenantId: key.providerTenantId,
        providerUserId: key.providerUserId,
      },
    },
  });
  const outcome = decideProvisionOutcome(existing, input.targetUserId);
  switch (outcome) {
    case "CONFLICT":
      // 不返回 existing userId（不向非授权 caller 泄露映射）
      return err("IDENTITY_ALREADY_CLAIMED", "该外部身份已被占用");
    case "IDEMPOTENT":
      return { ok: true, identity: existing as ExternalIdentityRecord, outcome };
    case "NEEDS_VERIFY":
      return err("INVALID_STATE", "该身份已存在，请使用 verify 完成验证/升级");
    case "NEEDS_ENABLE":
      return err("INVALID_STATE", "该身份已停用，请使用 enable 恢复");
    case "NEEDS_RELINK":
      return err("INVALID_STATE", "该身份已撤销，恢复必须显式 relink");
    case "CREATE":
      break;
  }

  try {
    const now = new Date();
    const identity = await db.$transaction(async (tx) => {
      const created = await tx.externalIdentity.create({
        data: {
          provider: key.provider,
          providerTenantId: key.providerTenantId,
          providerUserId: key.providerUserId,
          userId: input.targetUserId,
          status: "ACTIVE",
          verificationMethod: "ADMIN_PROVISIONED",
          verifiedAt: now,
          verifiedById: input.caller.userId,
          linkedAt: now,
          linkedById: input.caller.userId,
        },
      });
      await writeAuditLog(tx, {
        userId: input.caller.userId,
        orgId: input.managementOrgId,
        action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_PROVISION,
        targetType: "external_identity",
        targetId: created.id,
        afterData: auditPayload(created),
      });
      return created;
    });
    return { ok: true, identity, outcome: "CREATE" };
  } catch (e) {
    // 并发竞态：唯一键已被占用（P2002）→ 与 CONFLICT 同语义，不修改、不泄露
    if ((e as { code?: string })?.code === "P2002") {
      return err("IDENTITY_ALREADY_CLAIMED", "该外部身份已被占用");
    }
    throw e;
  }
}

export interface IdentityMutationInput {
  caller: IdentityServiceCaller;
  managementOrgId: string;
  identityId: string;
  ownershipDeps?: OwnershipDeps;
  reason?: string;
}

/** PENDING → ACTIVE；或 ACTIVE + LEGACY_SELF_ASSERTED → 方法升级（§29）。其余状态显式报错。 */
export async function verifyIdentity(
  input: IdentityMutationInput,
): Promise<IdentityServiceResult> {
  const caller = await assertCallerCanManageOrg(
    input.caller.userId,
    input.managementOrgId,
  );
  if (!caller.ok) return err("CALLER_FORBIDDEN", "无成员管理权限");

  const identity = await loadManageableIdentity(
    input.identityId,
    input.managementOrgId,
    input.ownershipDeps,
  );
  if (!identity) return err("IDENTITY_NOT_FOUND", "身份不存在");

  const upgradableLegacy =
    identity.status === "ACTIVE" &&
    identity.verificationMethod === "LEGACY_SELF_ASSERTED";
  if (identity.status !== "PENDING" && !upgradableLegacy) {
    return err("INVALID_STATE", `当前状态（${identity.status}）不可 verify`);
  }

  const target = await loadManageableTargetUser(
    identity.userId,
    input.managementOrgId,
  );
  if (!target.ok) return target;

  const ownership = await resolveManagementOwnership(
    identity,
    input.managementOrgId,
    input.ownershipDeps,
  );
  if (ownership !== "OWNED") {
    return err("PROVIDER_TENANT_UNVERIFIED", "provider 租户归属未证明，拒绝激活");
  }

  const now = new Date();
  return commitIdentityTransition({
    before: identity,
    data: {
      status: "ACTIVE",
      verificationMethod: "ADMIN_PROVISIONED",
      verifiedAt: now,
      verifiedById: input.caller.userId,
    },
    outcome: "VERIFIED",
    audit: {
      callerUserId: input.caller.userId,
      orgId: input.managementOrgId,
      action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_VERIFY,
    },
  });
}

export interface RelinkInput extends IdentityMutationInput {
  newUserId: string;
}

/** 显式高敏感操作：old → new user；REVOKED 的恢复也走这里。绝不经 provision / upsert 隐式发生。 */
export async function relinkIdentity(
  input: RelinkInput,
): Promise<IdentityServiceResult> {
  const caller = await assertCallerCanManageOrg(
    input.caller.userId,
    input.managementOrgId,
  );
  if (!caller.ok) return err("CALLER_FORBIDDEN", "无成员管理权限");

  const identity = await loadManageableIdentityForRelink(
    input.identityId,
    input.managementOrgId,
    input.ownershipDeps,
  );
  if (!identity.ok) return identity;

  const newTarget = await loadManageableTargetUser(
    input.newUserId,
    input.managementOrgId,
  );
  if (!newTarget.ok) return newTarget;

  const ownership = await resolveManagementOwnership(
    identity.identity,
    input.managementOrgId,
    input.ownershipDeps,
  );
  if (ownership !== "OWNED") {
    return err("PROVIDER_TENANT_UNVERIFIED", "provider 租户归属未证明，拒绝改绑");
  }

  const now = new Date();
  // CAS WHERE 含旧 userId：并发 revoke / 另一 relink 赢了 → 本次 STATE_CHANGED
  return commitIdentityTransition({
    before: identity.identity,
    data: {
      userId: input.newUserId,
      status: "ACTIVE",
      verificationMethod: "ADMIN_PROVISIONED",
      verifiedAt: now,
      verifiedById: input.caller.userId,
      linkedAt: now,
      linkedById: input.caller.userId,
      revokedAt: null,
      revokedById: null,
      revokeReason: null,
    },
    outcome: "RELINKED",
    audit: {
      callerUserId: input.caller.userId,
      orgId: input.managementOrgId,
      action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_RELINK,
      afterExtra: { reason: input.reason ?? null },
    },
  });
}

/**
 * relink 的旧用户规则（§16）：普通 org 管理员必须同时能管理 old + new。
 * old user 已不是本 org 在职成员 → 拒绝（跨 org 管理属 platform canonical flow，M2-A deferred）。
 */
async function loadManageableIdentityForRelink(
  identityId: string,
  managementOrgId: string,
  ownershipDeps?: OwnershipDeps,
): Promise<
  | { ok: true; identity: ExternalIdentityRecord }
  | { ok: false; code: IdentityServiceErrorCode; message: string }
> {
  const { db } = await import("@/lib/db");
  const identity = await db.externalIdentity.findUnique({
    where: { id: identityId },
  });
  if (!identity) return err("IDENTITY_NOT_FOUND", "身份不存在");
  // B2：provider 租户不可证明属于本 org → 视同不存在（先于 membership 细分，避免存在性泄露）
  const ownership = await resolveManagementOwnership(
    identity,
    managementOrgId,
    ownershipDeps,
  );
  if (!MANAGEABLE_OWNERSHIP.includes(ownership)) {
    return err("IDENTITY_NOT_FOUND", "身份不存在");
  }
  const oldMembership = await db.organizationMember.findUnique({
    where: {
      orgId_userId: { orgId: managementOrgId, userId: identity.userId },
    },
    select: { status: true },
  });
  if (!oldMembership) return err("IDENTITY_NOT_FOUND", "身份不存在");
  if (oldMembership.status !== "active") {
    return err(
      "OLD_USER_NOT_MANAGEABLE",
      "原用户已不是本组织在职成员；跨组织改绑需平台管理流程（M2-A 未开放）",
    );
  }
  return { ok: true, identity };
}

export async function disableIdentity(
  input: IdentityMutationInput,
): Promise<IdentityServiceResult> {
  const caller = await assertCallerCanManageOrg(
    input.caller.userId,
    input.managementOrgId,
  );
  if (!caller.ok) return err("CALLER_FORBIDDEN", "无成员管理权限");
  const identity = await loadManageableIdentity(
    input.identityId,
    input.managementOrgId,
    input.ownershipDeps,
  );
  if (!identity) return err("IDENTITY_NOT_FOUND", "身份不存在");
  if (identity.status !== "ACTIVE" && identity.status !== "PENDING") {
    return err("INVALID_STATE", `当前状态（${identity.status}）不可 disable`);
  }
  return commitIdentityTransition({
    before: identity,
    data: { status: "DISABLED" },
    outcome: "DISABLED",
    audit: {
      callerUserId: input.caller.userId,
      orgId: input.managementOrgId,
      action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_STATUS_CHANGE,
      afterExtra: { reason: input.reason ?? null },
    },
  });
}

export async function enableIdentity(
  input: IdentityMutationInput,
): Promise<IdentityServiceResult> {
  const caller = await assertCallerCanManageOrg(
    input.caller.userId,
    input.managementOrgId,
  );
  if (!caller.ok) return err("CALLER_FORBIDDEN", "无成员管理权限");
  const identity = await loadManageableIdentity(
    input.identityId,
    input.managementOrgId,
    input.ownershipDeps,
  );
  if (!identity) return err("IDENTITY_NOT_FOUND", "身份不存在");
  if (identity.status !== "DISABLED") {
    return err("INVALID_STATE", `当前状态（${identity.status}）不可 enable`);
  }
  // ENABLE 前重新验证：ownership + user active + membership（loadManageableIdentity 已验 membership）
  const target = await loadManageableTargetUser(
    identity.userId,
    input.managementOrgId,
  );
  if (!target.ok) return target;
  const ownership = await resolveManagementOwnership(
    identity,
    input.managementOrgId,
    input.ownershipDeps,
  );
  if (ownership !== "OWNED") {
    return err("PROVIDER_TENANT_UNVERIFIED", "provider 租户归属未证明，拒绝恢复");
  }
  return commitIdentityTransition({
    before: identity,
    data: { status: "ACTIVE" },
    outcome: "ACTIVE",
    audit: {
      callerUserId: input.caller.userId,
      orgId: input.managementOrgId,
      action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_STATUS_CHANGE,
      afterExtra: { reason: input.reason ?? null },
    },
  });
}

export interface RevokeInput {
  caller: IdentityServiceCaller;
  identityId: string;
  reason?: string;
  /** admin 路径：服务端解析的管理 org；self 路径传 null */
  managementOrgId: string | null;
  ownershipDeps?: OwnershipDeps;
}

/** owner 本人（findFirst id+userId）或授权管理员；REVOKED 终态。 */
export async function revokeIdentity(
  input: RevokeInput,
): Promise<IdentityServiceResult> {
  const { db } = await import("@/lib/db");
  let identity: ExternalIdentityRecord | null = null;
  let auditOrgId: string | null = null;

  if (input.managementOrgId) {
    const caller = await assertCallerCanManageOrg(
      input.caller.userId,
      input.managementOrgId,
    );
    if (!caller.ok) return err("CALLER_FORBIDDEN", "无成员管理权限");
    identity = await loadManageableIdentity(
      input.identityId,
      input.managementOrgId,
      input.ownershipDeps,
    );
    auditOrgId = input.managementOrgId;
  } else {
    // self revoke：只凭 id 不够，必须 owner 归属（IDOR）
    identity = await db.externalIdentity.findFirst({
      where: { id: input.identityId, userId: input.caller.userId },
    });
  }
  if (!identity) return err("IDENTITY_NOT_FOUND", "身份不存在");
  if (identity.status === "REVOKED") {
    return err("INVALID_STATE", "身份已是撤销状态");
  }

  const now = new Date();
  const reason = (input.reason ?? "").slice(0, 500) || null;
  // CAS WHERE 含快照 userId：admin relink 抢先改绑到新用户后，
  // 旧 owner 的 stale self-revoke 必然 STATE_CHANGED，不影响新用户身份。
  return commitIdentityTransition({
    before: identity,
    data: {
      status: "REVOKED",
      revokedAt: now,
      revokedById: input.caller.userId,
      revokeReason: reason,
    },
    outcome: "REVOKED",
    audit: {
      callerUserId: input.caller.userId,
      orgId: auditOrgId,
      action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_REVOKE,
      afterExtra: { reason },
    },
  });
}

// ── 读列表 ──────────────────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true,
  provider: true,
  providerTenantId: true,
  providerUserId: true,
  userId: true,
  status: true,
  verificationMethod: true,
  verifiedAt: true,
  linkedAt: true,
  lastSeenAt: true,
  revokedAt: true,
  createdAt: true,
} satisfies Prisma.ExternalIdentitySelect;

export async function listIdentitiesForUser(userId: string) {
  const { db } = await import("@/lib/db");
  return db.externalIdentity.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: LIST_SELECT,
  });
}

/**
 * 管理员视角：目标用户必须是管理 org 的在职成员（否则视同不存在）。
 * B2：目标用户可能同时属于多个 org —— 只返回 provider 租户归属可证明属于
 * 当前管理 org（OWNED / INACTIVE）的身份；其它 org 的身份对本 org 管理员不可见。
 * self list（listIdentitiesForUser）保持 owner 全量语义，不做 org 过滤。
 */
export async function listIdentitiesForAdmin(input: {
  caller: IdentityServiceCaller;
  managementOrgId: string;
  targetUserId: string;
  ownershipDeps?: OwnershipDeps;
}): Promise<
  | { ok: true; identities: Awaited<ReturnType<typeof listIdentitiesForUser>> }
  | { ok: false; code: IdentityServiceErrorCode; message: string }
> {
  const caller = await assertCallerCanManageOrg(
    input.caller.userId,
    input.managementOrgId,
  );
  if (!caller.ok) return err("CALLER_FORBIDDEN", "无成员管理权限");
  const target = await loadManageableTargetUser(
    input.targetUserId,
    input.managementOrgId,
  );
  if (!target.ok) return err("IDENTITY_NOT_FOUND", "身份不存在");
  const all = await listIdentitiesForUser(input.targetUserId);
  const visible: typeof all = [];
  for (const identity of all) {
    const ownership = await resolveManagementOwnership(
      identity,
      input.managementOrgId,
      input.ownershipDeps,
    );
    if (MANAGEABLE_OWNERSHIP.includes(ownership)) visible.push(identity);
  }
  return { ok: true, identities: visible };
}
