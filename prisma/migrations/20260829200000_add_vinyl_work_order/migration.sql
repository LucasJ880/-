-- Vinyl 百叶窗工艺单（additive-only：仅 CreateTable / 索引 / 唯一键 / FK）
-- 无 ALTER 业务列 / 无 DROP / 无 RENAME / 无 backfill。
-- 规则引擎见 src/lib/vinyl/*（来源 Vinyl百叶窗统一工艺单_V15.xlsx），与 Blinds 工艺单完全独立。
-- VinylOrder 从第一天带 orgId（BlindsOrder 缺 orgId 是历史遗留，不在本迁移处理）。
-- 生产部署走 safe-migrate-deploy runbook，不由本 PR 执行。

-- CreateTable
CREATE TABLE "VinylPanelCode" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "louverSize" DOUBLE PRECISION,
    "strips" INTEGER NOT NULL,
    "caps" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "VinylPanelCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VinylOrder" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "ruleVersion" TEXT NOT NULL DEFAULT 'vinyl_v15',
    "customerName" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "installDate" TEXT,
    "remarks" TEXT,
    "louverSize" DOUBLE PRECISION NOT NULL DEFAULT 3.5,
    "color" TEXT NOT NULL DEFAULT '白色',
    "confirmedAt" TIMESTAMP(3),
    "productionStartAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "expectedInstallDate" TIMESTAMP(3),
    "appointmentId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "creatorId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerId" TEXT,
    "opportunityId" TEXT,
    "quoteId" TEXT,

    CONSTRAINT "VinylOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VinylOrderItem" (
    "id" TEXT NOT NULL,
    "itemNumber" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "panelCount" INTEGER NOT NULL,
    "panelCode" TEXT NOT NULL,
    "dividerSpec" TEXT,
    "specialMidRail" DOUBLE PRECISION,
    "midRailRatio" DOUBLE PRECISION,
    "tiltRodPosition" TEXT,
    "frameType" TEXT NOT NULL,
    "frameCount" TEXT NOT NULL,
    "inOut" TEXT NOT NULL,
    "structure" TEXT NOT NULL DEFAULT '有框',
    "itemRemark" TEXT,
    "frameSignature" DOUBLE PRECISION,
    "cavityWidth" DOUBLE PRECISION,
    "cavityHeight" DOUBLE PRECISION,
    "panelWidth" DOUBLE PRECISION,
    "panelHeight" DOUBLE PRECISION,
    "midRail" DOUBLE PRECISION,
    "midRailFromBottom" DOUBLE PRECISION,
    "topLouvers" INTEGER,
    "bottomLouvers" INTEGER,
    "louverPitch" DOUBLE PRECISION,
    "strips" INTEGER,
    "caps" INTEGER,
    "squareFeet" DOUBLE PRECISION,
    "warningsJson" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "orderId" TEXT NOT NULL,

    CONSTRAINT "VinylOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VinylOrderStatusLog" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" TEXT NOT NULL,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VinylOrderStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VinylPanelCode_orgId_code_louverSize_key" ON "VinylPanelCode"("orgId", "code", "louverSize");

-- CreateIndex
CREATE INDEX "VinylPanelCode_orgId_idx" ON "VinylPanelCode"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "VinylOrder_code_key" ON "VinylOrder"("code");

-- CreateIndex
CREATE UNIQUE INDEX "VinylOrder_quoteId_key" ON "VinylOrder"("quoteId");

-- CreateIndex
CREATE INDEX "VinylOrder_orgId_status_idx" ON "VinylOrder"("orgId", "status");

-- CreateIndex
CREATE INDEX "VinylOrder_customerId_idx" ON "VinylOrder"("customerId");

-- CreateIndex
CREATE INDEX "VinylOrder_opportunityId_idx" ON "VinylOrder"("opportunityId");

-- CreateIndex
CREATE INDEX "VinylOrder_expectedInstallDate_idx" ON "VinylOrder"("expectedInstallDate");

-- CreateIndex
CREATE INDEX "VinylOrderItem_orderId_itemNumber_idx" ON "VinylOrderItem"("orderId", "itemNumber");

-- CreateIndex
CREATE INDEX "VinylOrderStatusLog_orderId_createdAt_idx" ON "VinylOrderStatusLog"("orderId", "createdAt");

-- AddForeignKey
ALTER TABLE "VinylPanelCode" ADD CONSTRAINT "VinylPanelCode_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinylOrder" ADD CONSTRAINT "VinylOrder_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinylOrder" ADD CONSTRAINT "VinylOrder_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinylOrder" ADD CONSTRAINT "VinylOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinylOrder" ADD CONSTRAINT "VinylOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "SalesCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinylOrder" ADD CONSTRAINT "VinylOrder_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinylOrder" ADD CONSTRAINT "VinylOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "SalesQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinylOrderItem" ADD CONSTRAINT "VinylOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "VinylOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VinylOrderStatusLog" ADD CONSTRAINT "VinylOrderStatusLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "VinylOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
