/**
 * 情报调研树（TREE-3）的授标纯函数：把已核对的事实组装成授标记录，算单价、口径、币种与可比度。
 *
 * 全部确定性：不调模型、不读库、不联网。金额与数量用十进制（BigInt）运算，不用浮点；不换汇。
 * 设计见 openspec/changes/research-branches-awards/design.md D5–D10。
 */

import { createHash } from "node:crypto";
import { compareCompanyNames } from "@/lib/tender-competition/company-identity";
import { RESEARCH_TREE_LIMITS } from "./limits";
import type {
  AwardComparability,
  AwardRecordField,
  CurrencyBasis,
  FoundFact,
  RecordFieldKey,
  ResearchAwardRecordV1,
  ScopeBasisTag,
  Tri,
} from "./types";

/* ───────────────────────────── 十进制 ───────────────────────────── */

/** 十进制数：值 = int / 10^scale（int ≥ 0） */
export type Dec = { int: bigint; scale: number };

const MAX_SCALE = 6;

function decOf(intPart: string, fracPart: string): Dec | null {
  const i = intPart.replace(/^0+(?=\d)/, "");
  const f = fracPart.slice(0, MAX_SCALE);
  if (!/^\d+$/.test(i) || (f && !/^\d+$/.test(f))) return null;
  return { int: BigInt(i + f), scale: f.length };
}

function decMul(d: Dec, factor: bigint): Dec {
  return { int: d.int * factor, scale: d.scale };
}

function decIsZero(d: Dec): boolean {
  return d.int === BigInt(0);
}

/** 十进制按 places 位小数写出（四舍五入，half up） */
export function decToFixed(d: Dec, places: number): string {
  const ten = BigInt(10);
  let n: bigint;
  if (d.scale <= places) {
    n = d.int * ten ** BigInt(places - d.scale);
  } else {
    const div = ten ** BigInt(d.scale - places);
    n = d.int / div;
    if ((d.int % div) * BigInt(2) >= div) n += BigInt(1);
  }
  const s = n.toString().padStart(places + 1, "0");
  return places > 0 ? `${s.slice(0, s.length - places)}.${s.slice(s.length - places)}` : s;
}

function decToNumber(d: Dec): number {
  return Number(d.int) / 10 ** d.scale;
}

/** 十进制写法 → Dec（"230000.50" 这类由本模块写出的串） */
export function decFromString(s: string | null | undefined): Dec | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(s ?? "").trim());
  return m ? decOf(m[1], m[2] ?? "") : null;
}

/* ───────────────────────────── 数的写法 ───────────────────────────── */

/**
 * 一段文字里的数（按出现顺序）。认：英文千分位 230,000.50；空格千分位 10 000；法文 230 000,50；不带分隔的
 * 230000 / 1.25。年份、编号里的数同样会被认出来——调用方据「只能有一个数」判断这个值是否单纯。
 */
/** 数的写法比对前的归一（NFKC、去掉不可见的格式字符）；numberTokens 的 end 按这个归一后的下标 */
function normNum(text: string | null | undefined): string {
  return String(text ?? "").normalize("NFKC").replace(/\p{Cf}/gu, "");
}

