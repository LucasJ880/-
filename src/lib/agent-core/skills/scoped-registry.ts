/**
 * Scope-owned Skill Registry — 扩展现有 AgentSkill，不新建第二套 Registry。
 *
 * 有效工具权限 = 调用者工具 ∩ Skill.requiredTools（取交集）
 */

import type { ScopeContext } from "@/lib/scope";
import { intersectToolAllowlists } from "@/lib/agent-harness";

export type SkillOwnerScope = "SYSTEM" | "ORG" | "PROJECT" | "USER";

export type SkillLifecycleStatus =
  | "DRAFT"
  | "TESTING"
  | "ACTIVE"
  | "SUSPENDED"
  | "ARCHIVED";

export type ScopedSkillRecord = {
  id: string;
  slug: string;
  orgId: string;
  ownerScopeType: SkillOwnerScope;
  ownerScopeId: string | null;
  version: number;
  lifecycleStatus: SkillLifecycleStatus;
  /** 历史字段：false 时不可执行 */
  isActive: boolean;
  isBuiltin: boolean;
  requiredTools: string[];
  riskLevel: string;
  approvalMode: string;
  publishedBy?: string | null;
  approvedBy?: string | null;
};

export type SkillExecDenyReason =
  | "not_found"
  | "suspended"
  | "archived"
  | "draft"
  | "inactive"
  | "unapproved_org_skill"
  | "cross_project"
  | "cross_org"
  | "user_scope_mismatch"
  | "not_active_lifecycle";

export type SkillResolveResult =
  | {
      ok: true;
      skill: ScopedSkillRecord;
      effectiveTools: string[];
    }
  | {
      ok: false;
      reason: SkillExecDenyReason;
      message: string;
    };

const EXECUTABLE: SkillLifecycleStatus[] = ["ACTIVE", "TESTING"];

export function parseRequiredTools(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function mapAgentSkillRow(row: {
  id: string;
  slug: string;
  orgId: string;
  version: number;
  isActive: boolean;
  isBuiltin: boolean;
  requiredTools?: string | null;
  ownerScopeType?: string | null;
  ownerScopeId?: string | null;
  lifecycleStatus?: string | null;
  riskLevel?: string | null;
  approvalMode?: string | null;
  publishedBy?: string | null;
  approvedBy?: string | null;
}): ScopedSkillRecord {
  const ownerScopeType = (row.ownerScopeType ??
    (row.isBuiltin ? "SYSTEM" : "ORG")) as SkillOwnerScope;
  return {
    id: row.id,
    slug: row.slug,
    orgId: row.orgId,
    ownerScopeType,
    ownerScopeId: row.ownerScopeId ?? (ownerScopeType === "ORG" ? row.orgId : null),
    version: row.version,
    lifecycleStatus: (row.lifecycleStatus ?? "ACTIVE") as SkillLifecycleStatus,
    isActive: row.isActive,
    isBuiltin: row.isBuiltin,
    requiredTools: parseRequiredTools(row.requiredTools),
    riskLevel: row.riskLevel ?? "low",
    approvalMode: row.approvalMode ?? "inherit",
    publishedBy: row.publishedBy,
    approvedBy: row.approvedBy,
  };
}

/**
 * 在给定 Scope 下解析技能是否可执行，并计算有效工具交集。
 * callerToolAllowlist：调用者已有工具权限（服务端计算）。
 */
export function resolveScopedSkill(input: {
  skill: ScopedSkillRecord | null | undefined;
  scope: ScopeContext;
  callerToolAllowlist: string[];
}): SkillResolveResult {
  const skill = input.skill;
  if (!skill) {
    return { ok: false, reason: "not_found", message: "技能不存在" };
  }

  if (skill.orgId !== input.scope.orgId && skill.ownerScopeType !== "SYSTEM") {
    return { ok: false, reason: "cross_org", message: "技能不属于当前组织" };
  }

  if (!skill.isActive) {
    return { ok: false, reason: "inactive", message: "技能已停用" };
  }

  if (skill.lifecycleStatus === "SUSPENDED") {
    return { ok: false, reason: "suspended", message: "技能已挂起" };
  }
  if (skill.lifecycleStatus === "ARCHIVED") {
    return { ok: false, reason: "archived", message: "技能已归档" };
  }
  if (skill.lifecycleStatus === "DRAFT") {
    return { ok: false, reason: "draft", message: "草稿技能不可执行" };
  }
  if (!EXECUTABLE.includes(skill.lifecycleStatus)) {
    return {
      ok: false,
      reason: "not_active_lifecycle",
      message: "技能状态不可执行",
    };
  }

  // ORG 技能需管理员批准（approvedBy）后才可在非 TESTING 执行
  if (
    skill.ownerScopeType === "ORG" &&
    !skill.isBuiltin &&
    skill.lifecycleStatus === "ACTIVE" &&
    !skill.approvedBy
  ) {
    return {
      ok: false,
      reason: "unapproved_org_skill",
      message: "组织技能未经管理员批准",
    };
  }

  switch (skill.ownerScopeType) {
    case "SYSTEM":
      break;
    case "ORG":
      if (skill.ownerScopeId && skill.ownerScopeId !== input.scope.orgId) {
        return { ok: false, reason: "cross_org", message: "ORG 技能 scope 不匹配" };
      }
      break;
    case "PROJECT": {
      const pid = input.scope.projectId;
      if (!pid || !skill.ownerScopeId || skill.ownerScopeId !== pid) {
        return {
          ok: false,
          reason: "cross_project",
          message: "项目技能不能跨项目执行",
        };
      }
      break;
    }
    case "USER": {
      if (
        !skill.ownerScopeId ||
        skill.ownerScopeId !== input.scope.principalUserId
      ) {
        return {
          ok: false,
          reason: "user_scope_mismatch",
          message: "用户技能不可被他人执行",
        };
      }
      break;
    }
    default:
      return {
        ok: false,
        reason: "not_active_lifecycle",
        message: "未知 ownerScopeType",
      };
  }

  // 技能不得扩大调用者权限：取交集
  const effectiveTools = intersectToolAllowlists(
    input.callerToolAllowlist,
    skill.requiredTools.length > 0 ? skill.requiredTools : input.callerToolAllowlist,
  );

  return { ok: true, skill, effectiveTools };
}

/** USER 技能不得自动升级为 ORG 共享 */
export function assertUserSkillNotEscalated(skill: ScopedSkillRecord): boolean {
  if (skill.ownerScopeType !== "USER") return true;
  return skill.ownerScopeId !== skill.orgId;
}
