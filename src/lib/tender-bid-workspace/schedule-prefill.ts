/**
 * FIX-2 价格表从招标分析带入 — 纯函数（零依赖，前后端共用）
 *
 * 招标分析（V2）抽出的要求与数量类事实本来带着数量和单位；这里负责三件事：
 *   1. 入库时把它们收成「数量线索」（分析给出的文字原样保存，不改写、不换算）；
 *   2. 读存下的线索（认版本；认出「这份分析是在本功能之前做的」）；
 *   3. 带入时用确定性的规则把线索变成价格表粘贴框认得的行。
 *
 * 看不准的不猜。数量只在「就是一个数字」时才取——前面可以有「约」「approx.」这类词，后面可以跟一个认得的单位，
 * 别的一概不取并说明原因（范围、不止一个数字、金额、带着别的说明、写法有歧义、单位是时间）。
 * 分析发现两处说法不一致还没定的，不带入。单位认不出就原样保留，交给既有的校验去报告。重复的行不合并，只标出来。
 *
 * 带入只是省去转录——生成的文本进粘贴框，由人核对后走既有的保存。这里不调模型，也不写任何东西。
 */

export const SCHEDULE_CANDIDATES_VERSION = 1 as const;
/** 一份分析最多存这么多条线索（防止异常的抽取结果把 JSON 撑大）；超出的不存，但记下原本有多少条 */
export const SCHEDULE_CANDIDATES_MAX = 300;
/** 与价格表行的说明上限一致（工作区保存接口：500） */
const DESCRIPTION_MAX = 500;
/** 分析结果里数量 / 事实原文值的上限是 120 / 300；这里不比它短，避免把一段话截成「看起来只有一个数字」 */
const QUANTITY_TEXT_MAX = 300;
const UNIT_TEXT_MAX = 60;
const SOURCE_MAX = 200;
/** 价格表行的单位上限（工作区保存接口：20） */
const UOM_MAX = 20;

export type ScheduleCandidate = {
  /** 来自一条要求，还是一条数量类事实 */
  source: "requirement" | "fact";
  /** 要求编号（事实为 null）；读取时用它核对这条要求有没有被人驳回 */
  code: string | null;
  description: string;
  /** 分析给出的数量文字（可能是「2,367」「approx. 120 per year」「100-200」「as required」） */
  quantityText: string | null;
  /** 分析给出的单位文字 */
  unitText: string | null;
  page: number | null;
  /** 出处的可读写法：文件名 · 位置（PDF 是「第 N 页」；表格等是它自己的定位） */
  sourceZh: string | null;
  /** 分析发现它与别处说法不一致、还没有定：两边都留着，带入时都不成为行 */
  inConflict: boolean;
};

export type ScheduleCandidatesBlock = {
  version: typeof SCHEDULE_CANDIDATES_VERSION;
  /** 分析里一共有多少条线索（大于 items.length 时说明只存了前面的） */
  total: number;
  items: ScheduleCandidate[];
};

/** 控制字符、零宽字符与任何空白都并成一个空格（制表符与换行会把粘贴的一行拆开；NUL 进不了 JSON 列） */
export const squashText = (s: unknown): string => (typeof s === "string" ? s.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim() : "");
const squash = squashText;
/** 超长时截断并以「…」结尾——让人看得出被截过，也让截断后的文字不会被当成一个完整的数量 */
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const oneLine = (s: unknown, max: number): string => clip(squash(s), max);
const orNull = (s: string): string | null => (s.length > 0 ? s : null);

/* ---------------------------------- 1. 入库：收集数量线索 ---------------------------------- */

