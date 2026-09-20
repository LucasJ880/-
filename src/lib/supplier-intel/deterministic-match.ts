/**
 * S4-A：确定性匹配（Layer 1）——**纯函数**，无 DB / 无 LLM / 无时钟。
 *
 * 只处理规则本身完全确定、可回放、证据充分的两类要求：
 *   CERT_TYPE_V1         要求文本明确点名某种认证（UL / CSA / BIFMA / ISO 9001 …）
 *                        → 供应商有该类型的证书：VERIFIED + 评估当时未过期 + scope 与候选 offering 兼容 → PASS，
 *                          证据 = 那张证书；只有 CLAIMED / 过期 / scope 不对 → UNKNOWN（说明原因）；没有 → UNKNOWN
 *   NUMERIC_THRESHOLD_V1 要求文本是「≥ / minimum / at least N 单位」这类阈值，
 *                        且候选的 offering 快照属性里有同单位的数值 → 比较得 PASS / FAIL；
 *                        单位不能可靠对齐 → UNKNOWN，不猜
 *
 * 一切模糊 / 语义相似的判断都不在这里——那是 suggestion 层（本轮 defer），且永远要人确认。
 * 输出是**建议**：由服务端写成 evaluatedBy=DETERMINISTIC 的 Match，客户端不能自己声明。
 */

import { CERTIFICATION_TYPES, type DeterministicMatchRuleId } from "./constants";
import type { RequirementSnapshotEntry } from "./requirement-snapshot";

export interface DeterministicCertInput {
  id: string;
  certificationType: string;
  scope: string;
  offeringId: string | null;
  status: string;
  validFrom: string | null;
  expiresAt: string | null;
}

export interface DeterministicSuggestion {
  ruleId: DeterministicMatchRuleId;
  verdict: "PASS" | "FAIL" | "UNKNOWN";
  /** 规则为什么这么判（会写进 Match.explanation） */
  explanation: string;
  /** 证据引用：证书 id（CERT_TYPE_V1）；数值规则用 note 记录比较过程 */
  evidence: Array<{ kind: "certification"; certificationId: string } | { kind: "note"; snippet: string }>;
}

/* ───────────────── CERT_TYPE_V1 ───────────────── */

/** 要求文本里的认证提法 → 目录类型。只认明确、无歧义的写法。 */
const CERT_PATTERNS: Array<{ type: (typeof CERTIFICATION_TYPES)[number]; re: RegExp }> = [
  { type: "UL", re: /\bUL\b(?!\s*Product iQ)/i },
  { type: "ETL", re: /\bETL\b/i },
  { type: "CSA", re: /\bCSA\b/i },
  { type: "BIFMA", re: /\bBIFMA\b/i },
  { type: "GREENGUARD", re: /\bGREENGUARD\b/i },
  { type: "ISO_9001", re: /\bISO\s*9001\b/i },
  { type: "ISO_14001", re: /\bISO\s*14001\b/i },
  { type: "CE", re: /\bCE\s+(mark|marked|marking|certif)/i },
  { type: "FCC", re: /\bFCC\b/i },
  { type: "ROHS", re: /\bRoHS\b/i },
  { type: "REACH", re: /\bREACH\b/ },
  { type: "FSC", re: /\bFSC\b/ },
  { type: "BSCI", re: /\bBSCI\b/ },
  { type: "SMETA", re: /\bSMETA\b/ },
  { type: "SA8000", re: /\bSA\s*8000\b/i },
];

/** 从要求原文里读出「要求的认证类型」；读不出（或读出多个）→ null（不猜） */
export function detectRequiredCertificationType(text: string): string | null {
  const hits = CERT_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.type);
  return hits.length === 1 ? hits[0] : null;
}

