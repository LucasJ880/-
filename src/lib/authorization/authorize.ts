/**
 * Security-1：统一 authorize()
 */

import { isKnownPermission } from "./permissions";
import { resolveEffectiveBindings } from "./resolve-effective-permissions";
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
    // 列表级：有 PRINCIPAL/ASSIGNED/ORG 即允许进入查询构建
    return scope === "PRINCIPAL" || scope === "ASSIGNED";
  }
  if (resource.orgId !== principal.orgId) return false;
  if (scope === "PRINCIPAL") {
    return resource.ownerId === principal.id;
  }
  if (scope === "ASSIGNED") {
    return resource.assignedToId === principal.id;
  }
  return false;
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
  if (opts.principal.type !== "HUMAN") {
    return {
      allowed: false,
      permission: opts.permission,
      scopes: [],
      sourceBindings: [],
      reasonCode: "NOT_IMPLEMENTED",
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
  const relevant = bindings.filter((b) => b.permissionKey === opts.permission);
  if (relevant.length === 0) {
    return {
      allowed: false,
      permission: opts.permission,
      scopes: [],
      sourceBindings: [],
      reasonCode: "NO_BINDING",
    };
  }

  // DENY 优先
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

  // 列表级（无 resource）：任一启用 Scope 即允许
  if (!opts.resource) {
    const usable = scopes.filter((s) => s !== "NONE");
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
      matchedScope: usable.includes("ORG")
        ? "ORG"
        : usable[0],
      sourceBindings: sources,
      reasonCode: "ALLOW",
    };
  }

  // 资源级：按 ORG → ASSIGNED → PRINCIPAL 匹配
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
