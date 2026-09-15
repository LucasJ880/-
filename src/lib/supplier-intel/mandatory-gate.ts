/**
 * S4-A：强制项硬门（Mandatory Gate）——**纯函数**，无 DB / 无时钟 / 无 LLM。
 *
 * 输入全部是冻结值：Run 的需求快照、候选的 offering 绑定、已落库的 Match 行
 *（含按值冻结的 evidenceJson）。同输入必同输出，历史 Run 永远可回放。
 *
 * 三条不变量（设计 §11.3 + 任务书 §9/§21/§22）：
 *   1. 对 mandatory 要求：UNKNOWN ≠ PASS，PARTIAL ≠ PASS，缺 Match ≠ PASS，
 *      mandatoryUncertain=true 一律 fail-closed。
 *   2. 门不只看 verdict，还看「这个 PASS 由什么证据支撑」：
 *        - 证书类：statusAtEvaluation 必须 VERIFIED、评估当时未过期、scope 与候选 offering 兼容；
 *        - 档案类：项目档案（写入时已过归属校验）；
 *        - 线索 / 网页 / 备注**单独**不构成硬门证据（社媒自述、官网营销文案、厂家自称都不算）；
 *        - AI_ASSISTED 的 PASS 不能独立满足硬门；
 *        - DETERMINISTIC 的 PASS 只有服务端规则能写出来（客户端声明不了），按规则可回放，视为可采信。
 *   3. FAIL 优先：同时存在 FAIL 与 UNKNOWN 时，总门是 FAIL（已有明确不符合）。
 *
 * 「过期」用冻结证据里的 expiresAt 对比**Match 冻结时刻 capturedAt**，不是读取时的 Date.now()：
 * 2026 年评估时有效的证书，2027 年到期后，2026 的历史 Run 仍然是 PASS。
 */

import {
  DETERMINISTIC_MATCH_RULES,
  MANDATORY_GATE_RULE_VERSION_V1,
  OFFERING_SCOPED_REQUIREMENT_CATEGORIES,
  type MandatoryGateReasonCode,
} from "./constants";
import { detectRequiredCertificationType } from "./deterministic-match";
import { collapseMandatoryForMatch, type RequirementSnapshotEntry } from "./requirement-snapshot";

export interface GateMatchInput {
  id: string;
  requirementKey: string;
  verdict: string;
  evaluatedBy: string;
  /** 落库的 evidenceJson（按值冻结数组） */
  evidence: unknown;
  /** Match 行创建时间；证据 capturedAt 缺失时的兜底参照 */
  createdAt: string;
}

export interface GateCandidateInput {
  offeringId: string | null;
}

export interface GateItem {
  requirementKey: string;
  requirementRefId: string;
  mandatoryUncertain: boolean;
  matchId: string | null;
  matchVerdict: string | null;
  evaluatedBy: string | null;
  /** 该条对硬门的裁决：PASS / FAIL / UNKNOWN（UNKNOWN = 不可判定 / 不可采信 / 缺失） */
  gateVerdict: "PASS" | "FAIL" | "UNKNOWN";
  evidenceAdmissible: boolean;
  reasonCode: MandatoryGateReasonCode;
}

export interface MandatoryGateSnapshot {
  gateRuleVersion: string;
  evaluationVersion: string;
  computedAt: string;
  requirementSnapshot: { count: number; mandatoryCount: number };
  result: "PASS" | "FAIL" | "INCOMPLETE";
  items: GateItem[];
  summary: { pass: number; fail: number; unknown: number; missing: number; uncertain: number };
}

