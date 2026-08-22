-- Quote Operations Phase 2 — additive-only（无 DROP / 无 rename / 无破坏性 ALTER / 无 backfill / 无 seed）
-- 新表 QuoteCostImport（供应商报价/成本表导入：Upload → Extract → Review → Confirm → Apply）
-- QuoteLineItem + section/optional/allowance/taxable/sourceJson（客户报价行）
-- ProjectQuote + customerJson/termsJson（客户抬头/条款快照）
-- Project + bidQuoteId（Tender 我方报价显式指针，逻辑引用无 FK）
-- 功能门：TENDER_QUOTE_ENGINE_ENABLED（default OFF）；生产部署走 safe-migrate-deploy runbook，不由本 PR 执行。
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "bidQuoteId" TEXT;

-- AlterTable
ALTER TABLE "ProjectQuote" ADD COLUMN     "customerJson" JSONB,
ADD COLUMN     "termsJson" JSONB;

-- AlterTable
ALTER TABLE "QuoteLineItem" ADD COLUMN     "allowance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "optional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "section" TEXT,
ADD COLUMN     "sourceJson" JSONB,
ADD COLUMN     "taxable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "QuoteCostImport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "contentHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "extractionVersion" TEXT,
    "extractedJson" JSONB,
    "reviewJson" JSONB,
    "appliedJson" JSONB,
    "metadataJson" JSONB,
    "errorMessage" TEXT,
    "supplierName" TEXT,
    "quoteDate" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "appliedAt" TIMESTAMP(3),
    "appliedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteCostImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteCostImport_orgId_projectId_idx" ON "QuoteCostImport"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "QuoteCostImport_quoteId_status_idx" ON "QuoteCostImport"("quoteId", "status");

-- CreateIndex
CREATE INDEX "QuoteCostImport_projectId_contentHash_idx" ON "QuoteCostImport"("projectId", "contentHash");

-- CreateIndex
CREATE INDEX "QuoteCostImport_sourceDocumentId_idx" ON "QuoteCostImport"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "Project_bidQuoteId_idx" ON "Project"("bidQuoteId");

-- AddForeignKey
ALTER TABLE "QuoteCostImport" ADD CONSTRAINT "QuoteCostImport_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ProjectQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

