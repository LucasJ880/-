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
| P0-1 | 契约 `muse-bridge/v1`：命令/响应/事件 zod schema，fail-closed | — | `src/lib/muse-bridge/contract.ts` | [x]（#232） |
| P0-2 | 开关：`MUSE_BRIDGE_ENABLED` / `MUSE_BRIDGE_INTENTS` / `MUSE_BRIDGE_ORG_ALLOWLIST` | P0-1 | `flags.ts` | [x]（#232） |
| P0-3 | 身份绑定（零 schema：`Organization.settingsJson.museBridge.bindings`）+ membership fail-closed | P0-1 | `binding-pure.ts` / `binding.ts` / `api/organizations/[orgId]/muse-bindings` | [x]（#232） |
| P0-4 | 命令路由：幂等账本（AuditLog, 24h）→ 意图门 → status / ask / approve / reject | P0-1..3 | `router-pure.ts` / `router.ts` / `api/bridge/muse/command` | [x]（#232） |
| P0-5 | 事件出站（Notification 作 outbox，`category=muse_bridge`，sourceKey 幂等）+ 拉取端点 | P0-1 | `events-pure.ts` / `events.ts` / `api/bridge/muse/events` | [x]（#232） |
| P0-6 | 挂钩 ①：PendingAction 创建 → `approval.requested` | P0-5 | `pending-actions/drafts.ts` 末尾 `notifyMuseApprovalRequested` | [x]（#232） |
| P0-7 | 挂钩 ②：分析终态化 → `analysis.ready`（legacy worker FINALIZE + workforce 两个 finalize，三面全接） | P0-5 | `hooks.ts museOnAnalysisFinalized`；`worker.ts` / `tender-workforce/tools.ts` | [x]（#232） |
| P0-8 | 挂钩 ③：inquiry 状态变更 → `reply.received` / `quote.parsed` / `missing_fields` | P0-5 | `hooks.ts museOnInquiryReplied / museOnQuoteRecorded`；`inquiry/service.ts` | [x]（#232） |
| P0-9 | 纯逻辑测试（43 项）；`scripts/test-all.sh` 注册 | P0-1..5 | `__tests__/muse-bridge-pure.test.ts` | [x]（#232；注册进 npm test 见 #241） |
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
| P1-1 | 结构化 RFQ 生成器：从已确认 `TenderExtractedRequirement` 取行项/数量/Incoterm/目的地/交期/回复截止/编号问题清单；两档出站闸 | P0 | `tender-rfq/build.ts`；21 项单测 | [x]（待 GATE-1 联调；#232） |
| P1-2 | `rfq` 意图：选供应商 → 生成 → ProjectInquiry(draft)+items → PendingAction `tender.send_rfq` → 审批卡；可带 `incoterm`（#258） | P1-1 | `tender-rfq/service.ts` + `muse-bridge/router.ts handleRfq`；批准前零出站；无供应商时回候选列表 | [x]（待 GATE-1 联调；#232、#258） |
| P1-3 | 执行器 `execTenderSendRfq`：显示发件人 `fromEmail`（默认 project@sunnyshutter.ca，抬头 Qyan-Sunny Purchasing）、授权邮箱 `mailboxEmail`（#238）从组织设置读取；Gmail 发出（text/plain，#240）→ `markItemSent` → in_progress；payload hash 防篡改；轮次锁（待批/3 天内已发） | P1-2 | `tender-rfq/execute.ts` + `round-pure.ts`；25 项单测 | [x]（待 GATE-1 联调；#232、#238、#240） |
| P1-4 | 入站解析：Gmail history 游标轮询（cron `tender-rfq-inbound`，每 10 分钟，按 threadId 认领）+ 附件（PDF/Excel/图片）→ 结构化报价 → `recordQuote`；保留原文片段作证据；缺字段标记（不猜） | P0-8 | 回邮缺有效期 → `quote.parsed` 事件 summary 明说"缺有效期"，`missing_fields` 事件带追问草稿 | [x]（待 GATE-1 联调；#234） |
| P1-5 | 归一化层：币种、Incoterm → 落地成本（复用 `lib/quote/types.ts` shipping/customs）、MOQ/阶梯价、交期 vs 截标日、有效期 vs 开标日 | P1-4 | 纯函数 + 表驱动测试 ≥ 20 例 | [x]（待 GATE-1 联调；#235） |
| P1-6 | `compare` 意图：归一化矩阵 + 一句话结论（谁最便宜、谁全合规、谁交期超期）；`price_scenario` 意图：比价矩阵 → `tender-pricing.buildScenarios`，输出价格分 / 打平价 / 所选供应商落地价，**不输出毛利率、项目估值、我方最终报价**（决定 A，#237） | P1-5 | 响应 ≤ 1200 字，data 带矩阵；脱敏测试通过 | [x]（待 GATE-1 联调；#235、#237） |
| P1-7 | `chase` 意图 + 催单调度：N 天无回复 → 草稿 → PendingAction `tender.send_chase` → 审批 → 原询价线程回复发出；催满两次 / 回复截止已过 → 自动 `markItemNoResponse` + `no_response` 事件；缺字段追问（含贸易条款 / 起订量，#258）；未响应后晚到的回信照样入表（#258） | P1-3 | cron tick 幂等；同 item 同一时刻最多一张待批催单卡 | [x]（待 GATE-1 联调；#239、#258） |
| P1-8 | 建议式回复契约（结论 → 理由 → 下一步）+ `next_step` 意图（确定性查表，零 LLM）+ 个人偏好记忆（常用供应商 / 默认 Incoterm / 催单天数，`preferences` / `set_preference` 意图） | P1-6 | 每条 ok 回复第一行 ≤ 60 字且 `suggestedActions[0]` = 下一步；偏好里不存任何金额 | [x]（待 GATE-1 联调；#236） |
| P1-6G | 比价解读数字校验：`/compare/analysis` 的 LLM 解读里每个金额 / 数量 / 百分比 / 日期必须能在交给 LLM 的输入（矩阵 + 代码结论）里找到，找不到的就地标注「［矩阵中无此数］」并在面板提示以矩阵为准（P1-5-6 报告遗留项） | P1-6 | `interpretation-guard.test.ts` 全过；零新增 LLM 调用；矩阵 / 结论 / 推荐不变 | [x]（#383；archive `2026-11-06-rfq-compare-number-guard`） |

