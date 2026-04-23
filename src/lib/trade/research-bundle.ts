/**
 * Trade 研究报告 — sources 一等公民 + 与 DB Json 兼容解析
 *
 * 存于 TradeProspect.researchReport：
 * - v1 bundle：{ v, generatedAt, sources, report, fieldSourceIds? }
 * - legacy：平铺 ResearchReport 七字段（无 v、无 sources）
 */

import type { SearchResult } from "./tools";
import type { PageContent } from "./tools";

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

export interface ResearchBundleV1 {
  v: 1;
  generatedAt: string;
  sources: ResearchSource[];
  report: ResearchReport;
  fieldSourceIds?: Partial<Record<keyof ResearchReport, string[]>>;
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
  return bundle;
}

export interface ParsedResearchBundle {
  /** 是否为 v1 结构化包 */
  isBundle: boolean;
  sources: ResearchSource[];
  report: ResearchReport | null;
  fieldSourceIds?: Partial<Record<keyof ResearchReport, string[]>>;
  generatedAt?: string;
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

    return {
      isBundle: true,
      sources,
      report,
      fieldSourceIds: fieldSourceIds ?? undefined,
      generatedAt: typeof json.generatedAt === "string" ? json.generatedAt : undefined,
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
