# QINGYAN CAL-1 报告 — Google 日历变更观察与归因（calendar-watch-attribution）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-29 |
| TASKFLOW | CAL-1（Phase K — Sunny 日程归因与期间看板） |
| OpenSpec change | `openspec/changes/calendar-watch-attribution/` |
| 分支 | `claude/magical-shannon-keegzr`（实施中合入 origin/main `57549cf1`） |
| 设计稿 / 交接 | `docs/QINGYAN_SUNNY_SCHEDULE_KPI_DESIGN.md` §2；`docs/QINGYAN_SUNNY_SCHEDULE_KPI_HANDOFF.md` |

## 1. 做了什么

| 部分 | 文件 | 说明 |
|---|---|---|
| 纯函数核心 | `src/lib/calendar-watch/{types,pure}.ts` | 配置读写 / 校验 / 合并（保留游标）、Google 事件映射与 `events.list` 参数、归因 R1–R4、分桶、幂等 / 变更类型 / 差异、账本 afterData（不含描述，标题截 120 字）、通知判定 / 收件人 / 文案、期间统计 |
| Google 只读增量 | `src/lib/google-calendar.ts` 末尾 `listCalendarChanges` | `syncToken` / `pageToken`、`singleEvents=false`、`maxResults=2500`、不带时间过滤；410 → `GoogleSyncTokenExpiredError`，授权失效或无连接 → `GoogleTokenExpiredError`。现有函数未动 |
| 执行器 | `src/lib/calendar-watch/run.ts` `runCalendarWatch(deps?)` | 遍历开启的组织与日历；每轮每日历最多 4 页、整体 200 秒预算；逐页回写游标；先发通知（`sourceKey` 幂等）再写账本；组织 / 日历出错互不影响 |
| 定时任务 | `src/app/api/cron/sales-actions/route.ts`、`src/lib/automation/registry.ts` | 末尾追加第三个受跟踪步骤 `calendar-watch`；前两个步骤 diff 为零；无新 cron |
| 设置接口 | `src/app/api/organizations/[orgId]/calendar-watch-settings/route.ts`、`src/lib/calendar-watch/settings.ts` | `GET` / `PUT`，`sales.settings.manage`；错误码 `READER_NOT_CONNECTED` / `CALENDAR_NOT_ACCESSIBLE` / `INVALID_SETTINGS`；写审计 `calendar.watch.settings_updated`；`GET` 不含令牌 |
| 统计接口 | `src/app/api/sales/calendar/attribution/route.ts`、`src/lib/calendar-watch/stats.ts` | `sales.analytics.read`；期间解析复用 KPI-1 `resolvePeriodParams`；org 给 `bySource` / `byActor` / `unknownSamples`，own 只给本人一行；账本上限 20,000 行，超出 `truncated: true` |
| KPI-1 接入 | `src/lib/sales/period/{types,load}.ts`、`src/components/sales-command-center/sales-period-panel.tsx` | 全企业范围且观察开启时 `calendar = { bySource, byActor, truncated }`；I8 / I9 随之生效（规则未改）；面板"日程来源"一块，`calendar` 为空不渲染 |
| 测试 | `calendar-watch-pure.test.ts`（test-all + test-ci-unit）、`calendar-watch-db.isolated.test.ts`（test-all）、`period-db.isolated.test.ts` 补 5 项 | 见 §2 |

无 schema 变更、无新 cron / 队列、无出站、无 LLM；对 Google 只读，对青砚只追加审计与通知、回写 `settingsJson.calendarWatch`。

## 2. 怎么验

