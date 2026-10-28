/**
 * Visualizer 数据可见性 / 权限 helper（db 读取 + HTTP 映射）
 *
 * 判定规则在 ./access-policy（纯函数）：先企业、后范围。
 * 所有调用方必须传入当前企业 orgId（见 ./org-context resolveVisualizerOrgId）；
 * 企业归属 = session.customer.orgId（零 schema，session 无 orgId 列）。
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  customerCreateAccess,
  type MinimalUser,
  type VisualizerAccess,
} from "./access-policy";

export {
  customerCreateAccess,
  visualizerSessionAccess,
  visualizerSessionListScope,
  type MinimalUser,
  type VisualizerAccess,
} from "./access-policy";

/**
 * 三态 → 响应：not_found（含跨企业）404，forbidden 403，ok 返回 null。
 * notFoundMessage 必须与该路由"资源不存在"文案一致，跨企业不暴露存在性。
 */
export function visualizerAccessResponse(
  access: VisualizerAccess,
  forbiddenMessage = "无权访问该可视化方案",
  notFoundMessage = "可视化方案不存在",
): NextResponse | null {
  if (access === "not_found") {
    return NextResponse.json({ error: notFoundMessage }, { status: 404 });
  }
  if (access === "forbidden") {
    return NextResponse.json({ error: forbiddenMessage }, { status: 403 });
  }
  return null;
}

/**
 * 创建 / 打开 session 前的前置校验：
 * - 客户存在、属于当前企业（否则 404，与不存在同文案）且未归档
 * - 非全企业范围必须是客户创建人
 */
export async function validateCustomerAccessForCreate(
  customerId: string,
  user: MinimalUser,
  orgId: string,
): Promise<{ ok: true; customer: { id: string; name: string } } | { ok: false; reason: string; status: number }> {
  const customer = await db.salesCustomer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, orgId: true, archivedAt: true, createdById: true },
  });
  const decision = customerCreateAccess(customer, user, orgId);
  if (!decision.ok) return decision;
  return { ok: true, customer: { id: customer!.id, name: customer!.name } };
}

/**
 * 校验可选绑定的 opportunity / quote / measurementRecord：
 * - 必须存在
 * - 必须属于同一个 customerId（防止跨客户挂载）
 */
/**
 * 统一 select：子资源权限判断时，只拿够用的字段
 */
export const SESSION_ACCESS_SELECT = {
  id: true,
  createdById: true,
  salesOwnerId: true,
  customerId: true,
  customer: { select: { createdById: true, orgId: true } },
} as const;

export type SessionAccessShape = {
  id: string;
  createdById: string;
  salesOwnerId: string | null;
  customerId: string;
  customer: { createdById: string | null; orgId: string };
};

/** 通过 sourceImageId 反查 session（用于图片/region 权限校验） */
export async function loadSessionBySourceImage(
  sourceImageId: string,
): Promise<SessionAccessShape | null> {
  const img = await db.visualizerSourceImage.findUnique({
    where: { id: sourceImageId },
    select: { session: { select: SESSION_ACCESS_SELECT } },
  });
  return img?.session ?? null;
}

/** 通过 regionId 反查 session */
export async function loadSessionByRegion(
  regionId: string,
): Promise<{
  session: SessionAccessShape;
  sourceImageId: string;
} | null> {
  const region = await db.visualizerWindowRegion.findUnique({
    where: { id: regionId },
    select: {
      sourceImageId: true,
      sourceImage: { select: { session: { select: SESSION_ACCESS_SELECT } } },
    },
  });
  if (!region?.sourceImage?.session) return null;
  return { session: region.sourceImage.session, sourceImageId: region.sourceImageId };
}

/** 通过 variantId 反查 session */
export async function loadSessionByVariant(
  variantId: string,
): Promise<{ session: SessionAccessShape; sessionId: string } | null> {
  const v = await db.visualizerVariant.findUnique({
    where: { id: variantId },
    select: {
      sessionId: true,
      session: { select: SESSION_ACCESS_SELECT },
    },
  });
  if (!v?.session) return null;
  return { session: v.session, sessionId: v.sessionId };
}

/** 通过 productOptionId 反查 session + 其 variant/region */
export async function loadSessionByProductOption(
  productOptionId: string,
): Promise<{
  session: SessionAccessShape;
  variantId: string;
  regionId: string;
} | null> {
  const po = await db.visualizerProductOption.findUnique({
    where: { id: productOptionId },
    select: {
      variantId: true,
      regionId: true,
      variant: { select: { session: { select: SESSION_ACCESS_SELECT } } },
    },
  });
  if (!po?.variant?.session) return null;
  return {
    session: po.variant.session,
    variantId: po.variantId,
    regionId: po.regionId,
  };
}

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
