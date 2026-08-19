/**
 * Autopilot A2-P1 LLM Judge — eligibility, packet, and verdict gates.
 *
 * Structural telemetry only. Does not send prompts, tool payloads, or credentials.
 * HALLUCINATION / INTENT / WRONG_TOOL are rejected: no source text is available.
 * Human signals are not quality scores.
 */

import type {
  AutopilotFailureType,
  AutopilotLlmJudgeRuleId,
  AutopilotOutcome,
  AutopilotTraceEventType,
} from "./types";
import {
  AUTOPILOT_FAILURE_TYPES,
  AUTOPILOT_LLM_EVALUATOR_KIND,
  AUTOPILOT_LLM_EVALUATOR_VERSION,
} from "./types";
import { isKnownAutopilotOutcome } from "./evaluate";

export const LLM_JUDGE_SYSTEM_PROMPT = `You are Qingyan Autopilot A2-P1 LLM Judge.
You only see structural run telemetry. You do not see user prompts, emails, quotes, or tool payloads.

Rules:
- Completed is not automatically TASK_SUCCESS.
- HUMAN_EDIT / HUMAN_OVERRIDE / RE_ASK are not AI_WRONG and not HALLUCINATION.
- Prefer UNKNOWN when evidence is insufficient.
- Allowed outcomes: TASK_SUCCESS, PARTIAL_SUCCESS, FAILURE, UNKNOWN.
- Never output HUMAN_OVERRIDE or ABANDONED (those are deterministic).
- Never output HALLUCINATION, INTENT_ERROR, WRONG_TOOL, REASONING_ERROR, USER_INPUT_AMBIGUOUS, or CONTEXT_MISSING.
- FAILURE is only valid with a system-grounded failureType that matches failure events.

Reply with JSON only:
{"outcome":"...","failureType":null,"confidence":"low|medium|high","evidenceCode":"...","rationale":"<=160 chars"}`;

export const LLM_JUDGE_EVIDENCE_CODES = [
  "clean_completed_run",
  "human_edit_after_output",
  "has_tool_failure_event",
  "has_model_failure_event",
  "has_retrieval_failure_event",
  "has_context_load_failed",
  "insufficient_evidence",
] as const;

export type LlmJudgeEvidenceCode = (typeof LLM_JUDGE_EVIDENCE_CODES)[number];

export const LLM_JUDGE_SEMANTIC_FAILURES: readonly AutopilotFailureType[] = [
  "INTENT_ERROR",
  "CONTEXT_MISSING",
  "WRONG_TOOL",
  "REASONING_ERROR",
  "HALLUCINATION",
  "USER_INPUT_AMBIGUOUS",
];

export const LLM_JUDGE_GROUNDED_FAILURES: readonly AutopilotFailureType[] = [
  "TOOL_FAILURE",
  "RETRIEVAL_FAILURE",
  "EXTERNAL_SERVICE_FAILURE",
  "WORKFLOW_ERROR",
  "LATENCY_ERROR",
  "PERMISSION_ERROR",
  "UNKNOWN",
];

export type LlmJudgeEventCounts = Partial<Record<AutopilotTraceEventType, number>>;

export type LlmJudgePacket = {
  status: string | null;
  errorCode: string | null;
  humanOverride: boolean;
  humanEdit: boolean;
  reAsk: boolean;
  eventCounts: LlmJudgeEventCounts;
  inputBytes: number | null;
  outputBytes: number | null;
};

export type LlmJudgeVerdict = {
  evaluatorKind: typeof AUTOPILOT_LLM_EVALUATOR_KIND;
  evaluatorVersion: typeof AUTOPILOT_LLM_EVALUATOR_VERSION;
  outcome: AutopilotOutcome;
  failureType: AutopilotFailureType | null;
  failureSource: "llm" | null;
  judged: boolean;
  ruleId: AutopilotLlmJudgeRuleId;
  evidence: Record<string, unknown>;
};

function normalizeStatus(status?: string | null): string | null {
  const value = (status ?? "").trim().toLowerCase();
  return value || null;
}

