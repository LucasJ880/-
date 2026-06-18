/**
 * 销售 CRM 组织上下文 — 与外贸模块 resolveTradeOrgId 规则一致（复用实现）。
 *
 * - 多组织用户必须显式传 orgId（query 优先，其次 body 经 opts 传入，且须校验成员关系）
 * - 单组织用户可自动解析
 * - 平台管理员跨组织操作必须显式 orgId，且仅校验组织存在
 * - 禁止默认 fallback 到「任意组织」；禁止仅信任裸 body.orgId（须走 resolve）
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/auth";
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

/**
 * 解析调用者在指定 org 内的数据可见范围。
 *
 * - 平台 admin / super_admin：ownOnly=false（在 orgId 上下文内看本组织全部）
 * - 目标 org 的 org_admin（active）：ownOnly=false（看本组织全部）
 * - org_member / org_viewer / 非 active 成员：ownOnly=true（仅看自己 created/assigned）
 *
 * 注意：orgId 的访问权限应已由 resolveSalesOrgIdForRequest 校验通过，
 * 本函数只决定「本组织内看全部还是看自己」，不再重复校验组织准入。
 */
export async function resolveSalesScope(
  user: AuthUser,
  orgId: string,
): Promise<{ ownOnly: boolean }> {
  if (isAdmin(user.role)) return { ownOnly: false };
  const m = await getOrgMembership(user.id, orgId);
  const isOrgAdmin = m?.status === "active" && m.role === "org_admin";
  return { ownOnly: !isOrgAdmin };
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
 * 校验 opportunity 属于 orgId（可选再校验 own 归属）。
 * 跨组织/不存在 → 404；同组织但非本人（ownOnly）→ 403。
 */
export async function assertSalesOpportunityInOrgForMutation(
  opportunityId: string,
  orgId: string,
  opts?: { userId?: string; ownOnly?: boolean },
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
 * 创建商机 / 报价 / 互动前：客户必须属于当前 org。
 * A2-3 起：严格要求 customer.orgId === orgId（orgId 为空不再容忍）。
 */
export async function assertSalesCustomerInOrgForMutation(
  customer: { orgId: string | null; createdById: string },
  orgId: string,
): Promise<NextResponse | null> {
  if (customer.orgId !== orgId) {
    return NextResponse.json({ error: "客户不属于当前组织" }, { status: 403 });
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
