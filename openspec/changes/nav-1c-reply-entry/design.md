# Design：看到来信就能回（NAV-1c）

## Context

动机见 proposal.md。以下是核对到的现状（main `0925ec9d`）。

**客户时间线**

- `src/app/(main)/sales/customers/[id]/interaction-timeline.tsx` 只读；条目下方是 `{姓名}` 加「· 收到 / 发出」（`:43-48`）。来信互动的 `createdBy` 是询盘负责人，所以读起来像「Cathy 收到了」。
- 页签右上只有「导入对话」「记录」（`page.tsx:1083,1092`）。
- 接口 `src/app/api/sales/customers/[id]/route.ts:25-31` 一次取最近 50 条互动；`CustomerInteraction` 有 `opportunityId`、`direction`。

**线索与商机怎么对上**

- 网站询盘进线时把线索的 `convertedToSalesOpportunityId` 填成新建的商机（`src/lib/trade/website-inquiry.ts:625`）；人工「转销售」也填（`sales-conversion.ts:489`）。
- 审批发送写回收件箱时间线时，用的就是「本企业内 `convertedToSalesOpportunityId` = 该商机、最早建立的那条线索」（`src/lib/pending-actions/exec-sales-inquiry-reply.ts:228-234`）。
- 另有一条反向的关联 `SalesOpportunity.sourceTradeProspectId`（`src/lib/revenue-spine/sla-metrics.ts:260`），任务书没提。

**询盘收件箱**

- 列表接口 `GET /api/trade/inbox`：`filter=pending|all`、`days`（默认 90）；服务 `loadInquiryThreads` 取窗口内最多 2000 条消息、聚合后截 200 个会话。会话只带最后一封来信的 160 字摘要，不带全文。
- 回复按钮「查看回复草稿」在 `DesignBlock` 里（`trade/inbox/page.tsx:504-508`），而 `DesignBlock` 只在分析完成时渲染（`:390`）、按钮只在有草稿时出现；回复窗口 `ReplyDraftModal` 只在 `draftFor.analysis?.replyDraft` 存在时打开（`:445`），内部直接解引用草稿（`:532`）。
- 回复接口 `POST /api/trade/inbox/[prospectId]/reply` **本来就不要求有草稿**：只要正文非空就发（`mode=send`）或留底（`mode=mark_sent`），要求 `trade.manage`。留底消息 `aiDraft: true` 是写死的（`reply/route.ts:62`）。`aiDraft` 这个标记目前没有任何读取方（`grep` 核对，报价面板里的同名变量无关）。
- 回复之后的事都已经有：线索进到「已联系」、3 天后跟进；`syncTradeOutboundToRevenueSpine` 把这次外发记成商机的一条发出互动，并把同商机待批的回复草稿系统作废（`src/lib/trade/outbound-sync.ts`）。

**审批面**

- 今日询盘的待批卡带 `opportunityId`（可空，`revenue/today/page.tsx:64`）；只能「批准发送 / 拒绝」。
- 商机详情 `revenue/[id]/page.tsx:289`「尚无草稿」；`:334` 占位文字是开发者话术。

所以缺的不是能力，是入口：回复接口、外发同步、草稿作废都在，只是界面在三处把路堵住了。

## Goals / Non-Goals

**Goals**

- 客户时间线上的买家来信能一步到收件箱的回复窗口。
- 收件箱任何状态的会话都能回，且边看原文边写。
- 审批面给「不想用这份草稿」一个出路。
- 留底标记如实区分手写与 AI 草稿。

**Non-Goals（具体到文件）**

- `src/lib/trade/email-sender.ts`、`src/lib/trade/outbound-sync.ts`、`src/lib/pending-actions/**`：发信、同步、作废、审批执行都不动。
- `src/lib/trade/inquiry-analysis.ts` 与 `…/inbox/[prospectId]/design` 路由：AI 分析与起草不动，「写回复」不触发它们。
- `GET /api/trade/inbox` 列表接口的筛选、窗口、上限与返回结构。
- `src/app/(main)/trade/prospects/[id]/page.tsx` 线索详情页（那里的「对话记录」不加回复入口）。
- `src/lib/navigation/**` 除 `help-tasks.ts` 两行文字外的任何文件；路由门映射表。
- Prisma schema、`vercel.json`、权限键、模块、岗位模板。

