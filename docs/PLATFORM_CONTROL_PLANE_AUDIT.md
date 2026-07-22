# 青砚企业能力中台 — 控制面现状审计（Phase 3A 前置）

**日期**：2026-07-22  
**基线 main**：`c40de8d`（含 Phase 2B #4）  
**原则**：先审计、再改码；不重写 Supervisor / Agent Runtime / PendingAction / Tool Registry。

---

## 0. 开发前置条件核对

| # | 条件 | 状态 |
|---|---|---|
| 1 | Phase 2B PR #4 已合入 main | ✅ `c40de8d` |
| 2 | `20260721200000_phase2b_business_semantics` 已部署 | ✅ Neon `_prisma_migrations.finished=true` |
| 3 | Sunny / 梦馨 semantics seed | ✅ glossary 2/2，objects 11/13，metrics 8/8 |
| 4 | Glossary / 业务对象 / Brand Truth / 指标隔离 | ✅ 此前 43/43 双租户验收 |
| 5 | Vercel 正式解锁码环境变量 | ✅ Production + Preview 均 Encrypted |
| 6 | main `tsc --noEmit` | ✅ 通过（2026-07-22） |

**结论**：前置条件满足；六项产品决策已于 2026-07-22 **确认锁定**（见 §11）。本文件为架构基线；实现按 3A-1→3A-5 拆 PR。

**已知非阻塞债**：
- 带 pgvector 的全新空库完整 `migrate deploy` 仍为发布前 P0（无 Neon API key 未跑）。
- 全量测试基线 86/87：既有 Image Engine FormData 失败。

---

## 1. 三套后台必须分离

| 产品面 | 路由 | 受众 | 数据范围 |
|---|---|---|---|
| 企业经营中心 | `/operations/center`（已有） | 老板 / 业务负责人 | 业务结果、指标定义、配置问题摘要 |
| **企业能力中台** | **`/capabilities`**（新建） | Org Admin / Workspace Admin / CTO / AI 运营 | Agent/Skill/Run/审批/治理/成本（**当前 org**） |
| 平台管理后台 | `/admin/*`（已有碎片） | 青砚平台运营方 | 租户开通、平台监控、公共模板（**默认看不到企业业务内容**） |

**已确认路由**：`/capabilities`。第一版子路由：

```text
/capabilities
/capabilities/catalog
/capabilities/runs
/capabilities/approvals
/capabilities/governance
/capabilities/config-health
```

所有 `/capabilities/*` **必须** `requireTenantContext`（membership）；平台管理员无 membership → **403**，不启用 `allowPlatformBypass`。

禁止：
- 经营中心与能力中台共用权限模型；
- 平台 admin 无 membership 进入企业中台业务数据；
- 导航写死 Sunny / 梦馨。

---

## 2. 能力清单审计（18 类）

说明字段约定：
- **归属**：Platform / Organization / Workspace / Project
- **建议**：保留 / 统一读取层 / 废弃（本阶段不删表）

---

### 2.1 Agent Run

| 项 | 现状 |
|---|---|
| Prisma | `AgentRun`（`orgId`, `sessionId`, `status`, `latencyMs`, `errorCode/Message`, `model`, `supervisorState`, lease/retry；**无** `workspaceId`/`projectId`/`userId`/`cost`/`tokens`） |
| 关联 | `AgentSession`（`orgId`, `userId?`, `currentProjectId?`；无 workspace） |
| 服务 | `src/lib/agent-runtime/{run,queue,process,dispatch,pending-link}.ts` |
| API | `/api/cron/agent-runs`, `/api/agent/trace/*`, `/api/agent-supervisor/runs` |
| 页面 | `/agent-trace`, `assistant/agent-run-panel` |
| 归属 | Organization（user 经 Session） |
| 跨租户风险 | 中：有 `orgId`，但缺少 workspace 过滤；查询层需强制 TenantContext |
| 平台 admin 绕过 | 新路径：`canInvokeTool` 拒无 membership；须保证中台 API 一律 `requireTenantContext` |
| 建议 | **保留表**；新增统一读取层 + 可选 `traceId`/`workspaceId` 列（渐进回填） |
| 迁移风险 | 低（加可空列）；勿改运行写入热路径语义 |

