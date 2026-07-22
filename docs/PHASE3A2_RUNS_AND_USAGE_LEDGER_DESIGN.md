# Phase 3A-2 设计说明：运行中心与最小 AI 使用成本账本

分支：`feature/phase3a-2-runs-and-usage-ledger`  
基线：Phase 3A-1 已合入 main（PR #8）

## 1. 目标与边界

### 目标

- 建立 `/capabilities/runs` 运行中心（列表 + 详情）
- 基于 3A-1 Trace Read Model 展示执行链
- 建立最小统一账本 `AiUsageLedger`
- 记录 OpenAI 模型调用的 Token、费用、耗时与归属
- 通过 adapter 纳入 Product Content 已有成本记录（不删旧表）

### 非目标（留给 3A-3+）

完整 Approval Center、Workspace RBAC 重构、Quota、治理/审计完整中心、多 Provider、账单收费、删 PC 旧 ledger、大规模历史回填、Runtime 重写。

---

## 2. 当前查询与数据源

### 2.1 AgentRun / AgentRunEvent

| 项 | 现状 |
|---|---|
| 主表 | `AgentRun`（含 `orgId`、可空 `traceId`/`parentRunId`） |
| 事件 | `AgentRunEvent`（`orgId` + `runId`） |
| 查询入口 | `src/lib/capabilities/execution-query.ts` |
| 会话 | `AgentSession`（`userId`、`currentProjectId`；**无 workspaceId 列**） |
| Workspace | 多来自 `metadata.workspaceId` 或 Project → Workspace |

列表/详情以 AgentRun 为主轴；费用与 Token 从 `AiUsageLedger` 按 `runId`/`traceId` 聚合补齐。

### 2.2 SkillExecution / ToolCallTrace（adapter 展示）

| 源 | 租户债 | 3A-1 封堵 | 3A-2 展示 |
|---|---|---|---|
| SkillExecution | 无直接 orgId | `skill.orgId = tenant.orgId` | Trace 时间线经可信 JOIN；不裸 id |
| ToolCallTrace | 无直接 orgId | `project.orgId = tenant.orgId` | 同上 |
| PendingAction | orgId 可空 | orgId 为空不投影 | 详情时间线保留 |

### 2.3 Model Call 产生位置

| 层 | 路径 | 说明 |
|---|---|---|
| 统一 client | `src/lib/ai/client.ts` | `createCompletion*` → `recordAiCall` |
| 监控钩子 | `src/lib/ai/monitor.ts` | **进程内**环形缓冲 + 日志，**不计费** |
| Embedding | `src/lib/ai/embedding.ts` | 调用后 `recordAiCall` |
| Agent Core | `src/lib/agent-core/engine.ts` | 多轮/流式直接 completions + `recordAiCall` |
| Chat 流 | `api/ai/chat`、`threads/.../messages` | 流结束后 `recordAiCall` |
| PC 图像/文案 | image-engine / jobs / documents | 业务侧 `recordCostEntry`（美分估算） |
| 缺口 | visualizer fetch、TTS/STT、部分直连 OpenAI | 3A-2 **不一次补齐**；优先 monitor + PC 双写 |

### 2.4 为何 `recordAiCall` 不能当账本

1. 仅内存环形缓冲（约 1000 条），进程重启即丢  
2. 无 `orgId` / `workspaceId` / `runId` / `traceId` 持久字段  
3. **不计美元**，无币种、无幂等键  
4. 无跨实例聚合，无法支撑企业账单与运行中心  
5. 无租户隔离查询面  

结论：保留 `recordAiCall` 作运维监控；新增 `recordAiUsage` → `AiUsageLedger`。

### 2.5 Product Content ledger 结构

表 `ProductContentCostEntry`：

`id, orgId, jobId, category, provider?, model?, estimatedCents, actualCents, currency, requestId?, latencyMs?, metaJson?, createdAt`

写入：`src/lib/product-content/cost/ledger.ts` → `recordCostEntry`  
金额：图像按 mode 固定美分；fidelity/document 硬编码；**多为 ESTIMATED**。

### 2.6 新账本与旧 ledger 关系

```
统一查询层 = AiUsageLedger（权威新写入）
           ∪ Product Content Ledger Adapter（只读汇入，不物理合并）
```

- **不删除** PC 旧表  
- 新 PC 调用：`recordCostEntry` 成功后 **双写** `AiUsageLedger`，`idempotencyKey = product_content_cost:{entry.id}`  
- 历史 PC：adapter **只读展示**（能确认 orgId + sourceId + 费用）；**不**批量猜归属、**不**重复写入统一账本  
- 物理回填留独立数据任务  

### 2.7 防重复计费

| 机制 | 说明 |
|---|---|
| `idempotencyKey` UNIQUE | DB 唯一约束；冲突视为已记账，返回已有行 |
| PC 双写 key | `product_content_cost:{entry.id}` |
| Runtime 调用 key | 优先调用方传入；否则 `openai_call:{orgId}:{requestId}:{source}:{fingerprint}` |
| 查询层 | 汇总时 PC adapter **排除**已双写到 AiUsageLedger 的 `sourceId`（或仅查 ledger 中非 PC 源 + adapter 中未双写） |
| 重试 | 同一 idempotencyKey 不新增费用行 |

### 2.8 历史无 traceId

- AgentRun 仍可列表/详情展示基础信息（状态、时间、模型列等）  
- TraceBundle：`traceId = null` 时仅绑定该 `runId` 的 events / pending；ledger 用 `runId` 关联  
- 禁止用模糊匹配跨租户猜 trace  

### 2.9 无法确认 orgId 的旧记录

