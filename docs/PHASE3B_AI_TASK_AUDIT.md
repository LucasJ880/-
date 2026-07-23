# Phase 3B-A：移动端 AI 工作入口与任务执行闭环 — 架构自检

**状态**：Commit 2–6 已实施（含 Run 确认收敛与安全重试）；Draft PR #17 未合入 main  
**分支**：`feature/phase-3b-ai-task-loop`  
**基线**：

| 阶段 | Merge SHA |
|---|---|
| Security-1 | `55f109a183c742589a0d244c8267fd45e78f2fae` |
| Mobile-1 | `aa81c08abddfb4277272eb50afde7753b881bf91` |
| Mobile-2 | `84553eca8e4137f20e36fea14b91bbb9b3648382` |
| main tip（建分支时） | `6fccc96`（含 Mobile-2 COMPLETE） |

**原则**：复用现有基础设施；**不新建**第二套 Run / PendingAction / Message / Gmail Executor / SalesTask；**必须**做 `AiThread.orgId` 最小安全迁移。

---

## 0A. 【实施结果】Commit 2 — AiThread 组织绑定（2026-07-23）

| 项 | 结果 |
|---|---|
| 迁移 | `prisma/migrations/20260723120000_phase3b_bind_ai_threads_to_org` |
| Prisma | `validate` ✅ / `generate` ✅ / `migrate deploy` ✅（共享 Neon，无 reset） |
| 回填脚本 | `scripts/phase3b-backfill-ai-thread-org.ts`（默认 dry-run；`--apply` 写入） |
| 报告 | `docs/phase3b-ai-thread-org-backfill.json` |

### 回填计数（apply）

| 指标 | 数量 |
|---|---|
| totalThreads | 24 |
| boundByProject | 4 |
| boundByPendingAction | 1 |
| boundByAgentRun | 0 |
| boundByUniqueMembership | 5 |
| conflicted | 0 |
| unresolved（`MULTIPLE_ACTIVE_MEMBERSHIPS`） | 14 → `orgId=null` + `archived=true` |
| errors | 0 |

### 迁移验收

| 指标 | 数量 |
|---|---|
| AiThread 总数（Commit2 apply 时） | 24 |
| orgId 非空 | 10 → **14**（二次 apply 后） |
| orgId 为空且 archived | 14 → **19** |
| orgId 为空且未 archived | **0** ✅ |
| 跨 org 项目异常 | 0 |

说明：Commit2 推送后、Preview 部署前，cron 又创建了 9 条「每日简报」无 org 线程；已按同一安全规则二次回填（4 条唯一 membership 绑定，5 条多 membership 归档）。最新验收：`null 未 archived = 0`。

### API 覆盖

| 路径 | 行为 |
|---|---|
| `GET/POST /api/ai/threads` | 按 activeOrg 列表；创建强制写 `orgId`；body.orgId 仅交叉校验 |
| `GET/PATCH/DELETE /api/ai/threads/[id]` | `userId+orgId+!archived`；跨 org → `404 THREAD_NOT_FOUND` |
| `GET/POST .../messages` | 同上；PendingAction 附带要求 `orgId=activeOrg` |
| `GET /api/ai/pending-actions` | 限制当前 org；threadId 跨 org → 空列表 |
| `POST /api/ai/pending-actions/[id]` | activeOrg ≠ action.orgId → 403；executor 保留列/metadata 二次鉴权 |
| `api-fetch` | `/api/ai/threads`、`/api/ai/pending-actions` 加入 ORG_SCOPED |

### 测试

- `src/lib/assistant/__tests__/thread-org-policy.test.ts`（回填优先级 / 跨 org PA / 列表契约）
- Security-1 既有单测保持在 `test-all.sh`

### 已知可接受历史 / 技术债

14 条多 membership 历史线程（`MULTIPLE_ACTIVE_MEMBERSHIPS`）**未猜测归属**，保持：

```text
orgId = null
archived = true
消息保留
```

**技术债**：这些线程只有在管理员人工确认组织归属后，才能通过单独的安全脚本写入 `orgId` 并恢复；**普通用户 API 不得自行认领**。本阶段不开发管理员恢复界面。

### Commit 2A（组织解析与归档管理）

| 修正 | 说明 |
|---|---|
| `resolveTrustedAssistantOrg` | 仅信任服务端 `activeOrgId`（或唯一 membership）；`query`/`body` 只交叉校验 |
| `findOwnedThreadInOrg({ includeArchived })` | PATCH/DELETE 可管理归档；消息/详情/发送仍排除归档 |
| orgId=null 历史线程 | 仍不可经普通 API 取消归档 |

### Commit 3（统一 Dispatch + Run 七态）

