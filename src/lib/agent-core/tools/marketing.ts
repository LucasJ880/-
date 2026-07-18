import { db } from "@/lib/db";
import { runMarketingHealthGrader } from "@/lib/ai-grader/graders/marketing-health-grader";
import { getMarketingDashboard } from "@/lib/marketing/query-dashboard";
import { dispatchMarketingWorkflow } from "@/lib/marketing/workflows";
import { queueMarketResearchRequest } from "@/lib/market-intelligence/research-runtime";
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
  name: "marketing_request_data_sync",
  description: "向 Activepieces 提交只读渠道数据同步请求；不会发布内容或修改广告预算",
  domain: "system",
  parameters: {
    type: "object",
    properties: {
      providers: {
        type: "array",
        items: { type: "string" },
        description: "需要同步的平台，如 ga4、gsc、google_ads、meta、tiktok",
      },
    },
  },
  execute: async (ctx) => {
    const denied = await requireAccess(ctx);
    if (denied) return denied;
    try {
      const run = await dispatchMarketingWorkflow({
        orgId: ctx.orgId,
        userId: ctx.userId,
        flowKey: "sync-metrics",
        data: { providers: Array.isArray(ctx.args.providers) ? ctx.args.providers.map(String) : [] },
      });
      return { success: true, data: { id: run.id, status: run.status, error: run.error } };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
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
