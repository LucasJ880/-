-- FIX-23 合并后的生产只读核查（交给有生产只读权限的人跑，结果原样贴回）
--
-- 用法：psql "<生产只读连接串>" -f docs/acceptance/fix-23/prod-check.sql
-- 整段在只读事务里跑，最后 ROLLBACK，不改任何数据。
-- 「能打开项目」按 src/lib/projects/access.ts 的 requireProjectReadAccess 口径（不是 super_admin 时）：
--   项目已分发，且调用者是项目负责人、该项目 active 的项目成员、或项目所在组织 active 的 org_owner / org_admin。
-- 都按「现在」的成员关系判断。账号不是 active 的创建人调不了这个接口（401），不计入。

BEGIN READ ONLY;

-- A 段：合并后会从创建人「最近任务」里消失的任务（创建人不是 super_admin、按上面的口径打不开项目）。
--   按原因与触发方式（cron / manual / 其它：chat、event）各数几条；「0 合并后照旧可见」一行是对照。
--   「1 项目未分发」一行的 cron 数就是 TASKFLOW 里「cron 巡检对未分发的项目也建任务」那条后续任务要看的数。
--   原因按顺序取第一条命中的。
WITH t AS (
  SELECT t.id,
         t."triggerType" AS trigger_type,
         t."createdById" AS uid,
         p.id AS pid,
         p."orgId" AS org_id,
         p."ownerId" AS owner_id,
         p."intakeStatus" AS intake_status
  FROM "AgentTask" t
  JOIN "Project" p ON p.id = t."projectId"
  JOIN "User" u ON u.id = t."createdById"
  WHERE u.role <> 'super_admin'
    AND u.status = 'active'
),
classified AS (
  SELECT t.*,
         CASE
           WHEN t.intake_status IS DISTINCT FROM 'dispatched' THEN '1 项目未分发'
           WHEN t.owner_id = t.uid
             OR EXISTS (
               SELECT 1 FROM "ProjectMember" pm
               WHERE pm."projectId" = t.pid AND pm."userId" = t.uid AND pm.status = 'active')
             OR EXISTS (
               SELECT 1 FROM "OrganizationMember" om
               WHERE t.org_id IS NOT NULL AND om."orgId" = t.org_id AND om."userId" = t.uid
                 AND om.status = 'active' AND om.role IN ('org_owner', 'org_admin'))
             THEN '0 合并后照旧可见'
           WHEN EXISTS (
               SELECT 1 FROM "ProjectMember" pm
               WHERE pm."projectId" = t.pid AND pm."userId" = t.uid AND pm.status <> 'active')
             THEN '2 项目成员身份已停用'
           WHEN EXISTS (
               SELECT 1 FROM "OrganizationMember" om
               WHERE om."orgId" = t.org_id AND om."userId" = t.uid
                 AND om.status <> 'active' AND om.role IN ('org_owner', 'org_admin'))
             THEN '3 组织成员身份已停用的原管理员（不是项目成员）'
           WHEN EXISTS (
               SELECT 1 FROM "OrganizationMember" om
               WHERE om."orgId" = t.org_id AND om."userId" = t.uid AND om.status = 'active')
             THEN '4 同企业非成员（不是组织所有者或管理员）'
           WHEN EXISTS (
               SELECT 1 FROM "OrganizationMember" om
               WHERE om."orgId" = t.org_id AND om."userId" = t.uid)
             THEN '5 组织成员身份已停用的原普通成员（不是项目成员）'
           WHEN t.org_id IS NULL THEN '6 项目没有组织（不是负责人或项目成员）'
           ELSE '7 别的企业'
         END AS reason
  FROM t
)
SELECT reason,
       count(*) FILTER (WHERE trigger_type = 'cron') AS cron_tasks,
       count(*) FILTER (WHERE trigger_type = 'manual') AS manual_tasks,
       count(*) FILTER (WHERE trigger_type IS DISTINCT FROM 'cron' AND trigger_type IS DISTINCT FROM 'manual') AS other_trigger_tasks,
       count(*) AS total_tasks,
       count(DISTINCT uid) AS creators
FROM classified
GROUP BY reason
ORDER BY reason;

-- B 段：创建人不是 super_admin、账号 active 的任务里，检查报告带「步骤执行失败：」（原始报错）的步骤、带「利润率」的步骤各几条，按任务类型分。
--   这些就是合并前不是平台管理员的创建人能从这个接口读到的内容；有没有人真的读过查不到（接口不记调用者）。
SELECT t."taskType" AS task_type,
       count(*) FILTER (WHERE s."checkReportJson" LIKE '%步骤执行失败：%') AS steps_with_raw_error,
       count(*) FILTER (WHERE s."checkReportJson" LIKE '%利润率%') AS steps_with_margin,
       count(*) AS steps_with_report
FROM "AgentTaskStep" s
JOIN "AgentTask" t ON t.id = s."taskId"
JOIN "User" u ON u.id = t."createdById"
WHERE u.role <> 'super_admin'
  AND u.status = 'active'
  AND s."checkReportJson" IS NOT NULL
GROUP BY t."taskType"
ORDER BY t."taskType";

-- C 段：项目角色是空串的 active 项目成员有几行。
--   项目读权限守卫按「项目角色非空」才放行项目成员，本接口的批量条件只看成员身份是否 active、不看角色：
--   两边只在这种数据上不一致（这种成员能在最近任务里看到自己建的任务，点进详情却是 403）。不为 0 时另开任务。
SELECT count(*) AS active_members_with_empty_role,
       count(DISTINCT pm."projectId") AS projects,
       count(DISTINCT pm."userId") AS users
FROM "ProjectMember" pm
WHERE pm.status = 'active'
  AND pm.role = '';

ROLLBACK;
