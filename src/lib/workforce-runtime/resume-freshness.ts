/**
 * T5-P0C §11/§12 — Resume 三道 freshness 门（TOCTOU 防护）
 *
 * 核心事实：**批准时允许 ≠ 恢复执行时仍允许**。审批可能在数小时前发生，
 * 期间人员离职、项目转组织、模块/工具策略被关停都可能发生。
 * 因此这三道门必须在**真正恢复执行之前**重查，而不是只在 Approve API 查一次。
 *
 *   A. Actor freshness   —— 执行主体仍 active、仍属该 org、仍具所需角色
 *   B. Scope freshness   —— 关联 Project/Tender 仍属原 org、未被删除/转移
 *   C. Policy freshness  —— 当前 tool/module policy 仍允许该 run 的域
 *
 * 语义纪律：APPROVAL_STALE / SCOPE_STALE / POLICY_STALE 三者**互不混同**，
 * 且与既有 `approval_rejected`（人工拒绝）、`approval_expired`（超时）
 * 保持正交——过期 ≠ 拒绝 ≠ 陈旧，绝不折叠成同一个状态。
 *
 * 本模块纯判定 + 只读查询，不写库；park 动作由 resume.ts 复用既有 CAS 形状执行。
 */

import { db } from "@/lib/db";
import { canInvokeTool } from "@/lib/tenancy/tool-auth";
import {
  resolveWorkforceExecutionPolicy,
  type WorkforceExecutionPolicy,
} from "./execution-policy";
import { resolveExecutionPolicyTool } from "./execution-descriptor";

export type FreshnessGateCode =
  | "ACTOR_STALE"
  | "SCOPE_STALE"
  | "POLICY_STALE";

export type FreshnessResult =
  | { ok: true; policy: WorkforceExecutionPolicy | null }
  | { ok: false; code: FreshnessGateCode; reason: string };

/**
 * 门 A：Actor / Membership freshness。
 * 注：resolveRuntimeV2Principal 已在 resume 步骤 4 校验 user.active + membership.active；
 * 本门补充**角色能力**维度——审批后被降级为 viewer 的执行主体不得继续写操作。
 */
export async function checkActorFreshness(input: {
  orgId: string;
  userId: string;
}): Promise<FreshnessResult> {
  const membership = await db.organizationMember
    .findFirst({
      where: { orgId: input.orgId, userId: input.userId },
      select: { role: true, status: true },
    })
    .catch(() => null);
  if (!membership) {
    return {
      ok: false,
      code: "ACTOR_STALE",
      reason: "MEMBERSHIP_MISSING_AT_RESUME",
    };
  }
  if (membership.status !== "active") {
    return {
      ok: false,
      code: "ACTOR_STALE",
      reason: `MEMBERSHIP_NOT_ACTIVE:${membership.status}`,
    };
  }
  // viewer 在批准之后被降级 → 不得恢复执行任何写/分析动作
  if (membership.role === "org_viewer") {
    return {
      ok: false,
      code: "ACTOR_STALE",
      reason: "ROLE_DOWNGRADED_TO_VIEWER",
    };
  }
  return { ok: true, policy: null };
}

/**
 * 门 B：Scope freshness。
 * run metadata 里的 projectId 仍须存在、仍属同一 org（防止审批后项目被移交/删除）。
 * 无 projectId 的 run（非项目域）直接通过——不制造假门。
 */
export async function checkScopeFreshness(input: {
  orgId: string;
  runMetadata: Record<string, unknown> | null | undefined;
}): Promise<FreshnessResult> {
  const meta = input.runMetadata ?? {};
  const projectId =
    typeof meta.projectId === "string" && meta.projectId.trim()
      ? meta.projectId.trim()
      : null;
  if (!projectId) return { ok: true, policy: null };

  const project = await db.project
    .findUnique({
      where: { id: projectId },
      select: { id: true, orgId: true, workDomain: true },
    })
    .catch(() => null);
  if (!project) {
    return { ok: false, code: "SCOPE_STALE", reason: "PROJECT_MISSING" };
  }
  if (project.orgId !== input.orgId) {
    return {
      ok: false,
      code: "SCOPE_STALE",
      reason: "PROJECT_ORG_CHANGED",
    };
  }
  // workDomain 漂移（如 tender → general）会让原计划的工具域失去依据
  const metaDomain =
    typeof meta.workDomain === "string" ? meta.workDomain.trim() : null;
  if (metaDomain && project.workDomain && metaDomain !== project.workDomain) {
    return {
      ok: false,
      code: "SCOPE_STALE",
      reason: `WORK_DOMAIN_CHANGED:${metaDomain}->${project.workDomain}`,
    };
  }
  return { ok: true, policy: null };
}

