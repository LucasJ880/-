import { db } from "@/lib/db";
import {
  runSkill,
  SkillRunError,
  type SkillRunFailureCode,
} from "@/lib/agent-core/skills/runtime";
import type { SkillRunOutput } from "@/lib/agent-core/skills/types";
import { logAudit } from "@/lib/audit/logger";
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
    || "gpt-5.6-terra";
  return {
    primary: {
      model: primaryModel,
      maxTokens: safeInt(env.OPENAI_MAX_TOKENS_MARKET_INTELLIGENCE, 16_000, 2_048, 32_768),
      reasoningEffort: "high",
      perRoundTimeoutMs: safeInt(env.OPENAI_TIMEOUT_MS_MARKET_INTELLIGENCE, 120_000, 30_000, 240_000),
      // 主备总预算控制在 Vercel 单次 300 秒生命周期内，并预留数据库收尾时间。
      totalTimeoutMs: safeInt(env.OPENAI_TOTAL_TIMEOUT_MS_MARKET_INTELLIGENCE, 180_000, 60_000, 180_000),
    },
    fallback: fallbackModel && fallbackModel !== primaryModel
      ? {
        model: fallbackModel,
        maxTokens: safeInt(env.OPENAI_MAX_TOKENS_MARKET_INTELLIGENCE_FALLBACK, 8_000, 2_048, 16_384),
        reasoningEffort: "medium",
        perRoundTimeoutMs: safeInt(env.OPENAI_TIMEOUT_MS_MARKET_INTELLIGENCE_FALLBACK, 90_000, 30_000, 180_000),
        totalTimeoutMs: safeInt(env.OPENAI_TOTAL_TIMEOUT_MS_MARKET_INTELLIGENCE_FALLBACK, 105_000, 60_000, 105_000),
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