---

### 2.2 Supervisor Run

| 项 | 现状 |
|---|---|
| Prisma | **无独立表**；状态在 `AgentRun.supervisorState` JSON |
| 类型 | `SupervisorRunResult`（`src/lib/agent-supervisor/types.ts`） |
| 服务 | `src/lib/agent-supervisor/{engine,persist,workers}/*` |
| API | `/api/agent-supervisor/runs` |
| 页面 | 与 Agent Trace 共用 |
| 归属 | Organization（经 AgentRun） |
| 建议 | **保留 JSON 状态**；中台时间线从 `AgentRunEvent` + supervisorState 投影，**不新建 SupervisorRun 表**（除非 3B 证明必要） |
| 迁移风险 | 重写为独立表 = 高风险，Phase 3A **不做** |

---

### 2.3 Skill Execution

| 项 | 现状 |
|---|---|
| Prisma | `SkillExecution`（`skillId`, `userId` 无 FK，`toolCalls` JSON，`tokenCount?`, `durationMs`, `success`；**无 orgId/workspaceId/projectId**） |
| 父级 | `AgentSkill.orgId` |
| 服务 | `src/lib/agent-core/skills/*`, `src/lib/skills/*` |
| API | `/api/agent-core/skills`, `/api/agent/skills`, product-visual-builder |
| 页面 | `/settings/agent-skills` |
| 归属 | Organization（间接） |
| 跨租户风险 | **高**：执行行无 `orgId`，必须 join Skill.orgId；中台查询禁止裸查 `SkillExecution` |
| 建议 | **保留**；读取层强制 join + 过滤；3A 后期可加冗余 `orgId`（可空回填） |
| 迁移风险 | 加列中等；回填脚本需按 skill 归属 |

---

### 2.4 Tool Execution / Trace

| 项 | 现状 |
|---|---|
| Prisma | `ToolCallTrace`（`projectId`, `environmentId`, `conversationId`, `messageId`, `toolKey`, `status`, `durationMs`；**无 orgId/workspaceId/userId/cost**） |
| 另通道 | `SkillExecution.toolCalls` JSON；`canInvokeTool` 运行时门闩 |
| 服务 | `src/lib/agent-core/observability.ts`, `src/lib/runtime/tool-executor.ts` |
| API | `/api/projects/[id]/conversations/.../tool-traces` |
| 页面 | 项目会话内 |
| 归属 | Project（经 Conversation） |
| 跨租户风险 | **高**：无 orgId，必须经 Project→org 校验 |
| 建议 | **保留**；统一 Trace 读取层投影；高风险工具审批继续走 PendingAction + org 政策 |
| 重复 | 与 SkillExecution.toolCalls **双轨**，中台展示需去重策略（优先结构化 ToolCallTrace，JSON 作补充） |

---

### 2.5 Workflow Execution

| 项 | 现状 |
|---|---|
| Prisma | **无通用表**；分散：`MarketingWorkflowRun`（orgId）、`AutomationRun`、`ProductContentJob/Step`、`MarketResearchRun`、`AgentTask/Step` 等 |
| 服务 | `src/lib/marketing/workflows.ts`, `automation/runner.ts`, `product-content/jobs/*` |
| API / 页面 | marketing automations、product-content、growth |
| 归属 | 多为 Organization；部分 Project |
| 建议 | **不合并表**；能力目录 + 运行中心用 `executionType=WORKFLOW` 适配器逐域接入（3A 先 AgentRun + PendingAction + SkillExecution） |
| 迁移风险 | 强行统一表 = **高**，禁止本阶段 |

---

### 2.6 PendingAction

