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
| W-2 | RFQ 设置页：fromName / fromEmail / mailboxEmail / 回复提前量 / 轮次锁 / 催单天数 / 落地成本 FX（现只有 `PUT /api/organizations/[orgId]/tender-rfq-settings`） | W-1 | 页面保存 = 现有 PUT 的效果；非 org_admin 不可见 | [x]（#487，2026-11-15 合并；archive `2026-11-15-tender-rfq-settings-page`；组织页「询价与落地价设置」：发件三项、汇率连同日期与来源、运费 / 保险 / 清关、项目关税率与交付截止；只发改过的项；接口 GET 多返回 `stored`、删除项目设置不校验归属；报告 `docs/QINGYAN_W-2_REPORT.md`。回复提前量 / 轮次锁 / 催单天数现有接口不收，另列 W-2b） |
| W-2b | RFQ 设置页补上回复提前量 / 轮次锁天数 / 催单天数：先扩 `PUT tender-rfq-settings`（现在只读、有默认值），再加到组织页那一节 | W-2 | 页面保存 = PUT 的效果；默认值不变；非 org_admin 不可见 | [x]（#492，2026-11-16 合并；archive `2026-11-16-rfq-timing-settings`；`PUT tender-rfq-settings` 收 replyLeadDays / roundLockDays / chaseAfterDays（1–60 整数，null 回默认），GET 多返回生效值、默认值、stored；组织页「询价节奏」三项；Muse 查看偏好写出组织催单天数；报告 `docs/QINGYAN_W-2b_REPORT.md`） |
| W-3 | 比价矩阵所选供应商落地价接进定价助手成本线（Web 化 `projectScenariosForMuse`，决定 A 不变） | W-1 | 定价助手出现「来自比价矩阵」成本来源；手填可覆盖 | [x]（由 FLOW-H2 实现，#476） |

---

## Phase T — 询价追踪（谁回了、谁没回、该催谁）

任务书：`docs/QINGYAN_T-1_T-2_RFQ_TRACKING_TASKBRIEF.md`（Evan 2026-11-07 拍板 §8：「催单待批」15 分钟未读发升级邮件；`batch-followup` 直接下线；追踪页显示价格）。纪律同上：零 schema、出站一律审批、不新增 cron / 队列、零新增 LLM 调用；通知、升级邮件与汇总不出金额。目标：替掉「盯 Grok Bot 追踪」这一步。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| T-1 | 询价进展站内通知：报价了 / 回信无报价 / 催单待批（一轮一次扫描一条；15 分钟未读发升级邮件）/ 未响应；收件人为项目负责人 ∪ 本轮发起人（催单待批只给负责人）；点开到该轮（`?tab=bid#rfq-round-<id>`），催单 / 追问卡在轮次里原地批准；两条入站提醒归入询价类别 | W-1 | 任务书 §2.6：带价回信后负责人铃铛出现「报价了」并展开到该轮；定时检查起草催单 → 一条「等你批准」，点开就是审批面板；30 分钟未读收到【青砚】升级邮件；通知与邮件无金额 | [x]（#391；archive `2026-11-08-rfq-tracking-notify`） |
| T-2 | 询价追踪页 `/bids/rfq` + `/bids` 汇总卡（需要我处理 / 等回复 / 已报价 / 未响应；下次自动催的日期与 `decideChases` 一致；落地价取比价矩阵）；首页「供应商未回复」改查 `sent`；`batch-followup` → 410 | T-1 | 任务书 §3.5 | [x]（#491，2026-11-15 合并；archive `2026-11-15-rfq-tracker`；`/bids/rfq` + `/bids` 汇总卡、`GET /api/org/tender-rfq/tracker`、`POST …/tender-rfq/chase`、首页建议改口径、batch-followup 410；价格按项目读权限可见；报告 `docs/QINGYAN_T-2_REPORT.md`） |

---

## Phase 2 — 标讯雷达

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| P2-0 | 结果表单补「中标方（选填）」：未中标时人工填写 → 结果备注 + 人工确认授标事实（幂等 `tender-result-winner:{projectId}`，换名不覆盖）；授标情报投影把我方排除出「竞争对手」域（`ownAwardCount`）。来源 `QINGYAN_TENDER_INTEL_SLOTS_P1P2_REPORT.md` §5 遗留两条 | — | 未中标填中标方 → 竞争对手域出现该对手、不出现我方；同名再标记幂等；授标情报关闭时只写备注（`docs/QINGYAN_P2-0_REPORT.md`） | [x]（#384；archive `2026-11-06-tender-outcome-winner`） |
| P2-0b | 情报中枢「竞争对手」「采购机构」两页接真实数据（授标事实 + 我方项目，只读 `GET /api/org/tender-intel-profiles`，项目经可见性过滤）；「周期采购」入口收起（页面保留） | P2-0 | 两页显示对手 / 机构画像、我方排除或标出；开关关闭时降级；导航无「周期采购」（`docs/QINGYAN_P2-0b_REPORT.md`） | [x]（#385；archive `2026-11-06-tender-intel-org-profiles`） |
| P2-0c | 授标去重：同中标方 + 同买家、两条都有招标编号且不同 → 另一次招标（ACTIVE），不再判疑似重复；编号缺失或只差写法仍留人工 | — | 我方 / 对手在同一机构再次中标不落 NEEDS_REVIEW；买家周期用上全部样本（`docs/QINGYAN_P2-0c_REPORT.md`） | [x]（#386；archive `2026-11-06-award-dedupe-solicitation`） |
| P2-0d | 授标记录人工处理（仅组织管理员）：「历史中标」页确认线索 / 疑似重复、撤回错误记录（原因必填、留痕、同事务审计）；撤回后重新标记结果可更正中标方 | P2-0, P2-0c | 非管理员无按钮且接口 403；确认 / 撤回留审计；撤回后更正写新记录、重放幂等（`docs/QINGYAN_P2-0d_REPORT.md`） | [x]（#387；archive `2026-11-09-award-record-review`） |
| P2-1 | CanadaBuys tender notices 开放数据每日拉取（CKAN / CSV，只读；复用 `tender-intel` 的"候选→人工确认"契约） | P0 | 拉取幂等；不触碰任何登录页 | [x]（拉取由 PROC-1 交付（#382）；#502 2026-11-16 合并，archive `2026-11-16-tender-notice-daily-view` 补页面上改扫描时间（每天 / 工作日 / 默认）与候选页「新标」视图、发布日期、看公告；报告 `docs/QINGYAN_P2-1_REPORT.md`） |
| P2-2 | 匹配打分：`tenderProfile` + bid-fit + buyer memory → 预评分 | P2-1 | 对历史 10 个已投标，Top-5 召回 ≥ 4（当天公告快照只从 PROC-1 上线 2026-11-09 起才有，改为召回脚本 ≥ 8/10 达阈值，待 Lucas 给名单） | [~]（代码 #514 已于 2026-11-16 合并；archive `2026-11-16-tender-notice-fit-score`；规格 `procurement/notice-fit-score`；报告 `docs/QINGYAN_P2-2_REPORT.md`；**验收（召回 ≥ 8/10）待 Lucas 给 10 个历史投标项目 id**，跑 `scripts/p22-fit-recall.ts`） |
| P2-3 | `brief.daily` 事件 + `follow_tender` 意图：命中 → 建 `Project(workDomain=tender)` → 拉文件包 → 幂等 enqueue | P2-2, P0-7 | Muse 早报点「跟这个标」→ 中午收到 `analysis.ready` | [~]（Muse 已冻结，改 Web 版：建项 = P2-3a（#496）、早报 = P2-3b（#511）已交付；拉文件包 = P2-3c 未做（先确认 CanadaBuys 哪些附件公开可下）；`brief.daily` 只在 `MUSE_BRIDGE_ENABLED` 时发，现不发） |
| P2-3a | 采购监控「跟这个标」：招标公告 → 建 `Project(workDomain=tender)` + 关联（本项目）+ 关注，同一组织同一公告只建一次（Web 版，Muse 已冻结） | P2-1（PROC-1 新标拉取） | 点一次建一个项目、字段预填、再点 / 并发不重复；只读成员看不到 | [x]（#496，2026-11-16 合并；archive `2026-11-16-tender-notice-follow`；`POST /api/procurement/instruments/{id}/follow`；报告 `docs/QINGYAN_P2-3a_REPORT.md`） |
| P2-3b | 早上 7 点「今日新标」通知：已启用采购监控的组织，前一天当地 07:00 到当天 07:00 首次发现、未截标的招标公告，发给监控开启人与创建人，点开落在新标视图（Web 版，Muse 已冻结） | P2-1（新标视图） | 有新标时每天一条、同日不重复、没有新标不发；点通知进新标视图 | [x]（#511，2026-11-16 合并；archive `2026-11-16-tender-notice-brief`；规格 `procurement/notice-brief`；报告 `docs/QINGYAN_P2-3b_REPORT.md`） |
| P2-4 | `watch.ts` 升级为结构化 diff → 触发 `addendum-diff.ts` → `addendum.detected` | P0-5 | 变更≠Addenda 时文案仍诚实 | [ ] |
| P2-1b | CanadaBuys 截标时间按东部当地时间解析（CSV 不带时区；原按服务器时区 UTC 解析，早 4–5 小时） | P2-1 | 截标时间与公告页一致；已入库的下次扫描改正；与进程时区无关 | [x]（#508，2026-11-16 合并；archive `2026-11-16-canadabuys-closing-tz`；规格并入 `procurement/watch-scan`；报告 `docs/QINGYAN_P2-1b_REPORT.md`；夏令时口径 2027-03-14（夏令时开始）前核对一次） |

