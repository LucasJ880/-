# Phase 3A-5：企业能力中台 V1 交付报告

**分支**：`feature/phase3a-5-capabilities-v1-finish`  
**基线**：PR #12 merge `82766aa`（Navigation IA）  
**范围**：仅六项收口；**不**开 Phase 3B；**不**改一级导航。

**合入状态**：MERGED via PR #13  
**Merge commit**：`19c1200ffd3af9199dbcb681afd710d3a1192200`  
**Phase 3A 状态**：见 `docs/PHASE3A_COMPLETE.md` — **COMPLETE**


### Commits（相对 main 共 4 个，均属 Phase 3A-5）

| SHA | Message | 说明 |
|---|---|---|
| `b395c35` | `docs(capabilities): add Phase 3A-5 V1 gap audit` | 差距审计（仅文档），属本阶段范围锁定 |
| `8075672` | `feat(capabilities): enforce streaming tenancy and settle AI usage costs` | 流式预检 + soft 通知 + 结算 |
| `5940449` | `feat(capabilities): complete capability catalog and configuration health` | Catalog + config-health |
| `eb2ca34` | `feat(capabilities): finish Phase 3A-5 capabilities V1 experience` | 总览收口 + 验收 + 交付文档 |
| `6428b1a` | `fix(capabilities): wire orgId into hub UI and close stream guard gaps` | 合入前验收修复：api-fetch orgId、chat 交叉校验、冒烟与截图 |

说明：相对 main 最终为 **5 个 Commit**（3 feat + gap audit 文档 + 验收 fix），全部属于 Phase 3A-5，无误带 merge/rebase。

---

## 1. 中台 V1 架构

```text
/capabilities                总览（overview API）
/capabilities/catalog        能力目录（Catalog Read Model）
/capabilities/runs           运行中心（复用 Trace）
/capabilities/approvals      审批中心（复用 Approval RM）
/capabilities/governance     治理与配额（复用 3A-4）
/capabilities/config-health  配置健康（扩展评估）
```

横切：

* `requireStreamTenant` — 流式调用租户预检  
* `beginStreamAiUsage` / `settleAiUsageReservation` — 预留 → 实际结算  
* `notifyQuotaThreshold` — Warning / Soft limit 去重通知  
* `AiUsageLedger` + Reservation — 成本账本  

导航：复用 PR #12 Registry，本阶段零改动一级结构。

---

## 2. 总览

* `GET /api/capabilities/overview`  
* `getCapabilitiesOverview(access)` 按 `TenantContext.orgId` 聚合  
* 指标：今日运行、成功率、待审批、本月成本、配额 level、配置健康  
* 「需要处理」：CRITICAL → INFO；可跳转  
* 最近运行：无输入输出正文  
* 能力状态入口 → Catalog；catalog 失败不伪造 0  
* 加载失败展示错误，不展示伪造 0  

---

## 3. 能力目录

* `GET /api/capabilities/catalog`  
* 类型：AGENT / SKILL / TOOL / WORKFLOW / KNOWLEDGE_BASE / INDUSTRY_PACK / PROMPT_TEMPLATE  
* 来源层级：PLATFORM / ORGANIZATION / WORKSPACE / PROJECT  
* 状态：ACTIVE / DISABLED / MISSING_CONFIG / INCOMPATIBLE / DEPRECATED / ERROR  
* 复用 scoped config + `resolveIndustryPack`（无静默家纺回退）  
* 只读，无 Agent Builder  

---

## 4. 配置健康

* `GET /api/capabilities/config-health`  
* `assessConfigHealth` 扩展：企业基础 / Workspace / Agent / Provider·成本 / 数据债  
* 统一 status + severity；不展示密钥；不自动高风险修复  
* 无法读取 → unknown/WARNING/ERROR，不伪造 HEALTHY  

---

## 5. Streaming Tenant Guard

* 入口：`/api/ai/chat`、`threads/.../messages`  
* 流开始前：`requireStreamTenant` + membership + orgId  
* body.orgId 仅交叉校验，不可作信任源  
* Platform Admin 无 membership → `NO_MEMBERSHIP`  
* session / rate-limit key 含 orgId  
* 失败码：`NO_MEMBERSHIP` / `TENANT_CONTEXT_REQUIRED` / `WORKSPACE_ACCESS_DENIED` / `ORG_CONTEXT_MISMATCH` / `QUOTA_HARD_LIMIT`  

---

## 6. Soft Limit

* Warning / Soft：执行继续 + 用户提示 + AuditLog + 站内通知  
* Hard：保持阻止  
* 去重键：`orgId + workspaceId? + metric + periodStart + level`  

---

## 7. 成本结算

* `settleAiUsageReservation({ reservationId, idempotencyKey, actualCost, ledgerId, status })`  
* estimated → actual；差额释放；超额入账；失败有费结算 / 无费释放  
* SSE cancel/finally 路径结算；idempotency 防重  

---

## 8. 页面

| 路径 | 说明 |
|---|---|
| `/capabilities` | 总览收口 |
| `/capabilities/catalog` | 筛选列表 |
| `/capabilities/runs[+id]` | 运行 / Trace |
| `/capabilities/approvals[+id]` | 审批 |
| `/capabilities/governance*` | 治理 |
| `/capabilities/config-health` | 健康问题 |

统一：`capabilities/layout.tsx`（`max-w-6xl`）、PageHeader、空/错/加载态。

---

## 9. API

| Method | Path |
|---|---|
| GET | `/api/capabilities/overview` |
| GET | `/api/capabilities/catalog` |
| GET | `/api/capabilities/config-health` |
| （既有） | runs / approvals / governance / usage |

