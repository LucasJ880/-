# NAV-1c 报告：看到来信就能回

change：`nav-1c-reply-entry`（任务书 `docs/QINGYAN_NAV-1_PLAIN_NAV_REPLY_TASKBRIEF.md` §NAV-1c；四件套 Lucas 2026-11-15 审核通过，design「审核关注点」Q1–Q6 全部按推荐）。实施基线 main `0925ec9d`（含 NAV-1a、NAV-1b）。零 schema、零新增出站通路、零新增 LLM 调用、不动权限键与路由门映射表。

| 项 | 值 |
|---|---|
| 状态 | #472，2026-11-15 合并；archive `openspec/changes/archive/2026-11-15-nav-1c-reply-entry`；没有开关，已随合并生效 |
| 新能力 | `trade/inquiry-reply-entry`（11 条要求） |
| 改的能力 | `navigation/entry-visibility`（「『我想做什么』的外贸内容」加 1 个场景、按钮名称清单加「写回复」） |
| 测试 | 新增 `reply-entry.test.ts` 45 项（`scripts/test-all.sh:330`、`scripts/test-ci-unit.sh:354`）与 `reply-entry-db.isolated.test.ts` 21 项（`scripts/test-all.sh:417`）；`entry-visibility.test.ts` 91 → 92；`trade-access.test.ts` 的守卫处理器盘点 110 → 111 |
| 截图 | `docs/acceptance/nav-1c/01–10`（本机临时库 + `next dev`，虚构企业与账号；没有真发邮件） |
| BREAKING | 无。时间线条目下方的文字对所有企业换了说法 |

## 1. 用户现在会怎么看到

- **Cathy 在客户详情的互动时间线**：买家来信那一条的下面写「客户来信 · 经手人：〈姓名〉」，右下角有「回复」；页签右上「导入对话」「记录」左边多了「回复客户」。两个都直接进询盘收件箱，并打开这位买家的回复窗口。
- **回复窗口**：最上面一块是买家最后一封来信的主题和全文（只读），下面才是主题和正文。从「写回复」「再写一封」「回复」「回复客户」进来时正文是空的，主题预填 `Re: 〈来信主题〉`；从「查看回复草稿」进来和以前一样带着 AI 草稿。
- **询盘收件箱的卡片**：每张卡片都有回复按钮。有 AI 草稿 →「查看回复草稿」（位置没变）；草稿在生成、失败或没有 →「写回复」；已经回过 →「再写一封」。以前后两种情况下卡片上没有任何回复入口。
- **今日询盘、商机详情的待批草稿**：多一行「不想用这份？去询盘收件箱自己写（发出后这份草稿自动作废）」。商机详情没有草稿时显示「去询盘收件箱写回复」。商机详情输入框的提示改成「把买家在别处发来的内容贴到这里，AI 会重新起草回复」。
- **使用说明「我想做什么」**：「回复买家」「批准 AI 写好的回复」两行补回了自己写的出路（NAV-1b 时因按钮还不存在而暂时删掉的半句）。
- **Lynn 与 Sunny 其他岗位**：时间线的文字同样变成「客户来信 / 我方发出 · 经手人：…」，没有「回复」「回复客户」。别的都不变。
- **发信这件事本身没有变**：仍然是成员自己在回复窗口点「发送邮件」，或者在别处发完点「已在别处发送，标记」。打开窗口、点链接都不会发信。

## 2. 三处入口

| 入口 | 出现条件 | 去哪 |
|---|---|---|
| 时间线条目的「回复」 | 这条互动是来信 ∧ 挂着商机 ∧ 该商机在本企业有对应的外贸线索 ∧ 企业开了外贸模块 ∧ 当前用户持 `trade.manage` ∧ 询盘收件箱对其放行 | `/trade/inbox?prospect=〈线索 id〉` |
| 时间线页签右上的「回复客户」 | 最近 50 条互动里至少一条满足上面的条件（取最近一条） | 同上 |
| 审批面的两种链接 | 询盘收件箱对当前用户放行；今日询盘的卡还要求带商机 id | `/trade/inbox?opportunity=〈商机 id〉` |