| 项 | 说明 |
|---|---|
| `dispatchAssistantMessage` / `prepareAssistantDispatch` | `src/lib/assistant/dispatch.ts` |
| 意图路由 stub | `src/lib/assistant/intent-router.ts`（场景占位，完整编排后续） |
| 七态 DTO | `src/lib/assistant/run-status.ts` |
| 接线 | `POST .../messages` 先分流；`general_answer` 仍走既有 SSE |
| 前端 | 废除 Supervisor→SSE 业务双路由；单入口 messages |
| Run 恢复 | `GET .../threads/[threadId]/runs`（`metadata.threadId`） |
| 关联约定 | `AgentRun.sessionId=AgentSession(web_assistant)`；`metadata.threadId=AiThread.id` |

### Commit 3A（Dispatch 硬化）

| 修正 | 说明 |
|---|---|
| Rate limit 前置 | `checkRateLimitAsync(AI_THREAD_RATE_LIMIT)` 在 `prepareAssistantDispatch` 之前；429 不写库 |
| Run 归属 | `metadata.initiatedByUserId` + `AgentSession.userId`；恢复查询强制当前用户 |
| 邮件发送意图 | 「发送/发出/回复客户」→ `gmail_email_draft` + `requestedDirectExecution` |
| SSE 协议 | `run_status` 仅含一致 `run` DTO；`transition === run.status` |
| 跟进文案 | 去掉「和/或」；明确两项则两张独立确认卡 |

### Commit 4（移动端七态任务卡）

| 项 | 说明 |
|---|---|
| `AssistantTaskCard` | `src/components/assistant/assistant-task-card.tsx` |
| 客户端类型 | `src/lib/assistant/run-status-types.ts`（无 DB） |
| SSE | `page.tsx` 消费 `run_status` → `event.run` |
| 刷新恢复 | 线程加载并行 `GET .../runs`，挂到最近 assistant 消息（Commit 5 前为错挂：`runs[0]`→最后一条） |
| 操作区 | 重试骨架 `min-h-11` + safe-area；ApprovalCard 确认/取消升至 44px |
| 不做 | 三场景真实 Executor / 真实重试 API |

### Commit 5（三场景真实编排 + Run/消息精确关联）

| 项 | 说明 |
|---|---|
| 场景模块 | `src/lib/assistant/scenarios/{daily-brief,customer-followup,gmail-draft,entity-parse,types}.ts` |
| Dispatch | 真实生命周期 `received→planning→running→completed/waiting/failed`；澄清优先不建 Run |
| Run DTO | `userMessageId` / `assistantMessageId` / `pendingActionIds`（无新列） |
| 刷新恢复 | `attachRunsToAssistantMessages`：按 `metadata.assistantMessageId` 挂卡 |
| 简报 | `runDailyBusinessBriefGrader` 只读；不自动建 PA；trade 无销售权限不泄露 |
| 跟进 | `calendar.create_event`（仅本人）/ `sales.update_followup` / 双独立 PA |
| Gmail | `grader.email_draft`；发送话术仍只建草稿；确认前不调 `createGmailDraft` |
| 测试 | `scenario-message-link` / `daily-brief` / `customer-followup` / `gmail-draft` 单测 |
| 不做 | Executor 重写；Commit 6 的 PA 执行后 Run 收敛 / 恢复重试 |

### Commit 5A（场景解析与 Prepare 一致性）

| 项 | 说明 |
|---|---|
| Gmail 正文 | 仅用户明确事实；禁止「青砚助手/原文」等内部说明；无目的则澄清 |
| 实体解析 | 支持「把 ABC 商机…」「给 Rudy 起草一封邮件」等前置名 |
| 双 PA | `createDraftBatch` 事务创建 + 失败补偿；不留孤立 pending |
| 错误码 | `metadata.scenarioErrorCode` → DTO.errorCode（优先于 tool_failed） |

### Commit 6（确认执行后 Run 收敛）

| 项 | 说明 |
|---|---|
| 收敛服务 | `reconcileAssistantRunFromPendingActions`（`FOR UPDATE`） |
| 接入点 | `approval/port.ts` approve/reject 后；API 返回 `{ run }` |
| DTO | `actionSummary` / `partialCompletion` / `partialSideEffects` / `canRetry` / `retryKind` |
| 安全重试 | `POST .../runs/[runId]/retry`；仅无 PA + `safeToRetry` |
| 前端 | ApprovalCard → onRunUpdate；TaskCard 仅 `canRetry` 显示重试 |
| 交付文档 | `docs/PHASE3B_AI_TASK_DELIVERY.md` |

### Commit 6A（Retry / Reconcile 全幂等）

| 项 | 说明 |
|---|---|
| Retry 占位 | `RESERVED→STARTED→COMPLETED\|FAILED`，键 `assistant-run-retry:{oldRunId}:{attempt}` |
| 确定 runId | `createAssistantScenarioBinding` + `startAssistantScenario({ binding })`；禁 `runs[0]` |
| Reconcile 事件 | 锁内 `tx.agentRunEvent.create`；`writtenEventKeys` / `lastReconcileEventWritten` |
| Action 事件键 | `approval-action:{actionId}:{outcome}` |
| 跨 org | `ORG_LINK_MISMATCH` fail closed + 审计 |
| 发起人 | session 恢复；未知 → `INITIATOR_UNKNOWN`，不伪造 `"unknown"` |

