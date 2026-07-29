-- Phase-B: AgentRun 后台队列租约字段

ALTER TABLE "AgentRun" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentRun" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "AgentRun" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE INDEX "AgentRun_status_nextAttemptAt_idx" ON "AgentRun"("status", "nextAttemptAt");
CREATE INDEX "AgentRun_status_leaseExpiresAt_idx" ON "AgentRun"("status", "leaseExpiresAt");
