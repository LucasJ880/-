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

/** 句末：换行、中文句读、分号；英文 . ! ? 只在其后是空白或结尾时算（8.5、14.3 不断句） */
function isBoundary(text: string, i: number): boolean {
  const c = text[i];
  if (c === "\n" || c === ";" || /[。；！？]/.test(c)) return true;
  return /[.!?]/.test(c) && (i + 1 >= text.length || /\s/.test(text[i + 1]));
}

/** 字段值去掉句首的「Packaging: 」这类标签（证据片段保留原句） */
function stripLabel(clause: string): string {
  return clause.replace(/^[A-Za-z][A-Za-z ()/]{0,30}:\s*/, "") || clause;
}

/** 证据片段：关键词前后各 CONTEXT 字符，但不越过所在句子（结构化正文里相邻字段不混进来） */
function snippet(text: string, index: number, length: number): string {
  let start = Math.max(0, index - CONTEXT);
  let end = Math.min(text.length, index + length + CONTEXT);
  for (let i = index - 1; i >= start; i--) {
    if (isBoundary(text, i)) {
      start = i + 1;
      break;
    }
  }
  for (let i = index + length; i < end; i++) {
    if (isBoundary(text, i)) {
      end = i;
      break;
    }
  }
  // 窗口边缘落在拉丁单词中间：退到整词（"ke 1,000 bathrobes"、"sito precio" 这种半截词不要）；中文按字截，不处理
  const inWord = (i: number) => /[A-Za-z0-9\u00C0-\u024F]/.test(text[i] ?? "");
  if (start > 0 && inWord(start - 1) && inWord(start)) {
    while (start < index && inWord(start)) start++;
  }
  const cutByWindow = end < text.length && !isBoundary(text, end);
  if (end < text.length && inWord(end - 1) && inWord(end)) {
    while (end > index + length && inWord(end - 1)) end--;
  }
  // 窗口截在句子中间（"…sizes S-XL, white and"）：退到关键词之后最近的逗号 / 分号，不留半截从句
  if (cutByWindow) {
    const tail = text.slice(index + length, end);
    const cut = Math.max(tail.lastIndexOf(","), tail.lastIndexOf(";"), tail.lastIndexOf("，"), tail.lastIndexOf("；"));
    if (cut > 0) end = index + length + cut;
  }
  return text.slice(start, end).replace(/\s+/g, " ").replace(/[\s,，;；]+(and|or|with)?$/i, "").trim();
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
// 百分比后面必须是纤维名：30% deposit、10% discount、40% of the price 不是成分
const FIBER = "(?:cotton|polyester|poly|viscose|rayon|bamboo|linen|wool|spandex|elastane|lycra|nylon|polyamide|acrylic|modal|silk|microfiber|microfibre|tencel|lyocell|棉|涤纶|聚酯纤维|聚酯|竹纤维|亚麻|羊毛|氨纶|锦纶|腈纶|莫代尔|真丝|粘胶)";
const COMPOSITION_RE = new RegExp(`(\\d{1,3}\\s*%\\s*${FIBER}(?:(?:\\s*(?:\\/|,|and|\\+|、)\\s*|\\s+)\\d{1,3}\\s*%\\s*${FIBER})*)`, "i");
const PRICE_RE =
  /(?:(usd|cad|eur|gbp|aud|rmb|cny|us\$|ca\$|\$|€|£|¥|美元|加元|欧元|人民币)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(usd|cad|eur|gbp|aud|rmb|cny|美元|加元|欧元|元))(?:\s*(?:\/|per|each|每)\s*(?:pc|pcs|piece|unit|set|件|个|套))?/i;
const PRICE_CONTEXT_RE = /(target price|target|budget|price point|around|max|maximum|不超过|预算|目标价|单价)/i;
const DATE_ISO_RE = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/;
const DATE_TEXT_RE =
  /\b(?:by|before|until|deliver(?:y|ed)?\s+(?:by|before|in)|需要在|要求)?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i;
const MONTH_WORD = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
// 「before March」= 2 月底之前；by / until / in 取当月底
const DATE_MONTH_ONLY_RE = new RegExp(`\\b(by|before|until|in)\\s+(?:end of\\s+|mid[- ]|early\\s+)?${MONTH_WORD}\\b(?:\\s*(20\\d{2}))?`, "i");
// 表单字段值常常只写「March 2027」，没有介词：只在「Required date: …」这种标注行里认
const DATE_BARE_MONTH_RE = new RegExp(`^(?:end of\\s+|mid[- ]|early\\s+)?${MONTH_WORD}\\.?,?(?:\\s*(20\\d{2}))?$`, "i");
const RELATIVE_RE = /(?:within|in|deliver(?:y)? in|需要在|交期)\s*(\d{1,3})\s*(days?|weeks?|months?|天|周|个月)/i;
const CN_DATE_RE = /(20\d{2})年(\d{1,2})月(?:(\d{1,2})日)?/;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

function monthIndex(word: string): number | null {
  const key = word.toLowerCase().slice(0, 4) === "sept" ? "sep" : word.toLowerCase().slice(0, 3);
  return key in MONTHS ? MONTHS[key] : null;
}

interface ParsedDate {
  date: Date;
  confidence: number;
  index: number;
  length: number;
  note?: string;
}

/** 交期：ISO / 中文日期 / 「March 15」/「by|before|in March」/ 相对天数；bare=true 时再认「March 2027」（标注行的值） */
function parseRequiredDate(text: string, now: Date, bare = false): ParsedDate | null {
  const nextYearIfPast = (mi: number) => now.getUTCFullYear() + (mi < now.getUTCMonth() ? 1 : 0);
  const iso = DATE_ISO_RE.exec(text);
  if (iso) {
    return { date: new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))), confidence: 0.9, index: iso.index, length: iso[0].length };
  }
  const cn = CN_DATE_RE.exec(text);
  if (cn) {
    return { date: new Date(Date.UTC(Number(cn[1]), Number(cn[2]) - 1, cn[3] ? Number(cn[3]) : 1)), confidence: cn[3] ? 0.9 : 0.7, index: cn.index, length: cn[0].length };
  }
  const textDate = DATE_TEXT_RE.exec(text);
  if (textDate && monthIndex(textDate[1]) !== null) {
    const mi = monthIndex(textDate[1])!;
    const year = textDate[3] ? Number(textDate[3]) : nextYearIfPast(mi);
    return { date: new Date(Date.UTC(year, mi, Number(textDate[2]))), confidence: textDate[3] ? 0.85 : 0.7, index: textDate.index, length: textDate[0].length };
  }
  const monthOnly = DATE_MONTH_ONLY_RE.exec(text);
  if (monthOnly && monthIndex(monthOnly[2]) !== null) {
    const mi = monthIndex(monthOnly[2])!;
    const year = monthOnly[3] ? Number(monthOnly[3]) : nextYearIfPast(mi);
    // 月末；before 取上月末
    const date = new Date(Date.UTC(year, monthOnly[1].toLowerCase() === "before" ? mi : mi + 1, 0));
    return { date, confidence: 0.6, index: monthOnly.index, length: monthOnly[0].length };
  }
  const bareMonth = bare ? DATE_BARE_MONTH_RE.exec(text.trim()) : null;
  if (bareMonth && monthIndex(bareMonth[1]) !== null) {
    const mi = monthIndex(bareMonth[1])!;
    const year = bareMonth[2] ? Number(bareMonth[2]) : nextYearIfPast(mi);
    return { date: new Date(Date.UTC(year, mi + 1, 0)), confidence: 0.6, index: text.indexOf(text.trim()), length: text.trim().length };
  }
  const rel = RELATIVE_RE.exec(text);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const days = /week|周/.test(unit) ? n * 7 : /month|个月/.test(unit) ? n * 30 : n;
    return {
      date: new Date(now.getTime() + days * 86_400_000),
      confidence: 0.6,
      index: rel.index,
      length: rel[0].length,
      note: `requiredDeliveryDate 由相对交期「${rel[0].trim()}」按今日推算`,
    };
  }
  return null;
}