type EvidenceLike = { documentId?: string | null; pageNumber?: number | null; snippet?: string | null };
type RequirementLike = {
  id: string;
  category?: string | null;
  statement: string;
  object?: string | null;
  quantity?: string | null;
  unit?: string | null;
  status: string;
  evidence?: ReadonlyArray<EvidenceLike>;
};
type FactLike = {
  id?: string;
  factType: string;
  claim: string;
  rawValue?: string | null;
  status: string;
  evidence?: ReadonlyArray<EvidenceLike>;
};
type ConflictLike = { itemIds?: ReadonlyArray<string>; resolution?: string };
export type CollectInput = {
  requirements: ReadonlyArray<RequirementLike>;
  facts: ReadonlyArray<FactLike>;
  conflicts?: ReadonlyArray<ConflictLike>;
  manifest?: { documents?: ReadonlyArray<{ documentId: string; name?: string | null }> };
};
export type CollectOptions = { unitLabelOf?: (documentId: string, pageNumber: number | null) => string | null };

/**
 * 这些类别的要求说的不是价格表的行（「投标书 3 份」「质保 5 年」「保险 500 万」「样品 2 件」「培训 2 场」），不作为线索。
 * 其余类别（产品、技术、安装、交付、价格、商务、性能、强制、其他）照收。
 */
export const NON_LINE_CATEGORIES: ReadonlySet<string> = new Set([
  "ADMINISTRATIVE", "SUBMISSION", "WARRANTY", "BONDING", "INSURANCE", "SAFETY",
  "SAMPLES", "SHOP_DRAWINGS", "TRAINING", "SITE_VISIT", "SCHEDULE", "REPORTING",
]);

const validPage = (p: unknown): number | null => (typeof p === "number" && Number.isInteger(p) && p > 0 ? p : null);

/**
 * 一条要求可能由几处合并而来、带着几处出处，而数量只取自其中一处。
 * 出处选「原文片段里出现了这个数字」的那一处；都对不上才用第一处。
 */
function pickEvidence(evidence: ReadonlyArray<EvidenceLike> | undefined, quantityText: string | null): EvidenceLike | null {
  if (!evidence || evidence.length === 0) return null;
  // 比的时候两边都去掉千位逗号；数字前后不能再连着数字（「100」对不上「1,100」）
  const tokens = ((quantityText ?? "").match(/\d[\d,.]*\d|\d/g) ?? []).map((t) => t.replace(/,/g, "").replace(/\.$/, ""));
  if (tokens.length > 0) {
    const patterns = tokens.map((t) => new RegExp(`(?<![\\d.])${t.replace(/\./g, "\\.")}(?!\\.?\\d)`));
    for (const e of evidence) {
      const snippet = (typeof e.snippet === "string" ? e.snippet : "").replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
      if (patterns.some((re) => re.test(snippet))) return e;
    }
  }
  return evidence[0];
}

/**
 * 从一次分析的结果里收集数量线索：带数量或单位的有效要求（类别是价格表可能有的）、带原文值的数量类事实。
 * 被取代的不收。与别处说法不一致、还没有定的照收并标明（带入时不成为行）。
 * 文字原样保存（只把换行、控制字符与多余空白并成一个空格）。
 */
