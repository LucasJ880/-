/**
 * P2-alpha / P2-beta：规则打底维度分 + 研究评分 signals（与页面监控 TradeSignal 无关）
 * 仅使用 sources 可复核文本；无证据则维度为 0、不产出对外 signal。
 */

import type { ResearchSource } from "@/lib/trade/research-bundle";
import type {
  LaunchIntentSignalV1,
  ResearchScoreSignalV1,
  ScoreDimensionKey,
  ScoreDimensionV1,
  ScoringDebugV1,
  ScoringProfileV1,
  ScoringUnknownV1,
} from "@/lib/trade/research-bundle";
import {
  CHANNEL_B2B_STRONG_MIN_SOURCES,
  CHANNEL_B2B_TERMS,
  CHANNEL_RETAIL_TERMS,
  COMPLIANCE_CORE_TERMS,
  COMPLIANCE_EU_HINT_TERMS,
  COMPLIANCE_SIZE_CHILD_TERMS,
  COMPLIANCE_US_HINT_TERMS,
  detectMarketRegionHint,
  SCORE_DIMENSION_KEYS,
  SCORE_DIMENSION_WEIGHTS,
  SOURCING_TERMS,
  termsToRegex,
  totalScoreFromDimensionScores,
  totalScoreWeighted,
  VERTICAL_TERMS,
} from "@/lib/trade/scoring-config";

function sourceText(s: ResearchSource): string {
  return `${s.title} ${s.snippet ?? ""} ${s.url}`.toLowerCase();
}

function textById(sources: ResearchSource[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of sources) {
    m.set(s.id, sourceText(s));
  }
  return m;
}

function idsWhere(map: Map<string, string>, test: (text: string) => boolean): string[] {
  const out: string[] = [];
  for (const [id, text] of map) {
    if (test(text)) out.push(id);
  }
  return [...new Set(out)];
}

const RE_VERTICAL = termsToRegex(VERTICAL_TERMS, false);
const RE_B2B = termsToRegex(CHANNEL_B2B_TERMS, false);
const RE_RETAIL = termsToRegex(CHANNEL_RETAIL_TERMS, false);
const RE_SOURCING = termsToRegex(SOURCING_TERMS, false);

const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const RE_PHONE = /\+?\d[\d\s\-().]{8,}\d/;
const RE_CONTACT =
  /contact\s+us|get\s+in\s+touch|inquir|sales@|info@|hello@|customer\s+service/i;

const RE_LAUNCH_WEAK =
  /coming\s+soon|new\s+collection|new\s+arrival|pre[\s-]*order|drop\s+soon|ss\d{2}|fw\d{2}|just\s+dropped|launching\s+soon/i;

function buildComplianceRegex(productDesc: string, targetMarket: string): RegExp {
  const terms = [
    ...COMPLIANCE_CORE_TERMS,
    ...COMPLIANCE_SIZE_CHILD_TERMS,
  ];
  const hint = detectMarketRegionHint(`${targetMarket}\n${productDesc}`);
  if (hint === "us") terms.push(...COMPLIANCE_US_HINT_TERMS);
  if (hint === "eu") terms.push(...COMPLIANCE_EU_HINT_TERMS);
  return termsToRegex(terms, false);
}

function tokenizeProductDesc(productDesc: string): string[] {
  return productDesc
    .toLowerCase()
    .split(/[\s,，。;；/|]+/)
    .map((w) => w.replace(/[^\w\u4e00-\u9fff]/g, ""))
    .filter((w) => w.length >= 2);
}

function idsKeywordOverlap(map: Map<string, string>, keywords: string[]): string[] {
  const out: string[] = [];
  for (const [id, text] of map) {
    if (keywords.some((kw) => text.includes(kw))) out.push(id);
  }
  return [...new Set(out)];
}

function dim(
  key: ScoreDimensionKey,
  score: number,
  evidenceIds: string[],
  rationale: string,
): ScoreDimensionV1 {
  const s = Math.min(2, Math.max(0, score));
  const ids = [...new Set(evidenceIds)].filter(Boolean);
  return { key, score: s, max: 2 as const, evidenceIds: ids, rationale };
}