/**
 * 「Label: value」标注行（官网 / 嵌入表单的 Form details、买家自己列的清单）：标签已经说明是哪个字段，
 * 值整行照录，优先于关键词猜测；这些行不再参与关键词扫描（"Buyer type: Retail & Private Label" 不会被当成定制要求，
 * "Material: flannel fleece with sherpa back" 不会只剩 flannel fleece）。
 */
const FIELD_LABELS: Array<[RfqField, string[]]> = [
  ["quantity", ["quantity", "qty", "estimated quantity", "order quantity", "数量", "采购数量", "预计数量"]],
  ["material", ["material", "materials", "fabric", "material / fabric", "材质", "面料"]],
  ["composition", ["composition", "gsm", "fabric weight", "成分", "克重"]],
  ["size", ["size", "sizes", "size / specification", "dimensions", "尺寸", "规格"]],
  ["color", ["color", "colour", "colors", "colours", "颜色"]],
  ["customization", ["customization", "customisation", "branding", "logo", "labelling", "labeling", "定制", "定制要求"]],
  ["packaging", ["packaging", "packing", "包装", "包装要求"]],
  ["certification", ["certification", "certifications", "certification needs", "certificates", "认证", "认证要求"]],
  ["sampleRequired", ["sample requirement", "sample required", "samples", "sample", "样品", "样品需求"]],
  ["destinationCountry", ["target market", "destination", "destination country", "destination market", "目的国", "目标市场"]],
  ["incoterm", ["incoterm", "incoterms", "trade term", "贸易术语"]],
  ["requiredDeliveryDate", ["required date", "delivery date", "required delivery date", "target delivery date", "交期", "要求交期"]],
  ["buyerType", ["buyer type", "business type", "买家类型"]],
];
const LABEL_FIELD = new Map(FIELD_LABELS.flatMap(([field, labels]) => labels.map((l) => [l, field] as const)));
const LABELED_LINE_RE = /^[ \t]*(?:[-*•][ \t]*)?([A-Za-z\u4e00-\u9fff][A-Za-z\u4e00-\u9fff &/()-]{0,40}?)[ \t]*[:：][ \t]*(\S[^\n]*?)[ \t]*$/gm;
const NON_ANSWER_RE = /^(n\/?a|none|no idea|not sure(?: yet)?|tbd|tbc|unknown|-+|待定|不确定|无)$/i;