export function collectScheduleCandidates(result: CollectInput, opts: CollectOptions = {}): ScheduleCandidatesBlock {
  const docName = new Map<string, string>();
  for (const d of result.manifest?.documents ?? []) if (d && typeof d.documentId === "string") docName.set(d.documentId, squash(d.name));
  const unresolved = new Set<string>();
  for (const c of result.conflicts ?? []) if (c?.resolution === "UNRESOLVED") for (const id of c.itemIds ?? []) unresolved.add(id);

  const locate = (evidence: ReadonlyArray<EvidenceLike> | undefined, quantityText: string | null): { page: number | null; sourceZh: string | null } => {
    const e = pickEvidence(evidence, quantityText);
    const page = validPage(e?.pageNumber);
    const documentId = typeof e?.documentId === "string" ? e.documentId : null;
    // 表格等非 PDF 的来源有自己的定位写法；没有才说「第 N 页」
    const label = (documentId ? squash(opts.unitLabelOf?.(documentId, page)) : "") || (page ? `第 ${page} 页` : "");
    const name = documentId ? (docName.get(documentId) ?? "") : "";
    return { page, sourceZh: orNull(clip([name, label].filter(Boolean).join(" · "), SOURCE_MAX)) };
  };

  const items: ScheduleCandidate[] = [];
  for (const r of result.requirements) {
    // 实际的分析流程里，要求的「待复核」只出现在一种情况：它与另一条说法不一致、还没有定
    if (r.status !== "ACTIVE" && r.status !== "NEEDS_REVIEW") continue;
    if (typeof r.category === "string" && NON_LINE_CATEGORIES.has(r.category.toUpperCase())) continue;
    const quantityText = orNull(oneLine(r.quantity, QUANTITY_TEXT_MAX));
    const unitText = orNull(oneLine(r.unit, UNIT_TEXT_MAX));
    if (!quantityText && !unitText) continue;
    // 说明：优先用抽取结果里的「对象」（如 Twin Mattress Cover），没有才用整句
    const description = oneLine(r.object, DESCRIPTION_MAX) || oneLine(r.statement, DESCRIPTION_MAX);
    if (!description) continue;
    items.push({ source: "requirement", code: r.id, description, quantityText, unitText, ...locate(r.evidence, quantityText), inConflict: r.status === "NEEDS_REVIEW" || unresolved.has(r.id) });
  }
  for (const f of result.facts) {
    if (f.factType !== "quantity" || (f.status !== "ACTIVE" && f.status !== "CONFLICT")) continue;
    const description = oneLine(f.claim, DESCRIPTION_MAX);
    if (!description) continue;
    // 数量只认事实的原文值；没有原文值时不拿整句说法去找数字（说明里照样看得到这句话）
    const quantityText = orNull(oneLine(f.rawValue, QUANTITY_TEXT_MAX));
    items.push({ source: "fact", code: null, description, quantityText, unitText: null, ...locate(f.evidence, quantityText), inConflict: f.status === "CONFLICT" || (typeof f.id === "string" && unresolved.has(f.id)) });
  }
  return { version: SCHEDULE_CANDIDATES_VERSION, total: items.length, items: items.slice(0, SCHEDULE_CANDIDATES_MAX) };
}

/* ---------------------------------- 2. 读存下的线索 ---------------------------------- */

export type StoredScheduleCandidates =
  /** 这一节的结构化字段里没有数量线索：分析是在本功能之前做的，或用的是旧版分析（或形状 / 版本不认识） */
  | { state: "absent" }
  | { state: "present"; items: ScheduleCandidate[]; total: number };

/** 读「价格与评标」一节的结构化字段。认不出的一律当作没有——不猜旧数据的形状。 */
export function readScheduleCandidates(structuredJson: unknown): StoredScheduleCandidates {
  if (!structuredJson || typeof structuredJson !== "object" || Array.isArray(structuredJson)) return { state: "absent" };
  const block = (structuredJson as { scheduleCandidates?: unknown }).scheduleCandidates;
  if (!block || typeof block !== "object" || Array.isArray(block)) return { state: "absent" };
  const b = block as { version?: unknown; items?: unknown; total?: unknown };
  if (b.version !== SCHEDULE_CANDIDATES_VERSION || !Array.isArray(b.items)) return { state: "absent" };
  const items: ScheduleCandidate[] = [];
  for (const raw of b.items.slice(0, SCHEDULE_CANDIDATES_MAX)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const description = oneLine(o.description, DESCRIPTION_MAX);
    if (!description) continue;
    items.push({
      source: o.source === "fact" ? "fact" : "requirement",
      code: typeof o.code === "string" && o.code.length > 0 && o.code.length <= 64 ? o.code : null,
      description,
      quantityText: orNull(oneLine(o.quantityText, QUANTITY_TEXT_MAX)),
      unitText: orNull(oneLine(o.unitText, UNIT_TEXT_MAX)),
      page: validPage(o.page),
      sourceZh: orNull(oneLine(o.sourceZh, SOURCE_MAX)),
      // 读不出「没有冲突」就当作有：宁可不带入
      inConflict: o.inConflict !== false,
    });
  }
  const total = typeof b.total === "number" && Number.isInteger(b.total) && b.total > items.length ? b.total : items.length;
  return { state: "present", items, total };
}

/* ---------------------------------- 3. 带入：线索 → 价格表的行 ---------------------------------- */

