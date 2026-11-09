/**
 * PROC-1 采购监控配置（纯函数）：缺省词表（含法语同义词与采购分类）、校验、服务端上限、关键词匹配。
 * 词表可编辑；匹配只用于检索与排序辅助，不代表资格判断。
 */

import { z } from "zod";
import { foldText } from "./identity";
import { DEFAULT_SCHEDULE, DEFAULT_TIMEZONE, isValidTimeZone, type WeeklySchedule } from "./schedule";

export const SOURCE_KEYS = [
  "CANADABUYS_TENDER_NOTICES",
  "OPEN_CANADA_CONTRACTS",
  "OPEN_CANADA_ATI_SUMMARIES",
  "CANADABUYS_CONTRACT_HISTORY_PAGE",
] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export interface SourceCapability {
  key: SourceKey | "PROVINCIAL_MANUAL";
  label: string;
  /** AUTO_DISCOVERY = 可自动发现新候选；AUTO_REFRESH = 只刷新已知；MANUAL = 只支持人工链接导入 */
  mode: "AUTO_DISCOVERY" | "AUTO_REFRESH" | "AUTO_SEARCH" | "MANUAL";
  descriptionZh: string;
  officialUrl: string;
}

export const SOURCE_CAPABILITIES: SourceCapability[] = [
  {
    key: "CANADABUYS_TENDER_NOTICES",
    label: "CanadaBuys 招标公告（开放数据 CSV）",
    mode: "AUTO_DISCOVERY",
    descriptionZh: "按关键词 / 分类 / 机构 / 地区发现新招标；修订按同一参考号记入证据历史。",
    officialUrl: "https://canadabuys.canada.ca/en/tender-opportunities",
  },
  {
    key: "OPEN_CANADA_CONTRACTS",
    label: "Open Government 合同披露（CKAN）",
    mode: "AUTO_DISCOVERY",
    descriptionZh: "关键词发现历史合同；按合同 / SO 编号刷新已关注合同与其 call-up（公开合同值 ≠ 实际支出）。",
    officialUrl: "https://search.open.canada.ca/contracts/",
  },
  {
    key: "OPEN_CANADA_ATI_SUMMARIES",
    label: "Completed ATI 摘要（CKAN）",
    mode: "AUTO_SEARCH",
    descriptionZh: "按合同编号与关键词检索已完成的 ATI 申请摘要，判断能否索取既有披露副本；未配置资源 ID 时跳过并给出官方检索链接。",
    officialUrl: "https://search.open.canada.ca/ati/",
  },
  {
    key: "CANADABUYS_CONTRACT_HISTORY_PAGE",
    label: "CanadaBuys 合同历史公开页",
    mode: "AUTO_REFRESH",
    descriptionZh: "对已关注合同的公开页做内容哈希变更检测（不解析字段），变化时提示人工核对修订。",
    officialUrl: "https://canadabuys.canada.ca/en/tender-opportunities",
  },
  {
    key: "PROVINCIAL_MANUAL",
    label: "省市门户 / MERX / Bonfire / Ariba",
    mode: "MANUAL",
    descriptionZh: "仅支持人工链接导入与记录机关；未核实的省市规则不显示「已支持自动申请」。",
    officialUrl: "",
  },
];

export const DEFAULT_KEYWORDS = [
  // 纺织品
  "towel", "towels", "toweling", "towelling", "hand towel", "bath towel",
  "linen", "linens", "bed linen", "pillow", "pillows", "pillow form", "pillow forms",
  "blanket", "blankets", "fleece", "fabric", "fabrics", "textile", "textiles",
  // 窗饰
  "curtain", "curtains", "drapery", "draperies", "drapes", "blind", "blinds",
  "shade", "shades", "roller shade", "window covering", "window coverings", "window treatment",
  // 法语
  "serviette", "serviettes", "essuie-mains", "literie", "linge", "oreiller", "oreillers",
  "couverture", "couvertures", "molleton", "tissu", "tissus", "rideau", "rideaux",
  "draperie", "draperies", "store", "stores", "toile", "habillage de fenetre", "couvre-fenetre",
];

