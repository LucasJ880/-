-- FIX-21 合并后的生产只读核查（交给有生产只读权限的人跑；有结果再定要不要通知相关的人）
--
-- 用法：psql "<生产只读连接串>" -f docs/acceptance/fix-21/prod-check.sql
-- 整段在只读事务里跑，最后 ROLLBACK，不改任何数据。
-- 「对项目有读权限」按 src/lib/projects/access.ts 的 requireProjectReadAccess 口径：
--   平台 super_admin；项目负责人；该项目 active 的项目成员；项目所在组织 active 的 org_owner / org_admin。
-- 两个查询都按「现在」的成员关系判断：查到的行要人看一眼当时是不是成员，不能直接当越权定论。

BEGIN READ ONLY;

-- ① 一键投标方案任务里，发起人（AgentTask.createdById）对这个项目没有读权限的。
--    合并前「建任务」接口只查登录，这能看出这个缺口有没有被用过（执行步骤、查看、审核、重新分析都不记调用者，查不到）。
SELECT t.id AS task_id,
       t."projectId" AS project_id,
       p.name AS project_name,
       t."createdById" AS created_by_id,
       u.email AS created_by_email,
       u.role AS created_by_role,
       t.status,
       t."createdAt" AS created_at
FROM "AgentTask" t
JOIN "Project" p ON p.id = t."projectId"
JOIN "User" u ON u.id = t."createdById"
WHERE t."taskType" = 'ai_bid_package'
  AND u.role <> 'super_admin'
  AND p."ownerId" <> t."createdById"
  AND NOT EXISTS (
    SELECT 1 FROM "ProjectMember" pm
    WHERE pm."projectId" = p.id AND pm."userId" = t."createdById" AND pm.status = 'active')
  AND NOT EXISTS (
    SELECT 1 FROM "OrganizationMember" om
    WHERE p."orgId" IS NOT NULL AND om."orgId" = p."orgId" AND om."userId" = t."createdById"
      AND om.status = 'active' AND om.role IN ('org_owner', 'org_admin'))
ORDER BY t."createdAt";

-- ② 情报审核人（ProjectIntelligence.reviewedBy）不是这个项目相关的人的。
--    合并前「改审核结论」接口只查登录；审核人存的是 user.name，没有姓名时是 email，再没有是 user.id
--    （src/app/api/projects/[id]/intelligence/review/route.ts）。按这三种写法去找用户：
--    找不到任何用户的（改过名 / 已删除）也列出来；能找到、但找到的人都对项目没有读权限的列出来。
--    同名的人不止一个时，只要其中有一个对项目有读权限就不列（按姓名认不出是谁）。
SELECT i."projectId" AS project_id,
       p.name AS project_name,
       i."reviewedBy" AS reviewed_by,
       i."reviewedAt" AS reviewed_at,
       i."reportStatus" AS report_status,
       (SELECT count(*) FROM "User" u
         WHERE u.name = i."reviewedBy" OR u.email = i."reviewedBy" OR u.id = i."reviewedBy") AS matching_users
FROM "ProjectIntelligence" i
JOIN "Project" p ON p.id = i."projectId"
WHERE i."reviewedBy" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "User" u
    WHERE (u.name = i."reviewedBy" OR u.email = i."reviewedBy" OR u.id = i."reviewedBy")
      AND (
        u.role = 'super_admin'
        OR p."ownerId" = u.id
        OR EXISTS (
          SELECT 1 FROM "ProjectMember" pm
          WHERE pm."projectId" = p.id AND pm."userId" = u.id AND pm.status = 'active')
        OR EXISTS (
          SELECT 1 FROM "OrganizationMember" om
          WHERE p."orgId" IS NOT NULL AND om."orgId" = p."orgId" AND om."userId" = u.id
            AND om.status = 'active' AND om.role IN ('org_owner', 'org_admin'))))
ORDER BY i."reviewedAt" DESC NULLS LAST;

ROLLBACK;
