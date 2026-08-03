# Qingyan × QM Phase 1 — 架构审计与映射

**基线：** `origin/main@3ddad4e`（`Merge pull request #47 … wave15-acceptance-execution`）
**工作区：** `/Users/user/Desktop/青砚-qm-phase1`
**分支：** `feature/qm-scope-runtime-phase1`
**日期：** 2026-08-03
**性质：** 只读审计后落地；吸收 QM 架构骨架，不接入 QM 完整平台。

---

## 1. 工作区与基线验证

| 项 | 结果 |
|---|---|
| Worktree | `/Users/user/Desktop/青砚-qm-phase1` |
| HEAD | `3ddad4e406cf21accccfe96f71c7764c22d59a55` |
| 分支 | `feature/qm-scope-runtime-phase1` |
| 工作树 | 创建后干净（porcelain=0）；未混入 `/Users/user/Desktop/青砚` WIP |
| 原工作区 | 仍为 `feature/agent-runtime-2-phase1`，约 86 条未提交变更，未触碰 |
| `DATABASE_URL` | 基线测试期间 **UNSET**（未连生产/测试共享库） |
| `build` 脚本 | `prisma generate && next build`（**不含** `migrate deploy`） |
| `build:with-migrations` | 显式受控入口，本轮不调用 |

### 修改前基线测试

| 检查 | 结果 | 备注 |
|---|---|---|
| `npm install` + `prisma generate` | PASS | |
| `npm run typecheck` | PASS | |
| `npm run lint:baseline` | PASS | 既有 53 errors / 114 warnings，无新增 |
| `npm run test:ci` | PASS | |
| `npm run build` | PASS | 既有 NFT warnings；无 migrate |
| `scripts/test-all.sh` | 138/147 | 见下方预存失败 |
| `--api` / 核心 E2E 分类 | SKIPPED | 无本地服务 / COOKIE |
| 生产迁移 | NOT RUN | |

**预存失败（不得归因于 QM Phase 1）：**

1. Phase3A-2 Ledger DB — `PrismaClientInitializationError`（无 DB）
2. Phase3A-2 Smoke Access — 同上
3. Phase3A-3 Approvals Smoke — 同上
4. Phase3A-4 Governance Smoke — 同上
5. Phase3A-4 Acceptance — 同上
6. Phase3A-5 Settle DB — 同上
7. Phase3A-5 Overview Acceptance — 同上
8. Phase3B-A Customer Followup Scenario — 基线逻辑失败（与 DB 无关）
9. Gmail Draft OAuth Compose Scope — 基线逻辑失败（与 DB 无关）

---

## 2. 现状定位（真实代码）

| 能力 | 主线路径 / 符号 |
|---|---|
| 身份 | `src/lib/auth/*`（`getCurrentUser`, `getOrgMembership`, `getProjectMembership`） |
| 租户 | `src/lib/tenancy/context.ts` → `TenantContext` / `requireTenantContext` |
| Agent 租户 | `src/lib/tenancy/resolve-agent-tenant.ts` → `resolveAgentTenant` |
| RBAC（经典） | `src/lib/rbac/{roles,permissions,capabilities}.ts` |
| 授权（Security-1） | `src/lib/authorization/*`（`authorize`, `DataScope`） |
| 项目权限 | `src/lib/projects/access.ts` / `visibility.ts` |
| **主 Runtime** | `src/lib/agent-core/engine.ts` → `runAgent` / `runAgentStream` |
| AgentRun 队列 | `src/lib/agent-runtime/*`（`AgentSession`/`AgentRun` + cron） |
| AR2 / Supervisor | `agent-runtime-v2` / `agent-supervisor`（默认 Feature Flag 关闭） |
| 废弃 Runtime | `src/lib/runtime/*`（禁止新引用） |
| Tool Registry | `src/lib/agent-core/tool-registry.ts` + `tenancy/tool-auth.ts` |
| Skill | `src/lib/agent-core/skills/*` + Prisma `AgentSkill` / `SkillExecution` / `WorkspaceSkillBinding` |
| Grader | `src/lib/ai-grader/*`（含 DailyBusinessBrief / ProjectHealth） |
| PendingAction | `src/lib/pending-actions/*` |
| 审批 | `pending-actions/executor.ts` + `approval/port.ts` |
| Memory / Thread | `UserMemory`（org 隔离）、`AiThread`、项目 `Conversation` adapter |
| 文件 | `src/lib/files/blob-access.ts` + `api/projects/[id]/files` |
| Cron / Queue | `vercel.json` + `api/cron/*` + AgentRun DB lease（无 Redis 队列） |
| 审计 | `src/lib/audit/logger.ts` → `AuditLog` |
| Feature Flag | `feature-flags.ts`、`agent-runtime-v2/flags.ts` 等 env 模式 |
| Kill Switch 近似 | `runtime-isolation.ts` + `*_ENABLED=0` + tool disable |
| Trace | `capabilities/trace-context.ts`（`TraceContext`）；与 `requestId` 未完全统一 |
| 幂等 | `PendingAction.idempotencyKey`、`ApprovalDecisionIdempotency`、AR2 keys |
| Prisma 迁移 | greenfield + 短增量链；`db:migrate:deploy` 走 `safe-migrate-deploy.ts` |

