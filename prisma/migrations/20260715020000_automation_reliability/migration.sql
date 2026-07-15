-- Phase 1: automation observability, ownership, retry and worker leases.

ALTER TABLE "TradeProspect"
ADD COLUMN "ownerId" TEXT;

UPDATE "TradeProspect" AS prospect
SET "ownerId" = campaign."createdById"
FROM "TradeCampaign" AS campaign
WHERE prospect."campaignId" = campaign."id"
  AND prospect."ownerId" IS NULL;

ALTER TABLE "TradeProspect"
ADD CONSTRAINT "TradeProspect_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "TradeProspect_orgId_ownerId_stage_idx"
ON "TradeProspect"("orgId", "ownerId", "stage");

ALTER TABLE "MarketSignal"
ADD COLUMN "analysisAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "analysisNextAttemptAt" TIMESTAMP(3),
ADD COLUMN "analysisLeaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "analysisLastError" VARCHAR(2000);

CREATE INDEX "MarketSignal_analysisStatus_analysisNextAttemptAt_idx"
ON "MarketSignal"("analysisStatus", "analysisNextAttemptAt");

CREATE INDEX "MarketSignal_analysisStatus_analysisLeaseExpiresAt_idx"
ON "MarketSignal"("analysisStatus", "analysisLeaseExpiresAt");

ALTER TABLE "PublishJob"
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN "leaseToken" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "PublishJob_channel_externalJobId_key"
ON "PublishJob"("channel", "externalJobId");

CREATE INDEX "PublishJob_channel_status_nextAttemptAt_idx"
ON "PublishJob"("channel", "status", "nextAttemptAt");

CREATE INDEX "PublishJob_channel_leaseExpiresAt_idx"
ON "PublishJob"("channel", "leaseExpiresAt");

CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "automationKey" TEXT NOT NULL,
    "orgId" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'cron',
    "status" TEXT NOT NULL DEFAULT 'running',
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "succeededCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(2000),
    "metadataJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomationRun_automationKey_startedAt_idx"
ON "AutomationRun"("automationKey", "startedAt");

CREATE INDEX "AutomationRun_orgId_automationKey_startedAt_idx"
ON "AutomationRun"("orgId", "automationKey", "startedAt");

CREATE INDEX "AutomationRun_status_startedAt_idx"
ON "AutomationRun"("status", "startedAt");