**关联约定**：

```text
用户消息 → AiMessage(user)
初始 Assistant → AiMessage(assistant)（先占位再更新同一条）
AgentRun.userMessageId → 用户消息
AgentRun.metadata.assistantMessageId → Assistant 消息
PendingAction.messageId / agentRunId → 同上
```

---

## 0. 一句话结论

青砚已具备「聊天持久化 + SSE 流式 + Operator 多工具 + PendingAction 确认执行 + AgentRun 可恢复任务 + Grader 只读分析」整套底座。Phase 3B-A **不需要**新建聊天架构或第二套 Executor。

已批准并锁定的三项修正：

1. **`AiThread.orgId` 最小迁移**（新线程强制非空；历史安全回填；API 按 org 过滤）  
2. **统一服务端 `dispatchAssistantMessage`**（废除前端 Supervisor→SSE 业务双路由）  
3. **客户跟进动作语义确定规则**（日历提醒 vs 商机跟进 vs 双 PendingAction；项目任务仅显式 project）

其余缺口：窄意图路由、Run 七态卡片、三场景编排与恢复重试。

---

## 1. 当前聊天架构

### 1.1 两套会话模型（必须分清）

| 模型 | 用途 | 组织绑定 | 是否助手主路径 |
|---|---|---|---|
| `AiThread` / `AiMessage` | Web/Mobile「青砚助手」对话 | **已加 `orgId`（Commit 2；历史可空已回填/归档）** | **是** |
| `Conversation` / `Message` | 项目/环境级 Agent 实验室会话（强绑 `projectId` + `environmentId`） | 经 Project | **否**（3B-A 不扩展此表） |

证据：`prisma/schema.prisma`（`AiThread` ≈ L1799；`Conversation` ≈ L1080）；助手页面 `src/app/(main)/assistant/page.tsx` 调用 `/api/ai/threads*`。

### 1.2 持久化与刷新恢复

| 问题 | 结论 |
|---|---|
| Conversation 是否持久化 | **AiThread 持久化**（非 Conversation） |
| Message 是否持久化 | **AiMessage 持久化**（user 消息在流开始前写入；assistant 在流结束后写入） |
| 是否支持流式 | **是**：`text/event-stream`（`createChatStream` + Operator `runAgentStream`） |
| 刷新后是否恢复 | **消息与 PendingAction 可恢复**（GET messages 附带 pendingActions）；**进行中的内存流状态会丢**，除非已落到 `AgentRun` / 后台研究 Run |
| 退出页面后任务是否继续 | **仅部分路径**：市场研究 `queueMarketResearchRequest` + `after()` 后台执行；`AgentRun` 有 `attempts` / `leaseExpiresAt` / `nextAttemptAt` 可重认领；普通 SSE 对话随请求取消而停 |
| 一请求多工具 | **是**（Operator：`runAgentStream` + `needsTools`；前端解析 `tool_start` / `tool_result`） |

关键文件：

- `src/app/api/ai/threads/[threadId]/messages/route.ts` — 主写入口  
- `src/app/api/ai/chat/route.ts` — 无线程 SSE（治理预检）  
- `src/lib/ai/client.ts` — `createChatStream`  
- `src/lib/agent-core` — `runAgentStream` / tools  
- `src/app/(main)/assistant/page.tsx` — 前端消费 SSE；优先尝试 `/api/agent-supervisor/runs`

### 1.3 前端双路径（现状问题 → 已锁定废除）

**现状**：助手发送时先打 `POST /api/agent-supervisor/runs`；403 才回落线程 SSE。  
**锁定**：业务路由**不得**由前端双请求决定。统一进入服务端 `dispatchAssistantMessage`（见 §14）；Supervisor / Operator / SSE 仅作后端 fallback 实现细节。

---

## 1A. 【锁定】批准的复用边界

| 能力 | 决策 |
|---|---|
| `AiThread` / `AiMessage` | 继续作为 Web/Mobile 助手会话载体（**加 orgId**） |
| `AgentRun` / `AgentRunEvent` | 任务运行、恢复、步骤展示来源 |
| `PendingAction` | 所有写动作 Prepare / Confirm / Execute |
| `CapabilityRun` | 只读投影，**不建表** |
| `ApprovalDecisionIdempotency` | 防重复确认 |
| Graders | 只读分析 + 建议动作 |
| `createGmailDraft()` | Gmail 草稿**唯一** Executor |
| `AuditLog` | Prepare / 确认 / 执行结果 |

