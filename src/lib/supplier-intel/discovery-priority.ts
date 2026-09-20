/**
 * S4-B：找厂优先级（discovery-priority-v1）——**DISCOVERY PRIORITY ≠ SUPPLIER SCORE**。
 *
 * 回答的是「采购今天应该优先看 / 联系谁」，不回答「谁符合本 Tender」。
 * 纯 read-model：不写 SupplierCandidate 的任何评分列，不落库，无 schema。
 *
 * 铁律：
 *   - 只读线索**已有**字段（platform / title / description / rawText / accountName / contentUrl /
 *     rawMetadataJson 里的 sourceQuery）；缺失值绝不补猜（店龄 / 销量 / 成交量一律不推断）。
 *   - 相关性 = 与 Brief 词的**归一化精确 token / 短语重叠**；不用 LLM 产生数字，不做模糊幻觉。
 *   - 「厂家 / OEM」「出口 / 北美」只是 discovery signal，不是 verified capability，
 *     不能产生 CANADA_EXPORT VERIFIED，也不能让任何认证变 VERIFIED。
 *   - 来源可操作性（1688 高）说的是「联系 / 采购好不好操作」，**不是可靠性**。
 *
 * 纯模块：不 import 其它模块，无 IO / 无时钟 / 无随机。
 */

export const DISCOVERY_PRIORITY_V1 = {
  version: "discovery-priority-v1",
  max: { relevance: 50, factory: 20, export: 15, actionability: 10, completeness: 5 },
  buckets: { P1: 70, P2: 50 },
  /** 联系 / 采购可操作性（透明规则；不是可靠性） */
  actionability: {
    ONE688: 10,
    WEBSITE: 8,
    OPEN_WEB: 6,
    MANUAL: 6,
    DOUYIN: 4,
    XIAOHONGSHU: 4,
    WECHAT_CHANNELS: 4,
  } as Record<string, number>,
  factoryTerms: ["厂家", "工厂", "源头工厂", "生产厂家", "源头厂", "自产", "oem", "odm", "manufacturer", "factory", "custom manufacturer"],
  exportTerms: ["出口", "外贸", "北美", "加拿大", "美国", "export", "north america", "canada", "overseas", "exporter"],
} as const;

export const DISCOVERY_PRIORITY_DISCLAIMER = "找厂优先级只用于安排采购调研顺序，不代表供应商符合本 Tender。";

export type DiscoveryPriorityBucket = "P1" | "P2" | "P3";

export interface DiscoveryPriorityBriefInput {
  productKeywords?: string[] | null;
  productCategory?: string | null;
  commercialSearchTermsZh?: string[] | null;
  capabilitySearchTermsZh?: string[] | null;
  searchTermsEn?: string[] | null;
}

export interface DiscoveryPrioritySignalInput {
  platform: string;
  title?: string | null;
  description?: string | null;
  rawText?: string | null;
  accountName?: string | null;
  contentUrl?: string | null;
  rawMetadataJson?: unknown;
}

export interface DiscoveryPriorityResult {
  version: typeof DISCOVERY_PRIORITY_V1.version;
  total: number;
  bucket: DiscoveryPriorityBucket;
  components: { relevance: number; factory: number; export: number; actionability: number; completeness: number };
  /** 命中原因（可解释；全是文本命中，不是核验） */
  reasons: {
    productTermsMatched: string[];
    productTermsTotal: number;
    searchTermsMatched: string[];
    searchTermsTotal: number;
    factoryTermsMatched: string[];
    exportTermsMatched: string[];
    sourceQuery: string | null;
    completeness: { url: boolean; title: boolean; body: boolean; account: boolean };
  };
  disclaimer: typeof DISCOVERY_PRIORITY_DISCLAIMER;
}

const HAS_CJK = /[一-鿿]/;

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 归一化精确匹配：中文 = 子串；英文 = 词边界短语。不做模糊 / 相似度。 */
export function termMatches(term: string, haystack: string): boolean {
  const t = norm(term);
  if (!t) return false;
  if (HAS_CJK.test(t)) return haystack.includes(t);
  return new RegExp(`(^|[^a-z0-9])${escapeRe(t)}(?=$|[^a-z0-9])`).test(haystack);
}