/** 服务类词：单独出现不算命中，但与产品词同时出现时加分（安装 / 维修 / 更换） */
export const DEFAULT_SERVICE_TERMS = [
  "installation", "install", "repair", "repairs", "replacement", "supply and install",
  "remplacement", "reparation", "pose",
];

export const DEFAULT_EXCLUDE_KEYWORDS = ["double-blind", "double blind", "blind spot", "lampshade", "sunshade sail"];

/** 采购分类前缀（GSIN / UNSPSC；可编辑） */
export const DEFAULT_CATEGORY_CODES = ["N7210", "N7230", "N8305", "52121500", "52121700", "52131500", "52131600", "52131700"];

export interface WatchFilters {
  keywords: string[];
  serviceTerms: string[];
  excludeKeywords: string[];
  categoryCodes: string[];
  /** 机构（任意文本，规范化后匹配；空 = 不限） */
  institutions: string[];
  /** 地区（文本匹配交付 / 机会地区；空 = 不限） */
  regions: string[];
  /** 招标公告回看天数 */
  lookbackDays: number;
  /** 合同披露回看年数 */
  contractLookbackYears: number;
}

export interface WatchLimits {
  maxNewCandidates: number;
  maxNewDraftCards: number;
  maxPagesPerSource: number;
  maxRowsPerPage: number;
  maxRuntimeMs: number;
}

export const LIMIT_CAPS: WatchLimits = {
  maxNewCandidates: 20,
  maxNewDraftCards: 10,
  maxPagesPerSource: 20,
  maxRowsPerPage: 500,
  maxRuntimeMs: 240_000,
};

export const DEFAULT_LIMITS: WatchLimits = {
  maxNewCandidates: 5,
  maxNewDraftCards: 3,
  maxPagesPerSource: 5,
  maxRowsPerPage: 100,
  maxRuntimeMs: 150_000,
};

export const DEFAULT_FILTERS: WatchFilters = {
  keywords: DEFAULT_KEYWORDS,
  serviceTerms: DEFAULT_SERVICE_TERMS,
  excludeKeywords: DEFAULT_EXCLUDE_KEYWORDS,
  categoryCodes: DEFAULT_CATEGORY_CODES,
  institutions: [],
  regions: [],
  lookbackDays: 120,
  contractLookbackYears: 6,
};

export type WatchSources = Record<SourceKey, boolean>;
export const DEFAULT_SOURCES: WatchSources = {
  CANADABUYS_TENDER_NOTICES: true,
  OPEN_CANADA_CONTRACTS: true,
  OPEN_CANADA_ATI_SUMMARIES: true,
  CANADABUYS_CONTRACT_HISTORY_PAGE: true,
};

export interface WatchConfig {
  name: string;
  timezone: string;
  schedule: WeeklySchedule;
  filters: WatchFilters;
  limits: WatchLimits;
  sources: WatchSources;
}

export const DEFAULT_WATCH_NAME = "Sunny 窗饰与纺织品";

export function defaultWatchConfig(): WatchConfig {
  return {
    name: DEFAULT_WATCH_NAME,
    timezone: DEFAULT_TIMEZONE,
    schedule: { ...DEFAULT_SCHEDULE, weekdays: [...DEFAULT_SCHEDULE.weekdays] },
    filters: structuredClone(DEFAULT_FILTERS),
    limits: { ...DEFAULT_LIMITS },
    sources: { ...DEFAULT_SOURCES },
  };
}

const termList = z.array(z.string().trim().min(1).max(80)).max(200);

