# Phase 3A-1：Trace Read Model 交付说明

分支：`feature/phase3a-1-trace-read-model`  
基线：审计文档已合入 main（PR #7）

## 范围

- 统一读取类型 `ExecutionProjection` / `TraceBundle`
- 主轴：`AgentRun` → `AgentRunEvent` + Supervisor state 投影
- Adapter：SkillExecution / ToolCallTrace / PendingAction
- `traceId` / `parentRunId` 可空列（AgentRun）+ 新执行写入
- TenantContext + Workspace / Org Admin `AGGREGATE_ONLY` 可见性
- **无**运行中心完整 UI、**无**完整成本账本、**不**改 Runtime 执行主逻辑

## 关键路径

| 模块 | 路径 |
|---|---|
| 类型/查询 | `src/lib/capabilities/*` |
| Trace 传播 | `src/lib/capabilities/trace-context.ts`；`createAgentRun` 轻量写入 |
| Migration | `prisma/migrations/20260722190000_phase3a1_agent_run_trace_ids/` |
| 测试 | `src/lib/capabilities/__tests__/phase3a1-trace-read-model.test.ts` |

## 租户债与封堵

| 模型 | 债 | 3A-1 封堵 | 后续 |
|---|---|---|---|
| SkillExecution | 无直接 orgId | `WHERE skill.orgId = tenant.orgId` | 可空 `orgId` 回填 |
| ToolCallTrace | 无直接 orgId | `WHERE project.orgId = tenant.orgId` | 可空 `orgId`/`workspaceId` 回填 |
| PendingAction | orgId 可选 | orgId 为空不投影 | 补齐脏数据 |

禁止：仅凭 SkillExecution.id / ToolCallTrace.id 跨租户读取。

## 可见性

默认 `Organization.settingsJson.capabilities.runVisibility = AGGREGATE_ONLY`（缺省即此）。  
Workspace 成员可读完整；Org Admin 无 WS membership 时受策略约束。

## 部署

```bash
npx prisma migrate deploy
```

## 非目标（3A-2+）

运行中心 UI、`AiUsageLedger`、审批中心 UI、Workspace RBAC 完整接线。
