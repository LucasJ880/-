/**
 * TradeProspect → Sales CRM 转换（预览 + 执行）
 *
 * 说明：核心销售表已增加可选 orgId；新写入必须带 orgId。
 * 历史客户 orgId 为空时，仍临时用「创建人 ∈ 目标组织 active 成员」兜底（见 org-context TODO）。
 */

import type { TradeCampaign, TradeProspect, TradeQuote } from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertSalesCustomerInOrgOrThrowForConvert,
  getActiveOrgMemberUserIds,
} from "@/lib/sales/org-context";
import { parseResearchBundle } from "@/lib/trade/research-bundle";
import { normalizeTradeProspectStage } from "@/lib/trade/stage";

export type CustomerMatchReason =
  | "website_domain"
  | "email_domain"
  | "company_name_exact"
  | "company_name_contains";

export type SalesCustomerCandidate = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  matchReason: CustomerMatchReason;
  createdById: string;
};

export type SalesOpportunityCandidate = {
  id: string;
  title: string;
  stage: string;
  customerId: string;
  sourceTradeProspectId: string | null;
};

/** 小写 hostname，去 www */
export function websiteHost(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    const h = u.hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return null;
  }
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email?.trim()) return null;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

export function isSalesCustomerAccessibleInOrg(
  customer: { createdById: string },
  orgMemberUserIds: Set<string>,
): boolean {
  return orgMemberUserIds.has(customer.createdById);
}

export async function findSalesCustomerCandidates(
  orgId: string,
  prospect: Pick<
    TradeProspect,
    "companyName" | "contactEmail" | "website"
  >,
): Promise<SalesCustomerCandidate[]> {
  const memberIds = await getActiveOrgMemberUserIds(orgId);
  if (memberIds.length === 0) return [];
  const set = new Set(memberIds);

  const customers = await db.salesCustomer.findMany({
    where: {
      createdById: { in: memberIds },
      archivedAt: null,
      OR: [{ orgId }, { orgId: null }],
    },
    select: { id: true, name: true, email: true, phone: true, createdById: true },
    take: 400,
    orderBy: { updatedAt: "desc" },
  });

  const pHost = websiteHost(prospect.website);
  const pEmailDom = emailDomain(prospect.contactEmail);
  const pCompany = prospect.companyName.trim().toLowerCase();

  const scored: { c: (typeof customers)[number]; reason: CustomerMatchReason; rank: number }[] = [];

  for (const c of customers) {
    if (!set.has(c.createdById)) continue;
    const cEmailDom = emailDomain(c.email);
    let reason: CustomerMatchReason | null = null;
    let rank = 99;
    if (pHost && cEmailDom && pHost === cEmailDom) {
      reason = "website_domain";
      rank = 1;
    } else if (pEmailDom && cEmailDom && pEmailDom === cEmailDom) {
      reason = "email_domain";
      rank = 2;
    } else if (c.name.trim().toLowerCase() === pCompany) {
      reason = "company_name_exact";
      rank = 3;
    } else if (pCompany.length >= 3 && c.name.toLowerCase().includes(pCompany)) {
      reason = "company_name_contains";
      rank = 4;
    } else if (pCompany.length >= 3 && pCompany.includes(c.name.trim().toLowerCase()) && c.name.trim().length >= 3) {
      reason = "company_name_contains";
      rank = 5;
    }
    if (reason) scored.push({ c, reason, rank });
  }

  scored.sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name));
  const seen = new Set<string>();
  const out: SalesCustomerCandidate[] = [];
  for (const { c, reason } of scored) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      matchReason: reason,
      createdById: c.createdById,
    });
    if (out.length >= 15) break;
  }
  return out;
}