type LabeledPairs = Array<[RfqField, unknown]>;

function labeledValue(field: RfqField, raw: string, now: Date): LabeledPairs | null {
  const value = raw.replace(/\s+/g, " ").slice(0, 160);
  switch (field) {
    case "quantity": {
      const q = /(\d{1,3}(?:[,，]\d{3})+|\d+(?:\.\d+)?(?:\s*(?:k|万|千)(?![a-z]))?)/i.exec(value);
      const n = q ? parseNumber(q[1]) : null;
      if (!q || n === null || n <= 0) return null;
      // 数量后面的话照录成单位（「pcs per colour, 2 colours」），区间等非文字开头的交给关键词扫描
      const rest = value.slice(q.index + q[0].length).trim();
      if (rest && !/^[A-Za-z\u4e00-\u9fff]/.test(rest)) return null;
      return [["quantity", n], ["unit", rest ? rest.slice(0, 60) : null]];
    }
    case "requiredDeliveryDate": {
      const d = parseRequiredDate(value, now, true);
      return d ? [["requiredDeliveryDate", d.date]] : null;
    }
    case "destinationCountry": {
      const hits = detectCountries(value);
      if (!hits.length) return null;
      const city = hits.find((h) => h.city);
      const out: LabeledPairs = [["destinationCountry", hits[0].country]];
      if (city) out.push(["destinationCity", value.substr(city.index, city.matched.length)]);
      return out;
    }
    case "buyerType": {
      const b = detectBuyerType(value);
      return b.type === "unknown" ? null : [["buyerType", b.type]];
    }
    case "incoterm": {
      const inco = new RegExp(`\\b(${INCOTERMS.join("|")})\\b`, "i").exec(value);
      return inco ? [["incoterm", inco[1].toUpperCase()]] : null;
    }
    case "sampleRequired":
      if (/^(yes|y|required|needed|需要|要|是)\b/i.test(value)) return [["sampleRequired", true]];
      if (/^(no|n|not needed|不需要|不要|否)\b/i.test(value)) return [["sampleRequired", false]];
      return null;
    case "customization":
      return /logo|embroider|印|绣|brand|label/i.test(value) ? [["customization", value], ["customLogo", true]] : [["customization", value]];
    default:
      return [[field, value]];
  }
}

