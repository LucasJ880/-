# T-1 报告：询价进展通知——报价到了、该催了、没回了，告诉对的人

| 项 | 值 |
|---|---|
| TASKFLOW | T-1（新增 Phase T「询价追踪」） |
| OpenSpec change | `openspec/changes/rfq-tracking-notify/`（新能力 `tender/rfq-notifications`；增量 `notifications/email-reminders`、`notifications/click-targets`、`notifications/preferences`、`tender/rfq-web-entry`） |
| 任务书 | `docs/QINGYAN_T-1_T-2_RFQ_TRACKING_TASKBRIEF.md` §2（Evan 2026-11-07 拍板：「催单待批」15 分钟未读发升级邮件，只此一类） |
| 分支 | `claude/t1-rfq-tracking-notify`（基于 #390 的归档提交 `fd77906`，已随 #390 合入 main `46486d4`） |
| 状态 | `[G]` 等审：代码、测试与门禁完成，两轮独立审查已处理；staging 手工验收待 Evan |

## 1. 用户现在会怎么用

- 供应商回信、报价自动进表后（入站每 10 分钟一次），项目负责人和这一轮的发起人铃铛里出现「甲厂报价了 · Alberta 露营装备」（缺字段时摘要写「还缺：币种、有效期」）或「乙厂回信了，没有报价 · …」。点开直接到项目「标书与报价」并展开这一轮。
- 定时检查给某一轮起草了催单 / 追问，负责人只收到一条：「3 封催单 / 追问已起草，等你批准 · …」（含催单为 high）。点开，那一轮卡片头写着「催单待批 3」，每张卡一块面板：给谁、第几次催单还是缺字段追问、能展开看正文，「批准并发送 / 驳回」就在原地。驳回只是这一封不发，这一轮不受影响。
- 这条「催单待批」15 分钟没读，负责人自己的青砚账号邮箱收到【青砚】升级邮件（随 `sales-actions` 每 15 分钟一次），主题「【青砚】催单待批 · 项目「Alberta 露营装备」第 2 轮询价」，链接直接到该轮。
- 催满两次或回复截止已过仍没回，被标「未响应」时，负责人和发起人收到「戊厂没有回复，已标未响应 · …」。
- 通知、邮件都不出现任何金额；没读的进第二天 7 点汇总；设置页能按类型关掉，四个新类型对老用户默认开启。人工录报价、手动「现在就催」、Muse `chase` 意图都不发这些通知。

## 2. 改了什么

| 位置 | 改动 |
|---|---|
| `src/lib/notifications/constants.ts`、`delivery-gate.ts` | 登记 `rfq_quote_received`「供应商报价了」/ `rfq_reply_received`「供应商回信（无报价）」/ `rfq_chase_ready`「催单待批」/ `rfq_no_response`「供应商未响应」；`TYPE_INTRODUCED_AT` 用 `9999-12-31` 哨兵 |
| `src/components/header.tsx`、`notification/notification-list-item.tsx` | 四个类型的图标 |
| `src/lib/tender-rfq/tracking-notify-pure.ts`（新） | 文案表、文字规则（24 字截断、「等 k 家」、字段顺序）、按段脱敏、四类去重键、收件人规则 |
| `src/lib/tender-rfq/tracking-notify.ts`（新） | 补上下文后统一经 `deliverCollabNotification`（`actorId: null`），不向外抛错 |
| `src/lib/tender-rfq/inbound-sync.ts` | 可选依赖 `notifyTracking`：写完入表审计后只对 `quoted` / `replied` 调；两条入站提醒 `category` 改 `tender_rfq`，解析失败提醒改跳该轮（`sourceKey` 不变） |
| `src/lib/tender-rfq/chase-service.ts` | `loadItems` 多 select 轮次序号与发起人；`runForItems` 加 `onRoundDrafted`、`onNoResponse` 带上下文、库读写可注入；只有 `runChaseScan` 传通知回调 |
| `src/lib/notifications/href.ts` | `tender_rfq_round` → `/projects/{projectId}?tab=bid#rfq-round-{轮次}` |
| `src/lib/notifications/collab/escalation.ts` | `ESCALATION_TYPES` 加 `rfq_chase_ready` |
| `src/lib/tender-rfq/web-entry-pure.ts` | 锚点解析与首屏展开；催单面板文案、卡片头计数、正文预览（询价 / 催单两种 payload）、「还用不用催」、催单结果转人话 |
| `src/lib/tender-rfq/web-entry.ts`、`web-entry-approval.ts`、`app/api/projects/[id]/tender-rfq/entry/route.ts` | 入口多返回 `pendingChases`（未过期待批 + 已批执行中、且那家还用得着催）并补审批能力与正文 |
| `src/components/inquiry/rfq-approval-panel.tsx`、`project-inquiry-section.tsx` | 面板加 `variant="chase"`；首屏按锚点展开、`hashchange`、卡片头「催单待批 N」、每张催单卡一块面板 |
| `src/app/(main)/settings/notifications/page.tsx` | 邮件开关说明加上「催单待批」 |
| 测试 | 新增 `tracking-notify-pure` / `tracking-notify` / `tracking-notify-wiring` 并注册；`inbound-apply`、`collab-preferences`、`collab-email-escalation`、`notification-href`、`web-entry-pure` 加用例 |

