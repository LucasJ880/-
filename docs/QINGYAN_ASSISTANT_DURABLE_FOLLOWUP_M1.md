# QINGYAN_ASSISTANT_DURABLE_FOLLOWUP_M1 — 助手客户跟进持久任务闭环（M1）

> 状态：**READY_FOR_CODE_REVIEW**（不是上线批准）。未合并、未部署、未改任何生产配置 / 开关、未接触生产数据。
> 验收步骤见 `docs/QINGYAN_ASSISTANT_DURABLE_FOLLOWUP_M1_ACCEPTANCE.md`。

## 0. 能力层级声明（不把 A 当成 F）

| 层级 | 本轮状态 |
|---|---|
| A. 源码中存在 | ✅ 本分支 |
| B. 入口实际调用 | ✅ `POST /api/ai/threads/[threadId]/messages` → `prepareAssistantDispatch` → `startDurableFollowupTask` |
| C. 开关 / 依赖满足 | ⛔ 默认关闭：需 `ASSISTANT_DURABLE_FOLLOWUP_ENABLED` + 白名单，**且**既有 `WORKFORCE_RUNTIME_*` 开关与白名单同时命中 |
| D. 测试通过 | ✅ 纯逻辑 / 渲染 / 一次性本地 PostgreSQL 隔离库端到端（见 §6） |
| E. 已部署 | ❌ 未部署 |
| F. 生产真实验收 | ❌ 未做（需授权测试账号 + 隔离环境，见验收文档 §5） |

## 1. 实际基线

| 项 | 值 |
|---|---|
| 开发 worktree | `/Users/user/Desktop/青砚-assistant-followup-m1`（独立 worktree，独立 `npm ci` + `prisma generate`） |
| 分支 | `feature/assistant-durable-followup-m1`（新建，此前不存在同名分支） |
| 基于 | `origin/main` = `c5896a373a83d2c08fe90a669d65fe2a3ece85e0`（2026-10-16 fetch 确认，与任务书锚点一致） |
| 主仓工作区 | `/Users/user/Desktop/青砚` 分支 `feature/sales-quote-cost-foundation` @`9f9a43bb`，落后 origin/main 174、103 个未提交改动——**未 reset / clean / stash / commit / migrate，未改动任何文件** |
| Node | 24.19.0（与 `.nvmrc` / engines 一致） |
| 相关在途 PR | #222（工艺单，无关，未触碰）、#209（性能审计 Draft，无交集）、#167（Autopilot A2-P2.4 Draft，无交集）、#175（Mention M2-B Draft，消息通道，不在本轮）——均未合并、未借用其代码 |

## 2. 调用链：既有 vs 本轮新增连接

