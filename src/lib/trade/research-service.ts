/**
 * Trade — 统一研究服务层
 *
 * 单条 API、批量、流水线、对话 Agent 共用；内部仍走 gather → report → scoring → bundle。
 */

import type { Prisma } from "@prisma/client";
import type { TradeCampaign, TradeProspect } from "@prisma/client";
import { db } from "@/lib/db";
import { updateProspect } from "@/lib/trade/service";
import { generateResearchReport, scoreProspect } from "@/lib/trade/agents";
import {
  mergeResearchBundle,
  parseResearchBundle,
  type ResearchBundleV1,
  type ScoreDimensionKey,
} from "@/lib/trade/research-bundle";
import { gatherTradeResearchInputs, type TradeResearchGatherMeta } from "@/lib/trade/research-input";
import { searchGoogle } from "@/lib/trade/tools";
import {
  buildSerpWebsiteQuery,
  extractProductKeywords,
  scoreWebsiteCandidates,
  shouldAutoPickCandidate,
} from "@/lib/trade/website-candidate-scoring";
import { normalizeTradeProspectStage, stageAfterResearchScore } from "@/lib/trade/stage";

const DIM_ZH: Record<ScoreDimensionKey, string> = {
  productFit: "产品契合",
  channelFit: "渠道形态",
  complianceVisibility: "合规可见度",
  reachability: "可触达性",
};

export interface ResearchChatSummary {
  subject: { companyName: string; country: string | null; website: string | null };
  keySources: { id: string; kind: string; title: string; url: string }[];
  dimensions: { key: string; label: string; score: number; max: number; rationale: string; evidenceIds: string[] }[];
  evidenceHighlights: string[];
  unknownsNote: string[];
  /** 仅作内部弱信号说明，不要求前台强调 */
  internalLaunchHint?: string;
  totalScore: number;
  stage: string;
  scoreReasonExcerpt: string;
  sourceCount: number;
}

export interface RunProspectResearchOptions {
  includeScoringDebug?: boolean;
  /**
   * 为 true 时：若本次评为合格，对 campaign.qualified +1。
   * 批量 / pipeline 应 false，由外层汇总后一次性 increment。
   */
  incrementCampaignQualifiedIfQualified?: boolean;
}

export type RunProspectResearchInput =
  /** prospectId 路径必须带 orgId，且须与线索库中 prospect.orgId 一致（禁止仅凭 id 执行研究）。 */
  | { prospectId: string; orgId: string; websiteOverride?: string | null }
  | {
      orgId: string;
      companyName: string;
      websiteHint?: string | null;
      /** 限定在某获客活动内解析公司名 */
      campaignId?: string | null;
      /** 国家/地区关键词，与 country 字段 contains 匹配 */
      countryHint?: string | null;
    };

/** 按公司名解析到多条线索时返回，供对话层让用户选或再传 prospectId */
export interface ResearchProspectCandidate {
  id: string;
  companyName: string;
  country: string | null;
  website: string | null;
  campaignId: string;
  campaignName: string;
}

export type RunProspectResearchResult =
  | {
      success: true;
      prospectId: string;
      updatedProspect: Awaited<ReturnType<typeof updateProspect>>;
      researchBundle: ResearchBundleV1;
      finalScore: number;
      newStage: string;
      scoreReason: string;
      /** 与原先 API 中 scoreResult 对齐，便于 JSON 返回 */
      scoreForApi: { score: number; reason: string; scoring: NonNullable<ResearchBundleV1["scoring"]> };
      chatSummary: ResearchChatSummary;
    }
  | {
      success: false;
      error: string;
      code:
        | "not_found"
        | "forbidden"
        | "no_prospect"
        | "ambiguous_prospect"
        | "invalid_campaign"
        | "website_needed"
        | "website_confirmation_needed"
        | "research_failed";
      /** 仅当 code === ambiguous_prospect */
      candidates?: ResearchProspectCandidate[];
    };

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

