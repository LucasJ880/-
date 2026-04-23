/**
 * Trade 研究报告 — sources 一等公民 + 与 DB Json 兼容解析
 *
 * 存于 TradeProspect.researchReport：
 * - v1 bundle：{ v, generatedAt, sources, report, fieldSourceIds? }
 * - legacy：平铺 ResearchReport 七字段（无 v、无 sources）
 */

import type { SearchResult } from "./tools";
import type { PageContent } from "./tools";
import { totalScoreFromDimensionScores } from "@/lib/trade/scoring-config";

/** 研究报告正文（与 legacy 平铺 Json 字段一致） */
export interface ResearchReport {
  companyOverview: string;
  products: string;
  marketPosition: string;
  importHistory: string;
  contactInfo: string;
  matchAnalysis: string;
  recommendations: string;
}

export type ResearchSourceKind = "search" | "homepage";

export interface ResearchSource {
  id: string;
  url: string;
  title: string;
  kind: ResearchSourceKind;
  snippet?: string;
}

export const RESEARCH_REPORT_KEYS: (keyof ResearchReport)[] = [
  "companyOverview",
  "products",
  "marketPosition",
  "importHistory",
  "contactInfo",
  "matchAnalysis",
  "recommendations",
];

// ── P2-alpha：研究评分结构化（与 TradeSignal 页面监控无关）────────────────

export type ScoreDimensionKey =
  | "productFit"
  | "channelFit"
  | "complianceVisibility"
  | "reachability";

export interface ScoreDimensionV1 {
  key: ScoreDimensionKey;
  score: number;
  max: 2;
  evidenceIds: string[];
  rationale: string;
}

export type ResearchScoreSignalType =
  | "channelsObserved"
  | "complianceSignals"
  | "sourcingSignals"
  | "launchIntentSignal";

export interface ResearchScoreSignalV1 {
  type: ResearchScoreSignalType;
  label: string;
  strength: "low" | "med" | "high";
  detail: string;
  evidenceIds: string[];
}

export interface ScoringUnknownV1 {
  id: string;
  topic: string;
  /** 对用户：仅表示当前公开摘录中未明显看到，非「已确认缺失」 */
  note: string;
  scopeEvidenceIds?: string[];
}

/** 可选；第一轮 UI 可不展示 */
export interface LaunchIntentSignalV1 {
  strength: "low" | "med" | "high";
  detail: string;
  evidenceIds: string[];
}

/** P2-beta：内部调试快照（可选；仅 admin 单条研究等场景写入） */
export interface ScoringDebugV1 {
  ruleSetVersion: string;
  /** 人类可读的换算说明 */
  formula: string;
  /** 每维命中摘要（不含大段原文） */
  dimensionLines: { key: ScoreDimensionKey; line: string }[];
  /** 权重与加权和（复核总分用） */
  weightNotes: string;
}

export interface ScoringProfileV1 {
  version: 1;
  computedAt: string;
  model: "rules+p2alpha_v1" | "rules+p2beta_v1";
  dimensions: ScoreDimensionV1[];
  researchScoreSignals: ResearchScoreSignalV1[];
  unknowns?: ScoringUnknownV1[];
  launchIntent?: LaunchIntentSignalV1;
  /** 四维度原始分之和 0–8 */
  dimensionSum: number;
  /** 加权映射到 0–10（一位小数）；p2beta 起与权重配置一致 */
  totalFromDimensions: number;
  /** 可选调试块 */
  debug?: ScoringDebugV1;
}

export interface ResearchBundleV1 {
  v: 1;
  generatedAt: string;
  sources: ResearchSource[];
  report: ResearchReport;
  fieldSourceIds?: Partial<Record<keyof ResearchReport, string[]>>;
  /** P2-alpha：与本次 sources 对齐的规则评分快照 */
  scoring?: ScoringProfileV1;
}

export type StoredResearchReport = ResearchBundleV1 | ResearchReport;

