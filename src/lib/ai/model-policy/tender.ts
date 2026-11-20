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
import type { Gpt6FlagDecision, Gpt6FlagEnv } from "./flags";

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
  flagDecision: Gpt6FlagDecision;
  orgId?: string;
};

export function tenderEntitlementLogFields(input: {
  orgId?: string | null;
  requestedModel: string;
  actualModel: string;
  fallbackUsed: boolean;
  flagDecision: Gpt6FlagDecision | string;
}): Record<string, string | boolean | null> {
  return {
    workflow: TENDER_WORKFLOW,
    org: input.orgId?.trim() || null,
    organization: input.orgId?.trim() || null,
    requestedModel: input.requestedModel,
    actualModel: input.actualModel,
    fallbackUsed: input.fallbackUsed,
    flagDecision: String(input.flagDecision),
  };
}

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

/* ------------------------------ 调用截止时间（FIX-12） ------------------------------ */

/** 截止触发的失败：不重试、不换模型，调用方据此让出。 */
export const TENDER_CALL_DEADLINE_CODE = "CALL_DEADLINE_EXCEEDED" as const;
/**
 * 距截止不足这么多就不发请求。必须低于 callTimeoutFor 的 1 秒下限：
 * 小预算下调用截止 = 开工时刻 + 1s，若阈值也是 1s，过去 1 毫秒首次请求就会被拒。
 */
export const TENDER_CALL_MIN_BUDGET_MS = 500;
/** 一次请求失败后距截止不足这么多：不做同模型重试、不换备用、不做结构化重试。 */
export const TENDER_RETRY_MIN_BUDGET_MS = 5_000;

/** 调用截止时间已到（或剩余不足以再试一次）。message 不含 timeout / aborted，避免被任何一层判为可重试。 */
export class TenderCallDeadlineError extends Error {
  readonly code = TENDER_CALL_DEADLINE_CODE;
  readonly remainingMs: number;
  /** 触发截止判定的那次失败（若有） */
  readonly lastError: unknown;
  /** 这次调用里是否真的发出过请求（false = 发之前就因剩余不足拒绝了） */
  readonly requestSent: boolean;
  constructor(remainingMs: number, lastError?: unknown) {
    super(
      `${TENDER_CALL_DEADLINE_CODE}: 距调用截止剩余 ${Math.max(0, Math.round(remainingMs))}ms，不再请求`,
    );
    this.name = "TenderCallDeadlineError";
    this.remainingMs = remainingMs;
    this.lastError = lastError;
    this.requestSent = lastError !== undefined;
  }
}

export function isTenderCallDeadlineError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { code?: unknown }).code === TENDER_CALL_DEADLINE_CODE
  );
}

/** 实际发请求的函数。@internal 仅测试注入；生产调用方不得传（会绕过 createCompletionDetailed 里的费用预检与记账）。 */
export type TenderCompletionFn = (
  opts: CompletionOptions,
) => Promise<DetailedCompletionResult>;

/**
 * 单次招标 LLM 调用：Astra → 同模型 1 次（仅 transient）→ Sol → 抛出。
 * 400 / schema / auth 不重试。一次 run 内由 createPinnedTenderInvoker 钉住模型。
 *
 * 带 deadlineAt（epoch ms）时（FIX-12）：每一次请求的超时取 min(timeoutMs, deadlineAt − now)；
 * 剩余 < 1s 不发请求；失败后剩余 < 5s 不再同模型重试 / 换备用，抛 TenderCallDeadlineError。
 * 不带 deadlineAt 时行为与以前完全相同。
 */
