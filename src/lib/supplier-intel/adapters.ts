/**
 * SupplierDiscoveryAdapter（M1-S2，任务书 §11/§16/§20/§23/§24/§39/§44）
 *
 * Adapter 只做平台语义：brief → 查询计划（对象化，可审计回放）→ provider 结果归一成
 * 信号草稿。不解读内容、不抓平台页面——获取手段全部在 Provider 层。
 *
 * 每源状态显式分级（禁静默）：SUCCESS / EMPTY / FAILED / DISABLED；
 * provider 单次调用状态（TIMEOUT/AUTH_ERROR/RATE_LIMITED/PROVIDER_ERROR/…）逐条留档。
 * OPEN_WEB 结果过确定性噪音过滤（新闻/社交聚合/零售站不当 supplier）。
 *
 * 平台边界（v1 冻结）：DOUYIN 层 B=site: 查询走搜索引擎既有索引；XIAOHONGSHU robots
 * 全站默认禁抓→仅消费既有索引、覆盖率如实呈现；WECHAT_CHANNELS 无层 B（DISABLED +
 * USER_ASSISTED 说明）；1688 专用 Adapter = DEFERRED（无合法稳定数据通道前不实现，
 * 搜索引擎命中 1688 页面时按 host 归 ONE688 信号）。
 */

import { type SignalPlatform } from "./constants";
import {
  assertProviderEnabled,
  type DiscoveryProvider,
  type DiscoveryProviderResult,
  type ProviderCallStatus,
} from "./providers";
import type { SupplierSearchBrief } from "./search-brief";
import { classifyPublicUrlPlatform, validatePublicHttpUrl } from "./submission-parser";

/** §11 查询快照条目：历史 Run 必须能回答「当时到底搜了哪些词」 */
export interface PlannedQuery {
  source: string;
  query: string;
  language: "zh" | "en";
  queryType: "COMMERCIAL" | "CAPABILITY" | "SOCIAL" | "EN";
  priority: number;
  /** 粗粒度溯源（brief 分组）；逐词到 requirement code 的细溯源属后续增强 */
  generatedFrom: string[];
}

export interface DiscoveredSignalDraft {
  platform: SignalPlatform;
  contentUrl: string;
  title: string | null;
  description: string | null;
  sourceQuery: string;
}

export type AdapterSourceStatus = "SUCCESS" | "EMPTY" | "FAILED" | "DISABLED";

export type AdapterDiscoverResult =
  | {
      ok: true;
      sourceStatus: AdapterSourceStatus;
      plan: PlannedQuery[];
      drafts: DiscoveredSignalDraft[];
      noiseFiltered: number;
      providerStatuses: ProviderCallStatus[];
      failureReason: string | null;
      note: string | null;
    }
  | { ok: false; code: string; message: string };

export interface SupplierDiscoveryAdapter {
  readonly platform: SignalPlatform | "OPEN_WEB";
  buildQueryPlan(brief: SupplierSearchBrief): PlannedQuery[];
  discover(brief: SupplierSearchBrief, provider: DiscoveryProvider): Promise<AdapterDiscoverResult>;
}

/** §23 确定性噪音边界：这些 host 的搜索命中不当作 supplier 线索 */
const OPEN_WEB_NOISE_HOST_SUBSTRINGS = [
  "pinterest.",
  "youtube.",
  "facebook.",
  "instagram.",
  "reddit.",
  "wikipedia.",
  "amazon.",
  "ebay.",
  "walmart.",
  "twitter.",
  "tiktok.",
  "linkedin.",
  "quora.",
  "medium.",
] as const;

function isNoiseHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return OPEN_WEB_NOISE_HOST_SUBSTRINGS.some((s) => h === s.slice(0, -1) || h.includes(s));
}

function uniqTerms(terms: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const k = t.trim();
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
    if (out.length >= cap) break;
  }
  return out;
}