/** 由 Serper 结果 + 可选首页抓取构建稳定 id 的来源列表（上限 cap） */
export function buildSourcesFromSerpAndPage(
  searchResults: SearchResult[],
  homepage: PageContent | null,
  homepageUrl: string | null,
  opts?: { maxSearch?: number },
): ResearchSource[] {
  const maxSearch = opts?.maxSearch ?? 5;
  const sources: ResearchSource[] = [];
  let n = 0;
  for (const r of searchResults.slice(0, maxSearch)) {
    n++;
    sources.push({
      id: `s${n}`,
      url: r.link,
      title: r.title || r.link,
      kind: "search",
      snippet: r.snippet || undefined,
    });
  }
  if (homepage?.ok && homepageUrl) {
    n++;
    const excerpt = homepage.text.replace(/\s+/g, " ").trim().slice(0, 400);
    sources.push({
      id: `s${n}`,
      url: homepageUrl,
      title: homepage.title || homepageUrl,
      kind: "homepage",
      snippet: excerpt || undefined,
    });
  }
  return sources;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function looksLikeLegacyReport(obj: Record<string, unknown>): boolean {
  return (
    typeof obj.companyOverview === "string" ||
    typeof obj.products === "string" ||
    typeof obj.marketPosition === "string"
  );
}

function coerceReport(obj: unknown): ResearchReport | null {
  if (!isRecord(obj)) return null;
  return {
    companyOverview: String(obj.companyOverview ?? ""),
    products: String(obj.products ?? ""),
    marketPosition: String(obj.marketPosition ?? ""),
    importHistory: String(obj.importHistory ?? ""),
    contactInfo: String(obj.contactInfo ?? ""),
    matchAnalysis: String(obj.matchAnalysis ?? ""),
    recommendations: String(obj.recommendations ?? ""),
  };
}

export function sanitizeFieldSourceIds(
  fieldSourceIds: Partial<Record<string, string[]>> | undefined,
  validIds: Set<string>,
): Partial<Record<keyof ResearchReport, string[]>> | undefined {
  if (!fieldSourceIds || !isRecord(fieldSourceIds)) return undefined;
  const out: Partial<Record<keyof ResearchReport, string[]>> = {};
  for (const key of RESEARCH_REPORT_KEYS) {
    const arr = fieldSourceIds[key as string];
    if (!Array.isArray(arr)) continue;
    const filtered = arr.filter((x): x is string => typeof x === "string" && validIds.has(x));
    if (filtered.length) out[key] = filtered;
  }
  return Object.keys(out).length ? out : undefined;
}

export function mergeResearchBundle(
  sources: ResearchSource[],
  report: ResearchReport,
  fieldSourceIds: Partial<Record<keyof ResearchReport, string[]>> | undefined,
  scoring?: ScoringProfileV1,
): ResearchBundleV1 {
  const valid = new Set(sources.map((s) => s.id));
  const cleaned = sanitizeFieldSourceIds(fieldSourceIds, valid);
  const bundle: ResearchBundleV1 = {
    v: 1,
    generatedAt: new Date().toISOString(),
    sources,
    report,
  };
  if (cleaned && Object.keys(cleaned).length > 0) {
    bundle.fieldSourceIds = cleaned;
  }
  if (scoring) {
    bundle.scoring = sanitizeScoringProfile(scoring, valid);
  }
  return bundle;
}

function isDimKey(x: string): x is ScoreDimensionKey {
  return (
    x === "productFit" ||
    x === "channelFit" ||
    x === "complianceVisibility" ||
    x === "reachability"
  );
}

function isSignalType(x: string): x is ResearchScoreSignalType {
  return (
    x === "channelsObserved" ||
    x === "complianceSignals" ||
    x === "sourcingSignals" ||
    x === "launchIntentSignal"
  );
}

function isStrength(x: string): x is "low" | "med" | "high" {
  return x === "low" || x === "med" || x === "high";
}

/** 剔除非法 source id、无证据的 signal；launchIntent 无证据则删除 */
export function sanitizeScoringProfile(
  scoring: ScoringProfileV1,
  validIds: Set<string>,
): ScoringProfileV1 {
  const filterIds = (ids: string[]) =>
    [...new Set(ids.filter((id) => validIds.has(id)))];

  const dimensions = scoring.dimensions.map((d) => {
    const evidenceIds = filterIds(d.evidenceIds);
    let score = Math.min(2, Math.max(0, Math.round(Number(d.score)) || 0));
    if (evidenceIds.length === 0) score = 0;
    return {
      ...d,
      score,
      max: 2 as const,
      evidenceIds,
    };
  });

  const researchScoreSignals = scoring.researchScoreSignals
    .map((s) => ({
      ...s,
      evidenceIds: filterIds(s.evidenceIds),
    }))
    .filter((s) => s.evidenceIds.length > 0);

  let launchIntent = scoring.launchIntent;
  if (launchIntent) {
    const ids = filterIds(launchIntent.evidenceIds);
    launchIntent =
      ids.length > 0 ? { ...launchIntent, evidenceIds: ids } : undefined;
  }

  const unknowns = scoring.unknowns?.map((u) => ({
    ...u,
    scopeEvidenceIds: u.scopeEvidenceIds
      ? filterIds(u.scopeEvidenceIds)
      : undefined,
  }));

  const dimensionSum = dimensions.reduce((a, d) => a + d.score, 0);
  const totalFromDimensions = totalScoreFromDimensionScores(dimensions);

  return {
    version: 1,
    computedAt: scoring.computedAt,
    model: scoring.model === "rules+p2beta_v1" ? "rules+p2beta_v1" : "rules+p2alpha_v1",
    dimensions,
    researchScoreSignals,
    unknowns: unknowns?.length ? unknowns : undefined,
    launchIntent,
    dimensionSum,
    totalFromDimensions,
    debug: scoring.debug,
  };
}

function parseDebugBlock(raw: unknown): ScoringDebugV1 | undefined {
  if (!isRecord(raw)) return undefined;
  if (String(raw.ruleSetVersion ?? "") !== "p2beta_v1") return undefined;
  const formula = String(raw.formula ?? "");
  const weightNotes = String(raw.weightNotes ?? "");
  const dimensionLines: { key: ScoreDimensionKey; line: string }[] = [];
  const dimLinesRaw = raw.dimensionLines;
  if (Array.isArray(dimLinesRaw)) {
    for (const row of dimLinesRaw) {
      if (!isRecord(row)) continue;
      const key = String(row.key ?? "");
      if (!isDimKey(key)) continue;
      dimensionLines.push({ key, line: String(row.line ?? "") });
    }
  }
  if (!formula && dimensionLines.length === 0 && !weightNotes) return undefined;
  return {
    ruleSetVersion: "p2beta_v1",
    formula,
    weightNotes,
    dimensionLines,
  };
}

function parseScoringProfile(raw: unknown, validIds: Set<string>): ScoringProfileV1 | undefined {
  if (!isRecord(raw) || raw.version !== 1) return undefined;

  const dimsIn = Array.isArray(raw.dimensions) ? raw.dimensions : [];
  const dimensions: ScoreDimensionV1[] = [];
  const seen = new Set<ScoreDimensionKey>();
  for (const row of dimsIn) {
    if (!isRecord(row)) continue;
    const key = String(row.key ?? "");
    if (!isDimKey(key) || seen.has(key)) continue;
    seen.add(key);
    const evidenceIds = Array.isArray(row.evidenceIds)
      ? row.evidenceIds.filter((x): x is string => typeof x === "string" && validIds.has(x))
      : [];
    dimensions.push({
      key,
      score: Math.min(2, Math.max(0, Number(row.score) || 0)),
      max: 2 as const,
      evidenceIds: [...new Set(evidenceIds)],
      rationale: String(row.rationale ?? ""),
    });
  }

  const required: ScoreDimensionKey[] = [
    "productFit",
    "channelFit",
    "complianceVisibility",
    "reachability",
  ];
  for (const k of required) {
    if (!dimensions.some((d) => d.key === k)) {
      dimensions.push({
        key: k,
        score: 0,
        max: 2 as const,
        evidenceIds: [],
        rationale: "缺少结构化评分数据。",
      });
    }
  }
  dimensions.sort(
    (a, b) => required.indexOf(a.key) - required.indexOf(b.key),
  );

  const sigRaw = Array.isArray(raw.researchScoreSignals) ? raw.researchScoreSignals : [];
  const researchScoreSignals: ResearchScoreSignalV1[] = [];
  for (const row of sigRaw) {
    if (!isRecord(row)) continue;
    const type = String(row.type ?? "");
    if (!isSignalType(type)) continue;
    const evidenceIds = Array.isArray(row.evidenceIds)
      ? row.evidenceIds.filter((x): x is string => typeof x === "string" && validIds.has(x))
      : [];
    if (evidenceIds.length === 0) continue;
    const st = String(row.strength ?? "low");
    researchScoreSignals.push({
      type,
      label: String(row.label ?? type),
      strength: isStrength(st) ? st : "low",
      detail: String(row.detail ?? ""),
      evidenceIds: [...new Set(evidenceIds)],
    });
  }

  let launchIntent: LaunchIntentSignalV1 | undefined;
  const li = raw.launchIntent;
  if (isRecord(li)) {
    const evidenceIds = Array.isArray(li.evidenceIds)
      ? li.evidenceIds.filter((x): x is string => typeof x === "string" && validIds.has(x))
      : [];
    if (evidenceIds.length > 0) {
      const st = String(li.strength ?? "low");
      launchIntent = {
        strength: isStrength(st) ? st : "low",
        detail: String(li.detail ?? ""),
        evidenceIds: [...new Set(evidenceIds)],
      };
    }
  }

  let unknowns: ScoringUnknownV1[] | undefined;
  const unkRaw = raw.unknowns;
  if (Array.isArray(unkRaw)) {
    unknowns = unkRaw
      .map((row, i): ScoringUnknownV1 | null => {
        if (!isRecord(row)) return null;
        const scope = Array.isArray(row.scopeEvidenceIds)
          ? row.scopeEvidenceIds.filter(
              (x): x is string => typeof x === "string" && validIds.has(x),
            )
          : undefined;
        return {
          id: String(row.id ?? `u${i}`),
          topic: String(row.topic ?? ""),
          note: String(row.note ?? ""),
          scopeEvidenceIds: scope?.length ? [...new Set(scope)] : undefined,
        };
      })
      .filter((x): x is ScoringUnknownV1 => x !== null);
    if (unknowns.length === 0) unknowns = undefined;
  }

  const dimensionSum = dimensions.reduce((a, d) => a + d.score, 0);
  const model =
    raw.model === "rules+p2beta_v1" ? "rules+p2beta_v1" : "rules+p2alpha_v1";
  const debug = parseDebugBlock(raw.debug);

  return sanitizeScoringProfile(
    {
      version: 1,
      computedAt: typeof raw.computedAt === "string" ? raw.computedAt : new Date().toISOString(),
      model,
      dimensions,
      researchScoreSignals,
      unknowns,
      launchIntent,
      dimensionSum,
      totalFromDimensions: 0,
      debug,
    },
    validIds,
  );
}

export interface ParsedResearchBundle {
  /** 是否为 v1 结构化包 */
  isBundle: boolean;
  sources: ResearchSource[];
  report: ResearchReport | null;
  fieldSourceIds?: Partial<Record<keyof ResearchReport, string[]>>;
  generatedAt?: string;
  scoring?: ScoringProfileV1;
}

/**
 * 统一解析 DB 中的 researchReport Json。
 * - v1：取 report + sources + fieldSourceIds
 * - legacy：整对象即 report，sources 为空
 */
export function parseResearchBundle(json: unknown): ParsedResearchBundle {
  if (json == null) {
    return { isBundle: false, sources: [], report: null };
  }

  if (typeof json === "string") {
    try {
      return parseResearchBundle(JSON.parse(json));
    } catch {
      return { isBundle: false, sources: [], report: null };
    }
  }

  if (!isRecord(json)) {
    return { isBundle: false, sources: [], report: null };
  }

  if (json.v === 1 && isRecord(json.report)) {
    const report = coerceReport(json.report);
    const sourcesRaw = json.sources;
    const sources: ResearchSource[] = Array.isArray(sourcesRaw)
      ? sourcesRaw
          .map((row, i): ResearchSource | null => {
            if (!isRecord(row)) return null;
            const id = String(row.id ?? `s${i + 1}`);
            const url = String(row.url ?? "");
            if (!url) return null;
            const kind = row.kind === "homepage" ? "homepage" : "search";
            return {
              id,
              url,
              title: String(row.title ?? url),
              kind,
              snippet: row.snippet != null ? String(row.snippet) : undefined,
            };
          })
          .filter((x): x is ResearchSource => x !== null)
      : [];

    const valid = new Set(sources.map((s) => s.id));
    const rawField = json.fieldSourceIds;
    const fieldSourceIds =
      isRecord(rawField) && sources.length > 0
        ? sanitizeFieldSourceIds(rawField as Partial<Record<string, string[]>>, valid)
        : undefined;

    const scoringRaw = json.scoring;
    const scoring =
      scoringRaw !== undefined && sources.length > 0
        ? parseScoringProfile(scoringRaw, valid)
        : undefined;

    return {
      isBundle: true,
      sources,
      report,
      fieldSourceIds: fieldSourceIds ?? undefined,
      generatedAt: typeof json.generatedAt === "string" ? json.generatedAt : undefined,
      scoring: scoring ?? undefined,
    };
  }

  if (looksLikeLegacyReport(json)) {
    return {
      isBundle: false,
      sources: [],
      report: coerceReport(json),
    };
  }

  return { isBundle: false, sources: [], report: null };
}

/** 取用于评分/外联的纯 ResearchReport（bundle 或 legacy） */
export function getResearchReportForAgents(json: unknown): ResearchReport | null {
  return parseResearchBundle(json).report;
}
