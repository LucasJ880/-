-- CHAIN-2e 合并前提（生产只读）：负责人是导入用的系统账号的招投标项目
--
-- 为什么：CHAIN-2e 合并后，比价落地价（AI 报价分析、询价追踪页）只给对项目有财务查看权的人；项目负责人本身就有。
-- 派发时「项目负责人（可选）」不指定，负责人就一直是导入接口建的系统账号 system@qingyan.internal——这类项目没有真人
-- 负责人，做询价的同事合并当天就看不到落地价（报价引擎开关打开后也不能做报价）。
-- 怎么用：有生产只读权限的人整段执行（只读事务，最后 ROLLBACK，不改任何数据）。
--   第 1 段为 0：可以合并。
--   不为 0：按第 2 段的名单，由组织管理员在各项目「项目成员」里把做报价的同事设为主负责人，再合并。
--   第 3 段 all_bound 为 false 的组织：企业负责人合并当天看不到别人负责的项目的落地价——知会，或由平台管理员给他绑
--   「老板」岗位（组织范围财务键），再合并。
-- 不含任何金额；只列组织名、项目名、编号与计数。

BEGIN READ ONLY;

-- 1. 计数：已派发、workDomain = tender、负责人是系统账号（或负责人账号已不存在）的项目
SELECT
  count(*)                                             AS system_owned_tender_projects,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1
    FROM "ProjectInquiry" i
    JOIN "InquiryItem" it ON it."inquiryId" = i.id
    WHERE i."projectId" = p.id
      AND it.status = 'quoted'
      AND i.status NOT IN ('canceled', 'completed')
  ))                                                   AS with_quoted_inquiry
FROM "Project" p
LEFT JOIN "User" u ON u.id = p."ownerId"
WHERE p."intakeStatus" = 'dispatched'
  AND p."workDomain" = 'tender'
  AND (u.id IS NULL OR lower(trim(u.email)) = 'system@qingyan.internal');

-- 2. 名单：其中有已报价、未取消 / 未完成询价的项目（合并当天就有人看不到落地价）
SELECT
  o.name                                               AS org_name,
  p.id                                                 AS project_id,
  p.name                                               AS project_name,
  p."solicitationNumber"                               AS solicitation_number,
  count(DISTINCT i.id)                                 AS open_rounds_with_quotes,
  count(it.id)                                         AS quoted_items,
  max(it."repliedAt")                                  AS last_quote_at,
  (SELECT count(*) FROM "ProjectMember" m WHERE m."projectId" = p.id AND m.status = 'active') AS active_members
FROM "Project" p
LEFT JOIN "User" u ON u.id = p."ownerId"
LEFT JOIN "Organization" o ON o.id = p."orgId"
JOIN "ProjectInquiry" i ON i."projectId" = p.id AND i.status NOT IN ('canceled', 'completed')
JOIN "InquiryItem" it ON it."inquiryId" = i.id AND it.status = 'quoted'
WHERE p."intakeStatus" = 'dispatched'
  AND p."workDomain" = 'tender'
  AND (u.id IS NULL OR lower(trim(u.email)) = 'system@qingyan.internal')
GROUP BY o.name, p.id, p.name, p."solicitationNumber"
ORDER BY last_quote_at DESC NULLS LAST, p.name;

-- 3. 企业负责人（organizationMember.role = org_owner）有没有组织范围的财务查看权
--    系统岗位 org_owner 本身不带 project.finance.*（src/lib/authorization/role-defaults.ts）；组织范围的财务查看权要另绑
--    「老板」（owner，带 project.finance.manage）或「会计」（accounting，带 project.finance.read）这类岗位。没绑的企业负责人
--    合并当天在别人负责的项目上也看不到比价 / 追踪页的落地价。
--    只出组织名与是否已绑（每个组织的企业负责人人数、其中已绑的人数），不出个人信息。
--    「已绑」= 有一条有效（active、未过期）的岗位绑定，岗位 active，岗位里有 ORG 范围 ALLOW 的 project.finance.read 或
--    project.finance.manage，且这个人没有任何岗位对同一个键 DENY；平台超级管理员（User.role = super_admin）按已绑算。
WITH tender_orgs AS (
  SELECT DISTINCT p."orgId" AS org_id
  FROM "Project" p
  WHERE p."intakeStatus" = 'dispatched' AND p."workDomain" = 'tender' AND p."orgId" IS NOT NULL
),
owners AS (
  SELECT m."orgId" AS org_id, m."userId" AS user_id, u.role AS platform_role
  FROM "OrganizationMember" m
  JOIN tender_orgs t ON t.org_id = m."orgId"
  JOIN "User" u ON u.id = m."userId"
  WHERE m.role = 'org_owner' AND m.status = 'active'
),
key_bindings AS (
  SELECT b."orgId" AS org_id, b."principalId" AS user_id, rp."permissionKey" AS permission_key, rp."dataScope" AS data_scope, rp.effect
  FROM "PrincipalRoleBinding" b
  JOIN "RoleProfile" r ON r.id = b."roleProfileId" AND r.status = 'active'
  JOIN "RolePermissionBinding" rp ON rp."roleProfileId" = r.id
  WHERE b."principalType" = 'HUMAN' AND b.status = 'active'
    AND (b."expiresAt" IS NULL OR b."expiresAt" > now())
    AND rp."permissionKey" IN ('project.finance.read', 'project.finance.manage')
),
owner_view AS (
  SELECT o.org_id, o.user_id,
    (o.platform_role = 'super_admin') OR EXISTS (
      SELECT 1 FROM key_bindings k
      WHERE k.org_id = o.org_id AND k.user_id = o.user_id AND k.effect = 'ALLOW' AND k.data_scope = 'ORG'
        AND NOT EXISTS (
          SELECT 1 FROM key_bindings d
          WHERE d.org_id = k.org_id AND d.user_id = k.user_id AND d.permission_key = k.permission_key AND d.effect = 'DENY'
        )
    ) AS has_org_finance_view
  FROM owners o
)
SELECT
  org.name                                             AS org_name,
  count(ov.user_id)                                    AS org_owner_members,
  count(ov.user_id) FILTER (WHERE ov.has_org_finance_view) AS with_org_finance_view,
  (count(ov.user_id) > 0 AND bool_and(ov.has_org_finance_view)) AS all_bound
FROM tender_orgs t
JOIN "Organization" org ON org.id = t.org_id
LEFT JOIN owner_view ov ON ov.org_id = t.org_id
GROUP BY org.name
ORDER BY all_bound, org.name;

ROLLBACK;
