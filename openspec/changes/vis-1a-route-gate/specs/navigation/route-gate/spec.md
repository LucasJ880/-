# Spec Delta

## Purpose

已登录用户请求任一 `(main)` 页面时，服务端先按导航注册表判定「所属模块已开 ∧ 当前岗位持键」，不满足就在渲染前 302 到默认工作区；看得见的入口都能用，看不见的入口敲 URL 也进不去。

## ADDED Requirements

### Requirement: 判定口径与侧栏同源
已登录用户请求 `(main)` 下任一页面（硬加载、站内导航与预取请求都算）时，系统 SHALL 在渲染前按该路径命中的门表条目判定：条目指向的导航入口及其全部父入口在当前用户的侧栏里可见即放行，否则不放行。判定输入 SHALL 与侧栏用的同一份（当前企业启用模块含行业包兜底、岗位权限键、岗位模式、企业角色、成员身份、工作区、投标能力信号、平台角色、Autopilot 资格）；`/api/auth/active-org` 的响应字段 SHALL 与改动前一致。

#### Scenario: 侧栏可见等价于路由放行
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 对 `sales_rep`、`installer`、`accounting`、`accounting` + `pricing_lead`、`owner`、`pricing_lead`、`bids`、`ops_lead`、`ops_staff`、`fulfillment_vinyl`、无岗位、平台 super_admin 以及旧模式抽样（`trade` / `sales` / `boss` / `operations`）中的每一种身份、门表里每一个指向侧栏入口的条目，「该入口在侧栏可见」与「该路由放行」结果相同，测试通过

#### Scenario: 子入口要求父入口可见
- **WHEN** 岗位模式下只持 `bids` 岗位的成员请求 `/capabilities/catalog`
- **THEN** 不放行（"AI 工作中心"父入口只对管理层可见）

#### Scenario: 模块未开的入口进不去
- **WHEN** Sunny（未启用 `trade` 模块）持 `owner` 岗位的成员请求 `/trade/prospects`
- **THEN** 不放行，尽管老板岗位持 `trade.read`

#### Scenario: 站内导航同样判定
- **WHEN** 只持 `sales_rep` 岗位的成员在 `/sales/home` 点击一个指向 `/projects` 的站内链接
- **THEN** 浏览器落到 `/sales/home`，`/projects` 页面内容从未出现在页面上

### Requirement: 不放行时 302 到默认工作区
不放行的页面请求 SHALL 以 HTTP 302 重定向到当前用户的默认工作区（与首页落地同一规则），页面 SHALL NOT 渲染。默认工作区本身不放行或与被请求路径相同时 SHALL 改落 `/tasks`。系统 SHALL NOT 为此新增 403 页面或在客户端判定后再跳。

#### Scenario: 销售敲外贸与招投标
- **WHEN** 岗位模式下只持 `sales_rep` 岗位的成员依次请求 `/trade/prospects`、`/revenue`、`/projects`、`/projects/intelligence`、`/bids`、`/capabilities`、`/suppliers`、`/reports`、`/marketing/employee`、`/operations/growth`、`/accounting`、`/install`、`/inventory`、`/blinds-orders`
- **THEN** 每一个都返回 302，`Location` 为 `/sales/home`

#### Scenario: 安装工敲营销与库存
- **WHEN** 只持 `installer` 岗位的成员请求 `/marketing/employee`、`/operations/growth`、`/inventory`
- **THEN** 每一个都返回 302，`Location` 为 `/install`

#### Scenario: 老板敲营收中心
- **WHEN** Sunny 持 `owner` 岗位的成员请求 `/revenue` 或 `/revenue/today`
- **THEN** 返回 302，`Location` 为 `/`

#### Scenario: 默认工作区必放行且无环
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 对测试里的每一种身份，重定向目标都是放行的路径，且从任一门表路径出发跟随重定向在两步内停在放行页面，测试通过

### Requirement: 重定向不泄露页面与判定细节
不放行时的响应 SHALL NOT 含被请求页面的任何内容（标题、按钮、筛选器、业务术语），SHALL NOT 在响应头或正文里给出被拒原因、所缺权限键或命中的门表条目。

#### Scenario: 302 响应没有页面内容
- **WHEN** 只持 `sales_rep` 岗位的成员硬加载 `/trade/prospects`
- **THEN** 响应为 302 且正文不含"线索资产"等该页文字，响应头里没有说明判定原因的自定义字段

### Requirement: 登录即可的路由
以下路由 SHALL 对任一已登录用户放行，不看模块与岗位键：`/`、`/tasks` 及其子路由、`/notifications`、`/help`、`/settings`（索引页本身）、`/settings/account`、`/settings/appearance`、`/settings/notifications`、`/settings/wechat`、`/wechat`。首页 `/` 放行后仍按既有首页落地规则跳转；两个微信页在微信入口开关关闭时仍显示"暂未开放"（见 `identity/wechat-entry`）。

#### Scenario: 销售从通知打开任务
- **WHEN** 只持 `sales_rep` 岗位的成员打开 `/tasks?open=<taskId>`
- **THEN** 页面正常打开

#### Scenario: 安装工打开通知设置
- **WHEN** 只持 `installer` 岗位的成员打开 `/settings/notifications`
- **THEN** 页面正常打开

#### Scenario: 微信页由开关管辖
- **WHEN** 微信入口开关关闭，只持 `sales_rep` 岗位的成员打开 `/settings/wechat`
- **THEN** 页面显示"暂未开放"，不被重定向

