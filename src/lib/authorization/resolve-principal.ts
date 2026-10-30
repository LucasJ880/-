/**
 * Security-1：解析 Principal
 * PERM-5b：DIGITAL_EMPLOYEE 必须带 sponsor（数据范围落在 sponsor 名下）；
 * 从 Agent 记录解析数字员工见 ./digital-employee.ts resolveDigitalEmployeePrincipal。
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
    if (!opts.sponsorUserId) {
      return {
        ok: false,
        result: {
          allowed: false,
          permission: "*",
          scopes: [],
          sourceBindings: [],
          reasonCode: "SPONSOR_REQUIRED",
        },
      };
    }
    return {
      ok: true,
      principal: {
        type: "DIGITAL_EMPLOYEE",
        id: opts.id,
        orgId: opts.orgId,
        sponsorUserId: opts.sponsorUserId,
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
