/**
 * 外贸/销售模块 — 组织上下文与资源级访问校验
 *
 * Security-1 规则：
 * - 日常业务以 User.activeOrgId 为准，不询问用户组织
 * - body/query orgId 仅交叉校验，不可覆盖 activeOrgId（不一致 → ORG_CONTEXT_MISMATCH）
 * - 禁止仅信任裸 orgId；必须校验 active membership
 * - 平台管理员：必须显式传 orgId，且组织须存在
 *
 * PERM-6a：
 * - "显式 orgId 访问任意企业"只给平台 super_admin；平台 admin 与普通成员一样按成员关系解析
 * - 外贸接口由 requireTradePermission 按岗位权限键（trade.read / trade.manage / trade.settings.manage）放行
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/auth";
import { requireCronSecret } from "@/lib/cron/auth";
import { db } from "@/lib/db";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import { requireAuth, type AuthResult } from "@/lib/auth/guards";
import { authorize, humanPrincipal } from "@/lib/authorization";
import type {
  Prisma,
  TradeCampaign,
  TradeEmailTemplate,
  TradeKnowledge,
  TradeProspect,
  TradeQuote,
} from "@prisma/client";

export type TradeOrgResolution =
  | { ok: true; orgId: string }
  | { ok: false; response: NextResponse };

type TradeProspectWithCampaignAndMessages = Prisma.TradeProspectGetPayload<{
  include: { campaign: true; messages: true };
}>;

type TradeQuoteWithItemsAndProspect = Prisma.TradeQuoteGetPayload<{
  include: { items: true; prospect: true };
}>;

function orgMissingResponse(): NextResponse {
  return NextResponse.json(
    { error: "缺少工作企业上下文，请联系管理员设置所属企业" },
    { status: 400 },
  );
}

function forbiddenOrgResponse(): NextResponse {
  return NextResponse.json({ error: "无权访问该组织的外贸数据" }, { status: 403 });
}

function orgContextMismatchResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "请求组织与当前工作企业不一致",
      code: "ORG_CONTEXT_MISMATCH",
    },
    { status: 403 },
  );
}

async function listActiveOrgIdsForUser(userId: string): Promise<string[]> {
  const rows = await db.organizationMember.findMany({
    where: {
      userId,
      status: "active",
      org: { status: "active" },
    },
    select: { orgId: true },
  });
  return rows.map((r) => r.orgId);
}

/**
 * 解析当前请求对应的 orgId（销售/外贸共用）。
 *
 * Security-1：优先 User.activeOrgId（须为 active membership）；
 * 显式 orgId 仅允许与 activeOrgId 一致。
 */
export async function resolveTradeOrgId(
  request: NextRequest,
  user: AuthUser,
  opts?: { bodyOrgId?: string | null },
): Promise<TradeOrgResolution> {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("orgId");
  const explicit = (fromQuery ?? opts?.bodyOrgId ?? "").trim() || null;

  if (isPlatformSuperAdmin(user.role)) {
    if (!explicit) {
      return { ok: false, response: orgMissingResponse() };
    }
    const org = await db.organization.findUnique({
      where: { id: explicit },
      select: { id: true },
    });
    if (!org) {
      return {
        ok: false,
        response: NextResponse.json({ error: "组织不存在" }, { status: 400 }),
      };
    }
    return { ok: true, orgId: explicit };
  }

  const memberships = await listActiveOrgIdsForUser(user.id);
  if (memberships.length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "未加入任何有效组织，无法使用企业功能" },
        { status: 403 },
      ),
    };
  }

  const profile = await db.user.findUnique({
    where: { id: user.id },
    select: { activeOrgId: true },
  });
  const activeOrgId =
    profile?.activeOrgId && memberships.includes(profile.activeOrgId)
      ? profile.activeOrgId
      : memberships.length === 1
        ? memberships[0]!
        : null;

  if (!activeOrgId) {
    return { ok: false, response: orgMissingResponse() };
  }

  if (explicit && explicit !== activeOrgId) {
    return { ok: false, response: orgContextMismatchResponse() };
  }

  return { ok: true, orgId: activeOrgId };
}

// ── PERM-6a：外贸接口守卫 ─────────────────────────────────────

export const TRADE_READ = "trade.read";
export const TRADE_MANAGE = "trade.manage";
export const TRADE_SETTINGS_MANAGE = "trade.settings.manage";
/** 读接口：持读或写任一 */
export const TRADE_READ_KEYS = [TRADE_READ, TRADE_MANAGE] as const;
/** 写接口 */
export const TRADE_MANAGE_KEYS = [TRADE_MANAGE] as const;
/** 设置类接口（发件档案 / 发件人；消息通道管理见 canManageTradeChannels） */
export const TRADE_SETTINGS_KEYS = [TRADE_SETTINGS_MANAGE] as const;
/** 消息通道入口（列表 / 详情 / 管理）：外贸读写或设置键任一；管理动作再经 canManageTradeChannels 要求设置键（企业管理员只持设置键也能管通道） */
export const TRADE_CHANNEL_KEYS = [TRADE_READ, TRADE_MANAGE, TRADE_SETTINGS_MANAGE] as const;

/** 当前企业内持任一键（平台 super_admin 恒真） */
export async function holdsTradePermission(
  user: AuthUser,
  orgId: string,
  keys: readonly string[],
): Promise<boolean> {
  if (isPlatformSuperAdmin(user.role)) return true;
  for (const permission of keys) {
    const decision = await authorize({ principal: humanPrincipal(user, orgId), orgId, permission });
    if (decision.allowed) return true;
  }
  return false;
}