/** 单位对照（不分大小写、去掉末尾的句点）→ 价格表的单位目录。对照表里没有的原样保留，由既有的校验去报告 */
const UOM_ALIASES: Record<string, string> = {
  ea: "Each", each: "Each", pc: "Each", pcs: "Each", piece: "Each", pieces: "Each", unit: "Each", units: "Each",
  pk: "Pack", pack: "Pack", packs: "Pack", pkg: "Pack", package: "Pack", packages: "Pack",
  bx: "Box", box: "Box", boxes: "Box",
  rl: "Roll", roll: "Roll", rolls: "Roll",
  pr: "Pair", pair: "Pair", pairs: "Pair",
  set: "Set", sets: "Set",
  cs: "Case", case: "Case", cases: "Case",
  bag: "Bag", bags: "Bag",
  kg: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg",
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  ft: "ft", foot: "ft", feet: "ft",
  sqft: "sqft", "sq ft": "sqft", "sq. ft": "sqft", sf: "sqft", "square feet": "sqft", "square foot": "sqft",
  个: "Each", 件: "Each", 只: "Each", 套: "Set", 卷: "Roll", 双: "Pair", 袋: "Bag", 包: "Pack", 公斤: "kg", 千克: "kg", 米: "m",
};

/**
 * 单位规整。认不出的原样返回（不猜）。
 * 单独一个大写的「M」不规整成米——它在北美采购里也表示「每千件」。
 */
export function normalizeUomText(text: string | null | undefined): string {
  const raw = squash(text);
  if (!raw || raw === "M") return raw;
  const key = raw.toLowerCase().replace(/\.+$/, "").replace(/\s+/g, " ");
  return UOM_ALIASES[key] ?? raw;
}

/** 时间单位：价格表的数量不是「几年」「几天」（质保期、交付期、有效期常被抽成数量） */
const TIME_UNIT = /^(?:years?|yrs?|months?|mos?|weeks?|wks?|days?|hours?|hrs?|minutes?|mins?|business days?|working days?|calendar days?|年|个月|月|周|星期|天|日|工作日|小时|分钟)$/i;
/** 连续量的单位：这类数量常带小数，「2,500 kg」里的逗号可能是小数点（法语写法），也可能是千位 */
const MEASURE_UNIT = /^(?:kg|kgs|g|grams?|lbs?|pounds?|oz|ounces?|t|tons?|tonnes?|m|meters?|metres?|cm|mm|km|ft|foot|feet|in|inch|inches|yd|yds|yards?|lf|l|litres?|liters?|ml|gal|gallons?|sqft|sq\.? ?ft|sf|sq\.? ?m|m2|m²|m3|m³|square (?:feet|foot|met(?:er|re)s?)|公斤|千克|克|吨|米|厘米|毫米|升|毫升|平方米|立方米)$/i;

export type QuantityParse =
  | { ok: true; quantity: string; /** 数量文字里跟着的单位（如「2,367 each」里的 each）；没有为 null */ unitInText: string | null }
  | { ok: false; reason: QuantitySkipReason };
export type QuantitySkipReason = "missing" | "no_number" | "money" | "range" | "multiple" | "unclear" | "ambiguous" | "time" | "zero";

const MONEY = /[$€£¥￥]|\b(?:cad|usd|eur|gbp|rmb|cny|dollars?|cents?|euros?)\b|%|\bpercent\b|元|美元|加元|百分/i;
const RANGE = /\d\s*(?:-|–|—|~|to|through|thru|至|到)\s*\d|\bbetween\b[^.]*\band\b/i;
/** 数量前面允许出现的词：只表示「大约」或「数量」，不改变数字本身 */
const PREFIX = /^(?:(?:approximately|approx\.?|about|around|circa|estimated|est\.?|qty\.?|quantity|total of|total|约|大约|共计|共|合计|数量)\s*[:：]?\s*|[~≈]\s*)?/i;
/** 一个数字：整数（可带千位逗号）加可选的小数。前后不许再有数字、小数点或字母 */
const NUMBER = /^(\d{1,3}(?:,\d{3})+|\d{1,9})(\.\d{1,6})?(?![\d.,])/;

