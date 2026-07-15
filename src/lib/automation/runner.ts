import type { Prisma } from "@prisma/client";
import type { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { AutomationKey } from "./registry";

export type AutomationRunStatus = "succeeded" | "partial" | "skipped" | "failed";

export interface AutomationOutcome<T> {
  data: T;
  status?: AutomationRunStatus;
  processedCount?: number;
  succeededCount?: number;
  failedCount?: number;
  metadata?: Prisma.InputJsonObject;
}

interface RunOptions {
  orgId?: string;
  trigger?: "cron" | "manual" | "webhook" | "worker";
}

const STALE_RUN_MS = 30 * 60 * 1000;

export async function runTrackedAutomation<T>(
  automationKey: AutomationKey,
  task: () => Promise<AutomationOutcome<T>>,
  options: RunOptions = {},
): Promise<T> {
  const startedAt = new Date();
  let runId: string | null = null;

  try {
    await db.automationRun.updateMany({
      where: {
        automationKey,
        status: "running",
        startedAt: { lt: new Date(startedAt.getTime() - STALE_RUN_MS) },
      },
      data: {
        status: "failed",
        error: "上一次执行超过 30 分钟未结束，已自动关闭",
        completedAt: startedAt,
      },
    });
    const run = await db.automationRun.create({
      data: {
        automationKey,
        orgId: options.orgId,
        trigger: options.trigger ?? "cron",
        startedAt,
      },
      select: { id: true },
    });
    runId = run.id;
  } catch (error) {
    console.error(`[automation/${automationKey}] 无法创建运行记录`, error);
  }

  try {
    const outcome = await task();
    const failedCount = outcome.failedCount ?? 0;
    const succeededCount = outcome.succeededCount ?? 0;
    const status = outcome.status ?? (failedCount > 0 ? "partial" : "succeeded");
    const completedAt = new Date();
    if (runId) {
      await db.automationRun.update({
        where: { id: runId },
        data: {
          status,
          processedCount: outcome.processedCount ?? succeededCount + failedCount,
          succeededCount,
          failedCount,
          metadataJson: outcome.metadata,
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
      }).catch((error) => {
        console.error(`[automation/${automationKey}] 无法完成运行记录`, error);
      });
    }
    return outcome.data;
  } catch (error) {
    const completedAt = new Date();
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      await db.automationRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          failedCount: 1,
          error: message.slice(0, 2000),
          completedAt,
          durationMs: completedAt.getTime() - startedAt.getTime(),
        },
      }).catch((updateError) => {
        console.error(`[automation/${automationKey}] 无法记录失败`, updateError);
      });
    }
    throw error;
  }
}

export function runTrackedResponse(
  automationKey: AutomationKey,
  task: () => Promise<NextResponse>,
  options: RunOptions = {},
): Promise<NextResponse> {
  return runTrackedAutomation(automationKey, async () => {
    const response = await task();
    const failed = response.status >= 500;
    return {
      data: response,
      status: failed ? "failed" : "succeeded",
      failedCount: failed ? 1 : 0,
    };
  }, options);
}