| 检查 | 结果 |
|---|---|
| `npx tsx src/lib/calendar-watch/__tests__/calendar-watch-pure.test.ts` | 175 通过 0 失败 |
| 纯测试变异检查（临时副本，未提交） | 改归因顺序（成员先于网站）、账本存描述、新建不排除创建者 → 5 项变红 |
| `calendar-watch-db.isolated.test.ts`（隔离库 127.0.0.1:5433） | 80 通过 0 失败：设置 403 / 400×5 / 200；读取账号离开企业；基线前日程被改、重复系列单次例外、同一事件在两个观察日历；全量 300 条历史零通知、只记基线后新建、第 2 页出错后按 `p2` 续读；增量新建 / 修改 / 删除 / 青砚推送的账本、归因与收件人；重放幂等；410；授权失效当天一次；两组织互不影响；统计 org / own；`PUT {enabled:false}` 回滚保留游标；只读 Google、预约表不变 |
| 端到端变异检查（临时，已还原） | 去掉执行器 `shouldRecord` → 3 项变红（通知仍靠 `sourceKey` 不重复）；`sourceKey` 加回日历 ID + 去掉单次例外规则 → 5 项变红 |
| 无 `DATABASE_URL` 跑端到端 | 打印跳过，退出 0 |
| `period-db.isolated.test.ts` | 26 → 31，全过（未开启为 null、开启后网站 4 / 成员 6、按成员新建数、I9 出现、销售范围为 null） |
| 回归：period-pure / period-insights / Muse sales-pure / muse-bridge-pure / Muse sales-db | 48 / 38 / 84 / 67 / 36，全过 |
| `google-calendar-write-id.test.ts` | 10 通过（写路径未受影响） |
| `action-loop-contract.test.ts` | 3 过 1 失败，与 main 相同（第 4 项为既有失败，已列在 `ci/test-registry-baseline.txt`） |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出 0 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `npm run test:ci` | 退出 0，`CI unit subset PASS` |
| `bash scripts/check-test-registry.sh` | 通过；已注册 479 个（合入 main 前 477 + 本 change 2） |
| `openspec validate calendar-watch-attribution --strict` | valid |
| `npm run build` | 退出 0；两条新路由在产出表中 |
| 隔离库全量 `npm test` | 失败项与 main 相同（§6） |
| PR CI `validate-lint-typecheck-test-build` | 绿（§6） |

真实浏览器检查（`next start -p 3100` + Playwright，种子脚本只写本机测试库，未进仓库）：

| 检查 | 结果 |
|---|---|
| 老板打开 `/sales/home?from=2026-10-01&to=2026-10-28`，未开启观察 | 期间面板正常，无"日程来源"块，无错误提示 |
| 开启观察后同一地址 | "日程来源（期间内新建，按 Google 创建时间）· 共 12 条"：青砚 1 / 成员 6 / 网站预约 4 / 不明 1；"按成员：Riley Rep（销售）5 条、Morgan Ops（运营）2 条"；洞察"1 条日程来源不明，请补归因规则"（I9 未触发：4 / 12 < 40%） |
| 销售打开同一地址 | 无"日程来源"块 |
| 手机宽度 390px | 无横向溢出；无页面错误 |

## 3. 对设计稿 §2 的偏离与实施中的修订（均已同步 spec / design / proposal）

**propose 时已定（设计稿 → change）：**

1. **D1 挂既有定时任务**：设计稿 §2.6 原案新建 `/api/cron/calendar-watch`；改为 `/api/cron/sales-actions` 的第三个受跟踪步骤（纪律第 3 条"复用既有 cron"，节奏同为 15 分钟，S3 已有挂入先例）。
2. **D6 授权键**：设计稿 §2.2 原案 `org_admin`（`requireOrgRole`，不识别岗位模式）；改为 `sales.settings.manage`。
3. **D2 全量不带时间过滤**：`syncToken` 要求后续参数与首次全量一致，带 `timeMin` 的全量会让增量处于未定义行为；基线起点在我们这边按 `created` 过滤。
4. **账本不存描述**：描述只在归因时匹配网站标记，不进账本（避免客户电话、门禁码等进审计表）。
5. **别名表**：`memberEmailAliases`（`{ 邮箱: 成员ID }`）放在配置里，代替给成员加 Google 邮箱字段（零 schema）。
6. **展示只在期间面板**：不做 `/sales/calendar` 侧栏卡（设计稿 §2.5），避免重复展示。

**apply 时修订：**

