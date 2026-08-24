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
import {
  EXTERNAL_IDENTITY_PROVIDERS,
  type ExternalIdentityStatus,
} from "./types";

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

async function loadManageableTargetUser(
  targetUserId: string,
  managementOrgId: string,
): Promise<
  | { ok: true; user: { id: string; status: string } }
  | { ok: false; code: IdentityServiceErrorCode; message: string }
> {
  const { db } = await import("@/lib/db");
  const user = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, status: true },
  });
  if (!user) return err("TARGET_USER_NOT_FOUND", "目标用户不存在");
  if (user.status !== "active") return err("TARGET_USER_INACTIVE", "目标用户未激活");
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId: managementOrgId, userId: targetUserId } },
    select: { status: true },
  });
  if (!membership || membership.status !== "active") {
    return err("TARGET_NOT_MEMBER", "目标用户不是当前组织的在职成员");
  }
  return { ok: true, user };
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

/** 管理路径统一取一条「本 org 可管理」的身份：identity.userId 必须是 org 在职成员，否则视同不存在（IDOR 404） */
async function loadManageableIdentity(
  identityId: string,
  managementOrgId: string,
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

  const ownership = await resolveProviderTenantOwnership(
    {
      provider: identity.provider,
      providerTenantId: identity.providerTenantId,
      targetOrgId: input.managementOrgId,
    },
    input.ownershipDeps ?? createDefaultOwnershipDeps(),
  );
  if (ownership !== "OWNED") {
    return err("PROVIDER_TENANT_UNVERIFIED", "provider 租户归属未证明，拒绝激活");
  }

  const { db } = await import("@/lib/db");
  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.externalIdentity.update({
      where: { id: identity.id },
      data: {
        status: "ACTIVE",
        verificationMethod: "ADMIN_PROVISIONED",
        verifiedAt: now,
        verifiedById: input.caller.userId,
      },
    });
    await writeAuditLog(tx, {
      userId: input.caller.userId,
      orgId: input.managementOrgId,
      action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_VERIFY,
      targetType: "external_identity",
      targetId: row.id,
      beforeData: auditPayload(identity),
      afterData: auditPayload(row),
    });
    return row;
  });
  return { ok: true, identity: updated, outcome: "VERIFIED" };
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
  );
  if (!identity.ok) return identity;

  const newTarget = await loadManageableTargetUser(
    input.newUserId,
    input.managementOrgId,
  );
  if (!newTarget.ok) return newTarget;

  const ownership = await resolveProviderTenantOwnership(
    {
      provider: identity.identity.provider,
      providerTenantId: identity.identity.providerTenantId,
      targetOrgId: input.managementOrgId,
    },
    input.ownershipDeps ?? createDefaultOwnershipDeps(),
  );
  if (ownership !== "OWNED") {
    return err("PROVIDER_TENANT_UNVERIFIED", "provider 租户归属未证明，拒绝改绑");
  }

  const { db } = await import("@/lib/db");
  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.externalIdentity.update({
      where: { id: identity.identity.id },
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
    });
    await writeAuditLog(tx, {
      userId: input.caller.userId,
      orgId: input.managementOrgId,
      action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_RELINK,
      targetType: "external_identity",
      targetId: row.id,
      beforeData: auditPayload(identity.identity),
      afterData: auditPayload(row),
    });
    return row;
  });
  return { ok: true, identity: updated, outcome: "RELINKED" };
}

/**
 * relink 的旧用户规则（§16）：普通 org 管理员必须同时能管理 old + new。
 * old user 已不是本 org 在职成员 → 拒绝（跨 org 管理属 platform canonical flow，M2-A deferred）。
 */
async function loadManageableIdentityForRelink(
  identityId: string,
  managementOrgId: string,
): Promise<
  | { ok: true; identity: ExternalIdentityRecord }
  | { ok: false; code: IdentityServiceErrorCode; message: string }
> {
  const { db } = await import("@/lib/db");
  const identity = await db.externalIdentity.findUnique({
    where: { id: identityId },
  });
  if (!identity) return err("IDENTITY_NOT_FOUND", "身份不存在");
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
  );
  if (!identity) return err("IDENTITY_NOT_FOUND", "身份不存在");
  if (identity.status !== "ACTIVE" && identity.status !== "PENDING") {
    return err("INVALID_STATE", `当前状态（${identity.status}）不可 disable`);
  }
  return transitionStatus(identity, "DISABLED", input, {
    action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_STATUS_CHANGE,
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
  const ownership = await resolveProviderTenantOwnership(
    {
      provider: identity.provider,
      providerTenantId: identity.providerTenantId,
      targetOrgId: input.managementOrgId,
    },
    input.ownershipDeps ?? createDefaultOwnershipDeps(),
  );
  if (ownership !== "OWNED") {
    return err("PROVIDER_TENANT_UNVERIFIED", "provider 租户归属未证明，拒绝恢复");
  }
  return transitionStatus(identity, "ACTIVE", input, {
    action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_STATUS_CHANGE,
  });
}

async function transitionStatus(
  identity: ExternalIdentityRecord,
  nextStatus: ExternalIdentityStatus,
  input: IdentityMutationInput,
  opts: { action: string },
): Promise<IdentityServiceResult> {
  const { db } = await import("@/lib/db");
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.externalIdentity.update({
      where: { id: identity.id },
      data: { status: nextStatus },
    });
    await writeAuditLog(tx, {
      userId: input.caller.userId,
      orgId: input.managementOrgId,
      action: opts.action,
      targetType: "external_identity",
      targetId: row.id,
      beforeData: auditPayload(identity),
      afterData: { ...auditPayload(row), reason: input.reason ?? null },
    });
    return row;
  });
  return { ok: true, identity: updated, outcome: nextStatus };
}

export interface RevokeInput {
  caller: IdentityServiceCaller;
  identityId: string;
  reason?: string;
  /** admin 路径：服务端解析的管理 org；self 路径传 null */
  managementOrgId: string | null;
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
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.externalIdentity.update({
      where: { id: identity!.id },
      data: {
        status: "REVOKED",
        revokedAt: now,
        revokedById: input.caller.userId,
        revokeReason: (input.reason ?? "").slice(0, 500) || null,
      },
    });
    await writeAuditLog(tx, {
      userId: input.caller.userId,
      orgId: auditOrgId,
      action: AUDIT_ACTIONS.EXTERNAL_IDENTITY_REVOKE,
      targetType: "external_identity",
      targetId: row.id,
      beforeData: auditPayload(identity!),
      afterData: { ...auditPayload(row), reason: row.revokeReason },
    });
    return row;
  });
  return { ok: true, identity: updated, outcome: "REVOKED" };
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

/** 管理员视角：目标用户必须是管理 org 的在职成员（否则视同不存在） */
export async function listIdentitiesForAdmin(input: {
  caller: IdentityServiceCaller;
  managementOrgId: string;
  targetUserId: string;
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
  return { ok: true, identities: await listIdentitiesForUser(input.targetUserId) };
}
