# Spec Delta

## Purpose

买家来信出现在哪里，哪里就能进到回复：从客户时间线与审批面一步到询盘收件箱的回复窗口，没有 AI 草稿也能自己写，并且不新增任何发信通路。

## ADDED Requirements

### Requirement: 客户互动的回复目标
客户详情接口返回的每条互动 SHALL 带一个「回复目标」：满足全部条件时为该互动对应的外贸线索 id，否则为空。条件是：互动方向为来信；互动挂着商机；本企业内存在指向该商机的外贸线索（多条时取最早建立的那条，与审批发送写回收件箱时间线用的是同一条）；企业已开外贸模块；当前用户持 `trade.manage`；询盘收件箱页面对当前用户放行。回复目标 SHALL 在读取时计算，SHALL NOT 落库。

#### Scenario: 解析规则
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry.test.ts`
- **THEN** 有商机且有线索的来信得到线索 id；有商机无线索、无商机、方向为发出或为空的互动得到空；用户不持 `trade.manage`、企业未开外贸模块、询盘收件箱不放行三种情况下所有互动都得到空，测试通过

#### Scenario: 网站询盘进线后能从客户详情回复
- **WHEN** 在隔离库运行 `npx tsx src/lib/trade/__tests__/reply-entry-db.isolated.test.ts`，一条网站询盘进线后，由持 `trade.manage` 的外贸成员请求该客户的详情
- **THEN** 这条来信互动的回复目标是这次进线建立的线索 id

#### Scenario: 窗饰销售看不到目标
- **WHEN** 同一隔离库测试里，窗饰企业只持 `sales_rep` 的成员请求其客户详情
- **THEN** 每条互动的回复目标都为空

### Requirement: 回复目标不泄露别的企业或不可见的线索
回复目标 SHALL 只在当前企业内解析；指向其他企业线索或商机的关联 SHALL 得到空。不满足放行条件时接口 SHALL 返回空而不是报错，SHALL NOT 用不同的响应区分「没有线索」与「无权回复」。

#### Scenario: 跨企业关联不出目标
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry-db.isolated.test.ts`，另一个企业里有一条线索指向同一个商机 id
- **THEN** 本企业客户详情里的回复目标不是那条线索

### Requirement: 时间线上的回复入口
客户详情的互动时间线 SHALL 在回复目标非空的来信条目上显示「回复」按钮；时间线页签右上 SHALL 在至少有一条回复目标非空的来信时显示「回复客户」（指向最近的那一条）。两个入口 SHALL 进入询盘收件箱并直接打开该买家的回复窗口。回复目标为空的条目 SHALL NOT 显示回复按钮。

#### Scenario: 入口只跟着回复目标出现
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry.test.ts`
- **THEN** 源码断言通过：时间线条目的「回复」与页签右上的「回复客户」都以回复目标非空为条件，链接指向带该线索 id 的询盘收件箱地址

### Requirement: 时间线条目的文字
互动时间线每条记录下方 SHALL 显示方向与经手人：来信为「客户来信 · 经手人：〈姓名〉」，发出为「我方发出 · 经手人：〈姓名〉」，没有方向的记录为「经手人：〈姓名〉」。SHALL NOT 再出现「〈姓名〉 · 收到」或「〈姓名〉 · 发出」。本要求对所有企业的客户详情生效。

#### Scenario: 文字映射
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry.test.ts`
- **THEN** 三种方向的文字与本要求逐条相等，时间线组件源码里不再有「收到」「发出」两个旧说法

### Requirement: 询盘收件箱按线索或商机直达回复窗口
询盘收件箱页面的地址带线索 id 或商机 id 时，页面 SHALL 定位到该买家并打开回复窗口；商机 id SHALL 按「客户互动的回复目标」同一规则换成线索。该买家的会话不在当前筛选、默认时间窗口或列表条数上限之内时 SHALL 同样能打开。找不到对应买家（线索不存在、不属于本企业、商机没有对应线索）时页面 SHALL 提示「没有找到这位买家的询盘会话」并照常显示列表，SHALL NOT 报错或空白。

#### Scenario: 超出默认窗口的会话也能取到
- **WHEN** 在隔离库运行 `npx tsx src/lib/trade/__tests__/reply-entry-db.isolated.test.ts`，一位买家最后一封来信在 120 天前
- **THEN** 列表接口（默认 90 天）不含这位买家；按线索 id 请求 `GET /api/trade/inbox/focus` 得到这位买家的会话与最后一封来信全文；按其商机 id 请求得到同一位买家

#### Scenario: 找不到或不属于本企业
- **WHEN** 同一测试里按不存在的线索 id、别的企业的线索 id、没有对应线索的商机 id 请求该接口
- **THEN** 三者都返回同样的「未找到」结果，不含任何买家信息

