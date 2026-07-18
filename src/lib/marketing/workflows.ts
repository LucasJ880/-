import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  dispatchActivepiecesWebhook,
  type MarketingFlowKey,
} from "./activepieces";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function appBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

export async function dispatchMarketingWorkflow(input: {
  orgId: string;
  userId: string;
  flowKey: MarketingFlowKey;
  data?: Record<string, unknown>;
  requestId?: string;
}) {
  const organization = await db.organization.findFirst({
    where: { id: input.orgId, status: "active" },
    select: { id: true },
  });
  if (!organization) throw new Error("组织不存在或已停用");

  const requestId = input.requestId?.trim() || crypto.randomUUID();
  const existingRun = input.requestId
    ? await db.marketingWorkflowRun.findUnique({ where: { requestId } })
    : null;
  if (existingRun) {
    if (existingRun.orgId !== input.orgId || existingRun.flowKey !== input.flowKey) {
      throw new Error("自动流请求标识已被其他组织或流程使用");
    }
    return existingRun;
  }
  const run = await db.marketingWorkflowRun.create({
    data: {
      orgId: input.orgId,
      flowKey: input.flowKey,
      requestId,
      triggeredById: input.userId,
      inputJson: jsonValue(input.data ?? {}),
    },
  }).catch(async (error: unknown) => {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    if (input.requestId && code === "P2002") {
      const concurrentRun = await db.marketingWorkflowRun.findUnique({ where: { requestId } });
      if (concurrentRun && concurrentRun.orgId === input.orgId && concurrentRun.flowKey === input.flowKey) {
        return concurrentRun;
      }
    }
    throw error;
  });

  const payload = {
    schemaVersion: "1.0",
    requestId,
    workflowRunId: run.id,
    orgId: input.orgId,
    flowKey: input.flowKey,
    callbackUrl: `${appBaseUrl()}/api/integrations/activepieces/webhook`,
    requestedAt: new Date().toISOString(),
    data: input.data ?? {},
  };

  try {
    const dispatched = await dispatchActivepiecesWebhook({
      flowKey: input.flowKey,
      requestId,
      payload,
    });
    if (!dispatched.configured) {
      return db.marketingWorkflowRun.update({
        where: { id: run.id },
        data: {
          status: "skipped",
          error: "Activepieces 流程尚未配置",
          completedAt: new Date(),
        },
      });
    }
    return db.marketingWorkflowRun.update({
      where: { id: run.id },
      data: {
        status: "dispatched",
        externalRunId: dispatched.externalRunId,
        outputJson: jsonValue(dispatched.response),
        startedAt: new Date(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.marketingWorkflowRun.update({
      where: { id: run.id },
      data: { status: "failed", error: message.slice(0, 4000), completedAt: new Date() },
    });
    throw error;
  }
}
