# MAIL-2 报告：客户来信提醒

| 项 | 值 |
|---|---|
| change | `mail-watch` |
| TASKFLOW | MAIL-2（Phase M「邮箱助手」） |
| 任务书 | `docs/QINGYAN_MAIL-1_MAILBOX_ASSISTANT_TASKBRIEF.md`（MAIL-2 一节；判断点 1–7 已拍板，判断点 8 未定、按 A 执行） |
| PR | #470 |
| 状态 | #470，2026-11-15 合并；archive `openspec/changes/archive/2026-11-15-mail-watch`；主规格 `openspec/specs/mail/inbound-watch/spec.md`（20 条要求）。开关默认关，生产未启用；§3 的待拍板项与 §7 的未验证项仍然有效 |
| 分支 | `claude/mail-watch`（MAIL-1 的 PR #455 已合并；本分支已合入 main `363afc7c`（含 #475 的归档），与 NAV-1c 在客户时间线上的两处冲突已解决：两个入口都保留） |
| 开关 | 新增环境变量 `MAIL_WATCH_ENABLED`，**默认关**。合并后不设它，线上零变化：`sales-actions` 每轮多记一条「mail-watch：跳过，平台开关未开」 |
| 性质 | 新能力。零 schema、零出站、零模型调用、不新增定时任务或队列；`vercel.json` 与 Prisma schema 无 diff；不改 `muse-bridge`、`approval-gate.ts`、`pre-execute-guard.ts`、导航注册表 |

## 1. 做了什么

成员本人在 `/settings/email` 勾选「客户来信提醒」后，既有的 `sales-actions` 定时任务（每 15 分钟）多一个 `mail-watch` 步骤：

1. 只读这位成员**本人**绑定的 Gmail 收件箱里新到的信，只取元数据（发件人、主题、时间、标签、线程），不取正文。
2. 查表归类，不调模型：发件地址是本组织一位对邮箱主人可见的客户的邮箱 → 客户来信；线程里有青砚发出的信且对应客户对邮箱主人可见 → 客户回信；其余 → 未匹配。自己发出的、垃圾箱、促销 / 社交 / 论坛分类、在途询价线程 → 跳过。
3. 命中的信：给邮箱主人一条站内通知「客户来信：〈客户名〉」（正文是主题），已绑定微信的同时推一条；客户时间线记一条入站邮件互动；账本记一条 `mail.watch.observed`。
4. 未匹配与跳过的信不逐封留痕，只在每个邮箱每轮一条的汇总 `mail.watch.run` 里计数。

三道开关都开才跑：平台 `MAIL_WATCH_ENABLED` ∧ 组织开关（持销售设置管理权限的人在邮箱绑定页开）∧ 成员本人勾选。首次勾选只记起点，不回溯旧信；取消勾选即删游标。

客户时间线上，来信观察建的条目带「让助手读这封信」：打开助手并预填「帮我读一下〈客户名〉在 X 月 X 日发来的邮件」，由用户自己发送（接到 MAIL-1 的读信）。

## 2. 拍板与确认的最终取值

| 项 | 取值 | 来源 |
|---|---|---|
| 待拍板 C：主题写在时间线的哪里 | **C1**：标题固定为「客户来信（邮件）」，主题放在内容里（「主题：…」） | Lucas 2026-11-15「C1，D2 四件套批准」 |
| 待拍板 D：已绑定 Muse 的人走不走 Muse | **D2**：不走；所有人都是站内通知 + 微信。没有碰 `muse-bridge` | 同上 |
| 判断点 8：公共地址来信要不要同时提醒客户负责人 | **未定，按 A 执行**：只提醒邮箱主人。负责销售不收通知，但在客户时间线上看得到。改成 B 只动收件人算法一处（`inboundRecipients`，已留 `recipientMode` 参数） | 任务书 |
| 待确认 E：`sales@` / `info@` 的信进个人邮箱后发件人会不会被改写 | **仍缺一封真实样本**。本期按 `From` 匹配；如果被改写，只需改 `senderAddress` 一个函数 | 任务书「不确定处」 |

## 3. 需要你知道 / 拍板的发现

### 3.1 只有销售岗位的成员打不开助手页（影响 MAIL-1 的可用范围）

