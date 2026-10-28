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
 *
 * PERM-4c5：
 * - "看全部"只在调用者能看全部的企业内生效（修复既有跨企业泄露：以前 dataScope=all 不按企业过滤）；
 * - 每个企业按岗位派生平台角色判定是否"看全部"（岗位模式企业按岗位，旧模式按平台角色）；
 * - 平台 super_admin 仍看全部企业（平台管理员全权）。
 * 调用方先 `resolveVisualizerViewer(user)` 再传入；未解析的 viewer（无 globalOrgIds）按"只看本人"处理（fail-closed）。
 */

import { db } from "@/lib/db";
import { isGlobalScope } from "@/lib/rbac/data-scope";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import { resolveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";

type MinimalUser = { id: string; role: string | null | undefined };

/** 已解析的查看者：globalOrgIds = 可看全部方案的企业；"all" = 平台 super_admin */
export type VisualizerViewer = MinimalUser & { globalOrgIds?: readonly string[] | "all" };

/** PERM-4c5：解析查看者在哪些企业"看全部"（企业内派生角色 dataScope=all） */
export async function resolveVisualizerViewer(user: MinimalUser): Promise<VisualizerViewer> {
  if (isPlatformSuperAdmin(user.role)) return { ...user, globalOrgIds: "all" };
  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id, status: "active" },
    select: { orgId: true },
  });
  const globalOrgIds: string[] = [];
  for (const m of memberships) {
    const role = await resolveEffectivePlatformRole({ userId: user.id, orgId: m.orgId, platformRole: user.role });
    if (isGlobalScope(role)) globalOrgIds.push(m.orgId);
  }
  return { ...user, globalOrgIds };
}

/** 智能体工具：单企业上下文（ctx.role 已是派生角色） */
export function visualizerViewerForOrg(user: MinimalUser, orgId: string): VisualizerViewer {
  if (isPlatformSuperAdmin(user.role)) return { ...user, globalOrgIds: "all" };
  return { ...user, globalOrgIds: isGlobalScope(user.role) ? [orgId] : [] };
}

function globalOrgs(viewer: VisualizerViewer): readonly string[] | "all" {
  return viewer.globalOrgIds ?? [];
}

function seesAllIn(viewer: VisualizerViewer, orgId: string | null | undefined): boolean {
  const g = globalOrgs(viewer);
  if (g === "all") return true;
  return Boolean(orgId) && g.includes(orgId!);
}

/** 列表查询 where 片段；平台 super_admin 返回 null（不过滤） */
export function visualizerSessionListScope(
  user: VisualizerViewer,
): Record<string, unknown> | null {
  const g = globalOrgs(user);
  if (g === "all") return null;
  const own: Record<string, unknown>[] = [
    { createdById: user.id },
    { salesOwnerId: user.id },
    { customer: { createdById: user.id } },
  ];
  if (g.length) own.push({ customer: { orgId: { in: [...g] } } });
  return { OR: own };
}

/**
 * 单条 session 可见性校验
 * 传入已查出的 session（含 createdById / salesOwnerId / customer.createdById）
 */
export function canSeeVisualizerSession(
  session: {
    createdById: string;
    salesOwnerId: string | null;
    customer: { createdById: string | null; orgId: string | null };
  },
  user: VisualizerViewer,
): boolean {
  if (seesAllIn(user, session.customer.orgId)) return true;
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
  user: VisualizerViewer,
): Promise<{ ok: true; customer: { id: string; name: string } } | { ok: false; reason: string; status: number }> {
  const customer = await db.salesCustomer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, archivedAt: true, createdById: true, orgId: true },
  });
  if (!customer) {
    return { ok: false, reason: "客户不存在", status: 404 };
  }
  if (customer.archivedAt) {
    return { ok: false, reason: "该客户已归档，无法创建可视化方案", status: 400 };
  }
  if (!seesAllIn(user, customer.orgId) && customer.createdById !== user.id) {
    return { ok: false, reason: "无权为该客户创建可视化方案", status: 403 };
  }
  return { ok: true, customer: { id: customer.id, name: customer.name } };
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
  customer: { createdById: string | null; orgId: string | null };
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
