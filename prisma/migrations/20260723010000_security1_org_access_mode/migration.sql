-- Security-1：企业访问模式
CREATE TYPE "OrgAccessMode" AS ENUM ('FIXED', 'MULTI_ORG', 'PLATFORM_SUPPORT');

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "orgAccessMode" "OrgAccessMode" NOT NULL DEFAULT 'FIXED';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canSelfSwitchOrg" BOOLEAN NOT NULL DEFAULT false;

-- 回填：拥有多个 active membership 的用户暂标 MULTI_ORG（可自助切换需另行授权 canSelfSwitchOrg）
-- 默认仍 FIXED；仅当 membership>1 时标记 MULTI_ORG 并开启 canSelfSwitchOrg（nav-qa 等双租户验收账号）
UPDATE "User" u
SET
  "orgAccessMode" = 'MULTI_ORG',
  "canSelfSwitchOrg" = true
WHERE (
  SELECT COUNT(*)::int
  FROM "OrganizationMember" m
  WHERE m."userId" = u.id AND m.status = 'active'
) > 1;

-- 单 membership：确保 activeOrgId 指向该组织
UPDATE "User" u
SET "activeOrgId" = sub."orgId"
FROM (
  SELECT m."userId", MIN(m."orgId") AS "orgId"
  FROM "OrganizationMember" m
  WHERE m.status = 'active'
  GROUP BY m."userId"
  HAVING COUNT(*) = 1
) sub
WHERE u.id = sub."userId"
  AND (u."activeOrgId" IS DISTINCT FROM sub."orgId");
