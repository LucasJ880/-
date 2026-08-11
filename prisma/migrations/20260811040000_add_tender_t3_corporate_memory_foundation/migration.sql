-- CreateTable
CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "buyerType" TEXT,
    "country" TEXT,
    "province" TEXT,
    "city" TEXT,
    "websiteDomain" TEXT,
    "officialWebsite" TEXT,
    "aliases" TEXT[],
    "externalIdentifiers" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryClaim" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "claimType" TEXT NOT NULL,
    "claimNature" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "structuredValue" JSONB,
    "confidence" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "supersedesClaimId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "retractedAt" TIMESTAMP(3),
    "retractionReason" TEXT,
    "accessClass" TEXT NOT NULL DEFAULT 'INTERNAL_COMPANY',
    "createdByType" TEXT NOT NULL,
    "createdById" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryClaimEvidence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceKey" TEXT,
    "archiveItemId" TEXT,
    "documentId" TEXT,
    "pageNumber" INTEGER,
    "sectionLabel" TEXT,
    "sourceUrl" TEXT,
    "sourceSnippet" TEXT,
    "contentHash" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "accessClass" TEXT NOT NULL DEFAULT 'INTERNAL_COMPANY',
    "metadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryClaimEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Buyer_orgId_normalizedName_idx" ON "Buyer"("orgId", "normalizedName");

-- CreateIndex
CREATE INDEX "Buyer_orgId_websiteDomain_idx" ON "Buyer"("orgId", "websiteDomain");

-- CreateIndex
CREATE INDEX "Buyer_orgId_status_idx" ON "Buyer"("orgId", "status");

-- CreateIndex
CREATE INDEX "MemoryClaim_orgId_subjectType_subjectKey_status_idx" ON "MemoryClaim"("orgId", "subjectType", "subjectKey", "status");

-- CreateIndex
CREATE INDEX "MemoryClaim_orgId_claimType_status_idx" ON "MemoryClaim"("orgId", "claimType", "status");

-- CreateIndex
CREATE INDEX "MemoryClaim_orgId_status_capturedAt_idx" ON "MemoryClaim"("orgId", "status", "capturedAt");

-- CreateIndex
CREATE INDEX "MemoryClaim_supersedesClaimId_idx" ON "MemoryClaim"("supersedesClaimId");

-- CreateIndex
CREATE INDEX "MemoryClaimEvidence_claimId_idx" ON "MemoryClaimEvidence"("claimId");

-- CreateIndex
CREATE INDEX "MemoryClaimEvidence_orgId_sourceType_idx" ON "MemoryClaimEvidence"("orgId", "sourceType");

-- CreateIndex
CREATE INDEX "MemoryClaimEvidence_orgId_archiveItemId_idx" ON "MemoryClaimEvidence"("orgId", "archiveItemId");

-- AddForeignKey
ALTER TABLE "MemoryClaimEvidence" ADD CONSTRAINT "MemoryClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "MemoryClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
