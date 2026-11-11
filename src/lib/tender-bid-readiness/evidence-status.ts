/**
 * TI-3b 证据状态投影（纯函数）
 *
 * 企业记忆里一条声明有三根正交的轴（性质、置信度、核验状态）；这里把性质、核验状态、
 * 时效与是否被反驳投影成五个显示状态。只是投影，不新增任何存储值。
 * 未知与互相矛盾的声明不支撑任何结论。
 */

export const CLAIM_NATURES = ["FACT", "INTERPRETATION", "INFERENCE"] as const;
export type ClaimNature = (typeof CLAIM_NATURES)[number];
export const VERIFICATION_STATUSES = ["AI_EXTRACTED", "HUMAN_CONFIRMED", "SYSTEM_VERIFIED", "NEEDS_REVIEW"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export const CLAIM_LIFECYCLES = ["ACTIVE", "SUPERSEDED", "RETRACTED", "NEEDS_REVIEW"] as const;
export type ClaimLifecycle = (typeof CLAIM_LIFECYCLES)[number];

export const DISPLAY_STATUSES = ["CONFIRMED", "INDICATIVE", "INFERRED", "UNKNOWN", "CONTRADICTED"] as const;
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];
export const DISPLAY_STATUS_ZH: Record<DisplayStatus, string> = {
  CONFIRMED: "已确认", INDICATIVE: "指示性", INFERRED: "推断", UNKNOWN: "未知", CONTRADICTED: "互相矛盾",
};

export type ClaimInput = {
  id: string;
  /** 同一主题同一字段的声明才会互相比较 */
  subjectKey: string;
  field: string;
  value: string;
  nature: ClaimNature;
  verificationStatus: VerificationStatus;
  lifecycle?: ClaimLifecycle;
  /** ISO 日期或时间；过了即过期 */
  validTo?: string | null;
  evidenceCount: number;
  /** 本条取代的旧声明 id */
  supersedesClaimId?: string | null;
};

export type EvidenceProjection = { id: string; status: DisplayStatus; statusZh: string; supportsConclusion: boolean; reasonZh: string };

function isExpired(validTo: string | null | undefined, now: Date): boolean | "INVALID" {
  if (!validTo || !validTo.trim()) return false;
  const t = new Date(validTo.trim()).getTime();
  if (Number.isNaN(t)) return "INVALID";
  return t < now.getTime();
}

const isLive = (c: ClaimInput, now: Date) => (c.lifecycle ?? "ACTIVE") === "ACTIVE" && isExpired(c.validTo, now) === false && c.evidenceCount > 0;
const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

/** 同主题同字段、都有效、未被取代、取值不同 → 互相矛盾。返回被标记的声明 id。 */
export function detectContradictions(claims: readonly ClaimInput[], now: Date): Set<string> {
  const superseded = new Set(claims.map((c) => c.supersedesClaimId).filter((v): v is string => !!v));
  const live = claims.filter((c) => isLive(c, now) && !superseded.has(c.id));
  const groups = new Map<string, ClaimInput[]>();
  for (const c of live) {
    const key = `${c.subjectKey} ${c.field}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const out = new Set<string>();
  for (const list of groups.values()) {
    if (new Set(list.map((c) => norm(c.value))).size > 1) list.forEach((c) => out.add(c.id));
  }
  return out;
}

export function projectEvidenceStatus(claim: ClaimInput, ctx: { now: Date; contradicted?: boolean; superseded?: boolean }): EvidenceProjection {
  const make = (status: DisplayStatus, reasonZh: string): EvidenceProjection => ({
    id: claim.id, status, statusZh: DISPLAY_STATUS_ZH[status], supportsConclusion: status !== "UNKNOWN" && status !== "CONTRADICTED", reasonZh,
  });
  if (ctx.contradicted) return make("CONTRADICTED", "同一主题同一字段有取值不同的有效声明");
  const lifecycle = claim.lifecycle ?? "ACTIVE";
  if (ctx.superseded || lifecycle === "SUPERSEDED") return make("UNKNOWN", "已被新的声明取代");
  if (lifecycle === "RETRACTED") return make("UNKNOWN", "已撤回");
  const expired = isExpired(claim.validTo, ctx.now);
  if (expired === "INVALID") return make("UNKNOWN", "有效期无法解析");
  if (expired) return make("UNKNOWN", "已过有效期");
  if (claim.evidenceCount <= 0) return make("UNKNOWN", "没有任何证据");
  if (claim.nature === "FACT" && (claim.verificationStatus === "HUMAN_CONFIRMED" || claim.verificationStatus === "SYSTEM_VERIFIED")) {
    return make("CONFIRMED", claim.verificationStatus === "HUMAN_CONFIRMED" ? "事实，经人工确认" : "事实，经系统核验");
  }
  if (claim.nature === "INFERENCE") return make("INFERRED", "推断，不是直接证据");
  return make("INDICATIVE", claim.verificationStatus === "AI_EXTRACTED" ? "模型抽取，未经确认" : "未经确认");
}

/** 一组声明一次投影：先找矛盾与被取代的，再逐条投影。 */
export function projectClaims(claims: readonly ClaimInput[], now: Date): EvidenceProjection[] {
  const contradicted = detectContradictions(claims, now);
  const superseded = new Set(claims.map((c) => c.supersedesClaimId).filter((v): v is string => !!v));
  return claims.map((c) => projectEvidenceStatus(c, { now, contradicted: contradicted.has(c.id), superseded: superseded.has(c.id) }));
}
