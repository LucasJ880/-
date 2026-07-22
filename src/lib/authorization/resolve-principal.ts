/**
 * Security-1：解析 Principal（当前仅 HUMAN）
 */

import type { AuthUser } from "@/lib/auth";
import type { AuthorizeResult, PrincipalRef } from "./types";

export function humanPrincipal(user: AuthUser, orgId: string): PrincipalRef {
  return { type: "HUMAN", id: user.id, orgId };
}

export function resolvePrincipalRef(opts: {
  type: string;
  id: string;
  orgId: string;
  sponsorUserId?: string;
}):
  | { ok: true; principal: PrincipalRef }
  | { ok: false; result: AuthorizeResult } {
  if (opts.type === "HUMAN") {
    return {
      ok: true,
      principal: {
        type: "HUMAN",
        id: opts.id,
        orgId: opts.orgId,
      },
    };
  }
  if (opts.type === "DIGITAL_EMPLOYEE") {
    return {
      ok: false,
      result: {
        allowed: false,
        permission: "*",
        scopes: [],
        sourceBindings: [],
        reasonCode: "NOT_IMPLEMENTED",
      },
    };
  }
  return {
    ok: false,
    result: {
      allowed: false,
      permission: "*",
      scopes: [],
      sourceBindings: [],
      reasonCode: "UNKNOWN_PRINCIPAL_TYPE",
    },
  };
}