### Requirement: 无侧栏入口的路由按登记条目判定
没有侧栏入口的页面 SHALL 由注册表里「只做门、不进侧栏」的条目判定，口径与侧栏入口相同：`/sales/analytics` 要求销售模块且持 `sales.analytics.read`；`/agent-trace`、`/ai-activity`、`/settings/digital-employees/**`、`/settings/agent-skills` 只对平台 super_admin 放行；其余按门表指向与其同组的侧栏入口（如 `/sales/measure` 随"报价"，`/operations/tender-profile` 随"招投标中心"，`/inbox` 随"数字员工"）。

#### Scenario: 持复盘键的老板进销售复盘
- **WHEN** Sunny 持 `owner` 岗位的成员打开 `/sales/analytics`
- **THEN** 页面正常打开并加载数据，不出现"销售复盘页仅管理员可查看"

#### Scenario: 不持复盘键的运营被拦
- **WHEN** 只持 `ops_lead` 岗位的成员请求 `/sales/analytics`
- **THEN** 返回 302，`Location` 为 `/ops`

#### Scenario: 老板进不了平台管理员页
- **WHEN** Sunny 持 `owner` 岗位、平台角色为 `user` 的成员请求 `/ai-activity`
- **THEN** 返回 302，`Location` 为 `/`

### Requirement: 对象详情页按被链接的人放行
对象详情页 SHALL 按"谁会经站内链接或通知被带过去"放行，不随列表页收紧：`/blinds-orders/<id>`（含编辑）对持出单读、建单、安装派工、销售工作键或管理层放行；`/projects/<id>/**` 对持项目读写键、运营键或管理层放行；`/sales/customers/<id>` 对销售工作键、外贸读键或管理层放行；`/capabilities/approvals/**` 对全部企业成员放行。对应的列表页 SHALL 仍按其侧栏入口判定。

#### Scenario: 销售打开自己的工艺单
- **WHEN** 只持 `sales_rep` 岗位的成员从报价单点开 `/blinds-orders/<id>`
- **THEN** 页面正常打开；同一成员请求 `/blinds-orders` 返回 302 到 `/sales/home`

#### Scenario: 运营从交付项目点回源项目
- **WHEN** 只持 `ops_staff` 岗位的成员打开 `/projects/<id>?tab=files`
- **THEN** 页面正常打开；同一成员请求 `/projects` 返回 302 到 `/ops`

#### Scenario: 招投标从工作台进审批中心
- **WHEN** 只持 `bids` 岗位的成员打开 `/capabilities/approvals`
- **THEN** 页面正常打开；同一成员请求 `/capabilities` 返回 302 到 `/bids`

#### Scenario: 外贸把报价转成销售客户
- **WHEN** 旧模式企业平台角色为 `trade` 的成员打开 `/sales/customers/<id>`
- **THEN** 页面正常打开

### Requirement: 门表之外的路径一律拒绝
`(main)` 下没有命中任何门表条目的路径 SHALL 视为不放行，按"不放行时 302 到默认工作区"处理；系统 SHALL NOT 对未登记的路径默认放行。

#### Scenario: 未登记路径
- **WHEN** 已登录成员请求 `/no-such-workspace`
- **THEN** 返回 302 到其默认工作区

### Requirement: 门表覆盖每一个页面
`src/app/(main)/**/page.tsx` 的每一个页面 SHALL 命中门表的某一条目；`(main)` 以外的页面（登录、注册、选企业、大屏、客户报价、客户分享页）SHALL 在免登录清单或门外清单里。新增页面未登记时测试 SHALL 失败。

#### Scenario: 源码断言
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 163 个 `(main)` 页面全部命中门表，6 个 `(main)` 以外的页面全部在免登录或门外清单里，测试通过

#### Scenario: 新页面漏登记
- **WHEN** 在 `src/app/(main)/` 下新增一个页面而不登记门表，再运行同一测试
- **THEN** 测试失败并打印该页面路径

### Requirement: 不经路由门的请求
`/api/**`、中间件免登录路径、末段带文件扩展名的请求（`public/` 静态文件，如 `/sw.js`、`/manifest.json`、`/sunny-quote.html`）以及 `/login`、`/register`、`/select-org` SHALL NOT 经路由门判定，行为与改动前一致。

#### Scenario: 静态文件不被重定向
- **WHEN** 只持 `installer` 岗位的成员请求 `/sunny-quote.html` 或 `/sw.js`
- **THEN** 响应与改动前相同，不是 302

#### Scenario: 接口不走路由门
- **WHEN** 只持 `sales_rep` 岗位的成员请求 `GET /api/sales/home`
- **THEN** 响应由该接口自身的鉴权决定，不因路由门变成 302

### Requirement: 判定时效
岗位绑定、企业模块或成员身份变更后，路由门的判定 SHALL 在 30 秒内反映新状态；切换当前企业 SHALL 立即按新企业判定。

#### Scenario: 移除岗位后
- **WHEN** 管理员解除某成员的 `bids` 岗位，30 秒后该成员请求 `/bids`
- **THEN** 返回 302 到其新的默认工作区

#### Scenario: 切换企业
- **WHEN** 同时属于两家企业的成员切换当前企业后立即请求新企业未启用模块下的页面
- **THEN** 按新企业判定，返回 302

### Requirement: 两种模式都生效
路由门 SHALL 同时作用于岗位模式企业与旧模式企业；旧模式下的判定 SHALL 与该企业旧模式侧栏一致（平台角色规则），不新增旧模式的放行或拦截口径。

#### Scenario: 旧模式销售进营销工作区
- **WHEN** 旧模式企业平台角色为 `sales` 的成员请求 `/operations/growth`
- **THEN** 返回 302 到 `/sales/home`

#### Scenario: 旧模式外贸进营收中心
- **WHEN** 旧模式企业（启用 `trade`）平台角色为 `trade` 的成员请求 `/revenue`
- **THEN** 页面正常打开
