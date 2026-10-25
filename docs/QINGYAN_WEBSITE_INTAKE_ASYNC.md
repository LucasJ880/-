# 网站询盘异步入站（PRD F3.1–F3.3）

适用：`POST /api/trade/webhook/website`、`GET /api/trade/webhook/website/status`、`/api/cron/revenue-spine` 的来信 FDE 兜底。
本文只描述通用机制，不含任何租户数据。

## 1. 一句话

webhook 请求内只做到 **Revenue Spine intake** 就返回（没有 LLM，目标 P95 < 2 s）；FDE（研究 / RFQ 抽取 / 评分 / 草稿，约 90 s、2 次 LLM）在响应之后由 `after()` 执行。任何执行 FDE 的地方都先**原子认领**，同一条来信的 FDE 不会被跑两次。

## 2. 请求路径与响应之后

| 阶段 | 内容 | 在哪执行 |
|---|---|---|
| 收据 | `WebsiteInquiryReceipt` 认领事件身份（`orgId + source + eventId`） | 请求内 |
| Trade | `TradeProspect` / `TradeMessage`、通知外贸成员 | 请求内 |
| Revenue Spine | `SalesCustomer` / `SalesOpportunity` / `CustomerInteraction` / `SalesAction`（`fdeStatus=queued`） | 请求内 |
| 关联 | Trade 线索 ↔ 商机回填 | 请求内 |
| 收据释放 | `status=linked`（FDE 未完成）| 请求内，返回前 |
| 进线分析 | `scheduleInquiryAnalysis`（已有，LLM） | `after()` |
| FDE | 认领 → `runInboundSalesFde` → 草稿 `PendingAction(sales.send_inquiry_reply)` → 回填收据（`complete`） | `after()` |

路由仍是 `maxDuration = 300`（静态字面量）：`after()` 里的工作计入同一函数的时长上限。

`ingestWebsiteInquiry(orgId, inquiry, opts)` 的 `fdeMode`：

- `deferred`：webhook 使用。FDE 交给 `opts.scheduleFde`（默认 `next/server` 的 `after()`）。调度器抛错（例如脚本里不在请求上下文）时不报错，FDE 留在 `queued`，由 cron 或下一次重发接手，响应里 `fde.scheduled=false`。
- `inline`（默认）：展会速记卡录入、脚本、既有库调用方。请求内认领并执行（同样走原子认领）。

## 3. 响应契约（HTTP 200，字段来自真实记录）

HTTP 保持 200（不是 202），以兼容已有的站点桥接。是否完成只看字段：

| 时刻 | `spine` | `opportunityId` | `complete` | `fde.status` | `fde.terminal` | `fde.scheduled` |
|---|---|---|---|---|---|---|
| 首个 POST | `ok` | 有 | `false` | `queued` | `false` | `true` |
| FDE 运行中的重发 | `replay` | 有 | `false` | `running` | `false` | `false` |
| FDE 失败后的重发 | `replay` | 有 | `false` | `failed` / `run_blocked` | `false` | `true`（已重新安排） |
| FDE 终态后的重发 / 状态查询 | `replay` | 有 | `true` | `completed` / `already_sent` / `human_rejected` / … | `true` | `false` |

站点桥接（`classifyQingyanResponse` / `processingStateFrom`）据此得到：首个响应 = `delivered` + 处理 `incomplete`；FDE 终态后的重发 = 处理 `complete`。兼容性测试把真实响应喂给站点判定逻辑的副本（`src/lib/trade/__tests__/fixtures/site-bridge-classify.ts`）。

`fde.scheduled` 是新增字段（本次请求是否安排了 FDE），旧调用方可忽略。

## 4. 重发（同一 eventId 再次 POST）

- 只补齐缺失的业务步骤（与以前相同），**从不在请求内执行 FDE**。
- FDE 可重跑（`queued` / `failed` / `run_blocked` / 认领过期的 `running`）且未被认领 → 用调度器安排；正在运行 → 只返回 `running`；终态 → 只返回终态。
- 多次重发安排多个回调也安全：认领只让一个执行。

## 5. 原子认领（`src/lib/revenue-spine/fde/inbound-queue.ts`）

所有执行入口都经 `runQueuedInboundFde(orgId, salesActionId, { by, trigger })`：

- 认领者：`after`（首个 POST 的回调）、`replay`（重发安排的回调）、`cron`、`inline`（同步录入）。
- 条件：`SalesAction` 是来信行动（`signalKey = inbound:<interactionId>`）且仍开放（`open` / `in_progress`）；存储状态为 `queued` / `failed` / `run_blocked`，或 `running` 但超过 `FDE_CLAIM_STALE_MS` 没有任何写入；且 `loadFdeState` 判定不在终态。
- 写入（无迁移，复用 `SalesAction.inputContext`）：`fdeStatus=running`、`fdeClaim{token, by, claimedAt, from}`、`fdeAttempts+1`，`updatedAt` 严格推进。
- 比较并交换：`updateMany where { id, orgId, status ∈ open, updatedAt = 读取值 }`。读取后任何写入都会改变 `updatedAt`；Postgres 对被并发更新的行重新求值 WHERE，两个并发认领只有一个命中。
- 没认领到：什么都不做（返回 `ran=false`），状态由真实记录说明。
- FDE 在建 AgentRun 之前早退（商机已终结 / 无来信 / 跨组织 / 旧阶段）：释放认领为 `failed` + `fdeErrorCode`，不会一直挂在 `running`。