function buildChatSummary(params: {
  companyName: string;
  country: string | null;
  website: string | null;
  bundle: ResearchBundleV1;
  finalScore: number;
  newStage: string;
  scoreReason: string;
}): ResearchChatSummary {
  const { bundle, finalScore, newStage, scoreReason, companyName, country, website } = params;
  const parsed = parseResearchBundle(bundle);
  const scoring = bundle.scoring;

  const nonSearch = parsed.sources.filter((s) => s.kind !== "search");
  const keySources = (nonSearch.length ? nonSearch : parsed.sources).slice(0, 8).map((s) => ({
    id: s.id,
    kind: s.kind,
    title: s.title,
    url: s.url,
  }));

  const dimensions =
    scoring?.dimensions.map((d) => ({
      key: d.key,
      label: DIM_ZH[d.key] ?? d.key,
      score: d.score,
      max: d.max,
      rationale: d.rationale,
      evidenceIds: d.evidenceIds ?? [],
    })) ?? [];

  const evidenceHighlights: string[] = [];
  const sortedDims = [...dimensions].sort((a, b) => b.score - a.score);
  for (const d of sortedDims) {
    if (d.score <= 0) continue;
    const ids = d.evidenceIds.length ? `［依据 ${d.evidenceIds.slice(0, 4).join(", ")}］` : "";
    evidenceHighlights.push(`${d.label}（${d.score}/${d.max}）：${truncate(d.rationale, 160)} ${ids}`.trim());
    if (evidenceHighlights.length >= 3) break;
  }
  if (scoring?.researchScoreSignals?.length) {
    for (const sig of scoring.researchScoreSignals) {
      if (sig.strength === "low") continue;
      const ids = sig.evidenceIds?.length ? `［${sig.evidenceIds.slice(0, 3).join(", ")}］` : "";
      evidenceHighlights.push(`${sig.label}（${sig.strength}）：${truncate(sig.detail, 120)} ${ids}`.trim());
      if (evidenceHighlights.length >= 4) break;
    }
  }
  while (evidenceHighlights.length > 4) evidenceHighlights.pop();
  if (evidenceHighlights.length === 0 && scoreReason) {
    evidenceHighlights.push(truncate(scoreReason, 200));
  }

  const unknownsNote =
    scoring?.unknowns?.slice(0, 4).map((u) => `${u.topic}：${truncate(u.note, 120)}`) ?? [];

  let internalLaunchHint: string | undefined;
  if (scoring?.launchIntent && scoring.launchIntent.strength !== "low") {
    internalLaunchHint = `弱信号（不作为对外卖点）：${scoring.launchIntent.strength} — ${truncate(scoring.launchIntent.detail, 100)}`;
  }

  return {
    subject: { companyName, country, website },
    keySources,
    dimensions,
    evidenceHighlights: evidenceHighlights.slice(0, 4),
    unknownsNote,
    internalLaunchHint,
    totalScore: finalScore,
    stage: newStage,
    scoreReasonExcerpt: truncate(scoreReason, 420),
    sourceCount: parsed.sources.length,
  };
}

async function loadProspectWithCampaign(
  input: RunProspectResearchInput,
): Promise<{ ok: true; prospect: TradeProspect; campaign: TradeCampaign } | { ok: false; result: RunProspectResearchResult }> {
  if ("prospectId" in input) {
    if (!input.orgId?.trim()) {
      return {
        ok: false,
        result: {
          success: false,
          error: "缺少组织上下文，无法执行研究",
          code: "forbidden",
        },
      };
    }
    const row = await db.tradeProspect.findUnique({
      where: { id: input.prospectId },
      include: { campaign: true },
    });
    if (!row) return { ok: false, result: { success: false, error: "线索不存在", code: "not_found" } };
    if (row.orgId !== input.orgId) {
      return { ok: false, result: { success: false, error: "无权操作该线索", code: "forbidden" } };
    }
    if (row.campaign.orgId !== input.orgId) {
      return {
        ok: false,
        result: { success: false, error: "活动与线索组织不一致", code: "forbidden" },
      };
    }
    const { campaign, ...prospect } = row;
    return { ok: true, prospect, campaign };
  }

  const needle = input.companyName.trim();
  const cid = input.campaignId?.trim();
  const ctry = input.countryHint?.trim();

  if (cid) {
    const campOk = await db.tradeCampaign.findFirst({
      where: { id: cid, orgId: input.orgId },
      select: { id: true },
    });
    if (!campOk) {
      return {
        ok: false,
        result: {
          success: false,
          error: "campaignId 不存在或不属于当前组织，请核对后再试",
          code: "invalid_campaign",
        },
      };
    }
  }

  const matches = await db.tradeProspect.findMany({
    where: {
      orgId: input.orgId,
      companyName: { contains: needle },
      ...(cid ? { campaignId: cid } : {}),
      ...(ctry ? { country: { contains: ctry } } : {}),
    },
    include: { campaign: true },
    orderBy: { updatedAt: "desc" },
    take: 15,
  });
  if (matches.length === 0) {
    const hint =
      cid || ctry
        ? `在 campaignId / countryHint 筛选下未找到与「${needle}」匹配的线索；可去掉筛选再试，或先 trade_search_prospects 再传 prospectId`
        : `本组织下未找到与「${needle}」匹配的线索，可先创建线索或 trade_search_prospects 再传 prospectId`;
    return {
      ok: false,
      result: {
        success: false,
        error: hint,
        code: "no_prospect",
      },
    };
  }

  const norm = (s: string) => s.trim().toLowerCase();
  const exactHits = matches.filter((r) => norm(r.companyName) === norm(needle));
  const chosen = exactHits.length === 1 ? exactHits[0] : matches.length === 1 ? matches[0] : null;

  if (!chosen) {
    const pool = exactHits.length > 1 ? exactHits : matches;
    const candidates: ResearchProspectCandidate[] = pool.slice(0, 8).map((r) => ({
      id: r.id,
      companyName: r.companyName,
      country: r.country,
      website: r.website,
      campaignId: r.campaignId,
      campaignName: r.campaign.name,
    }));
    return {
      ok: false,
      result: {
        success: false,
        error:
          exactHits.length > 1
            ? `有多条线索公司名完全一致「${needle}」，请指定 prospectId；或补充 campaignId / countryHint 再试`
            : `有多条线索名称包含「${needle}」，请 trade_search_prospects（可加 campaignId）缩小范围，或指定 prospectId`,
        code: "ambiguous_prospect",
        candidates,
      },
    };
  }

  const { campaign, ...prospect } = chosen;
  return { ok: true, prospect, campaign };
}

