import { getLocalTimeParts } from "@/lib/automation/local-time";
import type { MarketingFlowKey } from "./activepieces";

export const MARKETING_AUTOMATION_TIMEZONE = "America/Toronto";

type ScheduledMarketingFlowKey = Exclude<MarketingFlowKey, "mmm-run">;

function localWeekday(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(now);
}

/**
 * 产生应在当前小时启动的流程。Vercel 每小时唤醒一次，真正的
 * 外部连接、重试和回调仍由 Activepieces 执行。
 */
export function scheduledMarketingFlows(
  now: Date,
  timeZone = MARKETING_AUTOMATION_TIMEZONE,
): ScheduledMarketingFlowKey[] {
  const { hour } = getLocalTimeParts(now, timeZone);
  const flows: ScheduledMarketingFlowKey[] = [];

  if ([1, 7, 13, 19].includes(hour)) flows.push("sync-metrics");
  if (hour === 7) flows.push("health-scan");
  if (hour === 8) flows.push("daily-brief");
  if (hour === 9 && localWeekday(now, timeZone) === "Mon") {
    flows.push("experiment-review");
  }
  return flows;
}

export function scheduledMarketingRequestId(input: {
  orgId: string;
  flowKey: ScheduledMarketingFlowKey;
  now: Date;
  timeZone?: string;
}): string {
  const local = getLocalTimeParts(
    input.now,
    input.timeZone || MARKETING_AUTOMATION_TIMEZONE,
  );
  return `schedule:${input.flowKey}:${input.orgId}:${local.date}:${String(local.hour).padStart(2, "0")}`;
}
