/**
 * Trade — 统一研究服务层
 *
 * 单条 API、批量、流水线、对话 Agent 共用；内部仍走 gather → report → scoring → bundle。
 */

import { db } from "@/lib/db";
import { updateProspect } from "@/lib/trade/service";
import { generateResearchReport, scoreProspect } from "@/lib/trade/agents";
import {
  mergeResearchBundle,
  parseResearchBundle,
  type ResearchBundleV1,
  type ScoreDimensionKey,
} from "@/lib/trade/research-bundle";
import { gatherTradeResearchInputs } from "@/lib/trade/research-input";

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
  | { prospectId: string; orgId?: string; websiteOverride?: string | null }
  | { orgId: string; companyName: string; websiteHint?: string | null };

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
  | { success: false; error: string; code: "not_found" | "forbidden" | "no_prospect" };

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
): Promise<
  | { ok: true; prospect: { id: string; orgId: string; companyName: string; country: string | null; website: string | null; campaignId: string }; campaign: { id: string; productDesc: string; targetMarket: string; scoreThreshold: number; orgId: string } }
  | { ok: false; result: RunProspectResearchResult }
> {
  if ("prospectId" in input) {
    const row = await db.tradeProspect.findUnique({
      where: { id: input.prospectId },
      include: { campaign: true },
    });
    if (!row) return { ok: false, result: { success: false, error: "线索不存在", code: "not_found" } };
    if (input.orgId && row.orgId !== input.orgId) {
      return { ok: false, result: { success: false, error: "无权操作该线索", code: "forbidden" } };
    }
    return {
      ok: true,
      prospect: {
        id: row.id,
        orgId: row.orgId,
        companyName: row.companyName,
        country: row.country,
        website: row.website,
        campaignId: row.campaignId,
      },
      campaign: row.campaign,
    };
  }

  const row = await db.tradeProspect.findFirst({
    where: { orgId: input.orgId, companyName: { contains: input.companyName } },
    include: { campaign: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) {
    return {
      ok: false,
      result: {
        success: false,
        error: `本组织下未找到与「${input.companyName}」匹配的线索，请先创建线索或提供 prospectId`,
        code: "no_prospect",
      },
    };
  }
  return {
    ok: true,
    prospect: {
      id: row.id,
      orgId: row.orgId,
      companyName: row.companyName,
      country: row.country,
      website: row.website,
      campaignId: row.campaignId,
    },
    campaign: row.campaign,
  };
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

  const { prospect, campaign } = loaded;

  const websiteOverride =
    "websiteOverride" in input ? input.websiteOverride : "websiteHint" in input ? input.websiteHint : undefined;

  const { rawData, sources, website: resolvedWebsite } = await gatherTradeResearchInputs({
    companyName: prospect.companyName,
    country: prospect.country,
    website: websiteOverride ?? prospect.website,
  });

  const { report, fieldSourceIds } = await generateResearchReport(
    {
      name: prospect.companyName,
      website: prospect.website,
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
  const newStage = finalScore >= campaign.scoreThreshold ? "qualified" : "unqualified";

  const updatedProspect = await updateProspect(prospect.id, {
    researchReport: researchBundle,
    score: finalScore,
    scoreReason: scoreResult.reason,
    stage: newStage,
    website: resolvedWebsite ?? prospect.website,
  });

  if (opts?.incrementCampaignQualifiedIfQualified && newStage === "qualified") {
    await db.tradeCampaign.update({
      where: { id: campaign.id },
      data: { qualified: { increment: 1 } },
    });
  }

  const chatSummary = buildChatSummary({
    companyName: prospect.companyName,
    country: prospect.country,
    website: resolvedWebsite ?? prospect.website,
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
}
