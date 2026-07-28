-- Security-1 纠正：多 membership 不得自动授予 MULTI_ORG + canSelfSwitchOrg
-- 历史迁移 20260723010000 曾错误回填；本迁移纠正已落地数据。

-- 1) 全员关闭自助切换（后续仅平台管理员可显式开启）
UPDATE "User"
SET "canSelfSwitchOrg" = false
WHERE "canSelfSwitchOrg" = true;

-- 2) 平台管理员 / 超管 → PLATFORM_SUPPORT（不走普通企业切换器）
UPDATE "User"
SET "orgAccessMode" = 'PLATFORM_SUPPORT'
WHERE role IN ('admin', 'super_admin')
  AND "orgAccessMode" IS DISTINCT FROM 'PLATFORM_SUPPORT';

-- 3) 非平台管理员：一律回到 FIXED（即使有多 membership）
--    多组织企业负责人若确需 MULTI_ORG，由平台管理员事后显式开启（且默认仍 canSelfSwitchOrg=false）
UPDATE "User"
SET "orgAccessMode" = 'FIXED'
WHERE role NOT IN ('admin', 'super_admin')
  AND "orgAccessMode" = 'MULTI_ORG';

-- 4) 明确跨多企业的 owner：标 MULTI_ORG，但不开放 canSelfSwitchOrg
UPDATE "User" u
SET "orgAccessMode" = 'MULTI_ORG',
    "canSelfSwitchOrg" = false
WHERE u.role NOT IN ('admin', 'super_admin')
  AND (
    SELECT COUNT(DISTINCT o.id)::int
    FROM "Organization" o
    WHERE o."ownerId" = u.id
      AND o.status = 'active'
  ) > 1;