**GATE-1 联调前置（运维）**
- 授权邮箱 `mailboxEmail`（lucas@sunnyshutter.ca）的拥有者登录青砚 → 设置 → 连接 Gmail，授权须同时含 gmail.compose（发信）与 gmail.readonly（读回信）；`EmailProvider` 只按组织设置里的 `mailboxEmail` 查找（邮箱分离，#238）。
- 在 lucas@ 的 Gmail 里把 `project@sunnyshutter.ca` 设为「以此地址发送」并完成验证；否则供应商看到的发件人会被 Gmail 改写成 lucas@。
- org_admin 调 `PUT /api/organizations/<orgId>/tender-rfq-settings`，body：`{"fromName":"Qyan-Sunny Purchasing","fromEmail":"project@sunnyshutter.ca","mailboxEmail":"lucas@sunnyshutter.ca"}`；staging 与生产各配一次。
- `MUSE_BRIDGE_INTENTS=status,ask,approve,reject,next_step,preferences,set_preference,rfq,compare,price_scenario,chase`（显式配置不会并入默认集，须写全 11 个），改完重新部署。
- 非生产环境 `sendGmail` 受 `assertSideEffectOrThrow("email")` 保护：staging 须打开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD=1` 与 `QINGYAN_ALLOW_CRON_NON_PROD=1`，并用自己的测试供应商邮箱验证。
- `staging` 分支已于 2026-10-27 快进同步到 main（含 #232–#240、#258）。

**GATE-1 验收**：从 Muse 说「问三家价」到三家报价进表，人工手录字段数 = 0；全程出站动作全部有 PendingAction 记录；Muse 端消息零敏感字段。
**GATE-1 验收（Web 版，W-1 起）**：从项目「标书与报价」点「问供应商要价」到三家报价进表，人工手录字段数 = 0；出站只经 `tender.send_rfq` 审批；审批人不离开项目页。

---

## Phase W — 先把已建好的用起来（Web 入口）

上位方案：`claude/招投标四步路径整合方案-2026-11-06.md`（青砚项目文档，Evan 2026-11-06 拍板 §6a）。纪律同上：零 schema、出站一律审批、不新增队列、零新增 LLM 调用。Muse Connector 冻结后，P1 询价引擎的入口改由 Web 承担；`MUSE_BRIDGE_ENABLED` 旁路保留。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| W-1 | 项目页「问供应商要价」：入口前置判断（七种不可发原因 + 出路）→ 抽屉选供应商 / 条款 → 与 Muse 同一 `prepareRfqRound`（`source=web`）建 `tender.send_rfq` → 原地批准 / 驳回（审批中心既有接口）→ 轮次状态行与「从发起到发出」耗时；待批轮次禁止手工标记发送；旧单封直发 `email/send`、`email/generate` 下线（410） | P1-1..P1-8 | OpenSpec change `rfq-web-entry`；`web-entry-pure` 81 项测试注册；报告 `docs/QINGYAN_W-1_REPORT.md`；staging GATE-W 见任务书 §6 | [x]（#389；archive `2026-11-07-rfq-web-entry`） |
| W-2 | RFQ 设置页：fromName / fromEmail / mailboxEmail / 回复提前量 / 轮次锁 / 催单天数 / 落地成本 FX（现只有 `PUT /api/organizations/[orgId]/tender-rfq-settings`） | W-1 | 页面保存 = 现有 PUT 的效果；非 org_admin 不可见 | [ ] |
| W-3 | 比价矩阵所选供应商落地价接进定价助手成本线（Web 化 `projectScenariosForMuse`，决定 A 不变） | W-1 | 定价助手出现「来自比价矩阵」成本来源；手填可覆盖 | [ ] |

---

## Phase T — 询价追踪（谁回了、谁没回、该催谁）

任务书：`docs/QINGYAN_T-1_T-2_RFQ_TRACKING_TASKBRIEF.md`（Evan 2026-11-07 拍板 §8：「催单待批」15 分钟未读发升级邮件；`batch-followup` 直接下线；追踪页显示价格）。纪律同上：零 schema、出站一律审批、不新增 cron / 队列、零新增 LLM 调用；通知、升级邮件与汇总不出金额。目标：替掉「盯 Grok Bot 追踪」这一步。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| T-1 | 询价进展站内通知：报价了 / 回信无报价 / 催单待批（一轮一次扫描一条；15 分钟未读发升级邮件）/ 未响应；收件人为项目负责人 ∪ 本轮发起人（催单待批只给负责人）；点开到该轮（`?tab=bid#rfq-round-<id>`），催单 / 追问卡在轮次里原地批准；两条入站提醒归入询价类别 | W-1 | 任务书 §2.6：带价回信后负责人铃铛出现「报价了」并展开到该轮；定时检查起草催单 → 一条「等你批准」，点开就是审批面板；30 分钟未读收到【青砚】升级邮件；通知与邮件无金额 | [x]（#391；archive `2026-11-08-rfq-tracking-notify`） |
| T-2 | 询价追踪页 `/bids/rfq` + `/bids` 汇总卡（需要我处理 / 等回复 / 已报价 / 未响应；下次自动催的日期与 `decideChases` 一致；落地价取比价矩阵）；首页「供应商未回复」改查 `sent`；`batch-followup` → 410 | T-1 | 任务书 §3.5 | [ ] |

---

## Phase 2 — 标讯雷达

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| P2-0 | 结果表单补「中标方（选填）」：未中标时人工填写 → 结果备注 + 人工确认授标事实（幂等 `tender-result-winner:{projectId}`，换名不覆盖）；授标情报投影把我方排除出「竞争对手」域（`ownAwardCount`）。来源 `QINGYAN_TENDER_INTEL_SLOTS_P1P2_REPORT.md` §5 遗留两条 | — | 未中标填中标方 → 竞争对手域出现该对手、不出现我方；同名再标记幂等；授标情报关闭时只写备注（`docs/QINGYAN_P2-0_REPORT.md`） | [x]（#384；archive `2026-11-06-tender-outcome-winner`） |
| P2-0b | 情报中枢「竞争对手」「采购机构」两页接真实数据（授标事实 + 我方项目，只读 `GET /api/org/tender-intel-profiles`，项目经可见性过滤）；「周期采购」入口收起（页面保留） | P2-0 | 两页显示对手 / 机构画像、我方排除或标出；开关关闭时降级；导航无「周期采购」（`docs/QINGYAN_P2-0b_REPORT.md`） | [x]（#385；archive `2026-11-06-tender-intel-org-profiles`） |
| P2-0c | 授标去重：同中标方 + 同买家、两条都有招标编号且不同 → 另一次招标（ACTIVE），不再判疑似重复；编号缺失或只差写法仍留人工 | — | 我方 / 对手在同一机构再次中标不落 NEEDS_REVIEW；买家周期用上全部样本（`docs/QINGYAN_P2-0c_REPORT.md`） | [x]（#386；archive `2026-11-06-award-dedupe-solicitation`） |
| P2-0d | 授标记录人工处理（仅组织管理员）：「历史中标」页确认线索 / 疑似重复、撤回错误记录（原因必填、留痕、同事务审计）；撤回后重新标记结果可更正中标方 | P2-0, P2-0c | 非管理员无按钮且接口 403；确认 / 撤回留审计；撤回后更正写新记录、重放幂等（`docs/QINGYAN_P2-0d_REPORT.md`） | [x]（#387；archive `2026-11-09-award-record-review`） |
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
| P3-4 | 个人级偏好记忆：常用供应商、默认 Incoterm、催单节奏（存 `Organization.settingsJson.museBridge.userPrefs`，零 schema） | P1-7 | `rfq` 不带 supplierIds 时默认取偏好 | [x]（随 P1-8 交付，#236） |

---

## Phase S — Sales Pilot（管理者 Muse ↔ 销售协作闭环）

上位文档：`LucasJ880/Muse--Bridge-bot` 的 `docs/prd/sales-pilot-prd.md`。纪律同上：零 schema、不加队列、对外动作一律审批；询问 = `Task`，跟进 = `SalesAction`，事件走 `Notification(category=muse_bridge)`。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| S1 | 只读销售意图 `sales_overview` / `opportunity_status`：服务端读范围（管理全组织 / 销售仅本人）、可解释确定性排序、决定 B 金额可见性 | P0 | OpenSpec change `muse-sales-read-intents`；`sales-pure` + `sales-db.isolated` 测试；报告 `docs/QINGYAN_S1_REPORT.md` | [x]（#262；已归档） |
| S2 | 跨助理询问 `ask_colleague` / `reply_inquiry`：询问 Task + 通知 + `inquiry.*` 事件；网页回复页 `/sales/inquiries/[id]` | S1 | OpenSpec change `muse-sales-inquiry-loop`；`inquiry-pure` + `inquiry-db.isolated` 测试；报告 `docs/QINGYAN_S2_REPORT.md` | [x]（#275；已归档） |
| S3 | 跟进引擎 `create_followup` / `update_followup`：SalesAction（source=muse_followup）+ 挂既有 `sales-actions` cron 的到期提醒 / 逾期升级 + 商机协作追踪 + 证据导出脚本 | S2 | OpenSpec change `muse-sales-followup-loop`；`followup-pure` + `followup-db.isolated` 测试；报告 `docs/QINGYAN_S3_REPORT.md`；staging 10 步验收随 G3 | [x]（#278；已归档；staging 10 步验收随 G3） |
| S4 | Pilot 上线：对 1 个组织开开关、绑定 2 个用户、签发 Connector Token、真实 10 步验收 | S3 | 一条真实商机经私人助理推进到下一步并可追踪 | [ ]（已冻结：Muse Connector 永久冻结，接入层由 Phase C 取代，见已决定第 10 条 / 任务书 D6） |

---

## Phase K — Sunny 日程归因与期间看板