/**
 * 数量：整段文字「就是一个数字」才取——前面可以有「约 / approx.」这类词，后面可以跟一个单位。
 * 别的一概不取：没有数字、范围、不止一个数字、金额或百分比、带着别的说明（「per year」「minimum」「Item 3」「5k」「12 dozen」）、
 * 写法有歧义（「1.500」「0,500」「2,500 kg」可能是小数也可能是千位）、单位是时间。
 * `unitText` 是分析另外给出的单位（用来判断时间单位与连续量）。
 */
export function parseQuantityText(text: string | null | undefined, unitText: string | null | undefined = null): QuantityParse {
  const raw = squash(text);
  if (!raw) return { ok: false, reason: "missing" };
  if (!/\d/.test(raw)) return { ok: false, reason: "no_number" };
  if (MONEY.test(raw)) return { ok: false, reason: "money" };

  // 去掉前面的「约 / approx.」与句末的句号，剩下的必须是：一个数字，后面空着或跟一个单位
  const body = raw.slice(raw.match(PREFIX)?.[0].length ?? 0).replace(/\s*[.。]$/, "");
  const num = body.match(NUMBER);
  const after = num ? body.slice(num[0].length) : "";
  const tail = after.trim();
  const tailIsUnit =
    tail === "" ||
    // 英文单位要与数字隔一个空格（「5k」「40ft」「3M」不算）；只含字母、句点与空格
    (/^\s/.test(after) && /^\p{L}[\p{L}. ]{0,29}$/u.test(tail)) ||
    // 中文单位可以紧跟数字（「500件」）
    /^[\u4e00-\u9fff]{1,4}$/.test(tail);
  if (!num || !tailIsUnit) {
    if (RANGE.test(raw)) return { ok: false, reason: "range" };
    // 数一数有几个数字（千位逗号先并掉）
    const runs = raw.replace(/(\d),(?=\d{3}(?!\d))/g, "$1").match(/\d+(?:\.\d+)?/g) ?? [];
    return { ok: false, reason: runs.length > 1 ? "multiple" : "unclear" };
  }

  const unitInText = tail || null;
  const unitFromField = squash(unitText) || null;
  // 数量后面跟着的词必须是一个认得的单位，或者就是分析给出的那个单位；否则它是别的说明（「dozen」「thousand」「sites」）
  if (unitInText) {
    const known = normalizeUomText(unitInText) !== unitInText || Object.values(UOM_ALIASES).includes(unitInText) || TIME_UNIT.test(unitInText) || MEASURE_UNIT.test(unitInText);
    const sameAsField = !!unitFromField && normalizeUomText(unitFromField).toLowerCase() === normalizeUomText(unitInText).toLowerCase();
    if (!known && !sameAsField) return { ok: false, reason: "unclear" };
  }
  const units = [unitInText, unitFromField].filter((u): u is string => !!u);
  if (units.some((u) => TIME_UNIT.test(u))) return { ok: false, reason: "time" };

  const [, intPart, fracPart = ""] = num;
  const grouped = intPart.includes(",");
  const digits = intPart.replace(/,/g, "");
  // 前导零（0500、0,500）、恰好三位小数且没有千位逗号（1.500：可能是欧式的一千五）→ 有歧义
  if (digits.length > 1 && digits.startsWith("0")) return { ok: false, reason: "ambiguous" };
  if (!grouped && digits !== "0" && fracPart.length === 4) return { ok: false, reason: "ambiguous" };
  // 「2,500 kg」：只有一组千位、单位又是连续量——逗号可能是小数点
  if (grouped && /^\d{1,3},\d{3}$/.test(intPart) && !fracPart && units.some((u) => MEASURE_UNIT.test(u))) return { ok: false, reason: "ambiguous" };
  const quantity = `${digits}${fracPart}`;
  if (Number(quantity) === 0) return { ok: false, reason: "zero" };
  return { ok: true, quantity, unitInText };
}

