import { db } from "@/lib/db";
import {
  runSkill,
  SkillRunError,
  type SkillRunFailureCode,
} from "@/lib/agent-core/skills/runtime";
import type { SkillRunOutput } from "@/lib/agent-core/skills/types";
import { logAudit } from "@/lib/audit/logger";
import { getMarketingDashboard } from "@/lib/marketing/query-dashboard";
import { pushMessage } from "@/lib/messaging/gateway";
import { createNotification } from "@/lib/notifications/create";
import { createResearchPlanDraft } from "@/lib/marketing/research-plan";
import { ensureMarketingSkill, MARKETING_SKILL_SLUG } from "./skill";

const MAX_ATTEMPTS = 3;
const LEASE_MS = 6 * 60 * 1000;
const RETRY_BACKOFF_MS = [5, 30, 120].map((minutes) => minutes * 60 * 1000);

function safeInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Math.max(min, Math.min(Number.isFinite(parsed) ? parsed : fallback, max));
}

export interface MarketResearchModelConfig {
  primary: {
    model: string;
    maxTokens: number;
    reasoningEffort: "high";
    perRoundTimeoutMs: number;
    totalTimeoutMs: number;
  };
  fallback: {
    model: string;
    maxTokens: number;
    reasoningEffort: "medium";
    perRoundTimeoutMs: number;
    totalTimeoutMs: number;
  } | null;
}

export function getMarketResearchModelConfig(
  env: Record<string, string | undefined> = process.env,
): MarketResearchModelConfig {
  const primaryModel = env.OPENAI_MODEL_MARKET_INTELLIGENCE?.trim()
    || env.OPENAI_MODEL?.trim()
    || "gpt-5.6-sol";
  const fallbackModel = env.OPENAI_MODEL_MARKET_INTELLIGENCE_FALLBACK?.trim()
    || env.OPENAI_MODEL_MINI?.trim()
    || "gpt-5.6-luna";
  return {
    primary: {
      model: primaryModel,
      maxTokens: safeInt(env.OPENAI_MAX_TOKENS_MARKET_INTELLIGENCE, 16_000, 2_048, 32_768),
      reasoningEffort: "high",
      perRoundTimeoutMs: safeInt(env.OPENAI_TIMEOUT_MS_MARKET_INTELLIGENCE, 150_000, 30_000, 240_000),
      // 主备总预算控制在 Vercel 单次 300 秒生命周期内，并预留数据库收尾时间。
      totalTimeoutMs: safeInt(env.OPENAI_TOTAL_TIMEOUT_MS_MARKET_INTELLIGENCE, 180_000, 60_000, 180_000),
    },
    fallback: fallbackModel && fallbackModel !== primaryModel
      ? {
        model: fallbackModel,
        maxTokens: safeInt(env.OPENAI_MAX_TOKENS_MARKET_INTELLIGENCE_FALLBACK, 8_000, 2_048, 16_384),
        reasoningEffort: "medium",
        perRoundTimeoutMs: safeInt(env.OPENAI_TIMEOUT_MS_MARKET_INTELLIGENCE_FALLBACK, 90_000, 30_000, 180_000),
        totalTimeoutMs: safeInt(env.OPENAI_TOTAL_TIMEOUT_MS_MARKET_INTELLIGENCE_FALLBACK, 90_000, 60_000, 90_000),
      }
      : null,
  };
}

function recordStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, typeof item === "string" ? item : String(item ?? "")]),
  );
}

function failureCode(error: unknown): SkillRunFailureCode {
  return error instanceof SkillRunError ? error.code : "model_error";
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "AI 研究服务暂时不可用";
}

export async function runMarketingResearchSkill(input: {
  variables: Record<string, string>;
  userId: string;
  orgId: string;
}): Promise<SkillRunOutput & { fallbackUsed: boolean }> {
  const config = getMarketResearchModelConfig();
  try {
    const result = await runSkill({
      slug: MARKETING_SKILL_SLUG,
      variables: input.variables,
      userId: input.userId,
      orgId: input.orgId,
      execution: config.primary,
    });
    return { ...result, fallbackUsed: false };
  } catch (primaryError) {
    if (!config.fallback) throw primaryError;
    try {
      const result = await runSkill({
        slug: MARKETING_SKILL_SLUG,
        variables: input.variables,
        userId: input.userId,
        orgId: input.orgId,
        execution: config.fallback,
      });
      return { ...result, fallbackUsed: true };
    } catch (fallbackError) {
      throw new SkillRunError(
        failureMessage(fallbackError),
        failureCode(fallbackError),
        fallbackError instanceof SkillRunError ? fallbackError.executionId : "",
        fallbackError instanceof SkillRunError ? fallbackError.status : undefined,
        { cause: primaryError },
      );
    }
  }
}

