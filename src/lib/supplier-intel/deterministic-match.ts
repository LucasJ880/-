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
  const good = ofType.find((c) => c.status === "VERIFIED" && scopeOk(c) && unexpired(c));
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
    return `${c.id}：评估时已过期`;
  });
  return {
    ruleId: "CERT_TYPE_V1",
    verdict: "UNKNOWN",
    explanation: `规则 CERT_TYPE_V1：要求 ${type} 认证；已有证书均不可采信——${reasons.join("；")}`,
    evidence: [],
  };
}

/* ───────────────── NUMERIC_THRESHOLD_V1 ───────────────── */

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
export function findOfferingNumeric(
  attributes: Record<string, unknown> | null | undefined,
  family: string,
): { key: string; raw: string; canonicalValue: number } | null {
  if (!attributes) return null;
  const hits: Array<{ key: string; raw: string; canonicalValue: number }> = [];
  for (const [key, v] of Object.entries(attributes)) {
    if (typeof v !== "string" && typeof v !== "number") continue;
    const raw = String(v).replace(/,/g, "");
    const m = /^(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kgs?|mm|cm|m|in|inch(?:es)?|"|years?|yrs?|年)$/i.exec(raw.trim());
    if (!m) continue;
    const norm = normalizeUnit(m[2]);
    if (!norm || norm.family !== family) continue;
    hits.push({ key, raw, canonicalValue: Number(m[1]) * norm.factor });
  }
  // 多个同族属性时无法确定该用哪一个 → 不猜
  return hits.length === 1 ? hits[0] : null;
}

export function suggestNumericMatch(
  entry: RequirementSnapshotEntry,
  offeringAttributes: Record<string, unknown> | null | undefined,
): DeterministicSuggestion | null {
  const th = parseNumericThreshold(entry.text);
  if (!th) return null;
  const found = findOfferingNumeric(offeringAttributes, th.family);
  if (!found) {
    return {
      ruleId: "NUMERIC_THRESHOLD_V1",
      verdict: "UNKNOWN",
      explanation: `规则 NUMERIC_THRESHOLD_V1：要求 ${th.op} ${th.value} ${th.unit}；候选产品快照里没有可比的 ${th.family} 数值（或不止一个，无法确定用哪个）`,
      evidence: [],
    };
  }
  const ok = th.op === ">=" ? found.canonicalValue >= th.canonicalValue : found.canonicalValue <= th.canonicalValue;
  const cmp = `产品「${found.key}」= ${found.raw}，要求 ${th.op} ${th.value} ${th.unit}`;
  return {
    ruleId: "NUMERIC_THRESHOLD_V1",
    verdict: ok ? "PASS" : "FAIL",
    explanation: `规则 NUMERIC_THRESHOLD_V1：${cmp} → ${ok ? "满足" : "不满足"}`,
    evidence: [{ kind: "note", snippet: `NUMERIC_THRESHOLD_V1 | ${cmp} | 来源：候选 offering 快照（冻结）` }],
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