export function isLlmJudgeEligible(input: {
  status?: string | null;
  deterministicOutcome: AutopilotOutcome;
}): boolean {
  if (input.deterministicOutcome !== "UNKNOWN") return false;
  return normalizeStatus(input.status) === "completed";
}

export function buildLlmJudgePacket(input: {
  status?: string | null;
  errorCode?: string | null;
  humanOverride?: boolean;
  humanEdit?: boolean;
  reAsk?: boolean;
  eventCounts?: LlmJudgeEventCounts;
  inputBytes?: number | null;
  outputBytes?: number | null;
}): LlmJudgePacket {
  return {
    status: normalizeStatus(input.status),
    errorCode: input.errorCode?.trim() || null,
    humanOverride: input.humanOverride === true,
    humanEdit: input.humanEdit === true,
    reAsk: input.reAsk === true,
    eventCounts: { ...(input.eventCounts ?? {}) },
    inputBytes:
      typeof input.inputBytes === "number" && Number.isFinite(input.inputBytes)
        ? input.inputBytes
        : null,
    outputBytes:
      typeof input.outputBytes === "number" && Number.isFinite(input.outputBytes)
        ? input.outputBytes
        : null,
  };
}

export function llmJudgeUserPrompt(packet: LlmJudgePacket): string {
  return JSON.stringify(packet);
}

function eventCount(packet: LlmJudgePacket, type: AutopilotTraceEventType): number {
  return packet.eventCounts[type] ?? 0;
}

export function packetHasSystemFailureEvent(packet: LlmJudgePacket): boolean {
  return (
    eventCount(packet, "TOOL_CALL_FAILED") > 0 ||
    eventCount(packet, "MODEL_FAILED") > 0 ||
    eventCount(packet, "RETRIEVAL_FAILED") > 0 ||
    eventCount(packet, "CONTEXT_LOAD_FAILED") > 0
  );
}

function isEvidenceCode(value: string): value is LlmJudgeEvidenceCode {
  return (LLM_JUDGE_EVIDENCE_CODES as readonly string[]).includes(value);
}

