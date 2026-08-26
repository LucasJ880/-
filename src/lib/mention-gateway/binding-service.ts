/**
 * Mention Gateway M2-B — ChannelContextBinding Lifecycle Service
 *
 * 唯一写入口（API 路由是薄壳；AI / runtime 绝不调用写函数 —— B0：CHANNEL CONTEXT IS SERVER AUTHORITY，
 * 模型不能按聊天内容猜项目/切客户/建绑定）。
 *
 * 冻结语义：
 * - B1 渠道边界：唯一键 = provider + providerTenantId + providerChannelId + providerThreadId
 *   （CHANNEL 级用 "" 哨兵；可空列会让 Postgres UNIQUE 放行多条 channel 行）。
 * - B2 NO BLIND UPSERT：create / rebind / disable / enable / revoke 全部显式；
 *   同键不同 target → BINDING_ALREADY_EXISTS，绝不静默改写。
 * - B3 REVOKED 终态：不能 enable / rebind，同 exact key 不能 recreate（恢复属未来显式 recovery 设计）。
 * - 目标 org 服务端推导（project.orgId / customer.orgId），orgId 永不来自 body；
 *   targetOrg 必须等于认证的管理租户 org。
 * - target 权限：project → requireProjectWriteAccess 决策表（super_admin / owner / org_admin / project_admin，
 *   src/lib/projects/access.ts）；customer → canonical authorize('sales.customer.update') + isAdmin 旁路
 *   （src/app/api/sales/customers/[id]/route.ts Security-1）。
 * - personal project（canonical 判别：Project.orgId === null，见 agent-scope/resolve.ts evaluateProjectScope）→ 拒绝。
 * - ACTIVE 需 resolveProviderTenantOwnership === OWNED（复用 M2-A，不复制第二份实现）。
 * - 所有 mutation：read → validate → CAS（快照 id+status+projectId+customerId+contextRole+updatedAt）；
 *   失配 → BINDING_STATE_CHANGED 409、零写零审计（M2-A Final Review 同款 TOCTOU 防线）。
 * - 全部写 db.$transaction + writeAuditLog(tx)（审计失败整体回滚）；
 *   审计不长期复制 raw channel/thread id，只存 sha256 截断 hash。
 */

import type { Prisma } from "@prisma/client";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit/logger";
import { getOrgMembership, getProjectMembership } from "@/lib/auth";
import { authorize } from "@/lib/authorization";
import { hasOrgRole, hasProjectRole, isAdmin, isSuperAdmin } from "@/lib/rbac/roles";
import {
  createDefaultOwnershipDeps,
  resolveProviderTenantOwnership,
  type OwnershipDeps,
} from "./provider-tenant-ownership";
import { hashProviderUserId } from "./identity-service";
import { EXTERNAL_IDENTITY_PROVIDERS } from "./types";

export const CHANNEL_BINDING_STATUSES = ["ACTIVE", "DISABLED", "REVOKED"] as const;
export type ChannelBindingStatus = (typeof CHANNEL_BINDING_STATUSES)[number];

export type BindingTargetType = "project" | "customer";