- 「对应的外贸线索」与审批发送写回收件箱用的是同一条规则：本企业内 `convertedToSalesOpportunityId` 等于该商机、最早建立的那条线索。
- 回复目标读时计算：客户详情接口整页多 1 次查询；不满足放行条件时 0 次。
- 收件箱收到这两种地址后取单个买家的会话、打开窗口，然后把地址里的参数去掉（刷新不会反复弹窗）。会话不在当前筛选、90 天窗口或 200 条上限内也打得开。找不到时页面顶部提示「没有找到这位买家的询盘会话」，列表照常。

## 3. 改了什么

| 位置 | 改动 |
|---|---|
| `src/lib/trade/reply-target.ts`（新） | 纯函数：回复目标解析、时间线文字、主题预填、卡片回复按钮三选一、收件箱地址 |
| `src/lib/trade/reply-target-server.ts`（新） | 放行判定（模块 ∧ 路由门 ∧ `trade.manage`，任一环节出错按不放行）与一次批量查线索 |
| `GET /api/sales/customers/[id]` | 每条互动多一个只读字段 `replyTarget: { prospectId } \| null`；其余字段不变 |
| `GET /api/trade/inbox/focus`（新） | `?prospectId=` 或 `?opportunityId=`；外贸读权限；只读；返回与列表同结构的单个会话 + 最后一封来信的主题与全文；找不到 / 不属于本企业 / 商机没有线索统一 404 `THREAD_NOT_FOUND`；两个参数都没给 400 `TARGET_REQUIRED` |
| `POST /api/trade/inbox/[prospectId]/reply` | 多读一个可选字段 `fromAiDraft`；留底消息的 AI 草稿标记只在它是布尔 `true` 时为真（以前写死为真）。权限、收件人、发信、外发同步、草稿作废都没动 |
| `src/lib/trade/inbox-service.ts` | 追加单会话读取 `loadInquiryThreadFocus`；列表读取没动 |
| 客户详情页（`interaction-timeline.tsx`、`page.tsx`、`types.ts`） | 文字、两个入口 |
| `trade/inbox/page.tsx` | 深链、卡片回复按钮、回复窗口草稿可选并显示来信原文 |
| `revenue/today/page.tsx`、`revenue/[id]/page.tsx` | 链接、占位文字 |
| `src/lib/navigation/help-tasks.ts` | 第 2、3 行文字 |

没有动：`email-sender.ts`、`outbound-sync.ts`、`pending-actions/**`、`inquiry-analysis.ts`、`GET /api/trade/inbox`、线索详情页、Prisma schema、`vercel.json`、权限键、模块、岗位模板、路由门映射表。

## 4. 与任务书不一致、或实施中才发现的

1. **新增了一个只读接口，而不是给列表接口加参数。** 任务书 Impact 写的是给 `GET /api/trade/inbox` 加 `prospectId`。审核时拍板过（Q1）。连带结果：`src/lib/trade/__tests__/trade-access.test.ts` 里钉死的「外贸守卫处理器 110 个」改成了 111；新处理器的守卫键（GET → 读权限）通过该测试的一致性检查。
2. **留底标记由请求声明**（Q4）。`aiDraft` 目前没有任何读取方，改它不影响现有展示或统计。
3. **「已回复，标记」从实心按钮改成了描边按钮。** 四件套里没写。原因：卡片上新加的「写回复」是主操作，两个实心按钮并排分不出主次。只改了样式，行为没动。不合意的话改回去是一行。
4. **只读外贸成员（持 `trade.read` 不持 `trade.manage`）在收件箱也会看到「写回复」「再写一封」，点发送时被接口拒绝**（Q6，本 change 不处理）。与现有「查看回复草稿」「已回复，标记」的现状一致。时间线与审批面的入口本身要求能回，不会出现在这类成员面前。
5. **只认 `convertedToSalesOpportunityId`，不认反向的 `SalesOpportunity.sourceTradeProspectId`。** 任务书要求与审批发送的回写同规则，回写只认前者。两者只对上后一个的商机，时间线没有「回复」，审批面的链接点过去是「没有找到这位买家的询盘会话」。没有生产访问，不知道有多少这样的商机。
6. **截图时注意到、没有改的一处**：收件箱卡片上买家名字旁边的灰色小标签显示的是线索阶段，阶段 `replied` 的中文是「已回复」（意思是买家回复了我们，`src/lib/trade/stage.ts:79`）。于是一张还在等我们回复的卡片上会同时出现「已回复」标签和「写回复」按钮（截图 `03` 第一张卡片）。这是既有文案，不在本 change 范围，建议排进后续队列改成「买家已回复」之类。
7. 任务书「不确定处」的三条：逐条解析成本已由批量查询消掉；两条 10 月测试询盘在生产的状态没有核对（没有生产访问），但本 change 之后有没有草稿、在不在 90 天窗口内都不再是前提；MAIL-2 尚未实现，没有需要共存的入口。