function scoreProductFit(
  map: Map<string, string>,
  productDesc: string,
): ScoreDimensionV1 {
  const verticalIds = idsWhere(map, (t) => RE_VERTICAL.test(t));
  const kws = tokenizeProductDesc(productDesc);
  const overlapIds = kws.length ? idsKeywordOverlap(map, kws) : [];
  const evidenceIds = [...new Set([...verticalIds, ...overlapIds])];

  let score = 0;
  let rationale = "在所检索的公开摘录中，未明显看到与家纺/毯类/睡衣等品类相关的关键词。";
  if (verticalIds.length >= 2 || (verticalIds.length >= 1 && overlapIds.length >= 1)) {
    score = 2;
    rationale = "公开摘录中出现较明确的家纺/毯类或睡衣相关品类表述，或与活动产品描述有文本重合。";
  } else if (verticalIds.length === 1 || overlapIds.length >= 1) {
    score = 1;
    rationale = "公开摘录中有一定家纺或目标产品相关线索，但信息有限。";
  }

  if (evidenceIds.length === 0) {
    return dim("productFit", 0, [], rationale);
  }
  return dim("productFit", score, evidenceIds, rationale);
}

function scoreChannelFit(map: Map<string, string>): ScoreDimensionV1 {
  const b2bIds = idsWhere(map, (t) => RE_B2B.test(t));
  const retailIds = idsWhere(map, (t) => RE_RETAIL.test(t));
  const evidenceIds = [...new Set([...b2bIds, ...retailIds])];

  if (evidenceIds.length === 0) {
    return dim(
      "channelFit",
      0,
      [],
      "在所检索的公开摘录中，未明显看到批发、OEM/ODM、MOQ、FOB 或零售平台等渠道表述。",
    );
  }

  if (b2bIds.length === 0 && retailIds.length > 0) {
    return dim(
      "channelFit",
      1,
      retailIds,
      "摘录主要为零售/电商平台向表述，B2B 批发或贴牌信号较弱（弱信号，非否定合作可能）。",
    );
  }

  if (b2bIds.length >= CHANNEL_B2B_STRONG_MIN_SOURCES) {
    return dim(
      "channelFit",
      2,
      b2bIds,
      "多条公开摘录中出现批发、贸易或 OEM/ODM 等 B2B 渠道表述。",
    );
  }

  const rationale =
    retailIds.length > 0
      ? "同时出现 B2B 与零售/平台向表述，渠道信号混合，以保守分档。"
      : "摘录中出现与批发、贸易或 OEM/ODM 相关的表述之一。";
  return dim("channelFit", 1, [...new Set([...b2bIds, ...retailIds])], rationale);
}

function scoreCompliance(
  map: Map<string, string>,
  productDesc: string,
  targetMarket: string,
): ScoreDimensionV1 {
  const re = buildComplianceRegex(productDesc, targetMarket);
  const ids = idsWhere(map, (t) => re.test(t));
  if (ids.length === 0) {
    return dim(
      "complianceVisibility",
      0,
      [],
      "在所检索的公开摘录中，未明显看到 OEKO-TEX、GOTS、阻燃、GPSR、尺码/儿童睡衣相关字样（仅表示可见度，非证书真伪判断）。",
    );
  }
  const joined = ids.map((id) => map.get(id) ?? "").join(" ");
  let score = 1;
  let rationale =
    "摘录中出现合规、认证、尺码或安全相关字样，属「可见度」弱信号，需人工核对原件。";
  if (ids.length >= 2 || /oeko|gots/i.test(joined)) {
    score = 2;
    rationale = "多条摘录或较明确出现常见合规关键词，可见度较高，仍需人工核实。";
  }
  return dim("complianceVisibility", score, ids, rationale);
}

