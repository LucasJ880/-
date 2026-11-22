/**
 * CHAIN-0c — Job 停在哪一步、为什么（纯函数，域无关）
 *
 * 只用步骤的标题、顺序与错误码查表；**不读也不复述**运行记录或步骤上的
 * errorMessage（读模型纪律：不透出内部错误原文 / 堆栈）。招投标模块在此之上
 * 叠加它自己认得的失败标记（见 tender-workforce/job-failure-surfacing.ts）。
 */

export type StopReasonStep = {
  title: string;
  status: string;
  errorCode: string | null;
};

export type WorkforceStopReason = {
  /** 该步在计划里的顺序（按创建顺序，从 1 起） */
  stepIndex: number;
  stepTitle: string;
  reasonZh: string;
};

/** 系统里什么都没记下时的固定说法 */
export const STOP_REASON_UNRECORDED_ZH = "系统未记录原因";
/** 认不出错误码时的固定说法 */
export const STOP_REASON_UNKNOWN_ZH = "执行出错";
export const STOP_REASON_MAX_CHARS = 300;

/** 错误码 → 用户看得懂的一句话（未列出的一律「执行出错」，绝不显示原码） */
export const STOP_REASON_BY_ERROR_CODE: Readonly<Record<string, string>> = {
  step_attempts_exhausted: "重试次数用尽",
  model_failed: "重试次数用尽",
  stale_running_exhausted: "长时间没有进展",
  external_timeout: "长时间没有进展",
  tool_failed: "工具执行失败",
  workforce_step_exception: "工具执行失败",
  verification_failed: "结果没有通过校验",
  blocked_graph: "前置步骤没有完成",
  no_tool: "步骤未指定工具",
  clarification_required: "需要补充信息",
  approval_rejected: "审批被驳回",
  approval_expired: "审批已过期",
  db_error: "保存数据时出错",
  // FIX-20：执行器在步骤失败时按确定性规则归类出的码（workforce-runtime/constants）
  synthesis_failed: "综合汇总生成失败",
  model_quota_exhausted: "AI 账户余额不足，请联系平台管理员充值",
  org_ai_budget_exhausted: "本组织本月 AI 费用已达上限，请组织管理员调高月度上限",
  stale_running_recovered: "上一次执行时间过长被中断",
};

/** 单个错误码的白话；认不出（或没有）一律「执行出错」，绝不显示原码 */
export function stopReasonForErrorCode(code: string | null | undefined): string {
  return (code && STOP_REASON_BY_ERROR_CODE[code]) || STOP_REASON_UNKNOWN_ZH;
}

const DONE_STEP_STATUSES: ReadonlySet<string> = new Set(["completed", "skipped", "partially_executed"]);

/**
 * 停在的那一步：第一个失败的；没有则第一个还没完成的。返回 [序号(从 1 起), 步骤]。
 * steps 须已按计划顺序排好（读模型用 sortStepsByPlanOrder 的结果；收尾服务按创建顺序查询）。
 */
export function findStoppedStep<T extends StopReasonStep>(steps: readonly T[]): [number, T] | null {
  const ordered = steps;
  const failedAt = ordered.findIndex((s) => s.status === "failed");
  const at = failedAt >= 0 ? failedAt : ordered.findIndex((s) => !DONE_STEP_STATUSES.has(s.status));
  return at >= 0 ? [at + 1, ordered[at]] : null;
}

/** 每一步都已完成（如验证器在最后才判 needs_human）时，算在最后一步上，原因取 Job 的错误码 */
export function findStoppedStepOrLast<T extends StopReasonStep>(steps: readonly T[]): [number, T] | null {
  return findStoppedStep(steps) ?? (steps.length > 0 ? [steps.length, steps[steps.length - 1]] : null);
}

/**
 * 具体原因码（FIX-20）：AI 账户余额不足、本组织本月 AI 费用已达上限、重试次数用尽、长时间没有进展。
 * 失败步骤是这些码时，作业页、项目卡片、失败通知三处一字不差（招投标的已知标记不能盖过它们）。
 */
export const STOP_REASON_SPECIFIC_ERROR_CODES: ReadonlySet<string> = new Set([
  "model_quota_exhausted",
  "org_ai_budget_exhausted",
  "step_attempts_exhausted",
  "model_failed",
  "stale_running_exhausted",
  "external_timeout",
]);

