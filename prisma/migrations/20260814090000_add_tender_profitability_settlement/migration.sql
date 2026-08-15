-- T2-P1.6 Tender Profitability / Settlement / Multi-Currency — additive-only
-- 无 DROP / 无 rename / 无破坏性 ALTER / 无 backfill / 无 NOT NULL 加到既有表。
-- 生产 dark：新表读写经 TENDER_PROFITABILITY_SCHEMA_READY（default OFF，fail-closed）；
-- 触碰 ProjectCost 的路径额外叠加 isLedgerProducerActive()。
-- 既有 ProjectExpenseSubmission 行的 legacy 语义：新列全 NULL →
--   estimatedCadAmount NULL + currency='CAD' ⇒ CAD 金额 = totalAmount；currency≠'CAD' ⇒ CAD 金额 UNKNOWN（排除出 CAD 合计并标记）
--   fundingSource NULL ⇒ UNSPECIFIED ⇒ 审批**不产生** payable（绝不凭空造报销义务）

-- AlterTable：ProjectExpenseSubmission 追加 FX 快照 / 出资人 / 金额确认（全部 NULLABLE，零 backfill）
ALTER TABLE "ProjectExpenseSubmission" ADD COLUMN     "fxRateCadPerOriginalUnit" DECIMAL(18,8),
ADD COLUMN     "fxRateDate" TIMESTAMP(3),
ADD COLUMN     "fxRateSource" TEXT,
ADD COLUMN     "estimatedCadAmount" DECIMAL(18,2),
ADD COLUMN     "fundingSource" TEXT,
ADD COLUMN     "paidByUserId" TEXT,
ADD COLUMN     "amountConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "amountConfirmedById" TEXT;

