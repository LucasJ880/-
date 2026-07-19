import { db } from "@/lib/db";
import { runMarketingHealthGrader } from "@/lib/ai-grader/graders/marketing-health-grader";
import { getMarketingDashboard } from "@/lib/marketing/query-dashboard";
import { dispatchMarketingWorkflow } from "@/lib/marketing/workflows";
import { queueMarketResearchRequest } from "@/lib/market-intelligence/research-runtime";
import { ingestChannelMetricRows } from "@/lib/marketing/ingest-metrics";
import {
  isSyncableMetricProvider,
  normalizeProviderHint,
} from "@/lib/marketing/channel-providers";
import { registry } from "../tool-registry";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

async function hasMarketingAccess(ctx: ToolExecutionContext): Promise<boolean> {
  if (ctx.role === "admin" || ctx.role === "super_admin") return true;
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } },
    select: { status: true },
  });
  return membership?.status === "active";
}

async function requireAccess(ctx: ToolExecutionContext): Promise<ToolExecutionResult | null> {
  if (await hasMarketingAccess(ctx)) return null;
  return { success: false, data: null, error: "无权访问该组织的增长中心" };
}

registry.register({
  name: "marketing_get_growth_summary",
  description: "读取当前组织的增长中心摘要、营销健康度、高优先级问题和进行中的活动",
  domain: "system",
  parameters: { type: "object", properties: {} },
  execute: async (ctx) => {
    const denied = await requireAccess(ctx);
    if (denied) return denied;
    const dashboard = await getMarketingDashboard(ctx.orgId);
    return { success: true, data: dashboard };
  },
});

registry.register({
  name: "marketing_run_health_scan",
  description: "运行只读营销健康检查；不会发布内容、修改预算或自动创建任务",
  domain: "system",
  parameters: { type: "object", properties: {} },
  execute: async (ctx) => {
    const denied = await requireAccess(ctx);
    if (denied) return denied;
    return { success: true, data: await runMarketingHealthGrader({ orgId: ctx.orgId, userId: ctx.userId }) };
  },
});

registry.register({
  name: "marketing_analyze",
  description: "提交青砚深度营销研究任务，后台生成证据、优先机会和增长实验草案；不直接投放或发布",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      objective: { type: "string", description: "本次需要做出的营销决策或目标" },
      targetGeography: { type: "string", description: "目标国家、城市或服务半径" },
      primaryProduct: { type: "string", description: "本次主推产品" },
      marketEvidence: { type: "string", description: "已观察到的市场或竞品证据" },
      unitEconomics: { type: "string", description: "预算、毛利、客单价或获客成本约束" },
      outputType: {
        type: "string",
        enum: ["comprehensive", "competitor-profile", "market-brief", "channel-plan", "workspace-spec", "experiment-backlog"],
      },
    },
    required: ["objective"],
  },
  execute: async (ctx) => {
    const denied = await requireAccess(ctx);
    if (denied) return denied;
    const run = await queueMarketResearchRequest({
      orgId: ctx.orgId,
      userId: ctx.userId,
      objective: String(ctx.args.objective || ""),
      targetGeography: String(ctx.args.targetGeography || ""),
      primaryProduct: String(ctx.args.primaryProduct || ""),
      marketEvidence: String(ctx.args.marketEvidence || ""),
      unitEconomics: String(ctx.args.unitEconomics || ""),
      outputType: String(ctx.args.outputType || "comprehensive"),
    });
    return {
      success: true,
      data: {
        runId: run.id,
        status: run.status,
        message: "深度市场研究已进入后台队列，完成后可在市场情报工作区查看。",
      },
    };
  },
});

registry.register({
  name: "marketing_list_channel_accounts",
  description: "列出组织已登记的营销渠道账号（Google Ads / Meta / 小红书等），供同步或灌数前对齐",
  domain: "system",
  parameters: { type: "object", properties: {} },
  execute: async (ctx) => {
    const denied = await requireAccess(ctx);
    if (denied) return denied;
    const accounts = await db.marketingChannelAccount.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        name: true,
        provider: true,
        externalAccountId: true,
        status: true,
        lastSyncedAt: true,
      },
    });
    return { success: true, data: { accounts } };
  },
});