export const QUANTITY_SKIP_REASON_ZH: Record<QuantitySkipReason, string> = {
  missing: "分析没有给出数量",
  no_number: "数量里没有数字",
  money: "是金额或百分比，不是数量",
  range: "数量是一个范围",
  multiple: "数量里有不止一个数字",
  unclear: "数量里除了数字还有别的说明，取不准",
  ambiguous: "数字的写法有歧义（可能是小数，也可能是千位）",
  time: "单位是时间，不是价格表的数量",
  zero: "数量是 0",
};
const CONFLICT_REASON_ZH = "分析发现这里有两处说法不一致，还没有定";
const UNIT_MISMATCH_REASON_ZH = "数量里写的单位与分析给出的单位不一致";

export type PrefillRow = {
  lineNo: number;
  description: string;
  quantity: string;
  uom: string;
  /** 供人核对：分析给出的数量、单位文字，出处 */
  quantityText: string;
  unitText: string | null;
  page: number | null;
  sourceZh: string | null;
  source: ScheduleCandidate["source"];
  /** 说明、数量、单位都与前面某一行相同时，那一行的行号（可能是重复，也可能确实是两行——不替人合并） */
  sameAsLine: number | null;
};
export type PrefillSkipped = { description: string; quantityText: string | null; unitText: string | null; page: number | null; sourceZh: string | null; reasonZh: string };
export type SchedulePrefill = {
  /** 粘贴框认得的文本：每行「行号 ⇥ 说明 ⇥ 数量 ⇥ 单位」 */
  text: string;
  rows: PrefillRow[];
  skipped: PrefillSkipped[];
  /** 分析里的线索多于存下的条数时，原本一共有多少条；没有超出为 null */
  truncatedFrom: number | null;
};

/** 价格表一次最多的行数（与工作区保存接口的上限 MAX_SCHEDULE_LINES 一致；测试里核对两者相等） */
export const PREFILL_MAX_ROWS = 300;