终态（任何入口都不认领，也不复活）：`completed`（草稿待审批或 FDE 完成）、`already_sent`、`human_rejected`、`superseded`、`cancelled`（AgentRun 被取消）、`action_closed`（行动在 FDE 完成前被人工关闭，本次新增）。

## 6. 只读状态接口

`GET /api/trade/webhook/website/status?eventId=…`

- 鉴权：**只认** header `x-qingyan-webhook-secret`（website 通道密钥，`resolveWebsiteChannelBySecret`）；不接受 `?secret=` 或请求体。组织由密钥在服务端解析，查不到他组织的事件。
- `/api/trade/webhook/*` 在 middleware 的 `PUBLIC_PATHS` 里（无需登录态），鉴权完全在路由内。
- 返回与 POST 相同的快照字段，外加 `receiptStatus`。`busy=true` 表示该事件的请求路径此刻正在处理。
- 只读：不认领收据、不增加 `attempts`、不安排也不执行 FDE。
- 401 密钥错误 / 400 缺 eventId / 404 未知事件。只给服务端调用，不开放 CORS。

## 7. cron 兜底（`/api/cron/revenue-spine`，每 15 分钟）

- 先做 Next Action 重算与无回复跟进草稿（只有 DB 往返），最后做 FDE 兜底，用剩余时间。
- 候选（每个组织单独查询，按 `orgId` 限定）：`queued`、`run_blocked`、`failed` 且 `fdeAttempts < FDE_CRON_MAX_ATTEMPTS`、认领过期的 `running` 且 `fdeAttempts < FDE_CRON_MAX_ATTEMPTS`。只取来信行动（`signalKey` 以 `inbound:` 开头）——以前的查询会把同 `employeeKey` 的 next_action 行动也当成 FDE 候选。
- 没有 `fdeAttempts` 的历史 `failed` / `running` 行（本改动之前产生）不在候选里，与改动前 cron 只取未建 run 的行为一致；它们仍可由站点重发恢复。
- 不再按组织固定条数：按组织轮转，从本次 cron 开始超过 `FDE_START_DEADLINE_MS` 就不再启动新的 FDE；配额耗尽（`QUOTA`）的组织本轮停止。
- 执行后回填对应收据（`settleReceiptsForSalesAction`）。

## 8. 展会速记卡

`/api/trade/booth-cards/ingest` 保持同步（`inline`）：页面逐张调用并按每张卡的结果显示「草稿待审批 / AI 草稿未完成」。改成异步会让页面拿不到草稿结果，需要改 UI，不在本次范围。它与 webhook 共用同一个认领：同一张卡的 FDE 若已被 cron 认领，录入请求不会并行再跑（页面显示「已建商机」，草稿由 cron 产出）。

## 9. 时间常量（改任何一个都要一起看）

| 常量 | 值 | 位置 | 约束 |
|---|---|---|---|
| webhook / 展会速记卡 / cron 路由 `maxDuration` | 300 s | 各 `route.ts`（静态字面量） | `after()` 里的 FDE 计入 webhook 的 300 s |
| `FDE_CLAIM_STALE_MS`（= `FDE_STALE_RUNNING_MS`） | 10 min | `inbound-queue.ts` | 必须 > 任何持有认领者的最长寿命（300 s），否则会与仍在执行的 FDE 并行 |
| `RECEIPT_PROCESSING_STALE_MS` | 6 min | `website-inquiry-receipts.ts` | webhook 现在只在请求路径持有收据，但 inline 录入仍在持有收据期间跑 FDE，所以仍须 > 300 s |
| `FDE_START_DEADLINE_MS` | 200 s | cron 路由 | 截止 + 单个 FDE（≈90–95 s）< 300 s |
| `FDE_CRON_MAX_ATTEMPTS` | 3 | `inbound-queue.ts` | 只限制 `failed` / 过期 `running` 的自动重试（每次都可能花 LLM） |
| cron 频率 | 15 min | `vercel.json` | 回调丢失时最坏约 15 min 后由 cron 接手 |
| 站点转发超时 | 站点侧配置（当前 305 s） | 站点仓库 | 首个响应现在只需数秒；保留 305 s 无害，可按需调小 |

## 10. 排障

- `SalesAction.inputContext`：`fdeStatus`、`fdeClaim`（谁、何时认领）、`fdeAttempts`、`fdeError` / `fdeErrorCode`。
- `WebsiteInquiryReceipt`：`status`（`linked` = 业务对象已建、FDE 未完成；`complete` = 全链终态）、`agentRunId`、`pendingActionId`、`attempts`。
- `AgentRun(runType=fde_inbound_sales)`：每次真正执行一条；同一来信出现两条并且时间重叠即为认领失效，应排查。

## 11. 回滚

webhook 路由去掉 `{ fdeMode: "deferred" }` 即回到同步执行（认领保留，仍然更安全）。无迁移、无配置。
