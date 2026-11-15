# Proposal：看到来信就能回（NAV-1c）

TASKFLOW：NAV-1c（Phase N；任务书 `docs/QINGYAN_NAV-1_PLAIN_NAV_REPLY_TASKBRIEF.md` §NAV-1c，Lucas 2026-11-14 拍板「回复以询盘收件箱为主（可改可发），今日询盘保留为老板审批视图」）。NAV-1a（#453）、NAV-1b（#463）已合并。核对基线：main `0925ec9d`（2026-11-15）；任务书为本 change 引用的文件相对 `dd0e99d` 都没有变。不触碰 `muse-bridge`，无受影响的 Muse 意图。

## Why

Cathy 在客户详情的互动时间线上看到买家来信，旁边却没有任何地方可以点回复；能回复的询盘收件箱只在 AI 草稿生成之后才出现按钮，草稿在生成、失败或根本没有时，卡片上只剩「已回复，标记」。把「回复」入口接到客户来信出现的地方，并让收件箱在没有 AI 草稿时也能自己写。

## What Changes

**客户详情 · 互动时间线**
- 给客户详情接口返回的每条互动补一个只读字段「回复目标」（线索 id 或空）。只有同时满足这些条件才给出目标：互动是来信、挂着商机、该商机有对应的外贸线索；企业开了外贸模块；当前用户持 `trade.manage`；询盘收件箱对其放行。读时计算，零 schema。
- 给有回复目标的来信条目加「回复」按钮；时间线页签右上「导入对话」「记录」旁加「回复客户」（取最近一条有目标的来信，没有则不出现）。点击进入询盘收件箱并直接打开该买家的回复窗口。
- 改条目下方的文字：来信显示「客户来信」，发出显示「我方发出」，人名前加「经手人：」；不再出现「人名 · 收到」。所有企业的客户详情都生效。

**询盘收件箱 `/trade/inbox`**
- 支持深链：地址带线索 id 或商机 id 时，定位到该买家并打开回复窗口；该会话不在当前筛选、90 天窗口或 200 条上限内也能打开；找不到对应买家时提示「没有找到这位买家的询盘会话」。
- 新增只读接口 `GET /api/trade/inbox/focus`：按线索 id 或商机 id 取单个买家的会话与最后一封来信全文（不受筛选、时间窗口与条数上限影响）。
- 让每张会话卡片始终有一个回复按钮：未回复且有 AI 草稿 →「查看回复草稿」（现状）；未回复且草稿生成中、失败或没有 →「写回复」；已回复 →「再写一封」。「写回复」「再写一封」打开同一个窗口，正文留空，主题预填 `Re: 〈最后一封来信主题〉`。
- 在回复窗口的编辑框上方显示买家最后一封来信的主题与全文（只读）。
- 改 `POST /api/trade/inbox/[prospectId]/reply`：留底消息的「AI 草稿」标记不再一律为真，只在请求声明正文来自 AI 草稿时为真，手写的为假。发送方式、收件人、外发后的同步与作废都不变。

**审批面（今日询盘、商机详情）**
- 给每张待批草稿卡加一行链接：「不想用这份？去询盘收件箱自己写（发出后这份草稿自动作废）」，指向同一深链。作废是既有行为，本 change 不改。
- 给商机详情「尚无草稿」处加「去询盘收件箱写回复」链接。
- 改商机详情输入框的占位文字为「把买家在别处发来的内容贴到这里，AI 会重新起草回复」。
- 以上三处链接只在询盘收件箱对当前用户放行时出现。

**使用说明**
- 补回 NAV-1b 留下的两行：「回复买家」写「…点『查看回复草稿』或『写回复』…」，「批准 AI 写好的回复」补「不想用就去询盘收件箱自己写」。

## Capabilities

### New Capabilities
- `trade/inquiry-reply-entry`: 买家来信出现的地方都能进到回复——客户时间线的回复目标与入口、时间线文字、询盘收件箱的深链与无草稿回复、回复窗口里的来信原文、手写与 AI 草稿的留底标记、审批面到收件箱的链接。

### Modified Capabilities
- `navigation/entry-visibility`: 「『我想做什么』的外贸内容」的场景里，「进去后」引用的按钮名称清单加入「写回复」（要求正文不变）。

## Impact

- 接口：`GET /api/sales/customers/[id]`（互动多一个字段）、`POST /api/trade/inbox/[prospectId]/reply`（多读一个可选请求字段）、新增 `GET /api/trade/inbox/focus`。
- 页面：`src/app/(main)/sales/customers/[id]/`（`interaction-timeline.tsx`、`page.tsx`、`types.ts`）、`src/app/(main)/trade/inbox/page.tsx`、`src/app/(main)/revenue/today/page.tsx`、`src/app/(main)/revenue/[id]/page.tsx`。
- 库：新增 `src/lib/trade/reply-target.ts`（回复目标解析与时间线文字映射）；`src/lib/trade/inbox-service.ts`（单会话读取）；`src/lib/navigation/help-tasks.ts`（两行文字）。
- 测试：新增 `src/lib/trade/__tests__/reply-entry.test.ts`（纯函数 + 源码断言）与 `reply-entry-db.isolated.test.ts`（隔离库），都注册进 `scripts/test-all.sh`；`entry-visibility.test.ts` 随两行文字调整。
- 出站：不新增发信通路。手写回复走的是既有的「人在收件箱点发送」那条路（`docs/QINGYAN_MENGXIN_FDE_V1_TRADE_OUTBOUND_SYNC.md`：Trade sends stay human-click actions）。
- 数据库、权限键、路由门映射表、模块、岗位模板、定时任务：不动。零新增 LLM 调用（「写回复」留空，不调模型）。
- 没有开关，合并即生效；回滚 = revert。无 BREAKING（时间线文字的变化对所有企业可见，但只是换了说法）。

## Out of scope

- 在审批卡里直接改草稿、把待批草稿带进收件箱编辑框（NAV-3）。
- 合并两套 AI 草稿（收件箱分析草稿与审批草稿）。
- 新的发信通路、把收件箱发送改成先建审批卡、WhatsApp / 微信的站内直接回复（仍是「已在别处发送，标记」）。
- 询盘收件箱里已有按钮对只读成员（持 `trade.read` 不持 `trade.manage`）的显隐——现状是按钮都显示、点发送时接口拒绝，本 change 不改。
- 窗饰客户、手工记录的互动加回复入口（没有回复目标，界面除文字外不变）。
- MAIL-2 的「让助手读这封信」入口（尚未实现；后合并的一方负责与本 change 的「回复」按钮排版共存）。
- 列表接口 `GET /api/trade/inbox` 的筛选、时间窗口与条数上限。
- 手机端的回复入口排版优化。
