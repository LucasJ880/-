/**
 * 销售 CRM 组织上下文 — 与外贸模块 resolveTradeOrgId 规则一致（复用实现）。
 *
 * Security-1：数据范围改走统一 authorize()，不再用 org_admin ≡ 全部业务数据。
 *
 * - 日常业务以 User.activeOrgId 为准（FIXED / MULTI_ORG 均不询问）
 * - body/query orgId 仅交叉校验，不可覆盖 activeOrgId（不一致 → ORG_CONTEXT_MISMATCH）
 * - 平台管理员跨组织操作必须显式 orgId，且仅校验组织存在
 * - 禁止默认 fallback 到「任意组织」；禁止仅信任裸 body.orgId（须走 resolve）
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { AuthUser } from "@/lib/auth";
import {
  authorize,
  buildAuthorizedWhere,
  humanPrincipal,
  type DataScope,
  type SalesResourceKind,
} from "@/lib/authorization";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/rbac/roles";
import { resolveTradeOrgId, type TradeOrgResolution } from "@/lib/trade/access";

export type { TradeOrgResolution as SalesOrgResolution } from "@/lib/trade/access";

export async function resolveSalesOrgIdForRequest(
  request: NextRequest,
  user: AuthUser,
  opts?: { bodyOrgId?: string | null },
): Promise<TradeOrgResolution> {
  return resolveTradeOrgId(request, user, opts);
}

export type SalesScopeResult = {
  /** true = 非 ORG scope（兼容旧调用方） */
  ownOnly: boolean;
  allowed: boolean;
  scopes: DataScope[];
  reasonCode: string;
};

/**
 * 解析调用者在指定 org 内的数据可见范围（Security-1）。
 *
 * - 平台 admin / super_admin：ownOnly=false（支持排查；不授予 org_admin 业务特权）
 * - 其余：authorize(permission)；含 ORG → ownOnly=false；仅 PRINCIPAL/ASSIGNED → ownOnly=true
 * - org_admin 默认无销售权限 → allowed=false（不再因角色看全量）
 */
export async function resolveSalesScope(
  user: AuthUser,
  orgId: string,
  permission: string = "sales.customer.read",
): Promise<SalesScopeResult> {
  if (isAdmin(user.role)) {
    return {
      ownOnly: false,
      allowed: true,
      scopes: ["ORG"],
      reasonCode: "PLATFORM_ADMIN",
    };
  }

  const principal = humanPrincipal(user, orgId);
  const decision = await authorize({
    principal,
    orgId,
    permission,
  });

  if (!decision.allowed) {
    return {
      ownOnly: true,
      allowed: false,
      scopes: [],
      reasonCode: decision.reasonCode,
    };
  }

  return {
    ownOnly: !decision.scopes.includes("ORG"),
    allowed: true,
    scopes: decision.scopes,
    reasonCode: decision.reasonCode,
  };
}

/**
 * 列表查询：编译授权 where。失败时调用方应 403。
 */
export async function resolveSalesAuthorizedWhere(
  user: AuthUser,
  orgId: string,
  permission: string,
  resourceType: SalesResourceKind,
): Promise<
  | { ok: true; where: Record<string, unknown>; scopes: DataScope[]; ownOnly: boolean }
  | { ok: false; reasonCode: string; response: NextResponse }
> {
  if (isAdmin(user.role)) {
    return {
      ok: true,
      where: { orgId },
      scopes: ["ORG"],
      ownOnly: false,
    };
  }
  const principal = humanPrincipal(user, orgId);
  const built = await buildAuthorizedWhere({
    principal,
    orgId,
    permission,
    resourceType,
  });
  if (!built.ok) {
    return {
      ok: false,
      reasonCode: built.reasonCode,
      response: NextResponse.json(
        { error: "无权访问销售数据", code: built.reasonCode },
        { status: 403 },
      ),
    };
  }
  return {
    ok: true,
    where: built.where,
    scopes: built.scopes,
    ownOnly: !built.scopes.includes("ORG"),
  };
}

/**
 * 生成销售实体列表/聚合查询的统一 where 片段（含组织边界 + own-scope）。
 *
 * - 始终包含 `orgId`。
 * - ownOnly=true 时：
 *   - opportunity：用 `OR: [{ createdById }, { assignedToId }]`（包进 AND，避免覆盖调用方已有的顶层 OR）
 *   - customer / quote：用 `createdById`
 *
 * 调用方可把返回对象展开后再叠加自己的过滤键（stage/status/日期等）。
 */
export function buildSalesScopeWhere(
  userId: string,
  orgId: string,
  ownOnly: boolean,
  kind: "customer" | "opportunity" | "quote",
): Record<string, unknown> {
  const where: Record<string, unknown> = { orgId };
  if (!ownOnly) return where;
  if (kind === "opportunity") {
    where.AND = [{ OR: [{ createdById: userId }, { assignedToId: userId }] }];
  } else {
    where.createdById = userId;
  }
  return where;
}

/**
 * 校验 opportunity 属于 orgId，并以 authorize 校验资源级权限。
 * 跨组织/不存在 → 404；无权 → 403。
 */
