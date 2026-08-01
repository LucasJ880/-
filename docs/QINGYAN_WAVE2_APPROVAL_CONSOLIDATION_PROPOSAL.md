# Wave2 — Approval Consolidation 技术方案（仅设计）

**日期：** 2026-08-01  
**代码基准：** `main@bc132fd8e9306e6f9905facf17f6ab4c8a280e8b`  
**性质：** 设计提案 · **不构成 Wave2 批准** · 本阶段不写实现代码  

盘点执行者：只读分析（见会话内 explore 子代理结论）；未改 Schema / 未合实验树。

---

## 0. 一句话结论

main 上已有「可统一内核」：`PendingAction` + `ApprovalPort` + Capabilities 投影；但底层仍是 **≥5 套并行审批/状态机**，且存在多条**决策旁路**。Wave2 应优先统一**人类决策入口与状态映射**，再谈合表；**不要**从 `feature/agent-runtime-2-phase1` 恢复 Orchestrator/Bid Data 审批。

---

## 1. 当前模型盘点

### 1.1 有多少套动作/审批模型？

| # | 模型 | 事实存储 | 角色 |
|---|---|---|---|
| 1 | **PendingAction** | 表 `PendingAction` | 对话/Grader/营销草稿的主审批路径；类型含 email_draft / project_task / internal_note / sales.* / marketing.* |
| 2 | **ApprovalRequest + AgentTask** | `ApprovalRequest` / `AgentTask` / `AgentTaskStep` | 旧 Agent 步骤审批 |
| 3 | **Capabilities Approval 投影** | **无独立表**；ID = `SOURCE_TYPE:sourceId` | Read Model + 决策网关（部分路径） |
| 4 | **ProductContentApproval** | `ProductContentApproval` + `AgentApprovalSettings` | 产品内容域独立审批 |
| 5 | **运营域内嵌状态机** | `PublishJob`、Matrix Playbook、部分 Marketing 状态等 | 独立 approve/reject API，常不经 ApprovalPort |

**不存在** Prisma `AgentAction` / 独立 `EmailDraft` / `InternalNote` / `ProjectTask` 审批表。  
Email Draft、Internal Note、Project Task = **PendingAction 的 type + 执行副作用**，不是第三套审批实体。

### 1.2 状态重复或冲突

1. PA 的 `approved` = 执行中中间态，终态为 `executed|failed`；Capabilities 常把 PA.`approved` 映为统一 `APPROVED`，易与「已执行」混淆。  
2. Cancel：Capabilities cancel → PA 标 `failed`（非 `rejected`/`cancelled`）。  
3. 过期：PA → `failed`；Unified 展示 `EXPIRED`；AR 有 `escalated`。  
4. risk 枚举大小写/粒度不统一（agent vs capabilities vs tool）。  
5. `orgId` 可空历史 vs 投影 fail-closed：无 org 旧稿可能不进统一中心，但仍可能被 Web 确认。  
6. 注释漂移：`to-pending-action.ts` 仍有过时 orgId 描述。

### 1.3 可能绕过统一审批的执行入口

| 入口 | 是否经统一网关 | 风险 |
|---|---|---|
| `POST /api/ai/pending-actions/[id]` | 经 ApprovalPort，**绕过** Capabilities 完整性/幂等表 | 双通道决策 |
| 微信 `handleWeChatPendingReply` | 经 Port；org 过滤偏弱 | 双通道 + 租户 |
| Capabilities approve/reject/cancel/retry | 经 `decideCapabilityApproval` | 最严 |
| Product Content 直连 `decideApproval` | **旁路** Capabilities | 域旁路 |
| PublishJob / Matrix playbook approve | **完全独立** | 域旁路 |
| Tool 直写（如 admin stage / secretary_execute） | 不经 PendingAction | 免审/高权限 |
| proactive auto-actions（低风险） | 不经 PendingAction | 设计内免审，需登记 |

**正面证据：** `executePendingAction` 仅由 `ApprovalPort` 调用 —— **副作用执行已收敛**；问题在**决策入口**未收敛。

### 1.4 业务事实 vs UI/传输层

| 层 | 判定 |
|---|---|
| PendingAction / ApprovalRequest / ProductContentApproval / PublishJob… | **业务事实源** |
| ApprovalPort | **编排端口**（不另存事实） |
| Capabilities `ApprovalProjection` | **Read Model / 传输投影** |
| Assistant cards / pending-inbox / inline-approval-model | **UI 映射** |
| Email/Note/Task payload | **传输 + 执行参数**；落库目标为业务表 |

### 1.5 orgId / actor / approver / requestId / idempotency / audit

| 能力 | 程度 | 说明 |
|---|---|---|
| orgId | **部分** | PA 可空；AR 无 orgId（靠 project）；微信多按 createdById |
| actor / decidedBy | **有/部分** | PA 有 User FK；AR `decidedBy` 字符串 |
| approver | **部分** | PA `approverUserId`；AR 列表可见面可能过宽 |
| requestId | **无**（审批域） | 与 API withAuth 的 requestId 未统一进审批记录 |
| idempotency | **部分** | `ApprovalDecisionIdempotency`；PA 创建 `idempotencyKey`；Web 决策不强制 |
| audit | **部分** | executor/drafts/decision 有；AR/部分运营路径不齐 |
| retry/fail/cancel | **分裂** | 见状态冲突 |

### 1.6 Schema 已有相关 model（摘录）

