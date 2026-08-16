-- Autopilot A0 Foundation: sanitized observation overlay for AgentRun.
-- ADDITIVE ONLY. Does not alter AgentRun / AgentRunEvent columns.
-- Do not run against production from this PR.

-- CreateTable
CREATE TABLE "AutopilotRun" (
    "id" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "projectId" TEXT,
    "threadId" TEXT,
    "sessionId" TEXT,
    "agentId" TEXT,
    "agentType" TEXT,
    "agentVersion" TEXT,
    "userGoalSummary" TEXT,
    "intent" TEXT,
    "inputRef" JSONB,
    "outputRef" JSONB,
    "originalOutputRef" JSONB,
    "humanEditedOutputRef" JSONB,
    "humanEditMeta" JSONB,
    "agentRecommendation" JSONB,
    "humanDecision" JSONB,
    "humanOverride" BOOLEAN NOT NULL DEFAULT false,
    "humanEdit" BOOLEAN NOT NULL DEFAULT false,
    "reAskStatus" TEXT NOT NULL DEFAULT 'NOT_EVALUATED',
    "outcome" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "failureType" TEXT,
    "failureSource" TEXT,
    "latencyMs" INTEGER,
    "tokenUsage" JSONB,
    "estimatedCost" DECIMAL(18,6),
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopilotRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER,
    "payload" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopilotRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotRun_agentRunId_key" ON "AutopilotRun"("agentRunId");

-- CreateIndex
CREATE INDEX "AutopilotRun_orgId_startedAt_idx" ON "AutopilotRun"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "AutopilotRun_orgId_outcome_idx" ON "AutopilotRun"("orgId", "outcome");

-- CreateIndex
CREATE INDEX "AutopilotRun_orgId_agentType_idx" ON "AutopilotRun"("orgId", "agentType");

-- CreateIndex
CREATE INDEX "AutopilotRun_orgId_createdAt_idx" ON "AutopilotRun"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutopilotRunEvent_runId_sequence_key" ON "AutopilotRunEvent"("runId", "sequence");

-- CreateIndex
CREATE INDEX "AutopilotRunEvent_orgId_runId_idx" ON "AutopilotRunEvent"("orgId", "runId");

-- CreateIndex
CREATE INDEX "AutopilotRunEvent_orgId_eventType_idx" ON "AutopilotRunEvent"("orgId", "eventType");

-- AddForeignKey
ALTER TABLE "AutopilotRun" ADD CONSTRAINT "AutopilotRun_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopilotRunEvent" ADD CONSTRAINT "AutopilotRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutopilotRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