export const watchConfigInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  schedule: z
    .object({
      weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
    })
    .optional(),
  filters: z
    .object({
      keywords: termList.min(1),
      serviceTerms: termList,
      excludeKeywords: termList,
      categoryCodes: z.array(z.string().trim().min(2).max(20)).max(50),
      institutions: termList,
      regions: termList,
      lookbackDays: z.number().int().min(1).max(730),
      contractLookbackYears: z.number().int().min(1).max(15),
    })
    .partial()
    .optional(),
  limits: z
    .object({
      maxNewCandidates: z.number().int().min(1),
      maxNewDraftCards: z.number().int().min(0),
      maxPagesPerSource: z.number().int().min(1),
      maxRowsPerPage: z.number().int().min(10),
      maxRuntimeMs: z.number().int().min(10_000),
    })
    .partial()
    .optional(),
  sources: z.record(z.string(), z.boolean()).optional(),
});

export type WatchConfigInput = z.infer<typeof watchConfigInputSchema>;

function clampLimits(l: WatchLimits): WatchLimits {
  return {
    maxNewCandidates: Math.min(l.maxNewCandidates, LIMIT_CAPS.maxNewCandidates),
    maxNewDraftCards: Math.min(l.maxNewDraftCards, LIMIT_CAPS.maxNewDraftCards),
    maxPagesPerSource: Math.min(l.maxPagesPerSource, LIMIT_CAPS.maxPagesPerSource),
    maxRowsPerPage: Math.min(l.maxRowsPerPage, LIMIT_CAPS.maxRowsPerPage),
    maxRuntimeMs: Math.min(l.maxRuntimeMs, LIMIT_CAPS.maxRuntimeMs),
  };
}

function dedupeTerms(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const k = t.trim();
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out;
}

/** 合并输入到既有配置（传了的覆盖、没传的保留），并夹紧服务端上限 */
export function mergeWatchConfig(
  base: WatchConfig,
  input: WatchConfigInput,
): { ok: true; config: WatchConfig } | { ok: false; code: "INVALID_TIMEZONE" | "INVALID_SOURCES"; message: string } {
  const timezone = input.timezone ?? base.timezone;
  if (!isValidTimeZone(timezone)) return { ok: false, code: "INVALID_TIMEZONE", message: `无效时区：${timezone}` };
  const sources: WatchSources = { ...base.sources };
  for (const [k, v] of Object.entries(input.sources ?? {})) {
    if (!(SOURCE_KEYS as readonly string[]).includes(k)) {
      return { ok: false, code: "INVALID_SOURCES", message: `未知来源：${k}` };
    }
    sources[k as SourceKey] = v;
  }
  const f = { ...base.filters, ...(input.filters ?? {}) } as WatchFilters;
  return {
    ok: true,
    config: {
      name: input.name ?? base.name,
      timezone,
      schedule: input.schedule
        ? { weekdays: [...new Set(input.schedule.weekdays)].sort(), hour: input.schedule.hour, minute: input.schedule.minute }
        : base.schedule,
      filters: {
        ...f,
        keywords: dedupeTerms(f.keywords),
        serviceTerms: dedupeTerms(f.serviceTerms),
        excludeKeywords: dedupeTerms(f.excludeKeywords),
        categoryCodes: dedupeTerms(f.categoryCodes.map((c) => c.toUpperCase())),
        institutions: dedupeTerms(f.institutions),
        regions: dedupeTerms(f.regions),
      },
      limits: clampLimits({ ...base.limits, ...(input.limits ?? {}) } as WatchLimits),
      sources,
    },
  };
}

