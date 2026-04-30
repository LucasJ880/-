-- CreateTable
CREATE TABLE "TradeIntelligenceAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "caseId" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "extractedText" JSONB,
    "extractedFields" JSONB,
    "confidence" DOUBLE PRECISION,
    "warnings" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeIntelligenceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeIntelligenceAsset_orgId_idx" ON "TradeIntelligenceAsset"("orgId");

-- CreateIndex
CREATE INDEX "TradeIntelligenceAsset_caseId_idx" ON "TradeIntelligenceAsset"("caseId");

-- AddForeignKey
ALTER TABLE "TradeIntelligenceAsset" ADD CONSTRAINT "TradeIntelligenceAsset_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "TradeIntelligenceCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeIntelligenceAsset" ADD CONSTRAINT "TradeIntelligenceAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
