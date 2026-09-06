/**
 * Revenue Spine — 确定性 RFQ 抽取（无 LLM 也能跑；每个字段带来源片段与置信度）
 *
 * 设计：
 * - 只从源文本抽取，evidenceText 永远是源文本的子串（±上下文）
 * - 置信度反映匹配强度（带单位的数量 > 裸数字；类目词表命中 > 泛词）
 * - 不推断未出现的信息（缺失交给 missing-info 引擎）
 */

import { detectLanguage } from "../normalize";
import {
  CERTIFICATION_KEYWORDS,
  COLOR_KEYWORDS,
  CUSTOMIZATION_KEYWORDS,
  INCOTERMS,
  MATERIAL_KEYWORDS,
  PACKAGING_KEYWORDS,
  SAMPLE_KEYWORDS,
  APPLICATION_RULES,
  detectBuyerType,
  detectCountries,
} from "../lexicon";
import { emptyRfqFields, type RfqEvidence, type RfqExtraction, type RfqField, type RfqFields } from "./types";

const CONTEXT = 40;

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - CONTEXT);
  const end = Math.min(text.length, index + length + CONTEXT);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findKeyword(lower: string, keywords: string[]): { kw: string; index: number } | null {
  let best: { kw: string; index: number } | null = null;
  for (const kw of keywords) {
    const isAscii = /^[\x00-\x7f]+$/.test(kw);
    const re = new RegExp(isAscii ? `(?<![a-z])${escapeRe(kw.toLowerCase())}(?![a-z])` : escapeRe(kw.toLowerCase()));
    const m = re.exec(lower);
    if (m && (best === null || kw.length > best.kw.length)) best = { kw, index: m.index };
  }
  return best;
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,，\s]/g, "").toLowerCase();
  const kMatch = /^(\d+(?:\.\d+)?)k$/.exec(cleaned);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const wan = /^(\d+(?:\.\d+)?)万$/.exec(cleaned);
  if (wan) return Math.round(parseFloat(wan[1]) * 10000);
  const qian = /^(\d+(?:\.\d+)?)千$/.exec(cleaned);
  if (qian) return Math.round(parseFloat(qian[1]) * 1000);
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const UNIT_WORDS =
  "pcs|pieces|piece|pc|units|unit|sets|set|pairs|pair|dozen|cartons|ctns|ctn|rolls|meters|metres|m|yards|kg|件|条|套|个|张|打|箱|双|块|卷|米|码";
const QTY_RE = new RegExp(
  `(\\d{1,3}(?:[,，]\\d{3})+|\\d+(?:\\.\\d+)?\\s*(?:k|万|千)?|\\d+)\\s*(${UNIT_WORDS})?(?![\\d%])`,
  "gi",
);

