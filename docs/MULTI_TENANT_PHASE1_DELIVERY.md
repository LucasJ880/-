# 多租户四层架构 — 第一阶段交付报告

日期：2026-07-21

---

## 1. 当前架构结论

| 项 | 结论 |
|----|------|
| 多租户成熟度 | **中等 → 可用并存**：租户边界明确为 Organization；P0 串租路径已堵 |
| 已有基础 | Membership、activeOrg、销售/外贸 org 解析、OrgKnowledge/UserMemory org 过滤 |
| 主要剩余风险 | 旧 `requireOrgRole` 超管静默放行；Gmail/凭证按人；向量表无列级 orgId；Sunny 文案硬编码 |
| Sunny + 梦馨 | **同代码同库可安全并存**（P0 路径）；需 seed 模块配置并部署 migration |

层级：

```text
Platform → Organization/Tenant → Workspace/Department → Project
```

---

## 2. 修改文件列表（摘要）

| 文件 | 原因 |
|------|------|
| `docs/MULTI_TENANT_ARCHITECTURE_AUDIT.md` | 正式审计 |
| `src/lib/tenancy/*` | TenantContext、assert、modules、scope |
| `src/lib/sales/vector-search.ts` | 强制 orgId JOIN 过滤 |
| `src/app/api/sales/knowledge/search|profile` | org 限定 |
| `src/app/api/sales/measurements/[id]` | 防 IDOR |
| `src/app/api/sales/customers/[id]/ai-advice` | org 限定 |
| `src/lib/agent-core/tools/trade.ts` | trade_get_prospect org 校验 |
| `src/lib/agent-core/tools/sales-coaching.ts` | 搜索带 orgId |
| `src/app/api/blinds-orders/[id]` PUT | 项目可见性校验 |
| `src/lib/sales/profile-engine.ts` | refreshAll 强制 orgId |
| `src/lib/api-fetch.ts` | product-content 自动带 orgId |
| `prisma/schema.prisma` + migration | modulesJson / Workspace |
| `scripts/seed-org-*.ts` | Sunny/梦馨模块与 Workspace |
| `src/components/sidebar.tsx` | 按 modules 裁剪导航 |
| `src/app/(main)/operations/center/page.tsx` | 经营中心空壳 |
| `src/app/api/org/workspaces/route.ts` | Workspace API 骨架 |
| `src/app/api/auth/active-org/route.ts` | 返回 modules |
| `src/lib/tenancy/__tests__/*` + `test-all.sh` | 隔离测试 |

---

## 3. 数据模型变化

- `Organization.modulesJson` / `settingsJson`（可空 JSON）
- `Workspace` / `WorkspaceMember`
- `Project.workspaceId`（可空）
- Migration：`prisma/migrations/20260721180000_tenancy_workspace_modules/`
- Backfill：由 seed 写入 modules 与示例 Workspace；不猜历史业务归属

---

## 4. 权限与隔离方案

- **TenantContext**：`requireTenantContext` 默认 `requireMembership: true`；平台超管无 membership 则 403（运维可用 `allowPlatformBypass`）
- **API**：P0 路径用 `resolveSalesOrgIdForRequest` / `findFirst({ orgId })`
- **向量**：JOIN `SalesCustomer.orgId`；Insight 限本 org 成员 userId
- **文件**：`pathnameDeclaresOrg` 辅助；代理层既有前缀鉴权不变
- **Agent**：工具 ctx.orgId 强制；prospect 查询带 orgId
- **导航**：`modulesJson.enabled` + 角色双重过滤

---

## 5. 测试结果

```bash
npx tsx src/lib/tenancy/__tests__/tenant-context.test.ts
npx tsx src/lib/tenancy/__tests__/tenant-isolation.test.ts
npx tsx src/lib/tenancy/__tests__/tenant-file-access.test.ts
# 或
./scripts/test-all.sh
```

Prisma：`npx prisma generate` 已通过。

部署前请在目标库执行：`npx prisma migrate deploy`，然后：

```bash
npm run seed:org:sunny-home-deco
npm run seed:org:mengxin-home-textile
```

### 已知未覆盖风险

- 全量 API 未逐条迁移到 `requireTenantContext`
- `sales-quotes/` Blob 代理白名单仍缺
- 凭证仍为 user 级
- 多标签/SSE 切换竞态未清零

---

## 6. 下一阶段建议

1. Workspace 完整 RBAC 与项目继承  
2. 向量/画像表列级 `orgId` backfill  
3. 平台超管全面去业务默认放行  
4. 企业级凭证与 BrandProfile 替换 Sunny 硬编码  
5. 经营中心 Dashboard Schema  
6. 计费 / 独立库企业版  
