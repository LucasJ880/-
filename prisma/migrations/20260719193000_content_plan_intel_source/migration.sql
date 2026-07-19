-- 内容日历溯源：市场情报确认后可进选题池

-- AlterTable
ALTER TABLE "ContentPlanItem" ADD COLUMN "sourceSignalId" TEXT;
ALTER TABLE "ContentPlanItem" ADD COLUMN "sourceResearchRunId" TEXT;

-- CreateIndex
CREATE INDEX "ContentPlanItem_orgId_sourceSignalId_idx" ON "ContentPlanItem"("orgId", "sourceSignalId");