**`ScopeContext`：** 基线 **不存在**。最接近碎片：`TenantContext`、`ConfigScope`、`authorization.DataScope`、`TraceContext`、`AgentTenantResolved`。

---

## 3. QM → 青砚映射表

| QM 概念 | 青砚已有实现 | 缺口 | 本轮处理方式 |
|---|---|---|---|
| Scope | `TenantContext` + `resolveAgentTenant` + project access + `TraceContext` | 无统一不可伪造 ScopeContext | **扩展**：新建薄 `ScopeContext` 组合现有字段 |
| Agent Harness | **主路径** `agent-core` + `agent-runtime` AgentRun | 多栈并存；无标准 Harness 门面 | **扩展**：Harness Adapter 仅包装 `runAgent`，不建第六套 Runtime |
| Scoped Skills | `AgentSkill` + `WorkspaceSkillBinding` + seed | 缺 ownerScope / lifecycle / 权限交集强制 | **扩展**：additive schema + scoped registry |
| Cron/Watch | cron routes + DB queue；trade watch 域特化 | 无通用 Watch | **复用** cron；PoC 走 allowlist 入口，不新建 Watch 平台 |
| Audit Trace | `AuditLog` + `TraceContext` + `AgentRun.traceId` | requestId≠traceId；非强制全链路 | **扩展**：Scope/Harness/PoC 强制 correlationId=traceId |
| Sandbox | 无 | 高风险能力 | **本轮不实现**；靠 risk + PendingAction + isolation |

---

## 4. 阻塞检查（第 4 节暂停条件）

| 条件 | 判定 |
|---|---|
| 另一套正在开发的 ScopeContext | **无**（主线零命中） |
| 必须重写 RBAC | **否** — 扩展 TenantContext / tool-auth |
| 必须更改审批语义 | **否** — 继续 PendingAction |
| P0 级测试基线失败 | **否** — CI unit / typecheck / build 绿；9 个失败为预存（多为无 DB） |
| 模型与代码版本不一致 | **否**（本 worktree 干净对齐 3ddad4e） |
| 无法在独立分支安全实施 | **已消除**（干净 worktree） |
| 必须破坏性迁移 | **否** — 仅 additive |
| 范围明显超过 Phase 1 | **否** — 按 1B–1E 最小闭环 |

**结论：无新增硬阻塞，继续 Phase 1B → 1E。**

---

## 5. 采用方案（摘要）

```text
现有认证 / TenantContext / RBAC / tool-auth
        │
        ▼
   ScopeContext resolver（服务端构造，fail-closed）
        │
        ▼
   Agent Harness Adapter ──► agent-core.runAgent（唯一执行引擎）
        │                         │
        │                         ├── Tool allowlist（服务端）
        │                         └── 高风险 → 现有 PendingAction
        ▼
   Scoped Skill Registry（扩展 AgentSkill，权限取交集）
        │
        ▼
   项目每日简报 PoC（Flag 默认关 + Kill Switch + Shadow + 幂等）
```

**明确不做：** 第二套身份/权限/审批/Runtime；Shell/浏览器沙箱；生产迁移；从脏工作区复制 orchestrator/project-memory WIP。

---

## 6. Feature Flag / Kill Switch（计划命名）

| 开关 | 默认 | 含义 |
|---|---|---|
| `QINGYAN_QM_SCOPE_PHASE1_ENABLED` | `false` | Phase 1 新路径总开关 |
| `QINGYAN_QM_PHASE1_ORG_ALLOWLIST` | 空 | 测试组织白名单 |
| `QINGYAN_QM_PHASE1_PROJECT_ALLOWLIST` | 空 | 测试项目白名单 |
| `QINGYAN_QM_PHASE1_SHADOW_MODE` | `true` | Shadow：可写内部记录/PendingAction 建议，禁止外部副作用 |
| Org `modulesJson.agentAutomationEnabled` | 缺省视为 `true`（兼容）；显式 `false` 为 Kill Switch | 组织级急停 |

实际解析优先遵循现有 env bool / allowlist 模式（见 `feature-flags.ts`）。
