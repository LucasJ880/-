-- FIX-26（openspec change legacy-quote-finance-gate）合并前后看影响面（生产只读）
--
-- 为什么：FIX-26 合并即生效（没有开关）。合并后旧报价单的内部成本、成本价与利润率只给有财务查看权的人
-- （平台超级管理员、持组织范围 project.finance.manage / project.finance.read 的人、项目负责人）；新建 / 修改 / 确认 /
-- 删除旧报价单与报价 AI 只给能编辑报价的人；报价引擎、逐行报价、只报总价建的报价（所属组织不为空）经旧接口一律 409、
-- 旧列表不再列出；审计日志详情对没有财务查看权的人置空成本与毛利类的值。下面几段看这些改动会碰到多少数据。
-- 怎么用：有生产只读权限的人整段执行（只读事务，最后 ROLLBACK，不改任何数据）。结果贴回 FIX-26 报告 §11。
-- 不含任何金额；只出计数、组织名、项目名与编号。

BEGIN READ ONLY;

-- 1. 所属组织不为空的报价（报价引擎、逐行报价、只报总价建的）：合并后旧报价单列表不再列、旧接口一律 409。
--    按报价类型与状态分；为 0 时说明生产里还没有人用过报价引擎 / 新报价页，旧报价单区块看不出变化。
SELECT q."quoteType"            AS quote_type,
       q.status                 AS status,
       count(*)                 AS quotes,
       count(DISTINCT q."projectId") AS projects
FROM "ProjectQuote" q
WHERE q."orgId" IS NOT NULL
GROUP BY q."quoteType", q.status
ORDER BY q."quoteType", q.status;

-- 2. 近 90 天由不是项目负责人的人新建的旧报价单（合并后这些人不能再新建 / 修改 / 确认 / 删除，除非持组织范围财务键
--    且项目角色带成本写权限）。旧路由不写审计，「谁改过」查不到；这里只能按创建人看，另给近 90 天有更新的份数。
SELECT o.name                                   AS org_name,
       p.id                                     AS project_id,
       p.name                                   AS project_name,
       count(*)                                 AS legacy_quotes_by_non_owner,
       count(*) FILTER (WHERE q."updatedAt" >= now() - interval '90 days') AS updated_last_90d,
       count(DISTINCT q."createdById")          AS distinct_creators
FROM "ProjectQuote" q
JOIN "Project" p ON p.id = q."projectId"
LEFT JOIN "Organization" o ON o.id = p."orgId"
WHERE q."orgId" IS NULL
  AND q."createdAt" >= now() - interval '90 days'
  AND q."createdById" IS DISTINCT FROM p."ownerId"
GROUP BY o.name, p.id, p.name
ORDER BY legacy_quotes_by_non_owner DESC, p.name;

-- 2b. 同上的总数，以及近 90 天全部旧报价单份数（对照）
SELECT count(*) FILTER (WHERE q."createdById" IS DISTINCT FROM p."ownerId") AS created_by_non_owner_90d,
       count(*)                                                             AS created_90d,
       count(*) FILTER (WHERE q."updatedAt" >= now() - interval '90 days')  AS updated_90d
FROM "ProjectQuote" q
JOIN "Project" p ON p.id = q."projectId"
WHERE q."orgId" IS NULL
  AND (q."createdAt" >= now() - interval '90 days' OR q."updatedAt" >= now() - interval '90 days');

-- 3. 旧报价单里带成本价的行、带内部成本 / 利润率的报价（合并前这些数对所有项目读者可见）
SELECT (SELECT count(*) FROM "QuoteLineItem" li JOIN "ProjectQuote" q ON q.id = li."quoteId"
         WHERE q."orgId" IS NULL AND li."costPrice" IS NOT NULL)                       AS legacy_lines_with_cost_price,
       (SELECT count(*) FROM "ProjectQuote" q
         WHERE q."orgId" IS NULL AND (q."internalCost" IS NOT NULL OR q."profitMargin" IS NOT NULL)) AS legacy_quotes_with_cost_or_margin,
       (SELECT count(*) FROM "ProjectQuote" q
         WHERE q."orgId" IS NULL AND q."aiDraftJson" IS NOT NULL)                      AS legacy_quotes_with_ai_draft;

-- 4. 审计里报价另起新版时记下的原版估算成本 / 毛利率（合并后读取侧对没有财务查看权的人置空；新写的不再记）
SELECT count(*) AS audit_rows_with_source_cost FROM "AuditLog" WHERE "beforeData" LIKE '%"sourceCost"%';
SELECT count(*) AS audit_rows_with_source_margin FROM "AuditLog" WHERE "beforeData" LIKE '%"sourceMargin"%';

-- 5. 旧报价单里标成内部行的行（只能是有人直接调接口写的；合并后下次保存时变成客户行，今天它们在编辑器、PDF、合计里
--    本来就当客户行）。不为 0 时由负责人逐份看。
SELECT count(*) AS legacy_internal_lines
FROM "QuoteLineItem" li JOIN "ProjectQuote" q ON q.id = li."quoteId"
WHERE li."isInternal" AND q."orgId" IS NULL;

SELECT o.name AS org_name, p.name AS project_name, q.id AS quote_id, q.title AS quote_title, count(*) AS internal_lines
FROM "QuoteLineItem" li
JOIN "ProjectQuote" q ON q.id = li."quoteId"
JOIN "Project" p ON p.id = q."projectId"
LEFT JOIN "Organization" o ON o.id = p."orgId"
WHERE li."isInternal" AND q."orgId" IS NULL
GROUP BY o.name, p.name, q.id, q.title
ORDER BY internal_lines DESC;

-- 6. 有旧报价单、负责人是导入用的系统账号（或负责人账号已不存在）的项目：合并后只有平台超级管理员与持组织范围
--    财务键的人能看成本、改报价单；先按 docs/acceptance/chain-2e/prod-check.sql 补负责人。
SELECT o.name AS org_name, p.id AS project_id, p.name AS project_name, count(q.id) AS legacy_quotes
FROM "Project" p
JOIN "ProjectQuote" q ON q."projectId" = p.id AND q."orgId" IS NULL
LEFT JOIN "User" u ON u.id = p."ownerId"
LEFT JOIN "Organization" o ON o.id = p."orgId"
WHERE p."intakeStatus" = 'dispatched'
  AND (u.id IS NULL OR lower(trim(u.email)) = 'system@qingyan.internal')
GROUP BY o.name, p.id, p.name
ORDER BY legacy_quotes DESC, p.name;

ROLLBACK;
