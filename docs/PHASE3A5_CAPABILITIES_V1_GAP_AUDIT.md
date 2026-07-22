# Phase 3A-5：企业能力中台 V1 — 差距审计

**分支**：`feature/phase3a-5-capabilities-v1-finish`  
**基线**：PR #12 merge commit `82766aa`（Navigation IA 已合入）  
**审计日期**：2026-07-22  
**目的**：锁定本阶段六项范围，防止无限扩张。

---

## 范围锁定（只做六项）

| # | 项 | 本阶段 |
|---|---|---|
| 1 | 中台总览完善 | ✅ |
| 2 | 能力目录 | ✅ |
| 3 | 配置健康扩展 | ✅ |
| 4 | 流式 AI 调用 orgId 强制预检 | ✅ |
| 5 | Soft limit 通知 + estimated → actual 结算 | ✅ |
| 6 | 中台 V1 双租户整体验收 | ✅ |

**明确不做**：Agent Builder、Eval Center、Playbook、新 Agent、新业务模块、多 Provider 正式接入、正式账单与收费、重新设计导航、重写 Runtime/Supervisor、删除旧成本表、重写审批体系。

**导航约束**：一级导航已由 PR #12 锁定，本阶段**零改动** `NAVIGATION_REGISTRY` 一级结构。

---

## 既有系统盘点（3A-1～3A-4 + Nav）

| 系统 | 状态 | 关键路径 | 本阶段态度 |
|---|---|---|---|
| Trace Read Model | 已完成 | `src/lib/capabilities/{execution-query,trace-context,adapters}` | 复用 |
| AiUsageLedger | 已完成（多为 estimated） | `usage/record.ts`、`ai/usage-ledger-bridge.ts` | 扩展结算 |
| Approval Read Model | 已完成 | `approvals/*` + `/api/capabilities/approvals*` | 复用 |
| Workspace RBAC | 部分完成 | `tenancy/workspace-rbac.ts`；无 members CRUD | 复用；CRUD 留 3B |
| Quota Policy / Reservation | 已完成 | `governance/{policy,evaluate,reserve,precheck}` | 扩展 settle + 通知 |
| AuditLog | 已完成 | `audit/logger` + `writeCapabilityAuditEvent` | 复用 |
| Navigation Registry | 已完成 | `src/lib/navigation/*` | **不重做** |
| Config-health（经营中心） | 部分完成 | `org-rules/service` + `/api/operations/config-health` | 扩展到中台 API |
| Soft/Hard/Warning 评估 | 已完成（无通知） | `evaluateQuota` | 补通知去重 |
| Reservation 结算 | 部分完成 | `commitReservation(actualAmount?)` | 补 ledger 对齐 |

---

## 六项差距明细

### 1. 中台总览 `/capabilities`

| 维度 | 判定 |
|---|---|
| 状态 | **部分完成** |
| 已有 | 页面骨架；拼装 runs / approvals / usage.summary；membership 403；导航入口 |
| 缺失 | 专用 `GET /api/capabilities/overview`；今日运行/成功率真实聚合；配额与配置健康摘要；严重度排序的「需要处理」；能力状态计数；空态/失败不伪造 0 |
| 本阶段修复 | overview API + 页面收口（高价值指标 + 需要处理 + 最近运行 + 能力状态入口） |
| 留到 3B/3C | 物化宽表、图表、经营 Dashboard 合并 |

**关键文件**：`src/app/(main)/capabilities/page.tsx`

---

### 2. 能力目录 `/capabilities/catalog`

| 维度 | 判定 |
|---|---|
| 状态 | **缺失**（导航占位） |
| 已有 | 空壳页 + 链到 settings；可复用 Skills/Tools/Pack/KB 源 |
| 缺失 | Capability Catalog Read Model；API；筛选；状态枚举；双租户隔离 |
| 本阶段修复 | 只读 Catalog（AGENT/SKILL/TOOL/WORKFLOW/KNOWLEDGE_BASE/INDUSTRY_PACK/PROMPT_TEMPLATE）；复用 scoped config；无静默 Industry Pack 回退 |
| 留到 3B/3C | 拖拽 Builder、写路径、完整 Workflow 统一表 |

**关键文件**：`src/app/(main)/capabilities/catalog/page.tsx`（占位）

---

### 3. 配置健康 `/capabilities/config-health`

| 维度 | 判定 |
|---|---|
| 状态 | **缺失**（中台占位；经营中心有部分检查） |
| 已有 | `listOrgConfigIssues`（Pack / 折扣 / 部分 Business Rules）；治理投影 `providerStatus`；`/capabilities/health` → redirect |
| 缺失 | 中台 API；Glossary/Brand/Skill/Provider/配额/reservation 检查；统一 severity/status；不伪造 HEALTHY |
| 本阶段修复 | `GET /api/capabilities/config-health`（扩展而非重建）；中台页消费；Sunny/梦馨独立 |
| 留到 3B/3C | 自动修复、凭证轮换 UI、多 Provider 热切换 |

**关键文件**：`config-health/page.tsx`（占位）、`src/lib/org-rules/service.ts`、`/api/operations/config-health`

---

### 4. 流式 AI orgId 强制预检