function readSourceQuery(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  for (const k of ["sourceQuery", "query", "searchQuery"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function uniq(terms: Array<string | null | undefined>): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const t of terms) { const n = norm(t); if (n && !seen.has(n)) { seen.add(n); out.push(n); } }
  return out;
}

export function computeDiscoveryPriority(brief: DiscoveryPriorityBriefInput, signal: DiscoveryPrioritySignalInput): DiscoveryPriorityResult {
  const sourceQuery = readSourceQuery(signal.rawMetadataJson);
  const haystack = norm([signal.title, signal.description, signal.rawText, signal.accountName, sourceQuery].filter(Boolean).join(" \n "));
  const M = DISCOVERY_PRIORITY_V1.max;

  // 8.1 相关性 0–50：产品词（含类目）占 30，检索词占 20；某组为空则把权重让给另一组；两组都空 → 0
  const productTerms = uniq([...(brief.productKeywords ?? []), brief.productCategory ?? null]);
  const searchTerms = uniq([...(brief.commercialSearchTermsZh ?? []), ...(brief.capabilitySearchTermsZh ?? []), ...(brief.searchTermsEn ?? [])]);
  const productMatched = productTerms.filter((t) => termMatches(t, haystack));
  const searchMatched = searchTerms.filter((t) => termMatches(t, haystack));
  let relevance = 0;
  if (productTerms.length && searchTerms.length) relevance = 30 * (productMatched.length / productTerms.length) + 20 * (searchMatched.length / searchTerms.length);
  else if (productTerms.length) relevance = M.relevance * (productMatched.length / productTerms.length);
  else if (searchTerms.length) relevance = M.relevance * (searchMatched.length / searchTerms.length);

  // 8.2 / 8.3：只有文本明确出现才加；这是 discovery signal，不是 verified capability
  const factoryMatched = DISCOVERY_PRIORITY_V1.factoryTerms.filter((t) => termMatches(t, haystack));
  const exportMatched = DISCOVERY_PRIORITY_V1.exportTerms.filter((t) => termMatches(t, haystack));
  const factory = factoryMatched.length > 0 ? M.factory : 0;
  const exp = exportMatched.length > 0 ? M.export : 0;

  // 8.4 来源可操作性（不是可靠性）
  const actionability = DISCOVERY_PRIORITY_V1.actionability[signal.platform] ?? 0;

  // 8.5 完整度：只看已有字段，不推断
  const c = {
    url: Boolean(norm(signal.contentUrl)),
    title: Boolean(norm(signal.title)),
    body: Boolean(norm(signal.description) || norm(signal.rawText)),
    account: Boolean(norm(signal.accountName)),
  };
  const completeness = M.completeness * ([c.url, c.title, c.body, c.account].filter(Boolean).length / 4);

  const total = round2(relevance + factory + exp + actionability + completeness);
  const bucket: DiscoveryPriorityBucket = total >= DISCOVERY_PRIORITY_V1.buckets.P1 ? "P1" : total >= DISCOVERY_PRIORITY_V1.buckets.P2 ? "P2" : "P3";
  return {
    version: DISCOVERY_PRIORITY_V1.version,
    total,
    bucket,
    components: { relevance: round2(relevance), factory, export: exp, actionability, completeness: round2(completeness) },
    reasons: {
      productTermsMatched: productMatched, productTermsTotal: productTerms.length,
      searchTermsMatched: searchMatched, searchTermsTotal: searchTerms.length,
      factoryTermsMatched: factoryMatched, exportTermsMatched: exportMatched,
      sourceQuery,
      completeness: c,
    },
    disclaimer: DISCOVERY_PRIORITY_DISCLAIMER,
  };
}

export function discoveryBucketLabel(bucket: DiscoveryPriorityBucket): string {
  return bucket === "P1" ? "P1 — 优先查看" : bucket === "P2" ? "P2 — 可继续核实" : "P3 — 低优先级";
}
