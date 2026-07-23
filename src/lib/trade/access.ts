/**
 * 外贸/销售模块 — 组织上下文与资源级访问校验
 *
 * Security-1 规则：
 * - 日常业务以 User.activeOrgId 为准，不询问用户组织
 * - body/query orgId 仅交叉校验，不可覆盖 activeOrgId（不一致 → ORG_CONTEXT_MISMATCH）
 * - 禁止仅信任裸 orgId；必须校验 active membership
 * - 平台管理员：必须显式传 orgId，且组织须存在
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthUser } from "@/lib/auth";
import { getOrgMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/rbac/roles";
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

  if (isAdmin(user.role)) {
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

/** 校验用户是否可访问某 orgId（用于已从资源读出 orgId 的场景） */
export async function assertUserCanAccessTradeOrg(
  user: AuthUser,
  orgId: string,
): Promise<true | NextResponse> {
  if (isAdmin(user.role)) {
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
 * Cron / 类后台任务：必须配置 CRON_SECRET，且请求头 Authorization: Bearer <secret> 完全匹配。
 */
export function requireTradeCronSecret(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET 未配置，拒绝执行外贸定时任务" },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
