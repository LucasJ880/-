# Sunny 日程归因 + 期间看板 — 设计稿（CAL / KPI 线）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-28 |
| 需求方 | Sunny（Sunny Shutter） |
| 诉求 1 | Google Calendar 是实际排班工具；销售 / 运营直接在 Google 里放或改日程，别人不知道；网站 `sunnyshutter.ca/book-now/` 的客户自主预约也进 Google；**无法按账号统计"这个月谁放了多少日程"** |
| 诉求 2 | 看板上要能看"从 10 月 1 日到今天 28 日：一共成了多少单、一共报了多少钱出去"，并带 AI 分析 |
| 设计 | Claude（chat）；本文是任务书母本，§7 的判断点拍板后按 §5 切 change 走 `/opsx:propose` |
| 执行 | Claude Code |
| 纪律 | 零 schema / 出站先审批 / 不加队列（复用 vercel cron）/ 确定性优先 / 测试注册；见 `openspec/config.yaml` |
| 主线登记 | `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase K（CAL-1 / KPI-1 / KPI-2 / CAL-2） |

---

## 0. 一句话

**青砚不替代 Google Calendar，而是"看着"它**：每 15 分钟增量拉取共享日历的变更，用查表规则把每条日程归因到"青砚 / 某个成员 / 网站预约 / 不明"，变更发站内通知、按月按账号出统计；期间看板把成单与报价金额收成**一套口径一个纯函数**，先用确定性规则出"洞察"，LLM 叙述作为可选层单独拍板。

---

## 1. 现状（2026-10-28 扫描结论，按文件）

### 1.1 日程

| 事实 | 位置 |
|---|---|
| Google Calendar 每人各自授权，scope 已含 `calendar.readonly` + `calendar.events`，token 加密存 `CalendarProvider`（**无 orgId**，`calendarId` 为逗号分隔的多日历列表） | `src/lib/google-calendar.ts:7-12`；`prisma/schema.prisma` L729 |
| 预约（`Appointment`：measure / install / revisit / consultation）**只有青砚 → Google 单向推送**；`googleEventId` 是唯一关联；推送时 `description` 没有真正写进 Google（`pushEventToGoogle` 不收 description，只有 update 路径写） | `src/lib/sales/appointment-gcal-sync.ts:41`；`src/lib/google-calendar.ts:374` |
| 日历页读 Google 是**实时读穿**（`/api/calendar/google`），不落库；拉回的 `GoogleEvent` **没有 creator / created / updated / status** 字段 | `src/lib/google-calendar.ts:192-208, 271` |
| 没有任何 cron 碰日历；没有 syncToken 增量同步 | `vercel.json` |
| 网站 book-now：仓库里**零接入**（无 Calendly / Gravity / WP 任何痕迹）；既有网站 webhook（`/api/trade/webhook/website`）是外贸询盘链，不会生成 Appointment | `docs/QINGYAN_INTAKE_WEBHOOK.md` |
| `CalendarEvent`（个人日程表）有 `source / externalId / sourceKey`，但**没有 JSON 位放归因** | `prisma/schema.prisma` L532 |
| 组织时区读 `settingsJson.timezone`，默认多伦多 | `src/lib/automation/registry.ts:93` |

结论：问题不在"看不到"（日历页本来就能读穿共享日历），而在 **(a) 变更没人被告知；(b) 没有"谁放的"这个事实；(c) 网站预约与人放的混在一起**。

### 1.2 成单 / 报价口径

| 现有口径 | 位置 | 问题 |
|---|---|---|
| 销售驾驶舱：成单 = `SalesOpportunity.stage ∈ {signed, completed}` 且 `wonAt ≥ 本月 1 日`，金额 = `estimatedValue` | `src/app/api/sales/cockpit/route.ts:108-111` | 用的是商机**估值**，不是签字金额 |
| 销售首页：成单 = `SalesQuote.status ∈ {signed, accepted}` 且 `signedAt ≥ 本月 1 日`，金额 = `grandTotal`；报价按 `createdAt ≥ 本月 1 日` | `src/lib/sales/home/build-home.ts:53, 233-247, 353` | 口径对，但**固定从 1 号起**，没有自选期间；"报出去多少钱"按创建日而不是发送日 |
| Muse `sales_overview` | `src/lib/muse-bridge/sales-pure.ts:301` | 只有 30 天内赢 / 输计数，**不算金额和**；决定 B 管金额可见性 |
| 周报 AI | `src/app/api/sales/cockpit/weekly-report/route.ts` | 直接 `new OpenAI()`、固定 7 天、把原始数据丢给模型自己算 |

结论：同一个"本月成单"在两个页面是两个数；要加期间参数和"按人"，先把口径收成一个纯函数，所有出口（看板 / Muse / 叙述）只认它。

---

## 2. 诉求 1 设计：日程归因与变更可见（CAL-1）

### 2.1 数据流

```
Google Calendar（共享日历，Sunny 全员 + 网站插件都往这里写）
        │  events.list(syncToken)  每 15 分钟（cron calendar-watch，复用 vercel cron）
        ▼
