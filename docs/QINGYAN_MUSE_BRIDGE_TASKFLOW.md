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

**GATE-1 联调前置（运维）**
- 授权邮箱 `mailboxEmail`（lucas@sunnyshutter.ca）的拥有者登录青砚 → 设置 → 连接 Gmail，授权须同时含 gmail.compose（发信）与 gmail.readonly（读回信）；`EmailProvider` 只按组织设置里的 `mailboxEmail` 查找（邮箱分离，#238）。
- 在 lucas@ 的 Gmail 里把 `project@sunnyshutter.ca` 设为「以此地址发送」并完成验证；否则供应商看到的发件人会被 Gmail 改写成 lucas@。
- org_admin 调 `PUT /api/organizations/<orgId>/tender-rfq-settings`，body：`{"fromName":"Qyan-Sunny Purchasing","fromEmail":"project@sunnyshutter.ca","mailboxEmail":"lucas@sunnyshutter.ca"}`；staging 与生产各配一次。
- `MUSE_BRIDGE_INTENTS=status,ask,approve,reject,next_step,preferences,set_preference,rfq,compare,price_scenario,chase`（显式配置不会并入默认集，须写全 11 个），改完重新部署。
- 非生产环境 `sendGmail` 受 `assertSideEffectOrThrow("email")` 保护：staging 须打开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD=1` 与 `QINGYAN_ALLOW_CRON_NON_PROD=1`，并用自己的测试供应商邮箱验证。
- `staging` 分支已于 2026-10-27 快进同步到 main（含 #232–#240、#258）。

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
| P3-4 | 个人级偏好记忆：常用供应商、默认 Incoterm、催单节奏（存 `Organization.settingsJson.museBridge.userPrefs`，零 schema） | P1-7 | `rfq` 不带 supplierIds 时默认取偏好 | [x]（随 P1-8 交付，#236） |

---

## Phase S — Sales Pilot（管理者 Muse ↔ 销售协作闭环）

上位文档：`LucasJ880/Muse--Bridge-bot` 的 `docs/prd/sales-pilot-prd.md`。纪律同上：零 schema、不加队列、对外动作一律审批；询问 = `Task`，跟进 = `SalesAction`，事件走 `Notification(category=muse_bridge)`。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| S1 | 只读销售意图 `sales_overview` / `opportunity_status`：服务端读范围（管理全组织 / 销售仅本人）、可解释确定性排序、决定 B 金额可见性 | P0 | OpenSpec change `muse-sales-read-intents`；`sales-pure` + `sales-db.isolated` 测试；报告 `docs/QINGYAN_S1_REPORT.md` | [x]（#262；已归档） |
| S2 | 跨助理询问 `ask_colleague` / `reply_inquiry`：询问 Task + 通知 + `inquiry.*` 事件；网页回复页 `/sales/inquiries/[id]` | S1 | OpenSpec change `muse-sales-inquiry-loop`；`inquiry-pure` + `inquiry-db.isolated` 测试；报告 `docs/QINGYAN_S2_REPORT.md` | [x]（#275；已归档） |
| S3 | 跟进引擎 `create_followup` / `update_followup`：SalesAction（source=muse_followup）+ 挂既有 `sales-actions` cron 的到期提醒 / 逾期升级 + 商机协作追踪 + 证据导出脚本 | S2 | OpenSpec change `muse-sales-followup-loop`；`followup-pure` + `followup-db.isolated` 测试；报告 `docs/QINGYAN_S3_REPORT.md`；staging 10 步验收随 G3 | [x]（#278；已归档；staging 10 步验收随 G3） |
| S4 | Pilot 上线：对 1 个组织开开关、绑定 2 个用户、签发 Connector Token、真实 10 步验收 | S3 | 一条真实商机经私人助理推进到下一步并可追踪 | [ ] |

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
| PRICE-2 | Order Form 无绳显式开关（Q4 = A）+ 无绳独立折扣 30% + 最低价 159 / 129 + 取消 75" 上限；布帘 / 纱帘褶皱率（Fullness 180 / 230 → 1.8 / 2.3，其它入口按 2） | PRICE-1、Q3、Q4 | change `pricelist-2026-10-cordless-fullness`；黄金 `cordless-*` / `fullness-*` 组全过；报告 `docs/QINGYAN_PRICE-2_REPORT.md` | [G]（PR #354） |
| PRICE-3 | 附加项目目录按零售表更新 + Excel 固定价 / 按英尺项进 Part B 预设 + Downtown 150 预设 + 企业覆盖价（settingsJson，走审批） | PRICE-1、Q6、Q7、Q8 | change `pricelist-2026-10-addons`；报告 `docs/QINGYAN_PRICE-3_REPORT.md` | [ ] |
| STAT-1 | 期间面板"本周 / 上周"预设 + 按人行展开报价清单（`GET /api/sales/period-summary/quotes`）+ `/sales/quotes` 按销售筛选 + 草稿未发送提醒；口径不改 | KPI-1、Q9、Q10 | change `sales-quote-stats-drilldown`；`period-db.isolated` 扩；报告 `docs/QINGYAN_STAT-1_REPORT.md` | [x]（#355；已归档） |

**GATE-P 验收**：Order Form 录 Fauxwood / Allusion / 无绳 Zebra / 3 倍褶皱布帘各一行 → 预览金额与黄金用例一致 → 保存并标记发送 → 期间面板按人金额 = 该报价 `grandTotal`，展开能看到这张报价；9 个老产品的 `regression` 组数字不动。

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
