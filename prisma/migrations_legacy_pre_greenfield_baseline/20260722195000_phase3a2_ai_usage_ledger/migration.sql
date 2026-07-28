-- Phase 3A-2: AiUsageLedger（新增表；不改 ProductContentCostEntry）

CREATE TABLE IF NOT EXISTS "AiUsageLedger" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "userId" TEXT,
    "traceId" TEXT,
    "runId" TEXT,
    "parentRunId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "usageType" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "imageCount" INTEGER,
    "audioSeconds" DOUBLE PRECISION,
    "durationMs" INTEGER,
    "costAmount" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "pricingVersion" TEXT,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" JSONB,

    CONSTRAINT "AiUsageLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiUsageLedger_idempotencyKey_key" ON "AiUsageLedger"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "AiUsageLedger_orgId_occurredAt_idx" ON "AiUsageLedger"("orgId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AiUsageLedger_workspaceId_occurredAt_idx" ON "AiUsageLedger"("workspaceId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AiUsageLedger_traceId_idx" ON "AiUsageLedger"("traceId");
CREATE INDEX IF NOT EXISTS "AiUsageLedger_runId_idx" ON "AiUsageLedger"("runId");
CREATE INDEX IF NOT EXISTS "AiUsageLedger_provider_model_idx" ON "AiUsageLedger"("provider", "model");
CREATE INDEX IF NOT EXISTS "AiUsageLedger_orgId_sourceType_sourceId_idx" ON "AiUsageLedger"("orgId", "sourceType", "sourceId");

ALTER TABLE "AiUsageLedger"
  DROP CONSTRAINT IF EXISTS "AiUsageLedger_orgId_fkey";
ALTER TABLE "AiUsageLedger"
  ADD CONSTRAINT "AiUsageLedger_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