export interface ChannelBindingRecord {
  id: string;
  provider: string;
  providerTenantId: string;
  providerChannelId: string;
  bindingLevel: string;
  providerThreadId: string;
  orgId: string;
  projectId: string | null;
  customerId: string | null;
  contextRole: string | null;
  status: string;
  createdById: string | null;
  updatedById: string | null;
  disabledAt: Date | null;
  disabledById: string | null;
  revokedAt: Date | null;
  revokedById: string | null;
  revokeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type BindingServiceErrorCode =
  | "INVALID_PROVIDER"
  | "INVALID_KEY"
  | "INVALID_TARGET"
  | "CONTEXT_ROLE_INVALID"
  | "PROVIDER_TENANT_UNVERIFIED"
  | "CALLER_FORBIDDEN"
  | "TARGET_NOT_FOUND"
  | "TARGET_PERSONAL_PROJECT"
  | "BINDING_ALREADY_EXISTS"
  | "REQUIRE_ENABLE_OR_REBIND"
  | "BINDING_REVOKED_TERMINAL"
  | "BINDING_NOT_FOUND"
  | "INVALID_STATE"
  | "BINDING_STATE_CHANGED"
  | "CROSS_ORG_FORBIDDEN";

export type BindingServiceResult =
  | { ok: true; binding: ChannelBindingRecord; outcome: string }
  | { ok: false; code: BindingServiceErrorCode; message: string };

export interface BindingServiceCaller {
  userId: string;
  role: string;
}

function err(
  code: BindingServiceErrorCode,
  message: string,
): { ok: false; code: BindingServiceErrorCode; message: string } {
  return { ok: false, code, message };
}

// ── 纯函数（可单测，无 DB）────────────────────────────────────────────────

/** 审计/日志中的 channel/thread 表示：sha256 截断（与 M2-A providerUserId 同风格） */
export const hashChannelToken = hashProviderUserId;

export interface NormalizedBindingKey {
  provider: string;
  providerTenantId: string;
  providerChannelId: string;
  bindingLevel: "CHANNEL" | "THREAD";
  /** CHANNEL → ""；THREAD → 非空真实线程 id */
  providerThreadId: string;
}

/**
 * 键归一化：trim + provider 白名单 + threadId 哨兵推导。
 * 对外 API：threadId 缺省/null/空白 = channel 级；DB 内部恒为 ""。
 * 显式传入的 threadId 不允许归一化后为空（真实 provider thread id 禁止空串）。
 */
export function normalizeBindingKey(input: {
  provider: string;
  providerTenantId: string;
  providerChannelId: string;
  providerThreadId?: string | null;
}):
  | { ok: true; key: NormalizedBindingKey }
  | { ok: false; code: "INVALID_PROVIDER" | "INVALID_KEY" } {
  const provider = (input.provider ?? "").trim();
  const providerTenantId = (input.providerTenantId ?? "").trim();
  const providerChannelId = (input.providerChannelId ?? "").trim();
  if (!(EXTERNAL_IDENTITY_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, code: "INVALID_PROVIDER" };
  }
  if (!providerTenantId || !providerChannelId) {
    return { ok: false, code: "INVALID_KEY" };
  }
  const rawThread = input.providerThreadId;
  if (rawThread === undefined || rawThread === null || rawThread.trim() === "") {
    if (typeof rawThread === "string" && rawThread !== "") {
      // 显式传了全空白线程 id → 非法（不能静默降级成 channel 级）
      return { ok: false, code: "INVALID_KEY" };
    }
    if (rawThread === "") {
      return { ok: false, code: "INVALID_KEY" };
    }
    return {
      ok: true,
      key: {
        provider,
        providerTenantId,
        providerChannelId,
        bindingLevel: "CHANNEL",
        providerThreadId: "",
      },
    };
  }
  return {
    ok: true,
    key: {
      provider,
      providerTenantId,
      providerChannelId,
      bindingLevel: "THREAD",
      providerThreadId: rawThread.trim(),
    },
  };
}

export type CreateBindingOutcome =
  | "CREATE"
  | "IDEMPOTENT"
  | "ALREADY_EXISTS"
  | "REQUIRE_ENABLE_OR_REBIND"
  | "REVOKED_TERMINAL";

/**
 * §20 创建语义（NO BLIND UPSERT）：
 * - 不存在 → CREATE
 * - ACTIVE + 同 target + 同 contextRole → IDEMPOTENT（零写）
 * - ACTIVE + 不同 target/role → ALREADY_EXISTS（必须显式 rebind）
 * - DISABLED → REQUIRE_ENABLE_OR_REBIND
 * - REVOKED → REVOKED_TERMINAL（exact key 永久撤销）
 */
export function decideCreateBindingOutcome(
  existing: {
    status: string;
    projectId: string | null;
    customerId: string | null;
    contextRole: string | null;
  } | null,
  candidate: {
    projectId: string | null;
    customerId: string | null;
    contextRole: string | null;
  },
): CreateBindingOutcome {
  if (!existing) return "CREATE";
  if (existing.status === "REVOKED") return "REVOKED_TERMINAL";
  if (existing.status === "DISABLED") return "REQUIRE_ENABLE_OR_REBIND";
  const sameTarget =
    existing.projectId === candidate.projectId &&
    existing.customerId === candidate.customerId &&
    (existing.contextRole ?? null) === (candidate.contextRole ?? null);
  return sameTarget ? "IDEMPOTENT" : "ALREADY_EXISTS";
}

/** §12 targetType + contextRole → 运行期 contextType（tender 只是 Project 标签） */
export function bindingRowToContextType(row: {
  projectId: string | null;
  customerId: string | null;
  contextRole: string | null;
}): "project" | "tender" | "sales" | null {
  if (row.customerId) {
    return row.projectId ? null : "sales";
  }
  if (!row.projectId) return null;
  return row.contextRole === "tender" ? "tender" : "project";
}

// ── target 加载 + 权限（canonical 复用）────────────────────────────────────

interface ProjectTarget {
  id: string;
  orgId: string | null;
  ownerId: string;
  intakeStatus: string;
}

interface CustomerTarget {
  id: string;
  orgId: string;
  createdById: string;
  archivedAt: Date | null;
}

async function loadProjectTarget(projectId: string): Promise<ProjectTarget | null> {
  const { db } = await import("@/lib/db");
  return db.project.findUnique({
    where: { id: projectId },
    select: { id: true, orgId: true, ownerId: true, intakeStatus: true },
  });
}

async function loadCustomerTarget(customerId: string): Promise<CustomerTarget | null> {
  const { db } = await import("@/lib/db");
  return db.salesCustomer.findUnique({
    where: { id: customerId },
    select: { id: true, orgId: true, createdById: true, archivedAt: true },
  });
}

/**
 * §16 project 管理权限 —— 逐条镜像 canonical `requireProjectWriteAccess`
 * （src/lib/projects/access.ts）的决策表，复用同一套 rbac/auth 原语，不发明新角色系统：
 *   super_admin ∥ (intakeStatus=dispatched ∧ (owner ∥ org_admin ∥ project_admin))
 */
async function callerCanManageProject(
  caller: BindingServiceCaller,
  project: ProjectTarget,
): Promise<boolean> {
  if (isSuperAdmin(caller.role)) return true;
  if (project.intakeStatus !== "dispatched") return false;
  if (project.ownerId === caller.userId) return true;
  if (!project.orgId) return false;
  const om = await getOrgMembership(caller.userId, project.orgId);
  const orgRole = om?.status === "active" ? om.role : null;
  if (orgRole && hasOrgRole(orgRole, "org_admin")) return true;
  const pm = await getProjectMembership(caller.userId, project.id);
  const projectRole = pm?.status === "active" ? pm.role : null;
  return Boolean(projectRole && hasProjectRole(projectRole, "project_admin"));
}

/**
 * §18 customer 管理权限 —— canonical `sales.customer.update`
 * （authorize + humanPrincipal 形状 + isAdmin 旁路；与 sales/customers/[id] PUT Security-1 一致）。
 */
async function callerCanManageCustomer(
  caller: BindingServiceCaller,
  customer: CustomerTarget,
  managementOrgId: string,
): Promise<boolean> {
  if (isAdmin(caller.role)) return true;
  const decision = await authorize({
    principal: { type: "HUMAN", id: caller.userId, orgId: managementOrgId },
    orgId: managementOrgId,
    permission: "sales.customer.update",
    resource: {
      type: "sales_customer",
      id: customer.id,
      orgId: customer.orgId,
      ownerId: customer.createdById,
    },
  });
  return decision.allowed;
}

type ResolvedTarget =
  | {
      ok: true;
      targetType: BindingTargetType;
      targetOrgId: string;
      projectId: string | null;
      customerId: string | null;
    }
  | { ok: false; code: BindingServiceErrorCode; message: string };

/**
 * §15/§16/§17/§18：加载 target → server 端推导 targetOrgId → personal project 拒绝
 * → targetOrg 必须等于管理租户 org（不泄露跨 org 存在性）→ target 管理权限。
 */
async function resolveManageableTarget(
  caller: BindingServiceCaller,
  managementOrgId: string,
  targetType: BindingTargetType,
  targetId: string,
): Promise<ResolvedTarget> {
  if (targetType === "project") {
    const project = await loadProjectTarget(targetId);
    if (!project) return err("TARGET_NOT_FOUND", "目标不存在");
    // canonical personal 判别：Project.orgId === null（agent-scope/resolve.ts / projects/visibility.ts）
    if (project.orgId === null) {
      return err("TARGET_PERSONAL_PROJECT", "个人项目不可建立频道绑定");
    }
    if (project.orgId !== managementOrgId) {
      return err("TARGET_NOT_FOUND", "目标不存在");
    }
    if (!(await callerCanManageProject(caller, project))) {
      return err("CALLER_FORBIDDEN", "需要项目管理权限（owner / org_admin / project_admin）");
    }
    return {
      ok: true,
      targetType,
      targetOrgId: project.orgId,
      projectId: project.id,
      customerId: null,
    };
  }
  const customer = await loadCustomerTarget(targetId);
  if (!customer || customer.archivedAt) return err("TARGET_NOT_FOUND", "目标不存在");
  if (customer.orgId !== managementOrgId) return err("TARGET_NOT_FOUND", "目标不存在");
  if (!(await callerCanManageCustomer(caller, customer, managementOrgId))) {
    return err("CALLER_FORBIDDEN", "需要该客户的管理权限（sales.customer.update）");
  }
  return {
    ok: true,
    targetType,
    targetOrgId: customer.orgId,
    projectId: null,
    customerId: customer.id,
  };
}

function validateContextRole(
  targetType: BindingTargetType,
  contextRole: string | null | undefined,
): { ok: true; contextRole: string | null } | { ok: false } {
  const role = (contextRole ?? "").trim() || null;
  if (role === null) return { ok: true, contextRole: null };
  if (role !== "tender") return { ok: false };
  if (targetType !== "project") return { ok: false };
  return { ok: true, contextRole: "tender" };
}

// ── audit payload（不复制 raw channel/thread id）───────────────────────────

function auditPayload(row: {
  provider: string;
  providerTenantId: string;
  providerChannelId: string;
  providerThreadId: string;
  bindingLevel: string;
  orgId: string;
  projectId: string | null;
  customerId: string | null;
  contextRole: string | null;
  status: string;
}): Record<string, unknown> {
  return {
    provider: row.provider,
    providerTenantId: row.providerTenantId,
    providerChannelIdHash: hashChannelToken(row.providerChannelId),
    providerThreadIdHash: row.providerThreadId
      ? hashChannelToken(row.providerThreadId)
      : null,
    bindingLevel: row.bindingLevel,
    orgId: row.orgId,
    projectId: row.projectId,
    customerId: row.customerId,
    contextRole: row.contextRole,
    status: row.status,
  };
}

// ── B25 Optimistic CAS ─────────────────────────────────────────────────────

export interface BindingTransitionPlan {
  before: ChannelBindingRecord;
  data: {
    status?: string;
    projectId?: string | null;
    customerId?: string | null;
    contextRole?: string | null;
    updatedById?: string | null;
    disabledAt?: Date | null;
    disabledById?: string | null;
    revokedAt?: Date | null;
    revokedById?: string | null;
    revokeReason?: string | null;
  };
  outcome: string;
  audit: {
    callerUserId: string;
    orgId: string;
    action: string;
    afterExtra?: Record<string, unknown>;
  };
}

/**
 * CAS 提交（写 + 审计同事务；审计失败整体回滚）。
 * WHERE = id + status + projectId + customerId + contextRole + updatedAt 快照；
 * 期间任何并发 rebind / disable / revoke 赢了 → BINDING_STATE_CHANGED，零写零审计。
 */
export async function commitBindingTransition(
  plan: BindingTransitionPlan,
): Promise<BindingServiceResult> {
  const { db } = await import("@/lib/db");
  const casMiss = Symbol("binding-cas-miss");
  try {
    const updated = await db.$transaction(async (tx) => {
      const hit = await tx.channelContextBinding.updateMany({
        where: {
          id: plan.before.id,
          status: plan.before.status,
          projectId: plan.before.projectId,
          customerId: plan.before.customerId,
          contextRole: plan.before.contextRole,
          updatedAt: plan.before.updatedAt,
        },
        data: plan.data,
      });
      if (hit.count !== 1) throw casMiss;
      const row = await tx.channelContextBinding.findUniqueOrThrow({
        where: { id: plan.before.id },
      });
      await writeAuditLog(tx, {
        userId: plan.audit.callerUserId,
        orgId: plan.audit.orgId,
        action: plan.audit.action,
        targetType: "channel_context_binding",
        targetId: row.id,
        beforeData: auditPayload(plan.before),
        afterData: { ...auditPayload(row), ...(plan.audit.afterExtra ?? {}) },
      });
      return row;
    });
    return { ok: true, binding: updated as ChannelBindingRecord, outcome: plan.outcome };
  } catch (e) {
    if (e === casMiss) {
      return err(
        "BINDING_STATE_CHANGED",
        "绑定状态在操作期间已被并发修改，请重新读取后再操作",
      );
    }
    throw e;
  }
}

// ── 管理可见性（§24）───────────────────────────────────────────────────────

const MANAGEABLE_OWNERSHIP: readonly string[] = ["OWNED", "INACTIVE"];

async function resolveBindingOwnership(
  binding: { provider: string; providerTenantId: string },
  managementOrgId: string,
  ownershipDeps?: OwnershipDeps,
) {
  return resolveProviderTenantOwnership(
    {
      provider: binding.provider,
      providerTenantId: binding.providerTenantId,
      targetOrgId: managementOrgId,
    },
    ownershipDeps ?? createDefaultOwnershipDeps(),
  );
}

/** binding.userTarget 的管理权限（project / customer 各走 canonical 门） */
async function callerCanManageBindingTarget(
  caller: BindingServiceCaller,
  binding: { projectId: string | null; customerId: string | null; orgId: string },
): Promise<boolean> {
  if (binding.projectId) {
    const project = await loadProjectTarget(binding.projectId);
    if (!project || project.orgId !== binding.orgId) return false;
    return callerCanManageProject(caller, project);
  }
  if (binding.customerId) {
    const customer = await loadCustomerTarget(binding.customerId);
    if (!customer || customer.orgId !== binding.orgId) return false;
    return callerCanManageCustomer(caller, customer, binding.orgId);
  }
  return false;
}

/**
 * 管理路径统一取「本 org 可管理」的绑定：
 *   binding.orgId === managementOrg
 *   ∧ provider 租户归属 ∈ {OWNED, INACTIVE}
 *   ∧ caller 能管理绑定 target
 * 其余（含 MISMATCH/UNPROVEN/AMBIGUOUS/UNSUPPORTED、跨 org、无 target 权限）
 * → null（404，不泄露存在性）。
 */
async function loadManageableBinding(
  bindingId: string,
  caller: BindingServiceCaller,
  managementOrgId: string,
  ownershipDeps?: OwnershipDeps,
): Promise<ChannelBindingRecord | null> {
  const { db } = await import("@/lib/db");
  const binding = await db.channelContextBinding.findUnique({
    where: { id: bindingId },
  });
  if (!binding) return null;
  if (binding.orgId !== managementOrgId) return null;
  const ownership = await resolveBindingOwnership(
    binding,
    managementOrgId,
    ownershipDeps,
  );
  if (!MANAGEABLE_OWNERSHIP.includes(ownership)) return null;
  if (!(await callerCanManageBindingTarget(caller, binding))) return null;
  return binding as ChannelBindingRecord;
}

// ── 生命周期写操作 ──────────────────────────────────────────────────────────

export interface CreateBindingInput {
  caller: BindingServiceCaller;
  /** 服务端解析的管理 org（requireTenantContext）；orgId 绝不来自 body */
  managementOrgId: string;
  provider: string;
  providerTenantId: string;
  providerChannelId: string;
  providerThreadId?: string | null;
  targetType: BindingTargetType;
  targetId: string;
  contextRole?: string | null;
  ownershipDeps?: OwnershipDeps;
}

export async function createChannelBinding(
  input: CreateBindingInput,
): Promise<BindingServiceResult> {
  const norm = normalizeBindingKey(input);
  if (!norm.ok) {
    return err(norm.code, "provider / providerTenantId / providerChannelId / providerThreadId 不合法");
  }
  const role = validateContextRole(input.targetType, input.contextRole);
  if (!role.ok) {
    return err("CONTEXT_ROLE_INVALID", "contextRole 仅允许 null 或 tender（且 tender 只能绑定 Project）");
  }

  const target = await resolveManageableTarget(
    input.caller,
    input.managementOrgId,
    input.targetType,
    input.targetId,
  );
  if (!target.ok) return target;

  // §19：ownership 必须 OWNED，否则 DB NO ROW（含 INACTIVE/UNPROVEN/MISMATCH/AMBIGUOUS/UNSUPPORTED）
  const ownership = await resolveProviderTenantOwnership(
    {
      provider: norm.key.provider,
      providerTenantId: norm.key.providerTenantId,
      targetOrgId: input.managementOrgId,
    },
    input.ownershipDeps ?? createDefaultOwnershipDeps(),
  );
  if (ownership !== "OWNED") {
    return err("PROVIDER_TENANT_UNVERIFIED", "provider 租户归属未证明，拒绝创建绑定");
  }

  const { db } = await import("@/lib/db");
  const existing = await db.channelContextBinding.findUnique({
    where: {
      provider_providerTenantId_providerChannelId_providerThreadId: {
        provider: norm.key.provider,
        providerTenantId: norm.key.providerTenantId,
        providerChannelId: norm.key.providerChannelId,
        providerThreadId: norm.key.providerThreadId,
      },
    },
  });
  const outcome = decideCreateBindingOutcome(existing, {
    projectId: target.projectId,
    customerId: target.customerId,
    contextRole: role.contextRole,
  });
  switch (outcome) {
    case "IDEMPOTENT":
      return { ok: true, binding: existing as ChannelBindingRecord, outcome };
    case "ALREADY_EXISTS":
      // 不泄露既有 target 指向（authorized scope 之外零披露）
      return err("BINDING_ALREADY_EXISTS", "该频道键已存在绑定，改绑请使用显式 rebind");
    case "REQUIRE_ENABLE_OR_REBIND":
      return err("REQUIRE_ENABLE_OR_REBIND", "该频道键绑定已停用，请使用 enable 或 rebind");
    case "REVOKED_TERMINAL":
      return err("BINDING_REVOKED_TERMINAL", "该频道键绑定已被永久撤销（terminal）");
    case "CREATE":
      break;
  }

  try {
    const binding = await db.$transaction(async (tx) => {
      const created = await tx.channelContextBinding.create({
        data: {
          provider: norm.key.provider,
          providerTenantId: norm.key.providerTenantId,
          providerChannelId: norm.key.providerChannelId,
          bindingLevel: norm.key.bindingLevel,
          providerThreadId: norm.key.providerThreadId,
          orgId: target.targetOrgId,
          projectId: target.projectId,
          customerId: target.customerId,
          contextRole: role.contextRole,
          status: "ACTIVE",
          createdById: input.caller.userId,
          updatedById: input.caller.userId,
        },
      });
      await writeAuditLog(tx, {
        userId: input.caller.userId,
        orgId: target.targetOrgId,
        action: AUDIT_ACTIONS.CHANNEL_CONTEXT_BINDING_CREATE,
        targetType: "channel_context_binding",
        targetId: created.id,
        afterData: auditPayload(created),
      });
      return created;
    });
    return { ok: true, binding: binding as ChannelBindingRecord, outcome: "CREATE" };
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") {
      // 并发竞态：同键已被占用 → 与 ALREADY_EXISTS 同语义，不修改、不泄露
      return err("BINDING_ALREADY_EXISTS", "该频道键已存在绑定，改绑请使用显式 rebind");
    }
    throw e;
  }
}