| 项 | 现状 |
|---|---|
| Prisma | `PendingAction`（`orgId?`, `projectId?`, `createdById`, `approverUserId?`, `agentRunId?`, `status`, `payload`, `expiresAt`；**无 workspaceId**） |
| 服务 | `src/lib/pending-actions/{executor,drafts,types}.ts`, `pending-action-bridge` |
| API | `/api/ai/pending-actions/*` |
| 页面 | `assistant/pending-inbox`, `approval-card` |
| 归属 | Organization / Project（可选） |
| 建议 | **保留执行引擎**；审批中心走 `ApprovalPort` 统一列表；补强：批准前重验 membership/orgRole/政策；payload 完整性校验 |
| 风险 | `orgId` 可选 → 中台查询必须拒绝 orgId 为空的历史脏数据或迁移补齐 |

---

### 2.7 Approval（多套并存）

| 系统 | 模型 | 用途 | 建议 |
|---|---|---|---|
| PendingAction | 上表 | 对话/Agent 草稿审批 | 主路径，保留 |
| ApprovalRequest | `ApprovalRequest` + AgentTask | 旧任务步骤审批 | 经 `ApprovalPort` 只读合并 |
| ProductContentApproval + AgentApprovalSettings | PC 域 | 内容 Job AUTO/ASK + 成本上限 | 保留域策略；中台展示适配 |
| Publish job approve | operations API | 发布审批 | 保留；审批中心后期接入 |
| Tool `needsApproval` | `canInvokeTool` | 工具门闩 | 保留，不替代 PendingAction |

**已有收敛点**：`src/lib/approval/port.ts`（PendingAction + ApprovalRequest 生命周期端口）。  
**Phase 3A**：扩展 Port 的**查询视图**与权限，**不重写**底层 executor。

重复审批系统：是 → **统一入口，不统一表**。

---

### 2.8 Audit Log

| 项 | 现状 |
|---|---|
| Prisma | `AuditLog`（`orgId?`, `projectId?`, `userId`, `action`, `targetType`, `targetId?`, `beforeData/afterData` string；**无 workspaceId/traceId/actorType/riskLevel**） |
| 服务 | `src/lib/audit/logger.ts` |
| API / 页面 | `/api/audit-logs`, `/admin/audit-logs`（偏平台 admin） |
| 归属 | 可选 Organization |
| 建议 | **保留**；企业中台治理页用 org 过滤视图；渐进加 `workspaceId?`/`traceId?`/`actorType`；禁止写密钥/解锁码/完整敏感 Prompt |
| 勿混淆 | `MarketingAuditRun`（营销体检）≠ 平台 AuditLog |

---

### 2.9 模型调用记录

| 项 | 现状 |
|---|---|
| 持久化 | **无统一表**；`recordAiCall` 进程内环形缓冲 + 结构化日志（`src/lib/ai/monitor.ts`） |
| Router | `src/lib/ai/model-registry/*` — **实际仅 OpenAI**（azure 预留） |
| 部分落库 | Conversation/Message tokens；SkillExecution.tokenCount；PC CostEntry |
| 建议 | 新建轻量 **`ModelCallLedger`（或复用/扩展 Cost Ledger）** 写入关键调用（orgId 必填）；中台如实显示「当前 Provider=OpenAI」 |
| 禁止 | UI 假装 Gemini/Qwen/Flux 已可用 |

---

### 2.10 Token 与费用

| 项 | 现状 |
|---|---|
| 模型 | 无平台级 Billing；`ProductContentCostEntry`（org 局部）；Conversation.estimatedCost；AgentApprovalSettings 美分上限 |
| AgentRun | **无** cost/token 字段 |
| 建议 | Phase 3A-4 引入 **Org Cost Ledger**（历史费用固化，不按新价重算）；从 PC ledger + 新 ModelCall 写入双写/迁移 |
| 跨租户 | 禁止全平台默认聚合企业明细 |

---

### 2.11 错误记录

| 项 | 现状 |
|---|---|
| AgentRun | `errorCode`, `errorMessage`, retry/lease |
| ToolCallTrace | `errorMessage` |
| PendingAction | `failureReason` |
| 建议 | 统一错误分类枚举（AUTHORIZATION / TENANT_BOUNDARY / …）在**读取层映射**；不对普通用户暴露 stack |

