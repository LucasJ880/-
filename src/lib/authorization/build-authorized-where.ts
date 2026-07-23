/**
 * Security-1：把权限 Scope 编译为 Prisma where（销售资源映射）
 */

import { authorize } from "./authorize";
import {
  compileAuthorizedWhereFromScopes,
  type SalesResourceKind,
} from "./compile-where";
import type { DataScope, PrincipalRef } from "./types";

export type { SalesResourceKind };

/**
 * PRINCIPAL → createdById
 * ASSIGNED → assignedToId（仅 opportunity）
 * ORG → 仅 orgId
 */
export async function buildAuthorizedWhere(opts: {
  principal: PrincipalRef;
  orgId: string;
  permission: string;
  resourceType: SalesResourceKind;
}): Promise<
  | { ok: true; where: Record<string, unknown>; scopes: DataScope[] }
  | { ok: false; reasonCode: string }
> {
  const decision = await authorize({
    principal: opts.principal,
    orgId: opts.orgId,
    permission: opts.permission,
  });
  if (!decision.allowed) {
    return { ok: false, reasonCode: decision.reasonCode };
  }

  const compiled = compileAuthorizedWhereFromScopes({
    orgId: opts.orgId,
    principalId: opts.principal.id,
    scopes: decision.scopes,
    resourceType: opts.resourceType,
  });
  if (!compiled.ok) {
    return { ok: false, reasonCode: compiled.reasonCode };
  }
  return { ok: true, where: compiled.where, scopes: decision.scopes };
}

/** 写操作鉴权别名 */
export async function authorizeMutation(opts: Parameters<typeof authorize>[0]) {
  return authorize(opts);
}