**GATE-2 验收**：一周内至少 1 条真实新标通过 Muse 早报 → 一键跟进 → 分析完成，全程无人工建项。
（Muse 冻结后改为 Web：一周内至少 1 条真实新标经站内「今日新标」→ 采购监控「跟这个标」建项 → 上传文件包后分析完成；建项不需要人工填项目信息。见 `docs/QINGYAN_H7_INVESTIGATION.md` §5 第 2 问。）

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
| FLOW-H3 | 询价发出之后招标分析更新过，在那一轮上标出来（方案 H3 按只读调查改写：生产上没有增量分析、询价轮次不记所用要求，原写法的前提不成立）：询价引擎发出的每一轮，询价单取要求用的那一份分析（最新创建的可用分析）在这一轮的发送卡创建（正文定下）之后才完成或才批准时，询价区在那一轮的状态行下显示一句提示——起草日期、分析更新日期、引用的要求可能已经变了、请核对、需要时另发一轮；更新之后已经又起草过一轮的不再提示。只按时间判断，不说具体哪条变了，不做任何对外动作。开关 `TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED`（可配组织名单），默认关。零 schema、零模型调用 | FLOW-H1c | OpenSpec change `tender-rfq-round-analysis-update-note`；新增测试两个已注册（纯逻辑、接线与状态行呈现 21 项，隔离库 15 项，后者在 main 上失败）；开 PR 前经独立审查并修复其发现；审查后 12 处变异全部被测试发现；真实浏览器截图 `docs/acceptance/flow-h3/`；报告 `docs/QINGYAN_FLOW-H3_REPORT.md` | [x]（#464，2026-11-15 合并；archive `2026-11-15-tender-rfq-round-analysis-update-note`；开关默认关，生产未启用） |
| FLOW-H2 | 比价矩阵里人工选定的那一家的落地价，作为报价表助手的成本来源（W-3；四件套先经 Lucas 审，Q1–Q5 都按推荐）：卡片多一行「来自比价矩阵」——最近一轮有选定的询价里那一家的落地价（CAD），供应商、轮次、数量口径、逐项（货值 / 内陆 / 海运 / 保险 / 关税 / 清关）、换算依据，写明不含 GST/HST（DDP 以供应商报价为准）；按钮只把数字填进「我方成本」，人保存才生效，手填可覆盖；保存时服务端按鉴权的项目与组织重新换算核对，到分相同才记来源，否则记手填；矩阵变了只提示；「毛利率（按售价）」旁显示等价的成本加成。比价矩阵结论与 Muse 比价理由里「含税」更正为「含关税，不含 GST/HST；DDP 以供应商报价为准」。开关 `TENDER_PRICING_COMPARE_SOURCE_ENABLED`（可配组织名单），默认关。零 schema、零模型调用 | W-1 | OpenSpec change `tender-pricing-compare-cost-source`；新增测试两个已注册（纯逻辑、接线与呈现 83 项，隔离库 42 项，后者在 main 上失败）；开 PR 前经独立审查并修复其发现；变异核对（审查 42 处 + 自己 38 处）真实存活的都已补测试；真实浏览器截图 `docs/acceptance/flow-h2/`；报告 `docs/QINGYAN_FLOW-H2_REPORT.md` | [x]（#476，2026-11-15 合并；archive `2026-11-15-tender-pricing-compare-cost-source`；开关默认关，生产未启用） |
| RFQ-AUTO-4 | 招标要求审核的批量确认：要求列表上每条待确认的要求一个勾选框，「全选待确认的」「确认选中的 N 条」（默认不选；没有一键全部确认，没有批量驳回）；用既有接口，超过 200 条前端分批；列表上方计数；「批准分析」旁在还有待确认的要求时提示后果；批量确认留审计；分析已不是等待审核时面板的批量确认被接口拒绝（可选参数，条件写在同一条更新语句里）。不加功能开关 | RFQ-AUTO-2 | OpenSpec change `requirement-review-batch-confirm`；新增测试 54 项 + 隔离库经真实路由 17 项已注册；开 PR 前经独立审查并修复 6 处；截图 3 张 `docs/acceptance/rfq-auto-4/`；报告 `docs/QINGYAN_RFQ-AUTO-4_REPORT.md` | [x]（#429，2026-11-11 合并；archive `2026-11-11-requirement-review-batch-confirm`） |
| RFQ-AUTO-5 | 供应商分组：每人自己的几组供应商（名字 / 1–8 家 / 关键词，最多 10 组），按项目名称做确定性的文字比对选组，恰好一组对上才用，对不上不猜；询价抽屉按分组预选并可管理分组（存为新分组 / 用当前勾选覆盖 / 改名与关键词 / 删除）；自动起草有分组时只认分组，对不上不起草、不退回常用供应商，摘要 / 结果 / 审计写明分组与关键词；分组存成本人的只追加记录（不进组织设置），保存带版本、不互相覆盖；分组信息不出站。开关 `TENDER_RFQ_SUPPLIER_GROUPS_ENABLED` 默认关；关闭或没有分组时行为不变。零 schema、零模型调用；不改 Muse、审批、发送、催单 | RFQ-AUTO-2 | OpenSpec change `rfq-supplier-groups`；新增测试两个已注册（纯逻辑与接线 103 项、隔离库 52 项），`auto-draft-pure` 47 → 63；开 PR 前经独立审查并修复其发现（保存的先后不依赖时钟、无效字符在入口拒绝、读不出来的记录不当成没有分组等）；截图 4 张 `docs/acceptance/rfq-auto-5/`；报告 `docs/QINGYAN_RFQ-AUTO-5_REPORT.md` | [x]（#431，2026-11-11 合并；archive `2026-11-11-rfq-supplier-groups`） |
| FLOW-H4c | 提交记录接进可投标判定：投标工作区的可投标判定从来没拿到过提交记录，截标一过就报「已过截标」、判为不可投标——交完标、记了回执的项目也一样。现在带上与项目当前提交时间对得上的那条记录（FLOW-H4a 写下的）：有回执编号的判定为「**已交标（仅供复盘）**」（新增的第三种判定，面板上中性色，不再可能出现绿色的「可提交 Owner 决定」）；有提交时间、没有回执编号的仍报「已过截标」（只有带回执的才算已提交，TI-1 不变），提交记录开着时写明去「提交记录」里补，没开时只说缺回执编号。给判定的取数在只读文件 `tender-submission/read.ts`；截标之前不查。不新增开关（只在投标工作区里可见，沿用 `TENDER_BID_WORKSPACE_ENABLED`，默认关）。零 schema、零模型调用 | FLOW-H4a | OpenSpec change `tender-readiness-submission-record`（含 `tender/bid-readiness` 的 MODIFIED）；新增隔离库测试一个已注册（24 项，在 main 上失败 10 项），readiness 补到 31 项、submission-record 补到 81 项；开 PR 前经独立审查并修复其发现；审查后 20 处变异 3 处等价、其余全部被测试发现；报告 `docs/QINGYAN_FLOW-H4c_REPORT.md` | [x]（#459，2026-11-15 合并；archive `2026-11-15-tender-readiness-submission-record`；没有新开关，随投标工作区的开关，生产未启用） |
| FIX-3 | 组织设置的写入不再互相覆盖：`Organization.settingsJson` 被 11 处不加锁的「整块读、整块写」共用，并发时后写的会冲掉先写的（旧代码上七种写入同时发起，第一轮就丢五项）。新增统一入口——锁行、读最新、只改自己那一块、写回——并把全部写入方接上去：收信游标、Muse 偏好 / 绑定 / set_preference、询价设置、投标资料、运营手册执行模式、日历监听，以及门店折扣与开户向导（在既有事务里补锁行）。每一处写什么不变；零 schema；新增守卫测试拦住以后绕开的写入 | RFQ-AUTO-3 的独立审查 | OpenSpec change `org-settings-locked-write`；新增测试两个已注册（隔离库 22 项、守卫 13 项）；同一份隔离库测试在旧代码上 8 项失败；涉及模块的 12 个既有隔离库测试不改断言全部通过；报告 `docs/QINGYAN_FIX-3_REPORT.md` | [x]（#436，2026-11-11 合并；archive `2026-11-11-org-settings-locked-write`） |
| FLOW-H4b | 交付前检查清单由已确认的要求确定性生成：「提交」页签上原来的「投标准备清单」是模型生成的，不看招标要求、每一项的完成情况也是模型猜的。改成从当前可用的那份招标分析里**已确认的、强制的、提交类的要求**逐条生成，每条带编号、中文与原文、出处页码；另列还没确认的、当前判为不满足的强制要求（废标风险）、截标与提问截止时间、招标文件写明的提交方式 / 保证金 / 保险（没找到的写明「没有找到，请自行核对」）。人逐条标「备好了 / 不适用 / 待办」，存进这条要求已有的交付物行，留审计；系统不自己打勾。清单可用时模型清单的接口不再调模型、自动触发器不再为它发请求。**只用逐条带依据的分析（V2）**：没有分析或是旧的分析时一切照旧。开关 `TENDER_SUBMISSION_CHECKLIST_ENABLED`（可配组织名单），默认关。零 schema、零模型调用 | FLOW-H4a | OpenSpec change `tender-submission-checklist`；新增测试三个已注册（纯逻辑与接线 54 项、卡片渲染 32 项、隔离库 47 项，后者在审查修复前的代码上失败 10 项）；开 PR 前经独立审查并修复其发现（含「V2 没开时清单总是空的、还说没有提交类要求」）；审查后 43 处变异 1 处等价、其余全部被测试发现；真实浏览器截图 `docs/acceptance/flow-h4b/`；报告 `docs/QINGYAN_FLOW-H4b_REPORT.md` | [x]（#454，2026-11-15 合并；archive `2026-11-15-tender-submission-checklist`；开关默认关，生产未启用） |
| FIX-2 | 招标分析保留数量与单位，价格表可以从分析带入：V2 分析入库时原来把要求的数量、单位与数量类事实丢掉了，现在存进该次分析「价格与评标」一节已有的结构化字段；投标工作区「粘贴导入」里加「从招标分析带入」，把确定性规则生成的行填进粘贴框并列出各行的出处，**不保存**（人核对后仍点原来的保存）。数量只在整段文字就是一个数字时才取（范围、金额、倍数、编号、按期间计的用量、有歧义的写法一概不取并写明原因）；招标文件与补遗说法不一致的不带入；质保、样品等类别不收；重复的行不合并只标明。只读接口 `GET …/bid-workspace/schedule-candidates`。零 schema、零模型调用、无新开关（沿用 `TENDER_BID_WORKSPACE_ENABLED`） | TI-4b | OpenSpec change `analysis-quantity-unit-prefill`；新增测试两个已注册（纯逻辑与接线 106 项、隔离库 40 项）；开 PR 前经独立审查并修复其发现（第一版的数量规则会悄悄取错、说法不一致的被带入、测试看不住「不保存」）；30 处变异核对全部被发现；截图 3 张 `docs/acceptance/fix-2/`；报告 `docs/QINGYAN_FIX-2_REPORT.md` | [x]（#437，2026-11-11 合并；archive `2026-11-11-analysis-quantity-unit-prefill`） |
| FLOW-H5 | 两道闸生效（只提醒，不拦；方案 §9 第 6 条）：投标决定是不投（No-Go，以情报室上的决定为准）时，询价入口多一条不阻断的提醒（写明哪天定的，按组织时区），「下一步」卡片指向询价时带上，投标文件起草卡片与「标书与报价」生成菜单里的起草项显示同类提醒；投标文件起草所用的分析还没批准时，起草前提示「起草会基于未确认的要求」，起草时同一次取数记下所用分析与是否已批准，草稿里加「BASED ON UNCONFIRMED REQUIREMENTS」横幅、卡片写明。起草提示词不变；起草那一段从 generate-docs 原样移到 `tender-bid-draft/generate.ts`（合成可注入，测试用假的合成）。开关 `TENDER_DECISION_GATES_ENABLED`（可配组织名单），默认关。零 schema | FLOW-H4b | OpenSpec change `tender-decision-gates`；新增测试两个已注册（纯逻辑、草稿横幅、卡片呈现与接线 27 项，隔离库 21 项，后者在 main 上失败）；开 PR 前经独立审查并修复其发现（含「下一步」卡片与生成菜单两处漏掉的入口）；审查后 12 处变异全部被测试发现；真实浏览器截图 `docs/acceptance/flow-h5/`；报告 `docs/QINGYAN_FLOW-H5_REPORT.md` | [x]（#468，2026-11-15 合并；archive `2026-11-15-tender-decision-gates`；开关默认关，生产未启用） |
| FIX-6 | 阶段已到、招投标状态落后时，人确认推进就补上状态：分析完成、询价发出（与 FLOW-H1c）只写阶段时间，之后人在对话里确认推进只得到「无需重复推进」或「不允许回退」，状态与 BidToGo 回调永远补不上。现在：招投标项目、进行中、阶段记录已在人确认的阶段或更靠后、状态落后时，只把状态补成人确认的那一段对应的值，写讨论区的状态变化与审计，有来源系统时发一次状态回调；不写阶段时间、不碰任务、不发「已推进」通知。零 schema；**没有开关，合并即生效，点确认时会发回调**（Lucas 已定不加开关）。 | FLOW-H1c | OpenSpec change `tender-stage-status-catch-up`；新增测试两个已注册（纯逻辑与接线 17 项、隔离库 32 项，后者在改动前的代码上失败）；开 PR 前经独立审查并修复其发现；审查后 27 处变异 1 处等价、其余全部被测试发现；报告 `docs/QINGYAN_FIX-6_REPORT.md` | [x]（#450，2026-11-15 合并；archive `2026-11-15-tender-stage-status-catch-up`；没有开关，已随合并生效。余项「带了发生时间或预期状态的推进不补状态」#518，2026-11-17 合并；archive `2026-11-17-tender-catch-up-skip-recorded`） |
| FLOW-H1 | 项目页告诉人「现在卡在哪、下一步点哪里」：接口 `GET …/next-step` 与工作台顶部的卡片。判断复用 Muse 的同一张查表（十条规则原样调用，不改它），补上网页才需要的状态（没传文件 / 等确认与批准 / 已批准却没有已确认的要求 / 已回复没录入 / 等回复 / 只有一家报价 / 准备提交 / 已提交 / 已中标 / 截标日期已过），每个结论指到页面上的一个位置（页签 + 页内位置、文件抽屉、审批中心）。截标作为提醒与下一步并存，按天说；等回复的口径与定时催单一致；指向询价入口时读入口自己的状态；不出任何金额。**只读、只指路**：不批准、不发送、不承诺系统会做什么。决策摘要与右侧面板跟着说同一条结论。开关 `TENDER_WEB_NEXT_STEP_ENABLED` 默认关。零 schema、零模型调用，不改 `muse-bridge/**`。不含「用它推导六段进度条、取代三步卡」（另开 change） | FIX-2 | OpenSpec change `tender-web-next-step`；新增测试两个已注册（纯逻辑与接线 141 项、隔离库 69 项）；开 PR 前经独立审查并修复其发现（点击到不了位、空轮次盖住报价、截标与催单的说法不准、15 处变异没被发现等）；41 处变异核对全部被发现；截图 8 张 `docs/acceptance/flow-h1/`；报告 `docs/QINGYAN_FLOW-H1_REPORT.md` | [x]（#439，2026-11-12 合并；archive `2026-11-12-tender-web-next-step`；开关默认关，生产未启用） |
| FLOW-H1b | 项目页的阶段与进度条跟着实际进度显示：「下一步」接口多返回三项（实际进度、同一时刻记录的阶段、显示的阶段）。实际进度由事实确定（有提交时间 / 有供应商报价或投标报价单 / 有已发出的询价 / 有可用的分析）；没结束的项目显示记录的阶段与实际进度里靠后的那个，已结束的项目显示记录的阶段。每个页签上方的决策摘要、右侧项目上下文、项目进度区的当前阶段、六段进度条与完成百分比都用显示的阶段；与记录的阶段不同时在项目进度区写明。有「下一步」卡片时工作台的三步卡不再渲染。**只改显示，不写阶段记录**；沿用开关 `TENDER_WEB_NEXT_STEP_ENABLED`，关闭时页面与原来相同。待定：要不要让阶段记录自动前进（列表、Muse、放弃项目的流程仍按记录的阶段）。 | FLOW-H1 | OpenSpec change `tender-web-progress-from-facts`；新增测试两个已注册（纯逻辑与接线 51 项、项目进度区渲染 14 项），既有隔离库测试补到 100 项；开 PR 前经独立审查并修复其发现；64 处变异全部被测试发现；真实浏览器截图 `docs/acceptance/flow-h1b/`；报告 `docs/QINGYAN_FLOW-H1b_REPORT.md` | [x]（#443，2026-11-12 合并；archive `2026-11-12-tender-web-progress-from-facts`；开关默认关，生产未启用） |
| FLOW-H1c | 阶段记录跟着事实自动前进：分析产出可审核的结果 → 项目解读；询价执行这一次真的发出 / 人工标记已发送 → 供应商询价；没取消的轮次里第一次录入报价（人工或回信解析）→ 供应商报价。只在这一段为空、写上之后阶段记录会变靠后时写；写了就按 FIX-7 关之前阶段的自动任务、建新阶段的，并写一条系统审计 `tender.stage.auto_advance`。不对已放弃 / 已有结果 / 非招投标项目生效；**不改招投标状态、不发 BidToGo 回调、不发讨论区消息与通知**。新开关 `TENDER_STAGE_AUTO_ADVANCE_ENABLED`（默认关），关闭时不加载、不查库。建任务依赖 FIX-7（#447）。待定：人再推进到同一阶段时要不要补状态与回调（「供应商报价」状态以后到不了）。 | FLOW-H1b、FIX-7 | OpenSpec change `tender-stage-auto-advance`；新增测试两个已注册（纯逻辑与接线 34 项、隔离库 48 项）；开 PR 前经独立审查并修复其发现；35 处变异全部被测试发现；报告 `docs/QINGYAN_FLOW-H1c_REPORT.md` | [x]（#449，2026-11-12 合并；archive `2026-11-12-tender-stage-auto-advance`；开关默认关，生产未启用；建任务随 #447 合并已生效） |
| FIX-4 | 三处旧的组织行锁换成不与外键检查互斥的那一种：斑马帘比例接口、质保设置接口、能力配额策略的新建与修改（四条 `FOR UPDATE`）改为调用 FIX-3 已有的 `lockOrganizationRow`（`FOR NO KEY UPDATE`）。效果：这三处保存不再被没提交的「往本组织插入一条记录」卡住（实测 920 毫秒 → 约 40 毫秒），也不再卡住它们；写入方之间照样串行、互不覆盖。守卫：`src/`、`scripts/`、`prisma/`、`deploy/` 下不得再有对组织行取 `FOR UPDATE` 的语句，入口语句钉住原文。写什么、谁能写、审计记什么都不变；零 schema；**没有开关，合并即生效**。交接文档里「会引出死锁」的说法对这三处不成立（独立审查在旧代码上试了 98 轮没有造出），已照实改写。 | FIX-3 | OpenSpec change `org-row-lock-no-key-update`；新增隔离库测试一个已注册（14 项，CI 里跳过），守卫测试补到 32 项；开 PR 前经独立审查并修复其发现；29 处变异全部被测试发现；报告 `docs/QINGYAN_FIX-4_REPORT.md`（含一条与本次无关的发现：Sunny 工艺单的隔离库测试在 main 上本来就失败） | [x]（#444，2026-11-12 合并；archive `2026-11-12-org-row-lock-no-key-update`；没有开关，已随合并生效） |
| FIX-5 | 并发建审批草稿时复用已有的那张：同一企业、同一幂等键的两个建卡请求同时到达时，后到的那个撞上唯一约束，Postgres 中止整个事务，`pending-actions/drafts.ts` 里「复用已有行」的查询必然报 `25P02`，调用方收到「创建待确认草稿失败」（本机实测并发 10 轮 9–10 轮一边失败；一批里一张撞键整批回滚）。带键的插入改为「遇唯一冲突什么都不做」再在同一事务里读回先到者的行并复用，事务显式 READ COMMITTED；建好之后的步骤失败时只补偿本批新建的卡，不再把复用的、别人建的那张标成失败；运行时架构守卫认得 `createManyAndReturn` / `updateManyAndReturn` 也是写审批存储。不带键的照旧；复用时照旧写审计、推 Muse；零 schema；**没有开关，合并即生效** | VIS-1d 报告 §9 | OpenSpec change `draft-idempotent-race-reuse`；新增测试两个已注册（纯函数 21 项、隔离库 10 项，CI 里隔离库跳过）；同一份隔离库测试在旧代码上 6 项失败；经建草稿路径的 12 个既有隔离库测试与 main 逐个相同，`followup-auto-db` 的 `25P02` 日志消失；开 PR 前经独立审查并修复其发现；报告 `docs/QINGYAN_FIX-5_REPORT.md` | [x]（#448，2026-11-12 合并；archive `2026-11-12-draft-idempotent-race-reuse`） |
| FIX-7 | 修好阶段推进之后的自动任务：建任务时不再写任务表没有的 `sortOrder`（原来每次都报错、被吞掉，任务从来没建出来过）。「准备投标文件」「提交投标」从项目提交挪到供应商报价阶段，「提交投标」到期日取截标时间、截标还没到时任何任务都不晚于截标；进入新阶段时关掉之前所有阶段还没完成的自动任务（原来只关上一阶段，阶段时间被询价发出等直接写入后会留下永远逾期的任务）；同一项目加锁查重；已放弃的项目不建，放弃项目时撤掉还没完成的自动任务。零 schema；**没有开关，合并即生效**。 | FLOW-H4a 发现 | OpenSpec change `stage-tasks-create-fix`；新增测试两个已注册（纯逻辑与接线 29 项、隔离库 29 项，后者在改动前的代码上失败）；开 PR 前经独立审查并修复其发现；审查后 31 处变异全部被测试发现；报告 `docs/QINGYAN_FIX-7_REPORT.md` | [x]（#447，2026-11-15 合并；archive `2026-11-15-stage-tasks-create-fix`；没有开关，已随合并生效） |
| FIX-8 | 报价表助手保存不再冲掉报价引擎镜像的我方报价：`POST …/pricing-helper` 的保存原来把 `BidIntelligenceRoom.summaryJson.pricingInputs` 整块换成三项人工输入，报价引擎镜像在同一对象里的 `ourPriceCad` / `ourPrice` / `ourPriceCurrency` / `ourPriceSource` / `ourPriceStatus` / `ourPriceSupersededSource` 每保存一次就丢一次，投标草稿在下一次报价同步前读不到我方报价。现在先展开原对象、只覆盖三项人工输入；返回形状不变。零 schema；**没有开关，合并即生效**。保存与报价同步之间的并发（保存不锁行）不在本次范围 | — | OpenSpec change `pricing-helper-save-keeps-bid-mirror`；报告 `docs/QINGYAN_FIX-8_REPORT.md`；新增隔离库测试一个已注册（17 项，在改动前的代码上 5 项失败） | [x]（#478，2026-11-15 合并；archive `2026-11-15-pricing-helper-save-keeps-bid-mirror`；没有开关，已随合并生效） |
| FIX-9 | 报价表助手的写入与报价同步串行：FIX-8 之后保存仍是不加锁的「读整块 → 改 → 写整块」，报价同步恰好落在读与写之间时，保存把旧报价写回去；「重新推导」在调模型之前读整块、模型返回后原样写回，窗口是一次模型调用。现在保存与推导的写入在一个事务里先拿报价引擎用的同一把项目行锁（导出 `lockProject`），再读最新的 `summaryJson`、只改自己的键、同一事务写回；模型调用留在锁外。请求、返回、校验、权限不变。零 schema；**没有开关，合并即生效**。`summaryJson` 的其它写入方不在本次范围 | FIX-8 | OpenSpec change `pricing-helper-write-lock`；报告 `docs/QINGYAN_FIX-9_REPORT.md`；新增隔离库测试一个已注册（17 项，强制交错；在改动前的代码上 4 项失败，去掉锁调用的变异同样 4 项失败） | [x]（#483，2026-11-15 合并；archive `2026-11-15-pricing-helper-write-lock`；没有开关，已随合并生效） |
| FIX-10 | 分析投影与开始调查不再整块替换调查室 `summaryJson`：每次分析跑完的投影把 `BidIntelligenceRoom.summaryJson` 整块换成这次分析的摘要，**每来一份补遗、每重新分析一次，报价表助手的人工输入、报价引擎镜像的我方报价、投标工作区录好的价格表、跟标都被清空**；开始投标调查在房间已存在、还没有摘要时同样整块换成初始摘要。现在两处经新的写入入口 `src/lib/tender-room/summary-json.ts`（锁项目行 → 重读 → 只改自己的键）写；投影记下自己写了哪些键，下次只去掉其中这次没有的。零 schema；**没有开关，合并即生效**；已经清空的数据不补。其它「读整块 → 展开 → 写回」的写入方在 FIX-11 | FIX-9 | OpenSpec change `room-summary-merge-write`；报告 `docs/QINGYAN_FIX-10_REPORT.md`；新增测试两个已注册（纯函数与接线 16 项；隔离库 15 项，在改动前的代码上 5 项失败） | [x]（#498，2026-11-16 合并；archive `2026-11-16-room-summary-merge-write`；没有开关，已随合并生效） |
| FIX-11 | 调查室 `summaryJson` 的其它写入方改走写入入口，并加守卫：跟标检查（抓取最长 20 秒）、外部情报（检索与分析可能几分钟）、投标草稿、分析备忘、外部情报确认、盯梢设置原来都是「先读整块 → 做别的事 → 展开旧值写回」，会盖掉期间提交的报价与人工输入；抓取期间停掉的盯梢会被写回来；投标工作区锁的是房间行，与报价同步锁的顺序相反，**会死锁**（本机复现 `40P01`）。现在 7 个文件全部经 `patchRoomSummary`（锁项目行 → 重读 → 只改自己的键），依赖旧值的计算在最新值上做；守卫测试拦住新的直接写法。零 schema；**没有开关，合并即生效** | FIX-10 | OpenSpec change `room-summary-writers-lock`；报告 `docs/QINGYAN_FIX-11_REPORT.md`；新增测试两个已注册（守卫 11 项；隔离库 14 项，在 FIX-10 的代码上 7 项失败） | [x]（#504，2026-11-16 合并；archive `2026-11-16-room-summary-writers-lock`；没有开关，已随合并生效） |
| FLOW-H4a | 项目页上能记「已提交」并留回执：接口 `GET` / `POST …/submission-record` 与「提交」页签的「提交记录」。人交完标之后记下实际提交的时间（可以是过去）、方式、回执编号、备注；青砚不代为提交。第一次记录经既有的阶段推进写入提交时间与招投标状态（时间用人填的）；已有提交时间的是更正、只改这一个日期；已有投标结果而没有提交时间的是补记、不改结果；没投的标与已放弃 / 已归档的项目不能记。每次记录追加一条审计行，不覆盖之前的。「下一步」卡片在截标已过、没有提交记录时指到这一块。**会写项目的提交时间；第一次记录不能撤销、会通知成员**。零 schema，不调模型，没有新增出站；新开关 `TENDER_SUBMISSION_RECORD_ENABLED` 默认关。回执文件上传没做（要先给项目文件加类别）。顺带发现 main 上既有的错：阶段推进后「为新阶段建任务」一直失败（任务表没有它要写的列），没有在这里修。 | FLOW-H1 | OpenSpec change `tender-submission-record`；新增测试两个已注册（纯逻辑与接线 78 项、隔离库 62 项）；开 PR 前经独立审查并修复其发现（含一个跨夏令时差一小时的时间换算错误）；51 处变异全部被测试发现；真实浏览器截图 `docs/acceptance/flow-h4a/`；报告 `docs/QINGYAN_FLOW-H4a_REPORT.md` | [x]（#446，2026-11-15 合并；archive `2026-11-15-tender-submission-record`；开关 `TENDER_SUBMISSION_RECORD_ENABLED` 默认关，生产未启用） |