## Decisions

### D1 回复目标：一个纯函数 + 一次批量查询，放在 `src/lib/trade/reply-target.ts`

- 纯函数 `resolveReplyTargets(互动列表, 商机→线索 映射, 是否放行)`：对每条互动给出线索 id 或空。
- 读取：把 50 条互动里「方向为来信且有商机」的商机 id 去重，一次查 `tradeProspect`（本企业、`convertedToSalesOpportunityId in (...)`、按建立时间升序），每个商机取第一条。任务书「不确定处」担心的逐条查询成本就此消掉：整页多 1 次查询。
- 「是否放行」= 外贸模块已开（与导航同口径）∧ `holdsTradePermission(user, orgId, [trade.manage])` ∧ 询盘收件箱页面对其放行（与路由门同一个判定）。任一不成立就不查线索，全部给空。
- 接口在返回的每条互动上加 `replyTarget: { prospectId } | null`，其余字段不变。

- 否决：把线索 id 存进互动的元数据。零 schema 不拦这个，但它是另一份会过期的事实（线索可以被合并、解绑）。
- 否决：同时认 `SalesOpportunity.sourceTradeProspectId`。审批发送的回写只认 `convertedToSalesOpportunityId`；两处规则不同的话，会出现「从时间线点进去回的买家」与「审批发送写回的买家」不是同一条线索。任务书也明确要求与回写同规则。
- 否决：让前端自己再请求一次去换线索 id。时间线每条都要问一遍，且放行条件得在前端重算。

### D2 时间线文字是一个映射函数，和 D1 放在同一个文件

`interactionMetaLine(方向, 经手人姓名)` → 「客户来信 · 经手人：X」/「我方发出 · 经手人：X」/「经手人：X」。时间线组件只调它，不再自己拼「收到 / 发出」。

- 否决：只在有回复目标的条目上换文字。同一条时间线里两种说法并存更乱；任务书验收也写明 Lynn 的时间线同样改文字。

### D3 深链：`/trade/inbox?prospect=<线索id>` 或 `?opportunity=<商机id>`

页面加载时读到其中一个参数，就请求 D4 的单会话接口；取到则打开回复窗口，取不到显示提示条「没有找到这位买家的询盘会话」。打开后把地址里的参数去掉（`router.replace`），避免刷新或返回时反复弹窗。时间线的两个入口用 `prospect`，审批面用 `opportunity`（审批卡手里只有商机 id）。

- 否决：审批面先把商机换成线索再生成链接。今日询盘接口要为每张卡多查一次，而多数卡不会被点。
- 否决：用路径 `/trade/inbox/<线索id>/reply`。新增页面路由要进路由门映射表，任务书明确「不新增页面路由」。

### D4 新增 `GET /api/trade/inbox/focus`，不往列表接口上加参数

`?prospectId=` 或 `?opportunityId=`（加 `orgId`，同其它外贸接口）。服务函数 `loadInquiryThreadFocus` 在 `inbox-service.ts`：按本企业找到线索 → 取这位买家的全部消息（不设时间窗口；按时间倒序最多 500 条）→ 复用 `buildInquiryThreads` 得到与列表同结构的会话，附上分析结果与最后一封来信的主题、全文、渠道、时间。线索不存在、不属于本企业、商机没有对应线索，统一返回 404 `{ code: "THREAD_NOT_FOUND" }`。权限 `trade.read | trade.manage`，只读。

回复窗口从卡片打开时也请求它，用来拿最后一封来信的全文（列表里只有 160 字摘要）；取到之前先显示摘要。

- 否决：按任务书 Impact 的写法，给 `GET /api/trade/inbox` 加 `prospectId` 参数并在响应里多一个 `focus`。列表是高频请求，为了一个偶发的深链让它多一种返回形状；而且从卡片打开窗口取全文时会把整张列表再取一遍。
- 否决：让列表的每个会话都带最后一封来信全文。200 个会话 × 邮件全文，负载不可控。

### D5 回复按钮与窗口：一个窗口，两种开法

