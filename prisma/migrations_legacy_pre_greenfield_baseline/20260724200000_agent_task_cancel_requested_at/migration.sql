-- Phase 3I-8: Cancel Workflow — RUNNING Child 安全中止信号
ALTER TABLE "AgentTask" ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMP(3);