```
用户消息（文字 / 附件 / clientRequestId）
  └─ POST /api/ai/threads/[threadId]/messages                 [改] 带附件也进入同一 Dispatch；注入 after() 调度
       └─ prepareAssistantDispatch (dispatch.ts)               [改] 先尝试持久跟进入口；带附件的非跟进消息仍交回对话分支
            └─ startDurableFollowupTask (followup-task.ts)     [新]
                 ├─ 开关：ASSISTANT_DURABLE_FOLLOWUP_* ∧ WORKFORCE_RUNTIME_*（任一未命中 → null → 既有行为逐字不变）
                 ├─ 线程归属：findOwnedThreadInOrg（服务端 org + 本人；项目线程不接入）
                 ├─ parseFollowupGoal（followup-goal.ts，纯函数）  → 受约束交付项 / 明确提醒时间 / 越界请求
                 ├─ resolveFollowupToolAccess：canInvokeTool 同策略预检（销售域、模块门、disabledTools、l2_soft）
                 ├─ buildFollowupServerPlan → ServerAuthoredPlanV1
                 └─ createJobOnce：advisory lock + requestId 重放检查 → 落对话 → createWorkforceJob（既有）
                        ├─ WORKFORCE 开关 / 白名单 / 组织配额（createAgentRun 治理）
                        ├─ compileServerAuthoredPlan（与 LLM 计划同一条共享验证链）
                        └─ queued → 响应后 after(kickQueuedWorkforceJobSlice)   [新，仅 route 层调用]
  ↓（与本次 HTTP 连接无关）
processWorkforceJobSlice（既有）：CAS 认领租约 → 现查发起人身份 → V2 executor / verifier（fenced）
  ├─ f2 sales_list_opportunities → f3 跟进分析 → f4 报价风险 → f5 sales_prioritize_followups（既有工具）
  ├─ f1 sales_followup_attachment_evidence（[新] serverPlanOnly，有附件才规划）
  └─ f6 sales_prepare_followup_actions（[新] serverPlanOnly，逐客户 createDraft → PendingAction）
       ↓ awaiting_approval
POST /api/ai/pending-actions/[id]（既有）→ approval port → executePendingAction（既有执行器，[改] 已取消任务拒绝执行）
  └─ resumeRuntimeV2AfterApproval（[改] 已取消短路）→ resumeWorkforceJob（既有）→ queued → after(kick)（[新]）
  ↓
GET /api/ai/threads/[threadId]/runs（既有）→ listAssistantRunsForThread（[改] 附 followup 成果投影）
  └─ RuntimeV2Workbench（[改]）+ FollowupOutcomePanel（[新]）；前端在任务推进中每 4 s 轮询（仅页面可见时）
POST /api/ai/threads/[threadId]/runs/[runId]/cancel（[新]）→ cancelDurableFollowupRun → cancelAgentRun（既有）
续接："补充提醒时间" → 新的续接 Job（sales_followup_carry_targets [新] 沿用父任务排序结果）→ f6
```

## 3. 已确认的问题与证据（以 origin/main@c5896a37 源码为准）

