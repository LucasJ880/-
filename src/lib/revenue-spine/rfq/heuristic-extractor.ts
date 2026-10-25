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
// 「before March」= 2 月底之前；by / until / in /（the）end of 取当月底；early / mid 只说到上旬 / 中旬，不编日子 → 跳过
const DATE_MONTH_ONLY_RE = new RegExp(`\\b(by|before|until|in)\\s+((?:the\\s+)?end of\\s+|mid[- ]|early\\s+)?${MONTH_WORD}\\b(?:\\.?,?\\s*(20\\d{2}))?`, "gi");
// 表单字段值常常只写「March 2027」，没有介词：只在「Required date: …」这种标注行里认
const DATE_BARE_MONTH_RE = new RegExp(`^((?:the\\s+)?end of\\s+|mid[- ]|early\\s+)?${MONTH_WORD}\\.?,?(?:\\s*(20\\d{2}))?[.。]?$`, "i");
const RELATIVE_RE = /(?:within|in|deliver(?:y)? in|需要在|交期)\s*(\d{1,3})\s*(days?|weeks?|months?|天|周|个月)/i;
// 2027年3月15日 / 2027年3月底（月底）/ 2027年3月前（上月底）/ 2027年3月（月底）/ 2027年3月中旬（不编日子 → 跳过）
const CN_DATE_RE = /(20\d{2})年(\d{1,2})月(?:(\d{1,2})[日号]|(底|末|下旬|之前|以前|前|中旬|上旬|月初|初|中))?/;

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
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // 没写年份：取不早于今天的那一年
  const notPast = (build: (year: number) => Date, year: number | null) => {
    if (year !== null) return build(year);
    const d = build(now.getUTCFullYear());
    return d.getTime() < today ? build(now.getUTCFullYear() + 1) : d;
  };
  // 只给月份：月底；before 取上月底
  const monthEnd = (year: number | null, mi: number, before: boolean) =>
    notPast((y) => new Date(Date.UTC(y, before ? mi : mi + 1, 0)), year);
  const vague = (qualifier: string | undefined) => /^(mid|early)/i.test(qualifier ?? "");

  const iso = DATE_ISO_RE.exec(text);
  if (iso) {
    return { date: new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))), confidence: 0.9, index: iso.index, length: iso[0].length };
  }
  const cn = CN_DATE_RE.exec(text);
  if (cn && !(cn[4] && /中旬|上旬|初|^中$/.test(cn[4]))) {
    const year = Number(cn[1]);
    const mi = Number(cn[2]) - 1;
    const date = cn[3]
      ? new Date(Date.UTC(year, mi, Number(cn[3])))
      : monthEnd(year, mi, !!cn[4] && /前/.test(cn[4]));
    return { date, confidence: cn[3] ? 0.9 : 0.7, index: cn.index, length: cn[0].length };
  }
  const textDate = DATE_TEXT_RE.exec(text);
  if (textDate && monthIndex(textDate[1]) !== null) {
    const mi = monthIndex(textDate[1])!;
    const date = notPast((y) => new Date(Date.UTC(y, mi, Number(textDate[2]))), textDate[3] ? Number(textDate[3]) : null);
    return { date, confidence: textDate[3] ? 0.85 : 0.7, index: textDate.index, length: textDate[0].length };
  }
  DATE_MONTH_ONLY_RE.lastIndex = 0;
  for (const mo of text.matchAll(DATE_MONTH_ONLY_RE)) {
    if (monthIndex(mo[3]) === null || vague(mo[2])) continue;
    // 「before end of March」= 3 月底之前，不是 2 月底
    const date = monthEnd(mo[4] ? Number(mo[4]) : null, monthIndex(mo[3])!, mo[1].toLowerCase() === "before" && !mo[2]);
    return { date, confidence: 0.6, index: mo.index ?? 0, length: mo[0].length };
  }
  const bareText = text.trim();
  const bareMonth = bare ? DATE_BARE_MONTH_RE.exec(bareText) : null;
  if (bareMonth && monthIndex(bareMonth[2]) !== null && !vague(bareMonth[1])) {
    const date = monthEnd(bareMonth[3] ? Number(bareMonth[3]) : null, monthIndex(bareMonth[2])!, false);
    return { date, confidence: 0.6, index: text.indexOf(bareText), length: bareText.length };
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
 * 「Label: value」单字段标注行（官网 / 嵌入表单的 Form details、买家自己列的清单）：标签已经说明是哪个字段，
 * 关键词扫描照常跑完后，用标注值覆盖该字段（"Material: flannel fleece with sherpa back" 不会只剩 flannel fleece）。
 * 只收关键词抽得不全或会抽错的字段；颜色、成分、目标市场等关键词本来就抽得准、或不等于交货地的不收。
 * 什么时候不覆盖（见 extractRfqHeuristic 末尾）：更晚的来信里关键词抽到了同一字段（买家后来改口）；
 * 数量 / 交期 / 目的地 / 贸易术语在同一封来信里、标注行之前就说过（正文先说的为准）。
 */
const FIELD_LABELS: Array<[RfqField, string[]]> = [
  ["quantity", ["quantity", "qty", "estimated quantity", "order quantity", "数量", "采购数量", "预计数量"]],
  ["material", ["material", "materials", "fabric", "material / fabric", "材质", "面料"]],
  ["size", ["size", "sizes", "size / specification", "dimensions", "尺寸", "规格"]],
  ["customization", ["customization", "customisation", "branding", "logo", "labelling", "labeling", "定制", "定制要求"]],
  ["packaging", ["packaging", "packing", "包装", "包装要求"]],
  ["certification", ["certification", "certifications", "certification needs", "certificates", "认证", "认证要求"]],
  ["sampleRequired", ["sample requirement", "sample required", "samples", "sample", "样品", "样品需求"]],
  ["destinationCountry", ["destination", "destination country", "ship to", "目的国", "目的地"]],
  ["incoterm", ["incoterm", "incoterms", "trade term", "贸易术语"]],
  ["requiredDeliveryDate", ["required date", "delivery date", "required delivery date", "target delivery date", "交期", "要求交期"]],
  ["buyerType", ["buyer type", "business type", "买家类型"]],
];
const LABEL_FIELD = new Map(FIELD_LABELS.flatMap(([field, labels]) => labels.map((l) => [l, field] as const)));
// 「- Label: value」「*Material:* cotton」「**Size**: L」都算
const LABELED_LINE_RE = /^[^\S\n]*(?:[-•*][^\S\n]+)?[*_]{0,2}([A-Za-z\u4e00-\u9fff][A-Za-z\u4e00-\u9fff &/()-]{0,40}?)[*_]{0,2}[^\S\n]*[:：][*_ \t]{0,3}?(\S[^\n]*?)[^\S\n]*$/gm;
// 一行里还有别的「Label:」（「Quantity: 3000 pcs, Color: white」、展会速记卡的「Buyer type: …. Packaging: ….」）：不是单字段行
const SECOND_LABEL_RE = /[.;。；,，|｜]\s*[A-Za-z\u4e00-\u9fff][A-Za-z\u4e00-\u9fff &/()-]{0,40}?\s*[:：]/;
// 买家没答 / 让我们建议：不是事实（不覆盖，也不压掉追问）
const NON_ANSWER_RE =
  /^(?:n\/?a|none|no idea|not sure(?: yet)?|tbd|tbc|unknown|any|open|flexible|-+|\?+|standard|待定|不确定|无|待确认|都可以|随便)[.!。]?$|^(?:please (?:advise|suggest|recommend|quote)|your (?:suggestion|recommendation|standard|choice|advice|call)|open to|no preference|whatever|to be (?:confirmed|discussed|advised|decided)|as per (?:your )?(?:sample|standard|suggestion)|same as (?:the )?sample|depends|请(?:建议|推荐|报价)|你们(?:建议|推荐|定)|按(?:样品|你们))/i;
const YES_NO_RE = /^(?:yes|y|ok|no|n|true|false|需要|不需要|是|否|有|没有|要|不要)[.!。]?$/i;
// 数量后的单位：单位词，可带「per colour」「/size」「每色」；后面的话（if you give 10% discount…）不算单位
const QTY_UNIT_RE = new RegExp(
  `^(${UNIT_WORDS})(?![A-Za-z])(?:\\s*(?:per|each|/)\\s*(colou?r|size|style|design|item|sku|model|pattern|version|款|色|码)\\b|\\s*每\\s*([色款码]))?`,
  "i",
);
const QTY_CAVEAT_RE = /\b(moq|minimum|samples?|trial|per (?:carton|ctn|box|bag|set|pack))\b|样品|起订|试单|每箱/i;
// 回复里的引用历史从这里开始（Outlook「From:…Sent:」、「-----Original Message-----」、「On … wrote:」、中文客户端）
const QUOTE_START_RE =
  /^[>\s]*(?:-{2,}\s*(?:original message|forwarded message|原始邮件|原邮件|转发的邮件)\s*-{2,}|-{4,}\s*original\s*-{4,}|begin forwarded message:?|on .{4,200}wrote:|在.{2,100}写道[:：]|(?:from|发件人)[:：].*\n(?:.*\n){0,3}?[>\s]*(?:sent|date|发送时间|日期)[:：])/im;
/** FDE 把多封来信按时间先后用它拼接（fde/inbound-sales.ts）；买家正文里几乎不会出现 */
export const INBOUND_MESSAGE_SEPARATOR = "\n\n----- next message -----\n\n";

type LabeledPairs = Array<[RfqField, unknown]>;

/** 句子在这里结束（「OEKO-TEX certified. Please send the certificate.」只取前一句）；2.5、No. 5 不算 */
function firstSentence(value: string): string {
  const m = /[.!?](?=\s+[A-Z\u4e00-\u9fff])|[。！？]/.exec(value);
  return (m ? value.slice(0, m.index) : value).trim();
}

/** 长度封顶时退到整词 */
function capWords(value: string, max = 160): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max / 2 ? cut.slice(0, sp) : cut).trim();
}

