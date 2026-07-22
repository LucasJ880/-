/**
 * 将 monitor.recordAiCall 桥接到 AiUsageLedger（best-effort）
 */

import { getRequestContext } from "@/lib/common/request-context";
import { recordAiUsageBestEffort } from "@/lib/capabilities/usage/record";
import {
  estimateOpenAiEmbeddingCostUsd,
  estimateOpenAiTextCostUsd,
  OPENAI_PRICING_VERSION,
} from "@/lib/capabilities/usage/pricing";
import type {
  AiUsageSourceType,
  AiUsageType,
} from "@/lib/capabilities/usage/types";

/** 与 monitor.RecordAiCallInput 对齐，避免循环 import */
export type MonitorCallBridgeInput = {
  model: string;
  success: boolean;
  elapsedMs: number;
  error?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  userId?: string;
  source?: string;
};

function mapSource(source?: string): {
  sourceType: AiUsageSourceType;
  usageType: AiUsageType;
} {
  const s = (source ?? "").toLowerCase();
  if (s.includes("embed")) {
    return { sourceType: "AGENT_RUNTIME", usageType: "EMBEDDING" };
  }
  if (s.includes("supervisor")) {
    return { sourceType: "SUPERVISOR", usageType: "TEXT" };
  }
  if (s.includes("product") || s.includes("image")) {
    return { sourceType: "IMAGE_ENGINE", usageType: "IMAGE" };
  }
  return { sourceType: "AGENT_RUNTIME", usageType: "TEXT" };
}

function fingerprint(input: MonitorCallBridgeInput): string {
  return [
    input.model,
    input.success ? "1" : "0",
    input.promptTokens ?? "",
    input.completionTokens ?? "",
    input.elapsedMs,
    input.source ?? "",
  ].join(":");
}

/** 供 monitor 调用：无 orgId 则跳过 */
export function bridgeMonitorAiCallToLedger(input: MonitorCallBridgeInput): void {
  const ctx = getRequestContext();
  const orgId = ctx?.orgId;
  if (!orgId) {
    // 无法确认归属：不写入（禁止猜测）
    return;
  }

  const { sourceType, usageType } = mapSource(input.source);
  const isEmbed = usageType === "EMBEDDING";
  const priced = isEmbed
    ? estimateOpenAiEmbeddingCostUsd({
        model: input.model,
        inputTokens: input.promptTokens ?? input.totalTokens,
      })
    : estimateOpenAiTextCostUsd({
        model: input.model,
        inputTokens: input.promptTokens,
        outputTokens: input.completionTokens,
      });

  const requestId = ctx.requestId ?? "noreq";
  const idempotencyKey = `openai_call:${orgId}:${requestId}:${input.source ?? "unknown"}:${fingerprint(input)}`;

  recordAiUsageBestEffort({
    orgId,
    userId: input.userId ?? ctx.userId ?? null,
    sourceType,
    sourceId: null,
    idempotencyKey,
    provider: "openai",
    model: input.model,
    usageType,
    inputTokens: input.promptTokens ?? null,
    outputTokens: input.completionTokens ?? null,
    durationMs: input.elapsedMs,
    costAmount: priced.costAmount,
    currency: "USD",
    pricingVersion: priced.pricingVersion ?? OPENAI_PRICING_VERSION,
    pricingMode: "estimated",
    status: input.success ? "ESTIMATED" : "FAILED",
    errorCode: input.success ? null : input.error?.slice(0, 120) ?? "ai_call_failed",
    occurredAt: new Date(),
    metadata: {
      route: ctx.route,
      monitorSource: input.source,
      pricingMode: "estimated",
    },
  });
}