function isFailureType(value: string): value is AutopilotFailureType {
  return (AUTOPILOT_FAILURE_TYPES as readonly string[]).includes(value);
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function rejected(
  ruleId: AutopilotLlmJudgeRuleId,
  packet: LlmJudgePacket,
  extra?: Record<string, unknown>,
): LlmJudgeVerdict {
  return {
    evaluatorKind: AUTOPILOT_LLM_EVALUATOR_KIND,
    evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
    outcome: "UNKNOWN",
    failureType: null,
    failureSource: null,
    judged: false,
    ruleId,
    evidence: { packet, ...extra },
  };
}

function evidenceCodeMatchesPacket(
  packet: LlmJudgePacket,
  code: LlmJudgeEvidenceCode,
): boolean {
  switch (code) {
    case "clean_completed_run":
      return (
        packet.status === "completed" &&
        !packet.humanOverride &&
        !packet.humanEdit &&
        !packet.reAsk &&
        !packetHasSystemFailureEvent(packet)
      );
    case "human_edit_after_output":
      return packet.humanEdit && !packet.humanOverride;
    case "has_tool_failure_event":
      return eventCount(packet, "TOOL_CALL_FAILED") > 0;
    case "has_model_failure_event":
      return eventCount(packet, "MODEL_FAILED") > 0;
    case "has_retrieval_failure_event":
      return eventCount(packet, "RETRIEVAL_FAILED") > 0;
    case "has_context_load_failed":
      return eventCount(packet, "CONTEXT_LOAD_FAILED") > 0;
    case "insufficient_evidence":
      return true;
    default:
      return false;
  }
}

export function acceptLlmJudgeVerdict(
  packet: LlmJudgePacket,
  rawText: string,
): LlmJudgeVerdict {
  const parsed = extractJsonObject(rawText);
  if (!parsed) {
    return rejected("LLM_JUDGE_PARSE_FAILED", packet);
  }

  const outcomeRaw = typeof parsed.outcome === "string" ? parsed.outcome : "";
  const failureRaw =
    typeof parsed.failureType === "string" ? parsed.failureType : null;
  const confidence =
    typeof parsed.confidence === "string" ? parsed.confidence : "";
  const evidenceCodeRaw =
    typeof parsed.evidenceCode === "string" ? parsed.evidenceCode : "";
  const rationale =
    typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 160) : "";

  if (packet.humanOverride) {
    return rejected("LLM_JUDGE_REJECTED_INELIGIBLE", packet, { parsed });
  }

  if (!isKnownAutopilotOutcome(outcomeRaw)) {
    return rejected("LLM_JUDGE_PARSE_FAILED", packet, { parsed });
  }
  if (outcomeRaw === "HUMAN_OVERRIDE" || outcomeRaw === "ABANDONED") {
    return rejected("LLM_JUDGE_REJECTED_INELIGIBLE", packet, { parsed });
  }
  if (!isEvidenceCode(evidenceCodeRaw)) {
    return rejected("LLM_JUDGE_REJECTED_UNGROUNDED", packet, { parsed });
  }
  if (!evidenceCodeMatchesPacket(packet, evidenceCodeRaw)) {
    return rejected("LLM_JUDGE_REJECTED_UNGROUNDED", packet, { parsed });
  }

  const failureType =
    failureRaw && isFailureType(failureRaw) ? failureRaw : null;
  if (
    failureType &&
    (LLM_JUDGE_SEMANTIC_FAILURES as readonly string[]).includes(failureType)
  ) {
    return rejected("LLM_JUDGE_REJECTED_SEMANTIC_FAILURE", packet, { parsed });
  }

  if (outcomeRaw === "TASK_SUCCESS") {
    if (packet.humanEdit || packet.reAsk || packetHasSystemFailureEvent(packet)) {
      return rejected("LLM_JUDGE_REJECTED_HUMAN_SIGNAL_AS_QUALITY", packet, {
        parsed,
      });
    }
    if (evidenceCodeRaw !== "clean_completed_run" || confidence !== "high") {
      return rejected("LLM_JUDGE_REJECTED_UNGROUNDED", packet, { parsed });
    }
    return {
      evaluatorKind: AUTOPILOT_LLM_EVALUATOR_KIND,
      evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
      outcome: "TASK_SUCCESS",
      failureType: null,
      failureSource: "llm",
      judged: true,
      ruleId: "LLM_JUDGE_ACCEPTED",
      evidence: { packet, evidenceCode: evidenceCodeRaw, confidence, rationale },
    };
  }

  if (outcomeRaw === "PARTIAL_SUCCESS") {
    if (!packet.humanEdit || packet.humanOverride) {
      return rejected("LLM_JUDGE_REJECTED_UNGROUNDED", packet, { parsed });
    }
    if (evidenceCodeRaw !== "human_edit_after_output") {
      return rejected("LLM_JUDGE_REJECTED_UNGROUNDED", packet, { parsed });
    }
    return {
      evaluatorKind: AUTOPILOT_LLM_EVALUATOR_KIND,
      evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
      outcome: "PARTIAL_SUCCESS",
      failureType: null,
      failureSource: "llm",
      judged: true,
      ruleId: "LLM_JUDGE_ACCEPTED",
      evidence: { packet, evidenceCode: evidenceCodeRaw, confidence, rationale },
    };
  }

  if (outcomeRaw === "FAILURE") {
    if (!packetHasSystemFailureEvent(packet)) {
      return rejected("LLM_JUDGE_REJECTED_UNGROUNDED", packet, { parsed });
    }
    if (
      !failureType ||
      !(LLM_JUDGE_GROUNDED_FAILURES as readonly string[]).includes(failureType)
    ) {
      return rejected("LLM_JUDGE_REJECTED_UNGROUNDED", packet, { parsed });
    }
    return {
      evaluatorKind: AUTOPILOT_LLM_EVALUATOR_KIND,
      evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
      outcome: "FAILURE",
      failureType,
      failureSource: "llm",
      judged: true,
      ruleId: "LLM_JUDGE_ACCEPTED",
      evidence: { packet, evidenceCode: evidenceCodeRaw, confidence, rationale },
    };
  }

  return {
    evaluatorKind: AUTOPILOT_LLM_EVALUATOR_KIND,
    evaluatorVersion: AUTOPILOT_LLM_EVALUATOR_VERSION,
    outcome: "UNKNOWN",
    failureType: null,
    failureSource: null,
    judged: true,
    ruleId: "LLM_JUDGE_ABSTAINED",
    evidence: { packet, evidenceCode: evidenceCodeRaw, confidence, rationale },
  };
}