function labeledQuantity(value: string): LabeledPairs | null {
  // 样品数、起订量、每箱数量混在一起时交给关键词扫描（它有起订量 / 样品过滤与打分）
  if (QTY_CAVEAT_RE.test(value)) return null;
  const candidates: Array<{ n: number; unit: string | null; rest: string }> = [];
  for (const m of value.matchAll(/(\d{1,3}(?:[,，]\d{3})+|\d+(?:\.\d+)?)(\s*(?:k|万|千)(?![a-z]))?/gi)) {
    const at = m.index ?? 0;
    // 型号 / 编号 / 区间后半里的数字不算：40HQ 的 40（前面是 x）、3,000-5,000 的 5,000
    if (/[A-Za-z\-_#/]/.test(value[at - 1] ?? "")) continue;
    const n = parseNumber(m[1] + (m[2] ?? "").trim());
    if (n === null || n <= 0) continue;
    const after = value.slice(at + m[0].length);
    const u = QTY_UNIT_RE.exec(after.trimStart());
    let unit: string | null = null;
    if (u) {
      const word = /^(?:piece|pieces|pc)$/i.test(u[1]) ? "pcs" : u[1].toLowerCase();
      const per = u[2] ? ` per ${u[2].toLowerCase()}` : u[3] ? `每${u[3]}` : "";
      unit = word + per;
    }
    candidates.push({ n, unit, rest: after.trim() });
  }
  const withUnit = candidates.filter((c) => c.unit);
  // 只有一个带单位的数才算（「2 colours x 3,000 pcs」「1st order 3,000 pcs」取 3,000）；几个带单位的数（总数、每款、每箱…）交给关键词扫描
  if (withUnit.length === 1) return [["quantity", withUnit[0].n], ["unit", withUnit[0].unit]];
  // 不带单位：只有一个数、后面没有别的话（「Quantity: 3000」），且不是个位数
  if (!withUnit.length && candidates.length === 1 && !candidates[0].rest && candidates[0].n >= 10) {
    return [["quantity", candidates[0].n], ["unit", null]];
  }
  return null;
}

function labeledCertification(value: string): LabeledPairs | null {
  if (/^(?:no|none|not (?:required|needed|necessary)|n\/a|不需要|无需|没有|不用)(?![A-Za-z])/i.test(value)) return null;
  const lower = value.toLowerCase();
  const hits: Array<{ index: number; text: string }> = [];
  for (const kw of CERTIFICATION_KEYWORDS) {
    const isAscii = /^[\x00-\x7f]+$/.test(kw);
    const i = isAscii ? lower.search(new RegExp(`(?<![a-z])${escapeRe(kw.toLowerCase())}(?![a-z])`)) : lower.indexOf(kw.toLowerCase());
    if (i >= 0 && !hits.some((h) => i >= h.index && i < h.index + h.text.length)) hits.push({ index: i, text: value.substr(i, kw.length) });
  }
  if (hits.length) return [["certification", hits.sort((a, b) => a.index - b.index).map((h) => h.text).join(", ")]];
  // 词表外的认证名（短、不是问句）照录
  return value.length <= 40 && !value.includes("?") ? [["certification", value]] : null;
}

function labeledValue(field: RfqField, raw: string, now: Date): LabeledPairs | null {
  const value = capWords(raw.replace(/\s+/g, " ").replace(/^[*_\s]+|[*_\s]+$/g, ""));
  if (!value || NON_ANSWER_RE.test(value)) return null;
  const sentence = firstSentence(value);
  const yesNo = YES_NO_RE.test(sentence);
  switch (field) {
    case "quantity":
      return labeledQuantity(value);
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
      // \b 在中文后面不成立，用「后面不是字母」
      if (/^(?:yes|y|required|needed|需要|要|是)(?![A-Za-z])/i.test(value)) return [["sampleRequired", true]];
      if (/^(?:no|n|not needed|不需要|不要|否)(?![A-Za-z])/i.test(value)) return [["sampleRequired", false]];
      return null;
    case "certification":
      return labeledCertification(sentence);
    case "customization":
      // 「Logo: yes」只说明要 logo，不当成定制内容复述
      if (yesNo) return /^(yes|y|ok|true|需要|是|有|要)/i.test(sentence) ? [["customization", null], ["customLogo", true]] : null;
      // 「No, plain stock is fine」：不要定制
      if (/^(?:no|none|not (?:needed|required)|plain|无|不需要|不用)(?![A-Za-z])/i.test(sentence)) return null;
      return /logo|embroider|印|绣|brand|label/i.test(sentence) ? [["customization", sentence], ["customLogo", true]] : [["customization", sentence]];
    case "material":
      // 词表里的面料词都没有、又是一长句：多半不是材质，交给关键词扫描
      if (yesNo || (!MATERIAL_KEYWORDS.some((k) => sentence.toLowerCase().includes(k)) && sentence.split(" ").length > 6)) return null;
      return [["material", sentence]];
    case "size": {
      // 有「70x140cm」这种尺寸就只取它（后面的克重、成分不算尺寸）；没有就短值照录（S/M and L/XL、Queen）
      const dim = SIZE_RE.exec(sentence);
      if (dim) return [["size", dim[0].replace(/\s+/g, " ").trim()]];
      return yesNo || sentence.split(" ").length > 8 ? null : [["size", sentence]];
    }
    default:
      return yesNo ? null : [[field, sentence]];
  }
}

interface LabeledHit {
  pairs: LabeledPairs;
  /** 值在原文里的位置（证据片段用） */
  index: number;
  length: number;
  /** 整行范围：关键词命中落在这一行里，说明就是同一句话 */
  lineStart: number;
  lineEnd: number;
  segment: number;
}

/**
 * 标注行字段，以及把「买家类型」行抹成空格的文本（下标不变，只给产品规格类关键词扫描用）：
 * 那一行说的是买家，「Retail & Private Label」不是定制要求，也不是零售包装。
 * 同一字段：同一封来信里取第一次，引用历史（QUOTE_START_RE 之后）里的不算；不同来信取后一封。
 */
/** 标注了但没给出可用答案的行（「Packaging: your suggestion」「Logo: no」「Sample requirement: later」）：标签词本身是关键词，不能让关键词扫描从这一行里再读出一个「答案」 */
const SUPPRESS_WHEN_UNANSWERED: RfqField[] = ["material", "size", "customization", "packaging", "certification", "sampleRequired"];

function labeledFields(
  source: string,
  now: Date,
): { hits: LabeledHit[]; unanswered: Array<{ field: RfqField; lineStart: number; lineEnd: number }>; specScan: string; segmentOf: (index: number) => number } {
  const segStarts = [0];
  for (let i = source.indexOf(INBOUND_MESSAGE_SEPARATOR); i >= 0; i = source.indexOf(INBOUND_MESSAGE_SEPARATOR, i + 1)) {
    segStarts.push(i + INBOUND_MESSAGE_SEPARATOR.length);
  }
  const segmentOf = (index: number) => {
    let seg = 0;
    while (seg + 1 < segStarts.length && segStarts[seg + 1] <= index) seg++;
    return seg;
  };
  const quoteAt = segStarts.map((start, seg) => {
    const end = seg + 1 < segStarts.length ? segStarts[seg + 1] : source.length;
    const q = QUOTE_START_RE.exec(source.slice(start, end));
    return q ? start + q.index : Infinity;
  });

  const byField = new Map<RfqField, LabeledHit>();
  const unanswered: Array<{ field: RfqField; lineStart: number; lineEnd: number }> = [];
  let masked = source;
  let m: RegExpExecArray | null;
  LABELED_LINE_RE.lastIndex = 0;
  while ((m = LABELED_LINE_RE.exec(source))) {
    const label = m[1].toLowerCase().replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ").trim();
    const field = LABEL_FIELD.get(label);
    if (!field) continue;
    const raw = m[2];
    if (SECOND_LABEL_RE.test(raw)) continue;
    if (field === "buyerType") masked = masked.slice(0, m.index) + " ".repeat(m[0].length) + masked.slice(m.index + m[0].length);
    const segment = segmentOf(m.index);
    if (m.index >= quoteAt[segment]) continue;
    const prev = byField.get(field);
    if (prev && prev.segment >= segment) continue;
    const pairs = labeledValue(field, raw, now);
    if (!pairs) {
      if (SUPPRESS_WHEN_UNANSWERED.includes(field)) unanswered.push({ field, lineStart: m.index, lineEnd: m.index + m[0].length });
      continue;
    }
    byField.set(field, {
      pairs,
      index: m.index + m[0].trimEnd().length - raw.length,
      length: raw.length,
      lineStart: m.index,
      lineEnd: m.index + m[0].length,
      segment,
    });
  }
  return { hits: [...byField.values()], unanswered, specScan: masked, segmentOf };
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
  const source = original;
  const lower = source.toLowerCase();
  // 产品规格类关键词（材质、颜色、定制、包装、认证、样品）不在「买家类型」行里找：那一行说的是买家，
  // 「Retail & Private Label」既不是定制要求也不是零售包装（见 labeledFields）
  const specLower = labeled.specScan.toLowerCase();
  const fields: RfqFields = emptyRfqFields();
  const evidence: RfqEvidence[] = [];
  const notes: string[] = [];
  const language = detectLanguage(original);

  // 关键词命中的位置：决定标注值能不能覆盖（见末尾）
  const keywordAt = new Map<RfqField, number>();
  const add = (field: RfqField, value: unknown, confidence: number, index: number, length: number) => {
    if (!keywordAt.has(field)) keywordAt.set(field, index);
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
  // 同分时取更晚的来信里的（FDE 按时间拼接多封来信，后来的数量算数），同一封里取先出现的
  qtyCandidates.sort((a, b) => b.score - a.score || labeled.segmentOf(b.index) - labeled.segmentOf(a.index) || a.index - b.index);
  if (qtyCandidates.length) {
    const best = qtyCandidates[0];
    fields.quantity = best.value;
    const unitMatch = source.slice(best.index, best.index + best.length).match(new RegExp(`(${UNIT_WORDS})$`, "i"));
    fields.unit = unitMatch ? unitMatch[1].toLowerCase() : fields.productName ? "pcs" : null;
    add("quantity", best.value, best.score >= 5 ? 0.95 : best.score >= 3 ? 0.85 : 0.6, best.index, best.length);
    if (unitMatch) add("unit", fields.unit, 0.9, best.index, best.length);
  }

  // ── 材质 / 成分 ──
  const material = findKeyword(specLower, MATERIAL_KEYWORDS);
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
  const color = findKeyword(specLower, COLOR_KEYWORDS);
  if (color) {
    fields.color = source.substr(color.index, color.kw.length);
    add("color", fields.color, 0.75, color.index, color.kw.length);
  }

  // ── 定制 / Logo ──
  const custom = findKeyword(specLower, CUSTOMIZATION_KEYWORDS);
  if (custom) {
    fields.customization = stripLabel(snippet(source, custom.index, custom.kw.length));
    fields.customLogo = /logo|embroider|印|绣|brand|label/i.test(custom.kw) ? true : null;
    add("customization", fields.customization, 0.7, custom.index, custom.kw.length);
    if (fields.customLogo) add("customLogo", true, 0.75, custom.index, custom.kw.length);
  }

  // ── 包装 / 认证 / 样品 ──
  const pack = findKeyword(specLower, PACKAGING_KEYWORDS);
  if (pack) {
    fields.packaging = stripLabel(snippet(source, pack.index, pack.kw.length));
    add("packaging", fields.packaging, 0.65, pack.index, pack.kw.length);
  }
  const cert = findKeyword(specLower, CERTIFICATION_KEYWORDS);
  if (cert) {
    fields.certification = source.substr(cert.index, cert.kw.length);
    add("certification", fields.certification, 0.8, cert.index, cert.kw.length);
  }
  const sample = findKeyword(specLower, SAMPLE_KEYWORDS);
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
  // 不覆盖：更晚的来信里关键词抽到了同一字段（买家后来改口）；数量 / 交期 / 目的地 / 贸易术语在同一封来信里
  // 标注行之前就说过（正文先说的为准，标注行之后的多是表单其余字段或引用历史）。
  const STATED_FIRST: RfqField[] = ["quantity", "requiredDeliveryDate", "destinationCountry", "incoterm"];
  const dropEvidence = (field: RfqField) => {
    for (let i = evidence.length - 1; i >= 0; i--) if (evidence[i].field === field) evidence.splice(i, 1);
  };
  const keywordWins = (hit: LabeledHit, field: RfqField) => {
    const k = keywordAt.get(field);
    if (k === undefined || (k >= hit.lineStart && k < hit.lineEnd)) return false;
    const seg = labeled.segmentOf(k);
    if (seg !== hit.segment) return seg > hit.segment;
    return STATED_FIRST.includes(field) && k < hit.lineStart;
  };
  for (const u of labeled.unanswered) {
    for (const field of u.field === "customization" ? (["customization", "customLogo"] as RfqField[]) : [u.field]) {
      const k = keywordAt.get(field);
      if (k !== undefined && k >= u.lineStart && k < u.lineEnd) {
        (fields as unknown as Record<string, unknown>)[field] = null;
        dropEvidence(field);
      }
    }
  }
  const keywordQty = { quantity: fields.quantity, unit: fields.unit };
  let labeledCountry = false;
  for (const hit of labeled.hits) {
    if (keywordWins(hit, hit.pairs[0][0])) continue;
    for (const [field, value] of hit.pairs) {
      (fields as unknown as Record<string, unknown>)[field] = value;
      dropEvidence(field);
      if (value !== null) add(field, value, 0.85, hit.index, hit.length);
    }
    if (hit.pairs[0][0] === "destinationCountry") labeledCountry = !hit.pairs.some(([f]) => f === "destinationCity");
    if (hit.pairs[0][0] === "quantity" && fields.unit === null) {
      // 「Qty: 5000」没写单位：沿用正文里同一个数的单位（5000 meters），否则有产品时按 pcs
      fields.unit = keywordQty.quantity === fields.quantity && keywordQty.unit ? keywordQty.unit : fields.productName ? "pcs" : null;
    }
  }
  // 标注的目的国与关键词抽到的城市不在同一国（「ship to Toronto」+「Destination: USA」）：城市作废，别拼出错的组合
  if (labeledCountry && fields.destinationCity) {
    const cityCountry = detectCountries(fields.destinationCity).find((c) => c.city)?.country ?? null;
    if (cityCountry && cityCountry !== fields.destinationCountry) {
      fields.destinationCity = null;
      dropEvidence("destinationCity");
    }
  }

  return { fields, evidence, language, method: "heuristic", notes };
}
