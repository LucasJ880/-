-- Phase 3A-3: PendingAction integrity fields + ApprovalDecisionIdempotency
-- 不改历史 migration；不删旧审批表

ALTER TABLE "PendingAction" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "PendingAction" ADD COLUMN IF NOT EXISTS "payloadVersion" INTEGER;
ALTER TABLE "PendingAction" ADD COLUMN IF NOT EXISTS "payloadHash" TEXT;
ALTER TABLE "PendingAction" ADD COLUMN IF NOT EXISTS "policyVersion" TEXT;
ALTER TABLE "PendingAction" ADD COLUMN IF NOT EXISTS "resourceVersion" TEXT;

CREATE INDEX IF NOT EXISTS "PendingAction_orgId_workspaceId_status_idx"
  ON "PendingAction"("orgId", "workspaceId", "status");

CREATE TABLE IF NOT EXISTS "ApprovalDecisionIdempotency" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "approvalKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecisionIdempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalDecisionIdempotency_orgId_idempotencyKey_key"
  ON "ApprovalDecisionIdempotency"("orgId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "ApprovalDecisionIdempotency_orgId_approvalKey_idx"
  ON "ApprovalDecisionIdempotency"("orgId", "approvalKey");
