-- Quote & Cost Engine Phase 1 — additive-only（无 DROP / 无 rename / 无破坏性 ALTER / 无 backfill）
-- 扩展 ProjectQuote（引擎字段全部可空/带默认，legacy 报价行为不变）+ 新增 QuoteCostLine / QuotePricingTier。
-- 生产 dark：TENDER_QUOTE_ENGINE_ENABLED default OFF；本迁移由 Lucas 按 safe-migrate-deploy runbook 受控执行，本轮不动生产库。

-- AlterTable
ALTER TABLE "ProjectQuote" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "awardedAt" TIMESTAMP(3),
ADD COLUMN     "calcVersion" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "engineJson" JSONB,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "orgId" TEXT,
ADD COLUMN     "pricingMethod" TEXT NOT NULL DEFAULT 'MARKUP_ON_COST',
ADD COLUMN     "pricingRate" DECIMAL(9,4),
ADD COLUMN     "quoteNumber" TEXT,
ADD COLUMN     "quoteType" TEXT NOT NULL DEFAULT 'CUSTOM',
ADD COLUMN     "revisionReason" TEXT,
ADD COLUMN     "sourceQuoteId" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "summaryJson" JSONB,
ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "QuoteCostLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "orgId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4),
    "unit" TEXT,
    "unitCost" DECIMAL(18,4),
    "sourceCurrency" TEXT NOT NULL DEFAULT 'CAD',
    "fxRate" DECIMAL(18,8),
    "fxRateSource" TEXT,
    "fxRateDate" TIMESTAMP(3),
    "calculationType" TEXT NOT NULL DEFAULT 'FIXED',
    "calculationBase" TEXT,
    "rate" DECIMAL(9,4),
    "duration" DECIMAL(18,4),
    "supplierId" TEXT,
    "supplierName" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "calculatedCost" DECIMAL(18,2),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteCostLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotePricingTier" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "orgId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "tierName" TEXT NOT NULL,
    "minQuantity" DECIMAL(18,2) NOT NULL,
    "maxQuantity" DECIMAL(18,2),
    "expectedQuantity" DECIMAL(18,2) NOT NULL,
    "pricingMethod" TEXT NOT NULL DEFAULT 'MARKUP_ON_COST',
    "rate" DECIMAL(9,4),
    "unitPrice" DECIMAL(18,6),
    "calculatedRevenue" DECIMAL(18,2),
    "calculatedCost" DECIMAL(18,2),
    "calculatedMargin" DECIMAL(9,4),
    "containersMath" DECIMAL(18,4),
    "containersProcurement" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotePricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuoteCostLine_quoteId_sortOrder_idx" ON "QuoteCostLine"("quoteId", "sortOrder");

-- CreateIndex
CREATE INDEX "QuoteCostLine_orgId_quoteId_idx" ON "QuoteCostLine"("orgId", "quoteId");

-- CreateIndex
CREATE INDEX "QuoteCostLine_quoteId_category_idx" ON "QuoteCostLine"("quoteId", "category");

-- CreateIndex
CREATE INDEX "QuotePricingTier_quoteId_sortOrder_idx" ON "QuotePricingTier"("quoteId", "sortOrder");

-- CreateIndex
CREATE INDEX "QuotePricingTier_orgId_quoteId_idx" ON "QuotePricingTier"("orgId", "quoteId");

-- CreateIndex
CREATE INDEX "ProjectQuote_orgId_quoteNumber_idx" ON "ProjectQuote"("orgId", "quoteNumber");

-- CreateIndex
CREATE INDEX "ProjectQuote_sourceQuoteId_idx" ON "ProjectQuote"("sourceQuoteId");

-- AddForeignKey
ALTER TABLE "QuoteCostLine" ADD CONSTRAINT "QuoteCostLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ProjectQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePricingTier" ADD CONSTRAINT "QuotePricingTier_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ProjectQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