本地截图时发现：岗位模式下只持销售岗位的成员（夹具里的 Lynn）访问 `/assistant` 会被页面路由门重定向到销售首页。原因是 VIS-1 判断点 5 的执行结果——「数字员工」不再出现在纯销售侧栏（`work-assistant` 没有 `salesWorkspaceVisible`），路由门用的是同一张表。网页上调用助手对话接口的只有 `/assistant` 页与项目内的 AI 对话。

这带来两件事：

- **本 change 已处理的**：「让助手读这封信」入口在助手页对本人不放行时不显示（判定用 `useNavigationAccess().canOpen("/assistant")`，与路由门同一套），避免点了被弹回。规格已写入。截图 `08`（老板，能打开助手页，有入口）与 `10`（纯销售，没有入口）。
- **本 change 没有处理、需要拍板的**：MAIL-1 的读信工具只在网页助手对话里出现，所以这类成员在网页上目前**用不了读信**——接口与工具对他们是放行的（MAIL-1 的本地验收直接调的消息接口，所以当时没有暴露），但页面进不去。MAIL-1 报告与 PR #455 描述里「Lynn 一组」的验证方式是调真实接口，没有覆盖页面这一层，这一点当时没有写明。`MAIL_READ_ENABLED` 默认关，线上暂无影响。

可选的做法（都不在本 change 里做）：A 给纯销售恢复助手页入口（改 VIS-1 判断点 5，涉及导航注册表）；B 在销售工作区里另放一个只面向读信的对话入口；C 维持现状，读信只对能打开助手页的人（老板、管理岗、兼任其它岗位的人）可用。生产里 Lynn 实际持哪些岗位我看不到，需要先核对。

### 3.2 来信会刷新「最近互动时间」

来信观察建的互动会被至少 5 处「多久没跟进」的读取当成最近一次互动（销售首页、主动扫描、晨报、运行时 v2 的跟进分析、商机列表）。客户来信后这个时间被刷新，「久未跟进」的提醒可能因此晚出现——但客户来信本身恰恰是该跟进的信号。本 change 没有改这些读取；要不要把入站来信排除在「已跟进」之外，建议放到 MAIL-4（未回复提醒）一起定。

### 3.3 MAIL-1 报告里的外链图片问题仍在

助手回答里的 Markdown 外链图片会自动加载（`chat-panel.tsx`），理论上可被邮件里的指令用来带出数据。本 change 不读正文，不增加这个面；但建议在生产打开 `MAIL_READ_ENABLED` 之前先处理。

## 4. 与任务书对不上的地方（以代码为准）

| 任务书 | 代码现状 / 实施结果 |
|---|---|
| `summary=主题`、`content` 留空 | 标题会被 5 处交给模型或 Muse，改为 C1：标题固定文字，主题在内容里 |
| 互动「以 `emailMessageId` 幂等」 | 该列没有唯一约束。并发锚点用 `Notification.sourceKey` 的唯一约束；互动先查后建（先按 RFC `Message-ID`，再按本邮箱的 Gmail 邮件 id） |
| 账本「以 Gmail messageId 幂等」 | Gmail 邮件 id 只在一个邮箱内唯一，所以账本按「邮箱主人 + 邮件 id」查重（隔离库测试里两个邮箱的 id 相撞时暴露的） |
| 没提销售知识库 | 知识库回填会对 `analysisStatus` 为空的互动调模型。来信互动建的时候就置为 `skipped` |
| 没提商机 | 梦馨的两条 FDE 流程按商机下的入站互动判断「客户回没回」。来信互动不挂商机 |
| 推送沿用 CAL-3（已绑定 → Muse） | D2：只发站内通知与微信 |
| 组织开关由「企业管理员」开 | 照日历观察设置的口径：权限 `sales.settings.manage`（岗位模式下由持键的管理岗位决定） |
| 缺权限提醒「点开到邮箱绑定页」 | 通知跳转表不支持这个去处，且不在本期改动范围：提醒是纯文字，写明「到邮箱绑定页重新授权」 |
| `href.ts` 要改 | `sales_customer` 的跳转已存在，没有改 |
| 未匹配「只在账本里计数」 | 不逐封留痕；每轮每个邮箱一条汇总 `mail.watch.run`，未匹配的发件人与主题不落库 |
| 没提自动化登记 | `mail-watch` 作为被记录的步骤，在自动化注册表、驾驶舱调度表、岗位注册表各登记一行（与 `calendar-watch` 相同的三处） |
| 没提平台代发的企业 | 这类企业的邮箱绑定页不显示 Google 连接，「客户来信提醒」也不显示 |
| 预填文字的日期 | 取 Gmail 记的收信时间（`internalDate`），不取发信人写的 `Date` 头 |