### Phase F（续）— 情报串联

任务书：`docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md`（Evan 2026-11-19 需求：分析完自己往下走——查历史中标、推荐型号、预计价格、反查中标者的供货商、起草带脱敏附件的询价，人只决定发不发）。规则：**查的、算的全自动；对外发的一律人批；查不到的照实说**。实现差距分析 §12 的 TI-5、N5 与 TI-7「寻源到询价的交接」，不重做 TI-1～TI-4c；Gate A 十项拍板继续有效。判断点 1–8 待拍板（2026-11-19 13:05 修订版：新增 CHAIN-0c 与判断点 8，未拍板前按 A）；按任务书「上线顺序」合并：CHAIN-0 → 0c → 4b → 4a → 1 → 2 → 3（4b 因已先完成而先合）。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| CHAIN-0 | 开关核查与提速（运维，不写代码；有 Vercel 生产权限的人做）：续跑自触发（第 1 项生产已配置、已验证，2026-11-19 运行日志 `outcome: 'accepted'`）、并行步骤数、外部情报总门（恰好 `1`）、授标入库、Tavily、供应商情报（只对 Sunny）；三个询价开关等 CHAIN-4b 合并且 FIX-14 部署之后、四条前提都满足再开（① CHAIN-4b staging 真实标包实测已做；② FIX-14（PR #569）已合并且那次生产部署成功；③ FIX-14 报告 §9 第 1–4 步已做；④ FIX-24 已合并部署；三个白名单都只填 Sunny 的组织 id，不能留空，见核查表第 7 行） | — | `docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 逐项「原值 → 新值 → 日期」；150 页以上标包 ≤ 20 分钟、让出到下一次认领 ≤ 15 秒；TBS 24062-27-057 的 `externalIntelStatus.status = "ran"` | [~]（第 1 项已验证；2–7 项待有 Vercel 权限的人填核查表） |
| CHAIN-0c | 分析失败立刻告诉人：招投标 Job 失败 / 卡住（`needs_human`，判断点 8 按 A）时把项目上的分析收尾为「AI 分析未完成」、写明卡在第几步与原因、发既有失败通知；详情页与项目页显示原因与「重新发起分析」。起因：2026-11-19「12-01 21C31-254242」第 3 步失败后项目页 1 小时 40 分钟仍显示「分析中」、没有通知 | — | OpenSpec change `tender-job-failure-surfacing`；报告 `docs/QINGYAN_CHAIN-0c_REPORT.md` | [x]（#524，2026-11-19 合并；archive `2026-11-19-tender-job-failure-surfacing`；主规格 `tender/analysis-failure-surfacing` 8 条；判断点 8 按 A；经独立审查修 6 条；**没有开关，已随合并生效**；生产事件的实际路径待生产记录，见报告 §2） |
| CHAIN-4b | 询价不再带出招标身份：项目专属禁出清单（编号 / 采购方 / 截标日期 / 交货地址 / 项目名称）+ 邮箱与电话格式检查，发给供应商的询价邮件与生成文件命中即整份失败并写明类别；询价标题与称呼改中性询价编号；「供应商询价与符合性确认表」对外抬头 | — | OpenSpec change `rfq-supplier-identity-guard`；任务书「验收 · 泄露」两条；报告 `docs/QINGYAN_CHAIN-4b_REPORT.md` | [x]（#522，2026-11-19 合并；archive `2026-11-19-rfq-supplier-identity-guard`；主规格 `tender/supplier-identity-guard` 14 条、`tender/rfq-web-entry` 改 2 条；**没有开关，已随合并生效**；顺带堵住旧路径把预估金额 / 我方报价 / 中标价印给供应商的口子。**staging 真实标包实测未做**（见报告 §6）——做完之前不开 CHAIN-0 第 7 项） |
| CHAIN-4a | 询价邮件带一份重排的 PDF 附件（只来自已确认的供应商侧要求）；附件字节进审批哈希，执行前重算比对 | CHAIN-4b | OpenSpec change `rfq-supplier-attachment`；报告 `docs/QINGYAN_CHAIN-4a_REPORT.md` | [x]（#526，2026-11-19 合并；archive `2026-11-19-rfq-supplier-attachment`；主规格 `tender/rfq-supplier-attachment` 20 条、`tender/rfq-web-entry` 改 2 条；判断点 5 按 A；**开关 `TENDER_RFQ_ATTACHMENT_ENABLED` 默认关**；与任务书的出入：哈希附件渲染内容、PDF 字节 SHA-256 进审计（报告 §1）；经开工前 1 轮 + 实现后五维度独立审查；staging 测试邮箱收信核对未做——做完前不对 Sunny 打开） |
| CHAIN-4c | 拆短主规格 `tender/rfq-web-entry`「原地审批与待批轮次保护」（522 字，`openspec validate --specs --strict` 143 过 1 不过的唯一原因）：REMOVED 原条，ADDED「询价卡的原地审批与待批轮次保护」（390 字）与「询价单 PDF 对不上时只给驳回」（198 字），规范性语句与场景逐字不变（只补开头两处、加一句指引）。只改规格，不改代码 | CHAIN-4a | OpenSpec change `rfq-web-entry-spec-split`；Lucas 2026-11-20；报告 `docs/QINGYAN_CHAIN-4c_REPORT.md` | [x]（#533，2026-11-23 合并；archive `2026-11-23-rfq-web-entry-spec-split`；主规格 `tender/rfq-web-entry` 要求 13 → 14（REMOVED 1 + ADDED 2），归档后 `openspec validate --specs --strict` 147 / 147；CI 加跑 `--specs --strict` 仍是后续） |
| CHAIN-1 | Alberta 授标（APC 匿名公告）进同一条外部情报自动流；design 第一步核查匿名可读与使用条款，遇登录 / 人机验证即停 | CHAIN-0 第 3–5 项 | OpenSpec change `tender-award-source-apc`；报告 `docs/QINGYAN_CHAIN-1_REPORT.md` | [ ]（**前置核查不通过，已停**（2026-11-19）：APC 对匿名访问返回 Cloudflare 人机验证，连 robots.txt 都挡；Alberta 开放数据只有独家采购服务合同，没有竞争性授标。没有建 change、没有改 T4 白名单。记录与建议见 `docs/QINGYAN_CHAIN-1_PRECHECK.md`） |
| CHAIN-1b | Alberta 授标的人工录入：「历史中标」页的「录入 Alberta 授标（APC）」表单与 `POST /api/organizations/{组织}/tender-awards/manual`。来源人工录入（`USER_ENTRY`）、带 APC 公告链接（只认 `https://purchasing.alberta.ca/posting/AB-年份-编号`，只存不开）、信任级待人工复核（`NEEDS_REVIEW`），不会落为 `SYSTEM_VERIFIED`；组织管理员用既有确认 / 撤回复核；重录不重复、撤回后可重录；审计；系统不访问 APC。零 schema，不调模型，没有新增出站 | CHAIN-1 前置核查 | OpenSpec change `award-manual-entry-alberta`；Lucas 2026-11-20；报告 `docs/QINGYAN_CHAIN-1b_REPORT.md` | [x]（#536，2026-11-23 合并（`51865685`）；archive `2026-11-23-award-manual-entry-alberta`；主规格 `tender/award-manual-entry` 13 条（新）、`tender/award-records` 改 1 条加 2 条；跟随授标情报开关 `T4_AWARD_INTELLIGENCE_SCHEMA_READY`，开着时已随合并生效（生产上开没开待人确认）；GATE（Lucas 2026-11-20）：按日期金额挂到既有时不跨不同编号、不挂时标为疑似重复由组织管理员确认（Evan 2026-11-22 同意）、链接只认 `/posting/AB-年份-编号`、组织管理员自录自确认不限制；合并前交叉验证发现并修了一条回归（疑似重复被人工确认写入悄悄转正）+ F2–F4，独立复核后补两个测试缺口（报告 §8）；合并后只读查询见报告 §9） |
| CHAIN-2 | 批准分析后自动建供应商情报 run，给出推荐型号（最多 3 个，带强制闸证据）与价格对照卡（三种口径并排、不合并） | CHAIN-0 第 6 项 | OpenSpec change `tender-auto-supplier-run`；报告 `docs/QINGYAN_CHAIN-2_REPORT.md` | [x]（#528，2026-11-20 合并；archive `2026-11-20-tender-auto-supplier-run`；主规格 `tender/auto-supplier-run` 13 条（新）、`tender/rfq-auto-draft` 新增 1 条改 3 条；判断点 1 按 A、4 按 B；**开关 `TENDER_AUTO_SUPPLIER_RUN_ENABLED`、`TENDER_RFQ_INTEL_RECIPIENTS_ENABLED` 默认关**，另需 `SUPPLIER_INTEL_ENABLED`；与任务书的出入：自动建池只用内部来源、推荐只读已完成的评估（报告 §1）；经两轮多维审查（六个子 agent，报告 §5）；生产开关需 Vercel 权限） |
| CHAIN-2b | 报价表助手的我方成本只给有财务查看权的人（与成本核算接口、寻源卡同一判定 `resolveFinancePrivilege(...).canReadAll`）：没有的人读不到已保存的成本与比价矩阵的落地价、情景表不算毛利与成本底价、改不了成本（403 不写库）；项目列表与调查室两个接口的房间 JSON 对所有人去掉我方成本、成本来源与投标策略备忘。零 schema，不调模型，没有新增出站 | CHAIN-2 | OpenSpec change `pricing-helper-finance-gate`；Lucas 2026-11-20；报告 `docs/QINGYAN_CHAIN-2b_REPORT.md` | [x]（#532，2026-11-23 合并（`d9de8490`）；archive `2026-11-23-pricing-helper-finance-gate`；主规格 `tender/pricing-helper`、`tender/pricing-compare-cost-source` 改 7 条、加 5 条；**没有开关，已随合并生效**；合并前四维度审查 + 2026-11-23 交叉验证（13 种身份对照、12 个变异全抓住，见报告 §4 末）；GATE 见报告 §6：投标同事不开组织范围财务权；负责人改成自己另立 CHAIN-2c #539（已合并）、策略备忘转述成本另立 CHAIN-2d #538（已合并）；比价矩阵与「报价与成本」卡的统一在 CHAIN-2e） |
| CHAIN-2c | 限制谁能更换项目负责人（负责人自动有项目财务特权）：换给别人只放行平台超级管理员、持组织范围 `project.finance.manage` 的人、当前负责人与管理者；换给自己只放行平台超级管理员与持组织范围 `project.finance.manage` 的人；新负责人须是本组织在用成员；带条件写入防同时更换（409）；四个入口（项目 PATCH、加成员、改成员身份、执行项目 PATCH）同一口径，被拒整个请求不写；补审计；项目团队卡片按标记给「主负责人」并写明原因。零 schema，不调模型，没有新增出站 | CHAIN-2b | OpenSpec change `project-owner-change-guard`；Lucas 2026-11-20 GATE；报告 `docs/QINGYAN_CHAIN-2c_REPORT.md` | [x]（#539，2026-11-23 合并（`591ffa8a`）；archive `2026-11-23-project-owner-change-guard`；主规格 `projects/owner-change` 9 条（新）；**没有开关，已随合并生效**；GATE（Lucas 2026-11-20）规则不变；合并前开工前 1 轮 + 四维度多维审查 + 交叉验证（406 条角色矩阵、四个并发场景、27 个变异抓 26），隔离库测试补了 5 条用例（25 → 30）；财务特权不看组织成员身份另立「待定」（报告 §7、§8）） |
| CHAIN-2d | 投标策略备忘送进模型前去掉我方成本：报价演算只取对手价，不读我方成本、成本来源、目标毛利与我方报价，没有成本底价情景与毛利；提示词禁止写、估、推成本与毛利（提示词 4、备忘 v3）；旧版备忘在情报页签、工作台摘要、投标文件草稿输入、澄清问题文件先裁剪再用。零 schema，不调新的模型，没有新增出站 | CHAIN-2b | OpenSpec change `strategy-memo-cost-strip`；Lucas 2026-11-20 GATE（#532 第 ③ 条「可以」）；报告 `docs/QINGYAN_CHAIN-2d_REPORT.md` | [x]（#538，2026-11-23 合并（`fc321a7d`）；archive `2026-11-23-strategy-memo-cost-strip`；主规格 `tender/bid-strategy-memo` 4 条（新）；**没有开关，已随合并生效**；合并前挑错交叉验证 + 两轮修订（旧版备忘自由文字段一律整段换掉、编排接线行为测试；独立复核后旧版备忘的 RFI 一律不列入——规则判断漏 30 / 48、误删 18 / 40）、全量 736/746 与基线相同（报告 §8）；后续 FIX-25（反推成本）与已导出澄清文件见下两行） |
| FIX-25 | 项目读者可由「我方报价 + 目标毛利」反推我方成本，要不要对没有财务查看权的人也去掉目标毛利（CHAIN-2d 交叉验证 F4，属 CHAIN-2b #532 范围，**优先**）：调查室读取 `GET /api/projects/:id/bid-intelligence` 的 `room.summaryJson.pricingInputs` 仍带 `targetMarginPct` 与 `ourPriceCad`（`src/lib/tender-pricing/finance-view.ts:114` 只去掉 `ourCostCad` / `ourCostSource`），报价表助手 `GET`（`src/app/api/projects/[id]/pricing-helper/route.ts:97`）也给没有财务查看权的人 `targetMarginPct`，`Project.ourBidPrice` 同样可见。复现：成本 87654.32、目标毛利 23.7、报价 114881.15，只读成员拿到后 114881.15 × (1 − 0.237) = 87654.32；报价正好按报价表助手的「成本 + 目标毛利」底价情景定（`src/lib/tender-pricing/calc.ts:213-214`）时精确反推。与硬纪律第 4 条「Muse 不传目标毛利，避免用两价反推」的思路相反 | CHAIN-2b | OpenSpec change 四件套起草中（分支 `claude/zen-turing-azudvx-fix25`）；排在 FIX-14 之后；报告 `docs/QINGYAN_CHAIN-2d_REPORT.md` §6 | [ ] |
| 待定 | 合并前用旧版备忘导出、已存进项目文件的澄清问题文件不会被重新裁剪（CHAIN-2d 交叉验证 F5，低）：`src/lib/projects/generate/generate-docs.ts:338` `persistGeneratedHtml` 存下的是导出那一刻的 HTML，CHAIN-2d 的裁剪只作用于之后的导出；要不要找出这些文件提示重新导出或清理待定 | CHAIN-2d | 待定；报告 `docs/QINGYAN_CHAIN-2d_REPORT.md` §6 | [ ] |
| CHAIN-3 | 中标者 → 进口线索（人工导入 CSV）→ 供货商候选；系统不抓任何第三方网站 | CHAIN-2 | OpenSpec change `tender-import-leads-connector`；报告 `docs/QINGYAN_CHAIN-3_REPORT.md` | [x]（#530，2026-11-20 合并；archive `2026-11-20-tender-import-leads-connector`；主规格 `tender/import-leads` 22 条（新）；判断点 3 按 A、7 按 A；**开关 `TENDER_IMPORT_LEADS_ENABLED` 默认关**，另需 `T4_AWARD_INTELLIGENCE_SCHEMA_READY` 才有中标者可比；与任务书的出入：新目录 `src/lib/tender-import-leads/`、无关记录不导入、进口线索的供应商不自动进自动起草（报告 §1）；经开工前 1 轮 + 实现后两轮多维审查（共七个子 agent，报告 §5）；别名裁决权限 GATE 已定只限组织管理员并做撤回，由 CHAIN-3c（#534，2026-11-23 合并）落实；生产开关需 Vercel 权限） |
| CHAIN-3b | 投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录：组织开了导入、项目至少有一条未被标为不采用的导入记录（与槽里「已导入 N 条」同一口径）时，「手头材料」多一项进口线索，阶段如实变为「执行」（只处理人工提供的进口线索）；读取结果不含条数与内容；阶段策略表不改，主规格 `tender/stage-policy` 一条的正文措辞与场景、代码对齐；面板清单标题与取决于来源的阶段说明。零 schema，不调模型，没有新增出站 | CHAIN-3 | OpenSpec change `bid-readiness-import-leads`；Lucas 2026-11-20；报告 `docs/QINGYAN_CHAIN-3b_REPORT.md` | [x]（#535，2026-11-23 合并（`595fb896`）；archive `2026-11-23-bid-readiness-import-leads`；主规格 `tender/bid-workspace`、`tender/stage-policy`、`tender/bid-workspace-panel` 各改 1 条；没有新开关（跟随 `TENDER_IMPORT_LEADS_ENABLED`；面板在投标工作区里，`TENDER_BID_WORKSPACE_ENABLED` 生产未开）；合并前四维度审查 + 2026-11-23 交叉验证（面板标题改为「未接通或仅人工的来源」）；后续：「历史授标与采购」从授标记录推导、导入记录全因别名裁决被否决时仍为「执行」的观察） |
| CHAIN-3c | 「是不是同一家」只由组织管理员裁决，并能撤回：其他人 403、看不到按钮并写明请组织管理员处理；撤回写一条审计（指向被撤回的裁决审计行），这一对回到待确认、对本组织所有项目生效；面板新增「已裁决的」一节（裁决人只取本组织现有成员）；写接口返回调用人真实的裁决权限。零 schema，不调模型，没有新增出站 | CHAIN-3 | OpenSpec change `import-leads-alias-admin-revoke`；Lucas 2026-11-20 GATE 决定；报告 `docs/QINGYAN_CHAIN-3c_REPORT.md` | [x]（#534，2026-11-23 合并（`a8caa985`）；archive `2026-11-23-import-leads-alias-admin-revoke`；主规格 `tender/import-leads` 加 5 条、改 6 条；沿用开关 `TENDER_IMPORT_LEADS_ENABLED`（默认关）；合并前多轮多维审查 + 2026-11-23 交叉验证（三条中等问题已修：槽里文案矛盾、并发 / 组织隔离测试缺口、撤回失败后按钮卡住）） |
| FIX-12 | 一键分析不再被 300 秒硬杀：切片里每一次模型请求（首调、同模型重试、换备用、结构化输出层的重试）都只用「切片截止 − 15 秒」之前剩下的时间；剩余不足 5 秒不再重试 / 换模型（错误码 `CALL_DEADLINE_EXCEEDED`），写检查点后以 `call_deadline` 让出，截止失败的窗口计入 3 次上限、下一切片重跑；窗口开批门槛 45 → 80 秒（Lucas 建议，生产单次窗口 17–73 秒）。起因：2026-11-20「12-3 Indoor Canadian Flag」第 3 步 09:46:29、09:54:29 两次 504，11-19「12-01」的「长时间没有进展」同一根因；t+260s 那轮 terra / retryCount 0 来自结构化输出层的「瞬时错误再试一次」。零 schema、零新模型调用；**没有开关，合并即生效** | CHAIN-0c | OpenSpec change `tender-analysis-call-deadline`（新能力 `tender/analysis-slice-budget` 8 条）；新增测试 `v2-slice-deadline.test.ts` 46 项（虚拟时钟复现生产时间线：改前 330 / 435 秒，改后 190 / 225 秒让出）已注册，`tender.test.ts` 39 → 59；报告 `docs/QINGYAN_FIX-12_REPORT.md` | [x]（#540，2026-11-21 合并；archive `2026-11-21-tender-analysis-call-deadline`；主规格 `tender/analysis-slice-budget` 8 条（新，21 个场景）；没有开关，合并即生效；合并前又做了两轮独立复审共七个子 agent（本会话三个、并行会话四个，见 #540 正文与报告 §5 末）） |
| FIX-13 | 解析出的文字带 U+0000（PDF 勾选框被 unpdf 抽成空字符）或落单代理字符也能入库：两条解析路径（招标分析用的页级解析、项目文件列表用的整份文字解析）写库前把 U+0000 换成空格、落单代理字符换成 U+FFFD；解析失败的原因原文显示在分析面板覆盖清单（「未纳入：文件解析失败（原因：…）」）与项目文件列表的文件行下方，不进模型提示、Muse 通道与通知。起因：2026-11-20「12-3 Indoor Canadian Flag」上传 6 纳入 4，两份附录 B 被标成「文件解析失败」且看不到原因。带字节序标记的 UTF-16 纯文本 / CSV 现在能读，读不了的文本明确失败并写明原因。零 schema、零新模型调用；**没有开关，合并即生效**（分析面板上的原因只在「投标包 AI 体验」开关打开时显示）；已失败的文件上线后先保存分析面板上的失败原因，再在「项目文件」抽屉重新处理一次、重新分析（步骤见报告 §5） | CHAIN-0c | OpenSpec change `document-parse-nul-and-reason`（新能力 `projects/document-text-extraction`、`tender/analysis-package-coverage`）；报告 `docs/QINGYAN_FIX-13_REPORT.md` | [x]（#546，2026-11-22 合并；archive `2026-11-22-document-parse-nul-and-reason`；主规格 `projects/document-text-extraction` 4 条、`tender/analysis-package-coverage` 4 条（都是新的）；没有开关，已随合并生效；合并前三轮多维审查共十三个子 agent，最后一轮全量 705/715、10 项与 main 基线逐条相同；其它五个文字抽取入口归 FIX-14（PR #569）） |
| FIX-14 | 其它文字抽取入口写库前清理 U+0000 / 落单代理字符（FIX-13 后续；规则与 FIX-13 相同：U+0000 → 空格、落单代理字符 → U+FFFD）：供应商询价回信（每 10 分钟无人值守地跑，**三个询价开关打开之前必须已部署**）、采购记录附件、AI 对话附件与对话标题（6 处，含转为市场调研时的市场证据）、产品资料录入、报价成本表导入。以前这些入口遇到勾选框被抽成 U+0000、或按字数截断劈开表情符号就存不进库：询价回信记『解析失败，请手工录入』、条目停在『已回复』，跨过勾选框的价格还会被悄悄作废；采购附件一直『解析中』；对话发不出去；产品资料任务停在『分析中』；成本表『抽取失败』。现在都能入库、价格能通过核对；询价回信附件里有被换掉的 U+0000 时，报价备注附件一栏注明『（有 N 处符号没读出来，已当空格处理，多半是勾选框；请打开原件核对勾选项和价格）』（G5-B，措辞按文案审查调整），只在项目『投标』页询价表的『备注』列看得到，不进通知、Muse 与询价回信解析时的模型提示（报价备注整份进既有的报价草稿 / 报价分析提示，既有链路）；AI 对话里正文只有 U+0000 的附件上传时就提示『没有可提取的文字（扫描件请直接传图片）』，服务端拒绝这类附件时用同一句（本来就是空白的正文照旧『没有可分析的文本内容』）。零 schema、零新模型调用、不改 Muse；**没有开关，合并即在生产生效**；已经失败的历史数据不会自动补，合并后由有生产权限的人按报告 §9 查名单交项目负责人或创建人 | FIX-13 | OpenSpec change `extracted-text-nul-other-paths`（新能力 `platform/extracted-text-storage`，14 条要求）；报告 `docs/QINGYAN_FIX-14_REPORT.md`；新增测试两个已注册（不用库 81 项进 CI 子集，在改动前的代码上 52 项失败后中途抛错；隔离库 38 项，改动前 37 项失败）；`extracted-text.test.ts` 42 → 53；核查表第 7 项与本表 CHAIN-0 行的开关前提已写全四条；PR #569 | [x]（#569，2026-11-23 合并（`07759375`）；archive `2026-11-23-extracted-text-nul-other-paths`；主规格 `platform/extracted-text-storage` 14 条（新）；**没有开关，已随合并生效**；合并前五个维度审查 + 修订 + 挑错交叉验证 + 修订，全量 735/745 与基线相同；**询价自动化开关仍要等 CHAIN-0 第 7 项四条前提（含 FIX-24）都满足**；合并后只读核查见报告 §9） |
| 待定 | 对话标题 6 处以外，把用户打的字按字数截断后写入文本列的地方逐处排查（FIX-14 后续 1）：截断劈开表情符号时写库报 `InvalidArg`；审查时找到的 `src/lib/assistant/dispatch.ts:196` 已并进 FIX-14，其余按全仓 `.slice(0, N)` 之后写库的地方查 | FIX-14 | 另开 change；报告 `docs/QINGYAN_FIX-14_REPORT.md` §8 | [ ] |
| 待定 | AI 对话附件的图片路径 `blobPath`：手工构造带 U+0000 的路径写库报 22P05、接口返回 500（FIX-14 后续 2；`src/lib/chat-attachments/core.ts:129` 只去首尾空白与查前缀）；正常上传的路径由服务端生成，不受影响 | FIX-14 | 另开 change；报告 `docs/QINGYAN_FIX-14_REPORT.md` §8 | [ ] |
| 待定 | 采购记录附件认领满 5 次后一直停在「解析中」、不记原因，界面上没有出路（FIX-14 后续 3；`src/lib/procurement-records/attachments.ts:176`、`:261`） | FIX-14 | 另开 change；报告 `docs/QINGYAN_FIX-14_REPORT.md` §8 | [ ] |
| 待定 | 采购记录附件 `FAILED`（如「存储读取失败，稍后重试」）不被定时任务再认领，标签却写「解析失败（稍后重试）」（FIX-14 后续 4；`src/lib/procurement-records/attachments.ts:188`、`:261`，`src/lib/procurement-records/labels.ts:203`） | FIX-14 | 另开 change；报告 `docs/QINGYAN_FIX-14_REPORT.md` §8 | [ ] |
| 待定 | 采购记录附件 CSV / 纯文本按 UTF-8 读，带字节序标记的 UTF-16 CSV（Excel「Unicode 文本」导出）被判「文件损坏」；等有真实样本再定是否改用 `decodeTextFile`（FIX-14 后续 5，G3 已定 A；`src/lib/procurement-records/attachments.ts:124–126`） | FIX-14 | 另开 change；报告 `docs/QINGYAN_FIX-14_REPORT.md` §8 | [ ] |
| 待定 | 询价回信写库失败时不回滚：条目已被改成「已回复」，按「已回复」处理的回信还已经推过「收到回复」Muse 事件；失败后也不重试，只通知人工录入（FIX-14 后续 6；`src/lib/tender-rfq/inbound-sync.ts:258–272`、`:390`、`:412–414`） | FIX-14 | 另开 change；报告 `docs/QINGYAN_FIX-14_REPORT.md` §8 | [ ] |
| 待定 | 产品资料录入的解析报错（`parseResultJson.error`）与「分析输入」一步的 `parseNotes`（含文件名、网址、异常原文）写 jsonb 前没有清理与收口（FIX-14 后续 7；`src/lib/product-content/intake/analyze.ts:222–225`、`:305`、`:347`） | FIX-14 | 另开 change；报告 `docs/QINGYAN_FIX-14_REPORT.md` §8 | [ ] |
| 待定 | 询价备注里「有 N 处符号没读出来」的提示在界面上露出来（FIX-14 后续 8，来源 FIX-14 文案审查 U1）：报价备注只在项目「投标」页询价表「备注」列显示，格子截断（`src/components/inquiry/inquiry-detail.tsx:547–560`），提示排在最末，只有悬停可见、手机看不到；询价追踪页、比价表、通知、Muse 都不显示。例如把附件一栏前移，或给该行加一个标记 | FIX-14 | 另开 change；报告 `docs/QINGYAN_FIX-14_REPORT.md` §8 | [ ] |
| 待定 | 主助手页发送失败时不吞掉报错（FIX-14 后续 9，来源 FIX-14 文案审查 U3）：已有回复的对话里发送收到 400 / 500 时，页面会「找回回复」，刚发的消息消失、也不显示原因（`src/app/(main)/assistant/page.tsx:319–370`、`:793–795`；改动前 500 也一样） | FIX-14 | 另开 change；报告 `docs/QINGYAN_FIX-14_REPORT.md` §8 | [ ] |
| FIX-24 | 供应商附件文件名不能伪造报价备注的结构化字段（FIX-14 安全审查 S5，既有问题；**三个询价开关打开之前必须上线**）：回信附件的文件名原样拼进报价备注的 `[auto]` 段（`src/lib/tender-rfq/inbound-apply.ts`），比价回读（`src/lib/tender-rfq/notes-parse.ts`）按「；」与换行切开。实测文件名「a.pdf；起订量=99999；贸易条款=DDP；x」回读出起订量 99999、贸易条款 DDP（覆盖已过证据闸的 FOB）；「a.pdf；缺：价格、币种；x」会起草追问卡（跟进授权打开时自动发给该供应商）；带换行的文件名能伪造一段 2099 年的 `[auto]` 段、比价回读单价 0.01——绕过证据闸，影响比价（含 Muse compare）与追问。Gmail 是否把文件名里的换行原样交给我们未核实（`src/lib/google-email.ts:756` 只去首尾空白） | FIX-14 | 四件套由协调会话写；报告 `docs/QINGYAN_FIX-14_REPORT.md` §8 | [ ] |
| FIX-17 | 项目文件的删除与逐步处理接口补上项目权限检查（正常使用的成员、负责人、管理员界面上没有变化）：`POST …/files/process-next`（含 `?retry=1`）与 `DELETE …/files/:fileId` 原来只查「已登录」，**别的组织的账号拿到项目 ID 就能重置并清空失败文件的解析结果、触发解析与 AI 摘要 / 项目情报分析、读到文件标题与解析报错原文、删掉文件记录与 Blob 里的原文件**。现在两个接口第一步都过现成的项目读权限守卫（与上传同级：super_admin、负责人、所在组织的所有者或管理员、active 项目成员），其余登录用户 403、项目不存在或未分发 404、未登录 401；被拒的请求不改数据、不删原文件、响应不带文件信息。同目录的列表与上传已核对、本来就有守卫。新增守卫测试：这个目录下以后新加的路由漏了检查会失败。零 schema；**没有开关，合并即生效** | — | OpenSpec change `project-files-access-guard`；报告 `docs/QINGYAN_FIX-17_REPORT.md`；新增测试两个已注册（守卫 17 项，两个路由分别换回改动前各 1 项失败；隔离库 + HTTP 59 项，在改动前的代码上 27 项失败）；同类缺口另有 4 个文件不在本次（报告 §7） | [x]（#548，2026-11-23 合并；archive `2026-11-23-project-files-access-guard`；主规格 `projects/files-access` 8 条（新）；没有开关，已随合并生效；合并前五个维度多维审查 + 一次交叉验证，都没有代码阻断） |
| FIX-21 | 项目情报与一键投标方案的六个接口补上项目权限检查（界面上谁都看不出变化）：`GET` / `POST …/ai-bid-package`、`POST …/ai-bid-package/run-step`、`POST …/intelligence/regenerate`、`GET` / `PATCH …/intelligence/review` 原来只查「已登录」，**别的组织的账号拿到项目 ID 就能读报价草稿（含报价与成本价）、询价邮件草稿与情报审核结论，用该项目的数据调模型，把审核结论改成「已通过」或经重新分析清空，清空相似项目，给全组发通知**。现在查看与情报三个接口第一步过项目读权限（super_admin、负责人、所在组织的所有者或管理员、active 项目成员），建任务与执行步骤过项目写权限（再去掉操作员 / 只读等普通成员）；其余登录用户 403、项目不存在或未分发 404、未登录 401；被拒的请求不改数据、不调模型、不发通知、响应不带内容。一键投标方案的查看与执行对不是平台管理员的人只给安全视图（步骤内容为空、报错换成固定提示），平台管理员照旧全看（GATE 1 = C、2 = A、3 = A，Lucas 2026-11-22）。新增整个 `projects/[id]` 目录的守卫测试：以后新加的接口写法合规不用登记就通过，漏了检查就失败。零 schema；**没有开关，合并即生效** | FIX-17 | OpenSpec change `project-intel-bidpackage-access`；报告 `docs/QINGYAN_FIX-21_REPORT.md`；新增测试两个已注册（目录守卫 98 项，多维审查与交叉验证后收紧到「取完参数第一步就是守卫」，改动前只点名本次 6 个处理函数，另有 3 个既有处理函数列进守卫前预处理名单；隔离库 + HTTP 148 项，在改动前的代码上 85 项失败）；一键投标方案两个接口只认 `ai_bid_package` 任务 | [x]（#554，2026-11-23 合并（`212613ec`）；archive `2026-11-23-project-intel-bidpackage-access`；主规格 `projects/intel-bidpackage-access` 11 条、`projects/route-access-guard` 6 条（都是新的）；没有开关，已随合并生效；合并前五个维度审查 + 交叉验证 + 修订后复核，都没有阻断项） |
| 待定 | 重新生成情报不再清掉人工审核结论（Lucas 2026-11-22 点名，FIX-21 后续 1）：`src/lib/files/intelligence-extractor.ts:346-369` 重算写库时把 `reportStatus` 改回 `ai_generated`、清空审核人 / 时间 / 备注 / 评分，不留痕；「重新分析」与「上传新文件 + 逐步处理」（`files/process-next`）都走这里。改成保留已有审核结论，或先留痕。并入：「重新分析」没有确认框，修之前先加，建议文案「重新分析会用当前的文件重新生成情报，并清空现有的审核结论（审核状态、审核人、备注、评分），清空后找不回来。确定重新分析吗？」 | FIX-21 | 另开 change；报告 `docs/QINGYAN_FIX-21_REPORT.md` §8 | [ ] |
| 待定 | 技能与情报生成调模型带上组织，让月度 AI 费用预检对一键投标方案 `run-step` 与情报生成生效（FIX-21 后续 2）：技能上下文没有 `orgId`（`src/lib/agent/types.ts:72-78`），`src/lib/agent/skills/quote.ts:135`、`src/lib/agent/skills/email-draft.ts:117`、`src/lib/files/intelligence-extractor.ts:96` 调模型不传，预检（`src/lib/ai/client.ts:173-184`）要 `orgId` 与 `userId` 都在才查 | FIX-21 | 另开 change；报告 `docs/QINGYAN_FIX-21_REPORT.md` §8 | [ ] |
| 待定 | 重新生成情报不再按调用者的可见范围重建全项目共享的相似项目（FIX-21 后续 3）：先删后建（`src/lib/projects/similarity.ts:204-217`），候选只取调用者能看到的同组织项目（`:35-49`）；项目成员但不是组织成员的人点一次「重新分析」，所有人看到的相似项目名单都变短 | FIX-21 | 另开 change；报告 `docs/QINGYAN_FIX-21_REPORT.md` §8 | [ ] |
| 待定 | 已离开组织、但项目成员关系仍 active 的人不再过项目读权限，仍是项目负责人的不再过写权限（FIX-21 后续 4）：`src/lib/projects/access.ts:81`、`:152`、`:160` 不看组织成员身份，影响全部项目接口 | FIX-21 | 另开 change；报告 `docs/QINGYAN_FIX-21_REPORT.md` §8 | [ ] |
| 待定 | 没有所属组织的项目里，项目管理员要不要过写权限（FIX-21 后续 5）：`src/lib/projects/access.ts:93-106` 只在项目有 `orgId` 时认项目管理员；放不放开待定 | FIX-21 | 另开 change；报告 `docs/QINGYAN_FIX-21_REPORT.md` §8 | [ ] |
| 待定 | 情报审核结论的修改写审计（FIX-21 后续 6）：`PATCH /api/projects/:id/intelligence/review`（`src/app/api/projects/[id]/intelligence/review/route.ts:84`）改状态 / 备注 / 评分不留记录，只在改成通过 / 需修改 / 已交付时记审核人（`:133-140`） | FIX-21 | 另开 change；报告 `docs/QINGYAN_FIX-21_REPORT.md` §8 | [ ] |
| 待定 | 删掉 `POST /api/projects/:id/ai-bid-package` 里守卫之后不会再命中的「项目不存在」查询（FIX-21 后续 7，`src/app/api/projects/[id]/ai-bid-package/route.ts:29-35`） | FIX-21 | 另开小改动；报告 `docs/QINGYAN_FIX-21_REPORT.md` §8 | [ ] |
| 待定 | 能读项目的人（含只读成员、不是项目成员的组织管理员）能从询价与报价接口拿到价格与内部成本，要不要按财务查看权裁剪（FIX-21 后续 8）：`GET …/inquiries`（`src/lib/inquiry/service.ts:191-199`，供应商单价 / 总价）、旧报价单 `GET …/quotes/:quoteId`（`src/app/api/projects/[id]/quotes/[quoteId]/route.ts:9-25`，`costPrice`、`internalCost`、`profitMargin`），新报价引擎的「内部成本」级别对所有项目角色开放（`src/lib/quote-engine/access.ts:31`、`:43`） | FIX-21 | 待定；报告 `docs/QINGYAN_FIX-21_REPORT.md` §8 | [ ] |
| FIX-26a | 报价单 PDF 永远不印利润率（从 FIX-26 / FIX-21 后续 8 拆出，协调会话 2026-11-23 定 GATE ④ / ⑤）：旧报价单编辑器导出的 PDF 版式就是给客户的报价单（「QUOTATION」），合计下面原来印「Profit Margin: x%」（`src/lib/quote/export-pdf.ts:137-139`），**谁导出、发给客户，我方利润率就到了客户手里**。现在对任何人都只印 Subtotal 与 Total Amount；核对过 PDF 的全部字段，内部成本、成本价、内部备注本来就不印，新测试看住；不出带利润率的内部版 PDF（内部核算用 Excel，FIX-26 收给有财务查看权的人）。编辑器屏幕上、Excel、接口里的利润率归 FIX-26。已经发出去的 PDF 系统里查不到，要不要通知客户由人定。零 schema；**没有开关，合并即生效** | — | OpenSpec change `quote-pdf-no-margin`；报告 `docs/QINGYAN_FIX-26a_REPORT.md`；新测试 `src/lib/quote/__tests__/export-customer-pdf.test.ts`（Node 里生成真 PDF、抽页面文字，另有逐字节比对与整页白名单兜底；改动前 26 通过 6 失败，改动后 32 通过；审查员 35 个变异体抓到 31 个，漏的 4 个不改变 PDF 或属 FIX-26）已注册；`isInternal` 行照样印进 PDF、旧报价单列表含引擎报价两条归 FIX-26 | [x]（#574，2026-11-23 合并（`71a86a0a`）；archive `2026-11-23-quote-pdf-no-margin`；主规格 `projects/legacy-quote-pdf` 2 条（新）；**没有开关，已随合并生效**；合并前两组交叉审查（阻断：规格 Purpose 不足 50 字，已补；测试加强后 35 个变异抓 31、7 种泄露全抓）；已发出去的 PDF 查不到、要不要通知客户由 Lucas 定；生产只读 `isInternal` 查询待有生产权限的人跑（报告 §6）） |
| 待定 | 问青砚工具 `project_get_tender_summary`（`src/lib/agent-core/tools/enterprise-readonly.ts:348`）只要求组织 active 成员就能读情报推荐、风险与 `ourBidPrice`，与 FIX-21 的项目读权限口径不一（FIX-21 后续 10） | FIX-21 | 另开 change；报告 `docs/QINGYAN_FIX-21_REPORT.md` §8 | [ ] |
| 待定 | 项目 ID 带 U+0000 时所有项目接口 500（`findProjectForAccess`，`src/lib/projects/access.ts:11-25`，Postgres 22021），应按「项目不存在」404（FIX-21 后续 11） | FIX-21 | 另开小改动；报告 `docs/QINGYAN_FIX-21_REPORT.md` §8 | [ ] |
| 待定 | 「AI 投标方案已生成」高优先级通知发给全体项目成员，但一键投标方案面板只给平台管理员看，成员点开看不到内容；要不要只发给发起人或平台管理员待定（FIX-21 后续 12） | FIX-21 | 待定；报告 `docs/QINGYAN_FIX-21_REPORT.md` §8 | [ ] |
| 待定 | 守卫前预处理名单里的 3 个处理函数改成「取完参数第一步就是守卫」：`src/app/api/projects/[id]/route.ts` `PATCH`（运行环境闸）、`finance/expenses/[expenseId]` `PATCH`、`quote-engine/[quoteId]/status` `POST`（按请求体选守卫级别）；改完删掉 `project-routes-guard.test.ts` 的 `PRE_GUARD_PREP` 对应条目（FIX-21 后续 13） | FIX-21 | 另开 change；报告 `docs/QINGYAN_FIX-21_REPORT.md` §8 | [ ] |
| FIX-23 | 最近任务接口只给还能打开项目的人，检查报告只给平台管理员（FIX-21 多维审查发现，后续 9；界面上谁都看不出变化：唯一的界面调用方「自动巡检」卡没有挂在任何页面上）：`GET /api/agent/tasks/recent` 原来只按「是不是你建的」筛任务、原样返回每一步的检查报告，**不是平台管理员的人能从这里读到步骤原始报错（可能夹带模型原文与报价单价）、报价审查写进去的利润率，已被移出项目、或在别的企业建过任务的人也一直能读到那个项目的名字、步骤摘要与检查报告**；`?limit=-5` 这类负数还会让 Prisma 从末尾取、绕过 20 条上限，`abc` 直接 500。现在只返回调用者现在仍能打开所属项目的任务（与项目读权限守卫同口径：已分发，且是负责人、所在组织 active 的所有者或管理员、或项目 active 成员；super_admin 不受限；岗位预览按预览身份），范围写进同一次查询、先筛后取；不是平台管理员的人（含岗位预览中的 super_admin）每一步 `checkReportJson` 为 `null`（键保留）；`limit` 只认十进制正整数，否则按 10，封顶 20；同目录项目任务列表 `GET /api/agent/tasks?projectId=` 同一个负数 `limit` 缺口（`-1000` 一次拉出项目全部任务、从最早的开始）一并改，保留默认 20、上限 100。授权布线契约测试补上目录完整性：`src/app/api/agent/tasks/` 下以后新加的路由没登记就失败。零 schema；**没有开关，合并即生效** | FIX-21 | OpenSpec change `agent-tasks-recent-safe-view`（新能力 `agents/agent-tasks-recent-view`）；报告 `docs/QINGYAN_FIX-23_REPORT.md`；授权布线契约 9 → 13 项（改动前 12 / 1）；新增隔离库 + HTTP 测试 85 项（与项目读权限守卫逐人对照，改动前 50 项失败）、截获查询参数的不连库测试 20 项（进 CI 子集，改动前 7 项失败），已注册；`dto.test.ts` 23 → 33；合并前四个维度审查（61 个变异）后修订一轮；合并后只读核查 `docs/acceptance/fix-23/prod-check.sql` | [x]（#562，2026-11-23 合并（`d94e4323`）；archive `2026-11-23-agent-tasks-recent-safe-view`；主规格 `agents/agent-tasks-recent-view` 10 条（新）；没有开关，已随合并生效；合并前四个维度审查（61 个变异）+ 交叉验证 + 修订后复核，都没有阻断项；合并后只读核查 `docs/acceptance/fix-23/prod-check.sql` 待有生产权限的人跑） |
| 待定 | `GET /api/agent/approvals` 的 `approvals` 字段原样带 `riskReason` 与 `previewJson`（`src/lib/agent/approval.ts:111-164`；FIX-23 后续 1）：`riskReason` 在检查不通过时由 `src/lib/agent-core/skills/flow-runner.ts:391-393` 拼进检查报告的 blockers，含原始报错；`previewJson` 是步骤原始输出（`:394`），报价草稿那一步含价格。与 `src/lib/agent-tasks/dto.ts:22-26` 的 `APPROVAL_INTERNAL_FIELDS` 约定不一致；只按审批可见集合判断、不重查项目读权限，被移出项目的人照样拿到该项目名字、原始报错与价格；`inbox[].preview` 同样返回（`src/lib/approval/port.ts:140`，`riskReason ?? previewJson`）；全仓库没有界面调用这个接口 | FIX-23 | 另开 change；报告 `docs/QINGYAN_FIX-23_REPORT.md` §8 | [ ] |
| 待定 | 旧仪表盘的「自动巡检」卡没有挂载（FIX-23 后续 2）：`ManagementDashboardClient`（`src/components/dashboard/management-dashboard-client.tsx:37`）没有任何页面引用，首页渲染的是 `OrgCockpitHome`；卡片（`src/components/dashboard/dashboard-auto-inspections.tsx`）是 `/api/agent/tasks/recent` 唯一的界面调用方，FIX-23 之后它对不是平台管理员的人数不出「N 项发现」。删掉这两个组件，还是挂回去并另做安全的问题摘要（FIX-23 GATE 1 选项 C），待定 | FIX-23 | 待定；报告 `docs/QINGYAN_FIX-23_REPORT.md` §8 | [ ] |
| 待定 | cron 巡检对未分发的项目也建任务（FIX-23 后续 3）：`src/app/api/cron/inspect/route.ts:30-45` 只按 `status: "active"` 选项目、不看 `intakeStatus`；这些任务挂在负责人名下，负责人（不是 super_admin）从详情接口与最近任务接口都看不到。该不该跳过未分发项目，按 `docs/acceptance/fix-23/prod-check.sql` A 段「1 项目未分发」一行的 cron 条数定 | FIX-23 | 另开 change；报告 `docs/QINGYAN_FIX-23_REPORT.md` §8 | [ ] |
| 待定 | execute / approve 的响应 `reason` 可能带原始异常文字（FIX-23 后续 4）：技能抛错时 `src/lib/agent-core/skills/flow-runner.ts:351-356` 把 `err.message` 作为 `reason` 返回，`POST /api/agent/tasks/:taskId/execute`（`src/app/api/agent/tasks/[taskId]/execute/route.ts:34`）与 `POST …/steps/:stepId/approve`（`approve/route.ts:65`）原样给调用者，不分平台管理员 | FIX-23 | 另开 change；报告 `docs/QINGYAN_FIX-23_REPORT.md` §8 | [ ] |
| 待定 | 公开的自定义流程模板跨企业可见（FIX-23 后续 5）：`GET /api/agent/templates`（`src/app/api/agent/templates/route.ts:22`）按 `isPublic` 列出所有企业的公开模板，`GET /api/agent/templates/:templateId`（`[templateId]/route.ts:28`）返回整条记录、含 `createdById` | FIX-23 | 另开 change；报告 `docs/QINGYAN_FIX-23_REPORT.md` §8 | [ ] |
| 待定 | 岗位预览中的 super_admin 看最近任务这条路径补一个不连库的用例（FIX-23 后续 6，交叉验证提出）：`GET /api/agent/tasks/recent` 按预览身份判断（`src/lib/auth/index.ts:49,57` 降为 `user`，`src/lib/preview/server.ts:226-230` 只给预览企业的成员身份），目前只有隔离库测试 `recent-view-db.isolated.test.ts` 覆盖，CI 子集不跑；补进截获查询参数的不连库测试（预览身份下检查报告为 `null`、范围按预览企业） | FIX-23 | 另开小 change 或顺手并进下一个改 `src/app/api/agent/tasks/` 的 change；报告 `docs/QINGYAN_FIX-23_REPORT.md` §8 | [ ] |
| 待定 | 财务特权 / 岗位绑定跟着组织成员身份走（CHAIN-2c 交叉验证 F3）：`src/lib/projects/owner-change-access.ts:24-27` 判「有财务特权」用 `resolveFinancePrivilege`（`src/lib/project-finance/access.ts:50`），只看岗位绑定、不看组织成员身份，删组织成员时也不停岗位绑定；所以组织成员身份已 inactive、仍保留「老板」岗位绑定、仍是项目管理员的人能把负责人换给别人（换给自己会因「新负责人须是本组织在用成员」得 400）。比合并前收窄了、与项目财务接口同口径；要改就是岗位绑定或财务特权跟着组织成员身份走，影响全部按岗位判定的地方 | CHAIN-2c | 另开 change；报告 `docs/QINGYAN_CHAIN-2c_REPORT.md` §8 | [ ] |