export function numberTokens(text: string): Array<{ dec: Dec; end: number; ambiguous?: boolean }> {
  const s = normNum(text);
  // 依次：法文千分位小数 230 000,50；英文千分位 230,000.50；空格千分位 10 000（最后一组后面紧跟字母或连字符时不算千分位，
  // 免得「500 240L」被吞成 500240）；法文小数 1,25 / 12,5（逗号后只有 1–2 位，不会是英文千分位）；不带分隔的 230000 / 1.25
  const re =
    /(?<![\d.,])(?:(\d{1,3}(?:[   .]\d{3})+),(\d{1,2})(?![\d])|(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?|(\d{1,3}(?:[   ]\d{3})+)(?![\p{L}\d-])(?:\.(\d+))?|(\d+),(\d{1,2})(?![\d,])|(\d+)(?:\.(\d+))?)(?![\d])/gu;
  const out: Array<{ dec: Dec; end: number; ambiguous?: boolean }> = [];
  for (const m of s.matchAll(re)) {
    let dec: Dec | null = null;
    if (m[1] !== undefined) dec = decOf(m[1].replace(/[   .]/g, ""), m[2] ?? "");
    else if (m[3] !== undefined) dec = decOf(m[3].replace(/,/g, ""), m[4] ?? "");
    else if (m[5] !== undefined) dec = decOf(m[5].replace(/[   ]/g, ""), m[6] ?? "");
    else if (m[7] !== undefined) dec = decOf(m[7], m[8] ?? "");
    else if (m[9] !== undefined) dec = decOf(m[9], m[10] ?? "");
    if (!dec) continue;
    const end = (m.index ?? 0) + m[0].length;
    // 认不清的写法（TREE-3 挑错）：后面还剩没读完的数字分组（「1.000.000」只读到 1.000）；只有一个点、点后正好三位
    // （「10.000」可能是一万也可能是十）
    const leftover = /^[.,]\d/.test(s.slice(end));
    const dotThousands = m[9] !== undefined && m[10] !== undefined && m[10].length === 3 && m[9].length <= 3;
    out.push({ dec, end, ...(leftover || dotThousands ? { ambiguous: true } : {}) });
  }
  return out;
}

/** 数后面的倍数词：千 / 百万 / 十亿 / 万 / 亿（「m」「mm」「b」这种缩写单独标出，数量里不认） */
const MULTIPLIER_AFTER =
  /^\s*(?:(k|thousand|thousands)\b|(million|millions|millions?\s+de)\b|(m|mm|mil)\b|(billion|billions)\b|(b|bn)\b|(万)|(亿))/iu;

type Multiplier = { factor: bigint; abbreviated: boolean } | null;

function multiplierAfter(text: string, tok: { dec: Dec; end: number }): Multiplier {
  const m = MULTIPLIER_AFTER.exec(normNum(text).slice(tok.end));
  if (!m) return null;
  const ten = BigInt(10);
  if (m[1]) return { factor: ten ** BigInt(3), abbreviated: m[1].toLowerCase() === "k" };
  if (m[2]) return { factor: ten ** BigInt(6), abbreviated: false };
  if (m[3]) return { factor: ten ** BigInt(6), abbreviated: true };
  if (m[4]) return { factor: ten ** BigInt(9), abbreviated: false };
  if (m[5]) return { factor: ten ** BigInt(9), abbreviated: true };
  if (m[6]) return { factor: ten ** BigInt(4), abbreviated: false };
  return { factor: ten ** BigInt(8), abbreviated: false };
}

/** 减项写法：负号或括号（「-$230,000」「(230,000)」）——合同额与数量不收这种值 */
//   - 开头的负号（各种横线，后面可以有空格）：「-$230,000」「– 230 000 $」「−500」
//   - 中间的负号要紧挨着数或货币符号：「CAD -230,000」「$-230,000」；「Total - $230,000」「Lot A - $230,000」这种标签与值之间的横线不算
//   - 括号括起来的值（货币符号、币种字母在前在后都行）：「(230,000)」「($230,000 CAD)」「(230 000 $)」
//   - 数后面的负号（会计写法）：「230,000-」
const DASH = "[-−‐‑‒–—]";
/** 括号里允许的币种字母（「(500 pcs)」「(12 kg)」这种带单位的数量不当减项） */
const CUR_CODE = "(?:CAD|CDN|USD|US|CA|CAN|EUR|C|U\\.S\\.)";
const NEGATIVE_RE = new RegExp(
  [
    `^\\s*${DASH}\\s*(?:[A-Za-z]{1,3}\\s*)?[$€£¥]?\\s*\\d`,
    `(?:[\\s(:=$€£¥]|\\b(?:CAD|CDN|USD|US))${DASH}(?:[A-Za-z]{1,3}\\s?)?[$€£¥]?\\d`,
    `\\(\\s*(?:${CUR_CODE}\\s*)?[$€£¥]?\\s*\\d[\\d.,\\s]*(?:[kKmM]{1,2}\\s*)?[$€£¥]?\\s*(?:${CUR_CODE}\\s*)?\\)`,
    `\\d\\s*(?:[$€£¥]\\s*)?(?:${CUR_CODE}\\s*)?${DASH}\\s*$`,
  ].join("|"),
  "u",
);

/**
 * 合同额的值 → 十进制（只有一个数才认；区间、两个数、0、认不清的写法、减项 → null）。货币符号与币种字母不影响；
 * 认 k / m / million / 万 等倍数
 */
export function parseAmountValue(value: string | null | undefined): Dec | null {
  if (!value) return null;
  if (NEGATIVE_RE.test(normNum(value))) return null;
  const toks = numberTokens(value);
  if (toks.length !== 1 || toks[0]!.ambiguous) return null;
  const mul = multiplierAfter(value, toks[0]);
  const d = mul ? decMul(toks[0].dec, mul.factor) : toks[0].dec;
  return decIsZero(d) ? null : d;
}

/**
 * 数量的值 → 十进制（只有一个数才认；认 k / thousand / million / 万 / 亿；「m」「mm」「b」在数量里可能是单位（米），
 * 认不清 → null；0 → null）
 */
export function parseQuantityValue(value: string | null | undefined): Dec | null {
  if (!value) return null;
  if (NEGATIVE_RE.test(normNum(value))) return null;
  const toks = numberTokens(value);
  if (toks.length !== 1 || toks[0]!.ambiguous) return null;
  const mul = multiplierAfter(value, toks[0]);
  if (mul && mul.abbreviated && mul.factor !== BigInt(1000)) return null;
  const d = mul ? decMul(toks[0].dec, mul.factor) : toks[0].dec;
  return decIsZero(d) ? null : d;
}

/** 年份的值 → 年（一个四位年份；「2023–2026」这种起止取起；别的多个年份 → null） */
export function parseYearValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const s = String(value).normalize("NFKC");
  const years = [...new Set([...s.matchAll(/(?<!\d)(19\d{2}|20\d{2})(?!\d)/g)].map((m) => Number(m[1])))];
  if (years.length === 1) return years[0];
  if (years.length === 2 && /(19|20)\d{2}\s*(?:[-–—~]|to|through|à|au)\s*(19|20)\d{2}/i.test(s)) return Math.min(...years);
  return null;
}