## 5. 验证

本机 Node 24.22.1；隔离库测试用本机临时 PostgreSQL 16。

| 命令 | 结果 |
|---|---|
| `npx tsx src/lib/trade/__tests__/reply-entry.test.ts` | 45 通过 |
| `reply-entry-db.isolated.test.ts`（隔离库） | 21 通过；不给 `DATABASE_URL` 时跳过并退出 0 |
| `entry-visibility` / `trade-recipients` / `inbox-service` / `trade-access` | 92（改动前 91）/ 70 / 7 / 128（与改动前相同） |
| 相关的既有隔离库测试，main 与本分支各跑一遍 | `revenue-spine-db` 166、`booth-cards-db` 69、`channels-to-spine-db` 56、`website-inquiry-async-db` 58、`onboarding-db` 82，两边通过数逐项相同 |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS，无新增 error fingerprint |
| `npm run test:ci` | `CI unit subset PASS`（退出码 0）。第一遍在 `trade-access` 的处理器盘点（110 ≠ 111）处中断，更新盘点数后整套通过 |
| `npm test` | 646/659。13 个失败与 NAV-1a、NAV-1b 时逐项相同，都是环境类（无数据库连接 / Chromium / Gmail / Agent Trace）；在 main `8c20824a` 的干净检出上把这 13 项逐个重跑，同样 13 项失败 |
| `bash scripts/check-test-registry.sh` | 已注册 632 个；基线 67 条，无新增 |
| `git diff --stat main -- prisma vercel.json ci/test-registry-baseline.txt` | 无输出 |
| `openspec validate nav-1c-reply-entry --strict` | valid |

写这份报告时 main 的 `test:ci` 本身是红的：`legacy-followup-safety.test.ts` 的假事务缺 `createManyAndReturn`（#224 的测试遇上 FIX-5 #448 的实现），与本 change 无关，修复在 #471（#469 修的是同一处，合其一即可）。上表的 `test:ci` 与 `npm test` 是在「本分支 + #471 的修复」上跑的；修复合进 main 之前，本 PR 的 CI 会在那一个测试处红。

本 PR 的分支从 main `8c20824a` 起（不含尚未合并的 NAV-1b 归档 #466）。搬过来之后重跑了 `reply-entry`、`entry-visibility`、`trade-recipients`、`inbox-service`、`trade-access`、`trade-layout`、`entry-naming`、测试注册校验、`npm run typecheck` 与 `openspec validate --strict`，都通过。

specs 的 11 条要求与 `entry-visibility` 的 1 条修改，每个场景都有对应的断言（`/opsx:verify` 逐条对过）：解析规则、时间线文字、主题预填、按钮三选一、原文块在输入框之前、打开不等于发送、审批面链接——在 `reply-entry.test.ts`；跨企业不泄露、超出窗口也能取到、找不到统一 404、权限与只读、手写回复的留底与草稿作废、窗饰销售看不到目标——在隔离库测试里用真实的进线、回复接口与外发同步跑通。

## 6. 截图（`docs/acceptance/nav-1c/`）

本机临时 PostgreSQL 16 + `next dev`，虚构企业 Example Textiles（家纺外贸）/ Example Blinds（窗饰）与虚构账号。两位虚构买家：Maple Hotels Group（未回复、没有 AI 草稿、商机上有一张待批回复草稿）、Peak Hotels Ltd（已回复）。下表右列是脚本从页面上实际读到的。