7. **网站规则先于成员规则**：顺序改为 R1 青砚 → R2 网站 → R3 成员 → R4 不明。原因：book-now 写日历用的 Google 账号常常同时是某成员的日历连接邮箱（甚至就是读取账号），成员在前会把网站预约全算到该成员名下；网站账号与标记都是显式配置。
8. **删除事件沿用上一条账本**：增量里的删除通常只有 `id` 与 `status`；标题、时间、创建者与归因沿用上一条账本（预约仍持有该事件时按 R1 重判）。
9. **不发通知的情形**：基线记录；青砚来源的新建；青砚推送的修改（`googleSyncedAt` 与 `updated` 相差 ≤ 2 分钟）；青砚解除同步造成的删除（上一条归因青砚、已无预约持有该事件 ID，`unsyncAppointmentFromGoogle` 会清空 `googleEventId`）；标题与起止时间都没变的修改；既无标题又无时间的删除。都照常记账本。
10. **统计口径**：新建按 Google 创建时间、修改 / 删除按 Google 更新时间落在期间；按成员的修改 / 删除数指该成员名下（归因为其创建）的日程被修改 / 删除的次数。
11. **增量首次见到、创建早于基线的事件**记为 `updated`（与 design Risks 一致，不冒充新建）。

**实现层决定（未改 spec）：**

12. 换读取账号时清空全部游标重做全量（同步令牌与授权绑定；账本幂等保证不重复记账、全量阶段不发通知）。
13. `PUT` 只在合并后为开启时才查 Google 连接与日历可见性，保证 `{ enabled: false }` 回滚不被失效的授权挡住；Google 列表接口其它错误返回 502 `GOOGLE_API_ERROR`。（`/opsx:verify` 指出 spec 原文未写明，已补进 spec 与 design D6，并加场景"关闭不查 Google"。）
14. 分桶：`deriveEffectivePlatformRole` 的 boss，以及旧模式 / 保留角色里的 manager / admin / super_admin → `management`。
15. 通知 `type = calendar_event`（既有类型，已在通知偏好白名单里）、`category = calendar_watch`；读取账号授权失效的重连通知 `sourceKey = calwatch:reconnect:{orgId}:{readerUserId}:{当地日期}`。
16. 删除事件没有 `updated` 时，账本用观察时间、通知 `sourceKey` 用固定版本 `cancelled`，保证重试不重复。

**独立审查后修订（只读审查代理，未看我的结论；四条正确性问题逐条复现后修复，均有测试且做过变异检查）：**

17. **基线前创建的日程被改不通知** → 修改 / 删除时此前没有账本的标 `firstObserved`，修改按现值通知（"现为 11/10 16:00–17:00 … 此前未记录原值"）。已补 spec 场景"基线前创建的日程被改"。
18. **重复系列的单次例外被当成新建** → 第一次见到的例外（`recurringEventId` 有值）增量记 `updated`、全量不记；字段与归因沿用系列账本但不沿用系列起止；被删的例外用 `originalStartTime`。
19. **同一事件在两个观察日历重复通知** → 通知 `sourceKey` 去掉日历 ID（账本仍按日历分别记，统计本就按事件去重）。已补 spec 场景"同一事件在两个观察日历"。
20. **读取账号不是在职成员时错误码** → 改为 spec 规定的 `READER_NOT_CONNECTED`。
21. 低优先级一并修：时间预算从 cron 请求开始算（240 秒，留 60 秒余量）；读取账号离开企业后执行器记 `reader_not_member`、不再用其授权；由关闭转为开启时清空游标重做基线（不补发暂停期间的积压）；`notified` 只计真正新建的通知。

## 4. 已知限制

