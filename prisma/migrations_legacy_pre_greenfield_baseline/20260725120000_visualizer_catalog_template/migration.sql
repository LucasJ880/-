-- AlterTable
ALTER TABLE "VisualizerCatalogAsset" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'draft';

-- CreateIndex
CREATE INDEX "VisualizerCatalogAsset_productId_verificationStatus_idx" ON "VisualizerCatalogAsset"("productId", "verificationStatus");

-- CreateTable
CREATE TABLE "VisualizerCatalogTemplateJob" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "templateType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedModel" TEXT,
    "resolvedModel" TEXT,
    "promptVersion" TEXT,
    "outputAssetId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "VisualizerCatalogTemplateJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisualizerCatalogTemplateJob_productId_templateType_createdAt_idx" ON "VisualizerCatalogTemplateJob"("productId", "templateType", "createdAt");

-- CreateIndex
CREATE INDEX "VisualizerCatalogTemplateJob_status_createdAt_idx" ON "VisualizerCatalogTemplateJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "VisualizerCatalogTemplateJob" ADD CONSTRAINT "VisualizerCatalogTemplateJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "VisualizerCatalogProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