| 文件 | 内容 | 页面上读到的 |
|---|---|---|
| `01-cathy-timeline-reply-entry.png` | Cathy，Maple 的客户详情 | 条目下方「客户来信 · 经手人：Trade Rep Example」；「回复」1 个、「回复客户」1 个；页面上没有「· 收到」「· 发出」 |
| `02-cathy-reply-window-from-timeline.png` | 点「回复」之后 | 到了询盘收件箱，地址里的参数已去掉；窗口标题「写回复 · Maple Hotels Group」；「买家来信」块里是来信主题与全文；主题 `Re: Blackout curtains for hotel project`；正文为空 |
| `03-cathy-inbox-cards-write-reply.png` | 收件箱「全部」 | 第一张卡片（未回复）：「写回复」「已回复，标记」；第二张（已回复）：「再写一封」 |
| `04-cathy-write-again-blank.png` | 点「再写一封」 | 标题「写回复 · Peak Hotels Ltd」；主题 `Re: 网站询盘`；正文为空 |
| `05-cathy-today-approval-link.png` | 今日询盘「待审批回复」 | 待批卡下方有链接「不想用这份？去询盘收件箱自己写（发出后这份草稿自动作废）」 |
| `06-cathy-reply-window-from-approval.png` | 点上面那个链接 | 回复窗口打开，标题「写回复 · Maple Hotels Group」；地址参数已去掉 |
| `07-cathy-opportunity-detail-links.png` | Maple 的商机详情 | 待批草稿卡里有同一链接，指向 `/trade/inbox?opportunity=〈该商机〉`；输入框提示是新的那句 |
| `08-cathy-opportunity-no-draft-link.png` | Peak 的商机详情（没有草稿） | 「去询盘收件箱写回复」 |
| `09-cathy-deeplink-not-found.png` | 打开一个不存在的商机地址 | 提示「没有找到这位买家的询盘会话」；列表照常；地址参数已去掉 |
| `10-lynn-timeline-wording-only.png` | Lynn，窗饰客户的详情 | 「客户来信 · 经手人：Lynn Example」；「回复」0 个、「回复客户」0 个 |

截图全程浏览器只发出了读取请求（脚本记录的非 GET 请求为 0 条，登录除外）；两个账号的页面错误都是 0 条。

## 7. 上线注意

- 合并即生效，没有开关，没有数据迁移；回滚 = revert。
- **归档要等 #466（NAV-1b 归档）先合并**：本 change 改的那条要求「『我想做什么』的外贸内容」是 NAV-1b 归档时才进主规格的，`openspec validate` 已提示在那之前归档会被拒。合并本 PR 本身不受影响。
- **没有在真实发信环境里验过「发送邮件」**。本机没有配置发信，隔离库测试走的是「已在别处发送，标记」那条分支（同一个接口、同一套留底与外发同步）。建议在 staging 用内部邮箱走一遍：
  1. 用梦馨「老板 + 外贸业务员」的测试账号，从官网表单提交一条测试询盘（收件邮箱填内部邮箱）。
  2. 客户与商机 → 打开这位客户 → 互动时间线 → 点「回复」。确认到了询盘收件箱、窗口上方是刚才的留言。
  3. 写两句正文，点「发送邮件」。确认内部邮箱收到、发件人是梦馨的外贸发件地址。
  4. 回到今日询盘：这位买家的待批草稿（如果已经生成）应当消失；客户时间线多一条「我方发出」。
  5. 收件箱里这张卡片变为已回复，按钮是「再写一封」。
- 任务书要求的「三个 change 都上线后通知梦馨一次」可以在本 PR 合并、上面这一遍走通之后发。要点：入口没有少，常用的在最上面；看到客户来信，旁边就有「回复」；AI 没写好草稿也可以自己写。
- 后续队列（都不在本 change）：审批卡里直接改草稿（NAV-3）；只读外贸成员在收件箱的按钮显隐；线索阶段标签「已回复」的文案（§4 第 6 条）；让今日询盘接口直接给出线索 id（§4 第 5 条量大时）。
