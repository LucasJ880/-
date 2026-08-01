# 青砚架构地图（Architecture Map）

**基准：** `80c76e4`（工作区） | **对照 tip：** `main@2255f8d`  
**日期：** 2026-07-31 | **只读审计**

---

## 1. 运行时分层

```text
Browser (App Router pages / client components)
    │  apiFetch / cookie session
    ▼
Next.js Middleware (JWT gate) ── src/middleware.ts
    │
    ▼
API Route Handlers (src/app/api/**/route.ts)
    │  withAuth / getCurrentUser / org resolve
    ▼
Domain Services (src/lib/**)
    │  authorize / rbac / business rules
    ▼
Prisma Client (src/lib/db.ts) ── Neon PostgreSQL
    │
    ├── Vercel Blob (files)
    ├── OpenAI / LangGraph (AI)
    ├── Gmail API (drafts)
    ├── WeChat / WeCom adapters
    └── Sentry / Upstash
```

**无 Server Actions：** 写路径几乎全部经 API Routes。

---

## 2. 多套 Agent 运行时（并存）

| 运行时 | 路径 | 角色（据代码注释/导出） |
|---|---|---|
| `agent` | `src/lib/agent` | 较早 skills/approval |
| `agent-core` | `src/lib/agent-core` | 工具注册、对话引擎 |
| `agent-runtime` | `src/lib/agent-runtime` | Phase-1 session/queue/plan |
| `agent-runtime-v2` | `src/lib/agent-runtime-v2` | Planner/Verifier/Durable |
| `agent-supervisor` | `src/lib/agent-supervisor` | Graph supervisor / workers |
| `ai-grader` | `src/lib/ai-grader` | 微信/场景分级 → PendingAction |
| `project-orchestrator` | `src/lib/project-orchestrator` | 项目 3I / bid / task center |
| `capabilities` | `src/lib/capabilities` | 能力目录、审批、配额、trace |

**架构风险：** 同一「AI 执行」概念有 ≥5 套入口，状态与审批可能落到不同表（`PendingAction` / capabilities approvals / orchestrator approvals）。

---

## 3. 权限双轨

```text
Security-1（新）
  permissions.ts → authorize() → compileAuthorizedWhere()
  销售 API：resolveSalesAuthorizedWhere（org-context.ts）

Legacy RBAC
  rbac/roles.ts + rbac/data-scope.ts + rbac/capabilities.ts
  PendingAction executor：canSeeResource / hasOrgRole
```

**冲突点：** 新权限键（如 `sales.customer.read`）与旧 role 字符串并存；未完成统一前，漏检与重复检并存。

---

## 4. 租户 / 组织上下文流

```text
Login → cookie qy_session
  → /select-org 或 activeOrg
  → API：resolve*OrgId*（销售/助手/运营各自解析）
  → Prisma where.orgId / authorize scope
  → AuditLog.orgId（可选）
```

关键文件：

- `src/app/(auth)/select-org/page.tsx`
- `src/lib/organizations/active-org.ts`
- `src/lib/sales/org-context.ts`
- `src/lib/assistant/thread-org.ts`
- `src/app/api/auth/active-org`, `switch-org`

---

## 5. 核心数据对象关系（简化）

### 销售链（Chain A）

```text
SalesCustomer 1─* SalesOpportunity 1─* SalesQuote
                      │
                      ├─* CustomerInteraction
                      └─? BlindsOrder / 量房预约
Project（工作/投标项目，与销售机会非强制 FK 一体）
  ├─* Task
  ├─* ProjectDocument
  └─* BidDataRevision …
ProjectQuote（项目侧报价，与 SalesQuote 并行概念）
```

### 投标链（Chain B）

```text
ProjectDocument / Agent 投影
  → BidDataRevision
       ├─ TenderRequirement
       ├─ ProductEvidence
       ├─ ComplianceResponse ─ ComplianceResponseEvidence
       └─ PricingScenario ─ PricingScenarioLineItem
  → approve technical/financial → APPROVED → lock → LOCKED
```

### AI 确认链（Chain C）

```text
WeChatMessage / Chat
  → Grader / Runtime
  → PendingAction (pending)
  → POST /api/ai/pending-actions/[id] {decision}
  → approval/port → executor
  → Task / InternalNote / Gmail draft / Sales update
  → AuditLog
```

---

## 6. 部署与数据变更边界

| 动作 | 工作区 (`80c76e4`) | main tip (`2255f8d`) |
|---|---|---|
| `npm run build` | `prisma generate && prisma migrate deploy && next build` | `prisma generate && next build` |
| 受控 migrate | `db:migrate:deploy` = 裸 `prisma migrate deploy` | `safe-migrate-deploy.ts` + 确认 env |
| Cron | `vercel.json` | 同模式（含 postiz-sync 等新 cron，**NEEDS_VERIFICATION** 是否已在生产） |

**事故背景（main 文档）：** `docs/INCIDENT_BUILD_TRIGGERED_DATABASE_MIGRATION.md`（工作区可能尚未同步该文档 — NEEDS_VERIFICATION 工作区 docs 是否齐全）。

---

## 7. 组件 / API 扇出热点

| 公共点 | 影响面 |
|---|---|
| `withAuth` | ~302 routes |
| `apiFetch` + `useCurrentOrgId` | 多数业务页 |
| `OrgSelectBanner` | 组织歧义时阻断操作 |
| `blob-access` | 上传类 API（build 错误 trace 曾指向此链） |
| `PendingAction` UI（assistant cards） | 聊天确认主路径 |

---

## 8. 架构决策债务（摘要）

1. **Agent 运行时未收敛** — 新功能易接错运行时。  
2. **权限双轨** — Security-1 与 rbac 并行。  
3. **销售 Quote vs 项目 Quote vs Trade Quote** — 三套报价对象。  
4. **工作区落后 main** — 本地审计树 ≠ 生产 tip。  
5. **API 过多（500+）且无 CI workflow** — 回归依赖人工 `test-all.sh`。