### Phase F（续）— 询价单 PDF

任务书：`docs/QINGYAN_RFQ-PDF_TASKBRIEF.md`（Evan 2026-11-20 反馈「国内供应商询价 PDF 很差」；产品侧核对后定两步：先把菜单里的供应商文件收口到询价单同一套内容、模板与检查，再做询价单模板第 2 版）。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| RFQ-PDF-1 | 菜单里的供应商文件收口到询价单：「一键生成文档」的 `supplier_rfq` 改用发询价时同一个询价单生成器、询价附件的同一个模板与同一套 PDF 检查（只收已确认的供应商侧要求，不读 AI 分析综合与项目上下文）；没有要求 / 含内部财务信息 / 含招标身份 / PDF 不合格时不保存并给中文说明，不再回落成 HTML；「供应商技术确认表」「国内供应商简报」停止生成（旧文件保留）；菜单项改名「供应商询价单 PDF」 | CHAIN-4a、CHAIN-4b | OpenSpec change `supplier-docs-converge`；任务书 T1「验收」七条；报告 `docs/QINGYAN_RFQ-PDF-1_REPORT.md` | [x]（#544，2026-11-22 合并；archive `2026-11-23-supplier-docs-converge`；主规格 `tender/rfq-sheet-download` 11 条（新）、`tender/supplier-identity-guard` 改 6 条；**没有开关，已随合并生效**；与任务书的出入见报告 §1；经开工前 1 轮 + 实现后两轮多维审查，共九个子 agent（报告 §5a）；线上点一次「供应商询价单 PDF」的验证未做（沙箱访问不到线上）；简报里的合规取证清单在 RFQ-PDF-2 合并前不在任何生成文件里） |
| RFQ-PDF-2 | 询价单模板第 2 版：首屏放询价内容、补报价表（与回信解析的六个字段对上）、只留要求编号一套编号、按类别分组、去掉招标文件页码、缺中文译文的提示、合规取证清单并入「请随报价提供」、邮件正文同步；版式版本 1 → 2。RFQ-PDF-1 审查带出、并入本项的三件：回复截止不再落在截标当天（现在截标前 2 天整份生成不了）、内部字段词表扩充且要求编号与数量也过检查、身份命中与「没有已确认的要求」两句说明给出出路 | RFQ-PDF-1 | OpenSpec change `rfq-sheet-template-v2`；任务书 T2「验收」；报告附 8pt 与 7.5pt 两份样张，Evan 打印后定字号 | [ ] |