| # | 历史线索 / 新发现 | 结论 | 证据 | 本轮处理 |
|---|---|---|---|---|
| O1 | 带附件消息跳过 Dispatch | **确认** | `messages/route.ts:278` `if (attachments.length === 0) { prepareAssistantDispatch… }` | 改为统一进入 Dispatch；非跟进场景在 Dispatch 内保持"带附件不分流" |
| O2 | 意图路由单一场景，复合目标被截断 | **确认** | `intent-router.ts` 只返回一个 intent；目标原文 → `gmail_email_draft`（单测 `T02-baseline` 复现） | 新增受约束的批量跟进识别 + 多交付项计划（不扩张正则路由） |
| O3 | 普通助手 → Workforce 未接通 | **确认** | `createWorkforceJob` 仅 tender 调用；助手的 V2 路径在 SSE 流内同步 `startAgentRuntimeV2Run`（`dispatch.ts:1246`、`process.ts:153` maxRounds=12），无持久化排队 | 本场景走 Workforce Job（创建、认领、推进、审批恢复、结果回填全部接通） |
| O4 | 普通聊天与持久任务混用 `request.signal` | **部分确认** | Operator 分支把 `request.signal` 传给 `runAgentStream`（普通聊天，合理）；Dispatch SSE 无 cancel/signal，旧 V2 run 在流内执行、断线后不会被取消但也无持久推进 | 持久任务在响应前已创建且与连接完全解耦；只有显式取消 API 会取消 |
| O5 | 历史消息全量读取、附件反复加载 | **确认（普通聊天）** | `messages/route.ts:401` `aiMessage.findMany` 无 limit，每轮 `readStoredAttachments` | 本场景不读历史（结构化目标 + 附件引用）；普通聊天历史压缩不在本轮 |
| O6 | self-trigger 把失败响应 / AbortError 当成功 | **确认** | `self-trigger.ts:98` 任何 HTTP 响应 `fired:true`；abort → `fired:true`；route 丢弃结果 | 修正为 accepted / http_rejected / unknown_after_timeout / send_failed / not_configured；不跟随重定向；after() 内结构化记录 |
| O7 | 项目会话 adapter 占位 orgId | **确认** | `agent-core/conversation/adapter.ts:252` `orgId: "project-conversation"`，`tools: []` + 绑定只读工具 | 未改；本轮新增调用不接入项目会话，项目线程（`AiThread.projectId`）不进入持久跟进 |
| N1 | 提醒时间凭空取"下周五 15:00"（服务器本地时区） | 新发现 | `adapters.ts` `nextFridayIso()`（`calendar_create_event_draft` / `grader_create_followup_task` / `sales_update_followup`） | 本场景只用用户明确时间 + 可信时区；**legacy 工具未改（剩余风险 R4）** |
| N2 | 取消后迟到写入可把已取消 Run 改回执行中 / 已完成 | 新发现 | `lease.ts` fence 只断言租约 token；`cancelAgentRun` 不改 token；verifier `status:"completed"` 与 batch `status:"executing"` 为无条件 fenced update | fence.guard / check 同时要求 `status != cancelled` |
| N3 | 取消后才落库的待确认动作仍可被批准执行 | 新发现 | `cancelAgentRun` 只在取消时刻拒绝 pending；`executePendingAction` 不看关联 Run | 执行器 claim 前拦截已取消 Run（条件写 rejected）；`resumeRuntimeV2AfterApproval` 对已取消 Run 短路 |
| N4 | 新 Job / 审批恢复后要等下一班 2 分钟 cron | 新发现 | `vercel.json` `*/2`；`createWorkforceJob`、`resumeWorkforceJob` 只排队 | route 层 `after()` 推进一个 slice（CAS 认领，cron 兜底，无 HTTP 自调用） |
| N5 | 刷新后优先客户丢失 | 新发现 | `run-status.ts` 只认字面 `s5_prioritize` | 改为按 `preferredTool` 语义定位，字面键兜底 |
| N6 | 审批回包整体替换任务卡，步骤 / 成果被清空 | 新发现 | `page.tsx handleRunUpdate` 直接替换；reconcile DTO 不含 runtimeSteps | `mergeAssistantRunUpdate` 合并；持久任务审批后拉取服务端快照 |
| N7 | legacy 邮件草稿正文含内部评分（"跟进逾期 12 天(+30)"） | 新发现 | `adapters.ts gmail_create_draft` 正文拼接 `reasons[0]` | 本场景使用中性模板；**legacy 未改（剩余风险 R5）** |
| N8 | 2C-1 规则：任一审批被拒 → Job 停在 needs_human | 既有语义 | `resume.ts` 5b | 本场景把邮件草稿与提醒放在**同一个**审批步骤，避免"拒一封草稿就永远建不了提醒" |
| N9 | 日历事件写入审批人的日历（`ctx.userId`） | 既有语义 | `executor.ts execCalendarCreateEvent` | 未改（剩余风险 R6）；发起人自批时无影响 |
| N10 | 组织级动作发起人（org_member）不能自批 | 既有语义（四眼） | `marketing/team.ts canDecideTeamApproval` | 保留，隔离测试显式断言 |

## 4. 修改范围与架构决定

### 4.1 新增文件（全部不触发架构守卫：无新 planner/engine/registry 面、无新 AgentRun/Step/PA 直写）

| 文件 | 作用 |
|---|---|
| `src/lib/assistant/followup-contract.ts` | 契约常量 / 工具名 / stepKey / run metadata 键 / 只读解析 / 业务时区格式化（纯函数，客户端安全） |
| `src/lib/assistant/followup-goal.ts` | 目标识别、交付项拆解、明确时间解析（DST 安全）、续接回答解析、`ServerAuthoredPlanV1` 生成、受理文案（纯函数） |
| `src/lib/assistant/followup-flags.ts` | `ASSISTANT_DURABLE_FOLLOWUP_*` 开关（默认关、禁止裸开） |
| `src/lib/assistant/followup-outcome.ts` | 成果投影（DB 事实 → 交付状态），客户端安全 |
| `src/lib/assistant/followup-task.ts` | 服务端接入：开关、归属、工具预检、幂等创建、续接、取消 |
| `src/app/api/ai/threads/[threadId]/runs/[runId]/cancel/route.ts` | 用户主动取消 |
| `src/components/assistant/followup-outcome-panel.tsx` | 成果明细（只渲染服务端投影） |
| 3 个测试文件 | 见 §6 |