**禁止新增**：第二套 Run、第二套 PendingAction、第二套 Message、第二套 Gmail Executor、`SalesTask` 表、WebSocket 大重构、数字员工独立 Principal。

---

## 2. 当前执行架构

### 2.1 CapabilityRun：**不是独立表**

`CapabilityRun` 是 Phase 3A **只读投影**，聚合：

- `AgentRun`（`adapters/agent-run.ts`）  
- `PendingAction`（`adapters/pending-action.ts`）  
- `SkillExecution`  
- `ToolCallTrace`  

列表/详情：`src/lib/capabilities/runs/{list,detail}.ts`，API `/api/capabilities/runs*`。

**结论**：不要新建 `CapabilityRun` 表；任务运行状态优先用 **`AgentRun` + `AgentRunEvent`**，审批动作用 **`PendingAction`**，能力中心继续读投影。

### 2.2 AgentRun（最接近「任务 Run」）

字段（节选）：`orgId`, `sessionId`, `status`（queued/running/waiting_for_approval/completed/failed/cancelled…）, `intent`, `traceId`, `errorCode`, `errorMessage`, `supervisorState`, `attempts`, `leaseExpiresAt`, `nextAttemptAt`, `latencyMs`, `metadata`。

事件：`AgentRunEvent`（`sequence`, `eventType`, `title`, `visibleToUser`）— **已具备步骤展示底座**。

| 能力 | 现状 |
|---|---|
| 代表任务运行 | **是**（微信 Runtime / Supervisor / 后台研究） |
| 重复执行保护 | PendingAction 有 status 闸门 + `ApprovalDecisionIdempotency`；AgentRun 靠状态机/租约（需按场景加固） |
| 重试 | AgentRun 有 `nextAttemptAt` / `attempts`；审批有 `/retry` |
| 取消 | AgentRun `cancelledAt`；Supervisor POST cancel；PendingAction reject |
| 错误记录 | `errorCode` / `errorMessage` / PendingAction.`failureReason` |

### 2.3 PendingAction（待确认动作）

状态（代码/注释）：`pending → approved → executed | failed`，另有 `rejected`；过期时 executor 标 `failed`（文案「已过期」）。  
**尚无一等公民 `expired` / `executing` / `cancelled` 枚举**（capabilities 映射里有 expired→TIMED_OUT，表状态未必写入 `expired`）。

已有字段：`orgId`, `createdById`, `approverUserId`, `expiresAt`, `decidedAt`, `executedAt`, `failureReason`, `resultRef`, `payloadHash`, `threadId`, `messageId`, `agentRunId`, `workspaceId` 等。  
**无** `createdByPrincipalId` 命名；当前用 **User id**。Principal-compatible 授权在 authorize 层，3B-A 可继续用 userId，不强制改列名。

创建：`createDraft()`（`lib/pending-actions/drafts.ts`）+ AuditLog `APPROVAL_CREATED`。  
执行：`executePendingAction()`（二次权限 / 过期 / 非 pending|approved 拒绝 / 先标 approved 防并发）← API `POST /api/ai/pending-actions/[id]` → `approveApprovalItem`。

### 2.4 其他 Task/Job 模型（勿混淆）

| 模型 | 用途 | 3B-A |
|---|---|---|
| `AgentTask` / `AgentTaskStep` / `ApprovalRequest` | 较重的多步 Agent 编排（项目向） | **不优先**；避免与 AgentRun 双轨 |
| `Task` | 项目任务实体（业务数据） | 作为 `grader.project_task` **执行结果**，不是 Run |
| `SkillExecution` | Skill 运行记录 | 能力中心投影源之一 |

---

## 3. 当前动作能力清单

### 3.1 查看今日业务简报

| 项 | 内容 |
|---|---|
| 入口 | **微信**：`runDailyBriefForWeChat` / `classifyWechatGraderIntent`→`DAILY_BRIEF`；**Web 助手：无专用入口**（仅可能被通用 chat / Operator 间接触及） |
| Executor | 只读：`runDailyBusinessBriefGrader`（`scanSalesDomain` + ownOnly） |
| 权限 | `resolveSalesOwnOnly` + org 扫描；无权限数据不进结果 |
| 组织 | 强制 `orgId` |
| AuditLog | `ai_daily_brief` |
| 需确认 | 简报本身只读；`suggestedActions` → PendingAction（最多 3）后需确认 |
| 返回 | `GraderResult`（score/risk/summary/issues/actions/evidence）；微信侧格式化为短文本 |

### 3.2 创建客户跟进任务（3B-A 目标场景）

| 项 | 内容 |
|---|---|
| 现状能力 A | `sales.update_followup` — 更新商机下次跟进时间（需 opportunityId） |
| 现状能力 B | `calendar.create_event` — 日历提醒 |
| 现状能力 C | `grader.project_task` — **创建项目 Task**，**强制 projectId**，不适合「纯客户跟进」 |
| CustomerFollowup Grader | 建议 `CREATE_CALENDAR_REMINDER` / `SUGGEST_STATUS_UPDATE` 等，经 `to-pending-action` 适配 |
| 权限 / Audit | executor 内二次校验 + `logAudit` |
| 需确认 | **是**（PendingAction） |