export async function createTenderCompletion(
  input: CompletionOptions & {
    tenderStage?: TenderStage;
    promptVersion?: string;
    evidenceConflict?: boolean;
    supervisorEscalation?: boolean;
    pinnedPolicy?: ModelPolicyResolution;
    pinnedModel?: string;
    /** 调用截止时间（epoch ms）：所有重试与换模型共用；缺省 = 不限 */
    deadlineAt?: number;
    /** 本次是上一层（结构化输出层）在一次失败之后的重试：剩余 < 5s 不发 */
    structuredRetry?: boolean;
    /** @internal 仅测试注入：时钟（缺省 Date.now） */
    now?: () => number;
    /** @internal 仅测试注入：实际请求（缺省 createCompletionDetailed；生产不得传） */
    complete?: TenderCompletionFn;
  },
): Promise<TenderCompletionResult> {
  const { now, complete, deadlineAt, structuredRetry, ...opts } = input;
  const clock = now ?? Date.now;
  const send: TenderCompletionFn = complete ?? createCompletionDetailed;
  const hasDeadline = typeof deadlineAt === "number" && Number.isFinite(deadlineAt);
  const remaining = (): number =>
    hasDeadline ? (deadlineAt as number) - clock() : Number.POSITIVE_INFINITY;
  /** 失败之后、再请求之前：剩余不足以再试一次 → 截止 */
  const guardRetry = (lastErr: unknown): void => {
    if (!hasDeadline) return;
    const left = remaining();
    if (left < TENDER_RETRY_MIN_BUDGET_MS) throw new TenderCallDeadlineError(left, lastErr);
  };
  /**
   * 最后一次请求（换备用 / 无备用时的同模型重试）失败后：可重试的错误且剩余不足以再试 → 记为截止，
   * 让上一层（结构化输出层）不再把它当瞬时错误重试、调用方以 call_deadline 让出。
   */
  const asDeadlineIfExhausted = (err: unknown): unknown => {
    if (!hasDeadline || isTenderCallDeadlineError(err)) return err;
    if (!isTenderFallbackAllowed(err)) return err;
    const left = remaining();
    return left < TENDER_RETRY_MIN_BUDGET_MS ? new TenderCallDeadlineError(left, err) : err;
  };
  /** 每次请求发起那一刻的超时：不越过截止 */
  const timeoutForRequest = (): number | undefined => {
    if (!hasDeadline) return opts.timeoutMs;
    const left = remaining();
    if (left < TENDER_CALL_MIN_BUDGET_MS) throw new TenderCallDeadlineError(left);
    return opts.timeoutMs != null ? Math.min(opts.timeoutMs, left) : left;
  };
  if (structuredRetry) guardRetry(undefined);
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

  const call = (model: string, retryCount: number, fallbackUsed: boolean) =>
    send({
      ...opts,
      timeoutMs: timeoutForRequest(),
      model,
      workflow: TENDER_WORKFLOW,
      reasoningEffort: effort,
      retryCount,
      source: opts.source ?? "tender",
      orgId: opts.orgId,
      userId: opts.userId,
      requestedModel: requested,
      fallbackUsed,
      flagDecision: policy.flagDecision,
    });

  try {
    const first = await call(requested, opts.retryCount ?? 0, false);
    return {
      ...first,
      requestedModel: requested,
      fallbackUsed: false,
      pin,
      reasoningEffort: String(effort),
      tenderStage: stage,
      flagDecision: policy.flagDecision,
      orgId: opts.orgId,
    };
  } catch (firstErr) {
    if (isTenderCallDeadlineError(firstErr)) throw firstErr;
    if (!isTenderFallbackAllowed(firstErr)) throw firstErr;

    let err: unknown = firstErr;
    const recovery = decideTenderRecovery({
      alreadyRetriedPrimary: false,
      err: firstErr,
    });
    if (recovery === "fail") throw firstErr;
    // 我方截止触发的中止必然落在这里：剩余 ≈ 0 → 不重试、不换模型
    guardRetry(firstErr);

    if (recovery === "retry_same" && isGpt6Astra(requested)) {
      try {
        const retried = await call(requested, 1, false);
        return {
          ...retried,
          requestedModel: requested,
          fallbackUsed: false,
          pin,
          reasoningEffort: String(effort),
          tenderStage: stage,
          flagDecision: policy.flagDecision,
          orgId: opts.orgId,
        };
      } catch (retryErr) {
        if (isTenderCallDeadlineError(retryErr)) throw retryErr;
        if (!isTenderFallbackAllowed(retryErr)) throw retryErr;
        err = retryErr;
      }
    }

    const fallback = policy.fallbackModel;
    if (!fallback || fallback === requested || isGpt6Astra(fallback)) {
      throw asDeadlineIfExhausted(err);
    }
    guardRetry(err);

    let second: DetailedCompletionResult;
    try {
      second = await call(fallback, 1, true);
    } catch (fallbackErr) {
      throw asDeadlineIfExhausted(fallbackErr);
    }
    return {
      ...second,
      requestedModel: requested,
      fallbackUsed: true,
      fallbackReason: err instanceof Error ? err.message : String(err),
      pin,
      reasoningEffort: String(effort),
      tenderStage: stage,
      flagDecision: policy.flagDecision,
      orgId: opts.orgId,
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
  /** 调用截止时间（epoch ms），见 createTenderCompletion */
  deadlineAt?: number;
  /** 结构化输出层在一次失败之后的重试 */
  retry?: boolean;
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
    orgId?: string;
    requestedModel: string;
    flagDecision: Gpt6FlagDecision;
  };
};

/** 一次 Tender run 钉住主模型；若 fallback 发生，后续窗口跟同一 fallback，避免模型漂移。 */
export function createPinnedTenderInvoker(input: {
  orgId?: string;
  userId?: string;
  /** 缺省 "unversioned"（tsc：参数默认 {} 与必填字段冲突） */
  promptVersion?: string;
  defaultStage?: TenderStage;
  env?: Gpt6FlagEnv;
  /** @internal 仅测试注入：时钟（缺省 Date.now） */
  now?: () => number;
  /** @internal 仅测试注入：实际请求（缺省 createCompletionDetailed；生产不得传） */
  complete?: TenderCompletionFn;
} = {}): PinnedTenderInvoker {
  const policy = resolveTenderModelPolicy({
    orgId: input.orgId,
    userId: input.userId,
    tenderStage: input.defaultStage ?? "understanding",
    env: input.env,
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
      orgId: input.orgId,
      userId: input.userId,
      ...(req.deadlineAt != null ? { deadlineAt: req.deadlineAt } : {}),
      ...(req.retry ? { structuredRetry: true } : {}),
      now: input.now,
      complete: input.complete,
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
    promptVersion: input.promptVersion ?? "unversioned",
  };
  invoke.snapshot = () => ({
    activeModel,
    fallbackUsed,
    fallbackReason,
    orgId: input.orgId,
    requestedModel: policy.model,
    flagDecision: policy.flagDecision,
  });
  return invoke;
}

export const TENDER_PRIMARY_WHEN_ENABLED = OPENAI_GPT6_ASTRA;
export const TENDER_FALLBACK_MODEL = OPENAI_BUILTIN.chat;
