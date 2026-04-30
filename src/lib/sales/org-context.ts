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
import { db } from "@/lib/db";
import { resolveTradeOrgId, type TradeOrgResolution } from "@/lib/trade/access";

export type { TradeOrgResolution as SalesOrgResolution } from "@/lib/trade/access";

export async function resolveSalesOrgIdForRequest(
  request: NextRequest,
  user: AuthUser,
  opts?: { bodyOrgId?: string | null },
): Promise<TradeOrgResolution> {
  return resolveTradeOrgId(request, user, opts);
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
 * - 若 customer.orgId 已设置，必须与 orgId 一致。
 * - TODO remove legacy membership fallback after sales orgId backfill.
 *   若 customer.orgId 为空，则退回校验 createdById 是否为该 org 的 active 成员。
 */
export async function assertSalesCustomerInOrgForMutation(
  customer: { orgId: string | null; createdById: string },
  orgId: string,
): Promise<NextResponse | null> {
  if (customer.orgId) {
    if (customer.orgId !== orgId) {
      return NextResponse.json({ error: "客户不属于当前组织" }, { status: 403 });
    }
    return null;
  }
  // TODO remove legacy membership fallback after sales orgId backfill.
  const memberIds = await getActiveOrgMemberUserIds(orgId);
  if (!new Set(memberIds).has(customer.createdById)) {
    return NextResponse.json({ error: "客户不属于当前组织" }, { status: 403 });
  }
  return null;
}

/** convert-to-sales 等内部流程：校验失败时抛 Error（与历史 assertCustomerInOrgOrThrow 行为一致） */
export async function assertSalesCustomerInOrgOrThrowForConvert(
  customer: { id: string; orgId: string | null; createdById: string },
  orgId: string,
): Promise<void> {
  const deny = () => {
    throw new Error("该销售客户不属于当前组织下的销售数据范围");
  };
  if (customer.orgId) {
    if (customer.orgId !== orgId) deny();
    return;
  }
  // TODO remove legacy membership fallback after sales orgId backfill.
  const memberIds = await getActiveOrgMemberUserIds(orgId);
  if (!new Set(memberIds).has(customer.createdById)) deny();
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
