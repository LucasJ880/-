# 青砚重复模型与服务审计

**基准：** `80c76e4` | **日期：** 2026-07-31 | **只读**

---

## 1. 重复 / 并行数据模型

| 概念 | 实现 A | 实现 B | 实现 C | 风险 |
|---|---|---|---|---|
| 客户 | `SalesCustomer` | `CustomerProfile` | `TradeProspect`（外贸） | 三套客户视图；跟进动作可能写错表 |
| 商机/线索 | `SalesOpportunity` | Trade 信号/prospect stage | — | 阶段枚举不共享 |
| 报价 | `SalesQuote` (+Items) | `ProjectQuote` (+LineItems) | Trade quotes API | **重复度最高** |
| 任务 | `Task` | Orchestrator AI tasks / AgentRun steps | PendingAction 拟创建任务 | 状态源不唯一 |
| 审批 | `PendingAction` | Capabilities Approvals | Orchestrator workflow approvals | 三套确认 UX |
| 文件/证据 | `ProjectDocument` | `ProductEvidence` | Blob URL 直存字段 | 证据链分散 |
| 项目备注 | Project discussion messages | `grader.internal_note` | ProjectFact | 备注落点多 |
| Agent 运行 | AgentRun（多 schema 世代） | capabilities runs | supervisor runs | trace 难统一 |

### 报价对象（最高重复）

依据：

- `SalesQuote` / `SalesQuoteItem` — 销售模块  
- `ProjectQuote` / `QuoteLineItem` — 项目模块  
- `/api/trade/quotes` + convert-to-sales-quote — 外贸转换（`src/app/api/trade/quotes/[id]/convert-to-sales-quote/route.ts`）

**产品决策待定：** 哪一个是「唯一报价真相」。

---

## 2. 重复 Service / Runtime

| 能力 | 路径集合 | 问题 |
|---|---|---|
| Agent 执行 | `agent`, `agent-core`, `agent-runtime`, `agent-runtime-v2`, `agent-supervisor` | 新代码易接入旧运行时 |
| 权限判定 | `authorization/*` vs `rbac/*` | 双轨 |
| Org 解析 | sales org-context / assistant thread-org / operations resolve / auth active-org | 行为细节不一致风险 |
| 审计写入 | `logAudit` / `writeAuditLog` / authorization audit | 多入口 |

---

## 3. 重复 API 面

| 业务 | 多入口示例 |
|---|---|
| 项目列表 | `/api/projects`, `/api/organizations/[orgId]/projects`, `/api/v1/projects` |
| 审批决策 | `/api/ai/pending-actions/[id]`, `/api/capabilities/approvals/[id]/approve`, orchestrator approvals |
| 用户/组织 | `/api/auth/me`, `/api/users`, `/api/organizations` |

旧 `/api/v1` 仍在 middleware 公开前缀中（`middleware.ts`）— **需确认是否废弃但仍调用**（NEEDS_VERIFICATION）。

---

## 4. 状态枚举不一致

| 域 | 后端/Schema | 前端/其它 |
|---|---|---|
| Bid revision | DRAFT/IN_REVIEW/APPROVED/LOCKED…（大写） | UI 需映射；与 Task 小写 status 风格不一 |
| PendingAction | pending/approved/executed…（小写） | — |
| PublishJob | 工作区 `review`；main tip 增加 `pending_human_approval` 等 | **分支间不一致** |
| Sales opportunity | `STAGE_ORDER` 小写蛇形 | 前端筛选项需对齐 |

Prisma 大量 `String` 而非 enum → 编译期无法防漂。

---

## 5. 直接 DB 访问 vs Service

- 约 **98** 个 API route 文件直接 `db.(customer|project|task|salesQuote|pendingAction|publishJob)` 模式命中（抽样计数）。  
- Bid Data / PendingAction 相对更集中走 service。  
- Sales 部分 route 直接 `db.salesOpportunity.findMany`（例：`opportunities/route.ts`）— 规则在 route+org-context，而非单一 domain service。

---

## 6. 废弃 / 临时信号

| 信号 | 规模（约） | 说明 |
|---|---|---|
| `TODO/FIXME/HACK` | 6（src） | 偏低，可能清理过或用中文备注 |
| placeholder/mock 字样 | 549 命中（含 UI placeholder 属性噪声） | 需人工筛 |
| `as any` | 9 | 较低 |
| `@ts-ignore/@ts-expect-error` | 3 | 较低 |
| `deprecated:` npm scripts | sales-org backfill | 仍保留 |

---

## 7. 公共组件扇出

| 组件 | 风险 |
|---|---|
| `withAuth` / `apiFetch` / `OrgSelectBanner` | 改动影响面极大 |
| `PageHeader` | 低 |
| Assistant 任务卡片策略 | 影响所有 PendingAction 展示 |

---

## 8. 结论

系统最大的结构税不是「缺功能」，而是 **同一业务对象有多套模型 + 多套执行/审批运行时**。稳定化应优先收敛「报价」与「审批」两个概念，而不是继续加第三套。
