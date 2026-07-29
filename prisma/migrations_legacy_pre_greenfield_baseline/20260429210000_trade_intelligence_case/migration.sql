-- Trade Intelligence / 竞品溯源 MVP
CREATE TABLE "TradeIntelligenceCase" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "productName" TEXT,
    "brand" TEXT,
    "upc" TEXT,
    "gtin" TEXT,
    "sku" TEXT,
    "mpn" TEXT,
    "productUrl" TEXT,
    "retailerName" TEXT,
    "category" TEXT,
    "material" TEXT,
    "size" TEXT,
    "color" TEXT,
    "countryOfOrigin" TEXT,
    "notes" TEXT,
    "structuredProduct" JSONB,
    "searchQueries" JSONB,
    "evidence" JSONB,
    "buyerCandidates" JSONB,
    "retailerCandidates" JSONB,
    "importerCandidates" JSONB,
    "supplierCandidates" JSONB,
    "contactCandidates" JSONB,
    "recommendedProspects" JSONB,
    "analysisReport" TEXT,
    "confidenceScore" DOUBLE PRECISION,
    "lastRunAt" TIMESTAMP(3),
    "lastError" VARCHAR(2000),
    "convertedProspectId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeIntelligenceCase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradeIntelligenceCase_orgId_idx" ON "TradeIntelligenceCase"("orgId");
CREATE INDEX "TradeIntelligenceCase_orgId_status_idx" ON "TradeIntelligenceCase"("orgId", "status");
CREATE INDEX "TradeIntelligenceCase_orgId_createdAt_idx" ON "TradeIntelligenceCase"("orgId", "createdAt");
CREATE INDEX "TradeIntelligenceCase_orgId_upc_idx" ON "TradeIntelligenceCase"("orgId", "upc");
CREATE INDEX "TradeIntelligenceCase_orgId_mpn_idx" ON "TradeIntelligenceCase"("orgId", "mpn");

ALTER TABLE "TradeIntelligenceCase" ADD CONSTRAINT "TradeIntelligenceCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradeIntelligenceCase" ADD CONSTRAINT "TradeIntelligenceCase_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TradeIntelligenceCase" ADD CONSTRAINT "TradeIntelligenceCase_convertedProspectId_fkey" FOREIGN KEY ("convertedProspectId") REFERENCES "TradeProspect"("id") ON DELETE SET NULL ON UPDATE CASCADE;