/* ───────────────────────────── 单价 ───────────────────────────── */

/**
 * 单价 = 合同额 ÷ 数量，精确到分（四舍五入），原币。两数都要有、都大于 0；否则 null。
 * 例：230000 ÷ 10000 = "23.00"。
 */
export function unitPriceOf(amount: Dec | string | null, quantity: Dec | string | null): string | null {
  const a = typeof amount === "string" ? decFromString(amount) : amount;
  const q = typeof quantity === "string" ? decFromString(quantity) : quantity;
  if (!a || !q || decIsZero(a) || decIsZero(q)) return null;
  // a.int / 10^a.scale ÷ (q.int / 10^q.scale) = a.int × 10^q.scale ÷ (q.int × 10^a.scale)；放大到分（× 100）
  const ten = BigInt(10);
  const num = a.int * ten ** BigInt(q.scale) * BigInt(100);
  const den = q.int * ten ** BigInt(a.scale);
  let cents = num / den;
  if ((num % den) * BigInt(2) >= den) cents += BigInt(1);
  // 不到半分（四舍五入成 0.00）：单价写不出来，不算
  if (cents === BigInt(0)) return null;
  return decToFixed({ int: cents, scale: 2 }, 2);
}

/* ───────────────────────────── 币种 ───────────────────────────── */

const CAD_RE = /(?:\bCAD\b|\bC\s?\$|\bCA\s?\$|\bCDN\s?\$|\bCDN\b|\$\s?CAN?\b|canadian\s+dollars?|dollars?\s+canadiens?)/i;
/** 别的币种（欧元、英镑等）：写了就不按网站推断成加元 / 美元 */
const OTHER_CURRENCY_RE = /€|£|¥|₹|\b(?:EUR|GBP|JPY|CNY|RMB|AUD|MXN|CHF|INR)\b|(?<![A-Za-z])AU?\$|\d\s*euros?\b|\beuros?\s*\d|人民币|欧元|英镑|日元/i;

/** 文字里写到别的币种（不是加元、美元） */
export function otherCurrencyMentioned(...texts: Array<string | null | undefined>): boolean {
  return OTHER_CURRENCY_RE.test(texts.map((t) => String(t ?? "")).join("\n").normalize("NFKC"));
}
const USD_RE = /(?:\bUSD\b|\bUS\s?\$|\bU\.S\.\s?\$|\bU\.S\.\s+dollars?|\bUS\s+dollars?|american\s+dollars?|\$\s?US\b|dollars?\s+am[ée]ricains?)/i;

/** 文字里写到的币种：只有一种 → 它；两种都有 → "both"；都没有 → null */
export function currencyMentionOf(...texts: Array<string | null | undefined>): "CAD" | "USD" | "both" | null {
  const s = texts.map((t) => String(t ?? "")).join("\n").normalize("NFKC");
  const cad = CAD_RE.test(s);
  const usd = USD_RE.test(s);
  if (cad && usd) return "both";
  return cad ? "CAD" : usd ? "USD" : null;
}

/** 文字里写明的币种：只有一种 → 它；两种都有或都没有 → null */
export function statedCurrencyOf(text: string | null | undefined): "CAD" | "USD" | null {
  const m = currencyMentionOf(text);
  return m === "both" ? null : m;
}

/** 按网站推断：.ca → CAD；.gov / .mil / .us → USD；其余 null */
export function siteCurrencyOf(url: string): "CAD" | "USD" | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return null;
  }
  if (host === "ca" || host.endsWith(".ca")) return "CAD";
  if (/(^|\.)(gov|mil|us)$/.test(host)) return "USD";
  return null;
}

/* ───────────────────────────── 口径 ───────────────────────────── */

export const SCOPE_BASIS_TAGS: readonly ScopeBasisTag[] = ["installation", "freight", "multi_year", "multi_item"];

export const SCOPE_BASIS_ZH: Record<ScopeBasisTag, string> = {
  installation: "含安装",
  freight: "含运费",
  multi_year: "多年期",
  multi_item: "多品项",
};
export const SCOPE_BASIS_UNCLEAR_ZH = "不明";

/**
 * 口径标签要在摘录里看得到的提示词（防模型乱贴标签；宁可少认）。多年期要写出年数、起止年份或 multi-year；
 * 多品项要写出复数的品项 / 批次或 various / assorted / multiple / several
 */
/** 交货时间的说法（跟在「送货」后面时不算含运费） */
const NOT_TIMING = "(?!\\s*(?:dates?|schedules?|timelines?|times?|periods?|windows?|deadlines?|within|by|before|no\\s+later|prévue|prévues|date|délai|calendrier|le|en|avant|d'ici)\\b)";
/** 写明不含运费的（「Freight not included」「delivery charges are extra」「hors livraison」「不含运费」）：含运费的提示词不作数 */
const FREIGHT_NEGATED_RE =
  /(?:freight|shipping|delivery|transport|livraison)[^.;\n]{0,30}?\b(?:not\s+included|not\s+incl\b|excluded|extra|additional|en\s+sus|non\s+compris(?:e|es)?|en\s+plus)|(?:excluding|excludes|exclusive\s+of|plus|hors|sans|not\s+including)\s+(?:the\s+)?(?:freight|shipping|delivery|transport|livraison)|不含运费|运费另计|不包括运费|运费另付/iu;