function scoreReachability(map: Map<string, string>): ScoreDimensionV1 {
  const emailIds = idsWhere(map, (t) => RE_EMAIL.test(t));
  const phoneIds = idsWhere(map, (t) => RE_PHONE.test(t));
  const contactIds = idsWhere(
    map,
    (t) => RE_CONTACT.test(t) || /\/contact|\/pages\/contact/i.test(t),
  );
  const evidenceIds = [...new Set([...emailIds, ...phoneIds, ...contactIds])];

  if (evidenceIds.length === 0) {
    return dim(
      "reachability",
      0,
      [],
      "在所检索的公开摘录中，未明显看到邮箱、电话或明确的联系入口表述。",
    );
  }

  const hasEmail = emailIds.length > 0;
  const hasPhone = phoneIds.length > 0;
  const hasContact = contactIds.length > 0;

  let score = 1;
  let rationale = "摘录中出现联系相关线索（如联系页措辞或通用邮箱域）。";
  if (hasEmail || (hasPhone && hasContact)) {
    score = 2;
    rationale = "摘录中出现较明确的邮箱，或同时具备电话与联系入口类表述。";
  }

  return dim("reachability", score, evidenceIds, rationale);
}

function buildSignals(map: Map<string, string>): ResearchScoreSignalV1[] {
  const out: ResearchScoreSignalV1[] = [];

  const b2bIds = idsWhere(map, (t) => RE_B2B.test(t));
  const retailIds = idsWhere(map, (t) => RE_RETAIL.test(t));
  const chIds = [...new Set([...b2bIds, ...retailIds])];
  if (chIds.length) {
    out.push({
      type: "channelsObserved",
      label: "渠道表述",
      strength: b2bIds.length >= CHANNEL_B2B_STRONG_MIN_SOURCES ? "med" : "low",
      detail:
        retailIds.length > 0 && b2bIds.length === 0
          ? "主要为零售/平台向渠道措辞（弱信号）。"
          : "公开摘录中出现批发、贸易或 OEM/ODM 等渠道相关措辞（弱信号）。",
      evidenceIds: chIds,
    });
  }

  const re = termsToRegex(
    [...COMPLIANCE_CORE_TERMS, ...COMPLIANCE_SIZE_CHILD_TERMS],
    false,
  );
  const coIds = idsWhere(map, (t) => re.test(t));
  if (coIds.length) {
    out.push({
      type: "complianceSignals",
      label: "合规可见度",
      strength: coIds.length >= 2 ? "med" : "low",
      detail: "摘录中出现合规、认证或安全相关字样，仅表示页面上可见度，不代表已核验证书。",
      evidenceIds: coIds,
    });
  }

  const soIds = idsWhere(map, (t) => RE_SOURCING.test(t));
  if (soIds.length) {
    out.push({
      type: "sourcingSignals",
      label: "采购/条款线索",
      strength: "low",
      detail: "出现 MOQ、FOB、贴牌等采购或条款类线索（弱信号）。",
      evidenceIds: soIds,
    });
  }

  return out;
}

function buildLaunchIntent(map: Map<string, string>): LaunchIntentSignalV1 | undefined {
  const ids = idsWhere(map, (t) => RE_LAUNCH_WEAK.test(t));
  if (ids.length === 0) return undefined;
  return {
    strength: ids.length >= 2 ? "med" : "low",
    detail:
      "弱信号：公开摘录中出现可能与上新、季款或预售相关的措辞，不代表已确定采购或上新计划。",
    evidenceIds: ids,
  };
}

function buildUnknowns(
  dimensions: ScoreDimensionV1[],
  allSourceIds: string[],
): ScoringUnknownV1[] {
  const unknowns: ScoringUnknownV1[] = [];
  const byKey = Object.fromEntries(dimensions.map((d) => [d.key, d])) as Record<
    ScoreDimensionKey,
    ScoreDimensionV1
  >;

  if (byKey.complianceVisibility.score < 2) {
    unknowns.push({
      id: "u_compliance",
      topic: "合规信息",
      note:
        "在当前检索到的公开网页与摘要片段中，未明显看到更完整的合规或认证类表述；这不代表对方一定不具备相关资质。",
      scopeEvidenceIds: allSourceIds.length ? [...allSourceIds] : undefined,
    });
  }

  if (byKey.reachability.score < 2) {
    unknowns.push({
      id: "u_reach",
      topic: "联系方式",
      note:
        "在当前检索到的公开网页与摘要片段中，未明显看到可直接用于初次触达的有效邮箱或电话；仍可通过官网其他页面或第三方渠道进一步核实。",
      scopeEvidenceIds: allSourceIds.length ? [...allSourceIds] : undefined,
    });
  }

  if (byKey.productFit.score < 2) {
    unknowns.push({
      id: "u_product",
      topic: "品类与主营",
      note:
        "在当前检索到的公开网页与摘要片段中，未明显看到与目标家纺品类强相关的描述；可能受检索摘要长度或官网结构限制。",
      scopeEvidenceIds: allSourceIds.length ? [...allSourceIds] : undefined,
    });
  }

  return unknowns.slice(0, 3);
}

