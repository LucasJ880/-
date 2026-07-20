-- UserMemory supersede timeline (MemPalace-inspired)

ALTER TABLE "UserMemory" ADD COLUMN "supersedesId" TEXT;
ALTER TABLE "UserMemory" ADD COLUMN "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "UserMemory" ADD COLUMN "effectiveTo" TIMESTAMP(3);

-- 存量：视为自创建起一直生效
UPDATE "UserMemory" SET "effectiveFrom" = "createdAt" WHERE "effectiveFrom" IS DISTINCT FROM "createdAt";

CREATE INDEX "UserMemory_orgId_userId_effectiveTo_idx" ON "UserMemory"("orgId", "userId", "effectiveTo");
CREATE INDEX "UserMemory_supersedesId_idx" ON "UserMemory"("supersedesId");
CREATE INDEX "UserMemory_supersededById_idx" ON "UserMemory"("supersededById");