### Phase F（续）— 标书与报价页改版

任务书：`docs/QINGYAN_BIDPAGE_BID_QUOTE_REDESIGN_TASKBRIEF.md`（Evan 2026-11-22 需求：「标书与报价」页太复杂、中英混杂；一次性全部改完、单独一条轨道）。规则：**一页只做三件事，按做事的顺序排：找供应商询价 → 定报价 → 出文件。能自动带出来的不让人再填，对外发的照旧人批，界面一律中文。** 八个 change 全部藏在 `TENDER_BID_PAGE_V2_ENABLED` + `TENDER_BID_PAGE_V2_ORG_ALLOWLIST` 后面（开关关 = 零变化），八个都合并、预发验收通过后一次打开（生产名单必须填 Sunny 的组织 id）。合并由实现者按任务书「合并授权、交叉验证与交接」自行完成（Evan 2026-11-22 18:01）。开工前核对与 A / B / C 拍板（Lucas 2026-11-22）见任务书附录 C。交接：`docs/QINGYAN_BIDPAGE_HANDOFF.md`。上线顺序：1 → 3 → 4 → 6 → 5 → 2 → 7 → 8。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| BIDPAGE-1 | 三步骨架 + 「下一步」提示：新页面从上到下「下一步」→ ① 找供应商、询价 → ② 定报价 → ③ 出文件，每步可折叠、标题一句话状态；「下一步」按确定性查表算出（与任务书的出入见 design D3）；只读汇总接口金额只给有成本与财务查看权的人；入口在项目页分流（`bid-tab.tsx` 不动）；带金额的旧组件只给看得到金额的人挂 | — | OpenSpec change `bid-page-v2-shell`；任务书 BIDPAGE-1；报告 `docs/QINGYAN_BIDPAGE-1_REPORT.md` | [x]（#557，2026-11-23 合并（`d1b0d3e2`）；archive `2026-11-23-bid-page-v2-shell`；主规格 `tender/bid-page` 13 条（新）；**开关默认关，合并后页面无变化**；合并前开工前审查 1 轮 + 六维审查 + 交叉验证（报告 §5）；合并前最后一次门禁：main `212613ec` 上全量 717/727（10 项既有失败逐条相同）、CI 全绿） |
| BIDPAGE-3 | 报价做法一「逐行报价」，成本存进系统（`QuoteCostLine`），四个数取引擎结果；旧本地草稿提示一次、人点了才导入；「按招标方价格表导出」。另须：② 换成按金额门做的新区块；~~恢复有 `project:cost:write`、没有财务查看权的人编辑报价~~ **改判为不恢复**（Evan 2026-11-22 对 CHAIN-2e 的答复 ①：谁做报价谁就是负责人；逐行表本身就是成本，编辑必须看见成本；BIDPAGE-3 design D7，待 Lucas 确认）；从新页面拿掉 `BidWorkspacePanel`；「更多」里加「专业模式」；回看「下一步」「导出价格表 / 生成投标文件」的去处（看得到金额且我方报价是逐行报价时去 ②） | BIDPAGE-1 | OpenSpec change `quote-line-mode-persist`；任务书 BIDPAGE-3、验收 5 / 8；报告 `docs/QINGYAN_BIDPAGE-3_REPORT.md` | [x]（#564，2026-11-23 合并（`c376be86`）；归档 `openspec/changes/archive/2026-11-23-quote-line-mode-persist/`，主规格新增 `tender/quote-line-mode` 15 条、`tender/bid-page` 改 3 条；开关默认关；合并前门禁：合入 main `86a85724` 后全量 733/743（10 项与 main 既有失败相同），之后 main 只进文档 / 规格时核对代码逐字节相同；GitHub CI 在 `65358927` 上全绿） |
| BIDPAGE-4 | 报价做法二「只报总价」：总价构成表开始只有 4 行，其余从中文清单添加；落既有成本类别与计算方式；税走既有 `computeTax` | BIDPAGE-3 | OpenSpec change `quote-lump-sum-mode`；任务书 BIDPAGE-4、验收 3 / 4；报告 `docs/QINGYAN_BIDPAGE-4_REPORT.md` | [~]（PR 待开；全量门禁 742/752，10 项与 main 既有失败相同；CI 子集 PASS；开关默认关） |
| BIDPAGE-6 | 定报价只点一次：有批准权限的人「定为我方报价」= 提交 + 批准 + 选定；没有的人「提交给负责人」（站内通知负责人）；状态机不改；`TenderOurBidCard` 并入 ② 标题下一行（金额按金额门） | BIDPAGE-3 | OpenSpec change `quote-one-step-confirm`；任务书 BIDPAGE-6、验收 7 | [ ] |
| BIDPAGE-5 | AI 毛利建议「先查市场，再给数」：至多 2 次检索 + 1 次模型，品类判断、区间、把握程度、出处；没有依据时把握程度固定为低；只建议不落库 | BIDPAGE-3 | OpenSpec change `quote-margin-advice-market`；任务书 BIDPAGE-5、验收 6 | [ ] |
| BIDPAGE-2 | 第 ① 步「找供应商、询价」合成一块：一张「本项目的供应商」表；空库也能添加供应商、起草询价；状态归并为「在用 / 不用了」；「回复截止」与「去『招标要求』」文案修正（按开关分流）。另须：「报价」列只给有成本与财务查看权的人，恢复没有财务查看权、有编辑权的人起草询价（BIDPAGE-1 design D5 的临时出入） | BIDPAGE-1 | OpenSpec change `bid-page-sourcing-step`；任务书 BIDPAGE-2、验收 2 | [ ] |
| BIDPAGE-7 | 第 ③ 步「出文件」：八种文件按用途分三组（交给招标方 / 发给供应商 / 内部用），只换展示与分组；会写出我方报价 / 中标价的内部文件（如内部项目分析）按金额门处理 | BIDPAGE-1；#544 | OpenSpec change `bid-page-documents-step`；任务书 BIDPAGE-7、验收 8 | [ ] |
| BIDPAGE-8 | 全中文 + 守卫测试：新页面与专业模式的界面文字按术语表改中文（按开关分流），扫描守卫测试 | BIDPAGE-1 ～ 7 | OpenSpec change `bid-page-zh-copy`；任务书 BIDPAGE-8、验收 1 | [ ] |