/** 从 DB 行 JSON 读回（缺字段补缺省、夹紧上限；不信任存量 JSON） */
export function readWatchConfig(row: {
  name: string;
  timezone: string;
  scheduleJson: unknown;
  filtersJson: unknown;
  limitsJson: unknown;
  sourcesJson: unknown;
}): WatchConfig {
  const d = defaultWatchConfig();
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const sch = obj(row.scheduleJson);
  const weekdays = Array.isArray(sch.weekdays)
    ? (sch.weekdays as unknown[]).filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6)
    : d.schedule.weekdays;
  const num = (v: unknown, fb: number) => (typeof v === "number" && Number.isFinite(v) ? v : fb);
  const strs = (v: unknown, fb: string[]) =>
    Array.isArray(v) ? (v as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0) : fb;
  const fil = obj(row.filtersJson);
  const lim = obj(row.limitsJson);
  const src = obj(row.sourcesJson);
  return {
    name: row.name,
    timezone: isValidTimeZone(row.timezone) ? row.timezone : DEFAULT_TIMEZONE,
    schedule: {
      weekdays: weekdays.length ? weekdays : d.schedule.weekdays,
      hour: Math.min(23, Math.max(0, Math.trunc(num(sch.hour, d.schedule.hour)))),
      minute: Math.min(59, Math.max(0, Math.trunc(num(sch.minute, d.schedule.minute)))),
    },
    filters: {
      keywords: strs(fil.keywords, d.filters.keywords),
      serviceTerms: strs(fil.serviceTerms, d.filters.serviceTerms),
      excludeKeywords: strs(fil.excludeKeywords, d.filters.excludeKeywords),
      categoryCodes: strs(fil.categoryCodes, d.filters.categoryCodes),
      institutions: strs(fil.institutions, []),
      regions: strs(fil.regions, []),
      lookbackDays: num(fil.lookbackDays, d.filters.lookbackDays),
      contractLookbackYears: num(fil.contractLookbackYears, d.filters.contractLookbackYears),
    },
    limits: clampLimits({
      maxNewCandidates: num(lim.maxNewCandidates, d.limits.maxNewCandidates),
      maxNewDraftCards: num(lim.maxNewDraftCards, d.limits.maxNewDraftCards),
      maxPagesPerSource: num(lim.maxPagesPerSource, d.limits.maxPagesPerSource),
      maxRowsPerPage: num(lim.maxRowsPerPage, d.limits.maxRowsPerPage),
      maxRuntimeMs: num(lim.maxRuntimeMs, d.limits.maxRuntimeMs),
    }),
    sources: Object.fromEntries(
      SOURCE_KEYS.map((k) => [k, typeof src[k] === "boolean" ? (src[k] as boolean) : d.sources[k]]),
    ) as WatchSources,
  };
}

export interface KeywordMatch {
  matched: boolean;
  productHits: string[];
  serviceHits: string[];
  categoryHits: string[];
  excludedBy: string | null;
}

function containsTerm(haystack: string, term: string): boolean {
  const t = foldText(term);
  if (!t) return false;
  return (` ${haystack} `).includes(` ${t} `);
}

/**
 * 关键词匹配：排除词优先；产品词或分类码命中才算命中（服务词只加分）。
 * 文本先 foldText（去重音、标点改空格），短语按词边界匹配。
 */
export function matchKeywords(
  input: { texts: Array<string | null | undefined>; categoryCodes?: Array<string | null | undefined> },
  filters: Pick<WatchFilters, "keywords" | "serviceTerms" | "excludeKeywords" | "categoryCodes">,
): KeywordMatch {
  const hay = foldText(input.texts.filter(Boolean).join(" \n "));
  for (const ex of filters.excludeKeywords) {
    if (containsTerm(hay, ex)) {
      return { matched: false, productHits: [], serviceHits: [], categoryHits: [], excludedBy: ex };
    }
  }
  const productHits = filters.keywords.filter((k) => containsTerm(hay, k));
  const serviceHits = filters.serviceTerms.filter((k) => containsTerm(hay, k));
  const codes = (input.categoryCodes ?? []).filter((c): c is string => Boolean(c)).map((c) => c.toUpperCase());
  const categoryHits = filters.categoryCodes.filter((pref) => codes.some((c) => c.replace(/\s+/g, "").startsWith(pref.toUpperCase())));
  return {
    matched: productHits.length > 0 || categoryHits.length > 0,
    productHits,
    serviceHits,
    categoryHits,
    excludedBy: null,
  };
}

/** 机构 / 地区过滤（空列表 = 不限；任一命中即通过） */
export function passesListFilter(values: Array<string | null | undefined>, wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  const hay = foldText(values.filter(Boolean).join(" | "));
  return wanted.some((w) => containsTerm(hay, w));
}
