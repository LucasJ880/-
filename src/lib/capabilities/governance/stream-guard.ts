/**
 * Phase 3A-5：流式 AI 调用租户预检 + 会话键
 * 流开始前必须具备可信 TenantContext；body.orgId 不可单独作为信任源。
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { getOrgMembership } from "@/lib/auth";
import { getUserActiveOrgId } from "@/lib/organizations/active-org";
import {
  requireWorkspaceAccess,
  type TenantContext,
} from "@/lib/tenancy";
import { getRequestContext } from "@/lib/common/request-context";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { reserveQuota } from "./reserve";
import { notifyQuotaThreshold } from "./quota-notify";
import type { QuotaEvalResult } from "./types";

export type StreamTenantErrorCode =
  | "NO_MEMBERSHIP"
  | "TENANT_CONTEXT_REQUIRED"
  | "WORKSPACE_ACCESS_DENIED"
  | "ORG_CONTEXT_MISMATCH"
  | "QUOTA_HARD_LIMIT";

const DEFAULT_STREAM_ESTIMATE_USD = 0.05;

export function streamTenantErrorResponse(
  code: StreamTenantErrorCode,
  message: string,
  status = 403,
): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function isNextResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}

/**
 * 可信 orgId 解析顺序：
 * 1) query.orgId（需 membership）
 * 2) 服务端 activeOrgId（需 membership）
 * 3) 唯一 membership
 *
 * body.orgId 仅在与上述可信来源一致时可作为交叉校验；不一致 → ORG_CONTEXT_MISMATCH。
 * Platform Admin 无 membership → NO_MEMBERSHIP（不得绕过）。
 */
export async function requireStreamTenant(
  request: NextRequest,
  opts?: {
    workspaceId?: string | null;
    /** 已解析的 body.orgId，仅用于交叉校验，不作信任源 */
    claimedBodyOrgId?: string | null;
  },
): Promise<TenantContext | NextResponse> {
  const auth = await requireAuth(request);
  if (isNextResponse(auth)) {
    return streamTenantErrorResponse(
      "TENANT_CONTEXT_REQUIRED",
      "未登录",
      401,
    );
  }
  const { user } = auth;

  const queryOrg = request.nextUrl.searchParams.get("orgId")?.trim() || null;
  const activeOrg = await getUserActiveOrgId(user.id);
  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id, status: "active" },
    select: { orgId: true, role: true },
  });
  const memberOrgIds = memberships.map((m) => m.orgId);

  if (memberOrgIds.length === 0) {
    return streamTenantErrorResponse(
      "NO_MEMBERSHIP",
      "未加入任何企业，无法启动企业 AI 流式调用",
      403,
    );
  }

  let orgId: string | null = null;
  if (queryOrg && memberOrgIds.includes(queryOrg)) {
    orgId = queryOrg;
  } else if (activeOrg && memberOrgIds.includes(activeOrg)) {
    orgId = activeOrg;
  } else if (memberOrgIds.length === 1) {
    orgId = memberOrgIds[0];
  }

  if (!orgId) {
    return streamTenantErrorResponse(
      "TENANT_CONTEXT_REQUIRED",
      "缺少可信组织上下文，请先选择当前企业",
      403,
    );
  }

  const claimed = opts?.claimedBodyOrgId?.trim() || null;
  if (claimed && claimed !== orgId) {
    // 若 body 声称的 org 也是成员，仍以服务端 active/query 为准并拒绝错配
    return streamTenantErrorResponse(
      "ORG_CONTEXT_MISMATCH",
      "请求组织与当前工作组织不一致",
      403,
    );
  }

  const membership = await getOrgMembership(user.id, orgId);
  if (!membership || membership.status !== "active") {
    // 平台管理员无 membership 也不得进入
    return streamTenantErrorResponse(
      "NO_MEMBERSHIP",
      "无权以企业成员身份启动流式调用",
      403,
    );
  }

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, code: true, status: true },
  });
  if (!org || org.status === "archived") {
    return streamTenantErrorResponse(
      "TENANT_CONTEXT_REQUIRED",
      "组织不存在或已归档",
      404,
    );
  }

  const tenant: TenantContext = {
    userId: user.id,
    orgId,
    orgSlug: org.code,
    orgRole: membership.role,
    isPlatformAdmin: isSuperAdmin(user.role),
    user,
  };

  if (opts?.workspaceId) {
    const ws = await requireWorkspaceAccess(tenant, opts.workspaceId);
    if (!ws.ok) {
      return streamTenantErrorResponse(
        "WORKSPACE_ACCESS_DENIED",
        "无权访问该 Workspace",
        403,
      );
    }
  }

  const store = getRequestContext();
  if (store) {
    store.orgId = tenant.orgId;
    store.userId = tenant.userId;
  }

  return tenant;
}

export function buildStreamSessionKey(opts: {
  orgId: string;
  userId: string;
  requestId?: string;
  threadId?: string | null;
}): string {
  const req = opts.requestId ?? "noreq";
  const thread = opts.threadId ?? "direct";
  return `stream:${opts.orgId}:${opts.userId}:${thread}:${req}`;
}

export type BeginStreamAiUsageResult =
  | {
      ok: true;
      reservationId: string;
      sessionKey: string;
      estimatedCost: number;
      eval: QuotaEvalResult;
      duplicate: boolean;
    }
  | {
      ok: false;
      code: StreamTenantErrorCode;
      message: string;
      eval?: QuotaEvalResult;
    };

/**
 * 流开始前：配额预留 + soft/warn 通知。hard limit 拒绝。
 */
export async function beginStreamAiUsage(opts: {
  orgId: string;
  userId: string;
  workspaceId?: string | null;
  estimatedCost?: number;
  sessionKey: string;
  runId?: string | null;
  traceId?: string | null;
}): Promise<BeginStreamAiUsageResult> {
  if (!opts.orgId?.trim()) {
    return {
      ok: false,
      code: "TENANT_CONTEXT_REQUIRED",
      message: "缺少可信组织上下文",
    };
  }

  const estimatedCost = opts.estimatedCost ?? DEFAULT_STREAM_ESTIMATE_USD;
  const reserved = await reserveQuota({
    orgId: opts.orgId,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    metric: "MONTHLY_AI_COST",
    amount: estimatedCost,
    idempotencyKey: `stream-reserve:${opts.sessionKey}`,
    runId: opts.runId,
    traceId: opts.traceId,
  });

  if (!reserved.ok) {
    return {
      ok: false,
      code: "QUOTA_HARD_LIMIT",
      message: reserved.error,
      eval: reserved.eval,
    };
  }

  if (
    reserved.eval.level === "WARNING" ||
    reserved.eval.level === "SOFT_LIMIT"
  ) {
    await notifyQuotaThreshold({
      orgId: opts.orgId,
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      metric: "MONTHLY_AI_COST",
      level: reserved.eval.level,
      currentUsage: reserved.eval.currentUsage,
      projectedUsage: reserved.eval.projectedUsage,
      softLimit: reserved.eval.softLimit,
      warningLimit: reserved.eval.warningLimit,
      hardLimit: reserved.eval.hardLimit,
    });
  }

  return {
    ok: true,
    reservationId: reserved.reservationId,
    sessionKey: opts.sessionKey,
    estimatedCost,
    eval: reserved.eval,
    duplicate: reserved.duplicate,
  };
}
