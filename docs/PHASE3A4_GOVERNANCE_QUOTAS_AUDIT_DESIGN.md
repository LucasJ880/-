# Phase 3A-4 设计说明：治理中心、企业配额与审计增强

分支：`feature/phase3a-4-governance-quotas-audit`  
基线：main @ `9931ef9`（PR #10 合入后）

## 1. 目标与边界

### 目标

- `/capabilities/governance`（policies / quotas / audit）
- 统一治理 Read Model（modules / Industry Pack / Tool Policy / Visibility / Provider / Quotas）
- Organization / Workspace AI 配额（warning / soft / hard）
- Reservation 防并发穿透 hard limit
- 接线 Agent Run / 高风险 Tool / 图片 / 成本入口
- 统一 `writeCapabilityAuditEvent`
- **不做**正式计费、发票、多 Provider 真接入、Runtime 重写

### 非目标

账单扣款、Agent Builder、Eval、BPMN、删旧成本表、为 Sunny/梦馨复制页面。

---

## 2. 现状审计

| 能力 | 现状 | 3A-4 策略 |
|---|---|---|
| `modulesJson` | Organization 字段 + `tenancy/modules.ts` | Read Model 投影 |
| Industry Pack | `industry-packs/registry.ts` | 投影 status OK/MISSING/INVALID |
| OrgBusinessRule / Tool Policy | `org-rules/service.ts` | adapter；WS 只能收紧 |
| Workspace scoped config | `resolveScopedConfig` | 复用优先级思想；配额独立 resolve |
| Provider Router | 仅 OpenAI 可用 | 如实 ACTIVE / NOT_CONFIGURED |
| AiUsageLedger + PC adapter | 3A-2 | 用量汇总，去重 |
| PC / Image budget | job 级美分 | 保留；接入日图片/月费用配额 |
| AgentRun / ToolCallTrace | 3A-1 JOIN | 并发/高风险计数 |
| AuditLog | 无 workspaceId/traceId | 可空列扩展 + 统一写入 |
| 配额表 | **无** | 新增 Policy + Reservation |

重复：PC job 预算 ≠ 企业配额（并存）。  
adapter 统一：治理展示；新模型：QuotaPolicy / Reservation。

---

## 3. 防放宽与并发

- Platform hard ≥ Org hard ≥ Workspace hard（数值上 hard 取**最严/最小**上限）
- Workspace 不得高于 Organization hard
- Reservation：`idempotencyKey` UNIQUE；reserve → commit/release；过期不占额度
- hard limit 统计 = committed 用量 + 未过期 reserved

---

## 4. Schema

### CapabilityQuotaPolicy

`orgId`, `workspaceId?`, `metric`, `period`, `warningLimit?`, `softLimit?`, `hardLimit?` (Decimal), `enabled`, `version`, `effectiveFrom`, `effectiveTo?`, `createdById?`, timestamps  
唯一：`(orgId, coalesce(workspaceId,''), metric, version)` 应用层保证；索引 `(orgId, metric, enabled)`

Metrics：`MONTHLY_AI_COST | DAILY_AGENT_RUNS | DAILY_HIGH_RISK_TOOL_CALLS | DAILY_IMAGE_GENERATIONS | MAX_CONCURRENT_RUNS | SINGLE_RUN_ESTIMATED_COST`  
Periods：`PER_RUN | DAILY | MONTHLY | CONCURRENT`

### CapabilityQuotaReservation

`orgId`, `workspaceId?`, `metric`, `amount`, `idempotencyKey` UNIQUE, `status` (RESERVED|COMMITTED|RELEASED|EXPIRED), `expiresAt`, `committedAt?`, `releasedAt?`, `runId?`, `traceId?`

### AuditLog 扩展（可空）

`workspaceId?`, `traceId?`, `riskLevel?`

回滚：DROP 新表；DROP 新列。不改历史 migration。

---

## 5. 核心 API

```
resolveEffectiveQuota / evaluateQuota / reserveQuota / commitReservation / releaseReservation
getGovernanceProjection / getGovernanceUsage / listCapabilityAudit
writeCapabilityAuditEvent
```

默认安全限额（未配置时）：保守平台默认（如日 Agent Runs 200、并发 10、日高风险 Tool 50、日图片 100、月费用 $50），写明在代码常量。

---

## 6. 接线

| 入口 | 检查 |
|---|---|
| `createAgentRun` | DAILY_AGENT_RUNS, MAX_CONCURRENT_RUNS, SINGLE_RUN_ESTIMATED_COST |
| `canInvokeTool` 后 / ToolRegistry | DAILY_HIGH_RISK_TOOL_CALLS（l2+） |
| 图片 generate/edit | DAILY_IMAGE_GENERATIONS, MONTHLY_AI_COST（估） |
| recordAiUsage 前（可选） | MONTHLY_AI_COST 预检 |

无可信 orgId → 不执行企业调用。

---

## 7. 权限

- Org Admin：管企业 quota / 看企业治理审计；默认不看无 WS 的完整业务 Trace
- Workspace Admin：只能收紧本 WS
- manager：只读用量/warning
- editor/member/viewer：无治理写权限
- 平台 admin 无 membership → 403

---

## 8. 页面 / API

- `/capabilities/governance`（Tabs: 概览 / policies / quotas / audit）
- `GET/POST/PATCH` governance APIs 见需求文档

策略修改：`expectedVersion` 乐观锁；冲突 409。

---

## 9. Hard limit 下调与进行中任务

- 下调 hard limit **不删除、不取消** 已有 RUNNING/QUEUED 执行
- **新** createAgentRun / Tool / 图片 / 模型预检立即使用新规则
- 已 RESERVED 的未过期预留仍占额度，直至 commit/release/expire
- 并发指标：进行中 Run + RESERVED 计入用量；过期预留惰性标记 EXPIRED

---

## 10. Migration / 回滚

- Forward：`20260722201000_phase3a4_governance_quotas_audit`
- 回滚：DROP `CapabilityQuotaReservation` / `CapabilityQuotaPolicy`；DROP AuditLog 新列与索引
- 不改写历史 migration；不删旧成本表