export interface RebindInput {
  caller: BindingServiceCaller;
  managementOrgId: string;
  bindingId: string;
  targetType: BindingTargetType;
  targetId: string;
  contextRole?: string | null;
  reason?: string;
  ownershipDeps?: OwnershipDeps;
}

/**
 * §21/§22 显式改绑：OLD ∧ NEW target 权限都必须通过；
 * OLD org == NEW org == management org（CROSS_ORG_REBIND = FORBIDDEN）；
 * REVOKED 不可 rebind；同 org 内允许 project⇄customer / 换 target / 换 contextRole。
 */
export async function rebindChannelBinding(
  input: RebindInput,
): Promise<BindingServiceResult> {
  const binding = await loadManageableBinding(
    input.bindingId,
    input.caller,
    input.managementOrgId,
    input.ownershipDeps,
  );
  // loadManageableBinding 已含 OLD target 权限（callerCanManageBindingTarget）
  if (!binding) return err("BINDING_NOT_FOUND", "绑定不存在");
  if (binding.status === "REVOKED") {
    return err("BINDING_REVOKED_TERMINAL", "绑定已被永久撤销，不能 rebind");
  }

  const role = validateContextRole(input.targetType, input.contextRole);
  if (!role.ok) {
    return err("CONTEXT_ROLE_INVALID", "contextRole 仅允许 null 或 tender（且 tender 只能绑定 Project）");
  }

  // NEW target：加载 + personal 拒 + org 必须等于管理 org（== binding.orgId）+ NEW 权限
  const target = await resolveManageableTarget(
    input.caller,
    input.managementOrgId,
    input.targetType,
    input.targetId,
  );
  if (!target.ok) return target;
  if (target.targetOrgId !== binding.orgId) {
    // 防御：managementOrg == binding.orgId 已由 loadManageableBinding 保证，此处双保险
    return err("CROSS_ORG_FORBIDDEN", "跨组织改绑被禁止");
  }

  // rebind 重指路由配置 → 要求 OWNED（严于 disable/revoke）
  const ownership = await resolveBindingOwnership(
    binding,
    input.managementOrgId,
    input.ownershipDeps,
  );
  if (ownership !== "OWNED") {
    return err("PROVIDER_TENANT_UNVERIFIED", "provider 租户归属未证明，拒绝改绑");
  }

  return commitBindingTransition({
    before: binding,
    data: {
      projectId: target.projectId,
      customerId: target.customerId,
      contextRole: role.contextRole,
      updatedById: input.caller.userId,
    },
    outcome: "REBOUND",
    audit: {
      callerUserId: input.caller.userId,
      orgId: binding.orgId,
      action: AUDIT_ACTIONS.CHANNEL_CONTEXT_BINDING_REBIND,
      afterExtra: { reason: (input.reason ?? "").slice(0, 500) || null },
    },
  });
}

