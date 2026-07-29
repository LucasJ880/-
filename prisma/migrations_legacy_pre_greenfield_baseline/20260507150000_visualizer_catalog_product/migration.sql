-- Visualizer Phase S6 - Catalog Product
-- 新增 VisualizerCatalogProduct 表替代写死的 mock-products；
-- 平台预置（orgId IS NULL）+ 组织私有（orgId 非空）
-- 现有 VisualizerProductOption.productCatalogId 字段不变；mock_xxx id 通过 seed upsert 进入此表

-- CreateTable
CREATE TABLE "VisualizerCatalogProduct" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "categoryLabel" TEXT NOT NULL,
    "previewImageUrl" TEXT,
    "textureUrl" TEXT,
    "defaultOpacity" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "colorsJson" JSONB NOT NULL,
    "mountingsJson" JSONB NOT NULL,
    "pricingProductName" TEXT,
    "notes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualizerCatalogProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisualizerCatalogProduct_orgId_archived_idx" ON "VisualizerCatalogProduct"("orgId", "archived");

-- CreateIndex
CREATE INDEX "VisualizerCatalogProduct_category_idx" ON "VisualizerCatalogProduct"("category");

-- AddForeignKey
ALTER TABLE "VisualizerCatalogProduct" ADD CONSTRAINT "VisualizerCatalogProduct_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
