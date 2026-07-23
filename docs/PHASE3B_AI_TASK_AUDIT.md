# Phase 3B-A：移动端 AI 工作入口与任务执行闭环 — 架构自检

**状态**：审计完成（**尚未开始功能编码**）  
**分支**：`feature/phase-3b-ai-task-loop`  
**基线**：

| 阶段 | Merge SHA |
|---|---|
| Security-1 | `55f109a183c742589a0d244c8267fd45e78f2fae` |
| Mobile-1 | `aa81c08abddfb4277272eb50afde7753b881bf91` |
| Mobile-2 | `84553eca8e4137f20e36fea14b91bbb9b3648382` |
| main tip（建分支时） | `6fccc96`（含 Mobile-2 COMPLETE） |

**原则**：本阶段复用现有基础设施；在本报告结论落地前，**不新建**与 CapabilityRun / PendingAction / AuditLog / Conversation / Message 重复的表。

---

## 0. 一句话结论

青砚已具备「聊天持久化 + SSE 流式 + Operator 多工具 + PendingAction 确认执行 + AgentRun 可恢复任务 + Grader 只读分析」整套底座。Phase 3B-A **不需要**新建聊天架构或第二套 Executor；缺口主要在：

1. **移动端助手缺少统一意图路由**（今日简报 / 跟进任务 / 邮件草稿）——微信侧已有规则分类器与 Grader 编排，Web Assistant 未收敛到同一入口；  
2. **缺少面向手机的统一 Run 状态卡片协议**（received → … → completed）；  
3. **「客户跟进任务」与现有 `grader.project_task`（必须有 projectId）不完全同构**，应优先复用 `calendar.create_event` / `sales.update_followup`，避免误建第二套任务表。

---

## 1. 当前聊天架构

### 1.1 两套会话模型（必须分清）

| 模型 | 用途 | 组织绑定 | 是否助手主路径 |
|---|---|---|---|
| `AiThread` / `AiMessage` | Web「青砚助手」对话 | **无 orgId 列**；组织靠请求时 `resolveRequestOrgIdForUser` + `requireStreamTenant` | **是** |
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

### 1.3 前端双路径（重要）

助手发送时**先**打 `POST /api/agent-supervisor/runs`（主管 AI）；403 才回落线程 SSE。  
主管路径产出 `AgentRun` + `pendingActionIds`；线程路径产出流式文本 + Operator 工具事件 + `approval_required`。

→ 3B-A 必须统一「用户可见任务状态」，避免两条路径卡片语义不一致。

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

### 6.2 必须新增（应用层，优先无迁移）

| 新增 | 形式 | 原因 |
|---|---|---|
| Web/Mobile 意图路由 | `src/lib/assistant/intent-router.ts`（名可微调） | Web 无 DAILY/FOLLOWUP/EMAIL 收敛 |
| Run 状态 DTO + 映射 | 纯 TypeScript，读 AgentRun/PendingAction | 统一前端七态 |
| 任务卡片组件 | `src/components/assistant/*-card.tsx` | 手机单手操作 |
| 简报结构化卡片 | 前端组件 + API 返回结构化 JSON | 微信目前偏文本 |
| 跟进任务 Prepare 编排 | 复用 createDraft，**可能扩展 payload 校验** | 场景二闭环 |
| Telemetry 字段约定 | 写入 AgentRun.metadata / 现有 monitor | 指标可追踪 |

### 6.3 不应该新增

- 新 `CapabilityRun` / 第二套 `PendingAction` / 第二套 Message 表  
- 第二套 Gmail Executor  
- 数字员工独立 Principal（明确延后）  
- WebSocket 大规模重构（SSE + Run 轮询足够）  
- 一次接入十几个动作  

### 6.4 数据库迁移是否必要

| 判断 | 说明 |
|---|---|
| **MVP 首选：不迁移** | AgentRun + PendingAction + AiMessage 可表达排队/步骤/确认/失败/取消 |
| 可选后续 | 若需一等公民 `expired`/`executing` 状态、或 AiThread 挂 `activeOrgId` 快照，再开小迁移；须单独说明回滚 |

**跟进任务落点决策（编码前锁定）**：

1. 有商机 → Prepare `sales.update_followup`（或并存日历提醒）  
2. 无商机、需提醒人到场/时间 → Prepare `calendar.create_event`  
3. 明确绑定项目风险 → 才用 `grader.project_task`  
4. **不**新建「SalesTask」表于 3B-A  

若产品坚持「无项目也要 Task 实体」，再评估扩展 `Task` 模型——**超出本阶段默认范围，需二次确认**。

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

### 7.2 创建客户跟进任务