function toDrafts(
  results: DiscoveryProviderResult[],
  keepPlatforms: SignalPlatform[] | null,
  filterNoise: boolean,
): { drafts: DiscoveredSignalDraft[]; noiseFiltered: number } {
  const drafts: DiscoveredSignalDraft[] = [];
  const seenUrls = new Set<string>();
  let noiseFiltered = 0;
  for (const r of results) {
    let url: URL;
    try {
      url = validatePublicHttpUrl(r.url);
    } catch {
      continue; // 非法 URL 静默丢弃（不是 supplier 线索）
    }
    if (filterNoise && isNoiseHost(url.hostname)) {
      noiseFiltered += 1;
      continue;
    }
    const platform = classifyPublicUrlPlatform(url);
    if (keepPlatforms && !keepPlatforms.includes(platform)) continue;
    const canonical = url.toString();
    if (seenUrls.has(canonical)) continue;
    seenUrls.add(canonical);
    drafts.push({
      platform,
      contentUrl: canonical,
      title: r.title?.trim() ? r.title.trim().slice(0, 160) : null,
      description: r.snippet?.trim() ? r.snippet.trim().slice(0, 500) : null,
      sourceQuery: r.sourceQuery,
    });
  }
  return { drafts, noiseFiltered };
}

/** provider 调用状态聚合 → 源级状态（§44 确定性策略） */
function aggregateSourceStatus(statuses: ProviderCallStatus[]): {
  sourceStatus: AdapterSourceStatus;
  failureReason: string | null;
} {
  if (statuses.length === 0) return { sourceStatus: "EMPTY", failureReason: null };
  const failures = statuses.filter(
    (s) => s === "TIMEOUT" || s === "AUTH_ERROR" || s === "RATE_LIMITED" || s === "PROVIDER_ERROR",
  );
  const hasSuccess = statuses.includes("SUCCESS");
  if (hasSuccess) return { sourceStatus: "SUCCESS", failureReason: null };
  if (failures.length === statuses.length) {
    return { sourceStatus: "FAILED", failureReason: failures[0] };
  }
  if (failures.length > 0) {
    // 无 SUCCESS 但混有 EMPTY：按 FAILED 报告首个失败原因（不掩盖 provider 问题）
    return { sourceStatus: "FAILED", failureReason: failures[0] };
  }
  return { sourceStatus: "EMPTY", failureReason: null };
}

async function runPlan(
  provider: DiscoveryProvider,
  plan: PlannedQuery[],
): Promise<{ results: DiscoveryProviderResult[]; statuses: ProviderCallStatus[] }> {
  assertProviderEnabled(provider);
  const outcomes = await Promise.all(plan.map((p) => provider.search(p.query)));
  return {
    results: outcomes.flatMap((o) => o.results),
    statuses: outcomes.map((o) => o.status),
  };
}

function makeDiscover(
  platform: SignalPlatform | "OPEN_WEB",
  keepPlatforms: SignalPlatform[] | null,
  filterNoise: boolean,
  note: string | null,
): SupplierDiscoveryAdapter["discover"] {
  return async function discover(this: SupplierDiscoveryAdapter, brief, provider) {
    const plan = this.buildQueryPlan(brief);
    if (plan.length === 0) {
      return {
        ok: true,
        sourceStatus: "EMPTY",
        plan: [],
        drafts: [],
        noiseFiltered: 0,
        providerStatuses: [],
        failureReason: null,
        note: note ?? "brief 无可用检索词",
      };
    }
    const { results, statuses } = await runPlan(provider, plan);
    const { drafts, noiseFiltered } = toDrafts(results, keepPlatforms, filterNoise);
    const agg = aggregateSourceStatus(statuses);
    return {
      ok: true,
      sourceStatus: agg.sourceStatus === "SUCCESS" && drafts.length === 0 ? "EMPTY" : agg.sourceStatus,
      plan,
      drafts,
      noiseFiltered,
      providerStatuses: statuses,
      failureReason: agg.failureReason,
      note,
    };
  };
}