export function suggestCertificationMatch(
  entry: RequirementSnapshotEntry,
  candidate: { offeringId: string | null },
  certs: DeterministicCertInput[],
  now: Date,
): DeterministicSuggestion | null {
  const type = detectRequiredCertificationType(entry.text);
  if (!type) return null;
  const ofType = certs.filter((c) => c.certificationType === type);
  if (ofType.length === 0) {
    return {
      ruleId: "CERT_TYPE_V1",
      verdict: "UNKNOWN",
      explanation: `规则 CERT_TYPE_V1：要求 ${type} 认证；供应商名下没有登记任何 ${type} 证书`,
      evidence: [],
    };
  }
  const scopeOk = (c: DeterministicCertInput) =>
    c.scope === "SUPPLIER" || (Boolean(candidate.offeringId) && c.offeringId === candidate.offeringId);
  const unexpired = (c: DeterministicCertInput) => !c.expiresAt || Date.parse(c.expiresAt) > now.getTime();
  const inEffect = (c: DeterministicCertInput) => !c.validFrom || Date.parse(c.validFrom) <= now.getTime();
  const good = ofType.find((c) => c.status === "VERIFIED" && scopeOk(c) && inEffect(c) && unexpired(c));
  if (good) {
    return {
      ruleId: "CERT_TYPE_V1",
      verdict: "PASS",
      explanation: `规则 CERT_TYPE_V1：要求 ${type} 认证；证书 ${good.id} 已独立核验、评估时未过期、范围${good.scope === "SUPPLIER" ? "为整个供应商" : "与候选产品一致"}`,
      evidence: [{ kind: "certification", certificationId: good.id }],
    };
  }
  // 有同类型证书但不可采信：说明具体原因，仍是 UNKNOWN（不是 FAIL——没有证据证明「没有认证」）
  const reasons = ofType.map((c) => {
    if (c.status !== "VERIFIED") return `${c.id}：${c.status}（未独立核验）`;
    if (!scopeOk(c)) return `${c.id}：范围 ${c.scope} 不覆盖候选产品`;
    if (!inEffect(c)) return `${c.id}：评估时尚未生效（validFrom 在评估之后）`;
    return `${c.id}：评估时已过期`;
  });
  return {
    ruleId: "CERT_TYPE_V1",
    verdict: "UNKNOWN",
    explanation: `规则 CERT_TYPE_V1：要求 ${type} 认证；已有证书均不可采信——${reasons.join("；")}`,
    evidence: [],
  };
}

/* ───────────────── NUMERIC_THRESHOLD_V2：维度绑定 ───────────────── */

/**
 * 冻结的维度别名契约（代码评审可见；不接 LLM、不做模糊相似）。
 * 只列当前招标要求 / 产品属性真的会出现的维度，按需最小。
 * 要求文本与属性键都必须归一到这里的**同一个**维度，才允许比较。
 */
export const NUMERIC_DIMENSION_ALIASES: Record<string, readonly string[]> = {
  width: ["width", "overall width", "宽", "宽度", "总宽"],
  height: ["height", "overall height", "高", "高度", "总高"],
  length: ["length", "overall length", "长", "长度", "总长"],
  depth: ["depth", "overall depth", "深", "深度"],
  thickness: ["thickness", "thick", "厚", "厚度"],
  load_capacity: ["load capacity", "weight capacity", "maximum load", "rated load", "load rating", "load", "承重", "承载", "载荷", "额定载荷"],
  product_weight: ["product weight", "net weight", "gross weight", "weight", "重量", "净重", "毛重", "自重"],
  warranty: ["warranty period", "warranty", "质保", "质保期", "保修", "保修期"],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const HAS_CJK = /[\u4e00-\u9fff]/;

/**
 * 从要求原文识别**唯一**维度。多词别名优先（"weight capacity" 压过其中的 "weight"）：
 * 先收集全部命中，再丢掉被更长命中完全覆盖的；剩下的维度集合必须恰好一个，否则 null（不猜）。
 */
export function detectRequirementDimension(text: string): string | null {
  const t = text.toLowerCase();
  const hits: Array<{ dim: string; start: number; end: number }> = [];
  for (const [dim, aliases] of Object.entries(NUMERIC_DIMENSION_ALIASES)) {
    for (const alias of aliases) {
      const re = HAS_CJK.test(alias) ? new RegExp(escapeRe(alias), "g") : new RegExp(`\\b${escapeRe(alias)}(?:s|es)?\\b`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(t)) !== null) hits.push({ dim, start: m.index, end: m.index + m[0].length });
    }
  }
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && (o.end - o.start) > (h.end - h.start)));
  const dims = new Set(kept.map((h) => h.dim));
  return dims.size === 1 ? [...dims][0] : null;
}

