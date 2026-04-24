/**
 * Visualizer 数据可见性 / 权限 helper
 *
 * 原则（与 src/lib/rbac/data-scope.ts 对齐）：
 * - admin / super_admin：看全部
 * - 其他角色（sales / trade / user）：只看
 *   1) 自己创建的 session（createdById = me）
 *   2) 自己作为 salesOwner 的 session（salesOwnerId = me）
 *   3) 所属 customer 是自己创建的
 *
 * 这样能覆盖：销售 A 创建客户后，销售 B 代做方案 → B 建 session 后 A 仍可见。
 * （创建 session 也必须先通过客户可见性校验）
 */

import { db } from "@/lib/db";
import { isGlobalScope } from "@/lib/rbac/data-scope";

type MinimalUser = { id: string; role: string | null | undefined };

/** 列表查询 where 片段；admin 返回 null（不过滤） */
export function visualizerSessionListScope(
  user: MinimalUser,
): Record<string, unknown> | null {
  if (isGlobalScope(user.role)) return null;
  return {
    OR: [
      { createdById: user.id },
      { salesOwnerId: user.id },
      { customer: { createdById: user.id } },
    ],
  };
}

/**
 * 单条 session 可见性校验
 * 传入已查出的 session（含 createdById / salesOwnerId / customer.createdById）
 */
export function canSeeVisualizerSession(
  session: {
    createdById: string;
    salesOwnerId: string | null;
    customer: { createdById: string | null };
  },
  user: MinimalUser,
): boolean {
  if (isGlobalScope(user.role)) return true;
  if (session.createdById === user.id) return true;
  if (session.salesOwnerId && session.salesOwnerId === user.id) return true;
  if (session.customer.createdById === user.id) return true;
  return false;
}

/**
 * 创建 session 前的前置校验：
 * - 客户存在且未归档
 * - 非 admin 必须是客户创建人
 * 返回 null 表示通过，string 为错误信息
 */
export async function validateCustomerAccessForCreate(
  customerId: string,
  user: MinimalUser,
): Promise<{ ok: true; customer: { id: string; name: string } } | { ok: false; reason: string; status: number }> {
  const customer = await db.salesCustomer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, archivedAt: true, createdById: true },
  });
  if (!customer) {
    return { ok: false, reason: "客户不存在", status: 404 };
  }
  if (customer.archivedAt) {
    return { ok: false, reason: "该客户已归档，无法创建可视化方案", status: 400 };
  }
  if (!isGlobalScope(user.role) && customer.createdById !== user.id) {
    return { ok: false, reason: "无权为该客户创建可视化方案", status: 403 };
  }
  return { ok: true, customer: { id: customer.id, name: customer.name } };
}

/**
 * 校验可选绑定的 opportunity / quote / measurementRecord：
 * - 必须存在
 * - 必须属于同一个 customerId（防止跨客户挂载）
 */
export async function validateSessionLinks(
  customerId: string,
  links: {
    opportunityId?: string | null;
    quoteId?: string | null;
    measurementRecordId?: string | null;
  },
): Promise<{ ok: true } | { ok: false; reason: string; status: number }> {
  if (links.opportunityId) {
    const opp = await db.salesOpportunity.findUnique({
      where: { id: links.opportunityId },
      select: { customerId: true },
    });
    if (!opp) return { ok: false, reason: "销售机会不存在", status: 400 };
    if (opp.customerId !== customerId) {
      return { ok: false, reason: "销售机会与客户不匹配", status: 400 };
    }
  }
  if (links.quoteId) {
    const quote = await db.salesQuote.findUnique({
      where: { id: links.quoteId },
      select: { customerId: true },
    });
    if (!quote) return { ok: false, reason: "报价不存在", status: 400 };
    if (quote.customerId !== customerId) {
      return { ok: false, reason: "报价与客户不匹配", status: 400 };
    }
  }
  if (links.measurementRecordId) {
    const rec = await db.measurementRecord.findUnique({
      where: { id: links.measurementRecordId },
      select: { customerId: true },
    });
    if (!rec) return { ok: false, reason: "量房记录不存在", status: 400 };
    if (rec.customerId !== customerId) {
      return { ok: false, reason: "量房记录与客户不匹配", status: 400 };
    }
  }
  return { ok: true };
}
