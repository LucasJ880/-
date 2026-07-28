-- Growth Center team approval and research-to-plan workflow.
-- Existing PendingAction rows remain personal approvals because all scope columns are nullable.

ALTER TABLE "PendingAction"
  ADD COLUMN "orgId" TEXT,
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "approverUserId" TEXT,
  ADD COLUMN "requiredRole" TEXT,
  ADD COLUMN "decidedById" TEXT;

ALTER TABLE "PendingAction"
  ADD CONSTRAINT "PendingAction_approverUserId_fkey"
  FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "PendingAction_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PendingAction_approverUserId_status_createdAt_idx"
  ON "PendingAction"("approverUserId", "status", "createdAt");
CREATE INDEX "PendingAction_orgId_status_createdAt_idx"
  ON "PendingAction"("orgId", "status", "createdAt");
CREATE INDEX "PendingAction_projectId_status_createdAt_idx"
  ON "PendingAction"("projectId", "status", "createdAt");

ALTER TABLE "MarketResearchRun"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "planId" TEXT,
  ADD COLUMN "pendingActionId" TEXT,
  ADD COLUMN "actionDraftJson" JSONB,
  ADD COLUMN "planStatus" TEXT NOT NULL DEFAULT 'none';

CREATE UNIQUE INDEX "MarketResearchRun_planId_key" ON "MarketResearchRun"("planId");
CREATE INDEX "MarketResearchRun_orgId_planStatus_createdAt_idx"
  ON "MarketResearchRun"("orgId", "planStatus", "createdAt");

ALTER TABLE "MarketingPlan"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "sourceResearchRunId" TEXT,
  ADD COLUMN "pendingActionId" TEXT;

CREATE UNIQUE INDEX "MarketingPlan_sourceResearchRunId_key"
  ON "MarketingPlan"("sourceResearchRunId");

ALTER TABLE "MarketingPlanItem"
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "successMetric" TEXT,
  ADD COLUMN "targetValue" TEXT,
  ADD COLUMN "stopCondition" TEXT,
  ADD COLUMN "evidenceSummary" TEXT,
  ADD COLUMN "confidence" INTEGER;