export interface BindingMutationInput {
  caller: BindingServiceCaller;
  managementOrgId: string;
  bindingId: string;
  reason?: string;
  ownershipDeps?: OwnershipDeps;
}

export async function disableChannelBinding(
  input: BindingMutationInput,
): Promise<BindingServiceResult> {
  const binding = await loadManageableBinding(
    input.bindingId,
    input.caller,
    input.managementOrgId,
    input.ownershipDeps,
  );
  if (!binding) return err("BINDING_NOT_FOUND", "绑定不存在");
  if (binding.status !== "ACTIVE") {
    return err("INVALID_STATE", `当前状态（${binding.status}）不可 disable`);
  }
  return commitBindingTransition({
    before: binding,
    data: {
      status: "DISABLED",
      disabledAt: new Date(),
      disabledById: input.caller.userId,
      updatedById: input.caller.userId,
    },
    outcome: "DISABLED",
    audit: {
      callerUserId: input.caller.userId,
      orgId: binding.orgId,
      action: AUDIT_ACTIONS.CHANNEL_CONTEXT_BINDING_STATUS_CHANGE,
      afterExtra: { reason: (input.reason ?? "").slice(0, 500) || null },
    },
  });
}

export async function enableChannelBinding(
  input: BindingMutationInput,
): Promise<BindingServiceResult> {
  const binding = await loadManageableBinding(
    input.bindingId,
    input.caller,
    input.managementOrgId,
    input.ownershipDeps,
  );
  if (!binding) return err("BINDING_NOT_FOUND", "绑定不存在");
  if (binding.status !== "DISABLED") {
    return err("INVALID_STATE", `当前状态（${binding.status}）不可 enable`);
  }
  // §23 enable 前重验：ownership 必须 OWNED + target 仍有效同 org + caller 仍有管理权限
  const ownership = await resolveBindingOwnership(
    binding,
    input.managementOrgId,
    input.ownershipDeps,
  );
  if (ownership !== "OWNED") {
    return err("PROVIDER_TENANT_UNVERIFIED", "provider 租户归属未证明，拒绝恢复");
  }
  const target = await resolveManageableTarget(
    input.caller,
    input.managementOrgId,
    binding.projectId ? "project" : "customer",
    (binding.projectId ?? binding.customerId)!,
  );
  if (!target.ok) return target;
  return commitBindingTransition({
    before: binding,
    data: {
      status: "ACTIVE",
      disabledAt: null,
      disabledById: null,
      updatedById: input.caller.userId,
    },
    outcome: "ACTIVE",
    audit: {
      callerUserId: input.caller.userId,
      orgId: binding.orgId,
      action: AUDIT_ACTIONS.CHANNEL_CONTEXT_BINDING_STATUS_CHANGE,
      afterExtra: { reason: (input.reason ?? "").slice(0, 500) || null },
    },
  });
}

