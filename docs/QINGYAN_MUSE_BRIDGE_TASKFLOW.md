# 青砚 × Muse — 招投标优化长任务流（Taskflow v1）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-22 |
| 目标 | 在 Muse 里指挥青砚跑完「抓标 → 分析 → 询价 → 比价 → 定价 → 审批」，青砚保持唯一事实源与审计 |
| 外部依赖 | `LucasJ880/Muse--Bridge-bot`（预计 2 天内通用化）；本文档的契约（`muse-bridge/v1`）是 Bridge 的开发目标 |
| 审批人 | 每个 **GATE** 由 Claude 审（代码 diff + 测试输出 + 本文验收项），Evan 拍板合并 |
| 纪律 | 零 schema（沿用 settingsJson / Notification / AuditLog）；出站动作一律审批；禁止第三套队列（T5 preflight §2 永久禁令）；不爬登录页 |

状态图例：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成 · `[G]` 等 Claude 审

---

## Phase 0 — Bridge 打通（本次已交付代码）

目标：三个意图（status / ask / approve|reject）在 Muse 闭环；审批卡从青砚推到 Muse。

| ID | 任务 | 依赖 | 产物 | 状态 |
|---|---|---|---|---|
| P0-1 | 契约 `muse-bridge/v1`：命令/响应/事件 zod schema，fail-closed | — | `src/lib/muse-bridge/contract.ts` | [x] |
| P0-2 | 开关：`MUSE_BRIDGE_ENABLED` / `MUSE_BRIDGE_INTENTS` / `MUSE_BRIDGE_ORG_ALLOWLIST` | P0-1 | `flags.ts` | [x] |
| P0-3 | 身份绑定（零 schema：`Organization.settingsJson.museBridge.bindings`）+ membership fail-closed | P0-1 | `binding-pure.ts` / `binding.ts` / `api/organizations/[orgId]/muse-bindings` | [x] |
| P0-4 | 命令路由：幂等账本（AuditLog, 24h）→ 意图门 → status / ask / approve / reject | P0-1..3 | `router-pure.ts` / `router.ts` / `api/bridge/muse/command` | [x] |
| P0-5 | 事件出站（Notification 作 outbox，`category=muse_bridge`，sourceKey 幂等）+ 拉取端点 | P0-1 | `events-pure.ts` / `events.ts` / `api/bridge/muse/events` | [x] |
| P0-6 | 挂钩 ①：PendingAction 创建 → `approval.requested` | P0-5 | `pending-actions/drafts.ts` 末尾 `notifyMuseApprovalRequested` | [x] |
| P0-7 | 挂钩 ②：分析终态化 → `analysis.ready`（legacy worker FINALIZE + workforce 两个 finalize，三面全接） | P0-5 | `hooks.ts museOnAnalysisFinalized`；`worker.ts` / `tender-workforce/tools.ts` | [x] |
| P0-8 | 挂钩 ③：inquiry 状态变更 → `reply.received` / `quote.parsed` / `missing_fields` | P0-5 | `hooks.ts museOnInquiryReplied / museOnQuoteRecorded`；`inquiry/service.ts` | [x] |
| P0-9 | 纯逻辑测试（43 项）；`scripts/test-all.sh` 注册 | P0-1..5 | `__tests__/muse-bridge-pure.test.ts` | [x]（注册待做） |
| P0-10 | ApiToken 种子：`system=muse-bridge`，`permissions=muse:bridge` | — | 运维步骤（见 §验收） | [ ] |