## 5. 交付清单

| 类别 | 文件 |
|---|---|
| 规格四件套 | `openspec/changes/mail-watch/`（proposal、`specs/mail/inbound-watch/spec.md`、design、tasks） |
| 编排与规则 | `src/lib/mail-watch/`：`types.ts`、`pure.ts`（跳过 / 归类 / 文案 / 收件人 / 账本）、`ui-pure.ts`（页面状态与入口，客户端可用）、`settings.ts`、`run.ts` |
| Gmail 读取 | `src/lib/google-email.ts`：新增 `listInboxAdditions`、`getInboxMessageMeta`（既有函数未改） |
| 开关 | `src/lib/env/runtime-isolation.ts`（`isMailWatchAllowed`）、`.env.example` |
| 接口 | `src/app/api/organizations/[orgId]/mail-watch-settings/route.ts`、`src/app/api/sales/mail-watch/opt-in/route.ts` |
| 定时任务 | `src/app/api/cron/sales-actions/route.ts`（加步骤）；`src/lib/automation/registry.ts`、`src/lib/cockpit/schedule.ts`、`src/lib/cockpit/posts.ts`（登记） |
| 通知类型 | `src/lib/notifications/constants.ts`、`type-visibility.ts`、`src/components/header.tsx`（图标） |
| 页面 | `src/app/(main)/settings/email/mail-watch-card.tsx`（新）与 `page.tsx`；`src/app/(main)/sales/customers/[id]/interaction-timeline.tsx`、`page.tsx`、`types.ts` |
| 测试 | `src/lib/mail-watch/__tests__/mail-watch-pure.test.ts`、`mail-watch-db.isolated.test.ts`、`fake-mailbox.ts`；改动既有测试 3 处（通知类型可见性的期望表、驾驶舱岗位的自动化数量、组织设置写入守卫） |
| 验收 | `scripts/mail-2-local-acceptance.ts`、`docs/acceptance/mail-2/`（输出 + 10 张截图） |

## 6. 验收：任务书逐条

验证手段：

- **单测**：`mail-watch-pure.test.ts`（128 项）。规则、文案、读接口函数（注入假邮箱）、页面与定时任务的源码断言。不连数据库。
- **隔离库测试**：`mail-watch-db.isolated.test.ts`（88 项，25 段）。真实的两个接口 + 编排 + 本机 Postgres；Gmail 与微信推送为注入的假实现。
- **本地验收**：`scripts/mail-2-local-acceptance.ts`（61 项，15 段）。真实的定时任务路由（含前后其它步骤）、两个接口、客户详情接口、邮件绑定状态接口 + 本机 Postgres；Gmail 换成内存里的假邮箱。输出见 `docs/acceptance/mail-2/local-acceptance.txt`。
- **真实页面**：本地 `next dev` + 同一个库，Playwright 操作页面并截图。

**没有做的**：没有连真实 Google，没有真实微信，没有在 staging 上跑，没有等真实的 15 分钟调度。

### MAIL-2（三道开关全开，Lynn 已勾选）

