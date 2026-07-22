# Phase 3A-4 交付说明：治理中心、企业配额与审计增强

## 分支 / Commit / PR

- 分支：`feature/phase3a-4-governance-quotas-audit`
- Commit：`feat(capabilities): add Phase 3A-4 governance quotas and audit`
- 基线：main @ `9931ef9`（PR #10 合入后）
- 设计：`docs/PHASE3A4_GOVERNANCE_QUOTAS_AUDIT_DESIGN.md`

## 修改文件（主要）

- Schema / Migration：`CapabilityQuotaPolicy`、`CapabilityQuotaReservation`；`AuditLog` 增 `workspaceId`/`traceId`/`riskLevel`
- Migration：`20260722201000_phase3a4_governance_quotas_audit`（Neon applied）
- 治理层：`src/lib/capabilities/governance/*`
- API：`/api/capabilities/governance*`
- 页面：`/capabilities/governance`（overview / policies / quotas / audit）
- 接线：`agent-runtime/run.ts`、`tool-registry.ts`、`image-client.ts`、`ai/client.ts`（月费用预检）
- 测试：`phase3a4-governance.test.ts`、`phase3a4-governance-smoke.test.ts`
- 导航 / i18n：sidebar + zh/en

## Schema

| 模型 | 用途 |
|---|---|
| CapabilityQuotaPolicy | Org/WS 配额策略（Decimal 限额 + version + 生效期） |
| CapabilityQuotaReservation | 并发穿透防护（RESERVED/COMMITTED/RELEASED/EXPIRED） |
| AuditLog 扩展列 | workspaceId / traceId / riskLevel（可空） |

## Governance Read Model

`getGovernanceProjection`：Industry Pack、modules、Tool Policy、Visibility、Provider 状态、有效配额。  
复用 Platform→Org→WS 收紧语义；不写死 Sunny/梦馨；仅 OpenAI 可显示 ACTIVE。

## Quota / Reservation

- `resolveEffectiveQuota` / `evaluateQuota` / `reserveQuota` / commit / release
- Metrics：MONTHLY_AI_COST、DAILY_AGENT_RUNS、DAILY_HIGH_RISK_TOOL_CALLS、DAILY_IMAGE_GENERATIONS、MAX_CONCURRENT_RUNS、SINGLE_RUN_ESTIMATED_COST
- Warning/Soft 允许并审计；Hard 阻止
- 乐观锁：`expectedVersion` → 409

## 执行入口接线

| 入口 | 检查 |
|---|---|
| createAgentRun | DAILY_AGENT_RUNS + MAX_CONCURRENT_RUNS + SINGLE_RUN_ESTIMATED_COST |
| ToolRegistry（l2+） | DAILY_HIGH_RISK_TOOL_CALLS |
| image-client | DAILY_IMAGE_GENERATIONS + MONTHLY_AI_COST（估） |
| createCompletionDetailed | MONTHLY_AI_COST 预检（传入 orgId/userId 时） |

失败不创建 RUNNING；无可信 orgId 不走企业配额执行路径。

## 成本汇总

`getGovernanceUsage`：AiUsageLedger + AgentRun 并发 + Reservation；按 WS/模型/Agent/Skill 展示；接近 warning/soft/hard 列表。

## Provider 状态

OpenAI：ACTIVE / NOT_CONFIGURED；Gemini/Qwen：NOT_IMPLEMENTED；Flux：NOT_CONFIGURED。不展示密钥。

## Audit

`writeCapabilityAuditEvent` 复用 AuditLog + `summarizePayload` 脱敏。  
治理审计页支持筛选；非 org_admin 仅本 WS。

## 页面与 API

- GET `/api/capabilities/governance`
- GET/POST `/api/capabilities/governance/quotas`
- PATCH `/api/capabilities/governance/quotas/{id}`
- GET `/api/capabilities/governance/usage`
- GET `/api/capabilities/governance/audit`

## 权限

- Org Admin：企业配额写 + 企业审计
- Workspace Admin：本 WS 收紧
- manager：只读用量
- 平台 admin 无 membership → 403 NO_MEMBERSHIP

## 测试

| 套件 | 结果 |
|---|---|
| phase3a4 governance logic | 13/13 |
| phase3a4 governance smoke | 28/28 |
| Phase 3A-1 | 41/41 |
| Phase 3A-2 logic | 26/26 |
| Ledger DB | 8/8 |
| Membership smoke | 18/18 |
| Phase 3A-3 | 34/34 |
| image-client | 28/28 |
| tsc --noEmit | 通过 |
| next build | 通过（修复 metric 重复字段后） |
| migrate status | up to date；`20260722201000_phase3a4_governance_quotas_audit` applied |

## 已知限制

- MONTHLY_AI_COST 预留为 conservative estimated；结算与实际 ledger 可能短暂双计 reserved，过期后释放
- 流式 chat（createChatStream）未强制注入 orgId 预检；依赖 Agent Run 门禁
- 治理写 UI 第一版以只读展示为主；创建/PATCH 走 API
- 未做正式账单/发票/多 Provider
- 降低 hard limit 不中断已 RUNNING 任务；新执行立即生效

## Phase 3A-5 建议

- Config Health 统一页
- 流式调用强制租户预检
- Soft limit 企业管理员通知渠道
- Reservation 与 ledger 精确结算（estimated→actual）
- Eval / Agent Builder（独立阶段）
