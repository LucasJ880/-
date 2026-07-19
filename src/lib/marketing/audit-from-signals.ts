/**
 * 七维体检半自动提议：基于企业事实 + 近期市场情报信号生成建议分与 Finding。
 * 不写库；人工确认后仍走 POST /api/marketing/audits。
 */

import { db } from "@/lib/db";
import {
  DIMENSION_LABELS,
  MARKETING_DIMENSIONS,
  clampScore,
  scoreToGrade,
  type MarketingDimension,
} from "./constants";
import { stringList } from "./brand-validation";

export interface ProposedScore {
  dimension: MarketingDimension;
  score: number;
  grade: string;
  confidence: number;
  rationale: string;
}

export interface ProposedFinding {
  dimension: MarketingDimension;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  currentValue: string | null;
  expectedValue: string | null;
  evidenceUrl: string | null;
  confidence: number;
  sourceSignalId?: string;
}

export interface ProposedAuditContext {
  geography: string;
  industry: string;
  product: string;
  competitors: string[];
  query: string;
}

export interface ProposeAuditResult {
  contexts: ProposedAuditContext[];
  scores: ProposedScore[];
  findings: ProposedFinding[];
  confidence: number;
  signalCount: number;
  notes: string[];
}

function baseScores(): Record<MarketingDimension, number> {
  return {
    AI_VISIBILITY: 62,
    SEO: 65,
    LISTINGS: 60,
    REVIEWS: 58,
    SOCIAL: 55,
    WEBSITE: 64,
    ADVERTISING: 50,
  };
}

function adjust(
  scores: Record<MarketingDimension, number>,
  dimension: MarketingDimension,
  delta: number,
  rationales: Record<MarketingDimension, string[]>,
  reason: string,
) {
  scores[dimension] = clampScore(scores[dimension] + delta);
  rationales[dimension].push(reason);
}

function mapSignalToDimension(signalType: string, text: string): MarketingDimension {
  const hay = `${signalType} ${text}`.toLowerCase();
  if (/price|promo|discount|ad|campaign|offer|sale|优惠|促销|广告/.test(hay)) {
    return "ADVERTISING";
  }
  if (/review|rating|testimonial|评价|口碑/.test(hay)) return "REVIEWS";
  if (/social|instagram|facebook|tiktok|xiaohongshu|社媒|小红书/.test(hay)) {
    return "SOCIAL";
  }
  if (/seo|blog|content_change|product_or_positioning|keyword/.test(hay)) return "SEO";
  if (/listing|gbp|map|本地|目录/.test(hay)) return "LISTINGS";
  if (/ai|chatgpt|perplexity|可见度/.test(hay)) return "AI_VISIBILITY";
  return "WEBSITE";
}

function severityPenalty(severity: string): number {
  if (severity === "high") return 12;
  if (severity === "medium") return 7;
  return 3;
}

function findingSeverity(severity: string): ProposedFinding["severity"] {
  if (severity === "high") return "high";
  if (severity === "medium") return "medium";
  return "low";
}

