-- Supplier Intelligence M1-S1 审计脊柱（additive-only：仅 CreateTable / 索引 / 唯一键 / FK）
-- 无 ALTER 业务列 / 无 DROP / 无 RENAME / 无 backfill。
-- 设计冻结见 docs/QYANE_SUPPLIER_INTELLIGENCE_M1_DESIGN.md（v2，PR #188）。
-- 七张表全部带 orgId；刻意不挂 Organization/User/Project FK（对齐 corporate-memory：
-- 审计留存与业务对象生命周期解耦）；Supplier/内部 FK 一律 ON DELETE RESTRICT——
-- 审计行不得因业务对象删除级联消失（B.1 §5）。
-- 生产部署走 safe-migrate-deploy runbook，不由本 PR 执行。

-- CreateTable
CREATE TABLE "SupplierSearchRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "tenderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "briefSnapshotJson" JSONB NOT NULL,
    "requirementSnapshotJson" JSONB NOT NULL,
    "sourceConfigJson" JSONB NOT NULL,
    "queriesJson" JSONB NOT NULL,
    "promptName" TEXT,
    "promptVersion" TEXT,
    "scoreVersion" TEXT NOT NULL,
    "evaluationVersion" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "statusDetailJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierSearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierDiscoverySignal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "tenderId" TEXT,
    "searchRunId" TEXT,
    "platform" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sourceOrigin" TEXT NOT NULL,
    "accountName" TEXT,
    "accountUrl" TEXT,
    "contentUrl" TEXT,
    "title" TEXT,
    "description" TEXT,
    "publishedAt" TIMESTAMP(3),
    "rawText" TEXT,
    "rawMetadataJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "linkedSupplierId" TEXT,
    "resolutionJson" JSONB,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierDiscoverySignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCapabilitySignal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "discoverySignalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT,
    "evidenceStatus" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "explanation" TEXT,
    "extractedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCapabilitySignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOffering" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "description" TEXT,
    "attributesJson" JSONB,
    "unitPrice" DECIMAL(18,2),
    "currency" TEXT,
    "moq" INTEGER,
    "leadTimeDays" INTEGER,
    "incoterm" TEXT,
    "priceStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "sourceKind" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceSignalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCandidate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "searchRunId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "offeringId" TEXT,
    "candidateKey" TEXT NOT NULL,
    "originSource" TEXT NOT NULL,
    "supplierSnapshotJson" JSONB NOT NULL,
    "offeringSnapshotJson" JSONB,
    "technicalScore" DOUBLE PRECISION,
    "commercialScore" DOUBLE PRECISION,
    "reliabilityScore" DOUBLE PRECISION,
    "importRiskScore" DOUBLE PRECISION,
    "totalScore" DOUBLE PRECISION,
    "scoreVersion" TEXT NOT NULL,
    "scoreBreakdownJson" JSONB,
    "mandatoryGateResult" TEXT NOT NULL DEFAULT 'PENDING',
    "mandatoryGateJson" JSONB,
    "recommendation" TEXT,
    "rejectionReason" TEXT,
    "discoveryConfidenceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierRequirementMatch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "requirementKey" TEXT NOT NULL,
    "requirementRefId" TEXT,
    "mandatory" BOOLEAN NOT NULL,
    "mandatoryUncertain" BOOLEAN NOT NULL DEFAULT false,
    "verdict" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "explanation" TEXT,
    "evidenceJson" JSONB NOT NULL,
    "evaluationVersion" TEXT NOT NULL,
    "evaluatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierRequirementMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCertification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "offeringId" TEXT,
    "scope" TEXT NOT NULL,
    "certificationType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLAIMED',
    "certificateNumber" TEXT,
    "issuer" TEXT,
    "validFrom" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "sourceKind" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceSignalId" TEXT,
    "archiveItemId" TEXT,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCertification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierSearchRun_orgId_status_idx" ON "SupplierSearchRun"("orgId", "status");