| # | 任务书验收项 | 已验证的部分 | 手段 | 未验证的部分 |
|---|---|---|---|---|
| W1 | 已建档客户给 Lynn 发信 → 15 分钟内收到「客户来信：〈客户名〉」；已绑微信时同时收到只有客户名和主题的推送；时间线多一条入站邮件互动；其他成员不收 | 触发一次定时任务后：Lynn 一条通知（标题、正文、跳转都对），其他人 0 条；时间线一条入站邮件互动；账本一条。推送文案只有客户名与主题、主题里的邮箱地址打码、没有正文 | 本地验收 [3][11]；隔离库 [8][18] | 「15 分钟内」取决于 Vercel 的调度，本地是手动触发；真实微信送达未验证（测试环境不允许外发，经定时任务路由跑时推送记为「跳过」，文案用注入的记录函数核对） |
| W2 | 客户用另一个邮箱回复青砚发出的报价邮件 → 按规则 2 命中 | 线程里有青砚发出的信、来信地址不在客户档案里 → 命中「客户回信」，通知与互动都有 | 本地验收 [4]；隔离库 [12] | 真实 Gmail 里回复是否总落在同一线程（改主题、换客户端可能拆线程） |
| W3 | 供应商、促销、Lynn 自己发出的信 → 无通知、无互动，账本只计数 | 三封都没有通知、互动、逐封账本；汇总里未匹配 1、跳过 2 | 本地验收 [5]；隔离库 [10] | — |
| W4 | 同一轮重跑 / 下一轮 → 不产生第二条 | 下一轮 0 封；把游标拨回重跑同一段：通知、互动、账本都不变，汇总记重复 2。建好通知与互动后中断、下一轮补写账本不重发 | 本地验收 [6]；隔离库 [9][15] | 两轮真正并发（定时任务重叠）时互动可能在极窄窗口里重复，规格没有对此承诺（设计「风险」已写） |
| W5 | 首次勾选时收件箱里的旧信 → 不补发 | 勾选后的第一轮只记起点，没有读任何一封旧信，没有通知 | 本地验收 [2]；隔离库 [7] | — |
| W6 | 在途询价的供应商回信 → 只有既有的询价通知，没有 `mail_inbound` | 线程属于在途询价时（即使发件地址恰好是客户邮箱）没有 `mail_inbound`，汇总记为跳过 | 本地验收 [7]；隔离库 [13] | 「既有的询价通知照常发出」是 `tender-rfq-inbound` 的行为，本 change 没有碰它，也没有在这里重测 |
| W7 | Lynn 取消勾选 → 下一轮不再读她的邮箱，游标已删 | 取消后设置里没有她的条目；下一轮对她的邮箱 Gmail 调用 0 次；重新勾选从新起点开始，期间的来信不补发 | 本地验收 [8][10]；隔离库 [5][21] | — |
| W8 | 任一开关关 → 步骤记为跳过并写明原因，其余步骤不受影响 | 平台关：响应与运行记录都是 skipped / `platform_disabled`，两个接口 404，Gmail 0 次调用。组织关：`no_mailboxes`。两种情况下其它步骤的结果都在响应里 | 本地验收 [0][1][13]；隔离库 [1][6] | — |

### MAIL-2 公共地址（Lucas、Marty 已勾选）

| # | 任务书验收项 | 已验证的部分 | 手段 | 未验证的部分 |
|---|---|---|---|---|
| P1 | 客户发信到 `sales@` → 进 Lucas 的邮箱，Lucas 收到提醒，时间线多一条；判断点 8 为 A 时负责销售不收通知但看得到这条 | 信进 Lucas 的假邮箱（收件地址写 `sales@`）：Lucas 一条通知；负责销售 Lynn 没有新通知；用 Lynn 的身份调客户详情接口能看到这条（记录人为 Lucas） | 本地验收 [9]；隔离库 [11] | **真实的 `sales@` 来信在 Lucas 邮箱里 `From` 是不是客户本人的地址**（待确认 E）。如果是转发规则且改写了发件人，规则 1 会落空 |
| P2 | 客户发信到 `info@` → 进 Marty 的邮箱；看得到这位客户时提醒，看不到时归未匹配 | 夹具里 Marty 是销售岗位：他自己的客户来信 → 提醒；另一位销售的客户来信 → 不提醒、不写客户，汇总记未匹配 | 本地验收 [9]；隔离库 [10] | **生产里 Marty 实际持哪些岗位、看得到哪些客户**（代码里看不到）。如果他只看得到自己的客户，`info@` 的老客户来信多数会归未匹配 |
| P3 | 没建档的新客户发信到 `info@` → 无通知、无互动，账本计未匹配一条 | 同上一轮：汇总里未匹配计数包含这封，没有通知与互动，发件人与主题没有落库 | 本地验收 [9] | — |
| P4 | 同一封信同时发给 `sales@` 和 Lynn → 各收一条通知，时间线是否合并由 design 定 | 两个邮箱各一封（Gmail 邮件 id 不同、`Message-ID` 相同）：两位邮箱主人各一条通知，账本两条，时间线只多一条互动 | 本地验收 [10]；隔离库 [17] | 真实 Gmail 对同一封信在两个邮箱里的 `Message-ID` 头是否一致（按 RFC 应一致；转发改写时可能不同，那样会记成两条互动） |

### 页面

