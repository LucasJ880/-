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

export function numberTokens(text: string): Array<{ dec: Dec; end: number }> {
  const s = normNum(text);
  const re =
    /(?<![\d.,])(?:(\d{1,3}(?:[   .]\d{3})+),(\d{1,2})(?![\d])|(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?|(\d{1,3}(?:[   ]\d{3})+)(?:\.(\d+))?|(\d+)(?:\.(\d+))?)(?![\d])/g;
  const out: Array<{ dec: Dec; end: number }> = [];
  for (const m of s.matchAll(re)) {
    let dec: Dec | null = null;
    if (m[1] !== undefined) dec = decOf(m[1].replace(/[   .]/g, ""), m[2] ?? "");
    else if (m[3] !== undefined) dec = decOf(m[3].replace(/,/g, ""), m[4] ?? "");
    else if (m[5] !== undefined) dec = decOf(m[5].replace(/[   ]/g, ""), m[6] ?? "");
    else if (m[7] !== undefined) dec = decOf(m[7], m[8] ?? "");
    if (dec) out.push({ dec, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

const MULTIPLIER_AFTER =
  /^\s*(?:(k|thousand|thousands)\b|(m|mm|mil|million|millions)\b|(b|bn|billion|billions)\b|(万)|(亿))/i;

function withMultiplier(text: string, tok: { dec: Dec; end: number }): Dec {
  const rest = normNum(text).slice(tok.end);
  const m = MULTIPLIER_AFTER.exec(rest);
  if (!m) return tok.dec;
  const ten = BigInt(10);
  if (m[1]) return decMul(tok.dec, ten ** BigInt(3));
  if (m[2]) return decMul(tok.dec, ten ** BigInt(6));
  if (m[3]) return decMul(tok.dec, ten ** BigInt(9));
  if (m[4]) return decMul(tok.dec, ten ** BigInt(4));
  return decMul(tok.dec, ten ** BigInt(8));
}

/** 合同额的值 → 十进制（只有一个数才认；区间、两个数、0 → null）。货币符号与币种字母不影响 */
export function parseAmountValue(value: string | null | undefined): Dec | null {
  if (!value) return null;
  const toks = numberTokens(value);
  if (toks.length !== 1) return null;
  const d = withMultiplier(value, toks[0]);
  return decIsZero(d) ? null : d;
}

/** 数量的值 → 十进制（只有一个数才认；认 k / thousand；0 → null） */
export function parseQuantityValue(value: string | null | undefined): Dec | null {
  if (!value) return null;
  const toks = numberTokens(value);
  if (toks.length !== 1) return null;
  const rest = normNum(value).slice(toks[0].end);
  const d = /^\s*(?:k|thousand|thousands)\b/i.test(rest) ? decMul(toks[0].dec, BigInt(1000)) : toks[0].dec;
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
  return decToFixed({ int: cents, scale: 2 }, 2);
}

/* ───────────────────────────── 币种 ───────────────────────────── */

const CAD_RE = /(?:\bCAD\b|\bC\s?\$|\bCA\s?\$|\bCDN\s?\$|\bCDN\b|canadian\s+dollars?|dollars?\s+canadiens?)/i;
const USD_RE = /(?:\bUSD\b|\bUS\s?\$|\bU\.S\.\s?\$|\bU\.S\.\s+dollars?|\bUS\s+dollars?|american\s+dollars?)/i;

/** 文字里写明的币种：只有一种 → 它；两种都有或都没有 → null */
export function statedCurrencyOf(text: string | null | undefined): "CAD" | "USD" | null {
  const s = String(text ?? "").normalize("NFKC");
  const cad = CAD_RE.test(s);
  const usd = USD_RE.test(s);
  if (cad === usd) return null;
  return cad ? "CAD" : "USD";
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

/** 口径标签要在摘录里看得到的提示词（防模型乱贴标签） */
const BASIS_HINTS: Record<ScopeBasisTag, RegExp> = {
  installation: /install|montage|mise en place|安装/i,
  freight: /freight|deliver|shipping|shipped|transport|f\.?o\.?b|d\.?d\.?p|livraison|运费|运输|送货/i,
  multi_year: /\byears?\b|multi[\s-]?year|\bterm\b|\bannual|(?:19|20)\d{2}\s*[-–—~]\s*(?:19|20)\d{2}|\bans?\b|pluriannuel|年/i,
  multi_item: /\bitems?\b|\blots?\b|various|assorted|multiple|\bincluding\b|articles|多种|多项|品项/i,
};

export function isScopeBasisTag(v: string): v is ScopeBasisTag {
  return (SCOPE_BASIS_TAGS as readonly string[]).includes(v);
}

/** 口径事实：值是四个标签之一，且摘录里有对应的提示词 */
export function scopeBasisOk(tag: string, excerpt: string): boolean {
  return isScopeBasisTag(tag) && BASIS_HINTS[tag].test(String(excerpt ?? "").normalize("NFKC"));
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
    "item", "items", "fourniture", "fournitures", "livraison", "services", "contrat", "appel", "offres", "des", "les",
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
  kind: RecordKind;
  source: ResearchAwardRecordV1["source"];
  url: string;
  requestedUrl?: string;
  fetchedAt: string;
  groupKey: string;
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

  let currency: "CAD" | "USD" | null = null;
  let currencyBasis: CurrencyBasis = "unknown";
  const fromFact = f.currency ? f.currency.value.trim().toUpperCase() : null;
  const statedFromAmount = f.amount ? statedCurrencyOf(f.amount.value) ?? statedCurrencyOf(f.amount.excerpt) : null;
  if (d.datasetCurrency) {
    currency = d.datasetCurrency;
    currencyBasis = "dataset";
  } else if (fromFact === "CAD" || fromFact === "USD") {
    currency = fromFact;
    currencyBasis = "stated";
  } else if (statedFromAmount) {
    currency = statedFromAmount;
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
    recordId: recordIdOf([d.source, d.url, d.groupKey]),
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

/**
 * 网页上已核对的事实 → 授标记录：同一网址、同一组（模型给的组名；没给就按页）的事实成一条；每个字段取先出现的
 * 那条；口径收全部标签。保留条件：往期同标要有中标方、合同额或往期标名之一；同类要有合同额或中标方之一。
 */
export function assembleRecords(facts: ReadonlyArray<FoundFact>, kind: RecordKind, ctx: ComparabilityContext): ResearchAwardRecordV1[] {
  const drafts = new Map<string, RecordDraft>();
  for (const fact of facts) {
    const groupKey = (fact.group ?? "").trim().toLowerCase();
    const key = `${fact.url}\u0000${groupKey}`;
    let d = drafts.get(key);
    if (!d) {
      d = {
        kind,
        source: "web",
        url: fact.url,
        ...(fact.requestedUrl ? { requestedUrl: fact.requestedUrl } : {}),
        fetchedAt: fact.fetchedAt,
        groupKey,
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

/** 这一行的采购部门与本项目是不是同一个（三档不是「无关」；本项目没有采购方 → 都算） */
export function openDataBuyerMatches(row: OpenDataRow, projectBuyer: string | null): boolean {
  if (!projectBuyer || !projectBuyer.trim()) return true;
  return [row.ownerOrg, row.buyerName].some((b) => b && compareCompanyNames(b, projectBuyer).relation !== "UNRELATED");
}

/**
 * 联邦数据的一行 → 往期同标记录。摘录是代码按原始字段拼的一行（中标方 · 合同额 CAD · 日期 · 采购部门 · 描述），
 * 每个字段的值都逐字在这一行里；币种按数据集口径记 CAD。
 */
export function openDataRecord(row: OpenDataRow, ctx: ComparabilityContext, fetchedAt: string): ResearchAwardRecordV1 | null {
  const vendor = clip(row.vendorName, 80);
  if (!vendor) return null;
  const amount = openDataAmount(row.contractValue);
  const date = clip(row.contractDate, 10);
  const buyer = clip(row.ownerOrg ?? row.buyerName, 80);
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
      kind: "prior_award",
      source: "open_data",
      url: row.sourceUrl,
      fetchedAt,
      groupKey: ref ?? `${vendor}|${amount ?? ""}|${date}`,
      referenceNumber: ref,
      fields,
      basisEvidence: [],
      datasetCurrency: "CAD",
    },
    ctx,
  );
}

/** 联邦数据：同一采购方的行按日期从近到远取前 N 条转成记录（按合同编号 / 中标方 + 金额 + 日期去重） */
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
    const r = openDataRecord(row, ctx, fetchedAt);
    if (!r || seen.has(r.recordId)) continue;
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
