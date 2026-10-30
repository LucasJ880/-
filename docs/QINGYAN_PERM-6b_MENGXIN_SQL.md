# PERM-6b 梦馨上线 SQL（Neon SQL Editor）

在 Neon Console → 项目「青砚-AI工作助手」→ 分支 `production`（Default）→ SQL Editor（数据库 `neondb`）执行。用法见 `docs/QINGYAN_PERM-6b_REPORT.md` §4。

- 三段都只新增、不删不改，可重复执行（已存在的跳过）。
- 第 2 / 3 段与 `seedOrgAuthorizationProfiles` 对 `trade_rep` / 家纺 `owner` 的写法一致：本地按生产实情建库核对，执行后再跑 6b 的 seed 不再新增任何行。
- 企业编码 `mengxin-home-textile` 已在生产库核对（2026-10-29）。

## 1. 查看（只读）

```sql
SELECT
  o.code                         AS 企业编码,
  o."industryPackId"             AS 行业包,
  u.email                        AS 成员邮箱,
  u.role                         AS 平台角色,
  m.role                         AS 企业角色,
  m.status                       AS 成员状态,
  COALESCE(string_agg(rp.key, ', ' ORDER BY rp.key) FILTER (WHERE b.status = 'active'), '（无绑定）') AS 当前岗位,
  (SELECT string_agg(p.key, ', ' ORDER BY p.key) FROM "RoleProfile" p WHERE p."orgId" = o.id) AS 已落地的岗位模板
FROM "Organization" o
JOIN "OrganizationMember" m ON m."orgId" = o.id
JOIN "User" u ON u.id = m."userId"
LEFT JOIN "PrincipalRoleBinding" b ON b."orgId" = o.id AND b."principalId" = u.id AND b."principalType" = 'HUMAN'
LEFT JOIN "RoleProfile" rp ON rp.id = b."roleProfileId"
WHERE o.code = 'mengxin-home-textile'
GROUP BY o.id, o.code, o."industryPackId", u.email, u.role, m.role, m.status
ORDER BY u.email;
```

## 2. 合并前 · 外贸业务员（trade_rep → Cathy）

2026-10-29 已在生产执行。

```sql
BEGIN;

-- 1) 岗位 trade_rep（已有则跳过）
INSERT INTO "RoleProfile" (id, "orgId", key, name, description, "principalType", "isSystem", status, "createdAt", "updatedAt")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24), o.id, 'trade_rep', '外贸业务员',
       '外贸客户 / 询盘 / 活动 / 报价 / 样品读写（全企业）', 'HUMAN', true, 'active', now(), now()
FROM "Organization" o
WHERE o.code = 'mengxin-home-textile'
ON CONFLICT ("orgId", key) DO NOTHING;

-- 2) trade_rep 的两条权限：trade.read / trade.manage（全企业）
INSERT INTO "RolePermissionBinding" (id, "orgId", "roleProfileId", "permissionKey", "dataScope", effect)
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || v.k), 1, 24), rp."orgId", rp.id, v.k, v.s, 'ALLOW'
FROM "RoleProfile" rp
JOIN "Organization" o ON o.id = rp."orgId"
CROSS JOIN (VALUES ('trade.read', 'ORG'), ('trade.manage', 'ORG')) AS v(k, s)
WHERE o.code = 'mengxin-home-textile' AND rp.key = 'trade_rep'
ON CONFLICT ("roleProfileId", "permissionKey", "dataScope") DO NOTHING;

-- 3) 岗位模板 trade_rep（企业详情页"岗位"一节可选）
INSERT INTO "PositionTemplate" (id, "orgId", key, name, "principalType", status, "isSystem", "primaryRoleProfileId", "createdAt", "updatedAt")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || 'pt'), 1, 24), o.id, 'trade_rep', '外贸业务员', 'HUMAN', 'active', true, rp.id, now(), now()
FROM "Organization" o
JOIN "RoleProfile" rp ON rp."orgId" = o.id AND rp.key = 'trade_rep'
WHERE o.code = 'mengxin-home-textile'
ON CONFLICT ("orgId", key) DO NOTHING;

-- 4) Cathy 绑 trade_rep（已有 active 绑定则跳过）
INSERT INTO "PrincipalRoleBinding" (id, "orgId", "principalType", "principalId", "roleProfileId", "startsAt", status, "createdAt", "updatedAt")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || 'b'), 1, 24), o.id, 'HUMAN', u.id, rp.id, now(), 'active', now(), now()
FROM "Organization" o
JOIN "RoleProfile" rp ON rp."orgId" = o.id AND rp.key = 'trade_rep'
JOIN "OrganizationMember" m ON m."orgId" = o.id AND m.status = 'active'
JOIN "User" u ON u.id = m."userId" AND lower(u.email) = 'cathy@hlmbedding.com'
WHERE o.code = 'mengxin-home-textile'
  AND NOT EXISTS (
    SELECT 1 FROM "PrincipalRoleBinding" b
    WHERE b."orgId" = o.id AND b."principalType" = 'HUMAN' AND b."principalId" = u.id
      AND b."roleProfileId" = rp.id AND b.status = 'active'
  );

COMMIT;
```