### Requirement: 单个买家会话的只读接口
`GET /api/trade/inbox/focus` SHALL 按线索 id 或商机 id 返回本企业内一位买家的会话摘要与最后一封来信的主题、全文、渠道与时间；该买家没有任何来信时最后一封来信为空。接口 SHALL 要求外贸读权限（`trade.read` 或 `trade.manage`），SHALL NOT 写任何数据，SHALL NOT 受列表的筛选、时间窗口与条数上限影响。

#### Scenario: 权限与只读
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry-db.isolated.test.ts`
- **THEN** 不持外贸键的成员请求得到 403；持键成员请求前后库里的线索、消息、商机、互动、审批记录条数不变

### Requirement: 每张会话卡片都有回复按钮
询盘收件箱的每张会话卡片 SHALL 有回复按钮，SHALL NOT 以 AI 草稿存在为前提：未回复且有 AI 草稿时为「查看回复草稿」；未回复且草稿在生成中、生成失败或没有时为「写回复」；已回复时为「再写一封」。「写回复」与「再写一封」SHALL 打开回复窗口，正文为空，主题预填 `Re: ` 加最后一封来信的主题（来信没有主题时主题留空；主题本身以 `Re:` 开头时不重复加）。

#### Scenario: 按钮不依赖草稿
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry.test.ts`
- **THEN** 源码断言通过：页面在没有 AI 草稿时渲染「写回复」，已回复时渲染「再写一封」，回复窗口的打开不再要求会话带 AI 草稿

#### Scenario: 主题预填
- **WHEN** 运行同一测试
- **THEN** 来信主题为 `Bedding inquiry` 时预填 `Re: Bedding inquiry`；为 `RE: Bedding inquiry` 时原样使用；为空时预填为空

### Requirement: 回复窗口显示来信原文
回复窗口 SHALL 在编辑框上方只读显示买家最后一封来信的主题与全文，使回复时不必离开窗口。全文尚未取到时 SHALL 先显示会话卡片上的摘要。买家没有任何来信时这一块 SHALL NOT 出现。

#### Scenario: 原文块
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry.test.ts`
- **THEN** 源码断言通过：回复窗口有一块只读的来信原文，位于主题与正文输入框之前

### Requirement: 手写回复不标成 AI 草稿
经询盘收件箱回复接口留底的出站消息，其「AI 草稿」标记 SHALL 只在请求声明正文来自 AI 草稿时为真；请求未声明或声明为否时 SHALL 为假。回复窗口从「查看回复草稿」打开时 SHALL 声明为真，从「写回复」「再写一封」打开时 SHALL 声明为否。

#### Scenario: 手写回复的留底与连带效果
- **WHEN** 在隔离库运行 `npx tsx src/lib/trade/__tests__/reply-entry-db.isolated.test.ts`，对一位没有 AI 草稿、其商机有一张待批回复草稿的买家，经回复接口提交一封手写回复（不声明来自 AI 草稿）
- **THEN** 留底的出站消息「AI 草稿」标记为假；该买家的会话变为已回复；同一商机的待批回复草稿被系统作废；客户时间线多出一条方向为发出的互动（界面上显示为「我方发出」）

#### Scenario: 从草稿发出的仍标为真
- **WHEN** 同一测试里提交时声明正文来自 AI 草稿
- **THEN** 留底的出站消息「AI 草稿」标记为真

### Requirement: 不新增发信通路
本能力 SHALL NOT 新增任何对外发送的路径：邮件只经既有的询盘收件箱回复接口（成员本人在回复窗口点「发送邮件」）与既有的审批发送发出。打开回复窗口、打开深链、请求单会话接口、请求客户详情 SHALL NOT 发送任何邮件或消息，SHALL NOT 调用模型。

#### Scenario: 打开不等于发送
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry.test.ts`
- **THEN** 源码断言通过：单会话接口与回复目标解析的代码里没有发信与模型调用；回复窗口只有用户点「发送邮件」或「已在别处发送，标记」时才请求回复接口

### Requirement: 审批面到询盘收件箱的出路
今日询盘与商机详情里每张待批回复草稿卡 SHALL 带一行链接「不想用这份？去询盘收件箱自己写（发出后这份草稿自动作废）」，指向该商机在询盘收件箱的回复窗口。商机详情在没有草稿时 SHALL 显示链接「去询盘收件箱写回复」。这些链接 SHALL 只在询盘收件箱对当前用户放行时出现。商机详情记录来信的输入框占位文字 SHALL 为「把买家在别处发来的内容贴到这里，AI 会重新起草回复」。

#### Scenario: 链接与占位文字
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry.test.ts`
- **THEN** 源码断言通过：两个页面的链接文字、指向与放行条件同本要求；商机详情的占位文字为新文字，不再含 `CUSTOMER_REPLIED` 与 `FDE`