-- CreateTable
CREATE TABLE "ProjectExpensePayable" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "expenseSubmissionId" TEXT NOT NULL,
    "approvedProjectCostId" TEXT,
    "settlementType" TEXT NOT NULL,
    "payeeType" TEXT NOT NULL,
    "payeeUserId" TEXT,
    "payeeName" TEXT,
    "amountCad" DECIMAL(18,2) NOT NULL,
    "paidAmountCad" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectExpensePayable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectExpensePayment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "amountCad" DECIMAL(18,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "paymentReference" TEXT,
    "paidById" TEXT NOT NULL,
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectExpensePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectExpenseFxSettlement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "expenseSubmissionId" TEXT NOT NULL,
    "originalAmount" DECIMAL(18,2) NOT NULL,
    "originalCurrency" TEXT NOT NULL,
    "estimatedCadAmount" DECIMAL(18,2) NOT NULL,
    "settledFxRateCadPerOriginalUnit" DECIMAL(18,8) NOT NULL,
    "settlementDate" TIMESTAMP(3) NOT NULL,
    "fxRateSource" TEXT NOT NULL,
    "settledCadAmount" DECIMAL(18,2) NOT NULL,
    "bankFeeCad" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "finalCadAmount" DECIMAL(18,2) NOT NULL,
    "varianceCad" DECIMAL(18,2) NOT NULL,
    "previousProjectCostId" TEXT,
    "correctedProjectCostId" TEXT,
    "settledById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectExpenseFxSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRevenueEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "revenueStatus" TEXT NOT NULL,
    "description" TEXT,
    "originalAmount" DECIMAL(18,2) NOT NULL,
    "originalCurrency" TEXT NOT NULL,
    "fxRateCadPerOriginalUnit" DECIMAL(18,8) NOT NULL,
    "fxRateDate" TIMESTAMP(3) NOT NULL,
    "fxRateSource" TEXT NOT NULL,
    "amountForecastCad" DECIMAL(18,2),
    "amountRealizedCad" DECIMAL(18,2),
    "recognizedAt" TIMESTAMP(3) NOT NULL,
    "changeOrderReference" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "refs" JSONB,
    "correctionOfEntryId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRevenueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTenderLossReview" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "primaryLossReason" TEXT,
    "secondaryLossReasons" TEXT[],
    "evidence" JSONB,
    "ourBidAmountCad" DECIMAL(18,2),
    "winningBidAmountCad" DECIMAL(18,2),
    "winnerName" TEXT,
    "notes" TEXT,
    "aiSuggestedPrimaryReason" TEXT,
    "aiSuggestedSecondaryReasons" TEXT[],
    "aiSuggestionAt" TIMESTAMP(3),
    "aiSuggestionSourceRef" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "humanConfirmedById" TEXT,
    "humanConfirmedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTenderLossReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex：payable 幂等锚（一条 approved expense 至多一条 payable → 结构性防重复报销）
CREATE UNIQUE INDEX "ProjectExpensePayable_expenseSubmissionId_key" ON "ProjectExpensePayable"("expenseSubmissionId");

-- CreateIndex
CREATE INDEX "ProjectExpensePayable_orgId_projectId_status_idx" ON "ProjectExpensePayable"("orgId", "projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectExpensePayable_orgId_settlementType_status_idx" ON "ProjectExpensePayable"("orgId", "settlementType", "status");

-- CreateIndex
CREATE INDEX "ProjectExpensePayable_orgId_payeeUserId_status_idx" ON "ProjectExpensePayable"("orgId", "payeeUserId", "status");

-- CreateIndex
CREATE INDEX "ProjectExpensePayable_approvedProjectCostId_idx" ON "ProjectExpensePayable"("approvedProjectCostId");

-- CreateIndex：付款幂等键（防双击 / 重试重复放款）
CREATE UNIQUE INDEX "ProjectExpensePayment_idempotencyKey_key" ON "ProjectExpensePayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProjectExpensePayment_orgId_projectId_paidAt_idx" ON "ProjectExpensePayment"("orgId", "projectId", "paidAt");

-- CreateIndex
CREATE INDEX "ProjectExpensePayment_payableId_createdAt_idx" ON "ProjectExpensePayment"("payableId", "createdAt");

-- CreateIndex：FX 结算幂等锚（重复结算收敛）
CREATE UNIQUE INDEX "ProjectExpenseFxSettlement_expenseSubmissionId_key" ON "ProjectExpenseFxSettlement"("expenseSubmissionId");

-- CreateIndex
CREATE INDEX "ProjectExpenseFxSettlement_orgId_projectId_idx" ON "ProjectExpenseFxSettlement"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectExpenseFxSettlement_correctedProjectCostId_idx" ON "ProjectExpenseFxSettlement"("correctedProjectCostId");

-- CreateIndex
CREATE INDEX "ProjectRevenueEntry_orgId_projectId_revenueStatus_idx" ON "ProjectRevenueEntry"("orgId", "projectId", "revenueStatus");

-- CreateIndex
CREATE INDEX "ProjectRevenueEntry_orgId_entryType_revenueStatus_idx" ON "ProjectRevenueEntry"("orgId", "entryType", "revenueStatus");

-- CreateIndex
CREATE INDEX "ProjectRevenueEntry_correctionOfEntryId_idx" ON "ProjectRevenueEntry"("correctionOfEntryId");

-- CreateIndex：每项目至多一条落标复盘
CREATE UNIQUE INDEX "ProjectTenderLossReview_projectId_key" ON "ProjectTenderLossReview"("projectId");

-- CreateIndex
CREATE INDEX "ProjectTenderLossReview_orgId_status_idx" ON "ProjectTenderLossReview"("orgId", "status");

-- CreateIndex
CREATE INDEX "ProjectTenderLossReview_orgId_primaryLossReason_idx" ON "ProjectTenderLossReview"("orgId", "primaryLossReason");

-- AddForeignKey：唯一内部 FK（Restrict）—— 对齐 ProjectEventActor / MemoryClaimEvidence 先例，禁级联抹史
ALTER TABLE "ProjectExpensePayment" ADD CONSTRAINT "ProjectExpensePayment_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "ProjectExpensePayable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
