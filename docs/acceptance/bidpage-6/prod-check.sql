-- BIDPAGE-6「定报价只点一次」上线前的只读核对（任务书「不确定处 5」、附录 C 决定 J）
-- 由 Lucas / Evan 在生产库只读连接上跑；只有 SELECT，不改任何数据。实现会话连不上生产库，结果未核实。
-- 用法：把 :org 换成 Sunny 组织 id（psql：\set org '''<组织 id>'''）。

-- 1. 现有引擎报价（不含旧报价单 CUSTOM）按状态的份数：有没有已批准 / 已中标的，决定改选逻辑的回归样本
SELECT q.status, COUNT(*) AS quotes, COUNT(DISTINCT q."projectId") AS projects
FROM "ProjectQuote" q
WHERE q."orgId" = :org AND q."quoteType" <> 'CUSTOM'
GROUP BY q.status
ORDER BY q.status;

-- 2. 每个项目：已批准 / 已中标的份数、有没有我方报价指针、指针指向的报价状态
--    （「已有另一份我方报价」「两份已批准都没选」「我方报价已中标」这三种情况在生产上各有几个项目）
SELECT p.id AS project_id,
       COUNT(*) FILTER (WHERE q.status IN ('approved', 'awarded')) AS eligible,
       p."bidQuoteId" IS NOT NULL AS has_pointer,
       sel.status AS pointer_status
FROM "Project" p
JOIN "ProjectQuote" q ON q."projectId" = p.id AND q."quoteType" <> 'CUSTOM'
LEFT JOIN "ProjectQuote" sel ON sel.id = p."bidQuoteId"
WHERE p."orgId" = :org AND p."workDomain" = 'tender'
GROUP BY p.id, p."bidQuoteId", sel.status
HAVING COUNT(*) FILTER (WHERE q.status IN ('approved', 'awarded')) > 0
ORDER BY eligible DESC;

-- 3. 正在待批准的报价（上线后负责人会在新页面看到「批准并定为我方报价 / 退回」）
SELECT q."projectId", q.id, q.version, q."submittedAt"
FROM "ProjectQuote" q
WHERE q."orgId" = :org AND q."quoteType" <> 'CUSTOM' AND q.status = 'review'
ORDER BY q."submittedAt" DESC NULLS LAST;

-- 4. 项目负责人不是本组织在职成员的招投标项目（提交给负责人时没有人收到通知）
SELECT p.id AS project_id, p."ownerId"
FROM "Project" p
LEFT JOIN "OrganizationMember" m ON m."orgId" = p."orgId" AND m."userId" = p."ownerId" AND m.status = 'active'
LEFT JOIN "User" u ON u.id = p."ownerId"
WHERE p."orgId" = :org AND p."workDomain" = 'tender' AND (m."userId" IS NULL OR u.status <> 'active');
