/**
 * KPI-2 期间看板 AI 解读：取 KPI-1 的期间汇总 → 投影 → 一次模型调用 → 确定性校验 → 审计。
 * 调用方（接口）负责开关、授权、期间解析与限次；模型调用可注入，测试不打真模型。
 */

import { logAudit } from "@/lib/audit/logger";
import { createCompletionDetailed, type CompletionOptions, type DetailedCompletionResult } from "@/lib/ai/client";
import { buildSalesPeriodResponse } from "./load";
import {
  buildNarrativeUserPrompt,
  fallbackForError,
  finalizeNarrative,
  NARRATIVE_AUDIT_ACTION,
  NARRATIVE_SYSTEM_PROMPT,
  NARRATIVE_WORKFLOW,
  projectNarrativeInput,
  type NarrativeResult,
} from "./narrative-pure";
import type { LocalPeriod, PeriodCompareKind, PeriodInfo, PeriodScope } from "./types";

export type NarrativeCompleteFn = (opts: CompletionOptions) => Promise<DetailedCompletionResult>;

export interface PeriodNarrativeResponse extends NarrativeResult {
  period: PeriodInfo;
  scope: "org" | "own";
}

export async function generatePeriodNarrative(
  params: { orgId: string; userId: string; scope: PeriodScope; period: LocalPeriod; compare: PeriodCompareKind; now?: Date },
  deps: { complete?: NarrativeCompleteFn } = {},
): Promise<PeriodNarrativeResponse> {
  const now = params.now ?? new Date();
  const complete = deps.complete ?? createCompletionDetailed;
  const summary = await buildSalesPeriodResponse({ orgId: params.orgId, scope: params.scope, period: params.period, compare: params.compare, now });
  const input = projectNarrativeInput(summary);

  const t0 = Date.now();
  let result: NarrativeResult;
  let model: string | null = null;
  try {
    const res = await complete({
      systemPrompt: NARRATIVE_SYSTEM_PROMPT,
      userPrompt: buildNarrativeUserPrompt(input),
      mode: "fast",
      temperature: 0.2,
      maxTokens: 1200,
      timeoutMs: 25_000,
      orgId: params.orgId,
      userId: params.userId,
      workflow: NARRATIVE_WORKFLOW,
      source: NARRATIVE_WORKFLOW,
    });
    model = res.model;
    result = finalizeNarrative({ rawText: res.content, input, model: res.model, now });
  } catch (err) {
    result = { narrative: null, fallbackReason: fallbackForError(err) };
  }

  // 只记结果：不存解读正文、提示词与任何金额
  await logAudit({
    userId: params.userId,
    orgId: params.orgId,
    action: NARRATIVE_AUDIT_ACTION,
    targetType: "sales_period_narrative",
    targetId: `${summary.period.from}..${summary.period.to}`,
    afterData: {
      outcome: result.fallbackReason ?? "ok",
      model,
      scope: summary.scope,
      from: summary.period.from,
      to: summary.period.to,
      compare: params.compare,
      elapsedMs: Date.now() - t0,
    },
  });

  return { period: summary.period, scope: summary.scope, ...result };
}