**缺口**：自然语言「提醒 Alex 明天下午跟进 ABC」尚未在 Web 助手形成「预览卡片 → 确认 → 执行」闭环；且执行落点应优先 **日历提醒 +/或商机跟进**，而非强行 `grader.project_task`。

### 3.3 生成 Gmail 邮件草稿

| 项 | 内容 |
|---|---|
| 入口 | Grader / Skill / Agent 工具 → `createDraft(type: grader.email_draft)`；微信确认链路 `wechat-confirm` |
| Executor | `exec…` in `executor.ts` → **`createGmailDraft()`**（`lib/google-email`） |
| 权限 | 绑定校验 + org 交叉；**绝不发送** |
| AuditLog | 有（via executor） |
| 需确认 | **是** |
| 返回 | `resultRef` = Gmail draft id |

### 3.4 其他已存在（本阶段不扩展产品面）

| 动作 | 入口 / Executor | 需确认 |
|---|---|---|
| 内部备注 `grader.internal_note` | Grader → PendingAction → executor | 是 |
| 项目任务 `grader.project_task` | 同上 | 是 |
| 报价风险 / 项目健康 Grader | 微信编排 + 只读 scan | 建议动作需确认 |
| 营销类 PendingAction | Growth 审批链 | 是 |

---

## 4. 当前 AI 路由（真实调用链）

### 4.1 Web 助手

```text
assistant/page.tsx
  → POST /api/agent-supervisor/runs   （优先）
       → AgentRun + Supervisor 规划 / 工具 / PendingAction
  → (403) POST /api/ai/threads/:id/messages
       → requireStreamTenant（body.orgId 仅交叉校验）
       → 长研分流 queueMarketResearchRequest
       → useOperator ? handleOperatorBranch(runAgentStream)
       → else legacy createChatStream SSE
```

- **意图识别**：无统一 `AssistantIntent`；依赖 Supervisor / Operator tools / 关键词（营销、日历）  
- **工具选择**：`needsTools` + Agent tools / Skills  
- **Grader 路由**：**未接入 Web 助手主路径**  
- **Capability 路由**：治理预检 `beginStreamAiUsage`；能力中心只读  
- **Fallback**：Supervisor 403 → 线程 SSE；微信分类器不确定 → `CHAT`

### 4.2 微信 / WeCom

```text
classifyWechatGraderIntent（规则，无 LLM）
  CANCEL / CONFIRM / PROJECT / QUOTE / CUSTOMER / DAILY / CHAT
→ runDailyBriefForWeChat / wechat-customer-followup / quote-risk / project-health
→ graderActionsToPendingActions → 用户数字确认 → executePendingAction
```

证据：`src/lib/ai-grader/wechat-intent-classifier.ts` 及各 `wechat-*.ts`。

### 4.3 3B-A 路由目标（待实现，不在本 commit）

在 Web/Mobile 助手增加**窄路由**（可先规则+轻量模型，复用微信分类思想）：

```ts
type AssistantIntent =
  | "daily_business_brief"
  | "customer_followup_task"
  | "gmail_email_draft"
  | "general_answer"
  | "unsupported_action";
```

低置信度 / 缺实体 → 追问，禁止猜客户与组织。

---

## 5. 当前移动端体验

| 项 | 结论 |
|---|---|
| 首字反馈 | SSE 有增量；Supervisor 路径偏「等整包」；**无统一 received 状态卡片** |
| 是否只有转圈 | 有 `Loader2` / `toolStatus` / `AgentRunPanel` 步骤，但不覆盖全部意图 |
| 流式平滑度 | Markdown 流式追加；长消息可能整卡重绘（Mobile-2 已处理输入栏 safe-area） |
| 工具状态可见 | Operator：`tool_start`/`tool_result` → `agentSteps` |
| PendingAction 手机操作 | `ApprovalCard` + `PendingInbox`；按钮可用，**缺统一任务状态机文案** |
| 错误可恢复 | 部分 toast/错误文案；**无统一 errorCode → 重试/修改 UI** |
| 刷新丢状态 | 历史消息可恢复；**未完成流式 Run 可能丢**（AgentRun 轮询未成为默认体验） |

复用 Mobile-2：`useVisualViewport`、safe-area、Dialog/Drawer、scroll-lock、layers — **禁止再造底栏**。

---

## 6. 复用决策（强制）

### 6.1 直接复用