| # | 项 | 结果 | 手段 |
|---|---|---|---|
| U1 | 平台开关关：邮箱绑定页不显示「客户来信提醒」 | 不渲染（MAIL-1 的「读信权限」一项照常） | 真实页面，截图 `01` |
| U2 | 组织开关关：勾选项可见但置灰并说明；管理员另见企业开关 | 成员：置灰 +「需要管理员先开启」；管理员：置灰 + 企业开关（关） | 真实页面，截图 `02` `03` |
| U3 | 管理员打开企业开关；成员可勾选，刷新后仍为已勾选 | 在页面上点击开关与勾选项完成，刷新后状态保持 | 真实页面，截图 `04` `05` `06` |
| U4 | 已勾选但缺读信权限：提示重新授权 | 显示提示与「重新授权」按钮 | 真实页面，截图 `07` |
| U5 | 时间线的来信条目带「让助手读这封信」，预填文字不含主题，由用户自己发送 | 5 条来信条目都有入口，链接都是「帮我读一下王总在 11 月 12 日发来的邮件」；点开后文字在输入框里，没有自动发送 | 真实页面，截图 `08` `09` |
| U6 | 助手页不放行的成员不显示入口 | 纯销售成员看同一位客户：有来信条目，没有入口；直接访问 `/assistant` 被重定向到销售首页 | 真实页面，截图 `10`（见 3.1） |