---

### 2.12 重试和恢复

| 项 | 现状 |
|---|---|
| AgentRun | `attempts`, `nextAttemptAt`, `leaseExpiresAt` |
| Cron | `/api/cron/agent-runs` |
| 建议 | 运行详情展示重试次数/时间；中台不改队列语义 |

---

### 2.13 Agent Trace

| 项 | 现状 |
|---|---|
| Prisma | `AgentRunEvent`（`orgId`, `runId`, `sequence`, `eventType`, `payload`, `visibleToUser`） |
| 页面 | `/agent-trace` |
| 缺口 | 无全局 `traceId` / `parentRunId`；跨 Skill/Tool/Approval 需手工拼 |
| 建议 | **统一关联标识**（见 §4）；优先事件投影，不新建巨型 Trace 表 |

---

### 2.14 配置健康

| 项 | 现状 |
|---|---|
| API | `/api/operations/config-health`（`listOrgConfigIssues` + Industry Pack） |
| 页面 | 经营中心内嵌 |
| 覆盖 | Pack、折扣、OrgBusinessRule 基线；**未覆盖** Glossary/Brand/Skill/Provider/配额/凭证 |
| 建议 | 扩展检查器 + 统一状态枚举 HEALTHY/WARNING/ERROR/MISSING/INCOMPATIBLE；能力中台「配置健康」模块复用并加深 |

---

### 2.15 Workspace 权限

| 项 | 现状 |
|---|---|
| Prisma | `Workspace`, `WorkspaceMember`（role 注释已含 workspace_admin/manager/editor/member/viewer） |
| API | `/api/org/workspaces`（列表/创建，偏 org_admin） |
| UI | **无专用 Workspace 管理页** |
| 绑定 | `WorkspaceSkillBinding`, `WorkspaceKnowledgeBinding` |
| 缺口 | role **未真正接入** `canInvokeTool`；无完整成员管理 UI |
| 建议 | Phase 3A-3 兼容层：解析 Workspace role → 工具/页面权限；Org Admin ≠ 自动可读全部 Workspace 业务数据（需产品规则明示） |

---

### 2.16 orgRole 权限

| 项 | 现状 |
|---|---|
| 模型 | `OrganizationMember.role`：`org_admin` / `org_member` / `org_viewer` |
| 服务 | `src/lib/tenancy/tool-auth.ts` `canInvokeTool` |
| 建议 | **保留为 Organization 真相**；Workspace role 叠加，不能放宽 org 强制政策（forceApproval / disabledTools） |

---

### 2.17 企业模块启用状态

| 项 | 现状 |
|---|---|
| 字段 | `Organization.modulesJson` |
| 服务 | `src/lib/tenancy/modules.ts`；侧栏 `NAV_HREF_MODULES` |
| 建议 | 治理中心只读/编辑（org_admin）；能力目录按模块过滤 |

---

### 2.18 现有运营/管理页面

| 页面 | 角色 | 与中台关系 |
|---|---|---|
| `/operations/center` | 业务经营 | **保留**；不改造成能力中台 |
| `/admin/*` | 平台运营碎片 | **保留**；不并入企业中台导航 |
| `/agent-trace`, `/ai-activity` | 可观测 | 运行中心可链入/逐步吸收列表能力 |
| `/settings/agent-skills` | 技能开关 | 能力目录可链入；不立刻搬迁 |
| `/settings/digital-employees/*` | 数字员工 | 后期接入能力目录 |
| Growth `/operations/growth/*` | 营销运营 | 不进能力中台一级导航 |

---

## 3. 横切问题汇总

### 3.1 租户与安全

| 风险 | 等级 | 说明 | 3A 应对 |
|---|---|---|---|
| SkillExecution / ToolCallTrace 缺 orgId | 高 | 裸查询易串租户 | 读取层强制 join + 测试 |
| PendingAction.orgId 可选 | 中 | 脏数据 | 查询过滤 + 补齐 |
| `allowPlatformBypass` 已定义未接线 | 中 | 运维旁路未白名单化 | 企业中台**禁止** bypass；平台后台另议 |
| 旧 `resolveTradeOrgId(isAdmin)` 旁路 | 高（存量） | 无 membership 可进 trade | **不在本阶段重写 trade**；中台 API 禁止复用该旁路 |
| 缓存/SSE 丢 orgId | 中 | 历史问题 | 中台 API 明确 TenantContext；缓存 key 含 orgId |

