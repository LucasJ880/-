-- Security-1：Organization.ownerId → OrganizationMember.role = org_owner
-- 若无 membership 则创建；其他 org_admin 保持不变

UPDATE "OrganizationMember" m
SET role = 'org_owner'
FROM "Organization" o
WHERE m."orgId" = o.id
  AND m."userId" = o."ownerId"
  AND m.status = 'active'
  AND m.role IS DISTINCT FROM 'org_owner';

INSERT INTO "OrganizationMember" (id, "orgId", "userId", role, status, "joinedAt", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  o.id,
  o."ownerId",
  'org_owner',
  'active',
  NOW(),
  NOW(),
  NOW()
FROM "Organization" o
WHERE o.status IS DISTINCT FROM 'archived'
  AND o."ownerId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "OrganizationMember" m
    WHERE m."orgId" = o.id AND m."userId" = o."ownerId"
  );
