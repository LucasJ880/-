/**
 * A1-P2 Human Signals — deterministic observation facts only.
 * Not AI quality, not employee scoring, not sentiment.
 */

import { hashAutopilotContent, sanitizeAutopilotPayload } from "./sanitize";

export const HUMAN_SIGNAL_SCHEMA_VERSION = 1;

export const HUMAN_EDIT_SOURCES = ["human.edit", "job.human_edited"] as const;
export const HUMAN_OVERRIDE_SOURCES = [
  "human.override",
  "approval.rejected",
] as const;
export const RE_ASK_SOURCES = ["human.reask"] as const;

export const HUMAN_SIGNAL_PROJECTED_TYPES = [
  "HUMAN_EDIT",
  "HUMAN_OVERRIDE",
  "RE_ASK_SIGNAL",
] as const;

export type HumanOverrideType =
  | "REJECTED"
  | "REPLACED"
  | "CANCELLED_AI_ACTION";

export type HumanSignalKind = "edit" | "override" | "reask" | "unlinked";

export const LEGACY_HUMAN_SIGNAL_GAPS = [
  {
    id: "sales_legacy_ai_draft_lineage",
    summary: "Sales 直连 createCompletion / 报价草稿无 AgentRun lineage",
  },
  {
    id: "trade_legacy_content_lineage",
    summary: "Trade / Firecrawl 内容无 AgentRun lineage",
  },
  {
    id: "tender_auto_analysis_lineage",
    summary: "招标自动分析章节编辑走 TenderAnalysisRun，未挂 AgentRun",
  },
  {
    id: "assistant_ordinary_followup_not_reask",
    summary: "普通 follow-up 消息不是 RE_ASK；仅 explicit retry/regenerate",
  },
  {
    id: "employee_ai_feedback_observe_best_effort",
    summary:
      "HumanFeedbackEvent 是业务事实；observe 在提交后写入 AgentRunEvent。observe 失败不回滚反馈，A1-P2 无自动 replay",
  },
  {
    id: "product_content_visual_regenerate",
    summary: "产品内容 visual regenerate 无 AgentRun lineage，不伪造 RE_ASK",
  },
  {
    id: "intelligence_regenerate",
    summary: "项目 intelligence regenerate 无 AgentRun lineage，不伪造 RE_ASK",
  },
] as const;

/** Domain coverage for A1-P2 audit. N/A = module has no such AI-linked action. */
export const DOMAIN_HUMAN_SIGNAL_COVERAGE = [
  {
    domain: "Assistant",
    humanEdit: "N/A",
    humanOverride: "PendingAction reject → approval.rejected",
    reAsk: "explicit Retry API",
    aiLineage: true,
    sourceOfTruth: "AgentRun / PendingAction / retry slot",
  },
  {
    domain: "PendingActions",
    humanEdit: "N/A",
    humanOverride: "reject of AI-proposed PA",
    reAsk: "N/A",
    aiLineage: true,
    sourceOfTruth: "PendingAction.status",
  },
  {
    domain: "EmployeeAI",
    humanEdit: "edited + agentRunId (best-effort observe)",
    humanOverride: "rejected without PA (best-effort observe)",
    reAsk: "N/A",
    aiLineage: "when agentRunId present",
    sourceOfTruth: "HumanFeedbackEvent",
  },
  {
    domain: "Email/Draft",
    humanEdit: "N/A",
    humanOverride: "N/A",
    reAsk: "N/A",
    aiLineage: false,
    sourceOfTruth: "email/draft artifact",
  },
  {
    domain: "Tender",
    humanEdit: "N/A (legacy TenderAnalysisRun)",
    humanOverride: "N/A",
    reAsk: "N/A",
    aiLineage: false,
    sourceOfTruth: "TenderAnalysis section",
  },
  {
    domain: "Sales",
    humanEdit: "N/A (legacy createCompletion)",
    humanOverride: "N/A unless PA",
    reAsk: "N/A",
    aiLineage: false,
    sourceOfTruth: "sales draft / quote",
  },
  {
    domain: "Trade",
    humanEdit: "N/A",
    humanOverride: "N/A",
    reAsk: "N/A",
    aiLineage: false,
    sourceOfTruth: "trade content",
  },
  {
    domain: "Project",
    humanEdit: "N/A",
    humanOverride: "N/A",
    reAsk: "N/A (intelligence regenerate gap)",
    aiLineage: false,
    sourceOfTruth: "project artifact",
  },
] as const;

