/**
 * 动态 reasoning policy。禁止全站固定 high / max。
 * 不得仅根据 prompt length 升级。
 */

import type { ModelRole } from "./roles";

export type ReasoningBand =
  | "simple"
  | "normal"
  | "complex"
  | "critical"
  | "exception";

export type ExtendedReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type QualityMode = "standard" | "high";

/** Tender 阶段。不得默认 max。 */
export type TenderStage =
  | "triage"
  | "understanding"
  | "mandatory"
  | "eligibility"
  | "technical"
  | "commercial"
  | "bid_no_bid"
  | "addendum"
  | "cross_document"
  | "risk"
  | "adjudication";

export function reasoningBandForTenderStage(stage: TenderStage): ReasoningBand {
  switch (stage) {
    case "triage":
      return "normal";
    case "addendum":
    case "cross_document":
    case "risk":
    case "adjudication":
      return "critical";
    default:
      return "complex";
  }
}

export function reasoningBandForRole(role: ModelRole): ReasoningBand {
  switch (role) {
    case "summarizer":
    case "classifier":
    case "fast":
      return "simple";
    case "chat":
      return "normal";
    case "tender":
    case "researcher":
    case "supplier_intelligence":
    case "proposal":
    case "supervisor":
    case "planner":
    case "coder":
      return "complex";
    default:
      return "normal";
  }
}

export function asLegacyReasoningEffort(
  effort: ExtendedReasoningEffort,
): "low" | "medium" | "high" {
  if (effort === "xhigh" || effort === "max") return "high";
  return effort;
}

export function effortForBand(
  band: ReasoningBand,
  opts: { qualityMode?: QualityMode } = {},
): ExtendedReasoningEffort {
  if (opts.qualityMode === "high" && band === "complex") return "xhigh";
  switch (band) {
    case "simple":
      return "low";
    case "normal":
      return "medium";
    case "complex":
      return "high";
    case "critical":
      return "xhigh";
    case "exception":
      return "max";
  }
}

export interface ReasoningPolicyInput {
  role: ModelRole;
  toolCount?: number;
  /** 仅在与 toolCount/criticality 组合时才可升级，单独超长 prompt 不升级 */
  retrievedContextChars?: number;
  criticality?: "normal" | "high" | "critical";
  retryCount?: number;
  supervisorEscalation?: boolean;
  qualityMode?: QualityMode;
  tenderStage?: TenderStage;
  /** Tender：证据冲突。单独不足以升 max。 */
  evidenceConflict?: boolean;
}

export function resolveReasoningPolicy(
  input: ReasoningPolicyInput,
): ExtendedReasoningEffort {
  let band =
    input.role === "tender"
      ? reasoningBandForTenderStage(input.tenderStage ?? "understanding")
      : reasoningBandForRole(input.role);

  if (input.criticality === "critical") band = "critical";
  if (input.supervisorEscalation) band = "critical";

  if ((input.toolCount ?? 0) >= 6 && band === "normal") {
    band = "complex";
  }

  // 长检索上下文 + 多工具才升级；禁止「prompt 越长 reasoning 越高」
  if (
    (input.retrievedContextChars ?? 0) > 80_000 &&
    (input.toolCount ?? 0) >= 2 &&
    band === "normal"
  ) {
    band = "complex";
  }

  if ((input.retryCount ?? 0) >= 2 && band === "complex") {
    band = "critical";
  }

  // exception/max 只允许显式 supervisorEscalation + critical + 已重试
  if (
    input.supervisorEscalation &&
    input.criticality === "critical" &&
    (input.retryCount ?? 0) >= 2
  ) {
    band = "exception";
  }

  // Tender max：critical tender + 证据冲突 + supervisor escalation。禁止默认 max。
  if (
    input.role === "tender" &&
    input.evidenceConflict &&
    input.supervisorEscalation &&
    (input.criticality === "critical" || input.criticality === "high")
  ) {
    band = "exception";
  }

  return effortForBand(band, { qualityMode: input.qualityMode });
}