### 工程

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run test:ci` | 通过（合并 main `f857e313` 之后，整套 `CI unit subset PASS`）。合并 `0925ec9d` 那一轮曾停在 `agent-runtime-v2/__tests__/legacy-followup-safety.test.ts`——main 自己的失败，已由 #471 修掉，与本 change 无关 |
| `npm test` | 合并 main `0925ec9d` 之后：分支 644 / 659 通过、15 失败；同一环境的 main 643 / 657 通过、14 失败。两边共有的 14 项逐项相同（见下）。分支多出的 1 项「发信文案按企业设置（VIS-1c）」是本 change 引入的——邮箱绑定页多了一处 `{!isPlatformRelay && …}`，碰到了它对出现次数的断言——**已修**（判断挪进卡片组件，既有断言没有改），该测试与所有读这几个页面源码的测试重跑通过。修复后没有再重跑一遍全量。之后又合了一次 main（`f857e313`，含 #471、#472），那次只重跑了 `test:ci`、类型检查、lint 基线、守卫与受影响的测试，同样没有重跑全量 |
| 新增测试已注册 | `bash scripts/check-test-registry.sh` 通过（已注册 632 个；历史欠账 67 条，没有增加） |
| `npm run lint:baseline` | 通过（没有新增 error） |
| `bash scripts/test-runtime-architecture.sh` | 通过（基线未改） |
| `openspec validate mail-watch --strict` | 通过 |
| `vercel.json`、`prisma/` 无 diff | `git diff --stat origin/main -- vercel.json prisma/` 为空 |
| 没有新增 `gmail.modify` / `mail.google.com` scope | 新增代码里没有这两个字符串；假邮箱对取正文、附件、修改、发送任何一个调用都抛错，全程没有触发 |
| 不读组织授权邮箱 | `git grep -n "mailboxEmail" -- src/lib/mail-watch/pure.ts src/lib/mail-watch/run.ts src/lib/mail-watch/settings.ts` 无结果 |
| 正文不落库 | 本地验收 [14]：每封假邮件的正文里放了同一句标记，结束后在通知、互动、审计、运行记录、组织设置里都搜不到 |

## 7. 没能验证的条目（单列）

1. **真实 Gmail**：`history.list` 的真实行为与配额、游标约一周过期的真实表现、回复是否总在同一线程。
2. **公共地址的真实邮件头**（待确认 E）：需要一封真实的 `sales@` 来信的原始头。
3. **Marty 与 Lynn 在生产里的岗位与客户可见范围**：决定 P2 的实际效果，以及 3.1 对谁有影响。
4. **真实微信送达**与推送在手机上的样子。
5. **真实调度**：Vercel 每 15 分钟触发、整个 `sales-actions` 请求在真实数据量下的耗时（本步骤截止在请求开始后第 265 秒）。
6. **两轮并发重叠**：规格没有承诺，未测。
7. **staging 全流程**：没有跑。

## 8. 测试

| 测试 | 结果 |
|---|---|
| `src/lib/mail-watch/__tests__/mail-watch-pure.test.ts` | 128 通过 |
| `src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`（本机隔离库） | 88 通过 |
| `scripts/mail-2-local-acceptance.ts`（本机隔离库） | 61 通过 |
| 受影响的既有测试：通知类型可见性 / 协作接线 / 组织设置写入守卫 / 驾驶舱岗位、调度、读模型 | 45 / 97 / 34 / 232、209、162，全部通过 |
| `npm test`（全量；不带数据库环境变量，隔离库测试按约定自动跳过） | 合并 main `0925ec9d` 之后：分支 644 / 659 通过、15 失败；同一环境的 main 643 / 657 通过、14 失败。两边共有的 14 项逐项相同（见下）。分支多出的 1 项「发信文案按企业设置（VIS-1c）」是本 change 引入的——邮箱绑定页多了一处 `{!isPlatformRelay && …}`，碰到了它对出现次数的断言——**已修**（判断挪进卡片组件，既有断言没有改），该测试与所有读这几个页面源码的测试重跑通过。修复后没有再重跑一遍全量。之后又合了一次 main（`f857e313`，含 #471、#472），那次只重跑了 `test:ci`、类型检查、lint 基线、守卫与受影响的测试，同样没有重跑全量 |
| `npm run test:ci` | 通过（合并 main `f857e313` 之后，整套 `CI unit subset PASS`）。合并 `0925ec9d` 那一轮曾停在 `agent-runtime-v2/__tests__/legacy-followup-safety.test.ts`——main 自己的失败，已由 #471 修掉，与本 change 无关 |

main 上同样失败的 14 项（都与本 change 无关；多数需要数据库或本机没有的依赖）：Agent Runtime V2 legacy 跟进写工具安全、Agent Trace 只读查询、Gmail Draft OAuth Compose Scope、Governance Hygiene Gate、Governance Hygiene Concurrency Gate、Phase3A-2 Ledger DB、Phase3A-2 Smoke Access、Phase3A-3 Approvals Smoke、Phase3A-4 Acceptance、Phase3A-4 Governance Smoke、Phase3A-5 Overview Acceptance、Phase3A-5 Settle DB、Quote Operations 客户报价 PDF 分页布局、T4 授标情报真实 Postgres 矩阵。其中第一项当时也让 `test:ci` 停下（main 的 CI 那时也是红的），已由 #471 修掉；这份清单是合并 `0925ec9d` 那一轮的。

改动既有测试的三处都是因为登记了新东西，不是放宽断言：通知类型可见性的期望表加了 `mail_inbound`；驾驶舱「询盘销售」岗位的自动化数量 9 → 10；组织设置写入守卫加了 2 条（`mail-watch` 的写入都经行锁函数）。`collab-wiring` 里对定时任务响应的既有断言没有改，新字段加在它不涉及的位置。

## 9. 与八条硬纪律的关系

1. 零 schema：遵守。配置与游标在 `Organization.settingsJson.mailWatch`，账本用 `AuditLog`。
2. 出站先审批：不涉及。只给本组织成员本人发站内通知与微信，不建 `PendingAction`（验收 [14] 核对为 0）。
3. 禁止第三套队列：遵守。挂既有 `sales-actions`；游标不是认领，没有重试。
4. 脱敏：通知与推送只有客户名与主题；推送里的邮箱地址打码；日志只打错误类别。
5. 不爬登录页：不涉及。
6. 邮箱分离：只用被观察成员本人的 Gmail 授权，不读组织授权邮箱。
7. 确定性优先：归类是查表，没有模型调用；来信互动标为不进知识库分析。
8. 测试注册：两个新测试都已在 `scripts/test-all.sh` 注册，纯函数的那个同时在 `scripts/test-ci-unit.sh`。

没有复制或引入 `elie222/inbox-zero` 的任何代码。

## 10. 上线顺序与运维前置

1. 合并时不设 `MAIL_WATCH_ENABLED`：线上零变化。
2. 上线前要有人确认：待确认 E 的真实样本；Marty、Lynn 的岗位与可见范围；3.1 选哪种做法（它决定销售能不能用「让助手读这封信」）。
3. staging：开平台开关与测试组织的开关，一个测试邮箱勾选，走第 6 节的验收。
4. 生产：设 `MAIL_WATCH_ENABLED=true` → Sunny 管理员在邮箱绑定页开企业开关 → 先只让 Lucas 一个人勾选（他的邮箱同时收 `sales@`，样本最全），看一周 `mail.watch.run` 汇总里「客户来信 / 未匹配」的比例 → 再放开给 Marty 与销售。
5. 回滚：去掉 `MAIL_WATCH_ENABLED` 并重新部署，下一轮起不再读任何邮箱；已建的通知、互动、账本保留。
6. 合并后的归档已做（见表头「状态」）。MAIL-1 的 `mail-read-tools` 已由 #475 归档（主规格 `mail/assistant-read`）。