const INSUFFICIENT_SOURCES_THRESHOLD = 3;

function defaultWebsiteCandidateSourceFromImportFlag(source: string): string {
  const s = (source || "").toLowerCase();
  if (s === "1688" || s === "exhibition") return "imported";
  return "user_provided";
}

function uniqWarnings(w: string[]): string[] {
  return [...new Set(w.filter(Boolean))];
}

function computeCrawlStatus(meta: TradeResearchGatherMeta): string {
  if (meta.serpOrganicCount === 0) return "serper_no_result";
  if (meta.mapFailed) return "firecrawl_map_failed";
  if (meta.homepageFromFetchFallback || meta.homepageFallbackOnly) return "homepage_fallback_used";
  if (meta.firecrawlPageCount > 0) return "firecrawl_scrape_success";
  return "firecrawl_map_success";
}

function computeCrawlSourceType(
  websiteCandidateSource: string | null,
  meta: TradeResearchGatherMeta,
): string {
  if (websiteCandidateSource === "serper_auto_high_confidence") return "candidate_website";
  if (websiteCandidateSource === "serper_candidates_pending") return "candidate_website";
  if (websiteCandidateSource === "manual_confirmed") return "official_website";
  if (websiteCandidateSource === "user_provided" || websiteCandidateSource === "imported") {
    return "official_website";
  }
  if (meta.homepageFromFetchFallback && meta.firecrawlPageCount === 0) return "homepage_only";
  if (meta.serpOrganicCount > 0 && meta.firecrawlPageCount === 0 && !meta.homepageFromFetchFallback) {
    return "search_result_only";
  }
  return "unknown";
}

/**
 * 对单条线索执行完整研究：采集 → 报告 → 评分 → 写库 → 返回对话用摘要。
 */
