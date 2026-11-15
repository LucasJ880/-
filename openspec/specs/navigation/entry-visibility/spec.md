# navigation/entry-visibility Specification

## Purpose
页面上的入口（手机底栏页签、`/operations` 索引卡片、`/help` 功能地图、站内跳转链接与按钮）只在路由门对当前用户放行时出现，看得见的入口点进去都不会被弹回。

## Requirements

### Requirement: 入口判定与路由门同源
任何页面在决定是否展示一个指向已登录区的入口时，SHALL 用与路由门相同的规则与输入判断该地址对当前用户是否放行；平台 super_admin SHALL 一律视为放行。客户端 SHALL 用同一个纯函数把 `/api/auth/active-org` 的响应与当前用户拼成判定输入，结果 SHALL 与路由门服务端取到的输入相同。判定输入尚未取得时，入口 SHALL NOT 出现，SHALL NOT 先显示后消失。

#### Scenario: 客户端判定输入与服务端一致
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`
- **THEN** 对每份测试企业输入，客户端由 active-org 响应拼出的判定输入与路由门取输入函数的产出逐字段相同，测试通过

#### Scenario: 客户端判定与路由门一致
- **WHEN** 运行同一测试
- **THEN** 对路由门测试里的每种身份与每条登记路径，客户端判定结果与路由门结果相同；平台 super_admin 全部放行，测试通过

### Requirement: /operations 索引只列放行的卡片
`/operations` 索引页 SHALL 只列对当前用户放行的卡片，平台 super_admin SHALL 看到全部卡片；外部 Postiz 链接仍只在配置了地址时出现。没有一张卡片放行时，页面 SHALL 显示"暂无可用的运营入口"。

#### Scenario: 运营看得到内容运营卡片
- **WHEN** 只持 `ops_staff` 岗位的成员打开 `/operations`
- **THEN** 页面列出增长中心、营销数字员工、市场情报、矩阵账号、视频资产、发布审核队列、数据看板、品牌记忆、内容日历 9 张卡片，不列「投标业务档案」（`entry-visibility.test.ts` 覆盖）

#### Scenario: 招投标岗位进不了索引页
- **WHEN** 只持 `bids` 岗位的成员请求 `/operations`
- **THEN** 路由门照旧拒绝（302 到 `/bids`）；`/operations/tender-profile` 仍可由招投标工作台进入

### Requirement: /help 功能地图从可见导航生成
`/help` 的功能地图（页面上的「全部入口」）SHALL 由当前用户侧栏可见的导航入口生成，分段与顺序 SHALL 与该用户的侧栏一致：侧栏为两段式的用户先列「常用」再列「更多」里的各分组，其余用户按侧栏分组与顺序列出；系统组在最后。每项显示入口名称与一句说明。地图 SHALL NOT 列出当前用户侧栏不可见的入口。导航注册表与系统底栏的每一项 SHALL 有非空的一句说明。页面 SHALL NOT 再引用 `docs/PROJECT_AUDIT.md`。是否两段式 SHALL 与侧栏用同一条判定（见 `navigation/focused-sidebar`）。

#### Scenario: 销售只看到自己的入口
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`，以只持 `sales_rep` 岗位的输入生成功能地图
- **THEN** 地图里的入口与该身份的侧栏可见入口完全相同，不含招投标、营销、外贸入口，测试通过

#### Scenario: 每项都有说明
- **WHEN** 运行同一测试
- **THEN** 导航注册表与系统底栏共 72 项，每项说明非空且不超过 40 个字，测试通过

#### Scenario: 两段式用户的全部入口与侧栏同序
- **WHEN** 运行同一测试，以家纺外贸企业「老板 + 外贸业务员」的输入生成功能地图
- **THEN** 第一段为「常用」，8 项的顺序与侧栏常用段相同；其后各段与侧栏「更多」里的分组及组内顺序逐项相同；系统组在最后；入口集合与侧栏可见入口完全相同

#### Scenario: 非两段式用户的全部入口不变
- **WHEN** 运行同一测试，以只持 `sales_rep` 岗位的输入生成功能地图
- **THEN** 地图没有「常用」段，分组与顺序与改动前相同

### Requirement: 站内链接与按钮只在目标放行时出现
以下站内入口 SHALL 只在其目标对当前用户放行时出现：
- 工艺单详情收口页签里的维修单链接（指向 `/install/repairs/<id>`）；
- 数字员工工作台的客户提醒、「打开销售工作区」「创建报价」（指向 `/sales/**`）；
- `/tasks` 的「进入协同空间」（指向 `/assistant`）；
- 投标 AI 分析卡片的「查看执行详情」（指向 `/workforce/<作业 id>`，作业为投标域，另要求「招投标中心」放行）；
- 手机销售底栏「新增」面板里的各入口（新客户、记跟进、快速报价 / 外贸报价、新预约、量房估价）。

工艺单详情 / 编辑页回列表的链接与删除后的跳转，在 `/blinds-orders` 不放行时 SHALL 依次退到：
1. 该工艺单的客户详情（有客户且客户详情对当前用户放行时）；
2. 当前用户的落地页（与路由门的重定向目标相同，见 `navigation/route-gate`「不放行时 302 到落地页」）。

