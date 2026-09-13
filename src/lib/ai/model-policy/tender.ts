/**
 * Tender QUALITY_FIRST — GPT-6 Astra 是招标推理主模型。
 *
 * 确定性抽取 / 证据门 / UNKNOWN 纪律仍在 tender-understanding 内，不因模型变强而绕过。
 * 禁止因 token 成本、输入变长、日预算优化而从 Astra 降到 Terra。
 */

import {
  createCompletionDetailed,
  type CompletionOptions,
  type DetailedCompletionResult,
} from "@/lib/ai/client";
import { OPENAI_BUILTIN, OPENAI_GPT6_ASTRA } from "@/lib/ai/model-registry";
import { isGpt6Astra } from "./compat";
import { classifyModelError } from "./retry";
import {
  asLegacyReasoningEffort,
  resolveReasoningPolicy,
  type TenderStage,
} from "./reasoning";
import { resolveModelPolicy, type ModelPolicyResolution } from "./resolve";

export const TENDER_WORKFLOW = "tender" as const;

export const TENDER_SUPERVISOR_STAGES = [
  "document_inventory",
  "understanding",
  "mandatory",
  "eligibility",
  "technical",
  "commercial",
  "execution_feasibility",
  "evidence_verification",
  "risk",
  "bid_no_bid",
] as const;

export type TenderSupervisorStage = (typeof TENDER_SUPERVISOR_STAGES)[number];

export const ANALYZED_WITH_FALLBACK_MODEL = "ANALYZED_WITH_FALLBACK_MODEL" as const;

export type TenderModelPin = {
  modelFamily: "gpt-6-astra" | "gpt-5.6";
  modelVersion: string;
  promptVersion: string;
};

const COST_DOWNGRADE_RE =
  /token.?cost|estimated.?cost|large.?input|daily.?budget|budget.?optim/i;

export function isTenderCostDowngradeReason(reason: string): boolean {
  return COST_DOWNGRADE_RE.test(reason);
}

export function isTenderFallbackAllowed(err: unknown): boolean {
  if (typeof err === "string" && isTenderCostDowngradeReason(err)) return false;
  if (err instanceof Error && isTenderCostDowngradeReason(err.message)) {
    return false;
  }
  const cls = classifyModelError(err);
  return cls === "retryable" || cls === "model_access";
}

export type TenderRecoveryAction = "retry_same" | "fallback" | "fail";

export function decideTenderRecovery(input: {
  alreadyRetriedPrimary: boolean;
  err: unknown;
}): TenderRecoveryAction {
  if (!isTenderFallbackAllowed(input.err)) return "fail";
  if (classifyModelError(input.err) === "retryable" && !input.alreadyRetriedPrimary) {
    return "retry_same";
  }
  if (classifyModelError(input.err) === "non_retryable") return "fail";
  return "fallback";
}

export function modelFamilyOf(model: string): TenderModelPin["modelFamily"] {
  return isGpt6Astra(model) ? "gpt-6-astra" : "gpt-5.6";
}

export function resolveTenderModelPolicy(
  input: Omit<Parameters<typeof resolveModelPolicy>[0], "role"> & {
    tenderStage?: TenderStage;
  } = {},
): ModelPolicyResolution {
  return resolveModelPolicy({
    ...input,
    role: "tender",
    criticality: input.criticality ?? "high",
    tenderStage: input.tenderStage ?? "understanding",
    fallbackModel: input.fallbackModel ?? OPENAI_BUILTIN.chat,
  });
}

export type TenderCompletionResult = DetailedCompletionResult & {
  requestedModel: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  pin: TenderModelPin;
  reasoningEffort: string;
  tenderStage: TenderStage;
};

function reasoningForCall(
  policy: ModelPolicyResolution,
  stage: TenderStage,
  extra?: { evidenceConflict?: boolean; supervisorEscalation?: boolean },
): CompletionOptions["reasoningEffort"] {
  const effort = resolveReasoningPolicy({
    role: "tender",
    tenderStage: stage,
    criticality: "high",
    evidenceConflict: extra?.evidenceConflict,
    supervisorEscalation: extra?.supervisorEscalation,
  });
  return isGpt6Astra(policy.model)
    ? effort
    : asLegacyReasoningEffort(effort);
}

/**
 * 单次招标 LLM 调用：Astra → 同模型 1 次（仅 transient）→ Sol → 抛出。
 * 400 / schema / auth 不重试。一次 run 内由 createPinnedTenderInvoker 钉住模型。
 */
