/**
 * Phase 2B：统一配置继承解析
 * Platform → Organization → Workspace → Project
 *
 * 安全/租户隔离/强制审批规则：禁止下层关闭（LOCKED_KEYS）
 */

import { db } from "@/lib/db";
import type { ConfigScope } from "./scope";
import { CONFIG_SCOPE_PRIORITY } from "./scope";

export type ScopedConfigType =
  | "business_rule"
  | "glossary"
  | "business_object"
  | "metric"
  | "skill_binding"
  | "knowledge_binding"
  | "agent_tool_policy";

export type ScopedConfigResult<T> = {
  value: T | null;
  /** ok | missing | locked_platform */
  status: "ok" | "missing" | "locked_platform";
  sourceScope: ConfigScope;
  sourceId: string | null;
  version: number | null;
  message?: string;
};

/** 下层不得关闭的安全键 */
export const LOCKED_SECURITY_KEYS = new Set([
  "require_membership",
  "tenant_isolation",
  "force_approval_l3",
  "disable_cross_tenant",
]);

export type ResolveScopedConfigInput = {
  orgId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  configType: ScopedConfigType;
  /** 业务规则 / skill key / objectKey / metric key / glossary canonical */
  key: string;
};

/**
 * 解析作用域配置。当前实现覆盖：
 * - business_rule → OrgBusinessRule（org 级；workspace 覆盖预留 settingsJson）
 * - skill_binding → WorkspaceSkillBinding → org 默认启用
 * - glossary / business_object / metric → 见各自 service（本函数作统一出口）
 */
export async function resolveScopedConfig(
  input: ResolveScopedConfigInput,
): Promise<ScopedConfigResult<unknown>> {
  const { orgId, workspaceId, configType, key } = input;

  if (LOCKED_SECURITY_KEYS.has(key)) {
    return {
      value: true,
      status: "locked_platform",
      sourceScope: "PLATFORM",
      sourceId: null,
      version: 1,
      message: "安全规则不可被 Workspace/Project 关闭",
    };
  }

  if (configType === "business_rule") {
    const orgRule = await db.orgBusinessRule.findFirst({
      where: { orgId, ruleKey: key, status: "active" },
      orderBy: { version: "desc" },
    });
    if (!orgRule) {
      return {
        value: null,
        status: "missing",
        sourceScope: "ORGANIZATION",
        sourceId: null,
        version: null,
        message: `未配置业务规则 ${key}（禁止静默套用其他企业）`,
      };
    }

    // Workspace 覆盖：仅允许非锁定键，且存在 workspace.settingsJson.rules[key]
    if (workspaceId) {
      const ws = await db.workspace.findFirst({
        where: { id: workspaceId, orgId },
        select: { id: true, settingsJson: true },
      });
      const rules =
        ws?.settingsJson &&
        typeof ws.settingsJson === "object" &&
        !Array.isArray(ws.settingsJson)
          ? (ws.settingsJson as { rules?: Record<string, unknown> }).rules
          : undefined;
      if (rules && Object.prototype.hasOwnProperty.call(rules, key)) {
        return {
          value: rules[key],
          status: "ok",
          sourceScope: "WORKSPACE",
          sourceId: ws!.id,
          version: orgRule.version,
          message: "Workspace 覆盖（安全键除外）",
        };
      }
    }

    return {
      value: orgRule.configJson,
      status: "ok",
      sourceScope: "ORGANIZATION",
      sourceId: orgRule.id,
      version: orgRule.version,
    };
  }

  if (configType === "skill_binding") {
    if (workspaceId) {
      const binding = await db.workspaceSkillBinding.findFirst({
        where: { orgId, workspaceId, skillKey: key },
      });
      if (binding) {
        return {
          value: {
            enabled: binding.enabled,
            params: binding.paramsJson,
            allowOrgRoles: binding.allowOrgRolesJson,
          },
          status: "ok",
          sourceScope: "WORKSPACE",
          sourceId: binding.id,
          version: 1,
        };
      }
    }
    // 未绑定 = Organization 默认启用（平台 skill 目录存在即允许）
    return {
      value: { enabled: true, params: null, allowOrgRoles: null },
      status: "ok",
      sourceScope: "ORGANIZATION",
      sourceId: null,
      version: null,
      message: "无 Workspace 绑定，使用企业默认启用",
    };
  }

  return {
    value: null,
    status: "missing",
    sourceScope: CONFIG_SCOPE_PRIORITY[0],
    sourceId: null,
    version: null,
    message: `configType=${configType} 请使用专用 service 解析`,
  };
}

/** Workspace 是否允许执行某 Skill */
export async function isWorkspaceSkillEnabled(params: {
  orgId: string;
  workspaceId: string;
  skillKey: string;
  orgRole: string;
}): Promise<{ ok: boolean; reason?: string; sourceScope: ConfigScope }> {
  const resolved = await resolveScopedConfig({
    orgId: params.orgId,
    workspaceId: params.workspaceId,
    configType: "skill_binding",
    key: params.skillKey,
  });
  const val = resolved.value as {
    enabled?: boolean;
    allowOrgRoles?: string[] | null;
  } | null;
  if (!val || val.enabled === false) {
    return {
      ok: false,
      reason: "Workspace 未启用该 Skill",
      sourceScope: resolved.sourceScope,
    };
  }
  if (
    Array.isArray(val.allowOrgRoles) &&
    val.allowOrgRoles.length > 0 &&
    !val.allowOrgRoles.includes(params.orgRole)
  ) {
    return {
      ok: false,
      reason: "当前 orgRole 不在 Skill 允许列表",
      sourceScope: resolved.sourceScope,
    };
  }
  return { ok: true, sourceScope: resolved.sourceScope };
}