不动：`chase-pure.ts`（`decideChases` / `decideNoResponse`）、`chase-execute.ts`、`execute.ts`、`inbound-parse.ts`、`inbound-apply.ts`、`src/lib/muse-bridge/**`、`collab/deliver.ts` / `email.ts` / `digest.ts` / `redact.ts`、审批中心、Prisma schema、`vercel.json`。

## 3. 测试与门禁（实际运行，Node 24.22.1）

| 检查 | 结果 |
|---|---|
| `tracking-notify-pure.test.ts`（新增） | 127 passed |
| `tracking-notify.test.ts`（新增，注入 deps 执行） | 33 passed |
| `tracking-notify-wiring.test.ts`（新增，源码接线） | 67 passed |
| `inbound-apply.test.ts` | 72 passed（改前 54） |
| `web-entry-pure.test.ts` | 122 passed（改前 81） |
| `collab-preferences.test.ts` | 104 passed（改前 80） |
| `collab-email-escalation.test.ts` | 175 passed（改前 159） |
| `notification-href.test.ts` | 91 passed（改前 87） |
| `test-all.sh` 里 tender-rfq / notifications / muse-bridge 全部已注册测试 | 改前 33 条命令全过 → 改后 36 条全过（新增 3 条），其余计数不变 |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | exit 0 |
| `npm run lint:baseline` | PASS（errors 38 ≤ 基线 53，无新增 fingerprint）；改动文件单独 `eslint` 0 问题 |
| `npm run test:ci` | CI unit subset PASS，exit 0 |
| `bash scripts/test-runtime-architecture.sh` | PASS |
| `bash scripts/check-test-registry.sh` | OK，已注册 544 |
| `openspec validate rfq-tracking-notify --strict` | valid |

变异验证：把 `onRoundDrafted` 的调用挪进逐张起草的循环里，`tracking-notify.test.ts` 报「两轮各调一次 onRoundDrafted」失败（实际 4 次）。

### 3.1 独立审查（只给任务书 + diff）

阻断 1 / 应修 1 / 建议 4：

- **阻断：项目页没有催单卡的审批面板**——W-1 的轮次卡片只给 `tender.send_rfq` 渲染面板，点「催单待批」落到的那一轮批不了。Evan 2026-11-08 拍板在该轮原地审批（design D13），已实现。
- **应修：测试没真跑分组与投递**——`runForItems` 库读写改为可注入，新增 `tracking-notify.test.ts`；删掉恒为真的断言。
- 建议：同页点同项目另一轮的通知不展开 → 加 `hashchange`；从链接进来后新出现的待批轮次不展开 → 首屏待批轮次改在入口第一次加载时记下；设置页邮件说明没跟着变 → 改文案并补 `notifications/preferences` 增量。以上已修。
- 建议：催单卡已在审批中心批过仍会收到升级邮件 → Evan 拍板记为已知局限（§5）。

### 3.2 复核

上轮 1–5 条全部确认已修。新发现阻断 0 / 应修 2 / 建议 2：

- 应修：催单卡失败提示一律说「会重新起草」，驳回失败或别人已处理时不对 → 改为只说能确定的事。
- 应修：那家已回信后催单卡仍请人批，批了显示带英文状态的「已发出」样式 → 已不用催的待批卡不列（与执行器同一判定）；结果转人话、没发出的用中性样式。`chase-execute.ts` 未改。
- 建议：催单卡无权提示改为「需要项目负责人或组织管理员批准」（已改）；点到与当前完全相同的地址不重新展开（未改，§5）。

## 4. 与任务书的偏差

