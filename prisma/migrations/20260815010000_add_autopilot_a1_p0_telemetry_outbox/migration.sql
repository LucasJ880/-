-- Autopilot A1-P0: durable telemetry outbox for AgentRun events.
-- ADDITIVE ONLY. Does not alter AgentRun / AgentRunEvent / AutopilotRun columns.
-- Do not run against production from this PR.

-- CreateTable
CREATE TABLE "AutopilotTelemetryOutbox" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "agentEventId" TEXT,
    "sequence" INTEGER,
    "noticeType" TEXT NOT NULL,
    "sourceEventType" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorSummary" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotTelemetryOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotTelemetryOutbox_idempotencyKey_key" ON "AutopilotTelemetryOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AutopilotTelemetryOutbox_status_nextAttemptAt_idx" ON "AutopilotTelemetryOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AutopilotTelemetryOutbox_status_leaseExpiresAt_idx" ON "AutopilotTelemetryOutbox"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "AutopilotTelemetryOutbox_orgId_status_idx" ON "AutopilotTelemetryOutbox"("orgId", "status");

-- CreateIndex
CREATE INDEX "AutopilotTelemetryOutbox_agentRunId_idx" ON "AutopilotTelemetryOutbox"("agentRunId");

-- CreateIndex
CREATE INDEX "AutopilotTelemetryOutbox_agentEventId_idx" ON "AutopilotTelemetryOutbox"("agentEventId");

-- AddForeignKey
ALTER TABLE "AutopilotTelemetryOutbox" ADD CONSTRAINT "AutopilotTelemetryOutbox_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
