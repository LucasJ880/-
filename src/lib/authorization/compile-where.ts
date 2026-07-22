/**
 * Security-1：把已解析的 DataScope 编译为 Prisma where（纯函数，便于单测）
 */

import type { DataScope } from "./types";

export type SalesResourceKind =
  | "sales_customer"
  | "sales_opportunity"
  | "sales_quote";

const RESERVED: ReadonlySet<DataScope> = new Set([
  "GROUP",
  "EXPLICIT",
  "SPONSOR",
  "TEAM",
  "WORKSPACE",
]);

export function compileAuthorizedWhereFromScopes(opts: {
  orgId: string;
  principalId: string;
  scopes: DataScope[];
  resourceType: SalesResourceKind;
}):
  | { ok: true; where: Record<string, unknown> }
  | { ok: false; reasonCode: string } {
  for (const s of opts.scopes) {
    if (RESERVED.has(s)) {
      return { ok: false, reasonCode: "SCOPE_NOT_IMPLEMENTED" };
    }
    if (s === "NONE") {
      return { ok: false, reasonCode: "SCOPE_NONE" };
    }
  }

  if (opts.scopes.includes("ORG")) {
    return { ok: true, where: { orgId: opts.orgId } };
  }

  const orClause: Record<string, unknown>[] = [];
  if (opts.scopes.includes("PRINCIPAL")) {
    orClause.push({ createdById: opts.principalId });
  }
  if (
    opts.scopes.includes("ASSIGNED") &&
    opts.resourceType === "sales_opportunity"
  ) {
    orClause.push({ assignedToId: opts.principalId });
  }

  if (orClause.length === 0) {
    return { ok: false, reasonCode: "NO_USABLE_SCOPE" };
  }

  return {
    ok: true,
    where: {
      orgId: opts.orgId,
      AND: [{ OR: orClause }],
    },
  };
}