export async function findOpportunityCandidatesForProspect(
  orgId: string,
  prospectId: string,
  companyName: string,
): Promise<SalesOpportunityCandidate[]> {
  const memberIds = await getActiveOrgMemberUserIds(orgId);
  if (memberIds.length === 0) return [];

  const bySource = await db.salesOpportunity.findMany({
    where: { sourceTradeProspectId: prospectId },
    select: { id: true, title: true, stage: true, customerId: true, sourceTradeProspectId: true },
    take: 5,
  });
  if (bySource.length > 0) {
    return bySource.map((o) => ({
      id: o.id,
      title: o.title,
      stage: o.stage,
      customerId: o.customerId,
      sourceTradeProspectId: o.sourceTradeProspectId,
    }));
  }

  const q = companyName.trim();
  if (q.length < 2) return [];

  const opps = await db.salesOpportunity.findMany({
    where: {
      customer: {
        createdById: { in: memberIds },
        archivedAt: null,
        OR: [{ orgId }, { orgId: null }],
      },
      OR: [{ title: { contains: q, mode: "insensitive" } }],
    },
    select: { id: true, title: true, stage: true, customerId: true, sourceTradeProspectId: true },
    take: 8,
    orderBy: { updatedAt: "desc" },
  });
  return opps.map((o) => ({
    id: o.id,
    title: o.title,
    stage: o.stage,
    customerId: o.customerId,
    sourceTradeProspectId: o.sourceTradeProspectId,
  }));
}

function researchSnippet(report: TradeProspect["researchReport"]): string | null {
  if (!report || typeof report !== "object") return null;
  const parsed = parseResearchBundle(report);
  const o = parsed.report?.companyOverview?.trim();
  if (o) return o.slice(0, 500);
  return null;
}

export function buildConversionWarnings(
  prospect: Pick<
    TradeProspect,
    | "contactEmail"
    | "website"
    | "researchStatus"
    | "researchReport"
    | "stage"
    | "score"
  >,
  existingCustomerCandidates: SalesCustomerCandidate[],
): string[] {
  const w: string[] = [];
  if (!prospect.contactEmail?.trim()) w.push("未填写联系人邮箱，销售客户主邮箱将为空。");
  if (!prospect.website?.trim()) w.push("未填写官网，无法在销售侧自动对齐网站信息。");
  if (existingCustomerCandidates.length > 0) {
    w.push("发现可能重复的销售客户，请确认使用新建或关联已有客户。");
  }
  const rs = prospect.researchStatus ?? "";
  if (rs === "low_confidence" || rs === "website_candidates_found") {
    w.push("官网尚未确认或置信度偏低，转换后客户资料可能不准确。");
  }
  if (!prospect.researchReport) {
    w.push("该线索尚无研究报告，建议先完成研究后再转销售。");
  }
  const st = normalizeTradeProspectStage(prospect.stage);
  const stageOk = ["qualified", "contacted", "replied", "quoted", "follow_up"].includes(st);
  const scoreOk = prospect.score != null && prospect.score >= 6;
  if (!stageOk && !scoreOk) {
    w.push("当前阶段或评分偏低，转换前请确认业务上已准备好进入销售跟进。");
  }
  return w;
}

export function canConvertProspect(
  prospect: Pick<TradeProspect, "stage" | "score" | "researchReport">,
): boolean {
  const st = normalizeTradeProspectStage(prospect.stage);
  if (["qualified", "contacted", "replied", "quoted", "follow_up"].includes(st)) return true;
  if (prospect.score != null && prospect.score >= 6) return true;
  return true;
}

export type ProposedCustomerPayload = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  source: string;
  notes: string | null;
};

export type ProposedOpportunityPayload = {
  title: string;
  stage: string;
  estimatedValue: number | null;
  source: string;
  priority: string;
  notes: string;
};

export async function getLatestTradeQuote(
  prospectId: string,
): Promise<Pick<TradeQuote, "id" | "quoteNumber" | "status" | "totalAmount" | "currency" | "updatedAt"> | null> {
  return db.tradeQuote.findFirst({
    where: { prospectId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, quoteNumber: true, status: true, totalAmount: true, currency: true, updatedAt: true },
  });
}