`PendingAction`, `ApprovalDecisionIdempotency`, `ApprovalRequest`, `AgentTask`, `AgentTaskStep`, `ProductContentApproval`, `AgentApprovalSettings`, `AuditLog`, `AgentRun`/`AgentRunStep`（挂起关联）, `Task`, `MarketingPlan`/`MarketingCampaign`, `PublishJob`, Matrix playbook…

**main 无：** BidData 审批、Orchestrator approvals route。

---

## 2. 推荐的唯一领域模型（目标态）

**名称建议：** `ApprovalCase`（逻辑名；物理上可继续以 PendingAction 为主事实表，或后期引入薄统一表）。

**推荐过渡策略（优先不改 Schema）：**

1. **单一决策网关**：所有人类 approve/reject/cancel/retry → 一个服务（建议 Capabilities `decideCapabilityApproval`，或把其幂等/完整性下沉到 Port）。  
2. **统一状态机（对外）：**  
   `PENDING → APPROVED → EXECUTING → EXECUTED | EXECUTION_FAILED`  
   以及 `REJECTED | CANCELLED | EXPIRED`。  
   内部映射 PA/AR/PC，消灭「approved=已执行」歧义。  
3. **PendingAction 继续作为对话/Grader 类动作的事实源**；Email/Note/Task **保持为 type**，不新建平行审批表。  
4. **运营/PC 旁路**：先适配进投影与同一决策网关，再考虑是否共用物理表。  
5. **免审白名单**：Tool 直写 / proactive 必须显式登记，进入审计，不得默认可扩展。

### 是否需要新表 / Schema 变更？

| 阶段 | Schema |
|---|---|
| Wave2 前期 | **可不改表**：统一入口 + 状态映射 + 强制 org/idempotency |
| 中期（可选） | AR 增加可空 `orgId`；PA `orgId` 强制非空（需 migration + 回填） |
| 后期（可选） | 物理合表或 Event/Outbox — **仅在入口统一后评估** |

**任何 Schema/migration 必须单独批准；Wave1.5 禁止执行。**

---

## 3. 组织隔离 / 幂等 / 审计 / 多端

| 主题 | 方案要点 |
|---|---|
| 组织隔离 | 决策与列表强制 `orgId`；微信绑定 org 与稿件 org 一致；拒绝无 org 历史稿的确认（或只读迁移） |
| 幂等 | 所有决策通道强制 `idempotencyKey` → `ApprovalDecisionIdempotency`；终态短路 |
| actor/approver | 统一 User FK；记录 decidedAt/decidedBy |
| requestId | 决策时写入 audit metadata / 可选列；与 withAuth requestId 对齐（设计项，实施需批准） |
| 执行结果 | 统一记录 executed/failed + failureReason；禁止响应泄露 Secret |
| 微信 / Web / 未来手机 | **同一后端决策网关**；客户端只传 approvalId + decision + idempotencyKey |

---

## 4. 旧模型迁移与回滚

1. **并行期：** Capabilities 为唯一 UI 入口；旧 `/api/ai/pending-actions/[id]` 改为薄代理。  
2. **域旁路：** PC → 代理；PublishJob/Playbook → 投影 + 网关（可分 PR）。  
3. **AR 栈：** 保留至无流量后只读下线；新流量不新增 AR。  
4. **回滚：** 网关开关回退到 Port 直调；不回滚实验树；migration 回滚另案批准。  

---

## 5. 建议 PR 拆分（按真实代码调整）

| PR | 主题 | Schema？ | 说明 |
|---|---|---|---|
| Wave2-PR1 | 现状盘点固化 + 契约测试（双通道/旁路检测） | 否 | 锁定「单一网关」红线测试 |
| Wave2-PR2 | 统一状态机映射 + 适配层文档/代码 | 否 | 对齐 PA/Unified/AR 语义 |
| Wave2-PR3 | 统一审批 API（薄代理旧入口） | 否 | Web + 微信走同一 decide |
| Wave2-PR4 | 执行器/幂等/审计齐套 | 可能小改 | 强制 idempotency；补 audit |
| Wave2-PR5 | 微信/Web UI 统一到 Capabilities | 否 | 去双 UI 状态 |
| Wave2-PR6 | 域旁路收口（PC → Ops 分批） | 视域 | 可再拆子 PR |
| Wave2-PR7（可选） | 租户加固 migration（orgId） | **是** | 需单独批准 |
| Wave2-PR8（可选） | 旧 AR/旁路路径下线 | 否 | 流量为零后 |

原建议 Wave2-PR1…PR6 仍然成立；按代码现实**插入「租户加固」与「旁路分批」**，并强调 PR1 先做契约而非合表。

---

## 6. 风险与停止条件

**风险：** 双通道导致重复执行；cancel/failed 语义混乱；无 org 稿跨租户；运营旁路扩大。  

**停止条件（实施期）：**

- 需要未批准的生产 migration  
- 发现 fail-open 审批或匿名执行  
- 必须合入实验 Orchestrator/Bid Data 才能继续  
- 无法保持 org 隔离或幂等  

---

## 7. 明确声明

- Wave0 / Wave1：**完成**  
- Wave1.5：验收与方案准备  
- **Wave2：尚未批准**  
- 本文档**不授权**编码、Schema 变更、生产操作或实验树恢复  

待产品负责人下发明确 Wave2 指令后，从 **Wave2-PR1** 起开独立分支实施。  