export function llmJudgeUnavailable(packet: LlmJudgePacket): LlmJudgeVerdict {
  return rejected("LLM_JUDGE_UNAVAILABLE", packet);
}

/** Notices that may invoke the LLM. Other projected events must not. */
export const LLM_JUDGE_TRIGGER_EVENT_TYPES: readonly AutopilotTraceEventType[] = [
  "HUMAN_EDIT",
  "HUMAN_OVERRIDE",
  "RE_ASK_SIGNAL",
  "TOOL_CALL_FAILED",
  "MODEL_FAILED",
  "RETRIEVAL_FAILED",
  "CONTEXT_LOAD_FAILED",
];

const LLM_JUDGE_RETRYABLE_RULES: readonly AutopilotLlmJudgeRuleId[] = [
  "LLM_JUDGE_UNAVAILABLE",
  "LLM_JUDGE_PARSE_FAILED",
];

export function shouldInvokeLlmJudge(input: {
  noticeType: "run_created" | "run_terminal" | "event";
  mappedEventType?: AutopilotTraceEventType | null;
}): boolean {
  if (input.noticeType === "run_terminal") return true;
  if (input.noticeType !== "event") return false;
  const eventType = input.mappedEventType;
  if (!eventType) return false;
  return (LLM_JUDGE_TRIGGER_EVENT_TYPES as readonly string[]).includes(eventType);
}

export function llmJudgePacketFingerprint(packet: LlmJudgePacket): string {
  const eventCounts: Record<string, number> = {};
  for (const key of Object.keys(packet.eventCounts).sort()) {
    const n = packet.eventCounts[key as AutopilotTraceEventType];
    if (typeof n === "number" && n > 0) eventCounts[key] = n;
  }
  return JSON.stringify({
    status: packet.status,
    errorCode: packet.errorCode,
    humanOverride: packet.humanOverride,
    humanEdit: packet.humanEdit,
    reAsk: packet.reAsk,
    eventCounts,
    inputBytes: packet.inputBytes,
    outputBytes: packet.outputBytes,
  });
}

export function packetFromJudgeEvidence(evidence: unknown): LlmJudgePacket | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return null;
  }
  const raw = (evidence as { packet?: unknown }).packet;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const packet = raw as Record<string, unknown>;
  const eventCounts =
    packet.eventCounts &&
    typeof packet.eventCounts === "object" &&
    !Array.isArray(packet.eventCounts)
      ? (packet.eventCounts as LlmJudgeEventCounts)
      : {};
  return buildLlmJudgePacket({
    status: typeof packet.status === "string" ? packet.status : null,
    errorCode: typeof packet.errorCode === "string" ? packet.errorCode : null,
    humanOverride: packet.humanOverride === true,
    humanEdit: packet.humanEdit === true,
    reAsk: packet.reAsk === true,
    eventCounts,
    inputBytes: typeof packet.inputBytes === "number" ? packet.inputBytes : null,
    outputBytes: typeof packet.outputBytes === "number" ? packet.outputBytes : null,
  });
}

/**
 * Skip a second model call when the structural packet is unchanged.
 * Retry UNAVAILABLE / PARSE_FAILED so a flake can recover.
 */
export function shouldReuseExistingLlmJudge(
  existing:
    | { ruleId?: string | null; evidence?: unknown }
    | null
    | undefined,
  packet: LlmJudgePacket,
): boolean {
  if (!existing?.ruleId) return false;
  if (
    (LLM_JUDGE_RETRYABLE_RULES as readonly string[]).includes(existing.ruleId)
  ) {
    return false;
  }
  const previous = packetFromJudgeEvidence(existing.evidence);
  if (!previous) return false;
  return llmJudgePacketFingerprint(previous) === llmJudgePacketFingerprint(packet);
}