export async function buildConversionPreview(orgId: string, prospect: TradeProspect & { campaign: TradeCampaign }) {
  const alreadyConverted = Boolean(prospect.convertedToSalesCustomerId || prospect.convertedAt);
  const [customerCandidates, oppCandidates, latestQuote] = await Promise.all([
    findSalesCustomerCandidates(orgId, prospect),
    findOpportunityCandidatesForProspect(orgId, prospect.id, prospect.companyName),
    getLatestTradeQuote(prospect.id),
  ]);

  const snippet = researchSnippet(prospect.researchReport);
  const addrParts = [prospect.country?.trim()].filter(Boolean);
  const proposedCustomer: ProposedCustomerPayload = {
    name: prospect.companyName.trim(),
    email: prospect.contactEmail?.trim() || null,
    phone: null,
    address: addrParts.length ? addrParts.join(" · ") : null,
    source: "trade_import",
    notes: [
      prospect.contactName ? `联系人：${prospect.contactName}` : null,
      prospect.contactTitle ? `职位：${prospect.contactTitle}` : null,
      prospect.campaign?.name ? `外贸活动：${prospect.campaign.name}` : null,
      `tradeProspectId=${prospect.id}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };

  const oppNotesParts = [
    `来源：外贸线索 ${prospect.id}`,
    prospect.campaign ? `活动：${prospect.campaign.name}（${prospect.campaignId}）` : null,
    prospect.score != null ? `外贸评分：${prospect.score.toFixed(1)}` : null,
    prospect.scoreReason ? `评分说明：${prospect.scoreReason.slice(0, 800)}` : null,
    snippet ? `研究摘要：${snippet}` : null,
    latestQuote ? `最新外贸报价：${latestQuote.quoteNumber}（${latestQuote.id}）` : null,
  ].filter(Boolean) as string[];

  const proposedOpportunity: ProposedOpportunityPayload = {
    title: `${prospect.companyName.trim()} · 外贸转入`,
    stage: "new_lead",
    estimatedValue: prospect.score != null ? Math.round(prospect.score * 1000) / 1000 : null,
    source: "trade",
    priority: "warm",
    notes: oppNotesParts.join("\n\n"),
  };

  const warnings = buildConversionWarnings(prospect, customerCandidates);

  return {
    prospectSummary: {
      id: prospect.id,
      companyName: prospect.companyName,
      contactName: prospect.contactName,
      contactEmail: prospect.contactEmail,
      contactTitle: prospect.contactTitle,
      website: prospect.website,
      country: prospect.country,
      stage: prospect.stage,
      stageNormalized: normalizeTradeProspectStage(prospect.stage),
      score: prospect.score,
      researchStatus: prospect.researchStatus,
      campaignId: prospect.campaignId,
      campaignName: prospect.campaign.name,
    },
    proposedCustomer,
    proposedOpportunity,
    existingCustomerCandidates: customerCandidates,
    existingOpportunityCandidates: oppCandidates,
    latestTradeQuote: latestQuote,
    warnings,
    canConvert: canConvertProspect(prospect),
    alreadyConverted,
    converted: alreadyConverted
      ? {
          salesCustomerId: prospect.convertedToSalesCustomerId,
          salesOpportunityId: prospect.convertedToSalesOpportunityId,
          convertedAt: prospect.convertedAt?.toISOString() ?? null,
          convertedById: prospect.convertedById,
        }
      : null,
  };
}

export type ConvertToSalesBody = {
  mode: "create_new" | "use_existing_customer";
  salesCustomerId?: string | null;
  createOpportunity?: boolean;
  includeLatestTradeQuote?: boolean;
};

export async function assertCustomerInOrgOrThrow(
  customerId: string,
  orgMemberUserIds: Set<string>,
): Promise<void> {
  const c = await db.salesCustomer.findFirst({
    where: { id: customerId, archivedAt: null },
    select: { id: true, createdById: true },
  });
  if (!c) throw new Error("客户不存在或已归档");
  if (!orgMemberUserIds.has(c.createdById)) {
    throw new Error("该销售客户不属于当前组织下的销售数据范围");
  }
}

export async function executeConvertToSales(params: {
  orgId: string;
  userId: string;
  prospect: TradeProspect & { campaign: TradeCampaign };
  body: ConvertToSalesBody;
}): Promise<{
  salesCustomerId: string;
  salesOpportunityId: string | null;
}> {
  const { orgId, userId, prospect, body } = params;
  if (prospect.convertedToSalesCustomerId || prospect.convertedAt) {
    const err = new Error("ALREADY_CONVERTED");
    (err as Error & { code?: string }).code = "ALREADY_CONVERTED";
    throw err;
  }

  const memberIds = await getActiveOrgMemberUserIds(orgId);
  const memberSet = new Set(memberIds);
  if (!memberSet.has(userId)) {
    throw new Error("当前用户不是该组织成员，无法执行转换");
  }

  const preview = await buildConversionPreview(orgId, prospect);

  let customerId: string;

  if (body.mode === "use_existing_customer") {
    const sid = body.salesCustomerId?.trim();
    if (!sid) throw new Error("缺少 salesCustomerId");
    await assertCustomerInOrgOrThrow(sid, memberSet);
    customerId = sid;

    const mergeNotes = [
      prospect.contactName ? `联系人：${prospect.contactName}` : null,
      prospect.contactEmail ? `邮箱：${prospect.contactEmail}` : null,
      `tradeProspectId=${prospect.id}`,
    ]
      .filter(Boolean)
      .join("\n");

    const existing = await db.salesCustomer.findUnique({
      where: { id: customerId },
      select: { notes: true, email: true },
    });
    await db.salesCustomer.update({
      where: { id: customerId },
      data: {
        notes: [existing?.notes?.trim(), mergeNotes].filter(Boolean).join("\n\n---\n"),
        ...(existing?.email?.trim()
          ? {}
          : prospect.contactEmail?.trim()
            ? { email: prospect.contactEmail.trim() }
            : {}),
      },
    });
  } else {
    const c = await db.salesCustomer.create({
      data: {
        orgId,
        name: preview.proposedCustomer.name,
        email: preview.proposedCustomer.email,
        phone: preview.proposedCustomer.phone,
        address: preview.proposedCustomer.address,
        source: preview.proposedCustomer.source,
        notes: preview.proposedCustomer.notes,
        createdById: userId,
      },
    });
    customerId = c.id;
  }

  let opportunityId: string | null = null;
  if (body.createOpportunity !== false) {
    let notes = preview.proposedOpportunity.notes;
    if (body.includeLatestTradeQuote && preview.latestTradeQuote) {
      notes += `\n\n[latestTradeQuoteId]=${preview.latestTradeQuote.id}`;
    }
    const opp = await db.salesOpportunity.create({
      data: {
        orgId,
        customerId,
        title: preview.proposedOpportunity.title,
        stage: preview.proposedOpportunity.stage,
        estimatedValue: preview.proposedOpportunity.estimatedValue,
        source: preview.proposedOpportunity.source,
        priority: preview.proposedOpportunity.priority,
        lostReason: null,
        sourceTradeProspectId: prospect.id,
        createdById: userId,
      },
    });
    opportunityId = opp.id;

    await db.customerInteraction.create({
      data: {
        orgId,
        customerId,
        opportunityId,
        type: "note",
        direction: "inbound",
        summary: `由外贸线索转入（prospect=${prospect.id}）`,
        content: notes.slice(0, 12000),
        createdById: userId,
      },
    });
  }

  await db.tradeProspect.update({
    where: { id: prospect.id },
    data: {
      convertedToSalesCustomerId: customerId,
      convertedToSalesOpportunityId: opportunityId,
      convertedAt: new Date(),
      convertedById: userId,
      stage: "converted",
    },
  });

  return { salesCustomerId: customerId, salesOpportunityId: opportunityId };
}
