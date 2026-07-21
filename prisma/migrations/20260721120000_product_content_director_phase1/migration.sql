-- CreateTable
CREATE TABLE "TradeProduct" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "brand" TEXT,
    "category" TEXT,
    "collection" TEXT,
    "modelNumber" TEXT,
    "industryPack" TEXT NOT NULL DEFAULT 'home_textile',
    "geometryClass" TEXT NOT NULL DEFAULT 'DEFORMABLE_SURFACE',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "productId" TEXT,
    "jobId" TEXT,
    "roleAuto" TEXT NOT NULL DEFAULT 'unknown',
    "roleConfirmed" TEXT,
    "roleConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceType" TEXT NOT NULL DEFAULT 'upload',
    "blobPathname" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileName" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "productId" TEXT,
    "jobId" TEXT,
    "fieldKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "normalizedValue" JSONB,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceLocation" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'extracted',
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFactConflict" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "currentFactId" TEXT,
    "incomingFactId" TEXT,
    "currentValue" JSONB,
    "incomingValue" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFactConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductContentJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "productId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "executionMode" TEXT NOT NULL DEFAULT 'AUTOPILOT',
    "industryPack" TEXT NOT NULL DEFAULT 'home_textile',
    "selectedSku" TEXT,
    "planJson" JSONB,
    "missingFieldsJson" JSONB,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "errorMessage" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductContentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductContentJobInput" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "inputType" TEXT NOT NULL,
    "blobPathname" TEXT,
    "mimeType" TEXT,
    "fileName" TEXT,
    "textContent" TEXT,
    "url" TEXT,
    "purpose" TEXT,
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "parseResultJson" JSONB,
    "transcriptText" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductContentJobInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductContentStep" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inputJson" JSONB,
    "outputJson" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductContentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualGenerationJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "sceneType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "prompt" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualOutput" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "visualJobId" TEXT NOT NULL,
    "blobPathname" TEXT,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT,
    "model" TEXT,
    "qaOverallScore" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualQaResult" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "visualOutputId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "shapeScore" DOUBLE PRECISION NOT NULL,
    "colorScore" DOUBLE PRECISION NOT NULL,
    "patternScore" DOUBLE PRECISION,
    "textureScore" DOUBLE PRECISION,
    "logoScore" DOUBLE PRECISION,
    "textScore" DOUBLE PRECISION,
    "accessoryScore" DOUBLE PRECISION,
    "detectedChangesJson" JSONB NOT NULL,
    "recommendedStatus" TEXT NOT NULL,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualQaResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCopy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "productNameEn" TEXT,
    "titleEn" TEXT,
    "sellingPointsJson" JSONB,
    "shortDescriptionEn" TEXT,
    "longDescriptionEn" TEXT,
    "specificationsJson" JSONB,
    "packagingJson" JSONB,
    "careInstructionsEn" TEXT,
    "useCasesJson" JSONB,
    "missingInformationJson" JSONB,
    "claimsToVerifyJson" JSONB,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "blobPathname" TEXT,
    "fileName" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductContentApproval" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductContentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApprovalSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "defaultExecutionMode" TEXT NOT NULL DEFAULT 'AUTOPILOT',
    "autoAnalyzeFiles" BOOLEAN NOT NULL DEFAULT true,
    "autoCreateProductDraft" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerateLowCostVisuals" BOOLEAN NOT NULL DEFAULT true,
    "autoRunFidelityQa" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerateCopyDraft" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerateFormalDocuments" BOOLEAN NOT NULL DEFAULT false,
    "autoProcessMultipleSkus" BOOLEAN NOT NULL DEFAULT false,
    "askBeforeHighCostModel" BOOLEAN NOT NULL DEFAULT true,
    "askBeforeCreativeMode" BOOLEAN NOT NULL DEFAULT true,
    "askBeforeFormalPdf" BOOLEAN NOT NULL DEFAULT true,
    "askBeforeOverwriteApprovedContent" BOOLEAN NOT NULL DEFAULT true,
    "askBeforeExternalSend" BOOLEAN NOT NULL DEFAULT true,
    "askBeforePublish" BOOLEAN NOT NULL DEFAULT true,
    "maxAutoCostPerJobCents" INTEGER,
    "maxAutoCostPerDayCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentApprovalSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeProduct_orgId_category_idx" ON "TradeProduct"("orgId", "category");

-- CreateIndex
CREATE INDEX "TradeProduct_orgId_status_idx" ON "TradeProduct"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TradeProduct_orgId_sku_key" ON "TradeProduct"("orgId", "sku");

-- CreateIndex
CREATE INDEX "ProductAsset_orgId_productId_idx" ON "ProductAsset"("orgId", "productId");

