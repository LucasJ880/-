# 青砚多租户架构审计（第一阶段）

> 审计日期：2026-07-21  
> 目标层级：`Platform → Organization/Tenant → Workspace/Department → Project`  
> 首批样板租户：`sunny-home-deco`、`mengxin-home-textile`

---

## 1. 当前结构

| 层级 | 现状 | 说明 |
|------|------|------|
| Platform | `User.role`（admin/super_admin 等） | 平台身份，**非**租户边界 |
| Organization | Prisma `Organization` + `OrganizationMember` | **唯一正式租户边界** |
| Workspace | **不存在** | `Company`=联合品牌；`Environment`=项目 Prompt/KB 环境 |
| Project | `Project.orgId` 可选 | 租户边界未强制 NOT NULL |

**当前组织切换**

- 服务端：`User.activeOrgId`（[`src/lib/organizations/active-org.ts`](../src/lib/organizations/active-org.ts)）
- 客户端：`localStorage` `qingyan_selected_org_id`（[`src/lib/org-selection.ts`](../src/lib/org-selection.ts)）
- Session JWT **不含** orgId；API 靠 query `?orgId=`（[`src/lib/api-fetch.ts`](../src/lib/api-fetch.ts)）
- 切换后整页 `reload`（无 React Query）

---

## 2. 已有多租户基础

- Membership 校验：`getOrgMembership`、`requireOrgRole`
- 销售/外贸 org 解析：`src/lib/sales/org-context.ts`、`src/lib/trade/access.ts`
- 核心表已有 `orgId`：SalesCustomer/Opportunity/Quote、Trade*、ProductContent*、OrgKnowledge*、UserMemory、AgentRun
- 文件代理对 `product-content/{orgId}`、`trade-service/{orgId}` 等前缀做 org 鉴权
- Org 知识库向量 SQL 强制 `orgId`；UserMemory 强制 `orgId`

---

## 3. 发现的问题与高风险越权点

### P0（本轮已修 / 必须修）

| 风险 | 位置 |
|------|------|
| 销售向量检索无 org 过滤 | `src/lib/sales/vector-search.ts` |
| 客户画像跨 org | `src/app/api/sales/knowledge/profile/route.ts` |
| 量房记录 IDOR | `src/app/api/sales/measurements/[id]/route.ts` |
| AI advice 裸 findUnique | `src/app/api/sales/customers/[id]/ai-advice/route.ts` |
| Agent `trade_get_prospect` IDOR | `src/lib/agent-core/tools/trade.ts` |
| 工艺单 PUT 无授权 | `src/app/api/blinds-orders/[id]/route.ts` |

### P1 / 技术债（后续）

- `requireOrgRole` 对 `isSuperAdmin` 静默升为 `org_admin`（平台/企业权限混用）
- `SalesKnowledgeChunk` / `CustomerProfile` / `MeasurementRecord` 无列级 `orgId`
- `QuoteDiscountSettings` / `FabricInventory` / `ApiToken` 全局
- Gmail/Calendar 凭证按 `userId` 非 `orgId`
- Sunny 品牌文案硬编码（邮件/报价）
- `sales-quotes/` Blob 未纳入 files 代理白名单
- `/api/product-content` 未进 `apiFetch` org 自动注入（本轮补）

---

## 4. 建议的数据层级

```text
Platform（青砚运营）
  → Organization / Tenant（sunny-home-deco | mengxin-home-textile）
    → Workspace / Department（Sales、Trade、…）
      → Project
```

配置继承优先级（不可覆盖安全/租户隔离）：

```text
Platform 默认 → Organization → Workspace → Project
```

`ConfigScope`：`PLATFORM | ORGANIZATION | WORKSPACE | PROJECT`

---

## 5. 需要修改的模型（第一阶段）

| 变更 | 策略 |
|------|------|
| `Organization.modulesJson` / `settingsJson` | 可空 JSON；seed backfill |
| `Workspace` + `WorkspaceMember` | 新增；`@@unique([orgId, slug])` |
| `Project.workspaceId` | 可空 FK |
| 向量表列级 `orgId` | **本轮不做**；用 JOIN `SalesCustomer.orgId` 过滤 |

---

## 6. 需要修改的 API / 库

- 新建统一 `src/lib/tenancy/*`（TenantContext）
- P0 隔离路径改为 membership + org 限定查询
- `GET` active-org / org me 返回 `modules`
- `GET/POST /api/org/workspaces`
- 侧栏按 modules 过滤；经营中心空壳 `/operations/center`

---

## 7. 数据查询规范

禁止：

```ts
db.customer.findUnique({ where: { id: customerId } });
```

应使用：

```ts
db.customer.findFirst({
  where: { id: customerId, orgId: tenant.orgId },
});
```

或先查后 `assertEntityBelongsToOrg(entity.orgId, tenant.orgId)`。

`update`/`delete`：先 `findFirst` 带 `orgId` 验证，再写。

后台脚本必须显式传入目标 `orgId` / `orgCode`，禁止默认扫全库。

---

## 8. 分阶段实施

| 阶段 | 内容 |
|------|------|
| **本轮 P0/P1** | 审计文档、TenantContext、P0 IDOR、modulesJson、Workspace 骨架、双租户 seed、侧栏、测试 |
| 下一阶段 | Workspace 完整 RBAC、凭证 per-org、向量列 backfill、平台超管全面去业务默认放行、品牌迁 BrandProfile、计费 |

---

## 9. 迁移与回滚

**部署顺序**：`prisma migrate deploy` → seed 模块配置 → 发布应用代码。

**回滚**：

- 代码回退上一版本；
- JSON/可选 FK 迁移可 drop column / drop table（不删业务行）；
- 不猜测归属做 destructive backfill。

**存量缺 orgId**：审计标记；能可靠 JOIN 归属的用 JOIN；无法确定的停止自动迁移。

---

## 10. 平台 Admin vs Organization Admin

| 角色 | 职责 | 本轮行为 |
|------|------|----------|
| Platform Admin | 租户开通、公共模板、系统健康 | `requireSuperAdmin`；**业务 TenantContext 默认要求 membership** |
| Organization Admin | 本企业成员/模块/知识/审批 | `OrganizationMember.role = org_admin` |
| Workspace Roles | workspace_admin/manager/editor/member/viewer | 字段预留，本轮不做完整 RBAC |

旧 `requireOrgRole` 超管放行保留为技术债，新路径走 `requireTenantContext({ requireMembership: true })`。

---

## 11. Sunny / 梦馨安全并存结论

| 问题 | 结论 |
|------|------|
| 能否同库同代码？ | 可以，且必须 |
| 修复前能否安全并存？ | **否**（向量/量房/线索等可串租） |
| 本轮修复后 | P0 路径可安全并存；P1 债见上表 |

---

## 12. 企业切换已知风险（未一次清零）

1. 本地 localStorage 与服务端 `activeOrgId` 短暂不一致  
2. 多标签页切换可能短暂混乱  
3. SSE/长连接若未随 org 重建可能用旧上下文  
4. 无 React Query 细粒度失效（靠 reload）  

下一阶段可评估：session 内 org claim、BroadcastChannel 同步、SSE 绑定 org。