设计稿：`docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md`（§7 判断点拍板后再 propose）。纪律同上：零 schema（配置 / 游标在 `settingsJson.calendarWatch`，账本在 AuditLog）、只读 Google 不出站、复用 vercel cron、确定性优先。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| KPI-1 | 期间看板：`summarizeSalesPeriod` 一套口径（成单 = 报价签字 grandTotal、报价 = sentAt）+ 表驱动洞察 + `GET /api/sales/period-summary` + `/sales/home` 期间选择器与按人表 + `sales_overview` 可选 `period` | — | OpenSpec change `sales-period-summary`；`period-pure` / `period-insights` / `period-db.isolated` 测试；报告 `docs/QINGYAN_KPI-1_REPORT.md` | [x]（#309；已归档） |
| CAL-1 | Google 日历观察：syncToken 增量拉取（`sales-actions` 定时任务的 `calendar-watch` 步骤，每 15 分钟）→ 四条归因规则（青砚 / 网站 / 成员 / 不明）→ AuditLog 账本 + 站内变更通知 + 按账号统计 `GET /api/sales/calendar/attribution` + 期间面板"日程来源" | 判断点 1、2 | OpenSpec change `calendar-watch-attribution`；`calendar-watch-pure` / `calendar-watch-db.isolated` 测试；报告 `docs/QINGYAN_CAL-1_REPORT.md` | [x]（#323；已归档） |
| KPI-2 | LLM 叙述层：只解读 KPI-1 的 JSON，数字校验不通过整段回落；开关默认关 | KPI-1；判断点 6（config.yaml 第 7 条例外，Evan 2026-10-29 拍板） | OpenSpec change `sales-period-narrative`；报告 `docs/QINGYAN_KPI-2_REPORT.md` | [x]（#332；已归档） |
| CAL-2 | 网站预约一键转入：CAL-1 观察到的、归因为网站的 Google 日历事件列成待转入，销售核对预填后一键建客户 + 预约（销售认领，不依赖网站 webhook，不写 Google；转入的预约以 Google 为准） | CAL-1 | OpenSpec change `website-booking-intake`；`website-booking-intake-pure` / `website-booking-intake-db.isolated` 测试；报告 `docs/QINGYAN_CAL-2_REPORT.md` | [x]（#340；已归档） |
| CAL-3 | 日历变更推送到微信 / Muse：CAL-1 的站内变更通知同时推给已绑定的收件人（员工推送不算出站，按晨报方式直发，用户 2026-10-29 拍板） | CAL-1 | OpenSpec change `calendar-change-push`；报告 `docs/QINGYAN_CAL-3_REPORT.md` | [x]（#346；已归档） |

---

## Phase P — Sunny 价格表 2026-10-28 进青砚 + 按人报价 / 销售额统计

任务书：`docs/QINGYAN_PRICE-1_PRICELIST_TASKBRIEF.md`（§7 判断点 Q1–Q11 拍板后再 propose）；交接：`docs/QINGYAN_PRICELIST_HANDOFF.md`。价表证据：`config/pricelist/2026-10-28-*.json`。纪律同上：零 schema（新折扣 / 无绳 / 褶皱率 / 附件价落 `settingsJson.pricing`）、折扣修改走既有 PendingAction、确定性优先（黄金用例来自原工具 `price()`）。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| PRICE-1 | Fauxwood 新产品 + Allusion 查表定价 + 企业折扣（settingsJson）+ 出单品类 / 工艺单名 + SKU BL201 改名 + `pricelistVersion` 进 formDataJson + **黄金对照测试**（158 条） | Q1、Q2 | OpenSpec change `pricelist-2026-10-fauxwood-allusion`；`pricelist-2026-10-golden` 测试注册；报告 `docs/QINGYAN_PRICE-1_REPORT.md` | [x]（#344；archive 见 `openspec/changes/archive/2026-10-30-pricelist-2026-10-fauxwood-allusion`） |
| PRICE-2 | Order Form 无绳显式开关（Q4 = A）+ 无绳独立折扣 30% + 最低价 159 / 129 + 取消 75" 上限；布帘 / 纱帘褶皱率（Fullness 180 / 230 → 1.8 / 2.3，其它入口按 2） | PRICE-1、Q3、Q4 | change `pricelist-2026-10-cordless-fullness`；黄金 `cordless-*` / `fullness-*` 组全过；报告 `docs/QINGYAN_PRICE-2_REPORT.md` | [x]（#354；archive 见 `openspec/changes/archive/2026-10-30-pricelist-2026-10-cordless-fullness`） |
| PRICE-3 | 附加项目目录按零售表更新 + Excel 固定价 / 按英尺项进 Part B 预设 + Downtown 150 预设 + 企业覆盖价（settingsJson，走审批） | PRICE-1、Q6、Q7、Q8 | change `pricelist-2026-10-addons`；报告 `docs/QINGYAN_PRICE-3_REPORT.md` | [x]（#357；archive 见 `openspec/changes/archive/2026-10-30-pricelist-2026-10-addons`） |
| STAT-1 | 期间面板"本周 / 上周"预设 + 按人行展开报价清单（`GET /api/sales/period-summary/quotes`）+ `/sales/quotes` 按销售筛选 + 草稿未发送提醒；口径不改 | KPI-1、Q9、Q10 | change `sales-quote-stats-drilldown`；`period-db.isolated` 扩；报告 `docs/QINGYAN_STAT-1_REPORT.md` | [x]（#355；已归档） |
| STAT-2 | 特别让利（Special Promotion）计入库里报价金额：服务端税前合计 / 税额 / 含税总额扣除让利，与对客金额一致（±0.01）；签约后只改让利进签约改价审批 | PRICE-3、STAT-1 | change `quote-total-net-of-promotion`；报告 `docs/QINGYAN_STAT-2_REPORT.md` | [x]（#373；archive 见 `openspec/changes/archive/2026-10-30-quote-total-net-of-promotion`） |

**GATE-P 验收**：Order Form 录 Fauxwood / Allusion / 无绳 Zebra / 3 倍褶皱布帘各一行 → 预览金额与黄金用例一致 → 保存并标记发送 → 期间面板按人金额 = 该报价 `grandTotal`，展开能看到这张报价；9 个老产品的 `regression` 组数字不动。

---

## Phase C — 协作通知（站内通知 + 邮件补位）

任务书：`docs/QINGYAN_COLLAB_NOTIFY_TASKBRIEF.md`（v1.0 定稿，§9 决定 D1–D6 已定）。它取代 Phase S 上位文档的接入层（个人 Token / 远程 MCP / VPS Connector），Muse Connector 永久冻结。纪律同上：零 schema（任务评论的 @ 列表落 `TaskActivity`，发信记录落 `Notification.metadata`）、不新增 cron（两种邮件挂既有 `sales-actions` / `daily-brief`）、不调 LLM；系统通知邮件只发给本组织 active 成员本人的青砚账号邮箱（`openspec/config.yaml` 第 2 条按任务书 §5.4 补澄清）。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| COLLAB-1 | 隐藏不可用的微信入口：服务端开关 `WECHAT_BINDING_ENABLED`（默认关）；关时登录页"微信扫码登录"及其上方分隔线、设置页"微信集成"入口、侧边栏"微信集成"、组织开通页的扫码绑定提示与绑定表都不出现，直接访问 `/settings/wechat`、`/wechat` 显示"暂未开放"；微信 API、回调、`wechat-push` cron 不动，打开开关即恢复原样 | — | OpenSpec change `hide-wechat-entry`；开关解析等新测试注册；报告 `docs/QINGYAN_COLLAB-1_REPORT.md` | [x] |
| COLLAB-2 | 协作通知：@ 必通知（讨论区 + 任务评论；被 @ 的人须为本组织 active 成员且能看到对象，否则整条 400）；任务指派 / 状态 / 评论与订单阶段（确认、开始生产、备货完成、已排期）通知相关人；未读升级邮件（`mention` / `task_assigned` 创建 15 分钟仍未读，挂 `sales-actions`）+ 每日未读汇总（组织当地 7 点，挂 `daily-brief`）；`openspec/config.yaml` 第 2 条补澄清 | COLLAB-1 | OpenSpec change `collab-notify`；纯逻辑测试注册；报告 `docs/QINGYAN_COLLAB-2_REPORT.md` | [x] |