/** 属性键归一：camelCase / 下划线 / 连字符 → 小写单空格；必须**整键等于**某个别名，不做包含匹配 */
export function attributeDimension(key: string): string | null {
  const norm = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-]+/g, " ").toLowerCase().replace(/\s+/g, " ").trim();
  for (const [dim, aliases] of Object.entries(NUMERIC_DIMENSION_ALIASES)) {
    if (aliases.some((a) => a.toLowerCase() === norm)) return dim;
  }
  return null;
}


/** 可靠换算的单位族。不在这里的单位一律不换算（UNKNOWN）。 */
const UNIT_FAMILIES: Array<{ canonical: string; units: Record<string, number> }> = [
  { canonical: "lb", units: { lb: 1, lbs: 1, pound: 1, pounds: 1, kg: 2.20462, kgs: 2.20462 } },
  { canonical: "mm", units: { mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4 } },
  { canonical: "year", units: { year: 1, years: 1, yr: 1, yrs: 1, 年: 1 } },
];

function normalizeUnit(raw: string): { family: string; factor: number } | null {
  const u = raw.trim().toLowerCase();
  for (const f of UNIT_FAMILIES) {
    if (u in f.units) return { family: f.canonical, factor: f.units[u] };
  }
  return null;
}

export interface NumericThreshold {
  op: ">=" | "<=";
  value: number;
  unit: string;
  family: string;
  canonicalValue: number;
}

/**
 * 从要求文本读阈值：「minimum 300 lb」「at least 60"」「≥ 25mm」「not less than 10 years」
 * 「maximum 55 mm」「no more than 20 kg」。读不出唯一阈值 → null。
 */
export function parseNumericThreshold(text: string): NumericThreshold | null {
  const t = text.replace(/,/g, "");
  // 关键词与数字之间允许最多 4 个普通词（"Minimum weight capacity 300 lb"），不允许再出现另一个数字
  const GAP = String.raw`\s*(?:(?:of|[a-z][a-z\-/]*)\s+){0,4}?`;
  const UNIT = String.raw`(lbs?|pounds?|kgs?|mm|cm|m\b|in\b|inch(?:es)?|"|years?|yrs?)`;
  const ge = new RegExp(String.raw`(?:minimum|min\.?|at least|not less than|≥|>=|no less than)` + GAP + String.raw`(\d+(?:\.\d+)?)\s*` + UNIT, "i");
  const le = new RegExp(String.raw`(?:maximum|max\.?|at most|not more than|≤|<=|no more than)` + GAP + String.raw`(\d+(?:\.\d+)?)\s*` + UNIT, "i");
  const mg = ge.exec(t);
  const ml = le.exec(t);
  if ((mg && ml) || (!mg && !ml)) return null;
  const m = (mg ?? ml)!;
  const unit = m[2];
  const norm = normalizeUnit(unit);
  if (!norm) return null;
  const value = Number(m[1]);
  return { op: mg ? ">=" : "<=", value, unit, family: norm.family, canonicalValue: value * norm.factor };
}

/** 从 offering 快照 attributes 里找同单位族的数值：值形如 "600 lb" / "136kg" / "55 in" */
export type OfferingNumericLookup =
  | { status: "FOUND"; key: string; raw: string; canonicalValue: number }
  | { status: "NONE" }
  | { status: "AMBIGUOUS"; keys: string[] }
  | { status: "UNIT_MISMATCH"; key: string; raw: string };

