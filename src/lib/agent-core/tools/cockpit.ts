/**
 * 驾驶舱工具 — 注册到 Agent Core
 */

import { registry } from "../tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

registry.register({
  name: "cockpit.get_metrics",
  description: "获取老板驾驶舱核心指标：活跃线索、回复率、报价总额、成交数、漏斗数据、ROI",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async (ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { computeCockpitData } = await import("@/lib/cockpit/metrics-engine");
    try {
      const data = await computeCockpitData(ctx.orgId);
      return {
        success: true,
        data: {
          metrics: data.metrics,
          funnel: {
            total: data.funnel.totalProspects,
            won: data.funnel.wonCount,
            conversion: data.funnel.overallConversion,
            stages: data.funnel.stages.map((s) => ({
              label: s.label,
              count: s.count,
            })),
          },
          roi: data.roi,
          topCampaigns: data.topCampaigns.slice(0, 3),
          period: data.periodLabel,
        },
      };
    } catch (e) {
      return { success: false, data: null, error: e instanceof Error ? e.message : String(e) };
    }
  },
});

registry.register({
  name: "cockpit.get_weekly_report",
  description: "获取本周 AI 生成的周报（含业绩摘要、亮点、风险、建议）",
  domain: "trade",
  parameters: {
    type: "object",
    properties: {
      generate: {
        type: "string",
        description: "是否强制重新生成，传 true 则重新生成",
      },
    },
  },
  execute: async (ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const { getLatestReport, generateWeeklyReport } = await import("@/lib/cockpit/weekly-report");

    try {
      const shouldGenerate = ctx.args.generate === "true";

      if (shouldGenerate) {
        const report = await generateWeeklyReport(ctx.orgId);
        return { success: true, data: report };
      }

      const existing = await getLatestReport(ctx.orgId);
      if (existing) {
        return { success: true, data: existing };
      }

      const report = await generateWeeklyReport(ctx.orgId);
      return { success: true, data: report };
    } catch (e) {
      return { success: false, data: null, error: e instanceof Error ? e.message : String(e) };
    }
  },
});