- 窗口组件由「必须有草稿」改为「草稿可选」：`{ 会话, 草稿 | null }`。有草稿 → 预填草稿主题与正文、保留「看中文对照」，标题「回复草稿 · 〈公司〉」；没有草稿 → 正文空、主题按 `replySubjectFor(最后一封来信主题)` 预填，标题「写回复 · 〈公司〉」。
- 窗口顶部一块只读的「买家来信」：主题 + 全文（可滚动，最高约三分之一屏）。
- 卡片右侧的操作区加回复按钮：未回复且没有可用草稿 →「写回复」；已回复 →「再写一封」（空白，不带旧草稿）。未回复且有草稿时，沿用 `DesignBlock` 里现有的「查看回复草稿」，不重复放一个。
- `replySubjectFor` 是纯函数（和 D1、D2 同文件）：空 → 空；以 `re:`（不分大小写）开头 → 原样；否则 `Re: ` + 主题。

- 否决：把「查看回复草稿」也挪到右侧操作区，三种状态同一个位置。任务书写的是「（现状）」，挪位置属于收件箱改版。
- 否决：「再写一封」带出上一次的 AI 草稿。那份草稿是针对已经回过的那封来信写的，再发一遍是重复。

### D6 留底标记由请求声明

回复接口多读一个可选字段 `fromAiDraft`（布尔）。`aiDraft = body.fromAiDraft === true`。窗口有草稿时传真，否则传否。接口的其它行为一行不改。

- 否决：服务端拿正文与库里的草稿比对来判断。用户改过的草稿仍算「来自 AI 草稿」，比对相似度是在猜。
- 否决：缺省仍为真（只在显式传否时为假）。那样任何没带这个字段的调用都会被记成 AI 草稿，正是现在的错。
- 影响面：`aiDraft` 目前没有读取方，改它不影响任何现有展示或统计；改对了是为以后区分「AI 草稿采纳率」留干净数据。

### D7 审批面的链接只在收件箱放行时出现

两个页面都用现成的 `useNavigationAccess().canOpen("/trade/inbox")`（VIS-1b 的客户端判定，与路由门同源）。今日询盘的卡没有商机 id 时不显示链接。

- 否决：不判放行直接显示。违反 `navigation/entry-visibility`「站内链接与按钮只在目标放行时出现」。

### D8 使用说明补回两行

`src/lib/navigation/help-tasks.ts` 的第 2、3 行换回任务书原文（NAV-1b 留了注释）；`entry-visibility.test.ts` 里「NAV-1c 合并前不引用『写回复』」那条断言改为「『写回复』在询盘收件箱页面源码里」。

## 任务书「不确定处」里与本 change 有关的条目

| 条目 | 核对结论 |
|---|---|
| 客户详情一次取 50 条互动，逐条解析回复目标的成本 | 按商机 id 批量查一次（D1），整页多 1 次查询；不放行时 0 次。 |
| 截图里两条 10 月的测试询盘在生产是否还有草稿、是否在 90 天窗口内 | 没有生产访问，未核对。本 change 之后两者都不再是前提：没有草稿可以「写回复」，超出窗口可以经深链打开（D4）。 |
| MAIL-1 / MAIL-2 的「让助手读这封信」入口也落在时间线条目上 | main 上 MAIL-1（`mail-read-tools`）只加了助手工具，没有动时间线；MAIL-2 未实现。目前没有需要共存的东西。 |

## 与八条硬纪律的关系

1. **零 schema**：遵守。回复目标读时计算；没有新字段、新表、迁移。
2. **出站先审批**：**不新增出站通路**。邮件只经两条既有的路发出：成员本人在收件箱回复窗口点「发送邮件」（既有接口；`docs/QINGYAN_MENGXIN_FDE_V1_TRADE_OUTBOUND_SYNC.md` 已定「Trade sends stay human-click actions」），以及既有的审批发送。本 change 让前一条路在「没有 AI 草稿」时也点得到——发的是人自己写、自己点的信，不是系统代发；接口的校验、收件人、发信实现都不变。打开窗口、打开深链、读单会话接口都不发信。
3. **禁止第三套队列**：不涉及。
4. **脱敏**：不涉及。不触碰 Muse 通道；新接口只返回本企业外贸成员本来就能在收件箱看到的会话。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不动 `sendTradeEmailForOrg` 与发件人设置；请求里没有任何邮箱相关的新参数。
7. **确定性优先**：遵守。零新增 LLM 调用：「写回复」正文留空，不触发分析或起草；回复目标与主题预填都是查表与字符串规则。
8. **测试注册**：遵守。新增两个测试文件，同一个 task 里注册进 `scripts/test-all.sh`（纯函数那个同时进 `scripts/test-ci-unit.sh`）；基线不增。