---

## 10. Schema / Migration

* **无破坏性 schema 变更**；复用 3A-4 Reservation / AiUsageLedger / AuditLog / Notification  
* 结算状态扩展在应用层（SETTLED / RELEASED / SETTLEMENT_FAILED 等）  

---

## 11. Sunny 验收

* 组织名来自 Organization，不写死  
* Pack：`window_covering_services_v1`（或当前 seed）  
* 总览 / Catalog / Health / Governance 均按 Sunny orgId  

---

## 12. 梦馨验收

* Pack：`home_textile_trade_v1`（或当前 seed）  
* 与 Sunny 数据、能力、审批、费用独立  

---

## 13. 跨租户验收

* 测试：`phase3a5-overview-acceptance.test.ts`  
* Catalog / Health / Overview orgId 隔离  
* stream session key 含 orgId  
* 回归：3A-1～4 + Navigation IA（`scripts/test-all.sh`）  

---

## 14. 测试

| 套件 | 覆盖 | 合入前实测 |
|---|---|---|
| `phase3a5-stream-settle.test.ts` | 预检码、session key、结算逻辑 | ✅ 10/10 |
| `phase3a5-settle-db.test.ts` | DB 结算 / idempotency | ✅ 8/8 |
| `phase3a5-catalog-health.test.ts` | Pack 不回退、状态枚举 | ✅ 7/7 |
| `phase3a5-overview-acceptance.test.ts` | 总览 + 双租户 | ✅ 23/23 |
| `scripts/phase3a5-capabilities-acceptance-smoke.mjs` | 六页 API/UI + 流式 | ✅ 49/49 |
| `scripts/phase3a5-stream-ledger-verify.ts` | ledger/reservation/去重 | ✅ 10/10 |
| `./scripts/test-all.sh` | 全量 | ⚠️ 99/102（见下） |

**test-all 未通过项（如实记录，非本 PR 引入的阻断项）：**

1. **Image Engine FormData 传图证明** — 既有基线（`metadata 不含 URL`）  
2. **AI 工作事项分类** — 外部 API `401 Unauthorized`（环境密钥，非中台回归）  
3. **Agent Trace 只读查询** — 测试用假 `orgId` 触发 `CapabilityQuotaReservation` FK（与 3A-4 预留挂接交互；非导航/中台页面回归）

Phase 3A-1～4、Navigation IA、3A-5 专项均在 test-all 中通过。

截图：`docs/phase3a5-screenshots/`（Sunny / 梦馨 × 1440 / 1280 / 390）。

---

## 15. tsc

`npx tsc --noEmit` ✅ 通过（合入前）。

---

## 16. build

`npx next build` ✅ 通过（合入前）。

---

## 17. 已知限制

1. Workflow / Prompt Template 多为 `MISSING_CONFIG` 占位投影  
2. Soft limit 仅站内通知，无邮件/Webhook；本环境 Sunny 配额已 `HARD_LIMIT`，live soft 通知以单测覆盖为主  
3. `createCompletionDetailed` 非流式路径 orgId 仍可选（流式已强制）  
4. Agent 工具循环内结算完整度弱于 direct chat  
5. Workspace members CRUD、Agent Builder、Eval、正式账单 → Phase 3B/3C  
6. 未删除旧成本表  
7. 验收修复：`api-fetch` 将 `/api/capabilities` 纳入 org-scoped，避免多组织 UI 漏带 orgId  

### 合入前验收摘录（nav-qa）

| 项 | Sunny | 梦馨 |
|---|---|---|
| Industry Pack | `window_covering_services_v1` | `home_textile_trade_v1` |
| 本月成本 | ~USD 3.41 | ~USD 0.05（流式后） |
| 配额 | HARD_LIMIT（流式前拦截） | OK（流式成功） |
| 配置健康 overall | MISSING | MISSING |
| body.orgId 错配 | `ORG_CONTEXT_MISMATCH` | — |
| Workspace 假 id | `WORKSPACE_ACCESS_DENIED` | — |

---

## 18. 回滚方案

1. Revert Phase 3A-5 PR 三个 feat commit（或整 PR）  
2. 无强制 migration 回滚  
3. 流式入口回退后行为恢复为 3A-4（依赖 AgentRun 门禁）  
4. 导航不受影响（本阶段未改 Registry）  

---

## 19. Phase 3B 建议（不自动开始）

* Workspace members CRUD + 更细 RBAC UI  
* Agent Builder / Skill 写路径  
* 非流式 completion 全面强制 orgId  
* Soft limit 邮件 / PendingAction 运营闭环  
* Eval Center、多 Provider、正式账单  
* Catalog 写入与版本发布流  

---

## 完成标准核对

| # | 标准 | 状态 |
|---|---|---|
| 1 | 中台独立一级区域 | ✅（Nav IA 已合入，本阶段不改） |
| 2 | 总览回答运行/风险/审批/费用/配置 | ✅ |
| 3 | 可查看 Agent/Skill/Tool/Workflow | ✅ Catalog |
| 4 | AI 调用可信 tenant | ✅ 流式强制 |
| 5 | 流式不可绕过 membership/quota | ✅ |
| 6 | 预估→实际结算 | ✅ |
| 7 | Soft 通知不误阻断 | ✅ |
| 8 | Sunny/梦馨完全隔离 | ✅ 验收测试 |
| 9 | 平台管理员无 membership 不可进中台/流 | ✅ |
| 10 | 3A-1～4 无回归 | ✅ 走 test-all |
| 11 | 导航不再修改 | ✅ |
| 12 | 可进真实企业试运行 | ✅ V1 收口 |