```text
用户消息
→ intent = customer_followup_task
→ 抽实体（客户/负责人/时间）；缺失则追问
→ Prepare：校验客户∈org、负责人∈org active member
→ createDraft(calendar.create_event 和/或 sales.update_followup)
→ 预览卡片 waiting_for_confirmation
→ 用户确认 → executePendingAction（重鉴权 + 幂等 + 过期）
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
| received | 已收到 | AgentRun 创建瞬间 / 首包 SSE |
| planning | 正在分析 | supervisor understanding/planning；或 intent 路由中 |
| running | 正在执行 | AgentRun running；tool_start |
| waiting_for_confirmation | 等待确认 | PendingAction pending / AgentRun waiting_for_approval |
| completed | 已完成 | AgentRun completed + PA executed |
| failed | 执行失败 | failed + errorCode |
| cancelled | 已取消 | cancelled / rejected |

DTO 字段优先组合：`runId=AgentRun.id`, `conversationId=AiThread.id`, `organizationId=AgentRun.orgId`, `initiatedByPrincipalId≈session.userId`, `status`, `currentStep`←最新可见 `AgentRunEvent`, 时间戳与 `errorCode`, `resultSummary`←metadata/outputSummary。

步骤类型建议：`intent | data_lookup | permission_check | tool_execution | approval_required | result`（映射到 `AgentRunEvent.eventType`，禁止泄露思维链/Prompt/SQL/Token）。

---

## 9. 预计修改文件（编码阶段）

```text
docs/PHASE3B_AI_TASK_AUDIT.md          （本文件）
docs/PHASE3B_AI_TASK_DELIVERY.md       （交付时）
docs/phase3b-screenshots/              （交付时）

src/lib/assistant/intent-router.ts     （新）
src/lib/assistant/run-status.ts        （新：状态映射/DTO）
src/lib/assistant/scenarios/*.ts       （新：三场景 Prepare 编排）

src/app/api/ai/threads/[threadId]/messages/route.ts  （接入路由分流）
src/app/api/ai/assistant-runs/…        （可选：Run 查询/恢复，薄封装 AgentRun）

src/app/(main)/assistant/page.tsx
src/app/(main)/assistant/chat-panel.tsx
src/components/assistant/task-status-card.tsx
src/components/assistant/pending-action-card.tsx
src/components/assistant/tool-step-list.tsx
src/components/assistant/task-result-card.tsx
src/components/assistant/task-error-card.tsx

src/lib/ai-grader/*                    （复用；必要时抽「与通道无关」的编排）
src/lib/pending-actions/*              （复用；错误码归一）
tests: src/lib/assistant/__tests__/* 、pending-actions 扩展、Security-1 回归
```

**Prisma**：默认 **无 migration**。

---

## 10. 主要安全风险

| 风险 | 缓解 |
|---|---|
| 客户端伪造 orgId | 继续 `requireStreamTenant` / `resolveRequestOrgIdForUser`；body.orgId 只交叉校验 |
| Prompt 越权读他企 | Grader/工具只走服务端 DataScope；AI 文本不能改 authorize |
| 篡改 PendingAction payload | `payloadHash` + 执行前重算/比对；审批 port |
| 重复 execute | status 闸门 + `ApprovalDecisionIdempotency` |
| 过期 / 换组织后执行旧 Action | expiresAt；executor org 交叉；成员 active 校验 |
| 邮件误发送 | 仅 `createGmailDraft`；产品文案禁止「已发送」 |
| 泄露思维链 / Token | 事件 `visibleToUser`；telemetry 脱敏 |
| trade 经 AI 读销售 | Execute/Prepare 走同一销售授权；期望 403 / 不生成草稿 |

攻击场景验收（fail closed）列入交付测试清单（见阶段规格 §二十四）。

---

## 11. 风险与技术债（可接受）

1. `AiThread` 无 orgId：历史消息跨组织切换后回看需依赖 PendingAction.orgId / 文案提示（FIXED 用户影响小）。  
2. PendingAction 状态枚举与规格不完全一致（无 `executing`/`expired`/`cancelled` 一等值）——可映射展示，不必首迭代改库。  
3. Web 与微信路由两套：3B-A 先收敛 Web/Mobile；微信保持兼容，后续 3B-B 再统一。  
4. Supervisor 与线程 SSE 双路径：应用层用统一 Run DTO 遮罩。  
5. `types.ts` 注释仍写「PendingAction 表暂无 orgId」——**注释过时**，表已有 `orgId`。

---

## 12. 阶段边界（再次确认）

本阶段完成后：

- **不自动合入**  
- **不自动启动** Phase 3B-B / Security-2 / Mobile-3 / 数字员工独立 Principal  

验收仍要求：Security-1 与 Mobile-2 无回归；`tsc` / `build` / `test-all` 通过。

---

## 13. 下一步（审计之后才编码）

按建议提交顺序：

1. ✅ 本审计 Commit：`docs(ai): audit Phase 3B task execution architecture`  
2. Run 状态与流式/轮询基础  
3. 移动端任务卡片  
4. 三意图路由  
5. PendingAction 确认闭环（三场景）  
6. 恢复 / 重试 / 可观察性  
7. 测试与 `PHASE3B_AI_TASK_DELIVERY.md`

**编码启动条件**：本文件已合入分支且产品/工程无异议于「跟进任务落点默认日历/商机、不新建 SalesTask 表」。