| 能力 | 复用方式 |
|---|---|
| `AiThread` / `AiMessage` | 继续作为手机助手会话载体 |
| `AgentRun` / `AgentRunEvent` | **任务 Run 状态与步骤来源**（映射到 received/planning/running/…） |
| `PendingAction` + `createDraft` + `executePendingAction` | 一切写副作用确认闭环 |
| `ApprovalDecisionIdempotency` | 防重复确认 |
| Graders + `to-pending-action` | 今日简报与建议动作 |
| `createGmailDraft` | 唯一邮件草稿 Executor |
| `authorize` / DataScope / FIXED·MULTI_ORG | 每次 Prepare/Execute 服务端重鉴权 |
| `AuditLog` | 创建草稿与执行结果 |
| Capability 投影 | 可观测只读，不新建并行 Run 表 |
| Assistant UI：`ApprovalCard` / `AgentRunPanel` | 演进为统一卡片，不推倒重来 |

### 6.2 必须新增

| 新增 | 形式 | 原因 |
|---|---|---|
| `AiThread.orgId` | **最小 Prisma 迁移**（见 §14） | MULTI_ORG 会话隔离 P0 |
| 历史回填脚本 | `scripts/phase3b-backfill-aithread-org.ts` | 安全回填，禁止猜测 |
| `dispatchAssistantMessage` | `src/lib/assistant/dispatch.ts` | 统一服务端路由（见 §15） |
| 意图路由 | `src/lib/assistant/intent-router.ts` | 三场景优先于 Supervisor |
| Run 状态 DTO | `src/lib/assistant/run-status.ts` | 七态应用层映射 |
| 跟进场景编排 | `src/lib/assistant/scenarios/followup.ts` | 确定语义（见 §16） |
| 任务卡片组件 | `src/components/assistant/*-card.tsx` | 手机单手操作 |
| Telemetry 约定 | AgentRun.metadata / monitor | 指标可追踪 |

### 6.3 不应该新增

见 §1A 禁止清单。另：不为 `executing` / `expired` / `cancelled` 新增 PendingAction DB 枚举。

### 6.4 数据库迁移是否必要（已修正）

| 判断 | 说明 |
|---|---|
| **不新增任务/消息表** | AgentRun + PendingAction + AiMessage 足够 |
| **需要最小安全迁移** | **`AiThread.orgId`**（nullable 兼容历史；新线程强制非空） |
| 不为状态枚举迁库 | 七态继续应用层映射（见 §8） |

---

## 7. 三个 MVP 场景真实调用链（目标态）

### 7.1 今日业务简报

```text
用户消息（手机助手）
→ intent = daily_business_brief
→ 创建/复用 AgentRun(status=running, intent=…)
→ runDailyBusinessBriefGrader({ orgId: serverActiveOrg, userId, role })
→ 结构化卡片 SSE/轮询返回（非仅长文）
→ suggestedActions → createDraft（可选，≤3）
→ AuditLog ai_daily_brief
→ Run completed
```

红线：只读当前 activeOrg；ownOnly/DataScope；无权限模块不出现。

### 7.2 创建客户跟进任务（语义见 §16）

```text
用户消息
→ intent = customer_followup_task
→ 抽实体；缺失则追问（禁止猜客户/负责人/商机）
→ 按 §16 规则选择：
     A) calendar.create_event
     B) sales.update_followup（唯一 opportunityId）
     C) 两者各一张独立 PendingAction（用户明确同时要求时）
     D) grader.project_task 仅当明确项目 + 合法 projectId
→ 预览卡片 waiting_for_confirmation
→ 用户确认 → 分别 executePendingAction（重鉴权 + 幂等 + 过期）
→ AuditLog + result 链接
```

### 7.3 Gmail 草稿

```text
用户消息
→ intent = gmail_email_draft
→ 组装 EmailDraftPayload（校验收件人可达性）
→ createDraft(grader.email_draft)
→ 预览卡片 → 确认 → createGmailDraft（不发送）
→ 即使用户说「发出去」也只引导去 Gmail 发送
```

---

## 8. 统一任务状态映射（不建新表）

| 前端态 | 中文 | 主要来源 |
|---|---|---|
| received | 已收到 | 首包反馈；随后必须有持久化 AgentRun |
| planning | 正在分析 | intent 路由 / supervisor planning |
| running | 正在执行 | AgentRun running；tool_start |
| waiting_for_confirmation | 等待确认 | PendingAction `pending` / AgentRun waiting_for_approval |
| completed | 已完成 | AgentRun completed + PA executed |
| failed | 执行失败 | failed + errorCode；**过期 PA 展示 failed 或 expired presentation，禁止再执行** |
| cancelled | 已取消 | AgentRun cancelled；**PendingAction `rejected` → 前端 cancelled** |

DTO：`runId=AgentRun.id`, `conversationId=AiThread.id`, `organizationId=AgentRun.orgId`（= thread.orgId）, `initiatedByPrincipalId≈userId`, `status`, `currentStep`←可见 `AgentRunEvent`, 时间戳, `errorCode`, `resultSummary`。

