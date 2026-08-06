CREATE TABLE "MarketingEconomicsSetting" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "defaultGrossMarginRate" DOUBLE PRECISION,
    "targetRoas" DOUBLE PRECISION,
    "targetRoi" DOUBLE PRECISION,
    "attributionWindowDays" INTEGER NOT NULL DEFAULT 90,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "productMarginsJson" JSONB NOT NULL DEFAULT '[]',
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingEconomicsSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingEconomicsSetting_orgId_key" ON "MarketingEconomicsSetting"("orgId");
CREATE INDEX "MarketingEconomicsSetting_orgId_idx" ON "MarketingEconomicsSetting"("orgId");

ALTER TABLE "MarketingMetricSnapshot"
ADD COLUMN "otherMarketingCost" DOUBLE PRECISION NOT NULL DEFAULT 0;
