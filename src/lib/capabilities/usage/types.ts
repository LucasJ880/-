/**
 * Phase 3A-2：AI 使用账本类型
 */

export type AiUsageSourceType =
  | "AGENT_RUNTIME"
  | "PRODUCT_CONTENT"
  | "IMAGE_ENGINE"
  | "SUPERVISOR"
  | "WORKFLOW"
  | "MANUAL_IMPORT";

export type AiUsageType = "TEXT" | "IMAGE" | "EMBEDDING" | "AUDIO" | "OTHER";

export type AiUsageStatus =
  | "SUCCEEDED"
  | "FAILED"
  | "PARTIAL"
  | "ESTIMATED";

export type AiUsagePricingMode = "exact" | "estimated";

export type RecordAiUsageInput = {
  orgId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  userId?: string | null;
  traceId?: string | null;
  runId?: string | null;
  parentRunId?: string | null;
  sourceType: AiUsageSourceType;
  sourceId?: string | null;
  idempotencyKey: string;
  provider: string;
  model: string;
  usageType: AiUsageType;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  imageCount?: number | null;
  audioSeconds?: number | null;
  durationMs?: number | null;
  /** 调用发生时金额；不按未来价重算 */
  costAmount: number;
  currency?: string;
  pricingVersion?: string | null;
  pricingMode?: AiUsagePricingMode;
  status: AiUsageStatus;
  errorCode?: string | null;
  occurredAt?: Date;
  metadata?: Record<string, unknown> | null;
};

export type AiUsageLedgerView = {
  id: string;
  orgId: string;
  workspaceId: string | null;
  projectId: string | null;
  userId: string | null;
  traceId: string | null;
  runId: string | null;
  parentRunId: string | null;
  sourceType: string;
  sourceId: string | null;
  provider: string;
  model: string;
  usageType: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  imageCount: number | null;
  audioSeconds: number | null;
  durationMs: number | null;
  costAmount: number;
  currency: string;
  pricingVersion: string | null;
  pricingMode: AiUsagePricingMode;
  status: string;
  errorCode: string | null;
  occurredAt: Date;
  /** adapter 标记：来自 PC 旧表且未双写 */
  fromAdapter?: boolean;
};

export type UsageSummaryBucket = {
  key: string;
  label: string;
  costAmount: number;
  currency: string;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
};

export type UsageSummaryResult = {
  orgId: string;
  currency: string;
  monthTotal: number;
  last24hTotal: number;
  byWorkspace: UsageSummaryBucket[];
  byAgent: UsageSummaryBucket[];
  bySkill: UsageSummaryBucket[];
  byModel: UsageSummaryBucket[];
  byUser: UsageSummaryBucket[];
  byDate: UsageSummaryBucket[];
};