| 任务书 | 实际 | 原因 |
|---|---|---|
| 点开「催单待批」「审批面板就在那里」（默认 W-1 已有） | 新增催单卡原地审批面板；`loadRfqSendEmails` 兼容催单单封 payload | W-1 只有询价发送卡的面板；T-2 §3.2 第 2 条的「兼容 `tender.send_chase` 单封 payload」提前到 T-1，T-2 直接复用（design D13） |
| 在纯模块里复写 `hooks.ts` 的 `MISSING_FIELD_LABELS` | 复用 `inbound-contract.ts INBOUND_MISSING_LABEL` | 已有一张只依赖 zod 的同内容表；测试断言两张表逐字相同（design D5） |
| 两条入站提醒改 `category: "tender_rfq"` | 照做；新四类的 `category` 是各自类型名 | `deliverCollabNotification` 固定写 `category = type`，没有读取方，不动共享入口（design D11） |
| `inbound-sync` 既有测试 + `runChaseScan` 测试 | 入站挂钩测试加在 `inbound-apply.test.ts`（`syncOrgInbound` 的测试本来就在那）；催单分组用注入 deps 的 `runForItems` 执行测试 + 源码接线断言 | 仓库没有单独的 inbound-sync 测试；`runChaseScan` 读库 |
| 例子「还缺：有效期、币种」 | 「还缺：币种、有效期」 | 字段按 价格、币种、交期、有效期、起订量、贸易条款 的固定顺序 |
| 「催单 + 追问」只写了一家追问 | 多家追问写「{名单}报价缺信息」 | spec 补齐 |
| （未提） | 设置页邮件开关说明加「催单待批」+ `notifications/preferences` MODIFIED | 升级邮件范围变了，原文案写死了两种 |
| （未提） | 已不用再催的待批催单卡不在轮次里列；批准结果转人话 | 复核应修项；执行器那边本来就不会发 |
| （未提） | `runChaseScan` 里 Muse `no_response` 钩子出错改为只记日志 | 原来回调抛错会让该家同时记进 `noResponse` 与 `failed`（design D12） |

## 5. 已知局限与遗留

- **催单卡已在审批中心批过，15 分钟后仍会收到「等你批准」的升级邮件**：只在「没点通知、直接去审批中心批」时出现（点开通知即已读，不再发）。Evan 2026-11-08 拍板记为已知局限。
- **已不用催的待批卡在项目页不列，但审批中心里仍在，直到 48 小时过期**。批了执行器也不会发出（「这封催单没有发出」）。
- **铃铛点到与当前完全相同的地址时不会重新展开**（例如同一轮先后两条通知、中间手动收起过）：浏览器不触发 `hashchange`。地址不同（另一轮、或从别的页 / 别的 tab 进来）都正常。
- **`MUSE_BRIDGE_ENABLED` 打开时项目负责人会同时看到 Muse 事件与新的站内通知**：旁路目前关闭，不去重。
- **库里已有的两条入站提醒保持原 `category = muse_bridge`**，之后新写的才是 `tender_rfq`；新四类的 `category` 是各自类型名（D11）。
- 「全部批准（N 封）」与跨项目追踪页属 T-2。
- 本地沙箱无数据库：DB 路径由类型检查、注入 deps 的执行测试与源码断言覆盖，端到端以 staging 手工验收为准。

## 6. 上线与 staging 验收（Evan）

无迁移、无新开关、无新环境变量、无新 cron。前置同 GATE-W（授权邮箱已连接 Gmail 含 readonly、project@ 设为「以此地址发送」、staging 打开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD=1` 与 `QINGYAN_ALLOW_CRON_NON_PROD=1`），用 W-1 发出的一轮。任务书 §2.6：

5. 测试邮箱回一封带价邮件 → 10 分钟内负责人铃铛出现「报价了」，点开展开到该轮。
6. 把 `chaseAfterDays` 临时设为 1（或在 staging 库把一项的 `sentAt` 往前调）→ 下一个 tick 出现一条「该催了，等你批准」；点开那一轮卡片头「催单待批 N」，面板里「批准并发送」后测试邮箱在原线程收到催单，面板显示「已给 X 发出第 1 次催单，回复会在原询价线程里自动进表。」
7. 「催单待批」出现后 30 分钟内不点开 → 负责人邮箱收到【青砚】升级邮件，链接直接到该轮；点开过的不再发。
8. 设置页关掉「催单待批」→ 再触发不再出现；7 点汇总里能看到前一天没读的询价通知、无金额。
9. 体感：每条通知读完标题就知道是哪个项目、哪家、要不要动手；点一下就到能动手的地方。

回滚 = 还原本 PR（已写入的通知行留在库里，类型未登记时显示为「其他通知」）。