### 3.2 可观测缺口

- 无 `traceId` / `parentRunId` / `costAmount` 统一字段（代码检索 0 命中）。
- 模型费用以日志/局部 ledger 为主，无法支撑中台总览「过去 24h 费用」。
- Provider 实际仅 OpenAI。

### 3.3 审批重复

三套以上审批 + ApprovalPort 部分收敛 → **统一 UI/查询，不统一落库**。

### 3.4 建议保留 / 统一 / 废弃

| 能力 | 决策 |
|---|---|
| AgentRun + AgentRunEvent | 保留；Trace 主轴 |
| supervisorState JSON | 保留；不拆表 |
| SkillExecution / ToolCallTrace | 保留；统一读取适配 |
| PendingAction + ApprovalPort | 保留并扩展 |
| ApprovalRequest | 保留表；经 Port 只读 |
| ProductContent 审批/成本 | 保留域内；适配进中台视图 |
| 静态 TOOL_POLICY + OrgBusinessRule.agent_tool_policy | 保留双层；治理中心展示合并视图 |
| 进程内 AI monitor ring buffer | 保留运维日志；**不作为**企业账本 |
| 新建巨型统一 Execution 表 | **本阶段废弃该想法** |

---

## 4. Trace 方案（不破坏 Runtime）

### 4.1 关联标识（渐进）

```text
traceId      // 一次用户请求的相关执行树
runId        // 复用 AgentRun.id 或域内 run id
parentRunId  // 可选；Skill/Tool/Approval 挂到父 Run
```

**落地策略（推荐）**：
1. **3A-1**：定义 `ExecutionRecord` 读取 DTO + 适配器（AgentRun / Event / SkillExecution / PendingAction / ToolCallTrace）。
2. 新写入路径：在 `AgentRun.metadata` / Event payload 中写入 `traceId`（兼容旧数据）。
3. 可选 migration：`AgentRun.traceId`、`PendingAction.traceId` 可空列 + 回填脚本（独立小 PR）。
4. **禁止**重写 engine 调用栈来「一次迁完」。

### 4.2 统一状态映射（读取层）

```text
QUEUED | RUNNING | WAITING_APPROVAL | SUCCEEDED | FAILED | CANCELLED | TIMED_OUT | PARTIAL
```

各源状态 → 上表枚举的映射表放在 `src/lib/capabilities/execution-status.ts`（新建，待确认后）。

### 4.3 时间线投影

```text
用户请求 → AgentRun → (Supervisor steps via events)
         → SkillExecution
         → ToolCallTrace / toolCalls JSON
         → ModelCall（ledger，若有）
         → PendingAction / Approval
         → 结果 / 错误 / 审计
```

---

## 5. 数据模型增量（草案，待确认后实施）

> 以下为**建议**，确认前不建 migration。

| 模型/变更 | 目的 | 优先级 |
|---|---|---|
| `ExecutionTraceLink` 或 AgentRun 可空 `traceId` | 关联 | P0（3A-1） |
| `AiUsageLedger`（统一企业 AI 使用/模型成本账本） | 费用与模型可观测；PC ledger 经 adapter 汇入，不物理合并 | P0（3A-2/4） |
| `OrgQuotaPolicy` + `QuotaUsageCounter` | 配额 | P1（3A-4） |
| WorkspaceMember 管理 API + `canInvokeTool` workspace 层 | RBAC | P0（3A-3） |
| AuditLog 扩展字段（可空） | workspaceId/traceId/actorType | P1 |
| SkillExecution.orgId 冗余可空 | 查询性能与安全 | P1 |
| **不建**统一超级 Execution 宽表 | — | 否决 |

---