/** 粘贴解析会把首尾成对的双引号当作表格软件的引用去掉、把两个连着的双引号并成一个；带双引号的单元格按同样的写法引用，读回来才是原样 */
const pasteCell = (s: string): string => (s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * 把数量线索变成价格表的行。行号从 1 连续编号；尺寸、包装数、认证要求几列留空（分析结果里没有可靠的对应字段）。
 * 说明、数量、单位都相同的行不合并，只标出与哪一行相同。
 */
export function buildSchedulePrefill(items: ReadonlyArray<ScheduleCandidate>, opts: { maxRows?: number; total?: number } = {}): SchedulePrefill {
  const maxRows = opts.maxRows ?? PREFILL_MAX_ROWS;
  const rows: PrefillRow[] = [];
  const skipped: PrefillSkipped[] = [];
  const firstLineOf = new Map<string, number>();
  for (const it of items) {
    const description = oneLine(it.description, DESCRIPTION_MAX);
    if (!description) continue;
    const skip = (reasonZh: string) => skipped.push({ description, quantityText: it.quantityText, unitText: it.unitText, page: it.page, sourceZh: it.sourceZh, reasonZh });
    if (it.inConflict) { skip(CONFLICT_REASON_ZH); continue; }
    const q = parseQuantityText(it.quantityText, it.unitText);
    if (!q.ok) { skip(QUANTITY_SKIP_REASON_ZH[q.reason]); continue; }
    // 单位：分析给出的那个；没有就用数量文字里跟着的；两处都有且不一样 → 不带入
    const fromField = normalizeUomText(it.unitText);
    const fromText = normalizeUomText(q.unitInText);
    if (fromField && fromText && fromField.toLowerCase() !== fromText.toLowerCase()) { skip(UNIT_MISMATCH_REASON_ZH); continue; }
    const candidateUom = fromField || fromText;
    // 比价格表的单位上限还长的不是一个单位（多半是一句话）：留空，由人填；原文在旁边
    const uom = candidateUom.length > UOM_MAX ? "" : candidateUom;
    if (rows.length >= maxRows) { skip(`超过一次最多 ${maxRows} 行`); continue; }
    const key = `${description.toLowerCase()}\u0001${q.quantity}\u0001${uom.toLowerCase()}`;
    const lineNo = rows.length + 1;
    const sameAsLine = firstLineOf.get(key) ?? null;
    if (sameAsLine === null) firstLineOf.set(key, lineNo);
    rows.push({ lineNo, description, quantity: q.quantity, uom, quantityText: it.quantityText ?? "", unitText: it.unitText, page: it.page, sourceZh: it.sourceZh, source: it.source, sameAsLine });
  }
  const total = opts.total ?? items.length;
  return {
    text: rows.map((r) => `${r.lineNo}\t${pasteCell(r.description)}\t${r.quantity}\t${pasteCell(r.uom)}`).join("\n"),
    rows,
    skipped,
    truncatedFrom: total > items.length ? total : null,
  };
}

/* ---------------------------------- 接口的响应 ---------------------------------- */

export type SchedulePrefillState = "no_analysis" | "legacy_analysis" | "ready";
export type SchedulePrefillResponse = SchedulePrefill & {
  state: SchedulePrefillState;
  /** 给人看的一句话：带入了几行、有几条没带入，或者为什么没有 */
  messageZh: string;
};

export const EMPTY_PREFILL: SchedulePrefill = { text: "", rows: [], skipped: [], truncatedFrom: null };

export function schedulePrefillMessageZh(state: SchedulePrefillState, prefill: Pick<SchedulePrefill, "rows" | "skipped" | "truncatedFrom">): string {
  if (state === "no_analysis") return "这个项目还没有可用的招标分析（等待审核或已批准的），没有可以带入的行。";
  if (state === "legacy_analysis") return "这份招标分析没有保留数量与单位（它是在这个功能之前做的，或用的是旧版分析）。用新版分析重新分析后才能带入。";
  const n = prefill.rows.length;
  const m = prefill.skipped.length;
  if (n === 0 && m === 0) return "招标分析里没有抽到带数量的行，没有可以带入的。请照旧从发标方的价格表里粘贴。";
  const noUom = prefill.rows.filter((r) => !r.uom).length;
  const same = prefill.rows.filter((r) => r.sameAsLine !== null).length;
  const parts = [`从招标分析带入了 ${n} 行`];
  if (noUom > 0) parts.push(`其中 ${noUom} 行没有单位，要你补上（不补的行保存时会被略过）`);
  if (same > 0) parts.push(`${same} 行与前面的行完全相同，可能是重复`);
  if (m > 0) parts.push(`另有 ${m} 条没有带入（数量取不准或说法不一致）`);
  if (prefill.truncatedFrom) parts.push(`分析里共有 ${prefill.truncatedFrom} 条数量线索，只保留了前 ${SCHEDULE_CANDIDATES_MAX} 条`);
  return `${parts.join("；")}。这些是分析从招标文件里抽出来的，可能有漏有错：请对照招标文件逐行核对，尺寸、包装数、认证要求几列要自己补。还没有保存。`;
}

/* ---------------------------------- 面板上的两步判断（纯函数，便于测试） ---------------------------------- */

/** 点「从招标分析带入」时：粘贴框里已有内容 → 先问；空的 → 直接取 */
export function prefillClickAction(currentText: string): "confirm" | "load" {
  return currentText.trim().length > 0 ? "confirm" : "load";
}

/**
 * 取回带入结果后，粘贴框里该是什么。只在「有行可带」时替换；其余情况（没有分析、旧分析、一行都没有）不动粘贴框。
 * 返回 null = 不改粘贴框。这个函数只决定文本——它不保存，调用它的地方也不保存。
 */
export function prefillTextToApply(response: Pick<SchedulePrefillResponse, "state" | "rows" | "text">): string | null {
  return response.state === "ready" && response.rows.length > 0 ? response.text : null;
}

/** 粘贴框里的内容是不是还和带入时一样（不一样时，下面的对照清单要标明「是带入时的」） */
export function prefillIsStale(prefillText: string, currentText: string): boolean {
  return prefillText.trim() !== currentText.trim();
}