> 命名说明：`followup-goal.ts` 产出的是**计划来源**（ServerAuthoredPlanV1），按守卫说明"new plan SOURCES must go through the existing PlannerOutput/ServerAuthoredPlanV1 compile chain"——它经 `createWorkforceJob → compileServerAuthoredPlan` 共享验证链，不是新的规划引擎。架构基线文件 **未修改**。

### 4.2 修改既有文件（最小增量）

| 文件 | 改动 |
|---|---|
| `messages/route.ts` | 带附件也调用 Dispatch；传 `clientRequestId` 与 `after()` 调度 |
| `assistant/dispatch.ts` | 先尝试持久跟进入口；带附件的非跟进消息返回 general（保持旧行为） |
| `agent-runtime-v2/tool-catalog.ts` + `schemas.ts` | 3 个新工具登记进**既有** catalog，`serverPlanOnly:true` → LLM Planner 不可见（planner 可见面仍为 13 个） |
| `agent-runtime-v2/adapters.ts` | 3 个新 handler 登记进**既有** handler map；排序工具对跟进任务按 topN 去重取客户、附件提及客户可解释加权；legacy 行为不变 |
| `agent-runtime-v2/prioritize.ts` | 可选 `focus`（缺省行为不变） |
| `agent-runtime-v2/process.ts` | `resumeRuntimeV2AfterApproval` 对已取消 Run 短路 |
| `agent-runtime/lease.ts` | fence 视"已取消"为失去租约 |
| `pending-actions/executor.ts` | 关联 Run 已取消 → 拒绝执行（claim 之前） |
| `workforce-runtime/processor.ts` | `kickQueuedWorkforceJobSlice`（route 层专用） |
| `workforce-runtime/self-trigger.ts` + `cron/agent-runs/route.ts` | 观测语义修正 + 结构化记录 |
| `api/ai/pending-actions/[id]/route.ts` | 决策后 kick 关联 Workforce Job；`maxDuration = 300` |
| `assistant/run-status.ts` / `run-status-types.ts` | DTO 可选字段 `followup` / `cancellable`；`mergeAssistantRunUpdate`；优先客户语义定位 |
| `assistant/page.tsx` / `chat-panel.tsx` / `runtime-v2-workbench.tsx` | clientRequestId、推进中轮询、合并更新、取消按钮、成果面板 |
| `.env.example` | 文档化新开关（默认 0） |
| 3 个既有测试 | catalog 计数 13 → 16，同时**新增**断言 planner 可见面仍为 13 且 serverPlanOnly 工具永不可见；self-trigger 断言改为新语义并新增 401/403/500/302 用例 |

### 4.3 明确没有新增的东西

无 Prisma schema 变更、无迁移、无新任务表 / 队列 / worker / scheduler、无第二套 Planner/Executor/Verifier、无新审批通道（全部 `createDraft` → PendingAction → 既有 approval port）、无新事件类型、无新模型调用、未改模型策略 / baseURL / 凭证、无真实发送能力、未扩大管理员旁路、未放宽工具风险等级。

## 5. 开关、权限、审批、幂等、恢复语义

**开关**：`ASSISTANT_DURABLE_FOLLOWUP_ENABLED=1` + 至少一个 `*_ALLOWLIST`（org / user / role）。只有它与 `WORKFORCE_RUNTIME_ENABLED` + Workforce 白名单**同时**命中才会进入本场景；否则返回 `null`，既有分流逐字不变。Workforce kill-switch（总开关关闭）时已排队任务原状保留、不被 kick 或 cron 消费。

