-- Phase 3I-1～3I-3: Suggested Fact 幂等键、Conflict、AgentEvent、Task invalidation

ALTER TABLE "ProjectFact" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectFact_idempotencyKey_key" ON "ProjectFact"("idempotencyKey");

ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "invalidatedAt" TIMESTAMP(3);
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "invalidationReason" TEXT;
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "invalidationCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "revisionCount" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "AgentTask_invalidatedAt_idx" ON "AgentTask"("invalidatedAt");

CREATE TABLE IF NOT EXISTS "ProjectConflict" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "rootTaskId" TEXT,
    "sourceTaskId" TEXT,
    "sourceAgentRunId" TEXT,
    "conflictType" TEXT NOT NULL,
    "factKey" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "competingValuesJson" JSONB NOT NULL,
    "sourceReferencesJson" JSONB,
    "affectedTaskIdsJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolutionJson" JSONB,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "approvalRequestId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectConflict_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProjectConflict_idempotencyKey_key" ON "ProjectConflict"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "ProjectConflict_projectId_status_idx" ON "ProjectConflict"("projectId", "status");
CREATE INDEX IF NOT EXISTS "ProjectConflict_rootTaskId_idx" ON "ProjectConflict"("rootTaskId");
CREATE INDEX IF NOT EXISTS "ProjectConflict_sourceAgentRunId_idx" ON "ProjectConflict"("sourceAgentRunId");
CREATE INDEX IF NOT EXISTS "ProjectConflict_conflictType_factKey_idx" ON "ProjectConflict"("conflictType", "factKey");

ALTER TABLE "ProjectConflict" DROP CONSTRAINT IF EXISTS "ProjectConflict_projectId_fkey";
ALTER TABLE "ProjectConflict" ADD CONSTRAINT "ProjectConflict_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "ProjectAgentEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'system',
    "actorId" TEXT,
    "rootTaskId" TEXT,
    "taskId" TEXT,
    "payloadJson" JSONB NOT NULL,
    "visibilityScope" TEXT NOT NULL DEFAULT 'PROJECT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAgentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectAgentEvent_projectId_createdAt_idx" ON "ProjectAgentEvent"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectAgentEvent_projectId_id_idx" ON "ProjectAgentEvent"("projectId", "id");
CREATE INDEX IF NOT EXISTS "ProjectAgentEvent_rootTaskId_createdAt_idx" ON "ProjectAgentEvent"("rootTaskId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProjectAgentEvent_eventType_createdAt_idx" ON "ProjectAgentEvent"("eventType", "createdAt");

ALTER TABLE "ProjectAgentEvent" DROP CONSTRAINT IF EXISTS "ProjectAgentEvent_projectId_fkey";
ALTER TABLE "ProjectAgentEvent" ADD CONSTRAINT "ProjectAgentEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