## 6. API / 页面草案（待确认）

### 6.1 路由与导航

```text
/capabilities
├─ /capabilities                      总览
├─ /capabilities/catalog              能力目录
├─ /capabilities/runs                 运行中心
├─ /capabilities/runs/[id]            运行详情
├─ /capabilities/approvals            审批中心
├─ /capabilities/governance           治理中心
└─ /capabilities/config-health        配置健康
```

权限：一律 membership；**平台 admin 无 membership → 403**。Org Admin 对企业运行明细的可见性见 §11.6（默认 `AGGREGATE_ONLY`）。

### 6.2 API（建议前缀）

```text
GET  /api/capabilities/overview
GET  /api/capabilities/catalog
GET  /api/capabilities/runs
GET  /api/capabilities/runs/[id]
GET  /api/capabilities/approvals
POST /api/capabilities/approvals/[id]/decide   // 仍调 ApprovalPort / executor
GET  /api/capabilities/governance
GET  /api/capabilities/config-health            // 扩展现有 config-health
GET  /api/capabilities/costs
GET  /api/capabilities/quotas
```

全部强制 TenantContext；列表默认 `orgId=tenant.orgId`；Workspace 过滤器再验 membership。

---

## 7. Phase 3A 实施拆分计划（独立 Commit / 可拆 PR）

### Phase 3A-1：统一 Trace Read Model 与租户隔离

**分支**：`feature/phase3a-1-trace-read-model`（审计 docs PR 合入 main 后从最新 main 创建）

**交付**：
- `ExecutionProjection`（或等效）统一读取类型
- AgentRun / AgentRunEvent 主轴 + Supervisor state 投影
- SkillExecution / ToolCallTrace / PendingAction·Approval 适配器（可信 JOIN + TenantContext）
- 历史可空 `traceId` 兼容；新执行强制生成并传播 `traceId`/`runId`/`parentRunId`/`orgId`（+ 可选 workspace/project）
- Workspace 权限过滤 + Org Admin 默认 `AGGREGATE_ONLY`
- 跨租户 / 无 membership / 伪造 ID 专项测试
- SkillExecution、ToolCallTrace 缺 `orgId` 的封堵说明与后续字段补齐方案

**不做**：运行中心完整 UI、完整成本账本、改 Runtime / Supervisor / PendingAction 执行逻辑。

### Phase 3A-2：运行中心与最小成本账本

**交付**：
- `/capabilities/runs` 列表 + 详情时间线
- 筛选（时间/状态/类型/风险/用户/模型/错误）
- `AiUsageLedger` 最小写入钩子（OpenAI 如实展示；失败不影响主调用）
- Product Content ledger 经 adapter 汇入（幂等，不重复计费）

### Phase 3A-3：审批中心 + Workspace RBAC 第一阶段

**交付**：
- `/capabilities/approvals`（ApprovalPort 企业视图）
- Workspace 成员 CRUD API + 角色校验
- `canInvokeTool` 兼容层接入 Workspace role（不放宽 org 强制政策）
- 审批：重验权限、防 payload 篡改、跨企业拒绝、审计

### Phase 3A-4：治理、配额、成本、审计增强

**交付**：
- `/capabilities/governance`
- OrgQuotaPolicy + warning/soft/hard
- Cost 汇总 API（org/workspace）
- Audit 事件覆盖清单落地（角色/审批/配额/跨租户拒绝等）

### Phase 3A-5：中台总览 + 配置健康 + 能力目录

**交付**：
- `/capabilities` 总览卡片（24h runs/成功失败/审批/耗时/费用/高风险 tool/健康）
- `/capabilities/catalog`（Agent/Skill/Tool/Workflow/KB/Pack/Prompt 只读+启用状态）
- `/capabilities/config-health` 扩展检查（Glossary/Brand/Rules/Provider/配额…）
- 交付文档 `PLATFORM_CONTROL_PLANE_PHASE3A_DELIVERY.md`

---

## 8. 测试计划（按阶段挂载）