#### Scenario: 销售看工艺单
- **WHEN** 只持 `sales_rep` 岗位的成员打开 `/blinds-orders/<id>`，该单有客户
- **THEN** 页头返回链接指向该单的客户详情而不是 `/blinds-orders`；收口页签里没有维修单链接（`entry-visibility.test.ts` 覆盖目标判定，源码断言覆盖接线）

#### Scenario: 会计看工艺单
- **WHEN** 只持 `accounting` 岗位的成员打开 `/blinds-orders/<id>`（`/blinds-orders` 与客户详情都不放行）
- **THEN** 页头返回链接指向 `/accounting`（同一测试覆盖）

#### Scenario: 运营看投标分析卡片
- **WHEN** 只持 `ops_staff` 岗位的成员在项目详情里看到投标 AI 分析卡片
- **THEN** 卡片不显示「查看执行详情」（投标域作业对其不可读；同一测试覆盖目标判定，源码断言覆盖接线）

#### Scenario: 旧模式销售的新增面板
- **WHEN** 旧模式平台角色为 `sales`、企业未启用窗饰模块的成员打开手机底栏「新增」
- **THEN** 面板里没有「外贸报价」（`/trade/quotes` 对其不放行；`entry-visibility.test.ts` 覆盖目标判定，源码断言覆盖接线）

#### Scenario: 运营看工作台
- **WHEN** 只持 `ops_staff` 岗位的成员打开 `/assistant`
- **THEN** 数字员工工作台不显示「打开销售工作区」「创建报价」与指向销售客户的提醒链接

### Requirement: /settings 索引只列放行的卡片
`/settings` 索引页的「邮箱绑定」卡片 SHALL 只在 `/settings/email` 对当前用户放行时出现。其余卡片的出现条件不变：「数字员工学习」「数字员工技能」只对平台 super_admin，「微信集成」随微信入口开关，外观、账号与企业、通知偏好对所有人。

#### Scenario: 哪些岗位有邮箱绑定卡
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`，按岗位判定设置页卡片
- **THEN** 只持 `installer`、`ops_staff`、`ops_lead`、`accounting`、`fulfillment_vinyl` 或无岗位时没有「邮箱绑定」；只持 `sales_rep`、`bids` 或 `owner` 时有，测试通过

### Requirement: 营销数字员工卡片只在其页面放行时出现
数字员工工作台的「营销增长数字员工」卡片 SHALL 只在营销数字员工页（`/marketing/employee`）对当前用户放行时出现（平台 super_admin 一律出现），SHALL NOT 按岗位派生的平台角色判定。

#### Scenario: 哪些岗位看得到营销员工
- **WHEN** 运行同一测试
- **THEN** 只持 `ops_staff`、`ops_lead`、`owner` 时卡片出现；只持 `sales_rep`、`accounting`、`installer`、`fulfillment_vinyl` 时不出现；源码断言工作台按该页面判定，测试通过

### Requirement: 底栏首格指向落地页
手机通用布局的首格在默认工作区不是安装、运营、招投标时：当前用户的落地页为 `/tasks` SHALL 为「任务」→ `/tasks`，为 `/accounting` SHALL 为「会计」→ `/accounting`，其余情况仍为「总览」→ `/`。岗位模式与旧模式相同。

#### Scenario: 首格指向落地页
- **WHEN** 运行同一测试，以岗位模式输入计算通用布局首格
- **THEN** 只持 `accounting` 时为「会计」→ `/accounting`；只持 `fulfillment_vinyl` 或无岗位时为「任务」→ `/tasks`；`owner` 仍为「总览」→ `/`，测试通过

### Requirement: /help 顶部的「我想做什么」
`/help` SHALL 在「全部入口」之前显示「我想做什么」一节，每行三列：我想做的事、点哪里、进去后怎么做。每行 SHALL 绑定一个导航入口并属于一个业务模块：企业未开该模块（与导航入口的模块判定同口径），或该入口对当前用户侧栏不可见时，整行 SHALL NOT 出现；一行都不出现时整节 SHALL NOT 出现。「点哪里」SHALL 显示该入口的名称（与侧栏同名，见 `navigation/entry-naming`）并链接到该入口。

#### Scenario: 每行绑定的入口都存在
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`
- **THEN** 「我想做什么」每一行绑定的入口 key 都在导航注册表里，测试通过

#### Scenario: 目标不可见的行不出现
- **WHEN** 运行同一测试，以家纺外贸企业只持 `trade_rep` 的输入生成「我想做什么」
- **THEN** 绑定「邮箱绑定」的那一行不出现（该入口对其不可见），其余行出现

#### Scenario: 窗饰企业没有这一节
- **WHEN** 运行同一测试，以窗饰企业各岗位（销售、合价、老板、招投标、运营、会计、安装、出单、无岗位）的输入生成「我想做什么」
- **THEN** 结果都为空，页面不渲染这一节——本期 12 行都属于外贸模块，窗饰企业没开；即使其中「邮箱绑定」「成员与组织」「知识库」这些入口对他们可见

