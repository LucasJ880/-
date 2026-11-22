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

/** 按错误码查表（步骤的优先，其次 Job 的）；Job 停在需要人工处理时兜底「需要人工处理」 */
export function stopReasonFromCodes(input: { stepErrorCode: string | null; jobErrorCode: string | null; jobStatus: string }): string {
  for (const code of [input.stepErrorCode, input.jobErrorCode]) {
    if (code && STOP_REASON_BY_ERROR_CODE[code]) return STOP_REASON_BY_ERROR_CODE[code];
  }
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
    reasonZh: stopReasonFromCodes({ stepErrorCode: step.errorCode, jobErrorCode: run.errorCode, jobStatus: run.status }),
  };
}

/** 「卡在第 N 步〈步骤名〉：〈原因〉」；没有 → 「系统未记录原因」；截到 300 字 */
export function stopReasonSentenceZh(reason: WorkforceStopReason | null): string {
  if (!reason) return STOP_REASON_UNRECORDED_ZH;
  const s = `卡在第 ${reason.stepIndex} 步〈${reason.stepTitle}〉：${reason.reasonZh}`;
  return [...s].length > STOP_REASON_MAX_CHARS ? [...s].slice(0, STOP_REASON_MAX_CHARS).join("") : s;
}
