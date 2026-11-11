/**
 * FIX-2 价格表从招标分析带入 — 纯函数（零依赖，前后端共用）
 *
 * 招标分析（V2）抽出的要求与数量类事实本来带着数量和单位的原文；这里负责三件事：
 *   1. 入库时把它们收成「数量线索」（原文原样，不改写、不换算）；
 *   2. 读存下的线索（认版本；认出「这份分析是在本功能之前做的」）；
 *   3. 带入时用确定性的规则把线索变成价格表粘贴框认得的行。
 * 看不准的不猜：数量原文里不是恰好一个数字就不带入并说明原因；单位认不出就原样保留，交给既有的校验去报告。
 * 带入只是省去转录——生成的文本进粘贴框，由人核对后走既有的保存。这里不调模型，也不写任何东西。
 */

export const SCHEDULE_CANDIDATES_VERSION = 1 as const;
/** 一份分析最多存这么多条线索（防止异常的抽取结果把 JSON 撑大） */
export const SCHEDULE_CANDIDATES_MAX = 300;
const DESCRIPTION_MAX = 240;
const TEXT_MAX = 160;

export type ScheduleCandidate = {
  /** 来自一条要求，还是一条数量类事实 */
  source: "requirement" | "fact";
  /** 要求编号（事实为 null）；读取时用它核对这条要求有没有被人驳回 */
  code: string | null;
  description: string;
  /** 数量的原文（可能是「approx. 120 per year」「100-200」「as required」） */
  quantityText: string | null;
  /** 单位的原文 */
  unitText: string | null;
  page: number | null;
};

export type ScheduleCandidatesBlock = { version: typeof SCHEDULE_CANDIDATES_VERSION; items: ScheduleCandidate[] };

const oneLine = (s: string | null | undefined, max: number): string => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const orNull = (s: string): string | null => (s.length > 0 ? s : null);

/* ---------------------------------- 1. 入库：收集数量线索 ---------------------------------- */

type RequirementLike = {
  id: string;
  statement: string;
  object?: string | null;
  quantity?: string | null;
  unit?: string | null;
  status: string;
  evidence?: ReadonlyArray<{ pageNumber?: number | null }>;
};
type FactLike = {
  factType: string;
  claim: string;
  rawValue?: string | null;
  status: string;
  evidence?: ReadonlyArray<{ pageNumber?: number | null }>;
};

const pageOf = (evidence: ReadonlyArray<{ pageNumber?: number | null }> | undefined): number | null => {
  const p = evidence?.[0]?.pageNumber;
  return typeof p === "number" && Number.isInteger(p) && p > 0 ? p : null;
};

/**
 * 从一次分析的结果里收集数量线索：带数量或单位的有效要求（ACTIVE / NEEDS_REVIEW）、有效的数量类事实（ACTIVE）。
 * 被取代或有冲突的不收。原文原样保存（只把换行与多余空白并成一个空格）。
 */
export function collectScheduleCandidates(result: { requirements: ReadonlyArray<RequirementLike>; facts: ReadonlyArray<FactLike> }): ScheduleCandidatesBlock {
  const items: ScheduleCandidate[] = [];
  for (const r of result.requirements) {
    if (r.status !== "ACTIVE" && r.status !== "NEEDS_REVIEW") continue;
    const quantityText = orNull(oneLine(r.quantity, TEXT_MAX));
    const unitText = orNull(oneLine(r.unit, TEXT_MAX));
    if (!quantityText && !unitText) continue;
    // 说明：优先用抽取结果里的「对象」（如 Twin Mattress Cover），没有才用整句
    const description = oneLine(r.object, DESCRIPTION_MAX) || oneLine(r.statement, DESCRIPTION_MAX);
    if (!description) continue;
    items.push({ source: "requirement", code: r.id, description, quantityText, unitText, page: pageOf(r.evidence) });
  }
  for (const f of result.facts) {
    if (f.status !== "ACTIVE" || f.factType !== "quantity") continue;
    const description = oneLine(f.claim, DESCRIPTION_MAX);
    if (!description) continue;
    items.push({ source: "fact", code: null, description, quantityText: orNull(oneLine(f.rawValue, TEXT_MAX)) ?? orNull(oneLine(f.claim, TEXT_MAX)), unitText: null, page: pageOf(f.evidence) });
  }
  return { version: SCHEDULE_CANDIDATES_VERSION, items: items.slice(0, SCHEDULE_CANDIDATES_MAX) };
}