export async function assertSalesOpportunityInOrgForMutation(
  opportunityId: string,
  orgId: string,
  opts?: {
    userId?: string;
    ownOnly?: boolean;
    user?: AuthUser;
    permission?: string;
  },
): Promise<
  | {
      ok: true;
      opportunity: {
        id: string;
        orgId: string | null;
        createdById: string;
        assignedToId: string | null;
      };
    }
  | { ok: false; response: NextResponse }
> {
  const opp = await db.salesOpportunity.findFirst({
    where: { id: opportunityId, orgId },
    select: { id: true, orgId: true, createdById: true, assignedToId: true },
  });
  if (!opp) {
    return {
      ok: false,
      response: NextResponse.json({ error: "机会不存在" }, { status: 404 }),
    };
  }

  if (opts?.user && !isAdmin(opts.user.role)) {
    const decision = await authorize({
      principal: humanPrincipal(opts.user, orgId),
      orgId,
      permission: opts.permission ?? "sales.opportunity.read",
      resource: {
        type: "sales_opportunity",
        id: opp.id,
        ownerId: opp.createdById,
        assignedToId: opp.assignedToId,
        orgId,
      },
    });
    if (!decision.allowed) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "无权访问该机会", code: decision.reasonCode },
          { status: 403 },
        ),
      };
    }
    return { ok: true, opportunity: opp };
  }

  if (
    opts?.ownOnly &&
    opts.userId &&
    opp.createdById !== opts.userId &&
    opp.assignedToId !== opts.userId
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "无权访问该机会" }, { status: 403 }),
    };
  }
  return { ok: true, opportunity: opp };
}

/**
 * Appointment 表无 orgId，统一通过 customer.orgId 关系过滤后加载。
 * 返回 null 表示跨组织或不存在（调用方据此返回 404）。
 */
export async function loadAppointmentForOrg(
  appointmentId: string,
  orgId: string,
): Promise<{
  id: string;
  assignedToId: string;
  createdById: string;
  customer: { orgId: string | null; createdById: string };
} | null> {
  return db.appointment.findFirst({
    where: { id: appointmentId, customer: { orgId } },
    select: {
      id: true,
      assignedToId: true,
      createdById: true,
      customer: { select: { orgId: true, createdById: true } },
    },
  });
}

/** 判断用户是否为该 appointment 的「own」相关人（assignee / 创建人 / 客户创建人）。 */
export function isAppointmentOwn(
  appt: {
    assignedToId: string;
    createdById: string;
    customer: { createdById: string };
  },
  userId: string,
): boolean {
  return (
    appt.assignedToId === userId ||
    appt.createdById === userId ||
    appt.customer.createdById === userId
  );
}

export async function getActiveOrgMemberUserIds(orgId: string): Promise<string[]> {
  const rows = await db.organizationMember.findMany({
    where: { orgId, status: "active" },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * 创建商机 / 报价 / 互动前：客户必须属于当前 org，且调用方对客户有权限。
 * A2-3 起：严格要求 customer.orgId === orgId（orgId 为空不再容忍）。
 *
 * Security-1：传入 user 时走 authorize（禁止仅凭同组织 ID 越权写）。
 * 未传 user 的内部转换路径仍只校验组织边界。
 */
export async function assertSalesCustomerInOrgForMutation(
  customer: { orgId: string | null; createdById: string; id?: string },
  orgId: string,
  opts?: { user?: AuthUser; permission?: string },
): Promise<NextResponse | null> {
  if (customer.orgId !== orgId) {
    return NextResponse.json({ error: "客户不属于当前组织" }, { status: 403 });
  }
  if (opts?.user && !isAdmin(opts.user.role)) {
    const decision = await authorize({
      principal: humanPrincipal(opts.user, orgId),
      orgId,
      permission: opts.permission ?? "sales.customer.read",
      resource: {
        type: "sales_customer",
        id: customer.id,
        ownerId: customer.createdById,
        orgId,
      },
    });
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "无权访问该客户", code: decision.reasonCode },
        { status: 403 },
      );
    }
  }
  return null;
}

/**
 * convert-to-sales 等内部流程：校验失败时抛 Error。
 * A2-3 起：严格要求 customer.orgId === orgId（orgId 为空不再容忍）。
 */
export async function assertSalesCustomerInOrgOrThrowForConvert(
  customer: { id: string; orgId: string | null; createdById: string },
  orgId: string,
): Promise<void> {
  if (customer.orgId !== orgId) {
    throw new Error("该销售客户不属于当前组织下的销售数据范围");
  }
}

/**
 * 公开报价签字等无「当前请求 org」场景：为 CustomerInteraction 推断 orgId。
 * 优先 quote.orgId → customer.orgId → 创建人仅属单一 active org 时取该 org。
 */
export async function resolveOrgIdForQuoteLinkedInteraction(params: {
  quoteOrgId: string | null;
  customerId: string;
  createdById: string;
}): Promise<string | null> {
  if (params.quoteOrgId) return params.quoteOrgId;
  const c = await db.salesCustomer.findUnique({
    where: { id: params.customerId },
    select: { orgId: true },
  });
  if (c?.orgId) return c.orgId;
  const rows = await db.organizationMember.findMany({
    where: { userId: params.createdById, status: "active" },
    select: { orgId: true },
  });
  if (rows.length === 1) return rows[0].orgId;
  return null;
}