export async function queueMarketResearchRun(input: {
  orgId: string;
  userId: string;
  variables: Record<string, string>;
}) {
  await ensureMarketingSkill(input.orgId);
  const config = getMarketResearchModelConfig();
  const run = await db.marketResearchRun.create({
    data: {
      orgId: input.orgId,
      createdById: input.userId,
      inputJson: input.variables,
      primaryModel: config.primary.model,
      fallbackModel: config.fallback?.model ?? null,
    },
  });
  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: "market_research_queued",
    targetType: "market_research_run",
    targetId: run.id,
    afterData: { status: run.status, primaryModel: run.primaryModel, fallbackModel: run.fallbackModel },
  });
  return run;
}

/**
 * 从主 Agent 或营销工具提交研究任务时，统一补齐企业事实和一方数据。
 * 这样所有入口都使用同一套防幻觉边界，不再各自拼装 Prompt。
 */
export async function queueMarketResearchRequest(input: {
  orgId: string;
  userId: string;
  objective: string;
  targetGeography?: string;
  primaryProduct?: string;
  marketEvidence?: string;
  unitEconomics?: string;
  outputType?: string;
}) {
  const [dashboard, brandTruth] = await Promise.all([
    getMarketingDashboard(input.orgId),
    db.marketingBrandProfile.findUnique({
      where: { orgId: input.orgId },
      select: {
        serviceAreasJson: true,
        productsJson: true,
        competitorsJson: true,
        industry: true,
      },
    }),
  ]);
  const list = (value: unknown) =>
    Array.isArray(value) ? value.map(String).filter(Boolean).join("、") : "";

  return queueMarketResearchRun({
    orgId: input.orgId,
    userId: input.userId,
    variables: {
      objective: input.objective.trim().slice(0, 20_000),
      targetGeography: (
        input.targetGeography?.trim() || list(brandTruth?.serviceAreasJson) || "待确认"
      ).slice(0, 20_000),
      primaryProduct: (
        input.primaryProduct?.trim() || list(brandTruth?.productsJson) || "待确认"
      ).slice(0, 20_000),
      salesModel: "询价型混合漏斗：内容/广告 → 咨询 → 预约量房 → 报价 → 成交",
      competitors: list(brandTruth?.competitorsJson) || "未确认竞争对手，请标记待验证",
      marketEvidence: (input.marketEvidence?.trim() || "未提供新的公开证据").slice(0, 20_000),
      firstPartyData: JSON.stringify(dashboard.summary),
      unitEconomics: (input.unitEconomics?.trim() || "未提供，禁止编造").slice(0, 20_000),
      outputType: (input.outputType?.trim() || "comprehensive").slice(0, 100),
      industry: brandTruth?.industry?.trim() || "待确认",
    },
  });
}

async function notifyMarketResearchResult(input: {
  runId: string;
  userId: string;
  status: "completed" | "failed";
  error?: string | null;
  planCreated?: boolean;
}) {
  const completed = input.status === "completed";
  const title = completed ? "市场研究报告已完成" : "市场研究任务执行失败";
  const summary = completed
    ? input.planCreated
      ? "报告已生成，并自动形成 30 天运营计划草案，正在等待 Leader 审批。"
      : "报告已生成，可前往“运营市场部 → 市场情报”查看。"
    : `任务未能完成：${input.error || "AI 研究服务暂时不可用"}`;
  const wechatText = completed
    ? input.planCreated
      ? `【青砚市场研究】\n报告已完成，并已自动生成 30 天运营计划。\n任务：${input.runId}\n计划正在等待 Leader 审批。`
      : `【青砚市场研究】\n报告已完成。\n任务：${input.runId}\n请前往运营市场部 → 市场情报查看。`
    : `【青砚市场研究】\n任务执行失败。\n任务：${input.runId}\n原因：${input.error || "AI 研究服务暂时不可用"}`;

  await Promise.allSettled([
    createNotification({
      userId: input.userId,
      type: completed ? "market_research_completed" : "market_research_failed",
      category: "marketing",
      title,
      summary,
      entityType: "market_research_run",
      entityId: input.runId,
      priority: completed ? "medium" : "high",
      sourceKey: `market_research:${input.runId}:${input.status}`,
      metadata: { route: "/operations/intelligence", status: input.status },
    }),
    pushMessage(input.userId, wechatText, { channels: ["personal_wechat", "wecom"] }),
  ]);
}