/* ---------------------------------- 2. 读存下的线索 ---------------------------------- */

export type StoredScheduleCandidates =
  /** 这一节的结构化字段里没有数量线索：分析是在本功能之前做的（或形状 / 版本不认识） */
  | { state: "absent" }
  | { state: "present"; items: ScheduleCandidate[] };

/** 读「价格与评标」一节的结构化字段。认不出的一律当作没有——不猜旧数据的形状。 */
export function readScheduleCandidates(structuredJson: unknown): StoredScheduleCandidates {
  if (!structuredJson || typeof structuredJson !== "object" || Array.isArray(structuredJson)) return { state: "absent" };
  const block = (structuredJson as { scheduleCandidates?: unknown }).scheduleCandidates;
  if (!block || typeof block !== "object" || Array.isArray(block)) return { state: "absent" };
  const b = block as { version?: unknown; items?: unknown };
  if (b.version !== SCHEDULE_CANDIDATES_VERSION || !Array.isArray(b.items)) return { state: "absent" };
  const items: ScheduleCandidate[] = [];
  for (const raw of b.items.slice(0, SCHEDULE_CANDIDATES_MAX)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const o = raw as Record<string, unknown>;
    const description = typeof o.description === "string" ? oneLine(o.description, DESCRIPTION_MAX) : "";
    if (!description) continue;
    items.push({
      source: o.source === "fact" ? "fact" : "requirement",
      code: typeof o.code === "string" && o.code.length > 0 && o.code.length <= 64 ? o.code : null,
      description,
      quantityText: typeof o.quantityText === "string" ? orNull(oneLine(o.quantityText, TEXT_MAX)) : null,
      unitText: typeof o.unitText === "string" ? orNull(oneLine(o.unitText, TEXT_MAX)) : null,
      page: typeof o.page === "number" && Number.isInteger(o.page) && o.page > 0 ? o.page : null,
    });
  }
  return { state: "present", items };
}

/* ---------------------------------- 3. 带入：线索 → 价格表的行 ---------------------------------- */

export type QuantityParse =
  | { ok: true; quantity: string }
  | { ok: false; reason: "missing" | "no_number" | "range" | "multiple" };

/**
 * 数量：原文里恰好有一个数字才取（千分位逗号去掉）。
 * 没有数字、是一个范围、有不止一个数字，都不取——不猜「取第一个」「取上限」。
 * 带货币符号或百分号的数字不是件数，不算数。
 */
export function parseQuantityText(text: string | null | undefined): QuantityParse {
  const raw = (text ?? "").trim();
  if (!raw) return { ok: false, reason: "missing" };
  // 千分位：2,367 / 1,234,567 → 2367 / 1234567（只认「逗号后恰好三位数字」的写法）
  const s = raw.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  // 金额与百分比不是数量
  const counted = s.replace(/[$€£¥]\s*\d+(?:\.\d+)?/g, " ").replace(/\d+(?:\.\d+)?\s*%/g, " ");
  const numbers = counted.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.length === 0) return { ok: false, reason: "no_number" };
  if (numbers.length === 1) return { ok: true, quantity: numbers[0] };
  const isRange = /\d\s*(?:-|–|—|~|to|through|至|到)\s*\d/i.test(counted) || /\bbetween\b[^.]*\band\b/i.test(counted);
  return { ok: false, reason: isRange ? "range" : "multiple" };
}

export const QUANTITY_SKIP_REASON_ZH: Record<Exclude<QuantityParse, { ok: true }>["reason"], string> = {
  missing: "没有写数量",
  no_number: "数量原文里没有数字",
  range: "数量是一个范围",
  multiple: "数量原文里有不止一个数字",
};

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
};

