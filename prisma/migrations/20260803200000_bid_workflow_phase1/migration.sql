-- Bid Workflow Phase 1：调查室 / 事实 / 项目供应商关联 / 成员简报
-- Additive only；不在 build 中执行。Rollback: docs/QINGYAN_BID_WORKFLOW_PHASE1_IMPLEMENTATION_REPORT.md

ALTER TABLE "Project" ADD COLUMN "bidPhaseStatus" TEXT;
CREATE INDEX "Project_orgId_bidPhaseStatus_idx" ON "Project"("orgId", "bidPhaseStatus");

CREATE TABLE "ProjectSupplierLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'candidate',
    "inquiryStatus" TEXT NOT NULL DEFAULT 'not_started',
    "quoteStatus" TEXT NOT NULL DEFAULT 'none',
    "evidenceStatus" TEXT NOT NULL DEFAULT 'missing',
    "sampleStatus" TEXT NOT NULL DEFAULT 'none',
    "techMatch" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "rejectReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectSupplierLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectSupplierLink_projectId_supplierId_key"
  ON "ProjectSupplierLink"("projectId", "supplierId");
CREATE INDEX "ProjectSupplierLink_orgId_projectId_idx"
  ON "ProjectSupplierLink"("orgId", "projectId");
CREATE INDEX "ProjectSupplierLink_orgId_supplierId_idx"
  ON "ProjectSupplierLink"("orgId", "supplierId");
CREATE INDEX "ProjectSupplierLink_orgId_role_idx"
  ON "ProjectSupplierLink"("orgId", "role");

ALTER TABLE "ProjectSupplierLink"
  ADD CONSTRAINT "ProjectSupplierLink_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectSupplierLink"
  ADD CONSTRAINT "ProjectSupplierLink_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectJoinBrief" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleHint" TEXT,
    "briefMarkdown" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectJoinBrief_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectJoinBrief_projectId_userId_key"
  ON "ProjectJoinBrief"("projectId", "userId");
CREATE INDEX "ProjectJoinBrief_orgId_userId_idx"
  ON "ProjectJoinBrief"("orgId", "userId");

ALTER TABLE "ProjectJoinBrief"
  ADD CONSTRAINT "ProjectJoinBrief_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BidIntelligenceRoom" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "summaryText" TEXT,
    "summaryJson" JSONB,
    "summaryStatus" TEXT NOT NULL DEFAULT 'unknown',
    "goDecision" TEXT,
    "goDecisionById" TEXT,
    "goDecidedAt" TIMESTAMP(3),
    "goDecisionNote" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedById" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BidIntelligenceRoom_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BidIntelligenceRoom_projectId_key" ON "BidIntelligenceRoom"("projectId");
CREATE INDEX "BidIntelligenceRoom_orgId_status_idx" ON "BidIntelligenceRoom"("orgId", "status");
CREATE INDEX "BidIntelligenceRoom_orgId_goDecision_idx" ON "BidIntelligenceRoom"("orgId", "goDecision");

ALTER TABLE "BidIntelligenceRoom"
  ADD CONSTRAINT "BidIntelligenceRoom_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BidIntelligenceModule" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "dataJson" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BidIntelligenceModule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BidIntelligenceModule_roomId_moduleKey_key"
  ON "BidIntelligenceModule"("roomId", "moduleKey");
CREATE INDEX "BidIntelligenceModule_roomId_sortOrder_idx"
  ON "BidIntelligenceModule"("roomId", "sortOrder");

ALTER TABLE "BidIntelligenceModule"
  ADD CONSTRAINT "BidIntelligenceModule_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "BidIntelligenceRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BidIntelligenceFact" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "moduleKey" TEXT,
    "content" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceFileId" TEXT,
    "sourcePage" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "extractedBy" TEXT,
    "humanConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BidIntelligenceFact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BidIntelligenceFact_roomId_moduleKey_idx"
  ON "BidIntelligenceFact"("roomId", "moduleKey");
CREATE INDEX "BidIntelligenceFact_projectId_confidence_idx"
  ON "BidIntelligenceFact"("projectId", "confidence");
CREATE INDEX "BidIntelligenceFact_orgId_projectId_idx"
  ON "BidIntelligenceFact"("orgId", "projectId");

ALTER TABLE "BidIntelligenceFact"
  ADD CONSTRAINT "BidIntelligenceFact_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "BidIntelligenceRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
