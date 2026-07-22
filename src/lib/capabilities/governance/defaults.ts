import type { QuotaMetric, QuotaPeriod } from "./types";

/** 未配置时的安全默认（硬上限）；企业/WS 只能收紧 */
export const PLATFORM_DEFAULT_QUOTAS: Record<
  QuotaMetric,
  {
    period: QuotaPeriod;
    warningLimit: number;
    softLimit: number;
    hardLimit: number;
  }
> = {
  MONTHLY_AI_COST: {
    period: "MONTHLY",
    warningLimit: 30,
    softLimit: 40,
    hardLimit: 50,
  },
  DAILY_AGENT_RUNS: {
    period: "DAILY",
    warningLimit: 100,
    softLimit: 150,
    hardLimit: 200,
  },
  DAILY_HIGH_RISK_TOOL_CALLS: {
    period: "DAILY",
    warningLimit: 20,
    softLimit: 35,
    hardLimit: 50,
  },
  DAILY_IMAGE_GENERATIONS: {
    period: "DAILY",
    warningLimit: 40,
    softLimit: 70,
    hardLimit: 100,
  },
  MAX_CONCURRENT_RUNS: {
    period: "CONCURRENT",
    warningLimit: 5,
    softLimit: 8,
    hardLimit: 10,
  },
  SINGLE_RUN_ESTIMATED_COST: {
    period: "PER_RUN",
    warningLimit: 0.5,
    softLimit: 1,
    hardLimit: 2,
  },
};

export const ALL_QUOTA_METRICS = Object.keys(
  PLATFORM_DEFAULT_QUOTAS,
) as QuotaMetric[];
