/**
 * 外贸线索列表（全组织 / 按活动）— 查询与 DTO 映射
 * 列表 API 不返回 researchReport 等大 JSON，仅轻量字段 + 推断状态。
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { effectiveResearchStatusDisplay } from "@/lib/trade/research-status-display";
import { normalizeTradeProspectStage } from "@/lib/trade/stage";

export type TradeProspectListSort =
  | "score_desc"
  | "score_asc"
  | "created_desc"
  | "created_asc"
  | "updated_desc"
  | "updated_asc"
  | "last_activity_desc"
  | "next_follow_up_asc";

export interface ListTradeProspectsParams {
  orgId: string;
  campaignId?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  stage?: string;
  country?: string;
  minScore?: number | null;
  maxScore?: number | null;
  researchStatus?: string;
  emailStatus?: string;
  quoteStatus?: string;
  ownerId?: string;
  sort?: string | null;
}

export interface TradeProspectListItemDto {
  id: string;
  orgId: string;
  campaignId: string;
  campaign: { id: string; name: string };
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactTitle: string | null;
  website: string | null;
  country: string | null;
  source: string;
  score: number | null;
  /** 列表用摘要，非完整 scoreReason */
  scoreReason: string | null;
  stage: string;
  outreachSentAt: string | null;
  followUpCount: number;
  /** 持久化研究状态（可为 null，表示历史数据） */
  researchStatus: string | null;
  /** 展示用：优先 researchStatus，否则按报告/网站等推断 */
  researchStatusDisplay: string;
  researchStatusInferred: string;
  emailStatusInferred: string;
  websiteConfidence: number | null;
  researchWarnings: string[] | null;
  /** 需在详情中确认官网 */
  needsWebsiteConfirm: boolean;
  quoteCount: number;
  hasQuote: boolean;
  lastActivityAt: string;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListTradeProspectsResult {
  items: TradeProspectListItemDto[];
  total: number;
  page: number;
  pageSize: number;
  meta?: { ignoredFilters?: string[] };
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

function excerpt(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n)}…`;
}

function inferResearchStatus(row: { stage: string; score: number | null }): string {
  if (row.stage === "new" && row.score == null) return "pending";
  if (row.score != null) return "scored";
  if (
    [
      "researched",
      "qualified",
      "contacted",
      "replied",
      "quoted",
      "follow_up",
      "converted",
      "lost",
      "archived",
    ].includes(normalizeTradeProspectStage(row.stage))
  ) {
    return "researched";
  }
  return "unknown";
}

function inferEmailStatus(row: {
  outreachSentAt: Date | null;
  outreachSubject: string | null;
  stage: string;
}): string {
  if (row.outreachSentAt) return "sent";
  if (row.outreachSubject && row.outreachSubject.trim().length > 0) {
    return "draft";
  }
  return "none";
}

function orderByFromSort(sort: string | null | undefined): Prisma.TradeProspectOrderByWithRelationInput[] {
  switch (sort) {
    case "score_asc":
      return [{ score: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }];
    case "created_asc":
      return [{ createdAt: "asc" }];
    case "created_desc":
      return [{ createdAt: "desc" }];
    case "updated_asc":
      return [{ updatedAt: "asc" }];
    case "updated_desc":
    case "last_activity_desc":
      return [{ updatedAt: "desc" }];
    case "next_follow_up_asc":
      return [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }];
    case "score_desc":
    default:
      return [{ score: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }];
  }
}

export async function listTradeProspectsForOrg(p: ListTradeProspectsParams): Promise<ListTradeProspectsResult> {
  const page = Math.max(1, p.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, p.pageSize ?? DEFAULT_PAGE_SIZE));
  const ignoredFilters: string[] = [];

  if (p.ownerId?.trim()) {
    ignoredFilters.push("ownerId");
  }

  const where: Prisma.TradeProspectWhereInput = { orgId: p.orgId };
  if (p.campaignId) where.campaignId = p.campaignId;
  if (p.stage) where.stage = p.stage;
  if (p.country?.trim()) {
    where.country = { contains: p.country.trim(), mode: "insensitive" };
  }

  const andParts: Prisma.TradeProspectWhereInput[] = [];

  if (p.search?.trim()) {
    const s = p.search.trim();
    andParts.push({
      OR: [
        { companyName: { contains: s, mode: "insensitive" } },
        { website: { contains: s, mode: "insensitive" } },
      ],
    });
  }

  const minOk = p.minScore != null && !Number.isNaN(p.minScore);
  const maxOk = p.maxScore != null && !Number.isNaN(p.maxScore);
  if (minOk || maxOk) {
    const sf: Prisma.FloatNullableFilter = {};
    if (minOk) sf.gte = p.minScore!;
    if (maxOk) sf.lte = p.maxScore!;
    andParts.push({ score: sf });
  }

  const LEGACY_RS = new Set(["pending", "scored", "unscored"]);

  if (p.researchStatus && !LEGACY_RS.has(p.researchStatus)) {
    andParts.push({ researchStatus: p.researchStatus });
  } else if (p.researchStatus === "pending") {
    andParts.push({ stage: "new", score: null });
  } else if (p.researchStatus === "scored") {
    andParts.push({ score: { not: null } });
  } else if (p.researchStatus === "unscored") {
    andParts.push({ score: null });
  }

  if (p.emailStatus === "sent") {
    andParts.push({ outreachSentAt: { not: null } });
  } else if (p.emailStatus === "draft") {
    andParts.push({
      outreachSentAt: null,
      OR: [{ outreachSubject: { not: null } }],
    });
  } else if (p.emailStatus === "none") {
    andParts.push({
      outreachSentAt: null,
      NOT: {
        OR: [{ outreachSubject: { not: null } }],
      },
    });
  }

  if (p.quoteStatus === "has_quote") {
    andParts.push({ quotes: { some: {} } });
  } else if (p.quoteStatus === "no_quote") {
    andParts.push({ quotes: { none: {} } });
  }

  if (andParts.length) {
    where.AND = andParts;
  }

  const orderBy = orderByFromSort(p.sort);

  const [rows, total] = await Promise.all([
    db.tradeProspect.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        orgId: true,
        campaignId: true,
        companyName: true,
        contactName: true,
        contactEmail: true,
        contactTitle: true,
        website: true,
        country: true,
        source: true,
        score: true,
        scoreReason: true,
        stage: true,
        researchStatus: true,
        websiteConfidence: true,
        researchWarnings: true,
        researchReport: true,
        outreachSentAt: true,
        outreachSubject: true,
        lastContactAt: true,
        nextFollowUpAt: true,
        followUpCount: true,
        createdAt: true,
        updatedAt: true,
        campaign: { select: { id: true, name: true } },
        _count: { select: { quotes: true } },
      },
    }),
    db.tradeProspect.count({ where }),
  ]);

  const items: TradeProspectListItemDto[] = rows.map((r) => {
    const qc = r._count.quotes;
    const rw = r.researchWarnings;
    const warnings =
      Array.isArray(rw) && rw.every((x) => typeof x === "string") ? (rw as string[]) : null;
    const display = effectiveResearchStatusDisplay({
      researchStatus: r.researchStatus,
      stage: r.stage,
      score: r.score,
      website: r.website,
      researchReport: r.researchReport,
    });
    const rsInf = inferResearchStatus({ stage: r.stage, score: r.score });
    return {
      id: r.id,
      orgId: r.orgId,
      campaignId: r.campaignId,
      campaign: r.campaign,
      companyName: r.companyName,
      contactName: r.contactName,
      contactEmail: r.contactEmail,
      contactTitle: r.contactTitle,
      website: r.website,
      country: r.country,
      source: r.source,
      score: r.score,
      scoreReason: excerpt(r.scoreReason, 200),
      stage: r.stage,
      outreachSentAt: r.outreachSentAt?.toISOString() ?? null,
      followUpCount: r.followUpCount,
      researchStatus: r.researchStatus,
      researchStatusDisplay: display,
      researchStatusInferred: rsInf,
      emailStatusInferred: inferEmailStatus({
        outreachSentAt: r.outreachSentAt,
        outreachSubject: r.outreachSubject,
        stage: r.stage,
      }),
      websiteConfidence: r.websiteConfidence,
      researchWarnings: warnings,
      needsWebsiteConfirm:
        r.researchStatus === "website_candidates_found" || r.researchStatus === "low_confidence",
      quoteCount: qc,
      hasQuote: qc > 0,
      lastActivityAt: (r.lastContactAt ?? r.updatedAt).toISOString(),
      nextFollowUpAt: r.nextFollowUpAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    meta: ignoredFilters.length ? { ignoredFilters } : undefined,
  };
}
