import { HOME_STAGE_LABELS, relativeTimeLabel } from "./formatters";
import type { SalesPriorityCustomer } from "./types";

const DAY_MS = 86_400_000;

const EXCLUDED_STAGES = new Set([
  "signed",
  "producing",
  "installing",
  "completed",
  "lost",
]);

export type PriorityScoreInput = {
  customerId: string;
  customerName: string;
  stage: string;
  estimatedValue: number | null;
  nextFollowupAt: Date | null;
  updatedAt: Date;
  lastInteractionAt: Date | null;
  quoteViewedAt: Date | null;
  quoteStatus: string | null;
};

/**
 * 规则评分：不向用户展示分数，只产出排序与建议文案。
 */
export function scorePriorityCustomer(input: PriorityScoreInput): number {
  if (EXCLUDED_STAGES.has(input.stage)) return -1;

  let score = 0;
  const now = Date.now();

  if (input.quoteViewedAt) score += 40;
  if (input.quoteStatus === "sent" || input.quoteStatus === "viewed") score += 15;
  if (input.stage === "quoted" || input.stage === "negotiation") score += 25;
  if (input.stage === "measure_booked") score += 10;

  const value = input.estimatedValue ?? 0;
  if (value >= 8000) score += 25;
  else if (value >= 4000) score += 15;
  else if (value >= 2000) score += 8;

  if (input.lastInteractionAt) {
    const hours = (now - input.lastInteractionAt.getTime()) / 3_600_000;
    if (hours <= 24) score += 20;
    else if (hours <= 72) score += 10;
    else if (hours > 14 * 24) score -= 20;
  } else {
    score -= 5;
  }

  if (input.nextFollowupAt && input.nextFollowupAt.getTime() <= now) {
    score += 30;
  }

  return score;
}

export function buildPriorityCustomer(
  input: PriorityScoreInput,
  score: number,
): SalesPriorityCustomer | null {
  if (score < 0) return null;

  let badge: SalesPriorityCustomer["badge"] = null;
  let suggestion = "今天确认客户意向并约定下一步";

  if (input.quoteViewedAt) {
    badge = "较高成交可能";
    suggestion = "今天电话确认报价细节与安装时间";
  } else if (
    input.nextFollowupAt &&
    input.nextFollowupAt.getTime() <= Date.now()
  ) {
    badge = "需要尽快跟进";
    suggestion = "跟进日期已到，尽快联系客户";
  } else if (input.stage === "new_lead") {
    badge = "需要尽快跟进";
    suggestion = "新线索尚未深入沟通，建议今天首次联系";
  } else if (score >= 50) {
    badge = "较高成交可能";
  }

  const lastAt = input.quoteViewedAt ?? input.lastInteractionAt ?? input.updatedAt;
  const lastLabel = input.quoteViewedAt
    ? `${relativeTimeLabel(input.quoteViewedAt)}查看报价`
    : relativeTimeLabel(lastAt);

  return {
    customerId: input.customerId,
    customerName: input.customerName,
    stage: input.stage,
    stageLabel: HOME_STAGE_LABELS[input.stage] ?? input.stage,
    estimatedValue: input.estimatedValue,
    lastInteractionLabel: lastLabel,
    suggestion,
    badge,
  };
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(a.getTime() - b.getTime()) / DAY_MS);
}