interface LabeledHit {
  pairs: LabeledPairs;
  index: number;
  length: number;
}

/**
 * 返回标注行字段 + 把这些行抹成空格的文本（下标不变，关键词扫描只看其余部分）。
 * 同一字段出现多次取最后一次：FDE 把多封来信按时间先后拼接，后来的更正 / 补充才算数。
 */
function labeledFields(source: string, now: Date): { hits: LabeledHit[]; masked: string } {
  const byField = new Map<RfqField, LabeledHit>();
  let masked = source;
  let m: RegExpExecArray | null;
  LABELED_LINE_RE.lastIndex = 0;
  while ((m = LABELED_LINE_RE.exec(source))) {
    const label = m[1].toLowerCase().replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ").trim();
    const field = LABEL_FIELD.get(label);
    if (!field) continue;
    const raw = m[2];
    // 一行里还有别的「Label:」（展会速记卡的「Buyer type: …. Packaging: ….」）：不是单字段行，交给关键词按句抽
    if (/[.;。；]\s*[A-Za-z\u4e00-\u9fff][A-Za-z\u4e00-\u9fff &/()-]{0,40}?\s*[:：]/.test(raw)) continue;
    const pairs = NON_ANSWER_RE.test(raw) ? [] : labeledValue(field, raw, now);
    if (pairs === null) continue; // 认不出：这行留给关键词扫描
    masked = masked.slice(0, m.index) + " ".repeat(m[0].length) + masked.slice(m.index + m[0].length);
    if (!pairs.length) continue;
    byField.delete(field); // 重新插入：保持「后出现的在后」，覆盖时后者生效
    byField.set(field, { pairs, index: m.index + m[0].trimEnd().length - raw.length, length: raw.length });
  }
  return { hits: [...byField.values()], masked };
}

export interface HeuristicOptions {
  /** 小写关键词 → 产品类目 */
  productKeywords: Record<string, string>;
  now?: Date;
}

