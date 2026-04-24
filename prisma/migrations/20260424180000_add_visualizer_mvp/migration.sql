-- AI Window Covering Visualizer MVP (PR #1)
-- 新增 6 张 Visualizer 表；对现有表无字段改动，仅通过 FK 建立反向关系
-- measurementPhotoId / measurementWindowId 为弱耦合 String 字段，不建 FK

-- CreateTable
CREATE TABLE "VisualizerSession" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '可视化方案',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "quoteId" TEXT,
    "measurementRecordId" TEXT,
    "createdById" TEXT NOT NULL,
    "salesOwnerId" TEXT,
    "shareToken" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualizerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerSourceImage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "measurementPhotoId" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "roomLabel" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualizerSourceImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerWindowRegion" (
    "id" TEXT NOT NULL,
    "sourceImageId" TEXT NOT NULL,
    "measurementWindowId" TEXT,
    "label" TEXT,
    "shape" TEXT NOT NULL DEFAULT 'polygon',
    "pointsJson" JSONB NOT NULL,
    "widthIn" DOUBLE PRECISION,
    "heightIn" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualizerWindowRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerVariant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "exportImageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualizerVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerProductOption" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "productCatalogId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productCategory" TEXT NOT NULL,
    "color" TEXT,
    "colorHex" TEXT,
    "opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "mountingType" TEXT,
    "transformJson" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualizerProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualizerSelection" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "selectedBy" TEXT NOT NULL,
    "selectedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualizerSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VisualizerSession_shareToken_key" ON "VisualizerSession"("shareToken");
CREATE INDEX "VisualizerSession_customerId_idx" ON "VisualizerSession"("customerId");
CREATE INDEX "VisualizerSession_opportunityId_idx" ON "VisualizerSession"("opportunityId");
CREATE INDEX "VisualizerSession_quoteId_idx" ON "VisualizerSession"("quoteId");
CREATE INDEX "VisualizerSession_salesOwnerId_idx" ON "VisualizerSession"("salesOwnerId");
CREATE INDEX "VisualizerSession_createdById_createdAt_idx" ON "VisualizerSession"("createdById", "createdAt");

CREATE INDEX "VisualizerSourceImage_sessionId_idx" ON "VisualizerSourceImage"("sessionId");

CREATE INDEX "VisualizerWindowRegion_sourceImageId_idx" ON "VisualizerWindowRegion"("sourceImageId");

CREATE INDEX "VisualizerVariant_sessionId_sortOrder_idx" ON "VisualizerVariant"("sessionId", "sortOrder");

CREATE INDEX "VisualizerProductOption_variantId_idx" ON "VisualizerProductOption"("variantId");
CREATE INDEX "VisualizerProductOption_regionId_idx" ON "VisualizerProductOption"("regionId");

CREATE INDEX "VisualizerSelection_variantId_idx" ON "VisualizerSelection"("variantId");

-- AddForeignKey
ALTER TABLE "VisualizerSession" ADD CONSTRAINT "VisualizerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualizerSession" ADD CONSTRAINT "VisualizerSession_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisualizerSession" ADD CONSTRAINT "VisualizerSession_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SalesQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisualizerSession" ADD CONSTRAINT "VisualizerSession_measurementRecordId_fkey" FOREIGN KEY ("measurementRecordId") REFERENCES "MeasurementRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisualizerSession" ADD CONSTRAINT "VisualizerSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisualizerSession" ADD CONSTRAINT "VisualizerSession_salesOwnerId_fkey" FOREIGN KEY ("salesOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VisualizerSourceImage" ADD CONSTRAINT "VisualizerSourceImage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisualizerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisualizerWindowRegion" ADD CONSTRAINT "VisualizerWindowRegion_sourceImageId_fkey" FOREIGN KEY ("sourceImageId") REFERENCES "VisualizerSourceImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisualizerVariant" ADD CONSTRAINT "VisualizerVariant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisualizerSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisualizerProductOption" ADD CONSTRAINT "VisualizerProductOption_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VisualizerVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisualizerProductOption" ADD CONSTRAINT "VisualizerProductOption_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "VisualizerWindowRegion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisualizerSelection" ADD CONSTRAINT "VisualizerSelection_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VisualizerVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisualizerSelection" ADD CONSTRAINT "VisualizerSelection_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
