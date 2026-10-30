/**
 * Security-1：统一 authorize()
 *
 * DENY 语义（V1，已锁定）：
 * 同一 permission 存在任意 DENY binding → 整个 permission 拒绝，
 * 不是按 scope 局部拒绝。例如 ALLOW:ORG + DENY:PRINCIPAL → 全部拒绝。
 */

import { getPermissionDefinition, isKnownPermission } from "./permissions";
import {
  resolveEffectiveBindings,
  type EffectiveBinding,
} from "./resolve-effective-permissions";
import {
  ACTIVE_DATA_SCOPES,
  RESERVED_DATA_SCOPES,
  type AuthorizeResource,
  type AuthorizeResult,
  type DataScope,
  type PrincipalRef,
} from "./types";

function scopeMatchesResource(
  scope: DataScope,
  principal: PrincipalRef,
  resource?: AuthorizeResource,
): boolean {
  if (scope === "NONE") return false;
  if (scope === "ORG") {
    return !resource || resource.orgId === principal.orgId;
  }
  if (!resource) {
    return scope === "PRINCIPAL" || scope === "ASSIGNED";
  }
  if (resource.orgId !== principal.orgId) return false;
  const subjectId = scopeSubjectId(principal);
  if (!subjectId) return false;
  if (scope === "PRINCIPAL") {
    return resource.ownerId === subjectId;
  }
  if (scope === "ASSIGNED") {
    return resource.assignedToId === subjectId;
  }
  return false;
}

/**
 * PERM-5b：PRINCIPAL / ASSIGNED 范围按谁判——人类按本人；数字员工按 sponsor（拍板 1），
 * 资源 owner = Agent id 本身不算；无 sponsor 时这两种范围永不命中。
 */
export function scopeSubjectId(principal: PrincipalRef): string | null {
  if (principal.type === "HUMAN") return principal.id;
  return principal.sponsorUserId ?? null;
}

/** 纯决策：便于单测 DENY / Scope（不读库） */
export function decideFromBindings(opts: {
  principal: PrincipalRef;
  permission: string;
  bindings: EffectiveBinding[];
  resource?: AuthorizeResource;
}): AuthorizeResult {
  // PERM-5b：数字员工禁区——键不允许该主体类型即拒，先于绑定判定
  const definition = getPermissionDefinition(opts.permission);
  if (definition && !definition.allowedPrincipalTypes.includes(opts.principal.type)) {
    return {
      allowed: false,
      permission: opts.permission,
      scopes: [],
      sourceBindings: [],
      reasonCode: "PRINCIPAL_TYPE_NOT_ALLOWED",
    };
  }

  const relevant = opts.bindings.filter(
    (b) => b.permissionKey === opts.permission,
  );
  if (relevant.length === 0) {
    return {
      allowed: false,
      permission: opts.permission,
      scopes: [],
      sourceBindings: [],
      reasonCode: "NO_BINDING",
    };
  }

  // DENY = permission 级全局拒绝（非 scope-aware）
  const denied = relevant.find((b) => b.effect === "DENY");
  if (denied) {
    return {
      allowed: false,
      permission: opts.permission,
      scopes: [denied.dataScope],
      sourceBindings: [denied.source],
      reasonCode: "EXPLICIT_DENY",
    };
  }

  const allows = relevant.filter((b) => b.effect === "ALLOW");
  for (const b of allows) {
    if (RESERVED_DATA_SCOPES.includes(b.dataScope)) {
      return {
        allowed: false,
        permission: opts.permission,
        scopes: [b.dataScope],
        sourceBindings: [b.source],
        reasonCode: "SCOPE_NOT_IMPLEMENTED",
      };
    }
    if (!ACTIVE_DATA_SCOPES.includes(b.dataScope)) {
      return {
        allowed: false,
        permission: opts.permission,
        scopes: [b.dataScope],
        sourceBindings: [b.source],
        reasonCode: "SCOPE_NOT_IMPLEMENTED",
      };
    }
    if (b.dataScope === "NONE") {
      return {
        allowed: false,
        permission: opts.permission,
        scopes: ["NONE"],
        sourceBindings: [b.source],
        reasonCode: "SCOPE_NONE",
      };
    }
  }

  const scopes = [...new Set(allows.map((b) => b.dataScope))];
  const sources = allows.map((b) => b.source);

  if (!opts.resource) {
    // 无 sponsor 的数字员工：PRINCIPAL / ASSIGNED 没有可落的人，不算可用范围
    const hasSubject = scopeSubjectId(opts.principal) !== null;
    const usable = scopes.filter(
      (s) => s !== "NONE" && (hasSubject || (s !== "PRINCIPAL" && s !== "ASSIGNED")),
    );
    if (usable.length === 0) {
      return {
        allowed: false,
        permission: opts.permission,
        scopes,
        sourceBindings: sources,
        reasonCode: "NO_USABLE_SCOPE",
      };
    }
    return {
      allowed: true,
      permission: opts.permission,
      scopes: usable,
      matchedScope: usable.includes("ORG") ? "ORG" : usable[0],
      sourceBindings: sources,
      reasonCode: "ALLOW",
    };
  }

  const order: DataScope[] = ["ORG", "ASSIGNED", "PRINCIPAL"];
  for (const scope of order) {
    if (!scopes.includes(scope)) continue;
    if (scopeMatchesResource(scope, opts.principal, opts.resource)) {
      return {
        allowed: true,
        permission: opts.permission,
        scopes,
        matchedScope: scope,
        sourceBindings: sources,
        reasonCode: "ALLOW",
      };
    }
  }

  return {
    allowed: false,
    permission: opts.permission,
    scopes,
    sourceBindings: sources,
    reasonCode: "RESOURCE_OUT_OF_SCOPE",
  };
}

export async function authorize(opts: {
  principal: PrincipalRef;
  orgId: string;
  permission: string;
  resource?: AuthorizeResource;
}): Promise<AuthorizeResult> {
  if (opts.principal.orgId !== opts.orgId) {
    return {
      allowed: false,
      permission: opts.permission,
      scopes: [],
      sourceBindings: [],
      reasonCode: "ORG_CONTEXT_MISMATCH",
    };
  }
  // PERM-5b：数字员工必须带 sponsor（数据范围落在 sponsor 名下），否则不读库直接拒
  if (opts.principal.type === "DIGITAL_EMPLOYEE" && !opts.principal.sponsorUserId) {
    return {
      allowed: false,
      permission: opts.permission,
      scopes: [],
      sourceBindings: [],
      reasonCode: "SPONSOR_REQUIRED",
    };
  }
  if (!isKnownPermission(opts.permission)) {
    return {
      allowed: false,
      permission: opts.permission,
      scopes: [],
      sourceBindings: [],
      reasonCode: "UNKNOWN_PERMISSION",
    };
  }

  const bindings = await resolveEffectiveBindings(opts.principal);
  return decideFromBindings({
    principal: opts.principal,
    permission: opts.permission,
    bindings,
    resource: opts.resource,
  });
}

/**
 * PERM-5b：主体当前允许的全部权限键（不带资源；DENY 与主体类型禁区已排除）。
 * 给工具授权 canInvokeTool 的 principal.permissionKeys 用。
 */
export async function resolveAllowedPermissionKeys(
  principal: PrincipalRef,
): Promise<string[]> {
  const bindings = await resolveEffectiveBindings(principal);
  const keys = [...new Set(bindings.map((b) => b.permissionKey))];
  return keys.filter(
    (permission) =>
      isKnownPermission(permission) &&
      decideFromBindings({ principal, permission, bindings }).allowed,
  );
}