## Risks / Trade-offs

- [手写回复没有 AI 草稿那样的风险提醒与中文对照] → 这是人自己写的信；窗口上方有买家原文可对照。发送仍要求线索有邮箱且发信已配置，否则只能「已在别处发送，标记」。
- [只读成员（持 `trade.read` 不持 `trade.manage`）在收件箱也会看到「写回复」，点发送时被接口拒绝] → 与现有「查看回复草稿」「已回复，标记」的现状一致，本 change 不扩大也不收窄；时间线与审批面的入口本身要求能回（D1、D7）。
- [商机没有对应线索时（例如邮件转发进线、未经外贸线索的商机），审批面的链接点过去是「没有找到这位买家的询盘会话」] → 提示明确，列表照常可用；记入报告，量大的话后续让今日询盘接口直接给出线索 id。
- [深链打开后清掉地址参数，用户无法把「打开着回复窗口」的地址发给同事] → 可以发线索详情页；避免刷新反复弹窗更重要。
- [`convertedToSalesOpportunityId` 与 `sourceTradeProspectId` 只对上一个时，时间线没有「回复」] → 与审批发送回写同规则（D1），不会出现两处指向不同线索；这类商机记入报告。

## Migration Plan

无数据迁移。合并即生效；回滚 = revert。历史留底消息的 `aiDraft` 不回填（以前一律为真，无从区分）。

## 验证方式

- `npx tsx src/lib/trade/__tests__/reply-entry.test.ts`：回复目标解析表、时间线文字、主题预填；源码断言（按钮不依赖草稿、原文块、入口条件、审批面链接与占位文字、不含发信与模型调用）。
- `npx tsx src/lib/trade/__tests__/reply-entry-db.isolated.test.ts`（本机 Postgres 16，无库时跳过）：网站询盘进线 → 客户详情给出目标；窗饰销售与跨企业为空；`focus` 接口取到 120 天前的会话、三种找不到的情况同样 404、只读；手写回复经回复接口（`mark_sent`，测试里不真发邮件）→ `aiDraft=false`、会话已回复、同商机待批草稿作废、客户时间线多一条发出互动；声明来自草稿时为真。
- 既有测试通过数不变：`inbox-service`、`trade-recipients`（70）、外发同步与审批发送的隔离库测试；`entry-visibility`（91，随 D8 调整两条）。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`npm test`、`bash scripts/check-test-registry.sh`。
- `git diff --stat main -- prisma vercel.json ci/test-registry-baseline.txt` 无输出；`openspec validate nav-1c-reply-entry --strict`。
- 真实应用截图（本机临时库 + 虚构账号）：客户时间线的「回复」与「回复客户」、点进去后弹出的回复窗口（上方原文）、无草稿卡片的「写回复」、已回复卡片的「再写一封」、今日询盘与商机详情的链接、Lynn 的时间线（只有文字变化），放 `docs/acceptance/nav-1c/`。发信本身在 staging 用测试买家邮箱验收（任务书），本机不真发。

## 审核关注点（偏离或补充任务书之处，请拍板）

- **Q1 新增只读接口 `GET /api/trade/inbox/focus`**，而不是按任务书 Impact 给列表接口加参数（D4）。推荐：新增。
- **Q2 「再写一封」打开空白窗口**，不带上一次的 AI 草稿（D5）。推荐：空白。
- **Q3 深链找不到买家时**提示「没有找到这位买家的询盘会话」并照常显示列表；审批面的链接不预先判断商机有没有对应线索（D3）。推荐：按此。
- **Q4 留底标记由请求里的 `fromAiDraft` 决定**，缺省为否（D6）。推荐：按此。
- **Q5 没有方向的互动（手工记录）**显示「经手人：X」（D2）。推荐：按此。
- **Q6 只读外贸成员在收件箱看到「写回复」但发不出去**，与现有按钮一致，本 change 不处理。推荐：不处理，记入报告。