export async function revokeChannelBinding(
  input: BindingMutationInput,
): Promise<BindingServiceResult> {
  const binding = await loadManageableBinding(
    input.bindingId,
    input.caller,
    input.managementOrgId,
    input.ownershipDeps,
  );
  if (!binding) return err("BINDING_NOT_FOUND", "绑定不存在");
  if (binding.status === "REVOKED") {
    return err("INVALID_STATE", "绑定已是撤销状态");
  }
  const reason = (input.reason ?? "").slice(0, 500) || null;
  return commitBindingTransition({
    before: binding,
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedById: input.caller.userId,
      revokeReason: reason,
      updatedById: input.caller.userId,
    },
    outcome: "REVOKED",
    audit: {
      callerUserId: input.caller.userId,
      orgId: binding.orgId,
      action: AUDIT_ACTIONS.CHANNEL_CONTEXT_BINDING_REVOKE,
      afterExtra: { reason },
    },
  });
}

// ── 管理读 ─────────────────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true,
  provider: true,
  providerTenantId: true,
  providerChannelId: true,
  bindingLevel: true,
  providerThreadId: true,
  orgId: true,
  projectId: true,
  customerId: true,
  contextRole: true,
  status: true,
  createdById: true,
  disabledAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChannelContextBindingSelect;