**GATE-0 验收（Claude 审）**
1. `MUSE_BRIDGE_ENABLED` 未设时，`/api/bridge/muse/*` 全部 503 `BRIDGE_DISABLED`，`emitMuseEvent` 返回 `{emitted:false, reason:"bridge_disabled"}`，现有流程零行为变化。
2. 未绑定的 `museUserRef` → 403 `USER_NOT_BOUND`；绑定但非 active 成员 → 403 `ORG_MEMBERSHIP_REQUIRED`。
3. 同一 `requestId` 重放 → 返回首次响应，`approveApprovalItem` 不被二次调用（AuditLog 账本可查）。
4. `rfq` / `follow_tender` 等未开放意图 → `INTENT_NOT_ENABLED` + `availableInPhase`，不是 500。
5. 创建任意 PendingAction（带 orgId）→ 指定审批人（否则创建人）的 Notification 里出现一条 `category=muse_bridge` 记录，metadata.museEvent 符合信封 schema；再创建一次（同 actionId）不重复。
6. 响应/事件文本里出现 `毛利` / `winningBidPrice` 等 → 整段替换为脱敏提示。

**Bridge 侧需要做的（给 Muse--Bridge-bot）**
- NLU → `MUSE_INTENTS` 词表映射；映射不到 → 让 Muse 问一句，不要猜。
- 每条命令生成 `requestId`（≥ 8 字符，UUID 即可），失败重试复用同一个 id。
- 轮询 `GET /api/bridge/muse/events?orgId&museUserRef&since`，把 `since` 持久化；事件里带 `action.command` 的，渲染成一键回复。
- 收到 `approval.requested` 后，用户回"批准/驳回" → 直接发 `approve/reject` 命令，带 `approvalId`，不要再走 NLU。
- 绑定：管理员在青砚 `POST /api/organizations/{orgId}/muse-bindings` 完成；Bridge 不保存任何青砚凭证，只保存一个 ApiToken。

---

## Phase 1 — 询价 + 比价（最大体感收益）

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| P1-1 | 结构化 RFQ 生成器：从已确认 `TenderExtractedRequirement` 取行项/数量/Incoterm/目的地/交期/回复截止/编号问题清单；两档出站闸 | P0 | `tender-rfq/build.ts`；21 项单测 | [x] |
| P1-2 | `rfq` 意图：选供应商 → 生成 → ProjectInquiry(draft)+items → PendingAction `tender.send_rfq` → 审批卡 | P1-1 | `tender-rfq/service.ts` + `muse-bridge/router.ts handleRfq`；批准前零出站；无供应商时回候选列表 | [x]（待 GATE-1 联调） |
| P1-3 | 执行器 `execTenderSendRfq`：只从组织配置邮箱（Organization.settingsJson.tenderRfq / env，默认 project@sunnyshutter.ca，抬头 Qyan-Sunny Purchasing）Gmail 发出 → `markItemSent` → in_progress；payload hash 防篡改；轮次锁（待批/3 天内已发） | P1-2 | `tender-rfq/execute.ts` + `round-pure.ts`；25 项单测 | [x]（待 GATE-1 联调） |
| P1-4 | 入站解析：邮件 webhook + 附件（PDF/Excel/图片）→ 结构化报价 → `recordQuote`；保留原文片段作证据；缺字段标记（不猜） | P0-8 | 回邮缺有效期 → `quote.parsed` 事件 summary 明说"缺有效期"，`missing_fields` 事件带追问草稿 | [ ] |
| P1-5 | 归一化层：币种、Incoterm → 落地成本（复用 `lib/quote/types.ts` shipping/customs）、MOQ/阶梯价、交期 vs 截标日、有效期 vs 开标日 | P1-4 | 纯函数 + 表驱动测试 ≥ 20 例 | [ ] |
| P1-6 | `compare` 意图：归一化矩阵 + 一句话结论（谁最便宜、谁全合规、谁交期超期） | P1-5 | 响应 ≤ 1200 字，data 带矩阵 | [ ] |
| P1-7 | `chase` 意图 + 催单调度：N 天无回复 → 草稿 → PendingAction → 审批 → 发送；超期自动 `markItemNoResponse` | P1-3 | cron tick 幂等；同 item 一天最多一张催单卡 | [ ] |
| P1-8 | `price_scenario` 意图：比价矩阵 → `tender-pricing.buildScenarios`；输出价格分/盈亏平衡，**不输出毛利** | P1-6 | 脱敏测试通过；情景与 UI 数值一致 | [ ] |

