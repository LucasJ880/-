-- Phase 2: ProjectFact memory + AgentTask orchestration fields + dependency table

-- ── ProjectFact ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ProjectFact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "displayValue" TEXT NOT NULL,
    "unit" TEXT,
    "currency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "confidence" DOUBLE PRECISION,
    "usageScopes" JSONB NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "sourceMessageId" TEXT,
    "sourceDocumentId" TEXT,
    "sourcePage" TEXT,
    "sourceExcerpt" TEXT,
    "sourceLocation" TEXT,
    "sourceInsightId" TEXT,
    "createdById" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "supersedesFactId" TEXT,
    "lockedByArtifactId" TEXT,
    "pendingActionId" TEXT,
    "aiThreadId" TEXT,
    "agentRunId" TEXT,
    "agentTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProjectFact_projectId_factKey_status_idx"
  ON "ProjectFact"("projectId", "factKey", "status");
CREATE INDEX IF NOT EXISTS "ProjectFact_projectId_status_updatedAt_idx"
  ON "ProjectFact"("projectId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "ProjectFact_orgId_status_idx"
  ON "ProjectFact"("orgId", "status");
CREATE INDEX IF NOT EXISTS "ProjectFact_sourceMessageId_idx"
  ON "ProjectFact"("sourceMessageId");
CREATE INDEX IF NOT EXISTS "ProjectFact_pendingActionId_idx"
  ON "ProjectFact"("pendingActionId");
CREATE INDEX IF NOT EXISTS "ProjectFact_agentTaskId_idx"
  ON "ProjectFact"("agentTaskId");
CREATE INDEX IF NOT EXISTS "ProjectFact_agentRunId_idx"
  ON "ProjectFact"("agentRunId");

ALTER TABLE "ProjectFact"
  ADD CONSTRAINT "ProjectFact_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectFact"
  ADD CONSTRAINT "ProjectFact_supersedesFactId_fkey"
  FOREIGN KEY ("supersedesFactId") REFERENCES "ProjectFact"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── AgentTask orchestration fields（兼容旧投标包任务）────────
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "assignedAgentKey" TEXT;
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "instruction" TEXT;
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "progress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "blockedReason" TEXT;
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "inputSnapshot" JSONB;
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "structuredResult" JSONB;
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT;
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "returnedForRevisionReason" TEXT;

-- parentTask 自关联（parentTaskId 字段已存在）
DO $$ BEGIN
  ALTER TABLE "AgentTask"
    ADD CONSTRAINT "AgentTask_parentTaskId_fkey"
    FOREIGN KEY ("parentTaskId") REFERENCES "AgentTask"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "AgentTask_assignedAgentKey_status_idx"
  ON "AgentTask"("assignedAgentKey", "status");
CREATE INDEX IF NOT EXISTS "AgentTask_parentTaskId_idx"
  ON "AgentTask"("parentTaskId");

-- ── AgentTaskDependency ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentTaskDependency" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTaskDependency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentTaskDependency_taskId_dependsOnTaskId_key"
  ON "AgentTaskDependency"("taskId", "dependsOnTaskId");
CREATE INDEX IF NOT EXISTS "AgentTaskDependency_dependsOnTaskId_idx"
  ON "AgentTaskDependency"("dependsOnTaskId");

ALTER TABLE "AgentTaskDependency"
  ADD CONSTRAINT "AgentTaskDependency_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "AgentTask"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentTaskDependency"
  ADD CONSTRAINT "AgentTaskDependency_dependsOnTaskId_fkey"
  FOREIGN KEY ("dependsOnTaskId") REFERENCES "AgentTask"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── AgentRun ↔ AgentTask ─────────────────────────────────────
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "agentTaskId" TEXT;
CREATE INDEX IF NOT EXISTS "AgentRun_agentTaskId_idx" ON "AgentRun"("agentTaskId");

DO $$ BEGIN
  ALTER TABLE "AgentRun"
    ADD CONSTRAINT "AgentRun_agentTaskId_fkey"
    FOREIGN KEY ("agentTaskId") REFERENCES "AgentTask"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