function tradePermissionDeniedResponse(): NextResponse {
  return NextResponse.json({ error: "无权访问外贸功能（缺少外贸岗位权限）", code: "TRADE_PERMISSION_REQUIRED" }, { status: 403 });
}

/**
 * 取代 requireRole(request, ["trade","admin"])：返回同样的 { user }，调用点只换一行（design D2）。
 * - 平台 super_admin 直接放行（企业由路由自己的 resolveTradeOrgId 按显式 orgId 处理）；
 * - 其余人在 resolveTradeOrgId 解析出的当前企业内持任一键才放行（显式 orgId 只做交叉校验）。
 */
export async function requireTradePermission(
  request: NextRequest,
  keys: readonly string[],
): Promise<AuthResult | NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (isPlatformSuperAdmin(auth.user.role)) return auth;
  const org = await resolveTradeOrgId(request, auth.user);
  if (!org.ok) return org.response;
  if (!(await holdsTradePermission(auth.user, org.orgId, keys))) return tradePermissionDeniedResponse();
  return auth;
}

/** 平台级外贸配置（删除发件人、修改发件邮箱）：只给平台 super_admin */
export async function requireTradePlatformAdmin(request: NextRequest): Promise<AuthResult | NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (!isPlatformSuperAdmin(auth.user.role)) {
    return NextResponse.json({ error: "仅平台管理员可操作", code: "PLATFORM_ADMIN_REQUIRED" }, { status: 403 });
  }
  return auth;
}

/** 校验用户是否可访问某 orgId（用于已从资源读出 orgId 的场景） */
export async function assertUserCanAccessTradeOrg(
  user: AuthUser,
  orgId: string,
): Promise<true | NextResponse> {
  if (isPlatformSuperAdmin(user.role)) {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ error: "组织不存在" }, { status: 400 });
    }
    return true;
  }
  const m = await getOrgMembership(user.id, orgId);
  if (!m || m.status !== "active") {
    return forbiddenOrgResponse();
  }
  return true;
}

export function assertCampaignOrg(
  campaign: Pick<TradeCampaign, "orgId">,
  orgId: string,
): NextResponse | null {
  if (campaign.orgId !== orgId) {
    return NextResponse.json({ error: "活动不属于当前组织" }, { status: 403 });
  }
  return null;
}

export function assertProspectOrg(
  prospect: Pick<TradeProspect, "orgId">,
  orgId: string,
): NextResponse | null {
  if (prospect.orgId !== orgId) {
    return NextResponse.json({ error: "线索不属于当前组织" }, { status: 403 });
  }
  return null;
}

export function assertQuoteOrg(
  quote: Pick<TradeQuote, "orgId">,
  orgId: string,
): NextResponse | null {
  if (quote.orgId !== orgId) {
    return NextResponse.json({ error: "报价单不属于当前组织" }, { status: 403 });
  }
  return null;
}

export async function loadTradeCampaignForOrg(
  campaignId: string,
  orgId: string,
): Promise<{ campaign: TradeCampaign & { _count?: { prospects: number } } } | NextResponse> {
  const campaign = await db.tradeCampaign.findFirst({
    where: { id: campaignId, orgId },
    include: { _count: { select: { prospects: true } } },
  });
  if (!campaign) {
    return NextResponse.json({ error: "活动不存在" }, { status: 404 });
  }
  return { campaign };
}

export async function loadTradeProspectForOrg(
  prospectId: string,
  orgId: string,
): Promise<{ prospect: TradeProspectWithCampaignAndMessages } | NextResponse> {
  const prospect = await db.tradeProspect.findFirst({
    where: { id: prospectId, orgId },
    include: { campaign: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!prospect) {
    return NextResponse.json({ error: "线索不存在" }, { status: 404 });
  }
  return { prospect };
}

export async function loadTradeQuoteForOrg(
  quoteId: string,
  orgId: string,
): Promise<{ quote: TradeQuoteWithItemsAndProspect } | NextResponse> {
  const quote = await db.tradeQuote.findFirst({
    where: { id: quoteId, orgId },
    include: { items: { orderBy: { sortOrder: "asc" } }, prospect: true },
  });
  if (!quote) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }
  return { quote };
}

export async function loadTradeKnowledgeForOrg(
  id: string,
  orgId: string,
): Promise<{ item: TradeKnowledge } | NextResponse> {
  const item = await db.tradeKnowledge.findFirst({ where: { id, orgId } });
  if (!item) {
    return NextResponse.json({ error: "不存在" }, { status: 404 });
  }
  return { item };
}

export async function loadTradeEmailTemplateForOrg(
  id: string,
  orgId: string,
): Promise<{ template: TradeEmailTemplate } | NextResponse> {
  const template = await db.tradeEmailTemplate.findFirst({ where: { id, orgId } });
  if (!template) {
    return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  }
  return { template };
}

/**
 * Cron / 类后台任务：委托统一 requireCronSecret（隔离 fail-closed + 常量时间比较）。
 * 保留导出以兼容既有调用方（trade/cron 路由、审计脚本）。
 */
export function requireTradeCronSecret(request: NextRequest): NextResponse | null {
  return requireCronSecret(request);
}