| 维度 | 判定 |
|---|---|
| 状态 | **缺失** |
| 已有 | `createCompletionDetailed` 可选 `precheckMonthlyAiCost`；AgentRun `reserveQuota`；threads 路由可解析 org |
| 缺失 | `createChatStream` 无 orgId；`/api/ai/chat` 无 TenantContext；流前 membership/workspace/hard limit；stream session key 含 orgId；断开后结算 |
| 本阶段修复 | 所有 SSE 入口强制租户预检；统一失败码；禁止 body.orgId 信任；Platform Admin 无 membership 拒绝 |
| 留到 3B/3C | Runtime/Supervisor 重写；多 Provider 流式抽象 |

**流式入口清单（本阶段必须封堵）**：

| 入口 | 路径 |
|---|---|
| SSE A | `POST /api/ai/chat` |
| SSE B | `POST /api/ai/threads/[threadId]/messages` |
| 核心 | `createChatStream`（`src/lib/ai/client.ts`） |
| Agent 流 | `runAgentStream`（由 threads 调用） |
| 前端 | `inbox/page.tsx`、`assistant/page.tsx`、`project-ai-chat.tsx` |

**已知债引用**：`docs/PHASE3A4_*_DELIVERY.md` — 流式 chat 未强制注入 orgId 预检。

---

### 5. Soft limit 通知 + estimated → actual 结算

| 维度 | 判定 |
|---|---|
| 状态 | **部分完成** |
| 已有 | WARNING/SOFT_LIMIT/HARD_LIMIT 评估与审计；`reserveQuota` / `commitReservation` / `releaseReservation`；ledger 幂等写入（多为 ESTIMATED） |
| 缺失 | Soft/Warn 用户与管理员通知（去重）；`settleAiUsageReservation`；流式/completion exact 结算；SSE 断开结算；长时间未结算标记 |
| 本阶段修复 | 通知去重键 `orgId+workspaceId?+metric+periodStart+level`；统一 settle 服务；失败有/无费用分支；不改 hard limit 语义；不删除旧 Reservation |
| 留到 3B/3C | Email/Webhook、正式 Invoice、历史费用重算（禁止） |

**Reservation 状态扩展建议**（在现有 RESERVED/COMMITTED/RELEASED/EXPIRED 上兼容）：

```text
ESTIMATED → RESERVED → SETTLED | RELEASED | SETTLEMENT_FAILED
```

（实现时保持 DB 兼容：SETTLED ≡ COMMITTED + ledger 对齐；或新增 status 值并迁移测试。）

---

### 6. 双租户整体验收

| 维度 | 判定 |
|---|---|
| 状态 | **部分完成** |
| 已有 | Sunny/梦馨种子；3A-1～4 隔离测试；Navigation IA 冒烟与截图 |
| 缺失 | 3A-5 功能验收矩阵（overview/catalog/health/stream/soft/settle）；交付文档；统一回归脚本挂载 |
| 本阶段修复 | 双租户验收测试 + `PHASE3A5_CAPABILITIES_V1_DELIVERY.md`；回归 3A-1～4 + Nav IA |
| 留到 3B/3C | Workspace 成员 CRUD UI；全平台 E2E 套件 |

---

## 提交顺序（锁定）

### Commit 1 — 运行安全与成本结算

```text
feat(capabilities): enforce streaming tenancy and settle AI usage costs
```

- streaming orgId preflight  
- soft limit notification（去重）  
- estimated → actual settlement  
- 专项测试  

### Commit 2 — 能力目录与配置健康

```text
feat(capabilities): complete capability catalog and configuration health
```

- Catalog Read Model + API + 页面  
- config-health 扩展 + 中台页  
- 专项测试  

### Commit 3 — 中台总览与 V1 收口

```text
feat(capabilities): finish Phase 3A-5 capabilities V1 experience
```

- `/capabilities` 总览完善  
- 页面一致性  
- 双租户验收 + 交付文档  
- 回归  

---

## 风险与依赖

1. **流式结算**：SSE 断开时必须在 `finally`/abort handler 完成 settle；依赖 `stream_options.include_usage`。  
2. **双计风险**：3A-4 已知 reserved 可能短暂双计 — settle 必须在主路径消除。  
3. **Catalog 数据源异构**：Skill/Tool/Pack 来源不同，第一版只读聚合，不建第二套继承。  
4. **导航冻结**：任何 PR  diff 不得改一级 IA 顺序与分组。  

---

## 完成标准对照（预检）

| # | 标准 | 审计结论 |
|---|---|---|
| 1 | 中台独立一级入口 | ✅ 已由 PR #12 完成 |
| 2 | 总览可回答运行/风险/审批/费用/配置 | ❌ 本阶段补齐 |
| 3 | 可查看 Agent/Skill/Tool/Workflow | ❌ 本阶段 Catalog |
| 4 | AI 调用可信 tenant context | ❌ 流式缺口 |
| 5 | 流式不能绕过 membership/quota | ❌ 本阶段封堵 |
| 6 | 成本预估正确结算为实际 | ❌ 本阶段 settle |
| 7 | Soft limit 通知但不误阻断 | ⚠ 评估有、通知无 |
| 8 | Sunny/梦馨完全隔离 | ⚠ 底层有、3A-5 页未验 |
| 9 | Platform Admin 无 membership 禁入 | ✅ Nav/API 基线有；流式再验 |
| 10 | 3A-1～4 无回归 | 回归挂载 |
| 11 | 导航不再被修改 | 约束 |
| 12 | 可进真实企业试运行 | Commit 3 后确认 |

---

*本文件为 Phase 3A-5 范围闸门。后续实现不得超出「六项」清单。*
