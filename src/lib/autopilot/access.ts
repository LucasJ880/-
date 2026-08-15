/**
 * Autopilot 唯一权限策略（Default Deny）。
 *
 * 身份：canonical User.id ∈ AUTOPILOT_OWNER_USER_IDS
 * 不使用 display name / email / admin 角色旁路。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { requireTenantContext } from "@/lib/tenancy";
import {
  getAutopilotOwnerUserIds,
  isAutopilotEnabled,
  type AutopilotFlagEnv,
} from "./flags";
import {
  AUTOPILOT_CAPABILITIES,
  type AutopilotAccessContext,
  type AutopilotAccessDecision,
  type AutopilotCapability,
} from "./types";

export class AutopilotAccessError extends Error {
  readonly code: AutopilotAccessDecision["reason"];
  readonly httpStatus: number;

  constructor(code: AutopilotAccessDecision["reason"], message = "无权访问") {
    super(message);
    this.name = "AutopilotAccessError";
    this.code = code;
    this.httpStatus = code === "UNAUTHENTICATED" ? 401 : 403;
  }
}

export function isAutopilotCapability(
  value: string,
): value is AutopilotCapability {
  return (AUTOPILOT_CAPABILITIES as readonly string[]).includes(value);
}

export function isAutopilotOwner(
  userId: string | null | undefined,
  env: AutopilotFlagEnv = process.env,
): boolean {
  if (!userId) return false;
  const owners = getAutopilotOwnerUserIds(env);
  if (owners.length === 0) return false;
  return owners.includes(userId);
}

export function evaluateAutopilotAccess(
  input: {
    userId?: string | null;
    role?: string | null;
    capability: AutopilotCapability;
  },
  env: AutopilotFlagEnv = process.env,
): AutopilotAccessDecision {
  if (!isAutopilotCapability(input.capability)) {
    return {
      allowed: false,
      reason: "UNKNOWN_CAPABILITY",
      capability: null,
    };
  }
  if (!input.userId) {
    return {
      allowed: false,
      reason: "UNAUTHENTICATED",
      capability: input.capability,
    };
  }
  if (!isAutopilotEnabled(env)) {
    return {
      allowed: false,
      reason: "FLAG_DISABLED",
      capability: input.capability,
    };
  }
  if (!isAutopilotOwner(input.userId, env)) {
    return {
      allowed: false,
      reason: "NOT_OWNER",
      capability: input.capability,
    };
  }
  // A0：owner 同时拥有 view / runs.read / admin。角色（含 admin）不授予权限。
  void input.role;
  return { allowed: true, reason: "OK", capability: input.capability };
}

export function hasAutopilotCapability(
  user: { id: string; role?: string | null },
  capability: AutopilotCapability,
  env: AutopilotFlagEnv = process.env,
): boolean {
  return evaluateAutopilotAccess(
    { userId: user.id, role: user.role, capability },
    env,
  ).allowed;
}

export function assertAutopilotAccess(
  user: { id: string; role?: string | null } | null,
  capability: AutopilotCapability,
  env: AutopilotFlagEnv = process.env,
): void {
  const decision = evaluateAutopilotAccess(
    {
      userId: user?.id,
      role: user?.role,
      capability,
    },
    env,
  );
  if (decision.allowed) return;
  const code =
    decision.reason === "FLAG_DISABLED"
      ? "AUTOPILOT_DISABLED"
      : decision.reason === "UNAUTHENTICATED"
        ? "UNAUTHENTICATED"
        : "AUTOPILOT_FORBIDDEN";
  const err = new AutopilotAccessError(decision.reason, "无权访问");
  (err as AutopilotAccessError & { publicCode: string }).publicCode = code;
  throw err;
}

export function autopilotForbiddenResponse(
  decision: AutopilotAccessDecision,
): NextResponse {
  const code =
    decision.reason === "FLAG_DISABLED"
      ? "AUTOPILOT_DISABLED"
      : decision.reason === "UNAUTHENTICATED"
        ? "UNAUTHENTICATED"
        : "AUTOPILOT_FORBIDDEN";
  const status = decision.reason === "UNAUTHENTICATED" ? 401 : 403;
  return NextResponse.json({ error: "无权访问", code }, { status });
}

/**
 * API 统一入口。禁止各 route 自行写 Lucas / admin 判断。
 */
export async function requireAutopilotAccess(
  request: NextRequest,
  capability: AutopilotCapability = "autopilot.view",
): Promise<AutopilotAccessContext | NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const decision = evaluateAutopilotAccess({
    userId: auth.user.id,
    role: auth.user.role,
    capability,
  });
  if (!decision.allowed) return autopilotForbiddenResponse(decision);

  const tenant = await requireTenantContext(request);
  if (tenant instanceof NextResponse) return tenant;

  return {
    userId: auth.user.id,
    role: auth.user.role,
    orgId: tenant.orgId,
    capability,
  };
}