步骤类型：`intent | data_lookup | permission_check | tool_execution | approval_required | result`（禁思维链/Prompt/SQL/Token）。

---

## 9. 预计修改文件（编码阶段）

```text
docs/PHASE3B_AI_TASK_AUDIT.md
docs/PHASE3B_AI_TASK_DELIVERY.md
docs/phase3b-screenshots/

prisma/schema.prisma                         （AiThread.orgId）
prisma/migrations/..._aithread_org_id/
scripts/phase3b-backfill-aithread-org.ts

src/lib/assistant/dispatch.ts
src/lib/assistant/intent-router.ts
src/lib/assistant/run-status.ts
src/lib/assistant/scenarios/{brief,followup,email-draft}.ts
src/lib/assistant/thread-org.ts              （加载线程时 org 校验）

src/app/api/ai/threads/**                    （全量 org 过滤）
src/app/api/ai/assistant/dispatch/route.ts   （可选薄入口；或扩展 messages）
src/app/(main)/assistant/page.tsx            （单入口；去掉前端双路由）
src/components/assistant/*-card.tsx

tests: 跨组织 thread/PA 攻击；dispatch 路由；三场景；Security-1
```

**Prisma**：仅 `AiThread.orgId` 最小迁移。

---

## 10. 主要安全风险

| 风险 | 缓解 |
|---|---|
| 客户端伪造 orgId | 服务端 activeOrg；body 仅交叉校验；线程查询强制 `userId+orgId` |
| 跨组织 threadId 直访 | 404 fail-closed（不暴露「存在但属他企」） |
| 换组织后确认旧 PA | PA.orgId ≠ activeOrg → 拒绝 |
| Prompt 越权读他企 | Grader/工具只走 DataScope；AI 文本不能改 authorize |
| 篡改 PendingAction payload | `payloadHash` + 执行前校验 |
| 重复 execute | status 闸门 + `ApprovalDecisionIdempotency` |
| 邮件误发送 | 仅 `createGmailDraft` |
| trade 经 AI 读销售 | 同销售授权；期望 403 |

必测攻击（§14.6）：Sunny 线程/PA → 切梦馨 → 直访/确认 → 拒绝；篡改 orgId → 拒绝；FIXED 行为不变。

---

## 11. 风险与技术债（可接受）

1. 历史线程无法唯一归属 → `orgId=null` + `archived=true`，普通 API 不返回（不删除）。  
2. PendingAction 无 DB 级 `expired`/`executing`/`cancelled`——展示层映射即可。  
3. Web 与微信路由仍两套：3B-A 先收敛 Web/Mobile；微信后续统一。  
4. `AgentRun.sessionId` **不是** `AiThread.id`（见 §15.4）——必须用 `metadata.threadId`。  
5. `pending-actions/types.ts` 注释「表暂无 orgId」过时，编码时顺手修正注释。

---

## 12. 阶段边界（再次确认）

- **不自动合入**；Draft PR 直至三场景验收通过  
- **不自动启动** Phase 3B-B / Security-2 / Mobile-3 / 数字员工独立 Principal  
- Security-1 / Mobile-2 无回归；`tsc` / `build` / `test-all` 通过  

---

## 13. 调整后的提交顺序

1. ✅ `docs(ai): audit Phase 3B task execution architecture`  
2. ✅ `docs(ai): lock Phase 3B tenant dispatch and followup decisions`  
3. ✅ `fix(ai): bind assistant threads to organization context`（见 §0A）  
3A. ✅ `fix(ai): enforce active org and restore archived threads safely`  
4. ✅ `feat(ai): add tenant-safe assistant dispatch and run status`  
4A. ✅ `fix(ai): harden assistant dispatch rate limits and run ownership`  
5. ✅ `feat(ai): add mobile assistant task cards`  
6. `feat(ai): add brief followup and email draft scenarios`  
7. `feat(ai): add confirmed execution recovery and retry`  
8. `docs(ai): complete Phase 3B-A task execution delivery`  

**编码许可**：本锁定文档已提交 + Draft PR 已开 → 从 Commit「线程组织绑定」开始。

---

## 14. 【锁定】AiThread 组织绑定与最小迁移

### 14.1 Schema 变更（设计）

```prisma
model AiThread {
  // ...existing fields...
  orgId   String?
  org     Organization? @relation(fields: [orgId], references: [id], onDelete: Restrict)

  @@index([userId, orgId, pinned, lastMessageAt])
  @@index([userId, orgId, projectId])
}

model Organization {
  // 增加反向：
  aiThreads AiThread[]
}
```

- 第一阶段 `orgId` **nullable**（历史兼容）  
- **所有新线程必须写入非空 orgId**；禁止产生新的无组织线程  
- `onDelete: Restrict`：有线程引用时不允许硬删组织  

回滚：迁移 down 删除列/索引/relation；应用层 feature 未开时仍可只靠请求态 org（不推荐长期）。