### Phase F（续）— 情报调研树

任务书：`docs/QINGYAN_TREE_RESEARCH_TREE_TASKBRIEF.md`（Sunny 线，Evan 2026-11-22：按项目分叉去查往期同标、同类项目与条款，查到的数过交叉验证才算数，给出建议报价区间（按单价）；最深 5 层、最多 24 个分支、每支 16 次搜索加 12 次读页）。规则：**主干派活，分支去查，查到的每一个数都要过核对才算数；骨架怎么分叉由规则定，分支里怎么查由子代理定；对外发的照旧人批**。全部在开关 `TENDER_RESEARCH_TREE_ENABLED` + `TENDER_RESEARCH_TREE_ORG_ALLOWLIST` 之后（默认关）。按上线顺序合并；八个 PR 由实现者在多维审查与交叉验证之后自行合并（Evan 2026-11-22 20:08 授权）。交接：`docs/QINGYAN_TREE_HANDOFF.md`。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| TREE-0 | 登记例外：`openspec/config.yaml` 硬纪律第 7 条「例外二」（分支子代理自行决定搜索与读页，及各处模型调用的上限）与两条范围反转（读公开网页全文；给出建议报价区间）；本节登记；任务书入库（随 TREE-1 的 PR） | — | TREE-1 的 PR 里 `openspec/config.yaml` 与本节的 diff | [x] |
| TREE-1 | 读公开网页 `src/lib/web-reader/`：只在人发起的调研 Job 里读；表明身份、不登录、不带凭证；被挡即停、临时故障最多重试 2 次、429 按对方等待时间；每支最多 12 次读页、同站 2 秒间隔；同址只读一次；内网与跳转逐跳校验；站点名单与 robots；被挡后不经代理换地址；只读 HTML（PDF 不在本层解析，由人补页） | TREE-0 | OpenSpec change `public-page-reader`；报告 `docs/QINGYAN_TREE-1_REPORT.md` | [x] |
| TREE-2 | 调研树骨架：独立的调研 Job（失败不触发「AI 分析未完成」），服务端写死的两波图，有上限的分支循环（被挡换来源），交接单 `research-handoff/v1`，表驱动的分叉规则，树干写进情报室 `summaryJson.researchTree` | TREE-1 | OpenSpec change `research-tree-runtime`；报告 `docs/QINGYAN_TREE-2_REPORT.md` | [ ] |
| TREE-3 | 三个子代理：条款员（等效品 / 指定品牌 / 加拿大含量，带页码）、往期同标员、同类项目员；单价换算与可比度打分（纯函数） | TREE-2 | OpenSpec change `research-branches-awards`；报告 `docs/QINGYAN_TREE-3_REPORT.md` | [ ] |
| TREE-4 | 交叉验证八条规则：① 另一步骤核对、不带原推理；② 重读网址逐字回查金额 / 数量 / 公司名；③ 两个不同域名或一个官方来源；④ 公司名三档；⑤ 口径不明另标；⑥ 只有已核实的进区间、矛盾的并排；⑦ 核对换模型；⑧ 人可剔除并重算 | TREE-2 | OpenSpec change `research-cross-verify`；报告 `docs/QINGYAN_TREE-4_REPORT.md` | [ ] |
| TREE-5 | 树干结论与情报页签「调研树」卡：证据表、建议区间与中位数（不少于 3 条已核实才出）、每支状态、重新查、这条不对 | TREE-3、TREE-4 | OpenSpec change `research-trunk-view`；报告 `docs/QINGYAN_TREE-5_REPORT.md` | [ ] |
| TREE-6 | 一键送页：粘贴网址与文字、截图 / PDF、书签小工具；记为「人工提供，未复读」，按单一来源对待 | TREE-5 | OpenSpec change `research-page-intake`；报告 `docs/QINGYAN_TREE-6_REPORT.md` | [ ] |
| TREE-7 | 查不到金额时「起草资料申请」：带参数进 PROC-1 的申请卡草稿，不提交 | TREE-5 | OpenSpec change `research-records-request-draft`；报告 `docs/QINGYAN_TREE-7_REPORT.md` | [ ] |
| TREE-8 | 直接问采购方：往期同标没查到时往澄清问题清单加一条待确认的问题与英文邮件草稿；过提问截止日不显示 | TREE-5 | OpenSpec change `research-buyer-question`；报告 `docs/QINGYAN_TREE-8_REPORT.md` | [ ] |