export async function executeMarketResearchRun(runId: string) {
  const now = new Date();
  const claimed = await db.marketResearchRun.updateMany({
    where: {
      id: runId,
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        {
          status: "queued",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        { status: "running", leaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      status: "running",
      attempts: { increment: 1 },
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      nextAttemptAt: null,
      startedAt: now,
      errorCode: null,
      error: null,
    },
  });
  if (claimed.count === 0) return db.marketResearchRun.findUnique({ where: { id: runId } });

  const run = await db.marketResearchRun.findUniqueOrThrow({ where: { id: runId } });
  const startedAt = Date.now();
  try {
    const output = await runMarketingResearchSkill({
      variables: recordStrings(run.inputJson),
      userId: run.createdById,
      orgId: run.orgId,
    });
    const completed = await db.marketResearchRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        outputMarkdown: output.content,
        skillExecutionId: output.executionId,
        modelUsed: output.model,
        fallbackUsed: output.fallbackUsed,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    await logAudit({
      userId: run.createdById,
      orgId: run.orgId,
      action: "market_research_completed",
      targetType: "market_research_run",
      targetId: run.id,
      afterData: {
        status: completed.status,
        modelUsed: completed.modelUsed,
        fallbackUsed: completed.fallbackUsed,
        attempts: completed.attempts,
        durationMs: completed.durationMs,
      },
    });
    let planCreated = false;
    try {
      planCreated = Boolean(await createResearchPlanDraft(run.id));
    } catch (planError) {
      await db.marketResearchRun.update({
        where: { id: run.id },
        data: { planStatus: "failed" },
      });
      await logAudit({
        userId: run.createdById,
        orgId: run.orgId,
        action: "market_research_plan_failed",
        targetType: "market_research_run",
        targetId: run.id,
        afterData: { error: failureMessage(planError).slice(0, 1000) },
      });
    }
    await notifyMarketResearchResult({
      runId: run.id,
      userId: run.createdById,
      status: "completed",
      planCreated,
    });
    return completed;
  } catch (error) {
    const code = failureCode(error);
    const retryable = code === "timeout" || code === "rate_limit" || code === "model_error";
    const exhausted = run.attempts >= MAX_ATTEMPTS;
    const shouldRetry = retryable && !exhausted;
    const backoffIndex = Math.max(0, Math.min(run.attempts - 1, RETRY_BACKOFF_MS.length - 1));
    const updated = await db.marketResearchRun.update({
      where: { id: run.id },
      data: {
        status: shouldRetry ? "queued" : "failed",
        errorCode: code,
        error: failureMessage(error).slice(0, 2000),
        skillExecutionId: error instanceof SkillRunError ? error.executionId || null : null,
        leaseExpiresAt: null,
        nextAttemptAt: shouldRetry ? new Date(Date.now() + RETRY_BACKOFF_MS[backoffIndex]) : null,
        completedAt: shouldRetry ? null : new Date(),
        durationMs: Date.now() - startedAt,
      },
    });
    await logAudit({
      userId: run.createdById,
      orgId: run.orgId,
      action: shouldRetry ? "market_research_retry_scheduled" : "market_research_failed",
      targetType: "market_research_run",
      targetId: run.id,
      afterData: {
        status: updated.status,
        errorCode: updated.errorCode,
        attempts: updated.attempts,
        nextAttemptAt: updated.nextAttemptAt,
      },
    });
    if (!shouldRetry) {
      await notifyMarketResearchResult({
        runId: run.id,
        userId: run.createdById,
        status: "failed",
        error: updated.error,
      });
    }
    return updated;
  }
}

export async function processQueuedMarketResearchRuns(limit = 1) {
  const now = new Date();
  await db.marketResearchRun.updateMany({
    where: {
      status: "running",
      attempts: { gte: MAX_ATTEMPTS },
      leaseExpiresAt: { lte: now },
    },
    data: {
      status: "failed",
      errorCode: "timeout",
      error: "市场研究连续超时，已达最大尝试次数",
      leaseExpiresAt: null,
      completedAt: now,
    },
  });
  const runs = await db.marketResearchRun.findMany({
    where: {
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { status: "queued", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: "running", leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(limit, 3)),
    select: { id: true },
  });
  const results = [];
  for (const run of runs) results.push(await executeMarketResearchRun(run.id));
  return results;
}

export async function listMarketResearchRuns(orgId: string) {
  return db.marketResearchRun.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
}