**GATE-1 联调前置（运维）**
- 用拥有 `project@sunnyshutter.ca` 的人登录青砚 → 设置 → 连接 Gmail（需 gmail.compose）；`EmailProvider.accountEmail` 必须等于该邮箱，发送只认它。
- `MUSE_BRIDGE_INTENTS=status,ask,approve,reject,rfq` 打开 rfq 意图。
- 非生产环境 `sendGmail` 受 `assertSideEffectOrThrow("email")` 保护：先在允许副作用的 staging 上用一个自己的测试供应商邮箱验证。

**GATE-1 验收**：从 Muse 说「问三家价」到三家报价进表，人工手录字段数 = 0；全程出站动作全部有 PendingAction 记录；Muse 端消息零敏感字段。

---

## Phase 2 — 标讯雷达

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| P2-1 | CanadaBuys tender notices 开放数据每日拉取（CKAN / CSV，只读；复用 `tender-intel` 的"候选→人工确认"契约） | P0 | 拉取幂等；不触碰任何登录页 | [ ] |
| P2-2 | 匹配打分：`tenderProfile` + bid-fit + buyer memory → 预评分 | P2-1 | 对历史 10 个已投标，Top-5 召回 ≥ 4 | [ ] |
| P2-3 | `brief.daily` 事件 + `follow_tender` 意图：命中 → 建 `Project(workDomain=tender)` → 拉文件包 → 幂等 enqueue | P2-2, P0-7 | Muse 早报点「跟这个标」→ 中午收到 `analysis.ready` | [ ] |
| P2-4 | `watch.ts` 升级为结构化 diff → 触发 `addendum-diff.ts` → `addendum.detected` | P0-5 | 变更≠Addenda 时文案仍诚实 | [ ] |

**GATE-2 验收**：一周内至少 1 条真实新标通过 Muse 早报 → 一键跟进 → 分析完成，全程无人工建项。

---

## Phase 3 — 运行时底座（与 1/2 并行推）

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| P3-1 | server-authored plan（T5 preflight §3 提案）：`createWorkforceJob({ plan })`，`WORKER_STEPS` → `WorkforceTaskSpecV1[]` 纯函数 | Runtime 设计门 | 同一验证路径；`source=server_authored` 可观测 | [ ] |
| P3-2 | 出站工具 `requiresApproval=true`（send_rfq / chase / 改价 / 锁标），收敛到 ApprovalPort | P1-3 | `tender-workforce/tools.ts` 无 `requiresApproval:false` 的出站工具 | [ ] |
| P3-3 | 并行度 1 → N；`tender-auto-analysis` 按收敛矩阵包进 workforce adapter | P3-1 | 不新增 queue/lease/scheduler | [ ] |
| P3-4 | 个人级偏好记忆：常用供应商、默认 Incoterm、催单节奏（存 user settings，零 schema） | P1-7 | `rfq` 不带 supplierIds 时默认取偏好 | [ ] |

---

## 度量（每个 GATE 复测）

| 指标 | 基线（2026-10） | 目标 |
|---|---|---|
| 标出现 → Go/No-Go（小时） | 人工，天级 | ≤ 4h |
| 决定询价 → RFQ 发出（分钟） | 手工写邮件 | ≤ 5 min（含审批） |
| 报价回收率 | 未统计 | ≥ 80%（含催单） |
| 人工手录报价字段数 | 5/家 | 0 |
| 审批平均响应时间 | 站内 | Muse 推送后 ≤ 30 min |

---

## 已决定（2026-10-22）

1. P0-7 三个 finalize 面全接（已实施）。
2. `analysis.ready` 收件人 = `Project.ownerId` ∪ run.createdById（与站内通知一致，复用 `resolveFailureRecipients`）。
3. Phase 1 入站邮件走 **Gmail watch**（P1-4 按 Gmail push notification + history.list 形态设计）。
4. `museUserRef` = **Muse 用户 id**。
5. ApiToken 种子：待定（P0-10）。