**租户与身份**：组织只来自 `resolveAssistantOrgId`（服务端）；线程必须是本人在该组织的非项目线程；附件 blobPath 在路由层校验组织归属，附件读取工具在执行期再做"组织 + 发起人 + 对话"三重校验。执行身份恒为发起人（`resolveRuntimeV2Principal` 现查 user.active + membership），审批人只记录、不扩大权限；发起人失权 → needs_human，不执行任何工具。

**工具可见性**：计划只包含用户明确要求、且当前可用的步骤——handler 存在 ∧ 执行策略 descriptor 存在 ∧ `canInvokeTool`（销售域、模块、disabledTools、l2_soft）∧ 配置满足（Gmail 草稿开关）；组织停用 `gmail_create_draft` / `calendar_create_event_draft` 时对应交付项标为不可用且执行期仍被拦（PA metadata 携带治理工具名）。

**审批**：邮件草稿与提醒在同一审批步骤里逐客户生成独立 PendingAction（`grader.email_draft` 确认后仅 `drafts.create`；`calendar.create_event` 确认后写本地日历并尽力同步 Google）。组织级动作遵循既有四眼规则。拒绝 → 2C-1 语义 needs_human(approval_rejected)，投影显示"部分完成（你已拒绝 N 项）"。过期 → 既有 expiry reconcile。

**幂等**：
- 同一次提交：前端每次发送生成 `clientRequestId`；服务端在 `pg_advisory_xact_lock(org:user:requestId)` 内先查重放再落对话与建 Job——重复 / 并发提交只得到同一任务、不新增消息 / Run / PA。
- 新的提交：新的 `clientRequestId` → 新任务（相同文本不会被永久去重）。
- 业务动作：`ar2:{runId}:{stepKey}:{actionType}:{customerId}` 幂等键 + `createDraftBatch` 复用；重试 / 租约接管不会重复创建草稿或提醒。
- 审批执行：既有 B2 CAS（pending→approved）保证至多一次副作用。

**恢复 / 中断**：页面关闭不影响任务（任务在响应前已入队）；worker 中断由租约过期 + CAS 重新认领恢复，旧 worker 写入被 fence 拒绝；取消后旧 worker 的任何 fenced 写入同样被拒；已取消任务不再被认领、迟到审批不能把它改回非终态、迟到草稿不能被执行。已发生的副作用（已执行的提醒 / 草稿）保留并如实展示。

**提醒时间**：只接受用户明确输入（日期 + 钟点；"明天 / 下周五"等由用户明说的相对日期按业务时区计算）。时区：用户明说 > 组织事实中心 `MarketingBrandProfile.timezone`（合法 IANA）；都没有 → 追问。只给日期 / 只给钟点 / 已过去 / 超过一年 → 追问，绝不补默认值。

**缺信息**：能安全完成的只读分析与草稿先做；缺失项（`reminder_time` / `timezone`）持久化在 Job metadata；一次合并追问；用户紧接着回答时间（可点名父任务客户）→ 续接 Job 沿用父任务排序结果，不重新分析、不要求重述目标。

**调度**：受理 / 审批后 `after()` 推进一个 slice（CAS 认领，与 cron 并发安全）；后续 slice 交给既有 cron（2 分钟）；无 HTTP 自调用、无循环自触发；前端只在任务"进行中"且页面可见时 4 s 轮询。

## 6. 测试结果

环境：worktree 独立 `node_modules`（Node 24.19.0，`npm ci` 时 DATABASE_URL 为假值）。DB 测试只用**一次性本地 PostgreSQL 17**（`127.0.0.1:55432`，数据目录在会话 scratchpad，pgvector；`npm run db:migrate:deploy` 受控 wrapper 应用 39 个迁移；统一 Guard 判定 `Mode: local database host / SAFE_TO_TEST = YES`）。**未连接任何 Neon / 生产库。**