export function normalizeUomText(text: string | null | undefined): string {
  const raw = oneLine(text, 20);
  if (!raw) return "";
  const key = raw.toLowerCase().replace(/\.+$/, "").replace(/\s+/g, " ");
  return UOM_ALIASES[key] ?? raw;
}

export type PrefillRow = {
  lineNo: number;
  description: string;
  quantity: string;
  uom: string;
  /** 供人核对：这一行的数量、单位原文与页码 */
  quantityText: string;
  unitText: string | null;
  page: number | null;
  source: ScheduleCandidate["source"];
};
export type PrefillSkipped = { description: string; quantityText: string | null; page: number | null; reasonZh: string };
export type SchedulePrefill = {
  /** 粘贴框认得的文本：每行「行号 ⇥ 说明 ⇥ 数量 ⇥ 单位」 */
  text: string;
  rows: PrefillRow[];
  skipped: PrefillSkipped[];
};

/** 价格表一次最多的行数（与工作区保存接口的上限 MAX_SCHEDULE_LINES 一致；测试里核对两者相等） */
export const PREFILL_MAX_ROWS = 300;

/**
 * 把数量线索变成价格表的行。说明、数量、单位都相同的重复线索只留一条；行号从 1 连续编号；
 * 尺寸、包装数、认证要求几列留空（分析结果里没有可靠的对应字段）。
 */
export function buildSchedulePrefill(items: ReadonlyArray<ScheduleCandidate>, maxRows: number = PREFILL_MAX_ROWS): SchedulePrefill {
  const rows: PrefillRow[] = [];
  const skipped: PrefillSkipped[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    // 制表符与换行会把一行拆开：说明里的任何空白都并成一个空格
    const description = oneLine(it.description, DESCRIPTION_MAX);
    if (!description) continue;
    const q = parseQuantityText(it.quantityText);
    if (!q.ok) {
      skipped.push({ description, quantityText: it.quantityText, page: it.page, reasonZh: QUANTITY_SKIP_REASON_ZH[q.reason] });
      continue;
    }
    const uom = normalizeUomText(it.unitText);
    const key = `${description.toLowerCase()}\u0000${q.quantity}\u0000${uom.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (rows.length >= maxRows) {
      skipped.push({ description, quantityText: it.quantityText, page: it.page, reasonZh: `超过一次最多 ${maxRows} 行` });
      continue;
    }
    rows.push({ lineNo: rows.length + 1, description, quantity: q.quantity, uom, quantityText: it.quantityText ?? "", unitText: it.unitText, page: it.page, source: it.source });
  }
  return { text: rows.map((r) => `${r.lineNo}\t${r.description}\t${r.quantity}\t${r.uom}`).join("\n"), rows, skipped };
}

/* ---------------------------------- 接口的响应 ---------------------------------- */

export type SchedulePrefillState = "no_analysis" | "legacy_analysis" | "ready";
export type SchedulePrefillResponse = SchedulePrefill & {
  state: SchedulePrefillState;
  /** 给人看的一句话：带入了几行、有几条没带入，或者为什么没有 */
  messageZh: string;
};

export function schedulePrefillMessageZh(state: SchedulePrefillState, prefill: Pick<SchedulePrefill, "rows" | "skipped">): string {
  if (state === "no_analysis") return "这个项目还没有可用的招标分析（等待审核或已批准的），没有可以带入的行。";
  if (state === "legacy_analysis") return "这份招标分析没有保留数量与单位（它是在这个功能之前做的），重新分析后才能带入。";
  const n = prefill.rows.length;
  const m = prefill.skipped.length;
  if (n === 0 && m === 0) return "招标分析里没有抽到带数量的行，没有可以带入的。请照旧从发标方的价格表里粘贴。";
  const noUom = prefill.rows.filter((r) => !r.uom).length;
  const parts = [`从招标分析带入了 ${n} 行`];
  if (noUom > 0) parts.push(`其中 ${noUom} 行没有单位，要你补上`);
  if (m > 0) parts.push(`另有 ${m} 条数量看不准，没有带入`);
  return `${parts.join("；")}。这些是分析从招标文件里抽出来的，可能有漏有错：请对照原文逐行核对，尺寸、包装数、认证要求几列要自己补。还没有保存。`;
}
