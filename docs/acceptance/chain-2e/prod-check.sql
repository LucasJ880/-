-- CHAIN-2e 合并前提（生产只读）：负责人是导入用的系统账号的招投标项目
--
-- 为什么：CHAIN-2e 合并后，比价落地价（AI 报价分析、询价追踪页）只给对项目有财务查看权的人；项目负责人本身就有。
-- 派发时「项目负责人（可选）」不指定，负责人就一直是导入接口建的系统账号 system@qingyan.internal——这类项目没有真人
-- 负责人，做询价的同事合并当天就看不到落地价（报价引擎开关打开后也不能做报价）。
-- 怎么用：有生产只读权限的人整段执行（只读事务，最后 ROLLBACK，不改任何数据）。
--   第 1 段为 0：可以合并。
--   不为 0：按第 2 段的名单，由组织管理员在各项目「项目成员」里把做报价的同事设为主负责人，再合并。
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

ROLLBACK;
