/**
 * 老板驾驶舱 — 核心类型
 */

// ── 顶级指标卡 ──────────────────────────────────────────────

export interface MetricCard {
  label: string;
  value: number;
  unit?: string;
  trend: number;       // 相比上一周期的变化率 (如 +0.15 = +15%)
  trendLabel: string;  // "较上周 +15%"
  status: "up" | "down" | "flat";
}

// ── 外贸漏斗 ──────────────────────────────────────────────────

export interface FunnelStage {
  stage: string;
  label: string;
  count: number;
  conversionRate: number | null; // 转化率
}

export interface TradeFunnel {
  stages: FunnelStage[];
  totalProspects: number;
  wonCount: number;
  overallConversion: number; // 总成单率
}

// ── ROI 追踪 ──────────────────────────────────────────────────

export interface ROIMetrics {
  totalQuoteValue: number;
  wonQuoteValue: number;
  outreachCount: number;
  replyCount: number;
  replyRate: number;
  costPerLead: number | null;
  costPerReply: number | null;
  estimatedROI: number | null;
  currency: string;
}

// ── 时间线趋势 ────────────────────────────────────────────────

export interface TrendPoint {
  date: string;     // YYYY-MM-DD
  value: number;
}

export interface TrendSeries {
  label: string;
  data: TrendPoint[];
}

// ── 驾驶舱完整数据 ───────────────────────────────────────────

export interface CockpitData {
  // 顶级指标
  metrics: {
    activeProspects: MetricCard;
    replyRate: MetricCard;
    quoteValue: MetricCard;
    wonDeals: MetricCard;
  };

  // 外贸漏斗
  funnel: TradeFunnel;

  // ROI
  roi: ROIMetrics;

  // 趋势（最近 4 周）
  trends: {
    newProspects: TrendSeries;
    replies: TrendSeries;
    quotesSent: TrendSeries;
  };

  // 热门活动排行
  topCampaigns: {
    id: string;
    name: string;
    prospects: number;
    qualified: number;
    contacted: number;
    replyRate: number;
  }[];

  // 数据周期
  periodLabel: string;
  generatedAt: string;
}

// ── 周报 ──────────────────────────────────────────────────────

export interface WeeklyReport {
  id: string;
  weekLabel: string;       // "2026-W15"
  periodStart: string;
  periodEnd: string;
  summary: string;         // AI 生成的自然语言摘要
  highlights: string[];    // 本周亮点
  concerns: string[];      // 需要关注的问题
  recommendations: string[]; // AI 建议
  metrics: CockpitData;
  generatedAt: string;
}