### 14.2 新线程创建规则

```text
1. authenticated user
2. 服务端解析 activeOrgId
3. 验证该 org 的 active membership
4. AiThread.orgId = activeOrgId
5. 客户端 orgId 忽略或仅交叉校验；不一致 → 403
```

### 14.3 线程 API 过滤（全部）

覆盖：列表 / 创建 / 读线程 / 读消息 / 发送 / 重命名 / 置顶 / 归档 / 删除 / 恢复历史 / 加载 PendingAction / 加载 AgentRun。

```ts
{ id: threadId, userId: session.user.id, orgId: serverActiveOrgId }
```

跨组织 `threadId` → **404**（fail-closed）。只验 `userId` **不足够**。

### 14.4 历史回填优先级（禁止猜测）

```text
1. thread.projectId → Project.orgId
2. 关联 PendingAction.orgId 且唯一
3. 关联 AgentRun（经 metadata.threadId / 可追溯链路）orgId 且唯一
4. 用户仅有一个 active organization membership
```

冲突或无法唯一确定：

```text
orgId 保持 null
archived = true
普通线程 API 不返回
写入迁移审计结果（不删线程）
```

脚本输出：`总线程数 / project回填 / PA回填 / AgentRun回填 / 唯一membership回填 / 冲突数 / 无法判断数`。

### 14.5 组织切换

MULTI_ORG 切换后：只显示新组织线程；禁止对旧组织线程发消息；旧组织 AgentRun/PendingAction 不得挂到新组织 UI / 不得确认。切回原组织可继续查看。

### 14.6 必测攻击

```text
Sunny 建线程 → 切梦馨 → 直访 Sunny threadId → 拒绝
Sunny 建 PA → 切梦馨 → 确认旧 PA → 拒绝
篡改请求 orgId → 拒绝
FIXED 用户行为不变
```

---

## 15. 【锁定】统一服务端 Dispatch

### 15.1 入口

```text
src/lib/assistant/dispatch.ts

dispatchAssistantMessage({
  userId,
  activeOrgId,
  threadId,
  message,
})
```

职责：鉴权 → 线程组织校验 → 保存用户消息 → 窄意图识别 → 实体提取 → 创建/复用 AgentRun → 三场景编排或 general/unsupported → 统一 Run DTO。

前端**不得**按关键字选择 Grader / Supervisor / Operator / Gmail / 日历 / 销售 API。

### 15.2 路由优先级

```text
1. 验证用户、组织、线程（userId + orgId）
2. 写入用户 AiMessage
3. 窄意图路由
4. 命中 daily_business_brief | customer_followup_task | gmail_email_draft
   → Scenario Orchestrator
5. general_answer → 现有 Supervisor / Operator / SSE（服务端选择）
6. unsupported_action → 能力边界说明
```

三场景**优先于**通用 Supervisor。

### 15.3 前端单一主入口

扩展 `POST /api/ai/threads/:threadId/messages` **或** 新增 `POST /api/ai/assistant/dispatch`。  
废除「前端先 Supervisor、403 后 SSE」作为业务路由方式。

### 15.4 Run ↔ Thread 关联（sessionId 语义）

`AgentRun.sessionId` 外键指向 **`AgentSession.id`**，**不是** `AiThread.id`。

锁定写法：

```text
AgentRun.orgId = activeOrgId
AgentRun.sessionId = 对应 AgentSession.id（按 org+user+channel=web_assistant 查找或创建）
AgentRun.metadata.threadId = AiThread.id   ← 稳定关联
PendingAction.threadId = AiThread.id
PendingAction.agentRunId = AgentRun.id
PendingAction.orgId = activeOrgId
```

刷新恢复：`threadId + orgId` 查询进行中 Run（`metadata.threadId`）与 PendingAction。

### 15.5 received 状态

提交后立即可见反馈（可先临时 SSE `received`）；进入 planning/running 后**必须**有持久化 AgentRun。

---

## 16. 【锁定】客户跟进动作语义

| 用户意图 | PendingAction | 约束 |
|---|---|---|
| 提醒 / 安排时间 / 加入日历 | **`calendar.create_event`** | 预览含：客户、负责人、开始/结束（或默认时长）、备注、组织 |
| 明确更新商机下次跟进日 | **`sales.update_followup`** | 必须唯一 `opportunityId`；多商机 → 让用户选；无商机 → **禁止**假 update，可提议改日历提醒 |
| 明确同时要两者 | **两张独立 PA** | 可 UI「全部确认」，服务端仍分别鉴权/幂等/执行/审计；无已验收 Batch Executor 则禁止塞单 payload |
| 明确指向项目且合法 `projectId` | **`grader.project_task`** | 普通客户跟进**不得**创建项目 Task |

**禁止**：新建 `SalesTask` 表；普通跟进误用 `grader.project_task`。