/**
 * 在 offering 快照里找**同一维度**的数值。维度不同的属性一律不看（哪怕单位一样）；
 * 同维度不止一个 → AMBIGUOUS；有且一个但单位不在同族 → UNIT_MISMATCH。
 */
export function findOfferingNumeric(
  attributes: Record<string, unknown> | null | undefined,
  family: string,
  dimension: string,
): OfferingNumericLookup {
  if (!attributes) return { status: "NONE" };
  const sameDim = Object.entries(attributes).filter(([key]) => attributeDimension(key) === dimension);
  if (sameDim.length === 0) return { status: "NONE" };
  if (sameDim.length > 1) return { status: "AMBIGUOUS", keys: sameDim.map(([k]) => k) };
  const [key, v] = sameDim[0];
  const raw = String(v ?? "").replace(/,/g, "").trim();
  const m = /^(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kgs?|mm|cm|m|in|inch(?:es)?|"|years?|yrs?|年)$/i.exec(raw);
  const norm = m ? normalizeUnit(m[2]) : null;
  if (!m || !norm || norm.family !== family) return { status: "UNIT_MISMATCH", key, raw };
  return { status: "FOUND", key, raw, canonicalValue: Number(m[1]) * norm.factor };
}

export function suggestNumericMatch(
  entry: RequirementSnapshotEntry,
  offeringAttributes: Record<string, unknown> | null | undefined,
): DeterministicSuggestion | null {
  const th = parseNumericThreshold(entry.text);
  if (!th) return null;
  const unknown = (why: string): DeterministicSuggestion => ({
    ruleId: "NUMERIC_THRESHOLD_V2",
    verdict: "UNKNOWN",
    explanation: `规则 NUMERIC_THRESHOLD_V2：要求 ${th.op} ${th.value} ${th.unit}；${why}`,
    evidence: [],
  });
  const dimension = detectRequirementDimension(entry.text);
  if (!dimension) return unknown("要求原文里识别不出唯一的维度（宽度 / 高度 / 承重 / 重量…），不猜");
  const found = findOfferingNumeric(offeringAttributes, th.family, dimension);
  if (found.status === "NONE") return unknown(`候选产品快照里没有「${dimension}」维度的属性（同单位的其它维度不算）`);
  if (found.status === "AMBIGUOUS") return unknown(`候选产品快照里「${dimension}」维度有多个属性（${found.keys.join(" / ")}），无法确定用哪个`);
  if (found.status === "UNIT_MISMATCH") return unknown(`产品「${found.key}」= ${found.raw} 的单位无法可靠换算到 ${th.unit}`);
  const ok = th.op === ">=" ? found.canonicalValue >= th.canonicalValue : found.canonicalValue <= th.canonicalValue;
  const cmp = `维度 ${dimension}：产品「${found.key}」= ${found.raw}，要求 ${th.op} ${th.value} ${th.unit}`;
  return {
    ruleId: "NUMERIC_THRESHOLD_V2",
    verdict: ok ? "PASS" : "FAIL",
    explanation: `规则 NUMERIC_THRESHOLD_V2：${cmp} → ${ok ? "满足" : "不满足"}`,
    evidence: [{ kind: "note", snippet: `NUMERIC_THRESHOLD_V2 | ${cmp} | 来源：候选 offering 快照（冻结）` }],
  };
}

/** 对一条要求给出确定性建议；没有适用规则 → null（交给人工） */
export function suggestDeterministicMatch(
  entry: RequirementSnapshotEntry,
  candidate: { offeringId: string | null; offeringAttributes: Record<string, unknown> | null },
  certs: DeterministicCertInput[],
  now: Date,
): DeterministicSuggestion | null {
  const cert = suggestCertificationMatch(entry, candidate, certs, now);
  if (cert) return cert;
  return suggestNumericMatch(entry, candidate.offeringAttributes);
}