- **修改人未知**：Google 接口不提供最后修改人；修改通知一律写"修改人未知"（青砚推送的除外，不发）。
- **私人邮箱需别名**：销售用私人 Google 账号写共享日历时 R3 认不出，需在 `memberEmailAliases` 配置；统计接口的不明来源样例与洞察 I8 会提示。
- **基线前创建的日程没有 `created`**：首次全量只记基线起点（缺省 60 天前）之后创建的事件；更早的日程以后被修改会记为 `updated`，不计入"新建数"。
- **删除缺信息**：基线前创建、从未进账本的事件被删时 Google 只给 `id`，只记账本不发通知。
- **重复日程计一次**：`singleEvents=false`，一个系列计一次，单次例外作为修改出现。
- **观察日历须在读取账号的日历列表首页且未隐藏**：`PUT` 校验复用现有 `listGoogleCalendars`（只取第一页、不含隐藏日历），日历很多或被隐藏时会误报 `CALENDAR_NOT_ACCESSIBLE`；处理：在 Google 里取消隐藏该日历。
- **审计表量级**：每条变更一行 `calendar.watch.observed`，会出现在审计中心；Sunny 每月百到千级。统计按单列索引加 2 万行上限，超出标 `truncated`。
- **竞态窗口**：执行器回写游标与 `PUT` 都先重读再写，未加行锁；同一秒内并发时最坏是下一轮多读一次（账本幂等兜底）。
- **上线需真实日历人工验收**：本 change 的端到端全部用注入的假读取函数；真实 Google 的 410 与删除事件字段以 `googleapis` 类型说明为依据，未在真实账号上跑过。

## 5. 运维上线步骤

前置信息（设计稿 §6）：

1. **共享日历 ID**（Google 日历设置 → 集成日历 → 日历 ID，形如 `xxxx@group.calendar.google.com`）；
2. **读取账号**：一位在职成员，已在青砚日历页连接 Google 日历，且能看到该共享日历；
3. **book-now 写日历的身份**：网站插件写入用的 Google 账号邮箱，和 / 或它写进标题 / 描述的固定字样。

由持"老板"岗位（`sales.settings.manage`）的账号调用：

```bash
curl -X PUT "https://<青砚域名>/api/organizations/<orgId>/calendar-watch-settings" \
  -H "content-type: application/json" -H "cookie: qy_session=<会话>" \
  -d '{
    "enabled": true,
    "readerUserId": "<读取账号的青砚用户 ID>",
    "calendarIds": ["<共享日历 ID>"],
    "websiteBookerEmails": ["<book-now 写日历用的邮箱>"],
    "websiteMarkers": ["<book-now 写进标题或描述的固定字样>"],
    "memberEmailAliases": { "<销售私人邮箱>": "<该销售的青砚用户 ID>" },
    "notifyPositions": ["owner", "ops_lead"],
    "baselineFromDays": 60
  }'
```

之后：

1. 下一轮 `sales-actions`（15 分钟内）开始全量建基线，不发通知；`GET` 同一地址看每个日历的 `phase` 由 `full` 变为 `incremental`。
2. 用真实共享日历建 / 改 / 删各一条做人工验收：15 分钟内老板与运营主管收到站内通知、账本三条、再跑一轮不增加。
3. 回滚：`PUT { "enabled": false }` 即停，游标保留；revert PR 不留数据问题（账本与通知只追加）。

## 6. 全量测试

隔离库（127.0.0.1:5433）全量 `npm test`，分支与 origin/main `57549cf1`（同库、同环境的独立工作树）各跑一次：

| | 通过 / 总数 | 失败 |
|---|---|---|
| 分支 | 485 / 498 | 13 |
| main | 484 / 496 | 12 |

- 总数差 2 = 本 change 新注册的两个测试。
- 两边共同失败的 12 项完全相同，与本 change 无关：`TypeScript 类型检查`（test-all 里不带 `--max-old-space-size`，本容器 Node 22 堆溢出；单独 `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0，CI 也绿）、Phase3A-3 / 3A-4（两项）/ 3A-5 / 3B-A、Gmail Draft OAuth Compose Scope、Mention Gateway M2-A Identity DB、Sunny 工艺单 DB 端到端、T4 授标情报 Postgres 矩阵、Quote Operations 客户报价 PDF 分页布局、招标询价催单执行器。
- 只在分支失败的 1 项是 `日历观察纯函数核心（CAL-1）`：全量运行期间我正在按独立审查改 `sourceKey`，该测试恰好在源码与用例不一致的窗口里执行（159 过 2 失败，失败项正是 sourceKey 形态）。改完后单独重跑 175 / 0，`calendar-watch-db.isolated` 80 / 0、`period-db.isolated` 31 / 0。

PR [LucasJ880/-#323](https://github.com/LucasJ880/-/pull/323) CI `validate-lint-typecheck-test-build`：绿（2026-10-29，提交 `081f22b3`，含 `npm run build`）。
