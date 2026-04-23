/**
 * P2-beta：评分规则可调常量（非后台引擎）
 * 调整权重/阈值/词表时只改本文件。
 */

export const SCORE_DIMENSION_KEYS = [
  "productFit",
  "channelFit",
  "complianceVisibility",
  "reachability",
] as const;

export type ScoreDimKey = (typeof SCORE_DIMENSION_KEYS)[number];

/** 四维权重（不设新维度）；默认等权，与早期 (sum/8)*10 行为一致 */
export const SCORE_DIMENSION_WEIGHTS: Record<ScoreDimKey, number> = {
  productFit: 1,
  channelFit: 1,
  complianceVisibility: 1,
  reachability: 1,
};

/** 渠道：偏 B2B / 贸易（正分依据） */
export const CHANNEL_B2B_TERMS = [
  "wholesale",
  "b2b",
  "distributor",
  "distribution",
  "importer",
  "import",
  "oem",
  "odm",
  "moq",
  "bulk",
  "trade supplier",
  "fob",
  "exw",
  "factory direct",
  "manufacturer",
  "private label",
  "custom label",
];

/** 渠道：偏零售/平台（单独命中时不应等同强 B2B） */
export const CHANNEL_RETAIL_TERMS = [
  "amazon",
  "shopify",
  "retail",
  "b2c",
  "consumer",
  "add to cart",
  "buy now",
  "dropship",
  "ebay",
  "etsy",
];

/** 家纺/毯/睡衣等（productFit） */
export const VERTICAL_TERMS = [
  "blanket",
  "throw",
  "throws",
  "fleece",
  "sherpa",
  "flannel",
  "quilt",
  "duvet",
  "gsm",
  "sleepwear",
  "pajama",
  "pyjama",
  "pyjamas",
  "loungewear",
  "nightwear",
  "bedding",
  "bed linen",
  "home textile",
  "毯",
  "毛毯",
  "家纺",
  "睡衣",
  "盖毯",
  "珊瑚绒",
  "法兰绒",
  "夏尔巴",
  "microfiber",
  "velour",
  "robe",
  "bathrobe",
];

/** 合规通用 */
export const COMPLIANCE_CORE_TERMS = [
  "oeko-tex",
  "oekotex",
  "gots",
  "cpsia",
  "cpc",
  "flame retardant",
  "gpsr",
  "reach compliance",
  "ukca",
  "prop 65",
  "prop65",
  "certified organic",
  "organic cotton",
  "safety standard",
];

/** 更偏美国市场可见表述 */
export const COMPLIANCE_US_HINT_TERMS = ["cpsia", "cpc", "prop 65", "prop65", "cpsc", "fda"];

/** 更偏欧盟/英国可见表述 */
export const COMPLIANCE_EU_HINT_TERMS = ["gpsr", "ukca", "reach", "ce mark", "ce-marking", "eu"];

/** 尺码/标签/儿童睡衣可见度（弱，并入合规维度命中说明，不单开维） */
export const COMPLIANCE_SIZE_CHILD_TERMS = [
  "size chart",
  "尺码",
  "snug-fitting",
  "snug fitting",
  "tight-fitting",
  "children",
  "kids",
  "infant",
  "阻燃",
];

export const SOURCING_TERMS = [
  "moq",
  "oem",
  "odm",
  "fob",
  "exw",
  "private label",
  "custom label",
];

/** channelFit：至少这么多条不同来源命中 B2B 词才给满分档 */
export const CHANNEL_B2B_STRONG_MIN_SOURCES = 2;

/** 由加权维度分换算 0–10（一位小数） */
export function totalScoreWeighted(
  scoresByKey: Record<ScoreDimKey, number>,
  weights: Record<ScoreDimKey, number> = SCORE_DIMENSION_WEIGHTS,
): number {
  let weighted = 0;
  let maxW = 0;
  for (const k of SCORE_DIMENSION_KEYS) {
    const w = Math.max(0, weights[k] ?? 1);
    const s = Math.min(2, Math.max(0, scoresByKey[k] ?? 0));
    weighted += w * s;
    maxW += w * 2;
  }
  if (maxW <= 0) return 0;
  const raw = (weighted / maxW) * 10;
  return Math.round(raw * 10) / 10;
}

/** 从维度行列表算总分（sanitize / 展示用） */
export function totalScoreFromDimensionScores(
  rows: { key: string; score: number }[],
  weights: Record<ScoreDimKey, number> = SCORE_DIMENSION_WEIGHTS,
): number {
  const map = { productFit: 0, channelFit: 0, complianceVisibility: 0, reachability: 0 } as Record<
    ScoreDimKey,
    number
  >;
  for (const r of rows) {
    if (r.key in map) {
      map[r.key as ScoreDimKey] = r.score;
    }
  }
  return totalScoreWeighted(map, weights);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 构建不区分大小写的「整词或常见边界」匹配用正则 */
export function termsToRegex(terms: string[], wordBoundary = false): RegExp {
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  const body = sorted.map((t) => escapeRegex(t)).join("|");
  if (!body) return /$^/i;
  return wordBoundary
    ? new RegExp(`(?:^|[^a-z0-9])(${body})(?:$|[^a-z0-9])`, "i")
    : new RegExp(body, "i");
}

export function detectMarketRegionHint(text: string): "us" | "eu" | "none" {
  const t = text.toLowerCase();
  if (
    /\b(us|usa|united states|america|north america)\b/i.test(t) ||
    COMPLIANCE_US_HINT_TERMS.some((x) => t.includes(x.toLowerCase()))
  ) {
    return "us";
  }
  if (
    /\b(eu|europe|european|uk|united kingdom|germany|france|spain|italy)\b/i.test(t) ||
    COMPLIANCE_EU_HINT_TERMS.some((x) => t.includes(x.replace(/\s/g, "").toLowerCase()) || t.includes(x.toLowerCase()))
  ) {
    return "eu";
  }
  return "none";
}