-- CreateIndex
CREATE INDEX "ProductAsset_orgId_jobId_idx" ON "ProductAsset"("orgId", "jobId");

-- CreateIndex
CREATE INDEX "ProductFact_orgId_jobId_fieldKey_idx" ON "ProductFact"("orgId", "jobId", "fieldKey");

-- CreateIndex
CREATE INDEX "ProductFact_orgId_productId_fieldKey_idx" ON "ProductFact"("orgId", "productId", "fieldKey");

-- CreateIndex
CREATE INDEX "ProductFact_orgId_status_idx" ON "ProductFact"("orgId", "status");

-- CreateIndex
CREATE INDEX "ProductFactConflict_orgId_jobId_status_idx" ON "ProductFactConflict"("orgId", "jobId", "status");

-- CreateIndex
CREATE INDEX "ProductContentJob_orgId_status_idx" ON "ProductContentJob"("orgId", "status");

-- CreateIndex
CREATE INDEX "ProductContentJob_orgId_createdAt_idx" ON "ProductContentJob"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductContentJob_orgId_productId_idx" ON "ProductContentJob"("orgId", "productId");

-- CreateIndex
CREATE INDEX "ProductContentJobInput_orgId_jobId_idx" ON "ProductContentJobInput"("orgId", "jobId");

-- CreateIndex
CREATE INDEX "ProductContentStep_orgId_jobId_stepKey_idx" ON "ProductContentStep"("orgId", "jobId", "stepKey");

-- CreateIndex
CREATE INDEX "VisualGenerationJob_orgId_jobId_idx" ON "VisualGenerationJob"("orgId", "jobId");

-- CreateIndex
CREATE INDEX "VisualOutput_orgId_visualJobId_idx" ON "VisualOutput"("orgId", "visualJobId");

-- CreateIndex
CREATE INDEX "VisualOutput_orgId_status_idx" ON "VisualOutput"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VisualQaResult_visualOutputId_key" ON "VisualQaResult"("visualOutputId");

-- CreateIndex
CREATE INDEX "VisualQaResult_orgId_recommendedStatus_idx" ON "VisualQaResult"("orgId", "recommendedStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCopy_jobId_key" ON "ProductCopy"("jobId");

-- CreateIndex
CREATE INDEX "ProductCopy_orgId_status_idx" ON "ProductCopy"("orgId", "status");

-- CreateIndex
CREATE INDEX "GeneratedDocument_orgId_jobId_docType_idx" ON "GeneratedDocument"("orgId", "jobId", "docType");

-- CreateIndex
CREATE INDEX "ProductContentApproval_orgId_jobId_status_idx" ON "ProductContentApproval"("orgId", "jobId", "status");

-- CreateIndex
CREATE INDEX "ProductContentApproval_orgId_actionKey_idx" ON "ProductContentApproval"("orgId", "actionKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentApprovalSettings_orgId_key" ON "AgentApprovalSettings"("orgId");

-- AddForeignKey
ALTER TABLE "TradeProduct" ADD CONSTRAINT "TradeProduct_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAsset" ADD CONSTRAINT "ProductAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "TradeProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAsset" ADD CONSTRAINT "ProductAsset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFact" ADD CONSTRAINT "ProductFact_productId_fkey" FOREIGN KEY ("productId") REFERENCES "TradeProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFact" ADD CONSTRAINT "ProductFact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFactConflict" ADD CONSTRAINT "ProductFactConflict_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFactConflict" ADD CONSTRAINT "ProductFactConflict_currentFactId_fkey" FOREIGN KEY ("currentFactId") REFERENCES "ProductFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFactConflict" ADD CONSTRAINT "ProductFactConflict_incomingFactId_fkey" FOREIGN KEY ("incomingFactId") REFERENCES "ProductFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentJob" ADD CONSTRAINT "ProductContentJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentJob" ADD CONSTRAINT "ProductContentJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "TradeProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentJobInput" ADD CONSTRAINT "ProductContentJobInput_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentStep" ADD CONSTRAINT "ProductContentStep_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualGenerationJob" ADD CONSTRAINT "VisualGenerationJob_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualOutput" ADD CONSTRAINT "VisualOutput_visualJobId_fkey" FOREIGN KEY ("visualJobId") REFERENCES "VisualGenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualQaResult" ADD CONSTRAINT "VisualQaResult_visualOutputId_fkey" FOREIGN KEY ("visualOutputId") REFERENCES "VisualOutput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCopy" ADD CONSTRAINT "ProductCopy_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContentApproval" ADD CONSTRAINT "ProductContentApproval_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalSettings" ADD CONSTRAINT "AgentApprovalSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