/**
 * 按错误码查表（FIX-20 D9）：
 * - 所取的是失败步骤：只用它自己的错误码，查不到写「执行出错」（不回落 Job 的码）；
 * - 不是失败步骤（停在第一个没完成的、或每步都完成）：只用 Job 的错误码，不读该步骤上
 *   留下的码（重试 / 回收后的待开始、已完成步骤上也会留着码）；Job 的码也查不到时，
 *   需要人工处理写「需要人工处理」，否则写「执行出错」。
 */
export function stopReasonFromCodes(input: { stepFailed: boolean; stepErrorCode: string | null; jobErrorCode: string | null; jobStatus: string }): string {
  if (input.stepFailed) return stopReasonForErrorCode(input.stepErrorCode);
  const code = input.jobErrorCode;
  if (code && STOP_REASON_BY_ERROR_CODE[code]) return STOP_REASON_BY_ERROR_CODE[code];
  return input.jobStatus === "needs_human" ? "需要人工处理" : STOP_REASON_UNKNOWN_ZH;
}

/** 读模型用：只看错误码。没有步骤 → null（由显示处写「系统未记录原因」） */
export function projectStopReason(
  steps: readonly StopReasonStep[],
  run: { status: string; errorCode: string | null },
): WorkforceStopReason | null {
  const found = findStoppedStepOrLast(steps);
  if (!found) return null;
  const [stepIndex, step] = found;
  return {
    stepIndex,
    stepTitle: step.title,
    reasonZh: stopReasonFromCodes({ stepFailed: step.status === "failed", stepErrorCode: step.errorCode, jobErrorCode: run.errorCode, jobStatus: run.status }),
  };
}

/** FIX-20：一步的重试信息（只由状态、尝试次数、最多尝试次数与错误码算出） */
export type StepRetryInfo = {
  /** 第几次重试 */
  attempt: number;
  /** 最多可重试几次（= 最多尝试次数 − 1） */
  maxRetries: number;
  /** 上一次失败原因的白话（按错误码查表） */
  reasonZh: string;
};

/**
 * 重试判定（FIX-20 D8）：「待开始」且尝试次数 ≥ 1，或「执行中」且尝试次数 ≥ 2，并且错误码不为空。
 * 第几次重试：待开始时 = 尝试次数，执行中时 = 尝试次数 − 1。其余返回 null。
 */
export function projectStepRetry(step: {
  status: string;
  errorCode: string | null | undefined;
  attemptCount: number | null | undefined;
  maxAttempts: number | null | undefined;
}): StepRetryInfo | null {
  const attempts = step.attemptCount ?? 0;
  if (!step.errorCode) return null;
  let attempt: number;
  if (step.status === "ready" || step.status === "pending") {
    if (attempts < 1) return null;
    attempt = attempts;
  } else if (step.status === "running") {
    if (attempts < 2) return null;
    attempt = attempts - 1;
  } else {
    return null;
  }
  const maxRetries = Math.max(0, (step.maxAttempts ?? 0) - 1);
  return { attempt, maxRetries, reasonZh: stopReasonForErrorCode(step.errorCode) };
}

/** 「第 k 步〈步骤名〉正在第 N 次重试（最多重试 M 次）。上一次没成功：〈原因〉」 */
export function retrySentenceZh(input: StepRetryInfo & { stepIndex: number; stepTitle: string }): string {
  return `第 ${input.stepIndex} 步〈${input.stepTitle}〉正在第 ${input.attempt} 次重试（最多重试 ${input.maxRetries} 次）。上一次没成功：${input.reasonZh}`;
}

/** FIX-20：招投标确定性计划里综合汇总已跳过时的说明（不用「解读」二字，见 FIX-16 的分界） */
export const SYNTHESIS_NOT_GENERATED_ZH = "AI 数字员工的综合汇总未生成";

/** 「AI 数字员工的综合汇总未生成：〈原因〉」 */
export function synthesisNotGeneratedSentenceZh(reasonZh: string): string {
  return `${SYNTHESIS_NOT_GENERATED_ZH}：${reasonZh}`;
}

/** 「卡在第 N 步〈步骤名〉：〈原因〉」；没有 → 「系统未记录原因」；截到 300 字 */
export function stopReasonSentenceZh(reason: WorkforceStopReason | null): string {
  if (!reason) return STOP_REASON_UNRECORDED_ZH;
  const s = `卡在第 ${reason.stepIndex} 步〈${reason.stepTitle}〉：${reason.reasonZh}`;
  return [...s].length > STOP_REASON_MAX_CHARS ? [...s].slice(0, STOP_REASON_MAX_CHARS).join("") : s;
}