| 类别 | 必测 |
|---|---|
| Tenant isolation | Sunny≠梦馨 Run/Trace；伪造 id；无 membership 平台 admin 403 |
| Workspace RBAC | viewer/member/manager/admin 矩阵；跨 WS 不影响 |
| Approval | 无权限拒绝；权限失效拒绝执行；篡改拒绝；跨企业拒绝 |
| Cost | 仅本 org；历史费用不重算；WS 隔离 |
| Quota | warning/soft/hard；WS 不突破 Org hard |
| Audit | 关键动作有记录；无私钥明文 |
| Config health | Pack MISSING；无效 Skill ERROR；无静默跨企业回退 |

---

## 9. 回滚与风险

| 风险 | 缓解 |
|---|---|
| 读取层性能（多表 union） | 分页 + 时间窗默认 24h/7d；后期物化 |
| 双写 ledger 影响主路径 | 异步/best-effort；失败只打日志 |
| Workspace RBAC 误伤现网 | 默认「未配置 WS 角色时回退 orgRole 行为」兼容开关 |
| 审批误收敛 | Port 只扩展查询；执行仍走原 executor |
| 大 PR | 严格按 3A-1…5 拆分 |

回滚：各阶段独立 migration（可空列优先）；UI/API 特征开关 `CAPABILITIES_CONTROL_PLANE=1`（可选）。

---

## 10. Phase 3B 预告（本阶段不做）

- Eval 中心与轨迹评分  
- 拖拽 Agent Builder  
- 多 Provider 热切换与正式计费账单  
- Supervisor/Runtime 重写  
- 完整经营 Dashboard  
- 知识图谱  

---

## 11. 已确认决策（2026-07-22 锁定）

### 11.1 路由 — ✅ 确认

采用 `/capabilities`；与 `/operations/center`、`/admin/*` 三分开。子路由见 §1。无 membership → 403。

### 11.2 Trace — ✅ 确认

统一读取适配层 + 可空历史 `traceId`；**不建**超级 Execution 宽表。主轴 `AgentRun → AgentRunEvent`。不拆 Supervisor 表。新执行尽可能强制传播 `traceId` / `runId` / `parentRunId` / `orgId`（+ 可选 workspace/project）。禁止仅凭 SkillExecution/ToolCallTrace id 跨租户读取。

### 11.3 审批 — ✅ 确认

扩展 ApprovalPort（查询 / 状态映射 / 权限 / 审计 / 执行前重验）；不重写 PendingAction executor。多源并存；审批内容变更则失效或须重批；平台 admin 不能默认批企业动作。

### 11.4 成本 — ✅ 确认

新建 **`AiUsageLedger`**（或同义 `ModelUsageLedger`）；PC ledger **adapter 汇入**，不物理合并、不重复计费；历史费用固化不重算；Provider 如实仅 OpenAI；无法归属企业的旧数据不猜测。

幂等字段建议：`sourceType` / `sourceId` / `idempotencyKey`。

### 11.5 PR 拆分 — ✅ 确认

严格 `3A-1 → 3A-2 → 3A-3 → 3A-4 → 3A-5`，每阶段独立 Commit / 优先独立 PR。  
本文件单独 docs PR：`docs: add Phase 3A control plane architecture audit`。合入后分支：`feature/phase3a-1-trace-read-model`。

### 11.6 Org Admin vs Workspace — ✅ 确认

Org Admin **可以**管理 Workspace 配置/成员、企业治理、聚合指标与健康度。  
**默认不能**在无 Workspace membership 时读取完整输入/输出/客户内容/Tool 参数/文件/Prompt/完整 Trace。

企业级可见性策略（默认 `AGGREGATE_ONLY`）：

| 策略 | 含义 |
|---|---|
| `AGGREGATE_ONLY` | 数量、成本、状态、健康度 |
| `METADATA_ONLY` | 运行元数据，不含业务输入输出 |
| `FULL` | 完整运行内容（须企业明确配置；可审计；平台可禁止；敏感 WS 可强制严格） |

Workspace membership 仍是读取完整运行明细的默认条件。管理权 ≠ 业务内容读取权。