### Requirement: 「我想做什么」的外贸内容
对家纺外贸企业「老板 + 外贸业务员」，「我想做什么」SHALL 依次列出 12 行：看今天要处理什么 → 今日询盘；回复买家 → 询盘收件箱；批准 AI 写好的回复 → 今日询盘；已经在邮箱或 WhatsApp 回过了 → 询盘收件箱；查一个买家的全部往来 → 线索资产；给买家报价 → 外贸报价；寄样并盯回音 → 寄样；查货号、价格、起订量 → 货号；展会回来批量录名片 → 展会导入；让 AI 回得更准 → 知识库；绑定发信邮箱 → 邮箱绑定；加同事、调岗位 → 成员与组织。「进去后」的文字 SHALL 只引用目标页面上实际存在的栏目与按钮名称。

#### Scenario: 12 行的顺序与目标
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`，以「老板 + 外贸业务员」的输入生成「我想做什么」
- **THEN** 得到 12 行，顺序与各行绑定的入口同本要求

#### Scenario: 引用的按钮名称在目标页面里
- **WHEN** 运行同一测试
- **THEN** 源码断言通过：各行「进去后」里用「」括起来的名称（今日新询盘、回复超时、待审批回复、样品与报价到期、查看回复草稿、写回复、发送邮件、查看草稿、批准发送、已回复，标记、对话记录、新建报价、新建寄样、手动添加、导入 MD / ZIP）都出现在对应目标页面的源码里

#### Scenario: 回复的两行写明自己写的出路
- **WHEN** 运行同一测试
- **THEN** 「回复买家」一行为「找到买家，点「查看回复草稿」或「写回复」，改好后点「发送邮件」」；「批准 AI 写好的回复」一行为「在「待审批回复」里先点「查看草稿」，再点「批准发送」；不想用就去询盘收件箱自己写」

### Requirement: /help 的副标题
`/help` 页首副标题在页面有「我想做什么」一节时 SHALL 为「先看『我想做什么』；找不到再看下面的全部入口。」，没有这一节时 SHALL 为「你在侧栏能看到的全部入口，以及每个入口是做什么的。」。

#### Scenario: 两种副标题
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`
- **THEN** 源码断言通过：页面按「我想做什么」是否有行在两句副标题之间二选一

### Requirement: /help 不含面向开发者的文字
`/help` SHALL NOT 出现面向开发者的内容：部署文档与发布前回归清单的引用（`DEPLOY_VERCEL`、`QA_P0_CHECKLIST`）、「组织与项目」一段（含 Prompt、环境等术语）。

#### Scenario: 页面源码不含开发者文字
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`
- **THEN** 源码断言通过：`/help` 页面不含 `DEPLOY_VERCEL`、`QA_P0_CHECKLIST`、「组织与项目」、`Prompt`

### Requirement: 入口说明用白话
外贸线常用入口与四个通用入口（共 19 个）的一句说明 SHALL 用白话写明「在这里能做什么」，SHALL NOT 是名词解释，SHALL NOT 出现与页面实际功能不符或只适用于别的行业的说法（如把微信机器人客服队列写成各渠道统一回复、在家纺外贸企业的日历上写量房与安装）。其余入口的说明 SHALL 保持不变。

#### Scenario: 19 条说明逐条成立
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`
- **THEN** 下列入口的说明逐条相等：今日询盘「今天要处理的：新询盘、超时没回的、等你批的回复」；询盘收件箱「所有买家来信；在这里看 AI 草稿、改好后发出回复」；线索资产「全部买家名单；点开看往来记录、背景调查并报价」；外贸报价「做报价单、发给买家、看对方有没有回」；寄样「登记寄出的样品，到期提醒你跟进买家」；货号「在售货号、FOB 价、起订量和交期；不记库存」；外贸 AI 对话「有外贸问题直接问 AI 助手」；外贸获客「找海外买家：AI 帮你发现、调查和发开发信」；竞品溯源「输入品牌或产品线索，AI 找出可能的买家和渠道」；履约协同「处理指派给你的客户工单：传图、AI 出图、回传客户」；展会导入「上传名片表格（CSV / Excel），批量建买家」；市场监测「监控目标网页的变化，提示可能的商机（需人工核对）」；消息通道「接通 WhatsApp、微信等，让买家消息进到青砚」；收入驾驶舱「从询盘到成交，每一步有多少单、卡在哪」；客户与商机「客户档案，以及每个客户谈到哪一步」；知识库「公司资料和常见问答放这里，AI 回复时会引用」；待处理事项「系统给你的提醒：要你处理或知道的事」；微信客服「客户发到企业微信机器人的消息，在这里回」；预约日历「预约与日程安排」

#### Scenario: 其余说明不变且长度合规
- **WHEN** 运行同一测试
- **THEN** 其余 53 个入口的说明与改动前相同，全部 72 条仍不超过 40 个字，测试通过