function buildScoringDebug(dimensions: ScoreDimensionV1[]): ScoringDebugV1 {
  const weights = SCORE_DIMENSION_WEIGHTS;
  const parts: string[] = [];
  let wsum = 0;
  let maxW = 0;
  for (const k of SCORE_DIMENSION_KEYS) {
    const d = dimensions.find((x) => x.key === k)!;
    const w = weights[k];
    parts.push(`${w}×${d.score}`);
    wsum += w * d.score;
    maxW += w * 2;
  }
  const total = totalScoreFromDimensionScores(dimensions, weights);
  const formula = `round((${parts.join("+")}) / ${maxW} × 10, 1) = ${total}`;
  const weightNotes = `权重: ${SCORE_DIMENSION_KEYS.map((k) => `${k}=${weights[k]}`).join(", ")} · 加权和=${wsum} / 满分加权=${maxW}`;

  const dimensionLines = dimensions.map((d) => ({
    key: d.key,
    line: `${d.key} ${d.score}/2 · 证据 [${d.evidenceIds.join(", ") || "无"}]`,
  }));

  return {
    ruleSetVersion: "p2beta_v1",
    formula,
    dimensionLines,
    weightNotes,
  };
}

export function totalScoreFromDimensions(dimensions: ScoreDimensionV1[]): number {
  return totalScoreFromDimensionScores(dimensions, SCORE_DIMENSION_WEIGHTS);
}

/** 规则层评分理由骨架（供 LLM 润色或直接使用），含来源 id 便于复核 */
export function buildScoreReasonSkeleton(
  scoring: Pick<ScoringProfileV1, "dimensions" | "totalFromDimensions">,
): string {
  const parts = scoring.dimensions.map((d) => {
    const ev = d.evidenceIds.length ? d.evidenceIds.map((id) => `[${id}]`).join("") : "";
    return `${d.key}=${d.score}/${d.max}${ev}：${d.rationale}`;
  });
  return `总分 ${scoring.totalFromDimensions.toFixed(1)}/10（四维度加权换算）。${parts.join(" ")}`;
}

export function computeScoringProfile(
  sources: ResearchSource[],
  productDesc: string,
  targetMarket: string,
  opts?: { includeDebug?: boolean },
): ScoringProfileV1 {
  const map = textById(sources);
  const campaignText = `${productDesc}\n${targetMarket}`;
  const dimensions: ScoreDimensionV1[] = [
    scoreProductFit(map, campaignText),
    scoreChannelFit(map),
    scoreCompliance(map, productDesc, targetMarket),
    scoreReachability(map),
  ];

  const dimensionSum = dimensions.reduce((a, d) => a + d.score, 0);
  const scoresByKey = Object.fromEntries(dimensions.map((d) => [d.key, d.score])) as Record<
    ScoreDimensionKey,
    number
  >;
  const totalFromDimensions = totalScoreWeighted(
    scoresByKey,
    SCORE_DIMENSION_WEIGHTS,
  );

  const allSourceIds = sources.map((s) => s.id);

  const researchScoreSignals = buildSignals(map);
  const launchIntent = buildLaunchIntent(map);
  const unknowns = buildUnknowns(dimensions, allSourceIds);

  const debug =
    opts?.includeDebug === true ? buildScoringDebug(dimensions) : undefined;

  return {
    version: 1,
    computedAt: new Date().toISOString(),
    model: "rules+p2beta_v1",
    dimensions,
    researchScoreSignals,
    unknowns: unknowns.length ? unknowns : undefined,
    launchIntent,
    dimensionSum,
    totalFromDimensions,
    debug,
  };
}