- **不得**自动导入统一账本  
- `recordAiUsage` 无 orgId → 打技术日志并跳过（不阻断业务）  
- PC 历史：无 orgId 的行 adapter 不展示  

---

## 3. AiUsageLedger 模型（建议）

字段见实施 Schema。要点：

- `orgId` 必填  
- `idempotencyKey` 唯一  
- `costAmount` Decimal(18,6)，保存**调用发生时**金额，不按未来价重算  
- `status`: SUCCEEDED / FAILED / PARTIAL / ESTIMATED  
- `sourceType`: AGENT_RUNTIME / PRODUCT_CONTENT / IMAGE_ENGINE / SUPERVISOR / WORKFLOW / MANUAL_IMPORT  
- `usageType`: TEXT / IMAGE / EMBEDDING / AUDIO / OTHER  
- `provider` 当前真实仅 `openai`；未接入 Provider 不展示为可用  
- `metadataJson` 禁止 API key / OAuth / 解锁码 / 完整敏感 Prompt  

索引：

- `(orgId, occurredAt)`  
- `(workspaceId, occurredAt)`  
- `traceId`  
- `runId`  
- `(provider, model)`  
- `idempotencyKey` UNIQUE  

---

## 4. 写入钩子 `recordAiUsage`

```ts
recordAiUsage({
  tenant,          // 至少 orgId；可选 workspace/project/user
  traceContext,    // 可选 traceId/runId/parentRunId
  source,          // sourceType + sourceId + idempotencyKey
  provider, model, usage, cost, duration, status,
})
```

规则：

1. 写账本失败 **不**默认导致核心业务失败（best-effort + 技术错误日志）  
2. 高价值失败可记 `PENDING_COMPENSATION`（metadata 标记；完整补偿队列 3A-3）  
3. 模型成功、业务后续失败 → **仍记**模型费用  
4. 模型失败但可能收费 → 允许记 FAILED/PARTIAL  
5. 不伪造缺失 Token；无精确价 → `ESTIMATED`  
6. 精确与估算可区分（status / metadata.pricingMode）  

**本阶段挂钩点（最小）：**

1. `monitor.recordAiCall` → 异步 best-effort `recordAiUsage`（有 orgId 时）  
2. `product-content/cost/ledger.recordCostEntry` → 双写  
3. 不重写 Agent Runtime / Supervisor 执行主路径  

---

## 5. API

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/capabilities/runs` | 运行列表（分页、筛选） |
| GET | `/api/capabilities/runs/[runId]` | 运行详情 |
| GET | `/api/capabilities/runs/[runId]/trace` | Trace Bundle + usage |
| GET | `/api/capabilities/usage/summary` | 成本汇总卡片/表格 |
| GET | `/api/capabilities/usage/timeseries` | 按日序列 |

约束：

- `requireTenantContext` + `buildCapabilitiesAccess`（无 membership → 403）  
- 不信任 query/body 的 orgId  
- Workspace 后端验证  
- 伪造 runId/traceId/ledgerId → 404  
- 最大时间范围（默认 90 天）、最大 pageSize（默认 50，硬顶 100）  

### 列表字段

开始时间、状态、执行类型、Agent/Skill/Workflow、Workspace、Project、用户、模型、总耗时、总 Token、总费用、Tool 调用数、是否待审批、是否有错误。

### 筛选

时间、Workspace、Project、状态、执行类型、Agent、Skill、Tool、用户、模型、有错误、待审批。

默认：`startedAt`/`createdAt` 倒序 + 分页。

### 详情

基本信息 + 3A-1 时间线 + Model Usage（ledger）+ 错误摘要（无完整 stack）。  
敏感字段默认不返回。

---

## 6. 页面

- `/capabilities/runs` — 列表 + 汇总卡片入口  
- `/capabilities/runs/[runId]` — 详情（`?traceId=` 仅作提示；服务端用可信 JOIN 校验）  

侧栏增加「能力中台 / 运行中心」入口（membership 用户可见）。

---

## 7. 可见性

沿用 3A-1：`AGGREGATE_ONLY`（默认）/ `METADATA_ONLY` / `FULL`。

| 角色 | 行为 |
|---|---|
| Workspace Member | 可读所属 WS 运行明细 |
| Org Admin + AGGREGATE_ONLY | 数量、成功率、成本汇总、状态、健康；无完整 IO/Tool 参数 |
| Org Admin + METADATA_ONLY | 元数据 + 时间线名称；无业务 payload |
| Org Admin + FULL | 仍受平台强制脱敏；高敏策略后续强化 |
| 平台 admin 无 membership | **403**，不可进企业中台 |

成本聚合：仅当前 org；WS 管理员仅有权限 WS；平台总体成本不在本阶段。

---

## 8. Migration 与回滚

- 名称：`20260722195000_phase3a2_ai_usage_ledger`  
- 仅新增表 + 索引；**不改**已应用 migration；**不改** PC 旧表  
- Deploy 前后：`npx prisma migrate status`  
- 回滚：`DROP TABLE "AiUsageLedger"`（或迁移 down 说明）；应用代码回退到无读写账本版本  
- **不**自动回填无归属历史数据  

---

## 9. 测试矩阵（摘要）

Tenant isolation / Workspace visibility / Ledger 幂等与估算区分 / Trace 关联 / API 分页与时间窗 / 403·404。

详见交付文档与 `phase3a2-*.test.ts`。

---

## 10. 实施顺序

1. 本文档  
2. Schema + migration  
3. `recordAiUsage` + pricing 估算 + monitor/PC 挂钩  
4. PC adapter 查询层  
5. Runs / Usage API  
6. 页面  
7. 测试 + 交付文档 + PR  