## 3. 合并前 · 老板（owner → Cathy、Lucas）

```sql
BEGIN;

-- 1) 岗位 owner（已有则跳过）
INSERT INTO "RoleProfile" (id, "orgId", key, name, description, "principalType", "isSystem", status, "createdAt", "updatedAt")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24), o.id, 'owner', '老板',
       '家纺外贸老板：外贸全看全改与外贸设置、管理层；不含成员 / 岗位管理（仅平台管理员）', 'HUMAN', true, 'active', now(), now()
FROM "Organization" o
WHERE o.code = 'mengxin-home-textile'
ON CONFLICT ("orgId", key) DO NOTHING;

-- 2) owner 的权限
INSERT INTO "RolePermissionBinding" (id, "orgId", "roleProfileId", "permissionKey", "dataScope", effect)
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || v.k || v.s), 1, 24), rp."orgId", rp.id, v.k, v.s, v.e
FROM "RoleProfile" rp
JOIN "Organization" o ON o.id = rp."orgId"
CROSS JOIN (VALUES
    ('identity.member.read', 'ORG', 'ALLOW'),
    ('authorization.policy.read', 'ORG', 'ALLOW'),
    ('audit.read', 'ORG', 'ALLOW'),
    ('sales.customer.read', 'ORG', 'ALLOW'),
    ('sales.opportunity.read', 'ORG', 'ALLOW'),
    ('sales.quote.read', 'ORG', 'ALLOW'),
    ('sales.analytics.read', 'ORG', 'ALLOW'),
    ('operations.read', 'ORG', 'ALLOW'),
    ('project.read', 'ORG', 'ALLOW'),
    ('bids.handoff.preview', 'ORG', 'ALLOW'),
    ('bids.handoff.execute', 'ORG', 'ALLOW'),
    ('bids.handoff.override', 'ORG', 'ALLOW'),
    ('operations.projects.create', 'ORG', 'ALLOW'),
    ('trade.read', 'ORG', 'ALLOW'),
    ('trade.manage', 'ORG', 'ALLOW'),
    ('trade.settings.manage', 'ORG', 'ALLOW'),
    ('organization.read', 'ORG', 'ALLOW'),
    ('organization.dashboard.read', 'ORG', 'ALLOW')
) AS v(k, s, e)
WHERE o.code = 'mengxin-home-textile' AND rp.key = 'owner'
ON CONFLICT ("roleProfileId", "permissionKey", "dataScope") DO NOTHING;

-- 3) 岗位模板 owner
INSERT INTO "PositionTemplate" (id, "orgId", key, name, "principalType", status, "isSystem", "primaryRoleProfileId", "createdAt", "updatedAt")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || 'pt'), 1, 24), o.id, 'owner', '老板', 'HUMAN', 'active', true, rp.id, now(), now()
FROM "Organization" o
JOIN "RoleProfile" rp ON rp."orgId" = o.id AND rp.key = 'owner'
WHERE o.code = 'mengxin-home-textile'
ON CONFLICT ("orgId", key) DO NOTHING;

-- 4) Cathy、Lucas 绑 owner（已有 active 绑定则跳过）
INSERT INTO "PrincipalRoleBinding" (id, "orgId", "principalType", "principalId", "roleProfileId", "startsAt", status, "createdAt", "updatedAt")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || u.id), 1, 24), o.id, 'HUMAN', u.id, rp.id, now(), 'active', now(), now()
FROM "Organization" o
JOIN "RoleProfile" rp ON rp."orgId" = o.id AND rp.key = 'owner'
JOIN "OrganizationMember" m ON m."orgId" = o.id AND m.status = 'active'
JOIN "User" u ON u.id = m."userId" AND lower(u.email) IN ('cathy@hlmbedding.com', 'lucas@sunnyshutter.ca')
WHERE o.code = 'mengxin-home-textile'
  AND NOT EXISTS (
    SELECT 1 FROM "PrincipalRoleBinding" b
    WHERE b."orgId" = o.id AND b."principalType" = 'HUMAN' AND b."principalId" = u.id
      AND b."roleProfileId" = rp.id AND b.status = 'active'
  );

COMMIT;
```

## 4. 可选：Lucas 改 super_admin（7b 合并前必须）

```sql
UPDATE "User" SET role = 'super_admin' WHERE lower(email) = 'lucas@sunnyshutter.ca';
```

重新登录后生效。