---

## Phase N — 导航与说明白话化 + 回复入口（看得懂、找得到、回得了）

任务书：`docs/QINGYAN_NAV-1_PLAIN_NAV_REPLY_TASKBRIEF.md`（Lucas 2026-11-14 拍板：常用 8 项取推荐、回复以询盘收件箱为主、三条改法全部执行，见任务书「拍板结果 · NAV-1」）。起因：梦馨（账号 Cathy）三条使用反馈——左栏和说明对不上号、说明不够白话、没地方点击去回复。规则：一个入口只有一个名字；说明按「我想做什么」写；看到客户来信的地方就有回复按钮；不减功能。纪律同上：零 schema、不新增出站通路（沿用既有人工点击发送的收件箱回复与既有审批发送）、不新增队列、零新增 LLM 调用、不新增权限键 / 模块 / 岗位模板 / 页面路由。属梦馨线，与 Phase V 并列。一个 change = 一个 PR，按 NAV-1a → 1b → 1c 上线（1a、1c 互不依赖；1b 依赖 1a 的取名函数）。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| NAV-1a | 一个入口一个名字：侧栏、手机抽屉、说明页共用同一个取名函数；断言测试守住注册表名称与翻译表一致（有翻译键的每一项中文相等、英文非空）；按任务书定名表统一 18 处不一致，另改名 4 处（收件箱 → 微信客服、海外业务 → 外贸获客、企业情报 → 竞品溯源、日历 → 预约日历）；页面大标题与入口名对齐（改标题不改路由）；`en.ts` 同步 | — | OpenSpec change `nav-1a-single-name`；BREAKING · 文案：所有企业的侧栏有若干入口改名（Sunny 销售的「电子报价单 / 全部报价」变为「报价 / 报价记录」）；新增测试 `entry-naming.test.ts` 31 项已注册；真实应用截图 16 张 `docs/acceptance/nav-1a/`；报告 `docs/QINGYAN_NAV-1a_REPORT.md` | [x]（#453，2026-11-15 合并；archive `2026-11-15-nav-1a-single-name`；没有开关，已随合并生效） |
| NAV-1b | 常用入口置顶 + 白话说明页：两段式侧栏判定改为纯函数（外贸模块已开 ∧ 持 `trade.read` ∧ 企业未开窗饰模块 ∧ 非平台 super_admin；旧模式平台 `trade` 不变），「常用」8 项固定顺序、其余进「更多」并按分组带小标题，可达入口集合不变；`/help` 顶部「我想做什么」（外贸首批 12 行，目标不可见的行不出现）、「全部入口」与侧栏同序、删开发者页尾；19 条入口说明改白话；`trade-layout.test.ts` 注册并从基线删除 | NAV-1a | OpenSpec change `nav-1b-focused-sidebar-task-help`；BREAKING · 布局：梦馨持外贸键的成员侧栏变为「常用 + 更多」；`trade-layout.test.ts` 32 项已注册（基线 68 → 67），`entry-visibility` 73 → 91；真实应用截图 10 张 `docs/acceptance/nav-1b/`；报告 `docs/QINGYAN_NAV-1b_REPORT.md` | [x]（#463，2026-11-15 合并；archive `2026-11-15-nav-1b-focused-sidebar-task-help`；没有开关，已随合并生效） |
| NAV-1c | 看到来信就能回：客户详情互动时间线对有回复目标的来信显示「回复」（目标读时计算，只在外贸模块已开 ∧ 持 `trade.manage` ∧ 询盘收件箱放行时返回）；文案改「客户来信 / 我方发出 · 经手人：…」；询盘收件箱支持深链、每张会话卡片始终有回复按钮（无草稿时「写回复」）、回复窗口显示买家原文、手写回复留底记 `aiDraft=false`；今日询盘与商机详情的待批草稿卡加去收件箱自己写的链接 | — | OpenSpec change `nav-1c-reply-entry`；无 BREAKING（时间线文字对所有企业换了说法）；新增只读接口 `GET /api/trade/inbox/focus`；新增测试 `reply-entry.test.ts` 45 项、`reply-entry-db.isolated.test.ts` 21 项，均已注册；真实应用截图 10 张 `docs/acceptance/nav-1c/`；报告 `docs/QINGYAN_NAV-1c_REPORT.md` | [x]（#472，2026-11-15 合并；archive `2026-11-15-nav-1c-reply-entry`；没有开关，已随合并生效） |
| NAV-6 | 询盘收件箱里「谁回复了谁」说清楚：外贸线索阶段 `replied` 的显示名由「已回复」改为「买家已来信」（阶段表一处为准，概览卡 / 看板漏斗 / 活动漏斗 / 助手阶段分布四处改为同源；阶段取值与统计口径不变）；收件箱卡片上我方的状态写「我方已回复」；两个收件箱接口返回 `capabilities.reply`，不能回复的成员不出现回复操作（今天没有这样的账号，预防性） | NAV-1c | OpenSpec change `nav-6-inbox-reply-clarity`；BREAKING · 文案：开了外贸模块的企业都会看到阶段改名；来源 `docs/QINGYAN_NAV-1c_REPORT.md` §4 第 4、6 条；新增测试 `reply-clarity.test.ts` 36 项已注册，隔离库测试 21 → 28；真实应用截图 6 张 `docs/acceptance/nav-6/`；报告 `docs/QINGYAN_NAV-6_REPORT.md` | [x]（#484，2026-11-15 合并；archive `2026-11-15-nav-6-inbox-reply-clarity`；没有开关，已随合并生效） |
| NAV-3 | 审批草稿可改：今日询盘与商机详情的待批回复草稿卡上，链接改为「想改一改再发？去询盘收件箱改这份草稿」并带草稿 id（今日询盘上先展开草稿才出现）；询盘收件箱按草稿 id 预填这份草稿的主题与正文，改完由成员本人发出，原草稿按既有规则作废；单会话接口加可选参数 `approvalId` 返回草稿原文（七个条件全满足才给，含入驻测试询盘不给）；回复接口正文上限 8000 → 10000 | NAV-1c | OpenSpec change `nav-3-approval-draft-editable`；无 BREAKING；不新增发信通路，不动审批流与外发同步；新增测试 `approval-draft-edit.test.ts` 48 项已注册，隔离库测试 28 → 42；真实应用截图 6 张 `docs/acceptance/nav-3/`；报告 `docs/QINGYAN_NAV-3_REPORT.md` | [x]（#501，2026-11-16 合并；archive `2026-11-16-nav-3-approval-draft-editable`；没有开关，已随合并生效） |

