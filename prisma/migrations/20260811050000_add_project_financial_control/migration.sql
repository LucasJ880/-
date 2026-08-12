-- T2-P1.5 Project Financial Control — additive-only（无 DROP / 无 rename / 无破坏性 ALTER / 无 backfill）
-- 生产 dark：TENDER_FINANCIAL_CONTROL_ENABLED default OFF；审批产成本再叠加 T2_LEDGER_PRODUCERS_ENABLED。

-- CreateTable
CREATE TABLE "ProjectBudget" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "awardBaselineVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBudgetVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "totalBudgetAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "baselineFrozenById" TEXT,
    "baselineFrozenAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBudgetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBudgetLine" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "budgetVersionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "percentage" DECIMAL(9,4),
    "basis" TEXT,
    "basisAmount" DECIMAL(18,2),
    "note" TEXT,
    "supplierName" TEXT,
    "sourceReference" TEXT,
    "relatedTaskId" TEXT,
    "relatedMilestoneId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectExpenseSubmission" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "budgetLineId" TEXT,
    "costCategory" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "expenseOccurredAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "projectPhaseSnapshot" TEXT,
    "projectStageSnapshot" TEXT,
    "relatedTaskId" TEXT,
    "relatedMilestoneId" TEXT,
    "vendorName" TEXT,
    "description" TEXT NOT NULL,
    "subtotal" DECIMAL(18,2),
    "taxAmount" DECIMAL(18,2),
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "approvedProjectCostId" TEXT,
    "transitionCount" INTEGER NOT NULL DEFAULT 0,
    "extractedVendorName" TEXT,
    "extractedDate" TIMESTAMP(3),
    "extractedSubtotal" DECIMAL(18,2),
    "extractedTax" DECIMAL(18,2),
    "extractedTotal" DECIMAL(18,2),
    "extractedCategory" TEXT,
    "extractionConfidence" DECIMAL(5,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectExpenseSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectExpenseAttachment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "expenseSubmissionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "captureMethod" TEXT NOT NULL DEFAULT 'upload',
    "uploadedById" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectExpenseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectBudget_orgId_projectId_idx" ON "ProjectBudget"("orgId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBudget_orgId_projectId_key" ON "ProjectBudget"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectBudgetVersion_orgId_projectId_status_idx" ON "ProjectBudgetVersion"("orgId", "projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectBudgetVersion_budgetId_idx" ON "ProjectBudgetVersion"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBudgetVersion_budgetId_versionNumber_key" ON "ProjectBudgetVersion"("budgetId", "versionNumber");

-- CreateIndex
CREATE INDEX "ProjectBudgetLine_orgId_projectId_idx" ON "ProjectBudgetLine"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectBudgetLine_budgetVersionId_sortOrder_idx" ON "ProjectBudgetLine"("budgetVersionId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProjectExpenseSubmission_orgId_projectId_status_idx" ON "ProjectExpenseSubmission"("orgId", "projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectExpenseSubmission_projectId_status_idx" ON "ProjectExpenseSubmission"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectExpenseSubmission_submittedById_idx" ON "ProjectExpenseSubmission"("submittedById");

-- CreateIndex
CREATE INDEX "ProjectExpenseSubmission_budgetLineId_idx" ON "ProjectExpenseSubmission"("budgetLineId");

-- CreateIndex
CREATE INDEX "ProjectExpenseSubmission_approvedProjectCostId_idx" ON "ProjectExpenseSubmission"("approvedProjectCostId");

-- CreateIndex
CREATE INDEX "ProjectExpenseAttachment_orgId_projectId_idx" ON "ProjectExpenseAttachment"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectExpenseAttachment_expenseSubmissionId_idx" ON "ProjectExpenseAttachment"("expenseSubmissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectExpenseAttachment_expenseSubmissionId_contentHash_key" ON "ProjectExpenseAttachment"("expenseSubmissionId", "contentHash");
