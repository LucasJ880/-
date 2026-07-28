-- UserMemory 强制 org 隔离：补 orgId、回填、清除无法归属的旧数据

ALTER TABLE "UserMemory" ADD COLUMN "orgId" TEXT;

-- 从用户活跃组织成员关系回填（取最早加入的 active 组织）
UPDATE "UserMemory" AS um
SET "orgId" = sub."orgId"
FROM (
  SELECT DISTINCT ON (om."userId") om."userId", om."orgId"
  FROM "OrganizationMember" om
  WHERE om."status" = 'active'
  ORDER BY om."userId", om."joinedAt" ASC, om."createdAt" ASC
) AS sub
WHERE um."userId" = sub."userId" AND um."orgId" IS NULL;

-- 无法归属组织的记忆不参与召回，直接删除（避免串租户）
DELETE FROM "UserMemory" WHERE "orgId" IS NULL;

ALTER TABLE "UserMemory" ALTER COLUMN "orgId" SET NOT NULL;

DROP INDEX IF EXISTS "UserMemory_userId_layer_idx";
DROP INDEX IF EXISTS "UserMemory_userId_memoryType_idx";
DROP INDEX IF EXISTS "UserMemory_userId_importance_idx";
DROP INDEX IF EXISTS "UserMemory_userId_tags_idx";
DROP INDEX IF EXISTS "UserMemory_userId_customerId_idx";
DROP INDEX IF EXISTS "UserMemory_userId_projectId_idx";

CREATE INDEX "UserMemory_orgId_userId_layer_idx" ON "UserMemory"("orgId", "userId", "layer");
CREATE INDEX "UserMemory_orgId_userId_memoryType_idx" ON "UserMemory"("orgId", "userId", "memoryType");
CREATE INDEX "UserMemory_orgId_userId_importance_idx" ON "UserMemory"("orgId", "userId", "importance");
CREATE INDEX "UserMemory_orgId_userId_tags_idx" ON "UserMemory"("orgId", "userId", "tags");
CREATE INDEX "UserMemory_orgId_userId_customerId_idx" ON "UserMemory"("orgId", "userId", "customerId");
CREATE INDEX "UserMemory_orgId_userId_projectId_idx" ON "UserMemory"("orgId", "userId", "projectId");
CREATE INDEX "UserMemory_userId_layer_idx" ON "UserMemory"("userId", "layer");
