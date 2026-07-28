-- Phase 3A-1: AgentRun 可空 traceId / parentRunId（历史兼容；新执行应写入）

ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "traceId" TEXT;
ALTER TABLE "AgentRun" ADD COLUMN IF NOT EXISTS "parentRunId" TEXT;

CREATE INDEX IF NOT EXISTS "AgentRun_orgId_traceId_idx" ON "AgentRun"("orgId", "traceId");