/**
 * §24 管理列表：binding.orgId == managementOrg 且逐条要求
 * ownership ∈ {OWNED, INACTIVE} ∧ caller 可管理该 target；其余不可见。
 */
export async function listChannelBindingsForAdmin(input: {
  caller: BindingServiceCaller;
  managementOrgId: string;
  projectId?: string;
  customerId?: string;
  ownershipDeps?: OwnershipDeps;
}): Promise<{
  ok: true;
  bindings: Prisma.ChannelContextBindingGetPayload<{ select: typeof LIST_SELECT }>[];
}> {
  const { db } = await import("@/lib/db");
  const rows = await db.channelContextBinding.findMany({
    where: {
      orgId: input.managementOrgId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: LIST_SELECT,
  });
  const visible: typeof rows = [];
  for (const row of rows) {
    const ownership = await resolveBindingOwnership(
      row,
      input.managementOrgId,
      input.ownershipDeps,
    );
    if (!MANAGEABLE_OWNERSHIP.includes(ownership)) continue;
    if (
      !(await callerCanManageBindingTarget(input.caller, {
        projectId: row.projectId,
        customerId: row.customerId,
        orgId: row.orgId,
      }))
    ) {
      continue;
    }
    visible.push(row);
  }
  return { ok: true, bindings: visible };
}
