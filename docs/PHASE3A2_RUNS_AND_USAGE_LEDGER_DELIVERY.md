# Phase 3A-2 交付说明：运行中心与最小 AI 使用成本账本

## 摘要

| 项 | 值 |
|---|---|
| 分支 | `feature/phase3a-2-runs-and-usage-ledger` |
| 基线 | main @ `da47b23`（PR #8 Phase 3A-1 合入后） |
| Commit | （见 PR） |
| Migration | `20260722195000_phase3a2_ai_usage_ledger` |
| Neon | 已 `migrate deploy`，`migrate status` up to date |

## 修改文件（核心）

### 文档
- `docs/PHASE3A2_RUNS_AND_USAGE_LEDGER_DESIGN.md`
- `docs/PHASE3A2_RUNS_AND_USAGE_LEDGER_DELIVERY.md`

### Schema / Migration
- `prisma/schema.prisma` — `AiUsageLedger` + Organization 关系
- `prisma/migrations/20260722195000_phase3a2_ai_usage_ledger/migration.sql`

### 账本与查询
- `src/lib/capabilities/usage/*` — types / pricing / sanitize / record / pc-adapter / query
- `src/lib/capabilities/runs/list.ts` — 运行列表
- `src/lib/capabilities/runs/detail.ts` — 详情（Trace + Usage）
- `src/lib/capabilities/http.ts` — API 访问封装
- `src/lib/ai/usage-ledger-bridge.ts` — monitor → ledger 桥接
- `src/lib/ai/monitor.ts` — best-effort 挂钩
- `src/lib/product-content/cost/ledger.ts` — PC 双写统一账本

### API
- `GET /api/capabilities/runs`
- `GET /api/capabilities/runs/[runId]`
- `GET /api/capabilities/runs/[runId]/trace`
- `GET /api/capabilities/usage/summary`
- `GET /api/capabilities/usage/timeseries`

### 页面
- `/capabilities/runs`
- `/capabilities/runs/[runId]`
- 侧栏「运行中心」入口（`nav_capabilities_runs`）

### 测试
- `src/lib/capabilities/__tests__/phase3a2-runs-and-usage.test.ts`
- `src/lib/capabilities/__tests__/phase3a2-ledger-db.test.ts`
- `scripts/test-all.sh` 已注册

## Schema

`AiUsageLedger`：orgId 必填；`idempotencyKey` UNIQUE；`costAmount Decimal(18,6)`；索引含 orgId+occurredAt、workspaceId+occurredAt、traceId、runId、provider+model、source 组合。

## Ledger 写入入口

| 入口 | 行为 |
|---|---|
| `recordAiUsage` / `recordAiUsageBestEffort` | 统一写入；失败默认不阻断业务 |
| `monitor.recordAiCall` | 有 request `orgId` 时桥接；无 orgId **跳过**（不猜测） |
| `product-content recordCostEntry` | 双写 `product_content_cost:{entry.id}` |

当前仅真实展示 OpenAI；费用默认 `ESTIMATED` + 固定 `pricingVersion`，不重算历史价。

## Product Content adapter

统一查询 = `AiUsageLedger` ∪ PC adapter 只读汇入；已双写 `sourceId` 去重，避免重复计费。不删除旧表，不批量回填无归属历史。

## 可见性

沿用 AGGREGATE_ONLY（默认）/ METADATA_ONLY / FULL；无 membership → 403；query orgId 不可信。

## 验证

```text
npx prisma validate          ✅
npx prisma generate          ✅
npx prisma migrate deploy    ✅（Neon）
npx prisma migrate status    ✅ up to date
npx tsc --noEmit             ✅
npm run build                ✅
phase3a1 tests               ✅ 41/41
phase3a2 logic tests         ✅ 26/26
phase3a2 ledger db           ✅ 8/8
```

## 已知限制

1. AgentRun 无一等 `workspaceId` 列，依赖 metadata / Project  
2. monitor 桥接依赖 request context 的 orgId；后台 cron 无上下文时不记账  
3. 部分直连 OpenAI（visualizer fetch、TTS/STT、weekly-report）尚未挂钩  
4. Org Admin FULL 的高敏 Workspace 禁令未落地（3A-3/治理）  
5. 补偿队列仅预留日志级；无完整 PENDING_COMPENSATION worker  
6. PC Job 无 workspaceId，WS 级 PC 成本过滤能力有限  

## 3A-3 建议

- Approval Center 最小 UI + ApprovalPort 扩展接线  
- 补齐缺口模型调用挂钩（图像/语音/直连）  
- Workspace 级可见性与高敏策略  
- 可选：AgentRun.workspaceId 可空列回填  
- Quota / 治理中心仍按路线图后置  