export async function runProspectResearch(
  input: RunProspectResearchInput,
  opts?: RunProspectResearchOptions,
): Promise<RunProspectResearchResult> {
  const loaded = await loadProspectWithCampaign(input);
  if (!loaded.ok) return loaded.result;

  let { prospect, campaign } = loaded;
  const pid = prospect.id;

  const websiteOverride =
    "websiteOverride" in input ? input.websiteOverride : "websiteHint" in input ? input.websiteHint : undefined;

  let canonicalWebsite = (websiteOverride ?? prospect.website)?.trim() || null;

  if (canonicalWebsite && !prospect.websiteCandidateSource) {
    const src =
      websiteOverride?.trim() && !prospect.website?.trim()
        ? "user_provided"
        : defaultWebsiteCandidateSourceFromImportFlag(prospect.source);
    await updateProspect(pid, {
      websiteCandidateSource: src,
      websiteConfidence: prospect.websiteConfidence ?? 0.9,
    });
    prospect = { ...prospect, websiteCandidateSource: src, websiteConfidence: prospect.websiteConfidence ?? 0.9 };
  }

  await updateProspect(pid, {
    researchStatus: "researching",
    lastResearchError: null,
    researchWarnings: [] as unknown as Prisma.InputJsonValue,
  });

  try {
    if (!canonicalWebsite) {
      const q = buildSerpWebsiteQuery(prospect.companyName, prospect.country, campaign.targetMarket);
      const serp = await searchGoogle(q, { num: 10 });
      if (serp.length === 0) {
        await updateProspect(pid, {
          researchStatus: "website_needed",
          crawlStatus: "serper_no_result",
          lastResearchError: "搜索引擎未返回与该公司相关的网页结果，无法推断官网",
        });
        return {
          success: false,
          code: "website_needed",
          error: "未找到可用的搜索引擎结果，请人工补充官网后再研究",
        };
      }

      const kws = extractProductKeywords(campaign.productDesc, campaign.targetMarket);
      const candidates = scoreWebsiteCandidates(prospect.companyName, prospect.country, kws, serp);
      await updateProspect(pid, {
        websiteCandidates: candidates as unknown as Prisma.InputJsonValue,
        crawlStatus: "serper_success",
        researchStatus: "website_candidates_found",
      });

      const top = candidates[0];
      if (shouldAutoPickCandidate(top)) {
        await updateProspect(pid, {
          website: top.url,
          websiteConfidence: top.confidence,
          websiteCandidateSource: "serper_auto_high_confidence",
          researchStatus: "research_pending",
        });
        canonicalWebsite = top.url;
        prospect = {
          ...prospect,
          website: top.url,
          websiteConfidence: top.confidence,
          websiteCandidateSource: "serper_auto_high_confidence",
        };
      } else {
        const st =
          top && top.confidence >= 0.45 && !top.rejectedReason ? "low_confidence" : "website_candidates_found";
        await updateProspect(pid, {
          researchStatus: st,
          websiteCandidateSource: "serper_candidates_pending",
          websiteConfidence: top?.confidence ?? null,
          researchWarnings: ["website_not_confirmed", "low_website_confidence"] as unknown as Prisma.InputJsonValue,
        });
        return {
          success: false,
          code: "website_confirmation_needed",
          error: "无法高置信度自动认定官网，请在详情中确认官网后再执行研究",
        };
      }
    }

    const { rawData, sources, meta } = await gatherTradeResearchInputs({
      companyName: prospect.companyName,
      country: prospect.country,
      website: canonicalWebsite,
    });

    const gatherWarnings: string[] = [];
    if (meta.mapFailed) gatherWarnings.push("firecrawl_failed");
    if (meta.homepageFromFetchFallback || meta.homepageFallbackOnly) {
      gatherWarnings.push("only_homepage_used");
    }
    if (sources.length < INSUFFICIENT_SOURCES_THRESHOLD) {
      gatherWarnings.push("insufficient_sources");
    }

    const crawlStatus = computeCrawlStatus(meta);
    const crawlSourceType = computeCrawlSourceType(prospect.websiteCandidateSource, meta);

    const { report, fieldSourceIds } = await generateResearchReport(
      {
        name: prospect.companyName,
        website: canonicalWebsite,
        country: prospect.country,
        rawData: rawData || undefined,
      },
      campaign.productDesc,
      campaign.targetMarket,
      sources,
    );

    const scoreResult = await scoreProspect(sources, report, campaign.productDesc, campaign.targetMarket, {
      includeDebug: opts?.includeScoringDebug,
    });

    const researchBundle = mergeResearchBundle(sources, report, fieldSourceIds, scoreResult.scoring);
    const finalScore = researchBundle.scoring?.totalFromDimensions ?? scoreResult.score;
    const passed = finalScore >= campaign.scoreThreshold;
    const newStage = stageAfterResearchScore(prospect.stage, passed);

    const researchWarnings = uniqWarnings(gatherWarnings);
    const researchStatus =
      researchWarnings.length > 0 ? "researched_with_warnings" : "researched";

    const updatedProspect = await updateProspect(pid, {
      researchReport: researchBundle,
      score: finalScore,
      scoreReason: scoreResult.reason,
      stage: newStage,
      website: canonicalWebsite ?? prospect.website,
      researchStatus,
      researchWarnings: researchWarnings as unknown as Prisma.InputJsonValue,
      crawlStatus,
      crawlSourceType,
      sourcesCount: sources.length,
      lastResearchError: null,
      lastResearchedAt: new Date(),
    });

    const prevNorm = normalizeTradeProspectStage(prospect.stage);
    if (
      opts?.incrementCampaignQualifiedIfQualified &&
      passed &&
      (prevNorm === "new" || prevNorm === "discovered")
    ) {
      await db.tradeCampaign.update({
        where: { id: campaign.id },
        data: { qualified: { increment: 1 } },
      });
    }

    const chatSummary = buildChatSummary({
      companyName: prospect.companyName,
      country: prospect.country,
      website: canonicalWebsite ?? prospect.website,
      bundle: researchBundle,
      finalScore,
      newStage,
      scoreReason: scoreResult.reason,
    });

    const scoringOut = researchBundle.scoring ?? scoreResult.scoring;

    return {
      success: true,
      prospectId: prospect.id,
      updatedProspect,
      researchBundle,
      finalScore,
      newStage,
      scoreReason: scoreResult.reason,
      scoreForApi: { score: finalScore, reason: scoreResult.reason, scoring: scoringOut },
      chatSummary,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateProspect(pid, {
      researchStatus: "failed",
      lastResearchError: msg.slice(0, 1990),
    });
    return {
      success: false,
      code: "research_failed",
      error: msg,
    };
  }
}