**GATE-C 验收**（细项见任务书 §7）：开关默认关时登录页、设置页、`/settings/wechat`、`/wechat`、组织开通页都看不到微信绑定 / 扫码入口，打开后与改动前一致；A 把任务指派给 B → B 有未读 `task_assigned`、A 自己没有通知，B 15 分钟内不读收到一封升级邮件且下一轮不重发；任务评论里 @ 的请求重放不产生第二条通知；讨论区 @ 非项目成员整条 400；订单"备货完成 → 已排期"时创建人、商机负责人、排期负责角色各收到一条 `order_stage`，操作人不收；组织当地 7 点每人一封只含未读的汇总，没有未读不发；关了邮件偏好只收站内通知；邮件与通知摘要不含金额、客户电话、地址，邮件主题以 `【青砚】` 开头；合并提交上 Vercel 生产与 staging 构建都成功。

**运维前置（COLLAB-2 邮件，Evan 操作）**：生产需有 `NEXT_PUBLIC_APP_URL=https://qingyan.ca` 与 `RESEND_API_KEY`，设好后重新部署。缺任一项时，`notify-email-escalation` / `notify-email-digest` 每轮记为跳过并写明缺哪项，站内通知不受影响。staging 验收要收真实邮件时，临时开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD`，验完关掉（报告 §5、§6）。

---

## Phase V — 可见性收口（看得见的都是能用的）

任务书：`docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`（Lucas 2026-11-08 拍板：判断点 1–7 全取推荐，见任务书「拍板结果 · VIS-1」）。规则：一个入口（路由 / 首页卡片 / 底栏 / 通知类型 / 设置项 / 审批项 / AI 工具）只在「所属模块已开 ∧ 当前岗位持键」时出现，判定只从导航注册表（`src/lib/navigation/registry.ts` + `src/lib/tenancy/modules.ts`）派生。纪律同上：零 schema、不新增权限键、零新增 LLM 调用、不触碰出站、不新增队列。与 Phase K / P / C 并列，属 Sunny 线。一个 change = 一个 PR，按 VIS-1a → 1e 顺序合并。

**合并前置（Lucas）**：先把 `config/positions/sunny.json` 的 `TODO:` 邮箱占位填成真实邮箱并跑岗位绑定；否则岗位模式下无键的人在 VIS-1a 之后敲任何业务 URL 都会被弹回默认工作区。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| VIS-1a | 路由级可见性门（服务端）：已登录页面请求（含站内导航）在渲染前由 Node runtime 中间件按导航注册表判定「模块已开 ∧ 岗位持键」，不满足 302 到落地页；路由前缀 → 导航项映射表 + 登录即可白名单，表外路由 fail-closed；营销工作区旧门（中间件页面规则 / 「非销售即可」）由路由门取代；`/sales/analytics` 改按 `sales.analytics.read`；`/revenue` 只认 `trade` 模块；`/bids` 在岗位模式不再因 `project.read` 放行；源码断言每个 `(main)` 页面都命中映射表或白名单 | — | OpenSpec change `vis-1a-route-gate`；BREAKING：老板失去 `/trade/**` 直达、会计失去 `/bids`、安装工失去营销工作区；报告 `docs/QINGYAN_VIS-1a_REPORT.md` | [x]（#393；archive `2026-11-08-vis-1a-route-gate`） |
| VIS-1b | 首页 / 底栏 / 索引页按同一张表：岗位卡补模块与键并按导航同口径过滤（`inbound_sales` 卡随 `trade` 模块、`ops_knowledge` 卡仅平台管理员）；「等你拍板」只列本岗位可批类型，Sunny 原生审批跳各自专属落点；底栏「招投标」与侧栏 `ws-bids` 同判定；`/operations` 索引与 `/help` 功能地图从可见导航生成；销售侧栏移除「AI 任务」「数字员工」，`/workforce` 按可读域过滤 | VIS-1a | OpenSpec change `vis-1b-home-and-shell`；报告 `docs/QINGYAN_VIS-1b_REPORT.md` | [x]（#400；archive 2026-11-09-vis-1b-home-and-shell） |
| VIS-1c | 通知类型 / 设置 / 搜索 / AI 工具按同一张表收口（design Q1–Q9 Lucas 2026-11-10 全部按推荐）：通知开关与通知页筛选只列处理页面放行的类型（隐藏类型保留偏好、照常投递；图标表与跳转表不改）；`/settings` 发信文案改读组织设置 `ui.senderCopy`（附回填脚本），「邮箱绑定」卡按页面放行；全局搜索的项目结果 = 项目详情门 ∧ 详情页读判定；AI 工具列表按模块过滤（与执行期同一映射），营销工具需 `marketing` 模块且人类对话另要「品牌增长」入口；营销增长员工卡片按其页面放行；并入 VIS-1b 遗留：首页时间线按可见岗位与可读作业收口、「管理总览」只对管理层与底栏首格指向落地页、「等你 N 件」规格拆分 | VIS-1a、VIS-1b、#409 | OpenSpec change `vis-1c-notify-settings-search`；BREAKING：非管理层侧栏少「管理总览」；上线前对梦馨跑 `scripts/set-org-sender-copy.ts`；报告 `docs/QINGYAN_VIS-1c_REPORT.md` | [x]（#410；archive `2026-11-11-vis-1c-notify-settings-search`） |
| VIS-1d | 审批中心与「待我确认」按岗位收口（design Q1–Q12 Lucas 2026-11-11 全部按推荐）：可见集合 = 本人提交 / 指定审批人 / 工作区 / 项目负责人 ∪ 按类型的可见岗位（业务页面放行 ∧ 持该类型审批键）；无业务归属的草稿给企业所有者与成员角色 org_admin；审批中心列表在查询里过滤，详情 / 批准不可见按 404；AI 助手「待我确认」、红点、运营看板、审批收件箱（含 Muse）同一组条件且只含当前企业；端口、AI 助手、Muse、步骤审批路由对看不见的卡与不存在的 id 返回相同；幂等缓存在可见判定之后、按审批与动作命中；旧模式企业不收窄；平台 super_admin 全部可见 | VIS-1a、VIS-1b、VIS-1c | OpenSpec change `vis-1d-approvals-split`；隔离库测试（本机 Postgres 16）；BREAKING：岗位模式企业里不持对应岗位的企业管理员不再见全企业业务审批（Sunny 老板持 owner，体感不变）；报告 `docs/QINGYAN_VIS-1d_REPORT.md` | [x]（#432；archive `2026-11-11-vis-1d-approvals-split`） |
| VIS-1e | 平台管理员「以岗位预览」（design Q1–Q9 Lucas 2026-11-11 全部按推荐）：平台 super_admin 在企业详情页「岗位」一节按成员的岗位或勾选岗位组合开启 2 小时预览（cookie，零 schema）；预览身份 = 平台角色 user + 预览企业 org_member + 所选岗位的权限行，导航 / 路由门 / 首页 / 通知 / 搜索 / 审批 / AI 工具 / 当前企业都按它判定，平台特权与跨企业不可用；预览中任一写请求 409 `PREVIEW_READONLY`（退出、登出、登录豁免），GET 不写业务数据（逐条登记、扫描测试比对）；顶部常驻横幅可退出，条件失效时显示「预览已失效」；开启与结束各一条平台审计 | VIS-1a–1d | OpenSpec change `vis-1e-preview-as-position`；隔离库测试（本机 Postgres 16）；报告 `docs/QINGYAN_VIS-1e_REPORT.md` | [x]（#440；archive `2026-11-12-vis-1e-preview-as-position`） |
| VIS-2 | 运营看全公司销售额汇总（Lucas 2026-11-09：销售只看本人销售额、运营看运营数据 + 销售额、招投标对销售 / 运营不可见、老板看全部；对照后只缺运营看销售额）：新权限键 `sales.revenue.summary.read`（只 ORG）绑窗饰 `ops_lead` / `ops_staff`；`GET /api/ops/sales-summary` 只返回本周 / 本月至今成单金额、成单数、报价金额；运营中心只读卡；`scripts/seed-org-authorization.ts` 单企业重跑岗位落地 | VIS-1a | OpenSpec change `ops-sales-revenue-summary`；纯函数 9 + 隔离库 13（运营 / 老板 / 会计 200、销售 / 招投标 / 无岗位 403、无明细泄露）；截图 `docs/acceptance/vis-2/`；报告 `docs/QINGYAN_VIS-2_REPORT.md`；上线后对 Sunny 跑一次单企业落地 | [x]（#405；archive `2026-11-09-ops-sales-revenue-summary`；2026-11-09 已部署生产；同日已对 Sunny 跑 `scripts/seed-org-authorization.ts`，运营岗已持键） |

**GATE-V 验收**（细项见任务书「验收」节）：以 VIS-1e 预览逐岗位核对 Lynn（`sales_rep`）/ 安装工 / Miki（`accounting` + `pricing_lead`）/ Bob（`owner`）/ Lucas（`super_admin`）；未授权直达 URL 一律服务端 302 到默认工作区、无骨架闪现；`npm run test:ci` 与 `npm run typecheck` 通过；每个 change 的 `openspec validate` 通过。

---

## Phase U — 企业用户接入（邀请码直接进企业 · 用户管理按企业隔离）

起因：Lucas 2026-11-09，Sunny 新员工用销售邀请码注册后什么都看不到（码上只勾了公司 logo，注册落进个人工作区）；用户管理在 Sunny 下看到全平台的人。纪律同上：零 schema、零出站、零 LLM、权限不放宽。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| USR-1 | 平台邀请码页可指定「加入企业」与企业内角色（只给销售 / 外贸、企业须启用；可给已有的码补绑 / 改绑 / 解绑）→ 注册直接加入企业、当前企业设为该企业、自动绑默认岗位、不建个人工作区；公司 logo 跟随企业、页面不再手选；「用户管理」默认只列当前企业在册员工（带企业内角色），全平台需显式切换 | — | OpenSpec change `org-scoped-user-onboarding`；`org-scoped-users-db.isolated.test.ts` 36 项（真实注册进企业 + `sales_rep` + 上限 + 列表范围 / 权限）；截图 `docs/acceptance/usr-1/`；报告 `docs/QINGYAN_USR-1_REPORT.md` | [x]（#404；archive `2026-11-09-org-scoped-user-onboarding`；2026-11-09 已部署生产） |

---

## Phase R — 采购情报与政府资料申请（Tender 类目）

任务书：`docs/QINGYAN_PROC-1_RECORDS_TASKBRIEF.md`（v1.0，2026-11-05）；交接：`docs/QINGYAN_PROC-1_HANDOFF.md`。纪律：第 1 条零 schema 与第 3 条租约有 PROC-1 限定例外（决定 C，Lucas 2026-11-05 批准）；其余同上——不加 cron / 队列（挂既有 `tender-watch`）、零出站（用户自助提交）、只读官方开放数据 / 公开页、零 LLM。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| PROC-1 | 采购监控（CanadaBuys 公告 / Open Government 合同 / Completed ATI / 合同历史页）→ 候选与采购工具去重 → 申请卡（联邦 ATI 模板、版本、规则、申请人、重复检查、READY）→ 自助交接与回执核对 → 案件事件 / 期限 / 待办 → 披露文件解析、明细复核、按口径分析与导出 | 硬纪律 1 例外（Evan） | OpenSpec change `procurement-records-requests`；三组纯测试 + 隔离库端到端注册；报告 `docs/QINGYAN_PROC-1_REPORT.md` | [~]（#382 已合并、规格已归档 `2026-11-09-procurement-records-requests`；2026-11-09 真实只读核对通过、本地按生产方式迁移演练通过（报告 §8a）；**2026-11-09 生产迁移已执行（Evan）**、Vercel 生产置位并重新部署、初始数据已写入（报告 §8b）；GATE-R 业务验收待做（Lucas），验收后改 `[x]`） |

**GATE-R 验收**（业务验收另列，不能用 fixture 代替）：生产迁移按 Owner Gate 执行后，授权用户保存并启用监控，生产定时扫描至少一次真实 SUCCESS / PARTIAL 且来源结果可见；用户完成一次真实自助提交并上传真实回执，状态为 SUBMITTED（document_verified）。

---

## Phase F — 招投标主流程重排（三方对比 → 方案）

起因：Lucas 2026-11-11，同事反馈 ChatGPT 的 workflow 做标更顺，青砚招投标类目的 workflow 要更新。方案：`docs/QINGYAN_TENDER_FLOW_PLAN.md`；交接：`docs/QINGYAN_TENDER_FLOW_HANDOFF.md`。编号 `FLOW` 为暂定。FLOW-0 只出文档；后续实施项待 FLOW-0 拍板后再列，与 W-2 / W-3 / T-2 / P2-1～P2-3 重叠的沿用原编号，不重复立项。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| FLOW-0 | 三方对比（青砚现状 / ChatGPT workflow / 开源项目）+ 多轮交叉验证 → 主流程重排方案 | — | 方案 §8：三份底稿齐全、矩阵无空格；至少一份标书同标实测；独立复核一轮；每个保留项达到任务书粒度；Lucas 拍板 | [~]（第 1、2 轮完成：`docs/QINGYAN_TENDER_FLOW_BASELINE.md`、`docs/QINGYAN_TENDER_FLOW_OSS_SURVEY.md`；第 3 轮矩阵已据 ChatGPT 一方的 Skill 填入；第 4、5 轮未做） |
| TI-0 | Tender Intelligence Phase A：只读架构审查与差距分析（Lucas 2026-11-11 任务书：招标文件 → 文件领取方 → 竞争对手历史采购 → 进口线索 → 厂家匹配 → 认证核验 → 逐行成本 → 投标决策；渥太华 18026-93121-T01 作回归样例） | FLOW-0 第 3 轮 | `docs/tender-intelligence-gap-analysis.md` §10 的 10 项由 Lucas 拍板（Owner Gate A）；拍板前不开 change、不写代码 | [~]（差距分析已交；Owner Gate A 已过，Lucas 2026-11-11 按建议执行，见差距分析 §10a；Phase B 的 FIX-1 / TI-1 / TI-2 / TI-3a / TI-3b 与 Phase C 的 TI-4a / TI-4b / TI-4c 已于 2026-11-11 合入 main 并归档；Phase C 余项——成本输入落库、只读适配器、FIX-2——未开始，其中成本输入落库等 Owner 定存储方案） |
| FIX-1 | 询价单按类别筛要求时认得入库的写法：类别判定不区分大小写与首尾空白；旧式代码 `mandatory_technical` 按技术类进入、`mandatory_general` 不进入；未知类别不进入。此前库里的小写类别与旧式代码全部被判为「不属于供应商侧」，真实数据下询价发不出去 | TI-0（Gate A 第 8 项） | OpenSpec change `rfq-requirement-category-match`；`build.test.ts` 21 → 31 项；报告 `docs/QINGYAN_FIX-1_REPORT.md` | [x]（#412；archive `2026-11-11-rfq-requirement-category-match`） |
| TI-1 | 招标价格表行项（纯函数）：行项契约与结构校验、按行号集合的数量汇总、供应商按件报价到招标单位的换算与金额舍入、尺寸对照（相符 / 不符 / 无法判断）、截标时间必须带时区与开放 / 已提交 / 已过期的推导、按官方价格表原样导出；渥太华 18026-93121-T01 的 18 行作回归夹具（公司名用代号）。不落库、不联网、不调模型，线上零变化 | FIX-1 | OpenSpec change `tender-price-schedule-lines`；四个新测试共 81 项已注册；覆盖任务书验收项 A1 / A2 / A8 / A9 / A10 / A16；报告 `docs/QINGYAN_TI-1_REPORT.md` | [x]（#413，随 #412 进 main；archive `2026-11-11-tender-price-schedule-lines`） |
| TI-2 | 逐行投标成本核算表（纯函数）：成本构成分项、进口与本地采购分流、关税依据分级（已核实 / 敏感性假设）、进口 GST 可抵扣只进现金流、运费方案互斥与整票费用分摊、起订量与整包装取整、按售价毛利率与成本加成两种口径并同时输出两个比率、预备金两种口径不重复、两套情景对账不给胜出者、缺参数不出数；核算表视图四块与 Markdown 渲染。不落库、不联网、不调模型，线上零变化 | TI-1 | OpenSpec change `tender-bid-cost-sheet`；五个新测试共 103 项已注册；覆盖任务书验收项 A10–A14；样例 `docs/acceptance/ti-2/ottawa-sample-cost-sheet.md`（合成数据）；报告 `docs/QINGYAN_TI-2_REPORT.md` | [x]（#414，经 #420 进 main；archive `2026-11-11-tender-bid-cost-sheet`） |
| TI-3a | 竞争情报的线索契约（纯函数）：文件领取方快照（领取方数与投标人数分开，投标人数没有开标记录时为未知）、我方条目排除、公司名称三档比对（同名 / 建议 / 无关，不自动合并）、进口线索（只能人工用 12 个月内的证据确认当前供货）、数据来源连接状态（未接通不造数据，登录门户恒为按纪律禁用）、历史金额九个口径（只在同口径同币种内相加）。不落库、不联网、不调模型，线上零变化 | TI-1 | OpenSpec change `tender-competition-leads`；三个新测试共 64 项已注册；覆盖任务书验收项 A3 / A4 / A5 / A6 / A15；报告 `docs/QINGYAN_TI-3a_REPORT.md` | [x]（#415，经 #420 进 main；archive `2026-11-11-tender-competition-leads`） |
| TI-3b | 可投标判定与阶段策略表（纯函数）：证据状态投影（五个显示状态；过期与互相矛盾的不支撑结论）、强制认证闸（六条全过才通过，只覆盖部件 / 只是声称 / 只留预算都阻断）、补遗使旧结论失效（按行与版本）、可投标判定（阻断项与提示；两个结果，「可提交 Owner 决定」不是批准）、阶段策略表（十三个阶段各归一类，只读阶段不询问，只有对外动作停下；组织只能收紧）。不落库、不联网、不调模型，线上零变化 | TI-3a | OpenSpec change `tender-bid-readiness`；四个新测试共 87 项已注册；覆盖任务书验收项 A7 / A16 / A21；报告 `docs/QINGYAN_TI-3b_REPORT.md` | [x]（#416，经 #420 进 main；archive `2026-11-11-tender-bid-readiness`） |
| TI-4a | 投标工作区的存取接口：开关 `TENDER_BID_WORKSPACE_ENABLED`（默认关，按组织白名单）；按项目存取价格表行项、拟投品牌型号与产品尺寸、证书、文件领取方名单、补遗（存情报室既有 JSON 位下的新键，零 schema，加锁读改写）；`GET` 返回现算的价格表校验 / 尺寸对照 / 认证闸 / 领取方汇总 / 可投标判定 / 阶段清单，不含金额；`POST …/cost-sheet` 带着成本输入算核算表，须有财务查看权，**不落库**（该 JSON 位对所有项目读者敞开，成本数据不能放） | TI-3b | OpenSpec change `tender-bid-workspace-api`；纯逻辑 46 项 + 隔离库端到端 40 项已注册；覆盖任务书验收项 A17 / A20 / A22；报告 `docs/QINGYAN_TI-4a_REPORT.md`（含成本数据存储的三个候选，待 Owner 决定） | [x]（#417，经 #420 进 main；archive `2026-11-11-tender-bid-workspace-api`；开关默认关，生产未启用） |
| TI-4b | 项目页「投标工作区」面板（「标书与报价」页签顶部）：判定与逐条阻断项；缺的材料 / 未接通的来源 / 等批准的动作三张清单与十三个阶段的决定（无任何「是否执行」询问）；价格表与文件领取方名单粘贴导入；成本核算逐行输入并显示核算表（进口 / 本地分组、合计含毛利率与加成率、不含 HST、阻断与提示、假设与出处）；组件不做金额运算；成本输入只存浏览器本地；开关关闭时不渲染 | TI-4a | OpenSpec change `tender-bid-workspace-panel`；40 项断言已注册；真实应用截图 5 张 `docs/acceptance/ti-4b/`；报告 `docs/QINGYAN_TI-4b_REPORT.md` | [x]（#418，经 #420 进 main；archive `2026-11-11-tender-bid-workspace-panel`；开关默认关，生产未启用） |
| TI-4c | 投标工作区的逐行录入与补遗：价格表每行可录入拟投品牌型号、产品尺寸与证书；证书加「出处」，保存接口拒绝「已核验」而无出处的证书；补遗卡片可新增与删除；行明细记下按第几号补遗核对，之后有新补遗影响该行则判定报「补遗之后需要复核」，重新保存后消除（客户端带的补遗号被服务端压到不超过实际最新号）；认证闸的六个条件与判定规则本身不变 | TI-4b | OpenSpec change `tender-bid-workspace-line-entry`；新增 41 项断言已注册，既有三个测试 +23 项（含隔离库端到端 +9）；真实应用截图 3 张 `docs/acceptance/ti-4c/`；报告 `docs/QINGYAN_TI-4c_REPORT.md`（含「谁可以把证书标成已核验」待 Owner 决定） | [x]（#419，经 #420 进 main；archive `2026-11-11-tender-bid-workspace-line-entry`；开关默认关，生产未启用） |

### Phase F（续）— 询价自动流

| # | 任务 | 依赖 | 产出 | 状态 |
|---|---|---|---|---|
| RFQ-AUTO-1 | 一次批准管整轮：发询价的审批卡可带跟进授权（催单最多 2 次、间隔、回复截止、一次缺字段追问、模板指纹），批准这张卡即一并批准授权范围内的后续邮件；扫描时逐封做覆盖判定（20 个条件，含「正文里的供应商名称 / 发件人 / 截止与批准的卡一致」）；带授权的卡只能在网页批（Muse 里不能批），覆盖得住的仍逐封建审批记录、以批准该轮的人的身份经既有审批入口执行并另写审计，覆盖不住的照旧待批；轮次可停止自动跟进；顺带修两个现存漏洞（已取消 / 已完成的轮次不再跟进；催单过了回复截止不发）。开关 `TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED` 默认关 | FIX-1 | OpenSpec change `rfq-round-followup-preapproval`；新增测试 62 项 + 隔离库端到端 28 项已注册，`chase-execute` +7、`muse-bridge-pure` +4；开 PR 前经独立审查并修复 6 处；任务书验收项 A18 / A19 补齐（22 条至此全部有测试）；`openspec/config.yaml` 硬纪律第 2 条补一句（随 #422 合并生效）；截图 4 张 `docs/acceptance/rfq-auto-1/`；报告 `docs/QINGYAN_RFQ-AUTO-1_REPORT.md` | [x]（#422，2026-11-11 合并；archive `2026-11-11-rfq-round-followup-preapproval`） |
| RFQ-AUTO-2 | 招标分析批准后自动起草第 1 轮询价：人点「批准分析」的那一下，系统用操作者自己的常用供应商（在用且有邮箱，最多 8 家）经既有的建轮次函数起草一张待批的发询价卡；只起草，不批准、不发信；只起草第 1 轮且只一次；询价单只带已确认的要求并写明有几条没带上；不起草时给出原因与去处（8 种）；自动起草的卡只能在网页批、不带跟进授权。开关 `TENDER_RFQ_AUTO_DRAFT_ENABLED` 默认关 | RFQ-AUTO-1 | OpenSpec change `rfq-round-auto-draft`；新增测试 45 项 + 隔离库端到端 38 项已注册，`web-entry-pure` +13、`muse-bridge-pure` +4；开 PR 前经独立审查并修复 6 处；顺带修一个既有缺口（建轮次途中出错不再留下没有审批卡的草稿轮次）；截图 2 张 `docs/acceptance/rfq-auto-2/`；报告 `docs/QINGYAN_RFQ-AUTO-2_REPORT.md` | [x]（#425，2026-11-11 合并；archive `2026-11-11-rfq-round-auto-draft`） |
| RFQ-AUTO-3 | 自动起草的轮次也能带跟进授权：加一个个人开关（按用户、按组织，默认关），只能本人在网页上开启，开启处展示授权范围与三段模板；状态是本人最近一条开关记录（不放进组织设置），开启时绑定模板指纹，随时能关；开启后，他触发的自动起草的卡带上与网页勾选时相同的授权，卡仍只能在网页批、批准后才生效；关闭只影响之后起草的轮次。没有新的功能开关（RFQ-AUTO-1 与 RFQ-AUTO-2 两个都开时才可见）；不改覆盖判定、执行、停止与硬纪律文字 | RFQ-AUTO-1、RFQ-AUTO-2 | OpenSpec change `rfq-auto-draft-followup-optin`；新增测试 19 项已注册，隔离库端到端 38 → 68 项（含批准后自动催单）；开 PR 前经独立审查并修复 6 处（其中一处补上 RFQ-AUTO-1 留下的缺口：带授权的待批卡在功能关闭时也显示授权）；截图 4 张 `docs/acceptance/rfq-auto-3/`；报告 `docs/QINGYAN_RFQ-AUTO-3_REPORT.md` | [x]（#427，2026-11-11 合并；archive `2026-11-11-rfq-auto-draft-followup-optin`） |
| RFQ-AUTO-3a | 修 RFQ-AUTO-3 的一个缺口：个人开关的状态取「最近一条记录」，而记录时间来自各台服务器自己的时钟，时钟不一致或被回拨时后点的「关闭」可能不生效。设置改为一个短事务——取本人的锁、读最近一条、需要才写，并明确给记录时间（至少比上一条晚 1 毫秒）。读取、接口、界面不变；零 schema，没有新的开关 | RFQ-AUTO-3 | OpenSpec change `rfq-followup-optin-ordering`；隔离库 68 → 75（先在修复前的代码上确认新用例会失败），`auto-followup-optin` 19 → 21；报告 `docs/QINGYAN_RFQ-AUTO-3a_REPORT.md` | [x]（#433，2026-11-11 合并；archive `2026-11-11-rfq-followup-optin-ordering`） |
| RFQ-AUTO-4 | 招标要求审核的批量确认：要求列表上每条待确认的要求一个勾选框，「全选待确认的」「确认选中的 N 条」（默认不选；没有一键全部确认，没有批量驳回）；用既有接口，超过 200 条前端分批；列表上方计数；「批准分析」旁在还有待确认的要求时提示后果；批量确认留审计；分析已不是等待审核时面板的批量确认被接口拒绝（可选参数，条件写在同一条更新语句里）。不加功能开关 | RFQ-AUTO-2 | OpenSpec change `requirement-review-batch-confirm`；新增测试 54 项 + 隔离库经真实路由 17 项已注册；开 PR 前经独立审查并修复 6 处；截图 3 张 `docs/acceptance/rfq-auto-4/`；报告 `docs/QINGYAN_RFQ-AUTO-4_REPORT.md` | [x]（#429，2026-11-11 合并；archive `2026-11-11-requirement-review-batch-confirm`） |
| RFQ-AUTO-5 | 供应商分组：每人自己的几组供应商（名字 / 1–8 家 / 关键词，最多 10 组），按项目名称做确定性的文字比对选组，恰好一组对上才用，对不上不猜；询价抽屉按分组预选并可管理分组（存为新分组 / 用当前勾选覆盖 / 改名与关键词 / 删除）；自动起草有分组时只认分组，对不上不起草、不退回常用供应商，摘要 / 结果 / 审计写明分组与关键词；分组存成本人的只追加记录（不进组织设置），保存带版本、不互相覆盖；分组信息不出站。开关 `TENDER_RFQ_SUPPLIER_GROUPS_ENABLED` 默认关；关闭或没有分组时行为不变。零 schema、零模型调用；不改 Muse、审批、发送、催单 | RFQ-AUTO-2 | OpenSpec change `rfq-supplier-groups`；新增测试两个已注册（纯逻辑与接线 103 项、隔离库 52 项），`auto-draft-pure` 47 → 63；开 PR 前经独立审查并修复其发现（保存的先后不依赖时钟、无效字符在入口拒绝、读不出来的记录不当成没有分组等）；截图 4 张 `docs/acceptance/rfq-auto-5/`；报告 `docs/QINGYAN_RFQ-AUTO-5_REPORT.md` | [x]（#431，2026-11-11 合并；archive `2026-11-11-rfq-supplier-groups`） |
| FIX-3 | 组织设置的写入不再互相覆盖：`Organization.settingsJson` 被 11 处不加锁的「整块读、整块写」共用，并发时后写的会冲掉先写的（旧代码上七种写入同时发起，第一轮就丢五项）。新增统一入口——锁行、读最新、只改自己那一块、写回——并把全部写入方接上去：收信游标、Muse 偏好 / 绑定 / set_preference、询价设置、投标资料、运营手册执行模式、日历监听，以及门店折扣与开户向导（在既有事务里补锁行）。每一处写什么不变；零 schema；新增守卫测试拦住以后绕开的写入 | RFQ-AUTO-3 的独立审查 | OpenSpec change `org-settings-locked-write`；新增测试两个已注册（隔离库 22 项、守卫 13 项）；同一份隔离库测试在旧代码上 8 项失败；涉及模块的 12 个既有隔离库测试不改断言全部通过；报告 `docs/QINGYAN_FIX-3_REPORT.md` | [x]（#436，2026-11-11 合并；archive `2026-11-11-org-settings-locked-write`） |
| FIX-2 | 招标分析保留数量与单位，价格表可以从分析带入：V2 分析入库时原来把要求的数量、单位与数量类事实丢掉了，现在存进该次分析「价格与评标」一节已有的结构化字段；投标工作区「粘贴导入」里加「从招标分析带入」，把确定性规则生成的行填进粘贴框并列出各行的出处，**不保存**（人核对后仍点原来的保存）。数量只在整段文字就是一个数字时才取（范围、金额、倍数、编号、按期间计的用量、有歧义的写法一概不取并写明原因）；招标文件与补遗说法不一致的不带入；质保、样品等类别不收；重复的行不合并只标明。只读接口 `GET …/bid-workspace/schedule-candidates`。零 schema、零模型调用、无新开关（沿用 `TENDER_BID_WORKSPACE_ENABLED`） | TI-4b | OpenSpec change `analysis-quantity-unit-prefill`；新增测试两个已注册（纯逻辑与接线 106 项、隔离库 40 项）；开 PR 前经独立审查并修复其发现（第一版的数量规则会悄悄取错、说法不一致的被带入、测试看不住「不保存」）；30 处变异核对全部被发现；截图 3 张 `docs/acceptance/fix-2/`；报告 `docs/QINGYAN_FIX-2_REPORT.md` | [x]（#437，2026-11-11 合并；archive `2026-11-11-analysis-quantity-unit-prefill`） |
| FLOW-H1 | 项目页告诉人「现在卡在哪、下一步点哪里」：接口 `GET …/next-step` 与工作台顶部的卡片。判断复用 Muse 的同一张查表（十条规则原样调用，不改它），补上网页才需要的状态（没传文件 / 等确认与批准 / 已批准却没有已确认的要求 / 已回复没录入 / 等回复 / 只有一家报价 / 准备提交 / 已提交 / 已中标 / 截标日期已过），每个结论指到页面上的一个位置（页签 + 页内位置、文件抽屉、审批中心）。截标作为提醒与下一步并存，按天说；等回复的口径与定时催单一致；指向询价入口时读入口自己的状态；不出任何金额。**只读、只指路**：不批准、不发送、不承诺系统会做什么。决策摘要与右侧面板跟着说同一条结论。开关 `TENDER_WEB_NEXT_STEP_ENABLED` 默认关。零 schema、零模型调用，不改 `muse-bridge/**`。不含「用它推导六段进度条、取代三步卡」（另开 change） | FIX-2 | OpenSpec change `tender-web-next-step`；新增测试两个已注册（纯逻辑与接线 141 项、隔离库 69 项）；开 PR 前经独立审查并修复其发现（点击到不了位、空轮次盖住报价、截标与催单的说法不准、15 处变异没被发现等）；41 处变异核对全部被发现；截图 8 张 `docs/acceptance/flow-h1/`；报告 `docs/QINGYAN_FLOW-H1_REPORT.md` | [x]（#439，2026-11-12 合并；archive `2026-11-12-tender-web-next-step`；开关默认关，生产未启用） |
| FLOW-H1b | 项目页的阶段与进度条跟着实际进度显示：「下一步」接口多返回三项（实际进度、同一时刻记录的阶段、显示的阶段）。实际进度由事实确定（有提交时间 / 有供应商报价或投标报价单 / 有已发出的询价 / 有可用的分析）；没结束的项目显示记录的阶段与实际进度里靠后的那个，已结束的项目显示记录的阶段。每个页签上方的决策摘要、右侧项目上下文、项目进度区的当前阶段、六段进度条与完成百分比都用显示的阶段；与记录的阶段不同时在项目进度区写明。有「下一步」卡片时工作台的三步卡不再渲染。**只改显示，不写阶段记录**；沿用开关 `TENDER_WEB_NEXT_STEP_ENABLED`，关闭时页面与原来相同。待定：要不要让阶段记录自动前进（列表、Muse、放弃项目的流程仍按记录的阶段）。 | FLOW-H1 | OpenSpec change `tender-web-progress-from-facts`；新增测试两个已注册（纯逻辑与接线 51 项、项目进度区渲染 14 项），既有隔离库测试补到 100 项；开 PR 前经独立审查并修复其发现；64 处变异全部被测试发现；真实浏览器截图 `docs/acceptance/flow-h1b/`；报告 `docs/QINGYAN_FLOW-H1b_REPORT.md` | [x]（#443，2026-11-12 合并；archive `2026-11-12-tender-web-progress-from-facts`；开关默认关，生产未启用） |
| FLOW-H1c | 阶段记录跟着事实自动前进：分析产出可审核的结果 → 项目解读；询价执行这一次真的发出 / 人工标记已发送 → 供应商询价；没取消的轮次里第一次录入报价（人工或回信解析）→ 供应商报价。只在这一段为空、写上之后阶段记录会变靠后时写；写了就按 FIX-5 关之前阶段的自动任务、建新阶段的，并写一条系统审计 `tender.stage.auto_advance`。不对已放弃 / 已有结果 / 非招投标项目生效；**不改招投标状态、不发 BidToGo 回调、不发讨论区消息与通知**。新开关 `TENDER_STAGE_AUTO_ADVANCE_ENABLED`（默认关），关闭时不加载、不查库。依赖 FIX-5 先合并。待定：人再推进到同一阶段时要不要补状态与回调（「供应商报价」状态以后到不了）。 | FLOW-H1b、FIX-5 | OpenSpec change `tender-stage-auto-advance`；新增测试两个已注册（纯逻辑与接线 34 项、隔离库 48 项）；开 PR 前经独立审查并修复其发现；35 处变异全部被测试发现；报告 `docs/QINGYAN_FLOW-H1c_REPORT.md` | [G]（PR 待审；开关默认关，生产未启用） |
| FIX-4 | 三处旧的组织行锁换成不与外键检查互斥的那一种：斑马帘比例接口、质保设置接口、能力配额策略的新建与修改（四条 `FOR UPDATE`）改为调用 FIX-3 已有的 `lockOrganizationRow`（`FOR NO KEY UPDATE`）。效果：这三处保存不再被没提交的「往本组织插入一条记录」卡住（实测 920 毫秒 → 约 40 毫秒），也不再卡住它们；写入方之间照样串行、互不覆盖。守卫：`src/`、`scripts/`、`prisma/`、`deploy/` 下不得再有对组织行取 `FOR UPDATE` 的语句，入口语句钉住原文。写什么、谁能写、审计记什么都不变；零 schema；**没有开关，合并即生效**。交接文档里「会引出死锁」的说法对这三处不成立（独立审查在旧代码上试了 98 轮没有造出），已照实改写。 | FIX-3 | OpenSpec change `org-row-lock-no-key-update`；新增隔离库测试一个已注册（14 项，CI 里跳过），守卫测试补到 32 项；开 PR 前经独立审查并修复其发现；29 处变异全部被测试发现；报告 `docs/QINGYAN_FIX-4_REPORT.md`（含一条与本次无关的发现：Sunny 工艺单的隔离库测试在 main 上本来就失败） | [x]（#444，2026-11-12 合并；archive `2026-11-12-org-row-lock-no-key-update`；没有开关，已随合并生效） |
| FIX-5 | 并发建审批草稿时复用已有的那张：同一企业、同一幂等键的两个建卡请求同时到达时，后到的那个撞上唯一约束，Postgres 中止整个事务，`pending-actions/drafts.ts` 里「复用已有行」的查询必然报 `25P02`，调用方收到「创建待确认草稿失败」（本机实测并发 10 轮 9–10 轮一边失败；一批里一张撞键整批回滚）。带键的插入改为「遇唯一冲突什么都不做」再在同一事务里读回先到者的行并复用，事务显式 READ COMMITTED；建好之后的步骤失败时只补偿本批新建的卡，不再把复用的、别人建的那张标成失败；运行时架构守卫认得 `createManyAndReturn` / `updateManyAndReturn` 也是写审批存储。不带键的照旧；复用时照旧写审计、推 Muse；零 schema；**没有开关，合并即生效** | VIS-1d 报告 §9 | OpenSpec change `draft-idempotent-race-reuse`；新增测试两个已注册（纯函数 21 项、隔离库 10 项，CI 里隔离库跳过）；同一份隔离库测试在旧代码上 6 项失败；经建草稿路径的 12 个既有隔离库测试与 main 逐个相同，`followup-auto-db` 的 `25P02` 日志消失；开 PR 前经独立审查并修复其发现；报告 `docs/QINGYAN_FIX-5_REPORT.md` | [G]（PR 待审） |

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
3. Phase 1 入站邮件走 **Gmail history 游标轮询**：复用 cron `tender-rfq-inbound`（每 10 分钟），按 threadId 认领回信，游标存 `Organization.settingsJson.tenderRfq.inbound`；不用 Pub/Sub watch，不新增队列（P1-4，#234）。
4. `museUserRef` = **Muse 用户 id**。
5. ApiToken 种子：待定（P0-10）。
6. 决定 A（2026-10-23，#237）：Muse 通道不出的只有毛利率、项目估值、我方最终报价；所选供应商的落地价可以出。`price_scenario` 不把目标毛利传进情景计算，成本线就是落地价本身。
7. 邮箱分离（2026-10-23，#238）：显示发件人 `fromEmail`（project@）与授权邮箱 `mailboxEmail`（lucas@）是两个设置；授权账号只从组织设置读取，永不取自请求 payload。
8. 询价 / 催单正文按 text/plain 发出（2026-10-23，#240），换行原样保留；其它调用方仍默认 text/html。
9. **决定 B**（2026-10-27，S1）：销售意图只对管理角色（平台 admin / super_admin / boss / manager，或组织 org_owner / org_admin）输出商机金额（`SalesOpportunity.estimatedValue`）；销售角色的响应不带金额。招投标的决定 A 不变。
10. 协作通知（2026-11-04，任务书 §9 D1–D6）：
    - 试点小组：订单跟单 / 安装排期组。
    - 订单评论区本期不做，试点后看需求。
    - 邮件默认：没有明确选过的人按开，个人可关。
    - 微信入口隐藏：开关默认关，不改名，代码保留（COLLAB-1）。
    - 纪律第 2 条按任务书 §5.4 补澄清：发给本组织 active 成员本人青砚账号邮箱的系统通知邮件不算对外发送；发给客户或组织外地址的仍须先建 PendingAction。
    - 青砚不做个人助理 / 插件 / Connector 对接，Muse--Bridge-bot 的 Connector 永久冻结。
11. COLLAB-2 审核（Evan，2026-11-04）：
    - `collab-notify` 四件套按原样批准实施。
    - 手工验收放在 qingyan-staging 上做；本地 `.env` 直连生产库，不在本地跑。
12. 对外询价可以自批（W-1，用户 2026-11-07 拍板）：Web 建的 `tender.send_rfq` 审批卡不指定审批人，按审批中心现有规则（`canDecidePending`）创建人本人可以批准自己发起的对外询价，与 Muse 路径一致；纪律第 2 条「出站先审批」仍成立（必须经审批卡），不加「对外邮件不能自批」。
13. **决定 C**（2026-11-05，PROC-1，Lucas 批准）：硬纪律第 1 条例外——迁移 `20261105120000_add_procurement_records_foundation` 只新增 16 张 `Procurement*` / `Records*` 表；第 3 条例外——`ProcurementScanRun` 的单行认领（runnerToken + 心跳）只服务 `tender-watch` 里的采购扫描步骤，三个命中 R1 命名模式的表已逐条登记 baseline。两条例外都只限 PROC-1，已写进 `openspec/config.yaml`；合并仍由 Evan 拍板，生产迁移走 Owner Gate（`docs/QINGYAN_PROC-1_RELEASE_RUNBOOK.md`）。