export async function createTenderCompletion(
  opts: CompletionOptions & {
    tenderStage?: TenderStage;
    promptVersion?: string;
    evidenceConflict?: boolean;
    supervisorEscalation?: boolean;
    pinnedPolicy?: ModelPolicyResolution;
    pinnedModel?: string;
  },
): Promise<TenderCompletionResult> {
  const stage = opts.tenderStage ?? "understanding";
  const policy =
    opts.pinnedPolicy ??
    resolveTenderModelPolicy({
      orgId: opts.orgId,
      userId: opts.userId,
      tenderStage: stage,
      evidenceConflict: opts.evidenceConflict,
      supervisorEscalation: opts.supervisorEscalation,
    });
  const requested = opts.pinnedModel ?? policy.model;
  const pin: TenderModelPin = {
    modelFamily: modelFamilyOf(policy.model),
    modelVersion: policy.model,
    promptVersion: opts.promptVersion ?? "unspecified",
  };
  const effort = reasoningForCall(policy, stage, {
    evidenceConflict: opts.evidenceConflict,
    supervisorEscalation: opts.supervisorEscalation,
  });

  const call = (model: string, retryCount: number) =>
    createCompletionDetailed({
      ...opts,
      model,
      workflow: TENDER_WORKFLOW,
      reasoningEffort: effort,
      retryCount,
      source: opts.source ?? "tender",
    });

  try {
    const first = await call(requested, opts.retryCount ?? 0);
    return {
      ...first,
      requestedModel: requested,
      fallbackUsed: false,
      pin,
      reasoningEffort: String(effort),
      tenderStage: stage,
    };
  } catch (firstErr) {
    if (!isTenderFallbackAllowed(firstErr)) throw firstErr;

    let err: unknown = firstErr;
    const recovery = decideTenderRecovery({
      alreadyRetriedPrimary: false,
      err: firstErr,
    });
    if (recovery === "fail") throw firstErr;

    if (recovery === "retry_same" && isGpt6Astra(requested)) {
      try {
        const retried = await call(requested, 1);
        return {
          ...retried,
          requestedModel: requested,
          fallbackUsed: false,
          pin,
          reasoningEffort: String(effort),
          tenderStage: stage,
        };
      } catch (retryErr) {
        if (!isTenderFallbackAllowed(retryErr)) throw retryErr;
        err = retryErr;
      }
    }

    const fallback = policy.fallbackModel;
    if (!fallback || fallback === requested || isGpt6Astra(fallback)) {
      throw err;
    }

    const second = await call(fallback, 1);
    return {
      ...second,
      requestedModel: requested,
      fallbackUsed: true,
      fallbackReason: err instanceof Error ? err.message : String(err),
      pin,
      reasoningEffort: String(effort),
      tenderStage: stage,
    };
  }
}

export type PinnedTenderInvoker = ((req: {
  promptName: string;
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  timeoutMs: number;
  tenderStage?: TenderStage;
}) => Promise<{
  content: string;
  model: string;
  elapsedMs: number;
  finishReason?: string | null;
  fallbackUsed?: boolean;
  requestedModel?: string;
}>) & {
  pin: TenderModelPin;
  snapshot: () => {
    activeModel: string;
    fallbackUsed: boolean;
    fallbackReason?: string;
  };
};

/** 一次 Tender run 钉住主模型；若 fallback 发生，后续窗口跟同一 fallback，避免模型漂移。 */
export function createPinnedTenderInvoker(input: {
  orgId?: string;
  userId?: string;
  promptVersion: string;
  defaultStage?: TenderStage;
} = {}): PinnedTenderInvoker {
  const policy = resolveTenderModelPolicy({
    orgId: input.orgId,
    userId: input.userId,
    tenderStage: input.defaultStage ?? "understanding",
  });
  let activeModel = policy.model;
  let fallbackUsed = false;
  let fallbackReason: string | undefined;

  const invoke: PinnedTenderInvoker = async (req) => {
    const res = await createTenderCompletion({
      systemPrompt: req.systemPrompt,
      userPrompt: req.userPrompt,
      mode: "structured",
      maxTokens: req.maxTokens,
      timeoutMs: req.timeoutMs,
      tenderStage: req.tenderStage ?? input.defaultStage ?? "understanding",
      promptVersion: req.promptVersion,
      pinnedPolicy: policy,
      pinnedModel: activeModel,
    });
    if (res.fallbackUsed) {
      fallbackUsed = true;
      fallbackReason = res.fallbackReason;
      activeModel = res.model;
    }
    return {
      content: res.content,
      model: res.model,
      elapsedMs: res.elapsedMs,
      finishReason: res.finishReason,
      fallbackUsed: res.fallbackUsed || fallbackUsed,
      requestedModel: res.requestedModel,
    };
  };
  invoke.pin = {
    modelFamily: modelFamilyOf(policy.model),
    modelVersion: policy.model,
    promptVersion: input.promptVersion,
  };
  invoke.snapshot = () => ({
    activeModel,
    fallbackUsed,
    fallbackReason,
  });
  return invoke;
}

export const TENDER_PRIMARY_WHEN_ENABLED = OPENAI_GPT6_ASTRA;
export const TENDER_FALLBACK_MODEL = OPENAI_BUILTIN.chat;