/**
 * T5-P0C-B1：解析"本次批准后准备恢复执行的具体工具"。
 *
 * 只从 **server 持久化数据** 推断，绝不接受调用方传入的 tool name：
 *   awaiting_approval / ready 的 AgentRunStep → preferredTool
 * 返回空数组表示本次恢复不涉及具体工具（如纯 synthesis 或无待执行步骤）。
 */
export async function resolveResumeTargetTools(input: {
  orgId: string;
  runId: string;
}): Promise<string[]> {
  const steps = await db.agentRunStep
    .findMany({
      where: {
        runId: input.runId,
        orgId: input.orgId,
        status: { in: ["awaiting_approval", "ready", "pending"] },
      },
      select: { preferredTool: true },
    })
    .catch(() => [] as Array<{ preferredTool: string | null }>);
  const names = steps
    .map((s) => (s.preferredTool ?? "").trim())
    .filter((n) => n.length > 0);
  return Array.from(new Set(names));
}

/**
 * 门 C：Policy freshness。
 *
 * **强制重取**（forceRefresh）——绝不复用执行期 TTL 缓存，
 * 否则等于用旧策略快照恢复执行，正是本门要防的事。
 *
 * T5-P0C-B2：仅证明"策略上下文存在"不足以判 PASS。
 * 必须对**本次将要恢复执行的真实工具**再跑一次 canonical `canInvokeTool()`，
 * 使用 fresh actor / org / workspaceIds / modulesJson / toolPolicy /
 * workDomain→toolDomain / 真实执行 descriptor。
 * 当前不允许 → POLICY_STALE（不 requeue、不执行任何工具）。
 */
export async function checkPolicyFreshness(input: {
  orgId: string;
  runId: string;
  userId: string;
  role: string | null | undefined;
  runMetadata: Record<string, unknown> | null | undefined;
  /** 覆盖待恢复工具集（测试注入用；生产由 resolveResumeTargetTools 解析） */
  targetTools?: string[];
}): Promise<FreshnessResult> {
  const policy = await resolveWorkforceExecutionPolicy({
    orgId: input.orgId,
    runId: input.runId,
    userId: input.userId,
    role: input.role,
    runMetadata: input.runMetadata,
    forceRefresh: true,
  });
  if (!policy) {
    return {
      ok: false,
      code: "POLICY_STALE",
      reason: "POLICY_CONTEXT_UNAVAILABLE",
    };
  }
  if (!policy.hasMembership) {
    return { ok: false, code: "POLICY_STALE", reason: "NO_MEMBERSHIP" };
  }

  const tools =
    input.targetTools ??
    (await resolveResumeTargetTools({ orgId: input.orgId, runId: input.runId }));

  for (const toolName of tools) {
    // 执行策略 descriptor 缺失 → 与执行期同纪律 fail-closed（不猜风险）
    const policyTool = resolveExecutionPolicyTool(toolName);
    if (!policyTool.ok) {
      return {
        ok: false,
        code: "POLICY_STALE",
        reason: `${policyTool.code}:${toolName}`,
      };
    }
    const decision = canInvokeTool({
      tenant: {
        userId: input.userId,
        orgId: input.orgId,
        orgRole:
          policy.orgRole === "org_owner" ? "org_admin" : (policy.orgRole ?? ""),
        isPlatformAdmin: policy.isPlatformAdmin,
        workspaceIds: policy.workspaceIds,
      },
      hasMembership: policy.hasMembership,
      tool: {
        name: toolName,
        domain: policy.toolDomain,
        risk: policyTool.risk,
        allowRoles: policy.allowRoles,
      },
      modulesJson: policy.modulesJson,
      toolPolicy: policy.toolPolicy,
      maxRisk: "l2_soft",
    });
    if (!decision.ok) {
      return {
        ok: false,
        code: "POLICY_STALE",
        reason: `TOOL_NOT_ALLOWED_NOW:${toolName}:${decision.code}`,
      };
    }
  }

  return { ok: true, policy };
}

/** 顺序执行三道门；任一失败即返回（fail-closed，不继续查后续门） */
export async function checkResumeFreshness(input: {
  orgId: string;
  runId: string;
  userId: string;
  role: string | null | undefined;
  runMetadata: Record<string, unknown> | null | undefined;
}): Promise<FreshnessResult> {
  const actor = await checkActorFreshness({
    orgId: input.orgId,
    userId: input.userId,
  });
  if (!actor.ok) return actor;

  const scope = await checkScopeFreshness({
    orgId: input.orgId,
    runMetadata: input.runMetadata,
  });
  if (!scope.ok) return scope;

  return checkPolicyFreshness(input);
}