export async function proposeAuditFromSignals(orgId: string): Promise<ProposeAuditResult> {
  const profile = await db.marketingBrandProfile.findUnique({ where: { orgId } });
  if (!profile || profile.validationStatus !== "valid") {
    throw new Error("请先完成并通过企业事实中心校验");
  }

  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const signals = await db.marketSignal.findMany({
    where: {
      orgId,
      createdAt: { gte: since },
      status: { in: ["pending", "reviewed"] },
    },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take: 40,
    include: {
      snapshot: { select: { url: true } },
    },
  });

  const competitors = await db.marketCompetitor.findMany({
    where: { orgId, status: "active" },
    select: { id: true, name: true },
    take: 20,
  });
  const competitorNames = new Map(competitors.map((c) => [c.id, c.name]));

  const scores = baseScores();
  const rationales = Object.fromEntries(
    MARKETING_DIMENSIONS.map((d) => [d, [] as string[]]),
  ) as Record<MarketingDimension, string[]>;
  const notes: string[] = [];

  // 企业事实完整度微调
  const products = stringList(profile.productsJson);
  const serviceAreas = stringList(profile.serviceAreasJson);
  const brandCompetitors = stringList(profile.competitorsJson);
  if (products.length >= 3) {
    adjust(scores, "WEBSITE", 4, rationales, "企业事实中产品线较完整");
  }
  if (serviceAreas.length >= 2) {
    adjust(scores, "LISTINGS", 5, rationales, "服务区域已明确");
  }
  if (brandCompetitors.length === 0 && competitors.length === 0) {
    adjust(scores, "ADVERTISING", -8, rationales, "尚未登记竞争对手，竞争情报不足");
    notes.push("建议在企业事实或市场情报中补充竞争对手。");
  }
  if (competitors.length >= 2) {
    adjust(scores, "AI_VISIBILITY", 3, rationales, "已监听多个竞品，便于持续对标");
  }

  const findings: ProposedFinding[] = [];
  let highCount = 0;
  for (const signal of signals) {
    const name = competitorNames.get(signal.competitorId) ?? "竞品";
    const dim = mapSignalToDimension(signal.signalType, `${signal.title} ${signal.summary}`);
    const penalty = severityPenalty(signal.severity);
    if (signal.severity === "high") highCount += 1;
    adjust(
      scores,
      dim,
      -penalty,
      rationales,
      `${name}·${signal.signalType}（${signal.severity}）`,
    );
    // 关键变化额外打到广告/网站
    if (signal.signalType === "commercial_change") {
      adjust(scores, "ADVERTISING", -4, rationales, `${name} 出现商业向变化`);
    }
    if (signal.severity === "high" || signal.severity === "medium") {
      findings.push({
        dimension: dim,
        severity: findingSeverity(signal.severity),
        title: `${name}：${signal.title}`.slice(0, 300),
        description: [
          signal.summary,
          "建议：结合我方品牌定位改写内容/落地页/广告角度，勿照搬对方价格或承诺。",
        ].join("\n"),
        currentValue: signal.summary.slice(0, 500),
        expectedValue: `针对 ${DIMENSION_LABELS[dim]} 制定我方应对选题或页面优化`,
        evidenceUrl: signal.snapshot?.url ?? null,
        confidence: signal.severity === "high" ? 75 : 65,
        sourceSignalId: signal.id,
      });
    }
  }

  if (signals.length === 0) {
    notes.push("近 30 天无待处理/已确认情报信号，建议分偏保守基线，请人工校准。");
    adjust(scores, "SOCIAL", -5, rationales, "缺少近期竞品动态输入");
  } else {
    notes.push(`已纳入近 30 天 ${signals.length} 条情报信号（高优先级 ${highCount}）。`);
  }

  if (highCount >= 3) {
    adjust(scores, "AI_VISIBILITY", -6, rationales, "竞品高频关键变化，对外可见度压力上升");
  }

  const scoreRows: ProposedScore[] = MARKETING_DIMENSIONS.map((dimension) => {
    const score = clampScore(scores[dimension]);
    const rationale =
      rationales[dimension].slice(0, 4).join("；") || "基线分（无额外情报加减）";
    return {
      dimension,
      score,
      grade: scoreToGrade(score),
      confidence: signals.length > 0 ? 70 : 45,
      rationale,
    };
  });

  const geography = serviceAreas[0] || profile.city || profile.region || "";
  const contexts: ProposedAuditContext[] = [
    {
      geography,
      industry: profile.industry || "",
      product: products[0] || "",
      competitors: brandCompetitors.length > 0
        ? brandCompetitors.slice(0, 5)
        : competitors.map((c) => c.name).slice(0, 5),
      query: geography
        ? `best ${products[0] || "window treatments"} in ${geography}`
        : `best ${products[0] || "window treatments"}`,
    },
  ];

  const confidence = clampScore(
    40 + Math.min(40, signals.length * 4) + (highCount > 0 ? 10 : 0),
  );

  return {
    contexts,
    scores: scoreRows,
    findings: findings.slice(0, 12),
    confidence,
    signalCount: signals.length,
    notes,
  };
}