### 6.1 本轮新增测试

| 套件 | 命令 | 结果 |
|---|---|---|
| 纯逻辑（目标识别 / 时间解析 / 计划编译 / 工具可见性 / 投影 / 开关 / DTO 合并） | `npx tsx src/lib/assistant/__tests__/durable-followup-pure.test.ts` | **PASSED 73/73** |
| 任务卡静态渲染 | `npx tsx src/components/assistant/__tests__/followup-outcome-render.test.tsx` | **PASSED 9/9** |
| 隔离 DB 端到端（Dispatch → Workforce → V2 → PendingAction → 审批 → 投影） | `DATABASE_URL=<本地一次性库> NODE_ENV=test npx tsx src/lib/assistant/__tests__/durable-followup-m1.isolated.test.ts` | **PASSED 61/61** |
| self-trigger 观测语义（含新增 401/403/500/302、不跟随重定向） | `npx tsx src/lib/workforce-runtime/__tests__/obs-p1-latency-self-trigger.test.ts` | **PASSED 27/27** |

### 6.2 验收矩阵 T01–T18

| # | 覆盖方式 | 结果 |
|---|---|---|
| T01 新功能关闭兼容 | 隔离 DB（开关关 → 既有窄场景、带附件仍走对话分支）+ 既有 assistant 套件 | PASSED |
| T02 纯文字复合任务 | 纯逻辑（基线复现被截断）+ 隔离 DB（5 步完整计划） | PASSED |
| T03 附带文件 | 隔离 DB（附件证据步骤、可核对引用、客户匹配、排序加权、注入指令不执行） | PASSED |
| T04 跨组织附件 / thread | 隔离 DB（附件归属三重校验拒绝；他组织线程不建任务） | PASSED |
| T05 重复提交 | 隔离 DB（顺序重放 + 并发重放） | PASSED |
| T06 合法新任务 | 隔离 DB + 纯逻辑 | PASSED |
| T07 关闭页面 / 重新打开 | 隔离 DB（不读响应体仍推进；DTO 可读；再次调度不重做步骤） | PASSED（浏览器层见 NOT RUN） |
| T08 中断 / 租约失效 | 隔离 DB（过期接管 + 旧 fence 拒写 + 无重复动作） | PASSED |
| T09 审批（批准 / 拒绝 / 过期 / 重复 / 部分） | 隔离 DB | PASSED |
| T10 用户取消 | 隔离 DB（取消、迟到审批、迟到草稿、迟到 fenced 写、恢复短路、不再认领） | PASSED |
| T11 权限变化 | 隔离 DB（执行前撤销 / 审批后撤销，管理员审批不提权） | PASSED |
| T12 不完整信息 | 纯逻辑 + 隔离 DB（合并追问、先做可安全部分、续接任务沿用父任务客户） | PASSED |
| T13 部分完成 | 纯逻辑 + 隔离 DB（提醒成功 + 草稿失败 → 部分完成；重试幂等） | PASSED |
| T14 无业务证据不验收 | 纯逻辑（无 resultRef / 降级证据 / run=completed 均不算完成）+ 既有 verifier 套件 | PASSED |
| T15 调度异常 | 纯逻辑（401/403/500/302/网络失败/AbortError）+ 隔离 DB（并发 tick + kick 恰一认领） | PASSED |
| T16 开关与配额 | 纯逻辑 + 隔离 DB（体验开关关、Workforce 关、白名单外、DAILY_AGENT_RUNS hard limit=0） | PASSED |
| T17 不支持的操作 | 纯逻辑 + 渲染（显式列出、计划无发送 / 下单工具、不显示已完成） | PASSED |
| T18 无真实副作用 | 隔离 DB（全局 fetch 记录并拒绝：外部请求 0；夹具零 Gmail / Calendar 连接；本地库） | PASSED |