export const douyinSupplierDiscoveryAdapter: SupplierDiscoveryAdapter = {
  platform: "DOUYIN",
  buildQueryPlan(brief) {
    const social = uniqTerms(brief.socialSearchTermsZh, 2).map((t, i): PlannedQuery => ({
      source: "DOUYIN",
      query: `site:douyin.com ${t}`,
      language: "zh",
      queryType: "SOCIAL",
      priority: i + 1,
      generatedFrom: ["brief:socialSearchTermsZh"],
    }));
    const capability = uniqTerms(brief.capabilitySearchTermsZh, 2).map((t, i): PlannedQuery => ({
      source: "DOUYIN",
      query: `site:douyin.com ${t}`,
      language: "zh",
      queryType: "CAPABILITY",
      priority: social.length + i + 1,
      generatedFrom: ["brief:capabilitySearchTermsZh"],
    }));
    return [...social, ...capability].slice(0, 4);
  },
  discover: makeDiscover("DOUYIN", ["DOUYIN"], false, null),
};

export const xiaohongshuSupplierDiscoveryAdapter: SupplierDiscoveryAdapter = {
  platform: "XIAOHONGSHU",
  buildQueryPlan(brief) {
    return uniqTerms([...brief.socialSearchTermsZh, ...brief.commercialSearchTermsZh], 2).map(
      (t, i): PlannedQuery => ({
        source: "XIAOHONGSHU",
        query: `site:xiaohongshu.com ${t}`,
        language: "zh",
        queryType: "SOCIAL",
        priority: i + 1,
        generatedFrom: ["brief:socialSearchTermsZh", "brief:commercialSearchTermsZh"],
      }),
    );
  },
  discover: makeDiscover(
    "XIAOHONGSHU",
    ["XIAOHONGSHU"],
    false,
    "小红书 robots 全站默认禁抓：仅消费搜索引擎既有合法索引，覆盖率有限（主力=用户提交）",
  ),
};

export const wechatChannelsDiscoveryAdapter: SupplierDiscoveryAdapter = {
  platform: "WECHAT_CHANNELS",
  buildQueryPlan() {
    return [];
  },
  async discover() {
    return {
      ok: true,
      sourceStatus: "DISABLED",
      plan: [],
      drafts: [],
      noiseFiltered: 0,
      providerStatuses: [],
      failureReason: null,
      note: "视频号无公开可编程发现面（封闭生态）：USER_ASSISTED_DISCOVERY 是唯一路径，不作为 M1 依赖；socialSearchTermsZh 可供人工在微信内检索",
    };
  },
};

export const openWebSupplierAdapter: SupplierDiscoveryAdapter = {
  platform: "OPEN_WEB",
  buildQueryPlan(brief) {
    const zh = uniqTerms(brief.commercialSearchTermsZh, 3).map((t, i): PlannedQuery => ({
      source: "OPEN_WEB",
      query: t,
      language: "zh",
      queryType: "COMMERCIAL",
      priority: i + 1,
      generatedFrom: ["brief:commercialSearchTermsZh"],
    }));
    const en = uniqTerms(brief.searchTermsEn, 2).map((t, i): PlannedQuery => ({
      source: "OPEN_WEB",
      query: t,
      language: "en",
      queryType: "EN",
      priority: zh.length + i + 1,
      generatedFrom: ["brief:searchTermsEn"],
    }));
    return [...zh, ...en].slice(0, 5);
  },
  // 不过滤平台（1688/官网命中按 host 自然归类），但过噪音 host（§23）
  discover: makeDiscover("OPEN_WEB", null, true, null),
};

export const DEFAULT_DISCOVERY_ADAPTERS: SupplierDiscoveryAdapter[] = [
  douyinSupplierDiscoveryAdapter,
  xiaohongshuSupplierDiscoveryAdapter,
  wechatChannelsDiscoveryAdapter,
  openWebSupplierAdapter,
];

/** 1688 专用 Adapter：DEFERRED（任务书 §41——无合法/稳定/已审核数据通道前不落实现，不伪造结果） */
export const SUPPLIER_1688_ADAPTER_STATUS = "DEFERRED" as const;
