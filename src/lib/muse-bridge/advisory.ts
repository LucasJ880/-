/**
 * Muse Bridge — 建议式回复契约（P1-8）：结论 → 理由 → 下一步（纯函数，零 DB / 零 LLM）
 *
 *   advisory()          规整：结论 ≤ 60 字、理由 ≤ 3 条且每条 ≤ 80 字、备选 ≤ 2 个（超长截断，不报错）
 *   renderAdvisory()    固定格式：第一行结论；"· "起头的理由各占一行；最后一行"下一步：xxx"（无 nextStep 不出）
 *   advisoryResponse()  ok 回复唯一构造入口：suggestedActions[0] 恒等于 nextStep，备选排后面
 *   eventSummary()      事件摘要：结论 + 1 条理由
 *
 * 出站脱敏（sanitizeOutbound）也在这里——所有出 Muse 的文字都要过它；router-pure.ts 再导出。
 */

import {
  MUSE_BRIDGE_CONTRACT_VERSION,
  containsOutboundSensitive,
  type MuseCommandArgs,
  type MuseCommandResponse,
  type MuseIntent,
  type MuseSuggestedAction,
} from "./contract";

export const CONCLUSION_MAX = 60;
export const REASON_MAX = 80;
export const REASONS_MAX = 3;
export const ALTERNATIVES_MAX = 2;
const LABEL_MAX = 60;

export type AdvisoryNextStep = { label: string; command: MuseCommandArgs };

export type Advisory = {
  /** 1 句，≤ 60 字：发生了什么 / 建议什么 */
  conclusion: string;
  /** 0–3 条，每条 ≤ 80 字：依据（要求编号 / 页码 / 数值） */
  reasons: string[];
  /** 唯一的下一步；没有就 null（不猜） */
  nextStep: AdvisoryNextStep | null;
  /** ≤ 2 个备选 */
  alternatives?: MuseSuggestedAction[];
};

/* ---------------------------------- 出站脱敏 ---------------------------------- */

/** 命中敏感字段 → 整段替换，而不是尝试"抠掉一部分"。 */
export const OUTBOUND_REDACTED = "（该内容包含内部财务信息，不通过 Muse 通道输出，请在青砚内查看。）";

/** 出站脱敏：命中敏感词整段替换。strict 用于 compare / price_scenario（另拦"成本 / 利润"）。 */
export function sanitizeOutbound(text: string, opts: { strict?: boolean } = {}): string {
  const t = text.length > 1200 ? `${text.slice(0, 1199)}…` : text;
  return containsOutboundSensitive(t, opts) ? OUTBOUND_REDACTED : t;
}

/* ---------------------------------- 构造 / 渲染 ---------------------------------- */

const oneLine = (s: string) => s.replace(/\s*\n+\s*/g, " ").trim();
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** 规整成合法 Advisory（截断而不是报错：保证任何调用方都满足契约上限） */
export function advisory(a: Advisory): Advisory {
  const nextStep = a.nextStep ? { label: clip(oneLine(a.nextStep.label), LABEL_MAX), command: a.nextStep.command } : null;
  return {
    conclusion: clip(oneLine(a.conclusion) || "（无结论）", CONCLUSION_MAX),
    reasons: a.reasons.map(oneLine).filter(Boolean).slice(0, REASONS_MAX).map((r) => clip(r, REASON_MAX)),
    nextStep,
    alternatives: (a.alternatives ?? [])
      .slice(0, ALTERNATIVES_MAX)
      .map((x) => ({ label: clip(oneLine(x.label), LABEL_MAX), command: x.command })),
  };
}

export function renderAdvisory(a: Advisory): string {
  const v = advisory(a);
  const lines = [v.conclusion, ...v.reasons.map((r) => `· ${r}`)];
  if (v.nextStep) lines.push(`下一步：${v.nextStep.label}`);
  return lines.join("\n");
}

/** suggestedActions：[nextStep, ...alternatives]；nextStep 为 null 时只剩备选 */
export function advisoryActions(a: Advisory): MuseSuggestedAction[] {
  const v = advisory(a);
  return [...(v.nextStep ? [v.nextStep] : []), ...(v.alternatives ?? [])].slice(0, 4);
}

/**
 * 去掉当前没放行的意图：建议一个点了就被 INTENT_NOT_ENABLED 拒掉的按钮等于没建议。
 * nextStep 意图未放行 → nextStep = null（不拿备选顶上，不猜）。
 */
export function gateAdvisory(a: Advisory, enabled: ReadonlySet<MuseIntent>): Advisory {
  return {
    ...a,
    nextStep: a.nextStep && enabled.has(a.nextStep.command.intent) ? a.nextStep : null,
    alternatives: (a.alternatives ?? []).filter((x) => enabled.has(x.command.intent)),
  };
}

/** ok 回复唯一构造入口 */
export function advisoryResponse(
  requestId: string,
  a: Advisory,
  extra?: { data?: unknown; strict?: boolean },
): MuseCommandResponse {
  const v = advisory(a);
  return {
    contractVersion: MUSE_BRIDGE_CONTRACT_VERSION,
    requestId,
    ok: true,
    message: sanitizeOutbound(renderAdvisory(v), { strict: extra?.strict }),
    data: extra?.data,
    suggestedActions: advisoryActions(v),
  };
}

/** 事件摘要：结论 + 1 条理由（两行；action 由调用方放 nextStep） */
export function eventSummary(conclusion: string, reason: string | null): string {
  const v = advisory({ conclusion, reasons: reason ? [reason] : [], nextStep: null });
  return [v.conclusion, ...v.reasons.map((r) => `· ${r}`)].join("\n");
}

/** 测试与审计用：第一行（结论） */
export function firstLine(message: string): string {
  return message.split("\n")[0] ?? "";
}
