-- Phase 3 Step 2B: AgentTask CAS lease fields for project_orchestrator worker

ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT;
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "AgentTask_taskType_status_nextAttemptAt_idx"
  ON "AgentTask"("taskType", "status", "nextAttemptAt");
CREATE INDEX IF NOT EXISTS "AgentTask_taskType_status_leaseExpiresAt_idx"
  ON "AgentTask"("taskType", "status", "leaseExpiresAt");