export function extractRfqHeuristic(text: string, opts: HeuristicOptions): RfqExtraction {
  const original = (text ?? "").replace(/\r/g, "");
  const now = opts.now ?? new Date();
  const labeled = labeledFields(original, now);
  // 关键词扫描只看未标注的部分；下标与原文一致，证据片段仍取原文
  const source = labeled.masked;
  const lower = source.toLowerCase();
  const fields: RfqFields = emptyRfqFields();
  const evidence: RfqEvidence[] = [];
  const notes: string[] = [];
  const language = detectLanguage(original);

  const add = (field: RfqField, value: unknown, confidence: number, index: number, length: number) => {
    const str =
      value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
    evidence.push({ field, value: str, confidence, evidenceText: snippet(original, index, length), extractedBy: "heuristic" });
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
    let unit: string | undefined = m[2];
    // raw 可能带着空白（"200 " 后面没跟 k/万/千）；紧贴判断看数字本身的结尾
    const rawEnd = m.index + raw.trimEnd().length;
    // 单位只是更长单词的开头（3 months 的 m、200 mattresses 的 m）→ 不算单位
    if (unit && /[a-z]/i.test(source[m.index + m[0].length] ?? "")) unit = undefined;
    // 编号 / 型号 / 序数 / 日期里的数字不是数量：MX-SP-202606、CF140-0101、140th、14.3E07、10/31
    if (/[a-z\-_#/]/i.test(source[m.index - 1] ?? "")) continue;
    if (!unit && /[a-z]/i.test(source[rawEnd] ?? "")) continue;
    if (source[rawEnd] === "/") continue;
    const value = parseNumber(raw);
    if (value === null || value <= 0) continue;
    // 跳过尺寸/克重/价格/年份上下文
    const after = source.slice(m.index + m[0].length, m.index + m[0].length + 6).toLowerCase();
    const before = source.slice(Math.max(0, m.index - 6), m.index).toLowerCase();
    if (/^\s*(gsm|cm|mm|inch|in\b|"|x|×|\*|%|usd|cad|eur|\$|元|美元|加元)/.test(after)) continue;
    if (/(x|×|\*|\$|€|£|¥|usd|cad|eur)\s*$/.test(before)) continue;
    // 「MOQ is 100 pcs」「起订量 300 件」是对方说的起订量，不是采购数量
    if (/(moq|minimum order(?: quantity)?|起订量|最小起订量?|起订)\s*(?:is|of|:|：|为|是|=)?\s*$/i.test(source.slice(Math.max(0, m.index - 24), m.index))) continue;
    if (/^(19|20)\d{2}$/.test(raw.replace(/[,，]/g, "")) && !unit) continue;
    let score = unit ? 3 : 0;
    if (/[,，]\d{3}/.test(raw) || /k|万|千/i.test(raw)) score += 2;
    if (productKw && Math.abs(productKw.index - (m.index + m[0].length)) <= 3) score += 3;
    if (value >= 50) score += 1;
    if (!unit && value < 10) continue;
    qtyCandidates.push({ value, index: m.index, length: unit ? m[0].length : raw.trimEnd().length, score });
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
    fields.customization = stripLabel(snippet(source, custom.index, custom.kw.length));
    fields.customLogo = /logo|embroider|印|绣|brand|label/i.test(custom.kw) ? true : null;
    add("customization", fields.customization, 0.7, custom.index, custom.kw.length);
    if (fields.customLogo) add("customLogo", true, 0.75, custom.index, custom.kw.length);
  }

  // ── 包装 / 认证 / 样品 ──
  const pack = findKeyword(lower, PACKAGING_KEYWORDS);
  if (pack) {
    fields.packaging = stripLabel(snippet(source, pack.index, pack.kw.length));
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
  const due = parseRequiredDate(source, now);
  if (due) {
    fields.requiredDeliveryDate = due.date;
    add("requiredDeliveryDate", due.date, due.confidence, due.index, due.length);
    if (due.note) notes.push(due.note);
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

  // ── 标注行：标签说了是哪个字段，覆盖关键词猜测 ──
  for (const hit of labeled.hits) {
    for (const [field, value] of hit.pairs) {
      (fields as unknown as Record<string, unknown>)[field] = value;
      for (let i = evidence.length - 1; i >= 0; i--) if (evidence[i].field === field) evidence.splice(i, 1);
      if (value !== null) add(field, value, 0.95, hit.index, hit.length);
    }
    if (fields.unit === null && hit.pairs.some(([f]) => f === "quantity")) fields.unit = fields.productName ? "pcs" : null;
  }

  return { fields, evidence, language, method: "heuristic", notes };
}