listCalendarChanges()  ── 新增：返回 id / status / created / updated / creator.email / organizer.email / summary / start / end / description / htmlLink
        │
        ▼
attributeCalendarEvent()  纯函数查表（§2.3）
        │
        ├─► AuditLog 账本（action = calendar.watch.observed；幂等：同 eventId 的 googleUpdated 不比上次新就不写）
        ├─► Notification（category = calendar_watch；sourceKey = calwatch:{calendarId}:{eventId}:{updated}:{recipient}）
        └─► 游标回写 settingsJson.calendarWatch.cursor[calendarId].syncToken
```

### 2.2 零 schema 落点

`Organization.settingsJson.calendarWatch`（纯函数 `readCalendarWatch / withCalendarWatch`，样式同 `muse-bridge/binding-pure.ts`）：

```jsonc
{
  "enabled": true,
  "readerUserId": "<用谁的 CalendarProvider token 去读，须对共享日历至少 reader>",
  "calendarIds": ["xxxx@group.calendar.google.com"],
  "websiteBookerEmails": ["<book-now 插件写日历用的 Google 身份，判断点 2>"],
  "websiteMarkers": ["Booked via", "book-now"],           // summary / description 命中即网站预约
  "notifyPositions": ["owner", "ops_lead"],              // 变更通知收件岗位（判断点 7）
  "cursor": { "<calendarId>": { "syncToken": "...", "lastRunAt": "...", "lastError": null, "fullSyncFrom": "2026-09-01" } }
}
```

- 配置入口：`PUT /api/organizations/[orgId]/calendar-watch-settings`（org_admin 及以上，同 `tender-rfq-settings` 样式），每次保存写 AuditLog。
- 账本：`AuditLog`（`orgId`、`action=calendar.watch.observed`、`targetType=google_calendar_event`、`targetId={calendarId}/{eventId}`、`afterData` = 下表 JSON）。**不建镜像表**；统计从账本算。
- 通知：`Notification`，`sourceKey` 唯一做幂等；`metadata` 带归因与 `htmlLink`。

账本 `afterData` 固定字段：

| 字段 | 说明 |
|---|---|
| `kind` | `created` / `updated` / `cancelled` |
| `googleCreated` / `googleUpdated` | Google 侧时间戳（幂等依据） |
| `creatorEmail` / `organizerEmail` | 原样 |
| `start` / `end` / `allDay` / `summary` | 原样（summary 截 120 字） |
| `attribution.source` | `qingyan` / `member` / `website` / `unknown` |
| `attribution.userId` / `attribution.bucket` | 归到的成员与桶：`sales` / `ops` / `management` / `other`；网站与不明为 null |
| `attribution.rule` | 命中的规则编号（可解释） |
| `appointmentId` | 命中青砚预约时带 |
| `diff` | `updated` 时才有：`{ start?: [旧, 新], end?: [...], summary?: [...] }` |

### 2.3 归因规则（纯函数，按序首个命中，不猜）

| # | 条件 | 归因 |
|---|---|---|
| R1 | `eventId` 命中任一 `Appointment.googleEventId` | `qingyan`，userId = 该预约 `createdById`，bucket 按岗位派生 |
| R2 | `creatorEmail` 命中组织活跃成员的 `User.email` 或其 `CalendarProvider.accountEmail`（大小写不敏感） | `member`，userId = 该成员；bucket 用 `src/lib/rbac/effective-platform-role.ts` 的派生角色：`sales` → sales、`operations` → ops、`boss` → management、其余 → other |
| R3 | `creatorEmail` ∈ `websiteBookerEmails`，或 `summary / description` 命中任一 `websiteMarkers` | `website` |
| R4 | 其余 | `unknown`（单列展示，附 creatorEmail 供人补规则） |

- bucket 依赖 PERM-4c4 的"岗位派生平台角色"，压扁前后口径一致。
- **修改的归因**：Google API 不提供"最后修改人"。`updated` 事件只报"改了什么"（§2.2 `diff`），**不报谁改的**；唯一例外是青砚自己推的修改（R1 命中且 `Appointment.googleSyncedAt` 在本次 `googleUpdated` ± 2 分钟内）归到该预约最后操作人。文案要诚实："Google 侧改动，修改人未知"。
- **若 Sunny 全员共用一个 Google 登录写日历**（判断点 1），R2 全部塌缩成同一个人，归因就只剩 青砚 / 网站 / 其他 三类；那样 CAL-1 仍值得做（变更通知 + 网站占比），但"按销售统计"只能靠大家从青砚放预约。

### 2.4 变更通知

- 收件人 = `notifyPositions` 岗位持有人（复用 `src/lib/trade/recipients.ts` 的"按岗位找人"方式） ∪ R1 命中时该预约的 `assignedToId`；创建者本人不收自己的 `created`。
- 文案（≤ 60 字首行，沿用 Muse 建议式回复风格）：
  - `created`：`【网站预约】10/30 14:00–15:00 量房 — Smith（Google 侧新建）`
  - `updated`：`【日程改动】10/30 量房 14:00 → 16:00（Google 侧改动，修改人未知）`
  - `cancelled`：`【日程取消】10/30 量房 Smith（Google 侧删除）`
- 只走站内 Notification。微信 / Muse 推送本次不做（Out of scope；若要，CAL-2 里以 `category=muse_bridge` 事件 `calendar.changed` 接入既有 outbox）。

### 2.5 统计

`GET /api/sales/calendar/attribution?from&to`（`authorize(sales.analytics.read)`：ORG 看全员；PRINCIPAL 只看自己一行）：

```jsonc
{
  "period": { "from": "2026-10-01", "to": "2026-10-28", "timezone": "America/Toronto" },
  "bySource": { "qingyan": 12, "member": 31, "website": 9, "unknown": 2 },
  "byActor": [ { "userId": "...", "name": "Alex", "bucket": "sales", "created": 14, "updated": 3, "cancelled": 1 } ],
  "unknownSamples": [ { "creatorEmail": "x@y.com", "summary": "...", "htmlLink": "..." } ]
}
```

- "期间"按 Google 事件的 **`googleCreated` 落在期间**（谁在这段时间放了日程），不是按日程开始时间；页面上两者都给一个开关。
- UI：`/sales/calendar` 侧栏加"本月日程来源"卡（管理层可见）；KPI-1 的期间看板同时引用。

### 2.6 cron

- `vercel.json` 加 `/api/cron/calendar-watch`，`*/15 * * * *`；`requireCronSecret` + `runTrackedAutomation("calendar-watch")`，与 `tender-rfq-inbound` 同一套（P1-4 先例，不是新队列）。
- 每个 `calendarWatch.enabled` 的组织、每个 `calendarIds`：有 syncToken → 增量；无 → 从 `fullSyncFrom`（默认 60 天前）全量并拿 `nextSyncToken`；`410 Gone` → 清 token 重做全量。
- token 过期 / 无权限：写 `cursor.lastError`，给 `readerUserId` 一条"重新连接 Google 日历"通知；下个 tick 再试，不做退避表（保持确定性，15 分钟一次本身就是退避）。
- 一次 tick 单组织最多处理 500 条变更，剩余留到下一 tick（游标天然续上）。

### 2.7 否决的备选

| 备选 | 否决理由 |
|---|---|
| Google push（`events.watch` webhook） | 要公网回调 + 通道 7 天续期 + 通道注册表，等于再造一个 scheduler；15 分钟轮询够用 |
| 让所有人只从青砚放日程、Google 只读 | 管不住网站插件；也改变全员习惯，先不做 |
| 镜像到 `CalendarEvent` 表 | 没有 JSON 位放归因，要加列（违反零 schema）；读穿已满足"看到" |
| 把归因存 `Notification.metadata` 当账本 | Notification 是给人看的收件箱，会被清理 / 已读；AuditLog 才是账本 |

---

## 3. 诉求 2 设计：期间看板 + 洞察（KPI-1）/ LLM 叙述（KPI-2）

### 3.1 一套口径（纯函数 `summarizeSalesPeriod`，`src/lib/sales/period/summary-pure.ts`）

输入：期间 `[from, to]`（组织时区当地日，含两端）、读范围、取数结果；输出下表。所有出口（看板 API、Muse、叙述）只认这一个函数。

| 指标 | 定义 | 备注 |
|---|---|---|
| **成单数** | `SalesQuote.status ∈ {signed, accepted}` 且 `signedAt ∈ 期间`；同一 `opportunityId` 多份已签只计最新 `signedAt` 的一份；无商机的按报价计 | 判断点 3、5 |
| **成单金额** | 上述报价 `grandTotal` 之和（含税 CAD）；另给 `preTaxTotal` 和 | |
| **报价数（报出去）** | `SalesQuote.sentAt ∈ 期间` 且 `status ≠ draft`；同一 `opportunityId` 多版本只计最新 `sentAt` 的一份 | sent / viewed / accepted / signed / rejected / expired 都算"报出去了" |
| **报价金额（报出去多少钱）** | 上述报价 `grandTotal` 之和 | 就是用户问的"一共报了多少钱出去" |
| **转化率** | 成单数 / 报价数 | 非同批，页面标注"同期口径" |
| **在手未签** | `sentAt ∈ 期间`、`signedAt = null`、`status ∈ {sent, viewed}` 的数量与金额，以及其中 `sentAt` 距今 > 14 天的子集 | 给洞察 I3 用 |
| **定金** | `depositCollectedAt ∈ 期间` 的 `depositAmount` 之和 | |
| **按人** | 以上全部按 `SalesQuote.createdById` 拆 | 判断点 4 |
| **对比** | 上一期（同长度紧邻）与上月同期（同日窗）两组 | 变化率 = (本期 − 对比期) / 对比期；对比期为 0 时不给比率 |
| **日程** | CAL-1 启用时附 §2.5 的 `bySource / byActor` | |

- 范围：`authorize(sales.analytics.read)`；ORG → 全企业 + 按人；PRINCIPAL → 只本人、不返回他人行、`byRep` 只有自己。网页端本人可见本人金额（与现有销售首页一致）；Muse 端沿用决定 B。
- 不读 `SalesOpportunity.estimatedValue` 当成单金额（那是估值）；驾驶舱旧口径本次不改，但 UI 标签改成"商机估值"以免两数打架（见 KPI-1 tasks）。

### 3.2 API

`GET /api/sales/period-summary?from=2026-10-01&to=2026-10-28&compare=prev_period|prev_month`

```jsonc
{
  "period": { "from": "2026-10-01", "to": "2026-10-28", "days": 28, "timezone": "America/Toronto" },
  "scope": "org",
  "totals": { "wonCount": 23, "wonAmount": 61230.5, "wonPreTax": 54186.3, "quotedCount": 57, "quotedAmount": 182400, "conversionRate": 0.40,
              "openQuotedCount": 21, "openQuotedAmount": 70100, "staleOpenCount": 6, "staleOpenAmount": 19800, "depositAmount": 18200 },
  "comparison": { "kind": "prev_period", "period": {...}, "totals": {...}, "delta": { "wonAmount": 0.18, "quotedAmount": -0.07, ... } },
  "byRep": [ { "userId": "...", "name": "Alex", "wonCount": 9, "wonAmount": 24100, "quotedCount": 20, "quotedAmount": 66000, "conversionRate": 0.45 } ],
  "calendar": { "bySource": {...}, "byActor": [...] },      // CAL-1 未启用时为 null
  "insights": [ { "code": "I1_WON_UP", "severity": "info", "text": "本期成单金额 61,231，较上一期 +18%", "evidence": { "wonAmount": 61230.5, "prevWonAmount": 51900 } } ],
  "narrative": null                                          // KPI-2 才有
}
```

- `from/to` 缺省 = 本月 1 日至今天；最长 366 天；`to < from` → 400。
- 期间边界用 `resolveOrgTimezone` 换成 UTC 再查库。

### 3.3 看板 UI

- `/sales/home` 顶部加期间选择器：本月至今（默认）/ 上月 / 本季 / 最近 30 天 / 自定义；选择持久化在 URL query。
- 六个 KPI 瓦片：成单数、成单金额、报价数、报价金额、转化率、在手未签（含 >14 天子集）；每个瓦片右下角显示对比期变化。
- "按人"表：管理层可见全员行，可按成单金额 / 报价金额排序；销售只看到自己一行。
- "洞察"列表：§3.4 的 `insights`，按 severity 排序，每条可展开 `evidence`。
- "日程来源"卡：复用 §2.5（CAL-1 未启用显示"未配置日历观察"）。

### 3.4 第一层"AI 分析" = 确定性洞察（零 LLM，`period-insights.ts`，表驱动）

| code | 触发 | 文案骨架 | severity |
|---|---|---|---|
| I1_WON_DELTA | 成单金额环比 ≥ +20% 或 ≤ −20% | 本期成单 {amount}，较{对比期} {±pct}% | info / warn |
| I2_QUOTED_DELTA | 报价金额环比 ≥ ±20% | 本期报出 {amount}，较{对比期} {±pct}% | info / warn |
| I3_STALE_OPEN | 在手未签 >14 天的金额 ≥ 在手未签总额 30% 或条数 ≥ 5 | {n} 份报价报出超过 14 天未签，合计 {amount}，最大一份 {top}（{rep}） | warn |
| I4_LOW_CONVERSION | 报价数 ≥ 10 且转化率 < 30% | 转化率 {pct}%（{won}/{quoted}），低于 30% | warn |
| I5_REP_SILENT | 某销售本期报价数 = 0 且上一期 > 0 | {rep} 本期没有报出报价（上一期 {n} 份） | warn |
| I6_REP_CONCENTRATION | 单人成单金额 ≥ 全企业 60%（且企业成单数 ≥ 5） | 成单金额 {pct}% 集中在 {rep} | info |
| I7_DEPOSIT_GAP | 已签但未登记定金的报价 ≥ 3 | {n} 份已签报价未登记定金，合计 {amount} | warn |
| I8_CAL_UNKNOWN | 日程不明来源 > 0 | {n} 条日程来源不明（creator: …），请补规则 | info |
| I9_CAL_WEBSITE_SHARE | 网站预约占本期新建日程 ≥ 40% | 网站自主预约占 {pct}%，共 {n} 条 | info |

- 每条规则一个测试用例（触发 / 不触发 / 边界），阈值在同一张表里，改阈值不改代码路径。
- 销售本人范围只出与本人相关的规则（I3 / I4 / I7），不出 I5 / I6。

### 3.5 第二层"AI 分析" = LLM 叙述（KPI-2，独立 change，判断点 6）

- 输入：§3.2 的 JSON（数字已算好）+ `insights`；提示词固定三段：**本期结论（≤ 3 句）/ 为什么（引用 insights）/ 下一步（≤ 3 条，只能从固定动作词表里选：催签、补定金、看某销售、补日程规则）**。
- 硬约束：**模型不得产生输入里没有的数字**；后处理把输出里所有数字（含千分位 / 百分比）与输入 JSON 的数值集合比对，任一对不上 → 整段丢弃，`narrative = null`，看板回落到第一层。这是"确定性优先"在 LLM 层的落法。
- 调用：`createCompletion`（`src/lib/ai/client.ts`）`mode: "fast"`，模型经 `ProviderRouter`，**不**像周报那样 `new OpenAI()`；用量走既有 `AiUsageLedger`。
- 触发：看板上"生成解读"按钮按需调用，不进 cron、不缓存到 settingsJson；开关 `SALES_PERIOD_NARRATIVE_ENABLED`（默认关）。
- 与纪律 7 的关系：这是一次**新增 LLM 调用**，和 `openspec/config.yaml` 第 7 条"不增加新的 LLM 调用"冲突 → 必须 Evan 拍板，拍板后在 config.yaml 第 7 条加一句例外（"期间看板叙述层除外，数字不得由 LLM 产生"）。不拍板就只交付 KPI-1。

### 3.6 Muse 顺带

`sales_overview` 可加可选参数 `period: { from, to }`，data 里附 `summarizeSalesPeriod` 的 `totals`（决定 B：金额只对管理范围输出）。放在 KPI-1 最后一条 task，契约只追加。

### 3.7 否决的备选

| 备选 | 否决理由 |
|---|---|
| 扩 `build-home.ts` 加 from/to | 它一次算 20 多块面板，耦合首页；期间统计要被 Muse 和叙述复用，必须是独立纯函数 |
| 复用周报路由做"AI 分析" | 固定 7 天、直连 OpenAI、把原始行丢给模型自己加总——数字不可复现 |
| 让 LLM 查库 / 写 SQL | 违反确定性优先；同一问题两次答案不同 |
| 成单按 `SalesOpportunity.wonAt + estimatedValue` | 估值不是签字金额；Sunny 的合同就是签字的 Order Form |

---

## 4. 与八条硬纪律的关系

| # | 纪律 | 本设计 |
|---|---|---|
| 1 | 零 schema | 不加表不加列：配置与游标在 `Organization.settingsJson.calendarWatch`；账本在 AuditLog；通知在 Notification；期间统计是纯查询 |
| 2 | 出站先审批 | **不涉及**：CAL-1 只读 Google、只发站内通知；不写 Google、不发邮件、不改价 |
| 3 | 禁止第三套队列 | 新增一个 vercel cron 路由（与 `tender-rfq-inbound` 同机制），无 queue / lease / scheduler / worker registry |
| 4 | 脱敏 | Muse 侧 `period` 附加数据沿用决定 B；招投标三样不出现在本设计任何出口 |
| 5 | 不爬登录页 | **不涉及**：Google 走已授权的 OAuth API，不碰网站后台 |
| 6 | 邮箱分离 | **不涉及**：不用 Gmail；日历读取用 `readerUserId` 的 `CalendarProvider`，与 `EmailProvider` 无关 |
| 7 | 确定性优先 | 归因 = 查表；洞察 = 表驱动规则；KPI-2 的 LLM 只叙述、数字校验回落；**KPI-2 需要拍板一条例外** |
| 8 | 测试注册 | 每个 change 的 `__tests__/*.test.ts` 在同一 task 里注册进 `scripts/test-all.sh` |

---

## 5. 切 change（一个 change = 一个 PR，各 ≤ 8 tasks）

### KPI-1 `sales-period-summary` — 先做（没有外部依赖，用户最急的"10 月 1 日到 28 日"）

**Why**：同一个"本月成单"在两个页面是两个数，且都不能选期间、不能按人、没有"报出去多少钱"。

**What**
- 新增纯函数 `summarizeSalesPeriod`（§3.1 口径）与 `buildPeriodInsights`（§3.4 规则表），`src/lib/sales/period/`。
- 新增 `GET /api/sales/period-summary`（§3.2），`authorize(sales.analytics.read)`，期间用组织时区。
- `/sales/home` 加期间选择器 + 六瓦片 + 按人表 + 洞察列表（§3.3）；驾驶舱 `signedValue` 标签改为"商机估值（估）"。
- `sales_overview` 可选 `period` 参数，契约只追加（§3.6）。
- 测试：`period-pure.test.ts`（口径：去重 / 边界日 / 时区 / 对比期 / 范围）+ `period-insights.test.ts`（九条规则各三例）+ `period-db.isolated.test.ts`（ORG vs PRINCIPAL、跨企业不可见、Muse 金额决定 B）。

**Out of scope**：不动 `build-home.ts` 现有面板；不改驾驶舱口径（只改标签）；不做 LLM 叙述（KPI-2）；不做导出。

**验收**：`from=2026-10-01&to=2026-10-28` 返回的 `wonAmount` = 手工 SQL `SUM(grandTotal) WHERE status IN ('signed','accepted') AND signedAt BETWEEN …`（去重后）逐分一致；销售账号拿不到他人行；`openspec validate --strict` 通过；specs 增量覆盖：口径、范围、期间参数校验、洞察输出、Muse 附加数据五项对外行为。

### CAL-1 `calendar-watch-attribution` — 需先答判断点 1、2

**Why**：Google 里直接建 / 改的日程无人知晓，也无法按账号与来源（网站 / 销售 / 运营）统计。

**What**
- `google-calendar.ts` 新增 `listCalendarChanges(userId, { calendarId, syncToken?, timeMin? })`，返回 §2.2 字段；现有函数不动。
- 纯函数：`calendar-watch-pure.ts`（`readCalendarWatch / withCalendarWatch`、`attributeCalendarEvent` 四条规则、`diffEvent`、`shouldRecord(lastUpdated, updated)`、通知文案）。
- 账本 + 通知 + 游标回写：`calendar-watch.ts`；cron `/api/cron/calendar-watch`（`*/15`），`vercel.json` 登记。
- 配置：`PUT/GET /api/organizations/[orgId]/calendar-watch-settings`（org_admin 及以上；写 AuditLog）。
- 统计：`GET /api/sales/calendar/attribution`（§2.5）+ `/sales/calendar` 侧栏卡 + 接入 KPI-1 的 `calendar` 字段。
- 测试：`calendar-watch-pure.test.ts`（归因规则表、diff、幂等判定、文案）+ `calendar-watch-db.isolated.test.ts`（同一 updated 重放不重复写账本 / 通知；410 重置游标；收件人按岗位）。

**Out of scope**：不写 Google（不做双向）；不推微信 / Muse；不做网站 book-now 直连（CAL-2）；不处理重复事件的逐实例展开（`singleEvents=true` 交给 Google）。

**验收**：在共享日历手工建 / 改 / 删各一条，≤ 15 分钟后 owner 与 ops_lead 各收到三条站内通知且文案含"Google 侧"；账本三条、重跑 cron 不增；网站插件建的一条归到 `website`；统计 API 的 `bySource` 合计 = 账本 `kind=created` 条数。

### KPI-2 `sales-period-narrative` — 可选，判断点 6 拍板后

**What**：§3.5；一个服务函数 + 一个按钮 + 数字校验回落 + 开关；测试覆盖"输出含输入没有的数字 → 丢弃"。
**Out of scope**：不进 cron、不发邮件、不替换周报。

### CAL-2 `website-booking-intake` — 后续

把 book-now 从"写 Google"改成"先打青砚 webhook（复用 `/api/trade/webhook/website` 的签名 / 幂等方式）→ 建 `Appointment(type=measure, source 标网站)` → 青砚推 Google"，从源头精确归因并自动建客户 / 商机。前提是网站插件能发 webhook；拿不到就维持 CAL-1 的 R3 归因。

---

## 6. 运维前置（Lucas，CAL-1 实施前）

1. 确认 Sunny 共享日历的 ID（`xxx@group.calendar.google.com`）与 **读取账号**（建议 lucas@ 或 project@ 任一已连接 Google 日历的青砚账号，对共享日历至少 reader）。
2. 在 Google Calendar 打开一条 book-now 生成的日程，看"创建者"是哪个邮箱 → 填 `websiteBookerEmails`；若创建者就是共享日历本身，再看标题 / 描述里有没有固定字样 → 填 `websiteMarkers`。
3. 确认每位销售 / 运营是用**自己的 Google 账号**往共享日历写，还是共用一个登录（决定 R2 是否有效）。
4. 配置：`PUT /api/organizations/<orgId>/calendar-watch-settings`（CAL-1 交付后给出 body 示例）。

---

## 7. 判断点（先定，再 `/opsx:propose`）

| # | 问题 | 推荐 |
|---|---|---|
| 1 | 销售 / 运营是否各用自己的 Google 账号写共享日历？ | 若共用一个登录，CAL-1 范围收成"变更通知 + 青砚 / 网站 / 其他 三类"，并要求销售从青砚放预约才有按人统计 |
| 2 | book-now 插件写日历的身份是什么（创建者邮箱 / 固定字样）？ | 运维前置第 2 条查一下，填进配置即可，不改代码 |
| 3 | 成单口径：报价签字 `grandTotal`（含税） vs 商机 `wonAt + estimatedValue` | **报价签字**；页面同时给税前 |
| 4 | "按人"归属：报价创建人 vs 商机负责人 | **报价创建人**（钱是谁报的、谁签的） |
| 5 | 同一商机多版本报价：成单与报价各只计最新一份 | **是**；已签后改价回 draft 的旧版本不计 |
| 6 | 是否做 LLM 叙述（KPI-2），为此在 config.yaml 第 7 条开一个例外 | 先交付 KPI-1；KPI-2 开关默认关，拍板后再 propose |
| 7 | 变更通知收件人 | **owner + ops_lead**（可配置）；不是全员，避免噪音 |
| 8 | 通知渠道 | 站内；Muse / 微信留 CAL-2 |
| 9 | 实施顺序 | **KPI-1 → CAL-1 → KPI-2 → CAL-2** |
