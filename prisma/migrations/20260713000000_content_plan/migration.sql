-- 内容日历：选题规划层（AI 出选题 → 人工审 → 关联资产扇出）

-- CreateTable
CREATE TABLE "ContentPlanItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "plannedDate" DATE NOT NULL,
    "groupName" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "angle" TEXT,
    "suggestedCaption" TEXT,
    "hashtags" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "source" TEXT NOT NULL DEFAULT 'ai',
    "assetId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentPlanItem_orgId_plannedDate_idx" ON "ContentPlanItem"("orgId", "plannedDate");

-- CreateIndex
CREATE INDEX "ContentPlanItem_orgId_status_idx" ON "ContentPlanItem"("orgId", "status");
