-- PendingAction ↔ AgentRun 硬关联

ALTER TABLE "PendingAction" ADD COLUMN "agentRunId" TEXT;

CREATE INDEX "PendingAction_agentRunId_status_idx" ON "PendingAction"("agentRunId", "status");