**GATE-N 验收**（细项见任务书「验收」节）：以 VIS-1e「以岗位预览」在梦馨企业勾选老板 + 外贸业务员核对 Cathy，另核对梦馨纯外贸业务员（`trade_rep`）、Lynn（Sunny `sales_rep`）、Lucas（`super_admin`）；发信类步骤在 staging 用测试买家邮箱做；`npm run test:ci` 与 `npm run typecheck` 通过；Prisma schema 与 `vercel.json` 无 diff；每个 change 的 `openspec validate` 通过。上线后通知梦馨一次：入口没有少，常用的在最上面，其余在「更多」；改了名字的四个入口。

---

## Phase Q — 报价工具并入青砚

任务书：`docs/QINGYAN_QUOTE-1_QUOTE_FILE_IMPORT_TASKBRIEF.md`（Lucas 2026-11-14；方案文档 `Sunny报价系统_融入青砚方案_2026-11-14.md` 的 Q-0）。规则：文件只告诉青砚「填了什么」，价格永远由青砚算；文件里比青砚便宜的部分一律变成特别让利，走现有审批。纪律同上：零 schema（新字段只落 `formDataJson` 与 AuditLog）、零出站、不新增队列、零 LLM 调用、不新增权限键 / 路由。与 Phase K / P / V 并列，属 Sunny 线。一个 change = 一个 PR，按 QUOTE-1a → 1b 顺序合并。

判断点（任务书「判断点」节）：3（Roller 罩盒加价补上）已拍板「做」，实施中补充两项拍板（Lucas 2026-11-15）：罩型与工艺单同口径、打开旧的实木报价时提醒检查 Part B；1（Door Screen Sheer 口径）与 2（褶皱率）Lucas 2026-11-15 拍板「都先不变」：Door Screen Sheer 继续套纱帘的企业折扣（宽 ≤ 25" $110.80 / ≤ 40" $147.73），详细订单的褶皱率仍只有 180 / 230 两档。对 QUOTE-1b 的后果（propose 时写清）：工具里的 Door Screen Sheer 行（$170.45 / $227.27）导入后以青砚的低价为准、差额只列提醒；工具默认褶皱率 2.0 在青砚没有对应档，导入时须落到 180 或 230，怎么落在 QUOTE-1b propose 时再定。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| QUOTE-1a | 详细订单定价口径对齐：Roller 行的定价键 = 基础面料 + 生效罩型（行上 Valance，空则取表底部 Valance Type，与工艺单同口径；Cassette / Fascia 加价 25 / 50）；实木百叶窗表单材质 `Wooden` 按价表键 `Wood` 计价；页面预览、PDF 与保存时的行构造用同一个纯函数取定价键，PDF 的 Valance 列显示生效罩型；补经「表单行 → 企业默认折扣 → 引擎」完整路径的对照测试；口径标记 `formDataJson.orderPricingRev` + 打开改动前保存的实木报价时提醒检查 Part B；已存报价不重算。Door Screen Sheer 不套企业折扣一项未实施（判断点 1 拍板「先不变」） | 判断点 3；罩型同口径、实木提醒取 B（Lucas 2026-11-15） | OpenSpec change `quote-order-form-pricing-parity`；`order-form-pricing-parity` 测试（72 条）注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`、158 条黄金用例不变；截图 `docs/acceptance/quote-1a/`；BREAKING（金额，只影响新建与再次保存的报价）；报告 `docs/QINGYAN_QUOTE-1a_REPORT.md` | [x]（#456；archive `2026-11-15-quote-order-form-pricing-parity`） |
| QUOTE-1b | 导入工具报价文件（`.sunny-quote.json`，格式 `sunny-quote-studio` v1）：浏览器内读文件、不上传原文件 → 校验 → 多方案选一套 → 核对窗（逐行对照文件金额 / 青砚金额 + 阻断 / 提醒清单）→ 填入详细订单 → 走现有保存与让利三档；行级折扣低于企业默认的保留到行上，其余差额累加进特别让利；`formDataJson.importSource` 留痕 + 审计 `quote_imported` | QUOTE-1a；褶皱率非 180 / 230 的行怎么落（判断点 2「先不变」之后的导入规则） | OpenSpec change `quote-import-studio-file`；校验 / 映射 / 16 行样例对照测试注册；报告 `docs/QINGYAN_QUOTE-1b_REPORT.md` | [x]（#520，2026-11-17 合并；archive `2026-11-17-quote-import-studio-file`；主规格 `sales/quote-file-import` 16 条、`sales/price-list` 新增 3 条。**尚未用界面导出的真实文件验证**——走查第 ⑨ 项用两份 toolcode 文件代替，待 Lucas 从工具界面导出真实文件各导一次；上线前另需核对生产的企业运费。交接见 `docs/QINGYAN_QUOTE-1b_REPORT.md` §10） |

---

## Phase M — 邮箱助手（问了就能读，来了会提醒）

任务书：`docs/QINGYAN_MAIL-1_MAILBOX_ASSISTANT_TASKBRIEF.md`（需求方 Sunny 线 2026-11-14；判断点 1–7 已于 2026-11-14 拍板，见任务书「拍板结果」；判断点 8 于 2026-11-15 拍板取 A：公共地址来信只提醒邮箱主人；同日拍板：岗位模式下只有销售岗位的成员打不开助手页这件事维持现状，网页读信只对能打开助手页的人可用）。规则：读是直接的，写是要批的。三条边界全部 fail-closed：只读本人绑定的邮箱（工具没有邮箱 / 用户参数，不读组织授权邮箱 `mailboxEmail`）；邮件内容是资料不是指令；正文不落库。纪律同上：零 schema、本期零出站、不新增 cron / 队列（MAIL-2 挂既有 `sales-actions`）、读信工具不上微信 / Muse 通道、零新增 LLM 调用。与 Phase K / P / C / V 并列，属 Sunny 线。一个 change = 一个 PR，按 MAIL-1 → MAIL-2 顺序合并。

| ID | 任务 | 依赖 | 验收 | 状态 |
|---|---|---|---|---|
| MAIL-1 | 助手只读读信：`mail_search`（关键词 / 客户 / 天数 / 未读）与 `mail_read_thread`（线程正文纯文本，带截断标记，附件只列文件名与大小）两个只读工具，只在网页助手对话里出现，受众与「邮箱绑定」页一致；未绑 Gmail 或缺读信权限时返回结构化错误并指向 `/settings/email`，该页与 `GET /api/sales/email-status` 增加读信权限状态；工具结果按不可信资料处理（系统提示固定规则）；每次调用留元数据审计，不含正文；开关 `MAIL_READ_ENABLED` 默认关。不改发信、审批闸与执行前守卫 | — | OpenSpec change `mail-read-tools`；新增测试四个已注册（纯函数与读接口 92 项、可见性 69 项、工具 57 项、不可信内容 56 项）；本地验收脚本 60 项（真实消息接口 + 引擎 + 本地库，模型按剧本、Gmail 用假邮箱）；真实页面截图 3 张 `docs/acceptance/mail-1/`；`vercel.json` 与 Prisma schema 无 diff；报告 `docs/QINGYAN_MAIL-1_REPORT.md`（含两处拍板：回复落库前省略长段邮件原文、读过邮件的同一轮拒绝写入类工具；以及助手回复里外部图片自动加载的发现） | [x]（#455；archive `2026-11-15-mail-read-tools`；开关 `MAIL_READ_ENABLED` 默认关，生产未启用；真实模型与真实 Gmail 下的验收待在 staging 做，见报告 §6、§11；岗位模式下只有销售岗位的成员打不开助手页、在网页上用不了读信，2026-11-15 拍板维持现状，见报告表头「状态」） |
| MAIL-2 | 客户来信提醒：`sales-actions` 定时任务加 `mail-watch` 步骤（每 15 分钟，`history.list` 游标轮询，首轮不回溯，只取元数据不取正文）→ 查表归类（客户来信 / 客户回信 / 未匹配）→ AuditLog 账本（按 Gmail messageId 幂等）+ 客户时间线入站互动（只有主题）+ `mail_inbound` 通知与微信 / Muse 推送（客户名 + 主题）；配置与游标在 `settingsJson.mailWatch`；三道开关（平台 `MAIL_WATCH_ENABLED` ∧ 组织 ∧ 成员本人勾选）都默认关 | MAIL-1；判断点 8（未定前只提醒邮箱主人） | OpenSpec change `mail-watch`；`mail-watch-pure` / `mail-watch-db.isolated` 测试注册；报告 `docs/QINGYAN_MAIL-2_REPORT.md` | [x]（#470；archive `2026-11-15-mail-watch`；开关 `MAIL_WATCH_ENABLED` 默认关，生产未启用；判断点 8 取 A（2026-11-15 拍板）；公共地址的真实邮件头与真实 Gmail / 微信下的验收未做，见报告 §3、§7） |

**运维前置（有 Google Cloud Console 权限的人，合并前确认；细项见任务书「上线顺序与运维前置」）**：OAuth 同意屏幕的状态（`gmail.readonly` 属受限权限；「测试中」状态下刷新令牌约 7 天失效）；Sunny 成员的邮箱是否都在同一个 Google Workspace 下；早期只授权了撰写权限的账号上线后在 `/settings/email` 重新授权一次。

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
14. 详细订单定价口径（QUOTE-1a，#456，Lucas 2026-11-15）：
    - Roller 行的定价随生效罩型：Cassette / Fascia 每行加 25（宽 < 50"）/ 50（宽 ≥ 50"）；生效罩型 = 行上 Valance，行上为空取表底部 Valance Type，与工艺单同口径；报价 PDF 的 Valance 列显示生效罩型。
    - 实木百叶窗（表单材质 Wooden）按价表 `Wood` 表自动计价，Part B 不再手填；打开改动前保存的实木报价时提醒检查 Part B。
    - 只影响新建与再次保存的报价，已存报价不重算。
    - Door Screen Sheer 的企业折扣与详细订单的褶皱率两档（180 / 230）先不变。