export interface GateOutcome {
  snapshot: MandatoryGateSnapshot;
  /** 硬门自带的两个强制结论；PASS 时为 null（最终推荐留给 S4-B 的评分阶段） */
  recommendation: "NOT_ELIGIBLE" | "NEEDS_VERIFICATION" | null;
  rejectionReason: string | null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseTime(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * 单条证据能否支撑硬门 PASS（只看冻结值）。
 * 返回 null = 可采信；否则返回不可采信的原因码。
 */
export function classifyEvidenceForGate(
  item: unknown,
  candidate: GateCandidateInput,
  matchCreatedAt: string,
  /** 要求原文明确点名的认证类型（如 UL）；非 null 时证书类型必须一致 */
  requiredCertType: string | null = null,
): MandatoryGateReasonCode | null {
  if (!isObj(item)) return "EVIDENCE_NOT_VERIFIED";
  const kind = item.kind;
  if (kind === "archive") {
    // 写入时已经过 resolveArchiveEvidence + 项目归属校验（S4-A recordEvaluationMatch）
    return typeof item.archiveItemId === "string" && item.archiveItemId ? null : "EVIDENCE_NOT_VERIFIED";
  }
  if (kind === "certification") {
    if (item.statusAtEvaluation !== "VERIFIED") return "CERT_NOT_VERIFIED";
    // 要求点名了认证类型（"Must be UL listed"）时，一张 VERIFIED 的 CSA 证书不能顶 UL
    if (requiredCertType && item.certificationType !== requiredCertType) return "CERT_TYPE_MISMATCH";
    const scope = item.scope;
    if (scope !== "SUPPLIER") {
      // PRODUCT / MODEL_SERIES：必须精确等于候选绑定的 offering；候选无 offering 也不行
      const certOffering = typeof item.offeringId === "string" ? item.offeringId : null;
      if (!candidate.offeringId || certOffering !== candidate.offeringId) return "CERT_SCOPE_MISMATCH";
    }
    const expires = parseTime(item.expiresAt);
    if (expires !== null) {
      const at = parseTime(item.capturedAt) ?? parseTime(matchCreatedAt);
      if (at === null || expires <= at) return "CERT_EXPIRED_AT_EVALUATION";
    }
    return null;
  }
  // signal / url / note：单独不构成硬门证据（社媒自述、官网文案、厂家自称、口头备注）
  return "EVIDENCE_NOT_VERIFIED";
}

function isOfferingScoped(entry: RequirementSnapshotEntry): boolean {
  const c = entry.category?.trim().toLowerCase() ?? "";
  return (OFFERING_SCOPED_REQUIREMENT_CATEGORIES as readonly string[]).includes(c);
}

/**
 * 逐条裁决一个 mandatory 要求。
 */
export function adjudicateMandatoryItem(
  entry: RequirementSnapshotEntry,
  match: GateMatchInput | undefined,
  candidate: GateCandidateInput,
): GateItem {
  const { mandatoryUncertain } = collapseMandatoryForMatch(entry);
  const base = {
    requirementKey: entry.code,
    requirementRefId: entry.id,
    mandatoryUncertain,
    matchId: match?.id ?? null,
    matchVerdict: match?.verdict ?? null,
    evaluatedBy: match?.evaluatedBy ?? null,
  };

  // 明确 FAIL 先于一切——即使要求本身待澄清，已有证据证明不满足就是不满足
  if (match?.verdict === "FAIL") {
    return { ...base, gateVerdict: "FAIL", evidenceAdmissible: false, reasonCode: "MANDATORY_MATCH_FAIL" };
  }
  if (!match) {
    return { ...base, gateVerdict: "UNKNOWN", evidenceAdmissible: false, reasonCode: "MANDATORY_MATCH_MISSING" };
  }
  if (match.verdict === "UNKNOWN") {
    return { ...base, gateVerdict: "UNKNOWN", evidenceAdmissible: false, reasonCode: "MANDATORY_MATCH_UNKNOWN" };
  }
  if (match.verdict === "PARTIAL") {
    return { ...base, gateVerdict: "UNKNOWN", evidenceAdmissible: false, reasonCode: "MANDATORY_MATCH_PARTIAL" };
  }
  // 到这里 verdict === PASS。先看要求本身是否可判定，再看证据可采信。
  if (mandatoryUncertain) {
    return { ...base, gateVerdict: "UNKNOWN", evidenceAdmissible: false, reasonCode: "MANDATORY_STATUS_UNCERTAIN" };
  }
  if (isOfferingScoped(entry) && !candidate.offeringId) {
    return { ...base, gateVerdict: "UNKNOWN", evidenceAdmissible: false, reasonCode: "OFFERING_REQUIRED" };
  }
  if (match.evaluatedBy === "AI_ASSISTED") {
    return { ...base, gateVerdict: "UNKNOWN", evidenceAdmissible: false, reasonCode: "AI_ASSISTED_NOT_ADMISSIBLE" };
  }
  const evidence = Array.isArray(match.evidence) ? match.evidence : [];
  const requiredCertType = detectRequiredCertificationType(entry.text);
  if (match.evaluatedBy === "DETERMINISTIC") {
    // 只有服务端规则能写出 DETERMINISTIC，但门不只信标签：证据里必须有可采信的证书，
    // 或一条带已知规则 ID 的 note（规则按冻结的 offering 快照可回放）
    const admissible = evidence.some((item) => {
      if (classifyEvidenceForGate(item, candidate, match.createdAt, requiredCertType) === null) return true;
      if (!isObj(item) || item.kind !== "note" || typeof item.snippet !== "string") return false;
      const snippet = item.snippet;
      return (DETERMINISTIC_MATCH_RULES as readonly string[]).some((id) => snippet.startsWith(`${id} |`));
    });
    return admissible
      ? { ...base, gateVerdict: "PASS", evidenceAdmissible: true, reasonCode: "OK" }
      : { ...base, gateVerdict: "UNKNOWN", evidenceAdmissible: false, reasonCode: "EVIDENCE_NOT_VERIFIED" };
  }
  // HUMAN PASS：至少一条可采信证据（证书 VERIFIED+未过期+scope 兼容，或项目档案）
  let firstReason: MandatoryGateReasonCode = "EVIDENCE_NOT_VERIFIED";
  for (const item of evidence) {
    const r = classifyEvidenceForGate(item, candidate, match.createdAt, requiredCertType);
    if (r === null) {
      return { ...base, gateVerdict: "PASS", evidenceAdmissible: true, reasonCode: "OK" };
    }
    // 证书类原因比泛化的「未核验」更具体，优先报它
    if (firstReason === "EVIDENCE_NOT_VERIFIED" && r !== "EVIDENCE_NOT_VERIFIED") firstReason = r;
  }
  return { ...base, gateVerdict: "UNKNOWN", evidenceAdmissible: false, reasonCode: firstReason };
}

export function computeMandatoryGate(input: {
  requirementSnapshot: RequirementSnapshotEntry[];
  candidate: GateCandidateInput;
  matches: GateMatchInput[];
  evaluationVersion: string;
  computedAt: Date;
}): GateOutcome {
  const byKey = new Map(input.matches.map((m) => [m.requirementKey, m]));
  const items: GateItem[] = [];
  for (const entry of input.requirementSnapshot) {
    const { mandatory } = collapseMandatoryForMatch(entry);
    if (!mandatory) continue; // 非强制项不进硬门（其 FAIL 不影响门）
    items.push(adjudicateMandatoryItem(entry, byKey.get(entry.code), input.candidate));
  }

  const summary = {
    pass: items.filter((i) => i.gateVerdict === "PASS").length,
    fail: items.filter((i) => i.gateVerdict === "FAIL").length,
    unknown: items.filter((i) => i.gateVerdict === "UNKNOWN").length,
    missing: items.filter((i) => i.reasonCode === "MANDATORY_MATCH_MISSING").length,
    uncertain: items.filter((i) => i.mandatoryUncertain).length,
  };
  const result: MandatoryGateSnapshot["result"] =
    summary.fail > 0 ? "FAIL" : summary.unknown > 0 ? "INCOMPLETE" : "PASS";

  const snapshot: MandatoryGateSnapshot = {
    gateRuleVersion: MANDATORY_GATE_RULE_VERSION_V1,
    evaluationVersion: input.evaluationVersion,
    computedAt: input.computedAt.toISOString(),
    requirementSnapshot: { count: input.requirementSnapshot.length, mandatoryCount: items.length },
    result,
    items,
    summary,
  };

  if (result === "FAIL") {
    const failed = items.filter((i) => i.gateVerdict === "FAIL").map((i) => `${i.requirementKey}:${i.reasonCode}`);
    return { snapshot, recommendation: "NOT_ELIGIBLE", rejectionReason: failed.join(";") };
  }
  if (result === "INCOMPLETE") {
    return { snapshot, recommendation: "NEEDS_VERIFICATION", rejectionReason: null };
  }
  return { snapshot, recommendation: null, rejectionReason: null };
}
