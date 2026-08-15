-- T4-P1: organization-scoped canonical award intelligence foundation (ADDITIVE ONLY)
-- AwardRecord = 组织级 canonical 授标事实层；AwardRecordSource = provenance 观察记录（幂等锚点）。
-- 不触碰任何既有表；无 DROP / RENAME / ALTER。

-- CreateTable
CREATE TABLE "AwardRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "buyerId" TEXT,
    "buyerNameRaw" TEXT,
    "buyerNameNormalized" TEXT,
    "projectId" TEXT,
    "winnerName" TEXT NOT NULL,
    "winnerNameNormalized" TEXT NOT NULL,
    "solicitationNumber" TEXT,
    "awardDate" TIMESTAMP(3),
    "contractAmount" DECIMAL(18,2),
    "currency" TEXT,
    "scopeSummary" TEXT,
    "confidence" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "possibleDuplicateOfId" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdByType" TEXT NOT NULL,
    "createdById" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AwardRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AwardRecordSource" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "awardRecordId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "evidenceSnippet" TEXT,
    "archiveItemId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AwardRecordSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AwardRecord_orgId_buyerNameNormalized_idx" ON "AwardRecord"("orgId", "buyerNameNormalized");

-- CreateIndex
CREATE INDEX "AwardRecord_orgId_winnerNameNormalized_idx" ON "AwardRecord"("orgId", "winnerNameNormalized");

-- CreateIndex
CREATE INDEX "AwardRecord_orgId_awardDate_idx" ON "AwardRecord"("orgId", "awardDate");

-- CreateIndex
CREATE INDEX "AwardRecord_orgId_verificationStatus_status_idx" ON "AwardRecord"("orgId", "verificationStatus", "status");

-- CreateIndex
CREATE INDEX "AwardRecord_orgId_solicitationNumber_idx" ON "AwardRecord"("orgId", "solicitationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AwardRecordSource_orgId_sourceType_sourceKey_key" ON "AwardRecordSource"("orgId", "sourceType", "sourceKey");

-- CreateIndex
CREATE INDEX "AwardRecordSource_awardRecordId_idx" ON "AwardRecordSource"("awardRecordId");

-- CreateIndex
CREATE INDEX "AwardRecordSource_orgId_sourceType_idx" ON "AwardRecordSource"("orgId", "sourceType");

-- AddForeignKey
ALTER TABLE "AwardRecordSource" ADD CONSTRAINT "AwardRecordSource_awardRecordId_fkey" FOREIGN KEY ("awardRecordId") REFERENCES "AwardRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