-- CreateIndex
CREATE INDEX "SupplierSearchRun_orgId_projectId_idx" ON "SupplierSearchRun"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "SupplierSearchRun_orgId_tenderId_idx" ON "SupplierSearchRun"("orgId", "tenderId");

-- CreateIndex
CREATE INDEX "SupplierSearchRun_orgId_createdAt_idx" ON "SupplierSearchRun"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierDiscoverySignal_orgId_status_idx" ON "SupplierDiscoverySignal"("orgId", "status");

-- CreateIndex
CREATE INDEX "SupplierDiscoverySignal_orgId_platform_idx" ON "SupplierDiscoverySignal"("orgId", "platform");

-- CreateIndex
CREATE INDEX "SupplierDiscoverySignal_orgId_linkedSupplierId_idx" ON "SupplierDiscoverySignal"("orgId", "linkedSupplierId");

-- CreateIndex
CREATE INDEX "SupplierDiscoverySignal_orgId_tenderId_idx" ON "SupplierDiscoverySignal"("orgId", "tenderId");

-- CreateIndex
CREATE INDEX "SupplierDiscoverySignal_orgId_searchRunId_idx" ON "SupplierDiscoverySignal"("orgId", "searchRunId");

-- CreateIndex
CREATE INDEX "SupplierCapabilitySignal_orgId_discoverySignalId_idx" ON "SupplierCapabilitySignal"("orgId", "discoverySignalId");

-- CreateIndex
CREATE INDEX "SupplierCapabilitySignal_orgId_type_evidenceStatus_idx" ON "SupplierCapabilitySignal"("orgId", "type", "evidenceStatus");

-- CreateIndex
CREATE INDEX "SupplierOffering_orgId_supplierId_idx" ON "SupplierOffering"("orgId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierOffering_orgId_category_idx" ON "SupplierOffering"("orgId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCandidate_candidateKey_key" ON "SupplierCandidate"("candidateKey");

-- CreateIndex
CREATE INDEX "SupplierCandidate_orgId_searchRunId_idx" ON "SupplierCandidate"("orgId", "searchRunId");

-- CreateIndex
CREATE INDEX "SupplierCandidate_orgId_supplierId_idx" ON "SupplierCandidate"("orgId", "supplierId");

-- CreateIndex
CREATE INDEX "SupplierRequirementMatch_orgId_candidateId_idx" ON "SupplierRequirementMatch"("orgId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierRequirementMatch_candidateId_requirementKey_key" ON "SupplierRequirementMatch"("candidateId", "requirementKey");

-- CreateIndex
CREATE INDEX "SupplierCertification_orgId_supplierId_status_idx" ON "SupplierCertification"("orgId", "supplierId", "status");

-- CreateIndex
CREATE INDEX "SupplierCertification_orgId_certificationType_idx" ON "SupplierCertification"("orgId", "certificationType");

-- AddForeignKey
ALTER TABLE "SupplierDiscoverySignal" ADD CONSTRAINT "SupplierDiscoverySignal_searchRunId_fkey" FOREIGN KEY ("searchRunId") REFERENCES "SupplierSearchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierDiscoverySignal" ADD CONSTRAINT "SupplierDiscoverySignal_linkedSupplierId_fkey" FOREIGN KEY ("linkedSupplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCapabilitySignal" ADD CONSTRAINT "SupplierCapabilitySignal_discoverySignalId_fkey" FOREIGN KEY ("discoverySignalId") REFERENCES "SupplierDiscoverySignal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOffering" ADD CONSTRAINT "SupplierOffering_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCandidate" ADD CONSTRAINT "SupplierCandidate_searchRunId_fkey" FOREIGN KEY ("searchRunId") REFERENCES "SupplierSearchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCandidate" ADD CONSTRAINT "SupplierCandidate_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCandidate" ADD CONSTRAINT "SupplierCandidate_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "SupplierOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRequirementMatch" ADD CONSTRAINT "SupplierRequirementMatch_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SupplierCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCertification" ADD CONSTRAINT "SupplierCertification_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCertification" ADD CONSTRAINT "SupplierCertification_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "SupplierOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