const SIZE_RE =
  /(\d+(?:\.\d+)?)\s*(?:cm|mm|inch|inches|in|"|m|ft)?\s*[x×X*]\s*(\d+(?:\.\d+)?)\s*(cm|mm|inch|inches|in|"|m|ft)?(?:\s*[x×X*]\s*(\d+(?:\.\d+)?)\s*(cm|mm|inch|inches|in|"|m|ft)?)?/;
const SIZE_LABEL_RE = /\b(s\s*[-–~到]\s*x{0,3}l|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|one size|queen|king|twin|full|double|single|super king|california king)\b(?:\s*(?:size|sizes|尺码|码))?/i;
const GSM_RE = /(\d{2,4})\s*(?:gsm|g\/m2|g\/m²|克)/i;
const COMPOSITION_RE = /(\d{1,3}\s*%\s*[a-z一-鿿]+(?:\s*(?:\/|,|and|\+|、)\s*\d{1,3}\s*%\s*[a-z一-鿿]+)*)/i;
const PRICE_RE =
  /(?:(usd|cad|eur|gbp|aud|rmb|cny|us\$|ca\$|\$|€|£|¥|美元|加元|欧元|人民币)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(usd|cad|eur|gbp|aud|rmb|cny|美元|加元|欧元|元))(?:\s*(?:\/|per|each|每)\s*(?:pc|pcs|piece|unit|set|件|个|套))?/i;
const PRICE_CONTEXT_RE = /(target price|target|budget|price point|around|max|maximum|不超过|预算|目标价|单价)/i;
const DATE_ISO_RE = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/;
const DATE_TEXT_RE =
  /\b(?:by|before|until|deliver(?:y|ed)?\s+(?:by|before|in)|需要在|要求)?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i;
const DATE_MONTH_ONLY_RE = /\b(?:by|before|until|in)\s+(?:end of\s+|mid[- ]|early\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s*(20\d{2}))?/i;
const RELATIVE_RE = /(?:within|in|deliver(?:y)? in|需要在|交期)\s*(\d{1,3})\s*(days?|weeks?|months?|天|周|个月)/i;
const CN_DATE_RE = /(20\d{2})年(\d{1,2})月(?:(\d{1,2})日)?/;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

function monthIndex(word: string): number | null {
  const key = word.toLowerCase().slice(0, 4) === "sept" ? "sep" : word.toLowerCase().slice(0, 3);
  return key in MONTHS ? MONTHS[key] : null;
}

export interface HeuristicOptions {
  /** 小写关键词 → 产品类目 */
  productKeywords: Record<string, string>;
  now?: Date;
}

export function extractRfqHeuristic(text: string, opts: HeuristicOptions): RfqExtraction {
  const source = (text ?? "").replace(/\r/g, "");
  const lower = source.toLowerCase();
  const fields: RfqFields = emptyRfqFields();
  const evidence: RfqEvidence[] = [];
  const notes: string[] = [];
  const now = opts.now ?? new Date();
  const language = detectLanguage(source);

  const add = (field: RfqField, value: unknown, confidence: number, index: number, length: number) => {
    const str =
      value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
    evidence.push({ field, value: str, confidence, evidenceText: snippet(source, index, length), extractedBy: "heuristic" });
  };

  // ── 产品 ──
  const productKw = findKeyword(lower, Object.keys(opts.productKeywords));
  if (productKw) {
    const category = opts.productKeywords[productKw.kw] ?? opts.productKeywords[productKw.kw.toLowerCase()] ?? null;
    fields.productName = source.substr(productKw.index, productKw.kw.length);
    fields.productCategory = category;
    add("productName", fields.productName, 0.9, productKw.index, productKw.kw.length);
    if (category) add("productCategory", category, 0.85, productKw.index, productKw.kw.length);
  }

  // ── 数量（优先紧邻产品词或带单位者） ──
  const qtyCandidates: Array<{ value: number; index: number; length: number; score: number }> = [];
  let m: RegExpExecArray | null;
  QTY_RE.lastIndex = 0;
  while ((m = QTY_RE.exec(source))) {
    const raw = m[1];
    const unit = m[2];
    const value = parseNumber(raw);
    if (value === null || value <= 0) continue;
    // 跳过尺寸/克重/价格/年份上下文
    const after = source.slice(m.index + m[0].length, m.index + m[0].length + 6).toLowerCase();
    const before = source.slice(Math.max(0, m.index - 6), m.index).toLowerCase();
    if (/^\s*(gsm|cm|mm|inch|in\b|"|x|×|\*|%|usd|cad|eur|\$|元|美元|加元)/.test(after)) continue;
    if (/(x|×|\*|\$|€|£|¥|usd|cad|eur)\s*$/.test(before)) continue;
    if (/^(19|20)\d{2}$/.test(raw.replace(/[,，]/g, "")) && !unit) continue;
    let score = unit ? 3 : 0;
    if (/[,，]\d{3}/.test(raw) || /k|万|千/i.test(raw)) score += 2;
    if (productKw && Math.abs(productKw.index - (m.index + m[0].length)) <= 3) score += 3;
    if (value >= 50) score += 1;
    if (!unit && value < 10) continue;
    qtyCandidates.push({ value, index: m.index, length: m[0].length, score });
  }
  qtyCandidates.sort((a, b) => b.score - a.score || a.index - b.index);
  if (qtyCandidates.length) {
    const best = qtyCandidates[0];
    fields.quantity = best.value;
    const unitMatch = source.slice(best.index, best.index + best.length).match(new RegExp(`(${UNIT_WORDS})$`, "i"));
    fields.unit = unitMatch ? unitMatch[1].toLowerCase() : fields.productName ? "pcs" : null;
    add("quantity", best.value, best.score >= 5 ? 0.95 : best.score >= 3 ? 0.85 : 0.6, best.index, best.length);
    if (unitMatch) add("unit", fields.unit, 0.9, best.index, best.length);
  }

  // ── 材质 / 成分 ──
  const material = findKeyword(lower, MATERIAL_KEYWORDS);
  if (material) {
    fields.material = source.substr(material.index, material.kw.length);
    add("material", fields.material, 0.85, material.index, material.kw.length);
  }
  const comp = COMPOSITION_RE.exec(source);
  const gsm = GSM_RE.exec(source);
  if (comp || gsm) {
    const parts = [comp?.[1], gsm?.[0]].filter(Boolean) as string[];
    fields.composition = parts.join(", ");
    const idx = comp?.index ?? gsm!.index;
    add("composition", fields.composition, 0.85, idx, (comp?.[0] ?? gsm?.[0] ?? "").length);
  }

  // ── 尺寸 ──
  const size = SIZE_RE.exec(source);
  if (size) {
    fields.size = size[0].replace(/\s+/g, " ").trim();
    add("size", fields.size, 0.9, size.index, size[0].length);
  } else {
    const sl = SIZE_LABEL_RE.exec(source);
    if (sl && /size|尺码|码|s\s*[-–~]/i.test(sl[0]) ) {
      fields.size = sl[0].trim();
      add("size", fields.size, 0.7, sl.index, sl[0].length);
    }
  }

  // ── 颜色 ──
  const color = findKeyword(lower, COLOR_KEYWORDS);
  if (color) {
    fields.color = source.substr(color.index, color.kw.length);
    add("color", fields.color, 0.75, color.index, color.kw.length);
  }

  // ── 定制 / Logo ──
  const custom = findKeyword(lower, CUSTOMIZATION_KEYWORDS);
  if (custom) {
    fields.customization = snippet(source, custom.index, custom.kw.length);
    fields.customLogo = /logo|embroider|印|绣|brand|label/i.test(custom.kw) ? true : null;
    add("customization", fields.customization, 0.7, custom.index, custom.kw.length);
    if (fields.customLogo) add("customLogo", true, 0.75, custom.index, custom.kw.length);
  }

  // ── 包装 / 认证 / 样品 ──
  const pack = findKeyword(lower, PACKAGING_KEYWORDS);
  if (pack) {
    fields.packaging = snippet(source, pack.index, pack.kw.length);
    add("packaging", fields.packaging, 0.65, pack.index, pack.kw.length);
  }
  const cert = findKeyword(lower, CERTIFICATION_KEYWORDS);
  if (cert) {
    fields.certification = source.substr(cert.index, cert.kw.length);
    add("certification", fields.certification, 0.8, cert.index, cert.kw.length);
  }
  const sample = findKeyword(lower, SAMPLE_KEYWORDS);
  if (sample) {
    fields.sampleRequired = true;
    add("sampleRequired", true, 0.8, sample.index, sample.kw.length);
  }

  // ── 目标价 ──
  const price = PRICE_RE.exec(source);
  if (price) {
    const ctx = source.slice(Math.max(0, price.index - 40), price.index + price[0].length + 10);
    const amount = parseFloat((price[2] ?? price[3] ?? "").replace(",", "."));
    const curRaw = (price[1] ?? price[4] ?? "").toLowerCase();
    const currency =
      curRaw.includes("cad") || curRaw.includes("ca$") || curRaw.includes("加元") ? "CAD"
      : curRaw.includes("eur") || curRaw === "€" || curRaw.includes("欧元") ? "EUR"
      : curRaw.includes("gbp") || curRaw === "£" ? "GBP"
      : curRaw.includes("aud") ? "AUD"
      : curRaw.includes("rmb") || curRaw.includes("cny") || curRaw === "¥" || curRaw.includes("人民币") || curRaw === "元" ? "CNY"
      : "USD";
    if (Number.isFinite(amount) && amount > 0 && PRICE_CONTEXT_RE.test(ctx)) {
      fields.targetPrice = amount;
      fields.currency = currency;
      add("targetPrice", amount, 0.75, price.index, price[0].length);
      add("currency", currency, 0.7, price.index, price[0].length);
    }
  }

  // ── 目的国 / 城市 ──
  const countries = detectCountries(source);
  if (countries.length) {
    // 优先 "to/in/ship to <country>" 语境，否则首个提及
    const preferred =
      countries.find((c) => /(?:to|in|ship to|deliver(?:y)? to|destination|located in|based in|from)\s*$/i.test(source.slice(Math.max(0, c.index - 16), c.index))) ??
      countries[0];
    fields.destinationCountry = preferred.country;
    add("destinationCountry", preferred.country, preferred.city ? 0.7 : 0.85, preferred.index, preferred.matched.length);
    const cityHit = countries.find((c) => c.city);
    if (cityHit?.city) {
      fields.destinationCity = source.substr(cityHit.index, cityHit.matched.length);
      add("destinationCity", fields.destinationCity, 0.8, cityHit.index, cityHit.matched.length);
    }
  }

  // ── 贸易术语 ──
  const inco = new RegExp(`\\b(${INCOTERMS.join("|")})\\b`, "i").exec(source);
  if (inco) {
    fields.incoterm = inco[1].toUpperCase();
    add("incoterm", fields.incoterm, 0.9, inco.index, inco[0].length);
  }

  // ── 要求交期 ──
  const iso = DATE_ISO_RE.exec(source);
  const cn = CN_DATE_RE.exec(source);
  const textDate = DATE_TEXT_RE.exec(source);
  const monthOnly = DATE_MONTH_ONLY_RE.exec(source);
  const rel = RELATIVE_RE.exec(source);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    fields.requiredDeliveryDate = d;
    add("requiredDeliveryDate", d, 0.9, iso.index, iso[0].length);
  } else if (cn) {
    const d = new Date(Date.UTC(Number(cn[1]), Number(cn[2]) - 1, cn[3] ? Number(cn[3]) : 1));
    fields.requiredDeliveryDate = d;
    add("requiredDeliveryDate", d, cn[3] ? 0.9 : 0.7, cn.index, cn[0].length);
  } else if (textDate && monthIndex(textDate[1]) !== null) {
    const mi = monthIndex(textDate[1])!;
    const year = textDate[3] ? Number(textDate[3]) : now.getUTCFullYear() + (mi < now.getUTCMonth() ? 1 : 0);
    const d = new Date(Date.UTC(year, mi, Number(textDate[2])));
    fields.requiredDeliveryDate = d;
    add("requiredDeliveryDate", d, textDate[3] ? 0.85 : 0.7, textDate.index, textDate[0].length);
  } else if (monthOnly && monthIndex(monthOnly[1]) !== null) {
    const mi = monthIndex(monthOnly[1])!;
    const year = monthOnly[2] ? Number(monthOnly[2]) : now.getUTCFullYear() + (mi < now.getUTCMonth() ? 1 : 0);
    const d = new Date(Date.UTC(year, mi + 1, 0)); // 月末
    fields.requiredDeliveryDate = d;
    add("requiredDeliveryDate", d, 0.6, monthOnly.index, monthOnly[0].length);
  } else if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const days = /week|周/.test(unit) ? n * 7 : /month|个月/.test(unit) ? n * 30 : n;
    const d = new Date(now.getTime() + days * 86_400_000);
    fields.requiredDeliveryDate = d;
    add("requiredDeliveryDate", d, 0.6, rel.index, rel[0].length);
    notes.push(`requiredDeliveryDate 由相对交期「${rel[0].trim()}」按今日推算`);
  }

  // ── 买家类型 / 用途 ──
  const buyer = detectBuyerType(source);
  if (buyer.type !== "unknown" && buyer.matched) {
    fields.buyerType = buyer.type;
    add("buyerType", buyer.type, buyer.confidence, lower.indexOf(buyer.matched), buyer.matched.length);
  }
  for (const rule of APPLICATION_RULES) {
    const hit = findKeyword(lower, rule.keywords);
    if (hit) {
      fields.application = rule.key;
      add("application", rule.key, 0.7, hit.index, hit.kw.length);
      break;
    }
  }

  return { fields, evidence, language, method: "heuristic", notes };
}