### 6.3 仓库门禁（与 CI 同口径）

| 门禁 | 命令 | 结果 |
|---|---|---|
| Typecheck | `npx tsc --noEmit --incremental false` | **PASSED**（exit 0） |
| ESLint 基线 | `npm run lint:baseline` | **PASSED**（无新增 error fingerprint；本轮改动文件仅报出 origin/main 既有的 2 条：`dispatch.ts` `let binding`、`chat-panel.tsx` deps 警告，未顺手修改） |
| CI 单元子集 | `npm run test:ci` | **PASSED**（`CI unit subset PASS`，含 runtime-architecture guards，**未改架构基线**） |
| 生产构建 | CI 假 env `npm run build`（输出落文件后看退出码） | **PASSED**（exit 0；新路由 `/api/ai/threads/[threadId]/runs/[runId]/cancel` 已编译） |

### 6.4 全量回归（`scripts/test-all.sh`，一次性本地库）

命令：`DATABASE_URL=DIRECT_URL=<本地一次性库> NODE_ENV=test DATABASE_ENVIRONMENT=isolated PRODUCT_CONTENT_LOCAL_STORE=1 PRODUCT_CONTENT_LOCAL_STORE_DIR=<scratch> QINGYAN_ALLOW_GMAIL_DRAFT_NON_PROD=true bash scripts/test-all.sh`

**结果：376/382 PASSED，6 FAILED——全部为既有环境性失败，无回归。** 判定法：同一 6 个套件在**干净 origin/main@c5896a37**（detached worktree + 另一个一次性库）上单独运行：

| 失败套件 | 原因 | origin/main 对照 | 结论 |
|---|---|---|---|
| Phase3A-3 Approvals Smoke | 断言真实 Sunny / 梦馨组织存在（`✗ Sunny / 梦馨组织存在`） | 同样失败 | 数据前置，非回归 |
| Phase3A-4 Governance Smoke | 同上 | 同样失败 | 数据前置 |
| Phase3A-4 Acceptance | `✗ 双租户组织存在` | 同样失败 | 数据前置 |
| Phase3A-5 Overview Acceptance | `✗ 双租户组织存在` | 同样失败 | 数据前置 |
| T4 授标情报真实 Postgres 矩阵 | `✗ T4-DB-08 前置：库内无调查室行（快照异常）`（需生产快照行） | 同样失败 | 数据前置 |
| Autopilot A2-P0 Isolated E2E | 全量并发下 `permanent A2 failure reaches outbox DEAD` 偶发（已知并发 flake） | 单独运行通过 | **本分支单独运行 2 次均 96/96 PASSED** |

本分支新增套件在全量中同样通过（纯逻辑 73、渲染 9、隔离 DB 61）。`AI 分类基线测试` 因未启动 dev server 被脚本自身跳过（NOT RUN，既有行为）。

### 6.5 NOT RUN

- 真实 Gmail 草稿 / Google Calendar（无授权测试账号）
- 浏览器端到端（未起 dev server：主仓 `.claude/launch.json` 的 `start` 会加载主仓 `.env`（生产库），按禁令不使用；以静态渲染测试代替）
- Vercel preview / 生产任何验证；Neon 隔离分支（按任务书禁令改用可证明一次性的本地库）
- `test-all.sh --api`（需运行中的服务与登录 Cookie）

## 7. 未完成项与阻塞 / 剩余风险

**NOT RUN（需要授权或隔离环境，本轮没有）**
- R1 真实 Gmail 草稿 / Google Calendar 同步：夹具没有外部账号；只验证了"未连接 → 执行失败、零网络请求"与本地 `CalendarEvent` 写入。
- R2 浏览器端到端交互（发送 → 离开 → 回来 → 逐项确认 → 取消）：未起 dev server。主仓 `.claude/launch.json` 的 `start` 配置会用主仓 `.env`（指向生产库）启动，按禁令不可使用；改用服务端静态渲染测试覆盖任务卡。
- R3 Vercel 上 `after()` 推进与 cron 兜底的真实时延、`maxDuration` 行为。

