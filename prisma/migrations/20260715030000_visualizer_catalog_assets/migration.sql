-- Product reference assets for window-covering visualization.

CREATE TABLE "VisualizerCatalogAsset" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT NOT NULL DEFAULT 'real',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualizerCatalogAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VisualizerCatalogAsset_productId_role_sortOrder_idx"
ON "VisualizerCatalogAsset"("productId", "role", "sortOrder");

ALTER TABLE "VisualizerCatalogAsset"
ADD CONSTRAINT "VisualizerCatalogAsset_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "VisualizerCatalogProduct"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
