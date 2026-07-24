-- Agent Runtime 2.0 Phase 1: durable plan/steps/verification on AgentRun

ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "planJson" JSONB;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "runtimeVersion" TEXT;

CREATE TABLE IF NOT EXISTS "AgentRunStep" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dependsOnJson" JSONB NOT NULL DEFAULT '[]',
    "preferredTool" TEXT,
    "executionMode" TEXT NOT NULL DEFAULT 'read',
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "inputJson" JSONB,
    "outputJson" JSONB,
    "evidenceJson" JSONB,
    "pendingActionId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRunStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentRunVerification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "satisfiedCriteriaJson" JSONB NOT NULL DEFAULT '[]',
    "unsatisfiedCriteriaJson" JSONB NOT NULL DEFAULT '[]',
    "evidenceReferencesJson" JSONB NOT NULL DEFAULT '[]',
    "repairInstructionsJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRunVerification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentRunStep_runId_stepKey_key" ON "AgentRunStep"("runId", "stepKey");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentRunStep_orgId_idempotencyKey_key" ON "AgentRunStep"("orgId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "AgentRunStep_orgId_runId_idx" ON "AgentRunStep"("orgId", "runId");
CREATE INDEX IF NOT EXISTS "AgentRunStep_runId_status_idx" ON "AgentRunStep"("runId", "status");
CREATE INDEX IF NOT EXISTS "AgentRunStep_orgId_pendingActionId_idx" ON "AgentRunStep"("orgId", "pendingActionId");

CREATE UNIQUE INDEX IF NOT EXISTS "AgentRunVerification_runId_attempt_key" ON "AgentRunVerification"("runId", "attempt");
CREATE INDEX IF NOT EXISTS "AgentRunVerification_orgId_runId_idx" ON "AgentRunVerification"("orgId", "runId");

CREATE INDEX IF NOT EXISTS "AgentRun_orgId_runtimeVersion_status_idx" ON "AgentRun"("orgId", "runtimeVersion", "status");

ALTER TABLE "AgentRunStep" DROP CONSTRAINT IF EXISTS "AgentRunStep_runId_fkey";
ALTER TABLE "AgentRunStep" ADD CONSTRAINT "AgentRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentRunVerification" DROP CONSTRAINT IF EXISTS "AgentRunVerification_runId_fkey";
ALTER TABLE "AgentRunVerification" ADD CONSTRAINT "AgentRunVerification_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