**剩余风险（已识别、本轮刻意不改，避免扩大范围）**
- R4 legacy 工具仍默认"下周五 15:00（服务器本地时区）"：`calendar_create_event_draft` / `grader_create_followup_task` / `sales_update_followup`（只影响 `AGENT_RUNTIME_V2_*` 旧路径与 LLM 规划的 Workforce Job；本场景不使用）。建议后续统一接入本轮的明确时间契约。
- R5 legacy `gmail_create_draft` 邮件正文拼接内部评分理由（面向客户的邮件会出现"(+30)"）。
- R6 `calendar.create_event` 执行时写入**审批人**日历（`ctx.userId`）；发起人非组织管理员时，提醒会出现在管理员日历上。需要产品决定是否改为发起人日历。
- R7 任一审批被拒 → Job needs_human(approval_rejected)（2C-1 冻结语义）；投影显示"部分完成"。本场景写步骤是最后一步，所以不阻塞其它成果，但没有"拒绝后继续剩余步骤"能力（2C-3 范围）。
- R8 单项失败（如 Gmail 未连接）后不能只重试该项：需连接后重新发起任务（新提交）。
- R9 续接识别是启发式：只把**紧接在受理回执 / 追问之后**、且含明确时间的回答当作补充信息；误判时会生成提醒确认卡（仍需逐项确认，不会自动写入）。
- R10 目标识别为确定性规则（限定在"批量客户跟进"一类）；未接入"模型提议结构、服务端校验"的通道。
- R11 邮件模板为中性中文模板，未按客户语言 / 报价内容个性化；用户需在 Gmail 中审阅后自行发送。
- R12 普通聊天仍全量读取历史并逐轮展开附件（O5）；项目会话 adapter 占位 orgId（O7）未改。
- R13 报价风险汇总为组织级（GLOBAL grader）；与具体客户的关联体现在排序理由与证据引用里。
- R14 自触发结果只写结构化日志；`AutomationRun` 在 `after()` 前已结束，只记录"已安排触发"。
- R15 任务进行中"补充资料"只支持补充提醒时间（续接任务）；中途追加新附件 / 改变客户范围需重新发起（新提交，不会被去重）。
- R16 旧 `AGENT_RUNTIME_V2_*` 路径（流内同步执行 12 轮）未改；两个开关同时开启时，批量跟进目标优先走本场景，其它命中旧启发式的目标仍走旧路径。
- R17 任务进行中的进度靠前端 4 s 轮询（仅页面可见时）；没有把后台进度推送到已断开的 SSE。

**阻塞**：无代码阻塞；生产启用需要（1）授权测试账号完成 R1/R2/R3 的隔离验收，（2）产品确认 R6 的日历归属。

## 8. 后续隔离环境验收步骤

见 `docs/QINGYAN_ASSISTANT_DURABLE_FOLLOWUP_M1_ACCEPTANCE.md`。

## 9. 回退方式

1. **运行期（无需发版）**：删除 / 置 0 `ASSISTANT_DURABLE_FOLLOWUP_ENABLED`（或清空白名单）→ 下一请求起全部回到既有分流；已创建的跟进 Job 仍可在任务卡查看、审批、取消，由既有 cron 收尾（如需立即停止消费：既有 `WORKFORCE_RUNTIME_ENABLED=0` kill-switch）。
2. **代码回退**：revert 本分支提交即可；无 schema / 迁移 / 数据回填需要回滚。
3. 观测语义修正（self-trigger）与取消安全修正（fence / 执行器 / 恢复短路）与开关无关，回退需 revert 对应提交；它们只收紧行为（拒绝写入 / 拒绝执行），不放宽任何路径。