const BASIS_HINTS: Record<ScopeBasisTag, RegExp> = {
  installation: /install|montage|mise en place|安装/i,
  // 「delivered by March」「délai de livraison」只是交货时间，不算含运费；要写到运费、FOB / DDP、供货并送货（supply and
  // delivery / fourniture et livraison）、含送货（include(s) / including / inclusive of delivery、delivery included、
  // y compris la livraison、livraison comprise）、免费送货、送到某处（delivered to the site / warehouse）
  freight: new RegExp(
    [
      // 单写 transport 不算（「Transport Canada」是部门名）；要写运输费用
      "freight|shipping|shipped|transport(?:ation)?\\s+(?:costs?|charges?|fees?|included|incl)",
      "\\bf\\.?o\\.?b\\b|\\bd\\.?d\\.?p\\b|delivered\\s+duty\\s+paid|\\bFAB\\s+destination|franco\\s+(?:de\\s+port|destination)",
      // 后面跟着日期 / 时间表的不算（「Supply and delivery dates」「include delivery schedule」「avec livraison prévue」）
      `(?:supply|supplying)\\s*(?:,|and|&)\\s*(?:the\\s+)?deliver(?:y|ing)?\\b${NOT_TIMING}`,
      `(?:include[sd]?|including|inclusive\\s+of|incl\\.?|with)\\s+(?:the\\s+)?(?:delivery|shipping)\\b${NOT_TIMING}`,
      "deliver(?:y|ed)?(?:\\s+and\\s+installation)?\\s*(?:is\\s+|are\\s+|:\\s*)?(?:included|incl\\b|incl\\.|inclusive|cost|costs|charges?|fees?)(?!\\s+in\\s+(?:the\\s+)?(?:schedule|timeline|calendar))",
      "delivered\\s+to\\s+(?:the\\s+)?(?:[\\p{L}]+\\s+){0,2}(?:site|destination|warehouse|depot|facility|facilities|premises)",
      "free\\s+(?:delivery|shipping)",
      `fourniture\\s*(?:,|et)\\s*(?:la\\s+)?livraison${NOT_TIMING}`,
      `(?:y\\s+compris|incluant|avec)\\s+(?:la\\s+)?livraison${NOT_TIMING}`,
      "livraison(?:\\s+et\\s+installation)?\\s+(?:incluses?|comprises?|gratuite)",
      "frais\\s+de\\s+(?:livraison|transport)",
      "运费|运输|送货|配送(?!\\s*(?:时间|日期|期))",
    ].join("|"),
    "iu",
  ),
  // 年数至少 2（「1-year warranty」不算）；起止年份的写法另由 multiYearRangeOk 判（同一年不算）
  multi_year:
    /multi[\s-]?years?|(?<![\d.,])\b(?:[2-9]|[1-9]\d|two|three|four|five|six|seven|eight|nine|ten)(?:\s*\(\s*\d+\s*\))?[\s-]+years?\b|(?<![\d.,])\b(?:[2-9]|[1-9]\d)[\s-]*year\b|\bterm\s+of\s+(?:[2-9]|[1-9]\d)\b|(?<![\d.,])\b(?:2[4-9]|[3-9]\d|1\d{2})[\s-]*(?:months?|mois)\b|(?<![\d.,])\b(?:[2-9]|[1-9]\d)\s*ans\b|\b(?:deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s+ans\b|pluriannuel|\bpar\s+an\b|(?<![\d.])(?:[2-9]|[1-9]\d)\s*年|[两三四五六七八九十]\s*年|多年/i,
  multi_item: /\b(?:items|lots|articles)\b|\b(?:various|assorted|multiple|several)\b|多种|多项|多个品项|多个品种/i,
};

export function isScopeBasisTag(v: string): v is ScopeBasisTag {
  return (SCOPE_BASIS_TAGS as readonly string[]).includes(v);
}

/** 口径事实：值是四个标签之一，且摘录里有对应的提示词 */
/** 起止年份的写法（2022–2025、2022 to 2025）：两头年份不同才算多年期 */
const YEAR_RANGE_RE = /((?:19|20)\d{2})\s*年?\s*(?:[-–—~]|to|through|à|au|至|到)\s*((?:19|20)\d{2})/gi;
function multiYearRangeOk(text: string): boolean {
  for (const m of text.matchAll(YEAR_RANGE_RE)) if (m[1] !== m[2]) return true;
  return false;
}
/**
 * 多年期判断前先去掉不是合同期的年数：保修 / 质保年限（「2-year warranty」「garantie de 5 ans」「质保 3 年」）与财年
 * （「fiscal year 2024-2025」「exercice 2024-2025」——加拿大的财年本身就是一年）
 */
const WARRANTY_SPAN = "(?:\\d+|two|three|four|five|six|seven|eight|nine|ten)";
const WARRANTY_ADJ = "(?:manufacturer'?s?|manufacturer’s|limited|extended|full|standard|parts\\s+(?:and|&)\\s+labou?r|parts|labou?r|product|structural|frame|on-site)";
const NOT_CONTRACT_TERM_RE = new RegExp(
  [
    // 「N 年 / 月 + 保修」：中间只放过形容词一类的词（manufacturer's、limited、extended…），「3-year service and warranty
    // contract」「5-year maintenance and warranty agreement」这种合同期不去掉
    `\\b${WARRANTY_SPAN}[\\s-]*(?:years?|yrs?|months?)['’]?\\s+(?:${WARRANTY_ADJ}\\s+){0,2}(?:warrant(?:y|ies)|guarantee)\\b(?!\\s+(?:and|&|plus)\\b)`,
    `(?:warrant(?:y|ies)|guarantee)\\b\\s*(?:period\\s*)?(?:of|for|:)?\\s*${WARRANTY_SPAN}[\\s-]*(?:years?|months?)`,
    `garantie\\s+(?:de\\s+)?(?:\\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\\s+(?:ans|mois)`,
    `(?:\\d+|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\\s+(?:ans|mois)\\s+de\\s+garantie`,
    "(?:质保|保修)(?:期)?\\s*(?:为|是)?\\s*(?:\\d+|[两三四五六七八九十])\\s*(?:年|个月)",
    "(?:\\d+|[两三四五六七八九十])\\s*(?:年|个月)\\s*(?:质保|保修)",
    "(?:fiscal|financial)\\s+year\\s+(?:19|20)\\d{2}\\s*[-–—/]\\s*(?:(?:19|20)?\\d{2})",
    "(?:the\\s+)?(?:19|20)\\d{2}\\s*[-–—/]\\s*(?:(?:19|20)?\\d{2})\\s+(?:fiscal|financial)\\s+year",
    "\\bFY\\s*(?:19|20)?\\d{2}\\s*[-–—/]\\s*(?:(?:19|20)?\\d{2})",
    "exercice\\s+(?:financier\\s+)?(?:19|20)\\d{2}\\s*[-–—/]\\s*(?:(?:19|20)?\\d{2})",
  ].join("|"),
  "giu",
);

export function scopeBasisOk(tag: string, excerpt: string): boolean {
  if (!isScopeBasisTag(tag)) return false;
  const raw = String(excerpt ?? "").normalize("NFKC");
  if (tag === "freight" && FREIGHT_NEGATED_RE.test(raw)) return false;
  const text = tag === "multi_year" ? raw.replace(NOT_CONTRACT_TERM_RE, " ") : raw;
  return BASIS_HINTS[tag].test(text) || (tag === "multi_year" && multiYearRangeOk(text));
}

/* ───────────────────────────── 可比度 ───────────────────────────── */

const SPEC_STOPWORDS = new Set(
  [
    "supply", "supplies", "supplier", "deliver", "delivery", "provide", "provision", "service", "services", "purchase",
    "purchasing", "procurement", "procure", "contract", "contracts", "tender", "tenders", "rfp", "rfq", "rfi", "rfso",
    "rfsa", "itt", "itq", "request", "requests", "proposal", "proposals", "quotation", "quotations", "quote", "bid",
    "bids", "standing", "offer", "offers", "agreement", "the", "and", "for", "with", "from", "into", "city", "town",
    "county", "region", "regional", "municipality", "municipal", "government", "department", "ministry", "canada",
    "federal", "province", "provincial", "year", "years", "multi", "various", "new", "phase", "project", "program",
    "annual", "inclusive", "including", "install", "installation", "only", "all", "other", "per", "lot", "lots",
    "item", "items", "goods", "good", "product", "products", "equipment", "fourniture", "fournitures", "livraison", "services", "contrat", "appel", "offres", "des", "les",
    "pour", "avec", "une", "aux",
  ],
);

function singular(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:s|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** 规格关键词：字母词（≥3 字母，去通用词，复数归一）与连续 ≥2 个汉字；去重保序 */
export function specTokens(texts: ReadonlyArray<string | null | undefined>, max = Infinity): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    const s = String(t ?? "").normalize("NFKC").toLowerCase();
    for (const m of s.matchAll(/\p{Script=Han}{2,}|[\p{L}][\p{L}'’-]*/gu)) {
      let w = m[0].replace(/['’]/g, "");
      if (/\p{Script=Han}/u.test(w)) {
        if (w.length < 2) continue;
      } else {
        w = w.replace(/-+$/g, "");
        if (w.length < 3 || SPEC_STOPWORDS.has(w)) continue;
        w = singular(w);
        if (SPEC_STOPWORDS.has(w)) continue;
      }
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** 可比度的项目一侧 */
export type ComparabilityContext = {
  buyer: string | null;
  quantity: Dec | null;
  /** 参照年：截标年份，没有就今年 */
  refYear: number;
  /** 项目的规格关键词（最多 5 个） */
  specTokens: string[];
};

export const PROJECT_SPEC_TOKENS_MAX = 5;

export function comparabilityOf(
  rec: { buyer: string | null; quantity: Dec | null; year: number | null; specTexts: ReadonlyArray<string | null | undefined> },
  ctx: ComparabilityContext,
): AwardComparability {
  const sameBuyer: Tri =
    !rec.buyer || !ctx.buyer ? "unknown" : compareCompanyNames(rec.buyer, ctx.buyer).relation === "UNRELATED" ? "no" : "yes";

  const recTokens = new Set(specTokens(rec.specTexts));
  let sameSpec: Tri = "unknown";
  if (recTokens.size > 0 && ctx.specTokens.length > 0) {
    const proj = ctx.specTokens.slice(0, PROJECT_SPEC_TOKENS_MAX);
    const overlap = proj.filter((t) => recTokens.has(t)).length;
    sameSpec = overlap >= Math.max(1, Math.ceil(proj.length / 2)) ? "yes" : "no";
  }

  let quantityInRange: Tri = "unknown";
  if (rec.quantity && ctx.quantity && !decIsZero(ctx.quantity)) {
    // 0.5 ≤ q/p ≤ 2  ⇔  q ≥ p/2 且 q ≤ 2p（十进制比较，避免浮点边界误差）
    const ten = BigInt(10);
    const scale = Math.max(rec.quantity.scale, ctx.quantity.scale);
    const q = rec.quantity.int * ten ** BigInt(scale - rec.quantity.scale);
    const p = ctx.quantity.int * ten ** BigInt(scale - ctx.quantity.scale);
    quantityInRange = q * BigInt(2) >= p && q <= p * BigInt(2) ? "yes" : "no";
  }

  const recent: Tri = rec.year === null ? "unknown" : rec.year >= ctx.refYear - 3 && rec.year <= ctx.refYear + 1 ? "yes" : "no";

  const score = [sameBuyer, sameSpec, quantityInRange, recent].filter((x) => x === "yes").length;
  return { sameBuyer, sameSpec, quantityInRange, recent, score };
}

/* ───────────────────────────── 记录组装 ───────────────────────────── */

/** 事实类型 → 记录字段 */
export const FACT_TYPE_TO_FIELD: Readonly<Record<string, RecordFieldKey>> = Object.freeze({
  prior_tender: "priorTender",
  winner: "winner",
  buyer: "buyer",
  item: "item",
  award_amount: "amount",
  quantity: "quantity",
  award_year: "year",
  currency: "currency",
});

export type RecordKind = ResearchAwardRecordV1["kind"];

function recordIdOf(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

export type RecordDraft = {
  /** 记录号的组成（网页：来源 + 网址 + 组；联邦数据：来源 + 合同编号，没有编号用 中标方 | 金额 | 日期） */
  idParts: string[];
  kind: RecordKind;
  source: ResearchAwardRecordV1["source"];
  url: string;
  requestedUrl?: string;
  fetchedAt: string;
  referenceNumber: string | null;
  fields: Partial<Record<RecordFieldKey, AwardRecordField>>;
  basisEvidence: Array<{ tag: ScopeBasisTag; excerpt: string }>;
  datasetCurrency: "CAD" | null;
};

/** 由草稿算出解析值、币种、单价、可比度；不满足保留条件 → null */
export function finishRecord(d: RecordDraft, ctx: ComparabilityContext): ResearchAwardRecordV1 | null {
  const f = d.fields;
  const amount = parseAmountValue(f.amount?.value);
  const quantity = parseQuantityValue(f.quantity?.value);
  const year = parseYearValue(f.year?.value);
  const keep =
    d.kind === "prior_award" ? Boolean(f.winner || amount || f.priorTender) : Boolean(f.winner || amount);
  if (!keep) return null;

  // 币种：数据集口径 > 合同额的值与摘录里写明的（两种都写了 → 不明）> 币种事实（与合同额写明的冲突 → 不明）> 按网站推断
  let currency: "CAD" | "USD" | null = null;
  let currencyBasis: CurrencyBasis = "unknown";
  const fromFact = f.currency && (f.currency.value.trim().toUpperCase() === "CAD" || f.currency.value.trim().toUpperCase() === "USD")
    ? (f.currency.value.trim().toUpperCase() as "CAD" | "USD")
    : null;
  const onAmount = f.amount ? currencyMentionOf(f.amount.value, f.amount.excerpt) : null;
  // 币种事实在事实核对时只收 CAD / USD（别的币种进不来），所以这里只看合同额自己的值与摘录
  const otherStated = f.amount ? otherCurrencyMentioned(f.amount.value, f.amount.excerpt) : false;
  if (d.datasetCurrency) {
    currency = d.datasetCurrency;
    currencyBasis = "dataset";
  } else if (otherStated || onAmount === "both" || (onAmount && fromFact && onAmount !== fromFact)) {
    // 写的是别的币种、写明了两种、或两处写的不一样：不猜（不按网站推断）
  } else if (onAmount) {
    currency = onAmount;
    currencyBasis = "stated";
  } else if (fromFact) {
    currency = fromFact;
    currencyBasis = "stated";
  } else if (amount) {
    const site = siteCurrencyOf(d.url);
    if (site) {
      currency = site;
      currencyBasis = "site";
    }
  }

  const basis = [...new Set(d.basisEvidence.map((b) => b.tag))].sort(
    (a, b) => SCOPE_BASIS_TAGS.indexOf(a) - SCOPE_BASIS_TAGS.indexOf(b),
  );
  return {
    recordId: recordIdOf(d.idParts),
    kind: d.kind,
    source: d.source,
    url: d.url,
    ...(d.requestedUrl ? { requestedUrl: d.requestedUrl } : {}),
    fetchedAt: d.fetchedAt,
    referenceNumber: d.referenceNumber,
    fields: f,
    basisEvidence: d.basisEvidence.slice(0, 4),
    amount: amount ? decToFixed(amount, 2) : null,
    quantity: quantity ? decToFixed(quantity, Math.min(quantity.scale, 3)) : null,
    year,
    currency,
    currencyBasis,
    basis,
    unitPrice: unitPriceOf(amount, quantity),
    comparability: comparabilityOf(
      { buyer: f.buyer?.value ?? null, quantity, year, specTexts: [f.item?.value, f.priorTender?.value] },
      ctx,
    ),
  };
}

/** 页面上没写组名的这几类事实，作为同一页各组的缺省（一页一个采购方、一句「金额都是美元」很常见） */
const PAGE_LEVEL_FIELDS: readonly RecordFieldKey[] = ["buyer", "currency"];

/**
 * 网页上已核对的事实 → 授标记录：同一网址、同一组（组名；没给就按页）的事实成一条；每个字段取先出现的那条；口径收
 * 全部标签。同一页没写组名的采购方与币种，补到这一页写了组名、却缺这一项的记录上。保留条件：往期同标要有中标方、
 * 合同额或往期标名之一；同类要有合同额或中标方之一。
 */
export function assembleRecords(facts: ReadonlyArray<FoundFact>, kind: RecordKind, ctx: ComparabilityContext): ResearchAwardRecordV1[] {
  const drafts = new Map<string, RecordDraft>();
  for (const fact of facts) {
    const groupKey = (fact.group ?? "").trim().toLowerCase();
    const key = `${fact.url}\u0000${groupKey}`;
    let d = drafts.get(key);
    if (!d) {
      d = {
        idParts: ["web", fact.url, groupKey],
        kind,
        source: "web",
        url: fact.url,
        ...(fact.requestedUrl ? { requestedUrl: fact.requestedUrl } : {}),
        fetchedAt: fact.fetchedAt,
        referenceNumber: null,
        fields: {},
        basisEvidence: [],
        datasetCurrency: null,
      };
      drafts.set(key, d);
    }
    if (fact.factType === "scope_basis") {
      const tag = fact.value.trim().toLowerCase();
      if (isScopeBasisTag(tag) && !d.basisEvidence.some((b) => b.tag === tag)) d.basisEvidence.push({ tag, excerpt: fact.excerpt });
      continue;
    }
    const field = FACT_TYPE_TO_FIELD[fact.factType];
    if (field && !d.fields[field]) d.fields[field] = { value: fact.value, excerpt: fact.excerpt };
  }
  // 页级缺省：同一网址没写组名的那一组里的采购方、币种
  for (const d of drafts.values()) {
    if (d.idParts[2] === "") continue;
    const page = drafts.get(`${d.url}\u0000`);
    if (!page) continue;
    for (const k of PAGE_LEVEL_FIELDS) if (!d.fields[k] && page.fields[k]) d.fields[k] = page.fields[k];
  }
  const out: ResearchAwardRecordV1[] = [];
  for (const d of drafts.values()) {
    const r = finishRecord(d, ctx);
    if (r) out.push(r);
    if (out.length >= RESEARCH_TREE_LIMITS.MAX_RECORDS_PER_BRANCH) break;
  }
  return out;
}

/* ───────────────────────────── 联邦合同公开数据 ───────────────────────────── */

/** `canadabuys.ts` 的一行（只取本模块用到的字段） */
export type OpenDataRow = {
  vendorName: string;
  descriptionEn: string | null;
  contractValue: number | null;
  contractDate: string | null;
  buyerName: string | null;
  ownerOrg: string | null;
  referenceNumber: string | null;
  sourceUrl: string;
};

const clip = (s: string | null | undefined, n: number) => {
  const t = String(s ?? "").normalize("NFKC").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n).trim() : t;
};

/** 合同额（数据集里是数）→ 两位小数的写法；不是有限正数 → null */
export function openDataAmount(v: number | null): string | null {
  if (v === null || !Number.isFinite(v) || v <= 0 || v >= 1e13) return null;
  return v.toFixed(2);
}

/** 这一行与本项目是同一个采购方的那个名字（部门名优先、再看采购人名；三档不是「无关」）；本项目没有采购方 → 部门名 */
export function openDataMatchedBuyer(row: OpenDataRow, projectBuyer: string | null): string | null {
  const names = [row.ownerOrg, row.buyerName].filter((b): b is string => Boolean(b && b.trim()));
  if (!projectBuyer || !projectBuyer.trim()) return names[0] ?? "";
  return names.find((b) => compareCompanyNames(b, projectBuyer).relation !== "UNRELATED") ?? null;
}

/** 这一行的采购部门与本项目是不是同一个（本项目没有采购方 → 都算） */
export function openDataBuyerMatches(row: OpenDataRow, projectBuyer: string | null): boolean {
  return openDataMatchedBuyer(row, projectBuyer) !== null;
}

/**
 * 联邦数据的一行 → 往期同标记录。摘录是代码按原始字段拼的一行（中标方 · 合同额 CAD · 日期 · 采购部门 · 描述），
 * 每个字段的值都逐字在这一行里；币种按数据集口径记 CAD；记录号按合同编号（不含查询网址：两个检索词查到同一份合同
 * 是同一条）。
 */
export function openDataRecord(row: OpenDataRow, ctx: ComparabilityContext, fetchedAt: string): ResearchAwardRecordV1 | null {
  const vendor = clip(row.vendorName, 80);
  if (!vendor) return null;
  const amount = openDataAmount(row.contractValue);
  const date = clip(row.contractDate, 10);
  const buyer = clip(openDataMatchedBuyer(row, ctx.buyer) || row.ownerOrg || row.buyerName, 80);
  const ref = clip(row.referenceNumber, 60) || null;
  const head = [vendor, amount ? `${amount} CAD` : "", date, buyer].filter(Boolean).join(" · ");
  const room = RESEARCH_TREE_LIMITS.MAX_EXCERPT_CHARS - head.length - 3;
  const desc = room >= 12 ? clip(row.descriptionEn, room) : "";
  const line = desc ? `${head} · ${desc}` : head;
  const fields: Partial<Record<RecordFieldKey, AwardRecordField>> = { winner: { value: vendor, excerpt: line } };
  if (amount) fields.amount = { value: amount, excerpt: line };
  if (date && parseYearValue(date) !== null) fields.year = { value: date, excerpt: line };
  if (buyer) fields.buyer = { value: buyer, excerpt: line };
  if (desc) fields.item = { value: desc, excerpt: line };
  return finishRecord(
    {
      idParts: ["open_data", ref ? `ref:${ref.toLowerCase()}` : `${vendor.toLowerCase()}|${amount ?? ""}|${date}`],
      kind: "prior_award",
      source: "open_data",
      url: row.sourceUrl,
      fetchedAt,
      referenceNumber: ref,
      fields,
      basisEvidence: [],
      datasetCurrency: "CAD",
    },
    ctx,
  );
}

/**
 * 联邦数据：采购方与本项目同一、且规格不是明显不同（描述与项目的规格关键词对得上，或认不出关键词）的行，按日期从近到远
 * 转成记录，最多 N 条（按记录号去重）。同一部门不相干的合同（例如只用采购方名查到的 IT 咨询）不成记录，只交给模型看。
 */
export function openDataRecords(
  rows: ReadonlyArray<OpenDataRow>,
  ctx: ComparabilityContext,
  fetchedAt: string,
  max: number = RESEARCH_TREE_LIMITS.OPEN_DATA_RECORDS,
): ResearchAwardRecordV1[] {
  const matching = rows
    .filter((r) => openDataBuyerMatches(r, ctx.buyer))
    .slice()
    .sort((a, b) => String(b.contractDate ?? "").localeCompare(String(a.contractDate ?? "")));
  const out: ResearchAwardRecordV1[] = [];
  const seen = new Set<string>();
  for (const row of matching) {
    if (max <= 0) break;
    const r = openDataRecord(row, ctx, fetchedAt);
    if (!r || seen.has(r.recordId)) continue;
    if (r.comparability.sameSpec === "no") continue;
    seen.add(r.recordId);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/** 按当前的项目一侧重算一条记录的可比度（游标里存的记录在交单时重算，项目的数量后来补上了也算得上） */
export function refreshComparability(r: ResearchAwardRecordV1, ctx: ComparabilityContext): ResearchAwardRecordV1 {
  return {
    ...r,
    comparability: comparabilityOf(
      { buyer: r.fields.buyer?.value ?? null, quantity: decFromString(r.quantity), year: r.year, specTexts: [r.fields.item?.value, r.fields.priorTender?.value] },
      ctx,
    ),
  };
}

/** 两组记录合并去重（按记录号，先到的留下），截到每支上限 */
export function mergeRecords(...lists: ReadonlyArray<ReadonlyArray<ResearchAwardRecordV1>>): ResearchAwardRecordV1[] {
  const out: ResearchAwardRecordV1[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const r of list) {
      if (seen.has(r.recordId)) continue;
      seen.add(r.recordId);
      out.push(r);
      if (out.length >= RESEARCH_TREE_LIMITS.MAX_RECORDS_PER_BRANCH) return out;
    }
  }
  return out;
}

/** 可比度里「数量相近」与单价用到的项目数量（十进制）；不是有限正数 → null */
export function projectQuantityDec(n: number | null | undefined): Dec | null {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0 || n >= 1e13) return null;
  return decFromString(String(Math.round(n * 1000) / 1000).replace(/e.*$/, ""));
}

export const __decToNumberForTest = decToNumber;
