/**
 * 老板驾驶舱 — 统一入口
 */

export { computeCockpitData } from "./metrics-engine";
export { generateWeeklyReport, getLatestReport } from "./weekly-report";
export type {
  CockpitData,
  MetricCard,
  TradeFunnel,
  FunnelStage,
  ROIMetrics,
  TrendSeries,
  TrendPoint,
  WeeklyReport,
} from "./types";