const FORBIDDEN_PAYLOAD_KEYS = [
  "beforetext",
  "aftertext",
  "diff",
  "difftext",
  "body",
  "content",
  "prompt",
  "email",
  "html",
  "markdown",
  "quote",
  "tender",
  "proposal",
  "reasontext",
  "overridereason",
];

export function humanEditSignalKey(input: {
  sourceRunId: string;
  artifactId: string;
  committedVersion: string;
}): string {
  return `human.edit:${input.sourceRunId}:${input.artifactId}:${input.committedVersion}`;
}

export function humanOverrideSignalKey(input: {
  sourceRunId: string;
  decisionRef: string;
  transition: string;
}): string {
  return `human.override:${input.sourceRunId}:${input.decisionRef}:${input.transition}`;
}

export function reAskSignalKey(input: {
  sourceRunId: string;
  retryActionId: string;
}): string {
  return `human.reask:${input.sourceRunId}:${input.retryActionId}`;
}

export function snapshotStats(value: unknown): {
  hash: string;
  chars: number;
} {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? "");
  return { hash: hashAutopilotContent(text), chars: text.length };
}

export function shouldEmitHumanEdit(input: {
  sourceAgentRunId?: string | null;
  beforeHash: string;
  afterHash: string;
  commitOccurred: boolean;
}): boolean {
  if (!input.sourceAgentRunId?.trim()) return false;
  if (!input.commitOccurred) return false;
  return input.beforeHash !== input.afterHash;
}

export function classifyFollowUp(input: {
  explicitRetry?: boolean;
  explicitRegenerate?: boolean;
  retriedFromRunId?: string | null;
}): "reask" | "ordinary" {
  if (input.explicitRetry || input.explicitRegenerate) return "reask";
  if (input.retriedFromRunId?.trim()) return "reask";
  return "ordinary";
}

export function shouldEmitReAsk(input: {
  explicitRetry?: boolean;
  explicitRegenerate?: boolean;
  retriedFromRunId?: string | null;
}): boolean {
  return classifyFollowUp(input) === "reask";
}

export function changeMagnitude(beforeChars: number, afterChars: number): number {
  return Math.abs(afterChars - beforeChars);
}

export function buildHumanSignalPayload(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = sanitizeAutopilotPayload({
    schemaVersion: HUMAN_SIGNAL_SCHEMA_VERSION,
    ...fields,
  }) as Record<string, unknown>;
  for (const key of Object.keys(sanitized)) {
    const n = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (FORBIDDEN_PAYLOAD_KEYS.some((p) => n.includes(p))) {
      delete sanitized[key];
    }
  }
  delete sanitized.beforeText;
  delete sanitized.afterText;
  delete sanitized.diffText;
  delete sanitized.reasonText;
  return sanitized;
}

export function humanSignalProjectionGap(input: {
  sourceHumanSignalCount: number;
  projectedHumanSignalCount: number;
}): number {
  return Math.max(0, input.sourceHumanSignalCount - input.projectedHumanSignalCount);
}

export function isHumanSignalSource(eventType: string): boolean {
  return (
    (HUMAN_EDIT_SOURCES as readonly string[]).includes(eventType) ||
    (HUMAN_OVERRIDE_SOURCES as readonly string[]).includes(eventType) ||
    (RE_ASK_SOURCES as readonly string[]).includes(eventType)
  );
}

export function readHumanSignalKeys(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }
  const v = (metadata as Record<string, unknown>).humanSignalKeys;
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}