registry.register({
  name: "marketing_request_data_sync",
  description:
    "向 Activepieces 提交渠道数据同步请求（google_ads/meta/xiaohongshu/ga4 等）；只拉数回写青砚，不会发布内容或修改广告预算",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      providers: {
        type: "array",
        items: { type: "string" },
        description: "需要同步的平台，如 google_ads、meta、xiaohongshu、ga4、tiktok",
      },
      channelAccountId: {
        type: "string",
        description: "可选，限定同步到某个已登记渠道账号",
      },
    },
  },
  execute: async (ctx) => {
    const denied = await requireAccess(ctx);
    if (denied) return denied;
    try {
      const providers = (
        Array.isArray(ctx.args.providers) ? ctx.args.providers.map(String) : []
      )
        .map((item) => normalizeProviderHint(item))
        .filter((item): item is string => Boolean(item) && isSyncableMetricProvider(item));
      const run = await dispatchMarketingWorkflow({
        orgId: ctx.orgId,
        userId: ctx.userId,
        flowKey: "sync-metrics",
        data: {
          providers:
            providers.length > 0
              ? providers
              : ["google_ads", "meta", "xiaohongshu"],
          channelAccountId:
            typeof ctx.args.channelAccountId === "string"
              ? ctx.args.channelAccountId
              : null,
        },
      });
      return {
        success: true,
        data: {
          id: run.id,
          status: run.status,
          error: run.error,
          note:
            run.status === "skipped"
              ? "Activepieces sync-metrics 未配置；可用 marketing_ingest_channel_metrics 直接灌周数据。"
              : "已请求同步，等待回调 marketing.metrics.upsert。",
        },
      };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
});

registry.register({
  name: "marketing_ingest_channel_metrics",
  description:
    "将 Google Ads / Meta / 小红书等周级花费与 KPI 写入青砚（幂等）；不改广告后台预算、不发布内容。数字员工在拿到外部报表后调用。",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        description: "google_ads / meta / xiaohongshu / ga4 等",
      },
      channelAccountId: { type: "string", description: "青砚渠道账号 id（优先）" },
      externalAccountId: { type: "string", description: "平台广告户外部 id（可与 provider 解析账号）" },
      rows: {
        type: "array",
        description: "周数据行，含 weekStart、spend、qualifiedLeads 等",
        items: { type: "object" },
      },
    },
    required: ["provider", "rows"],
  },
  execute: async (ctx) => {
    const denied = await requireAccess(ctx);
    if (denied) return denied;
    const rows = Array.isArray(ctx.args.rows) ? ctx.args.rows : [];
    if (rows.length === 0) {
      return { success: false, data: null, error: "rows 不能为空" };
    }
    try {
      const result = await ingestChannelMetricRows({
        orgId: ctx.orgId,
        userId: ctx.userId,
        provider: String(ctx.args.provider || ""),
        channelAccountId:
          typeof ctx.args.channelAccountId === "string"
            ? ctx.args.channelAccountId
            : null,
        externalAccountId:
          typeof ctx.args.externalAccountId === "string"
            ? ctx.args.externalAccountId
            : null,
        rows,
        externalEventId: `agent:${ctx.userId}:${Date.now()}`,
        maxRows: 200,
      });
      if (result.written <= 0) {
        return {
          success: false,
          data: { results: result.results.slice(0, 20) },
          error: result.results.find((row) => !row.ok)?.error || "未写入任何行",
        };
      }
      return {
        success: true,
        data: {
          written: result.written,
          failed: result.results.filter((row) => !row.ok).length,
          channelAccountId: result.channelAccountId,
          results: result.results.slice(0, 50),
        },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

registry.register({
  name: "marketing_get_mmm_summary",
  description: "读取最新 Meridian MMM 运行、渠道贡献和预算情景；只读，不会执行预算调整",
  domain: "system",
  parameters: { type: "object", properties: {} },
  execute: async (ctx) => {
    const denied = await requireAccess(ctx);
    if (denied) return denied;
    const latest = await db.mmmModelRun.findFirst({
      where: { orgId: ctx.orgId },
      include: { datasetVersion: true, contributions: true, scenarios: true },
      orderBy: { createdAt: "desc" },
    });
    return { success: true, data: latest ?? { status: "not_started", message: "尚未运行 Meridian MMM" } };
  },
});
