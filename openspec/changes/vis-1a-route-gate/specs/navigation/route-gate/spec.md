# Spec Delta

## Purpose

已登录用户请求任一已登录页面时，服务端先按导航入口的可见规则判定「所属模块已开 ∧ 当前岗位持键」，不满足就在渲染前 302 到该用户的落地页。看得见的入口都能用，看不见的入口敲 URL 也进不去。侧栏以外的放行只来自逐条列出的规则：登录即可的路由、没有侧栏入口的页面、对象详情页、平台 super_admin。

## ADDED Requirements

### Requirement: 判定口径与侧栏同源
已登录用户请求已登录区（`(main)`）的任一页面时，系统 SHALL 在渲染前判定。硬加载、站内导航与预取请求都算。对应侧栏入口的路由，规则是：该导航入口及其全部父入口在当前用户侧栏里可见即放行，否则不放行。其余路由按本规格后面逐条列出的规则判定。判定 SHALL 使用与侧栏完全相同的输入：当前企业启用的模块、岗位权限键、岗位模式、企业角色、成员身份、工作区、投标能力信号、平台角色、Autopilot 资格。`/api/auth/active-org` 的响应字段 SHALL 与改动前一致。

#### Scenario: 侧栏可见等价于路由放行
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 测试覆盖以下身份（平台 super_admin 另见「平台 super_admin 不受路由门限制」）：`sales_rep`、`installer`、`accounting`、`accounting` + `pricing_lead`、`owner`、`pricing_lead`、`bids`、`ops_lead`、`ops_staff`、`fulfillment_vinyl`、无岗位，梦馨 `trade_rep`、梦馨 `owner` + `trade_rep`，以及无行业包企业抽样（`trade` / `sales` / `boss` / `operations`）。对每种身份、每个只对应单个侧栏入口的路由（不含登录即可的路由、没有侧栏入口的页面、对象详情页与带「项目成员 / 无成员身份也放行」条件的路由），「该入口在侧栏可见」与「该路由放行」的结果相同，测试通过

#### Scenario: 子入口要求父入口可见
- **WHEN** 岗位模式下只持 `bids` 岗位的成员请求 `/capabilities/catalog`
- **THEN** 不放行，因为父入口"AI 工作中心"只对管理层可见（同一测试覆盖）

#### Scenario: 模块未开的入口进不去
- **WHEN** Sunny（未启用 `trade` 模块）持 `owner` 岗位的成员请求 `/trade/prospects`
- **THEN** 不放行，尽管老板岗位持 `trade.read`（同一测试覆盖）

#### Scenario: 站内导航同样判定
- **WHEN** 合并后，在生产用只持 `sales_rep` 岗位的账号从 `/sales/home` 点击一个指向 `/projects` 的站内链接
- **THEN** 浏览器落到 `/sales/home`，`/projects` 页面内容没有出现；核对结果记入 `docs/QINGYAN_VIS-1a_REPORT.md`

### Requirement: 不放行时 302 到落地页
不放行的页面请求 SHALL 以 HTTP 302 重定向，页面 SHALL NOT 渲染。重定向目标 SHALL 为该用户进入首页后最终停留的页面：管理层为 `/`，其余按首页落地规则取第一个满足的，没有则为 `/tasks`。目标本身不放行，或与被请求路径相同时，SHALL 改落 `/tasks`。`Location` SHALL NOT 带原请求的查询串。系统 SHALL NOT 为此新增 403 页面，也 SHALL NOT 在客户端判定后再跳。

#### Scenario: 销售敲外贸与招投标
- **WHEN** 岗位模式下只持 `sales_rep` 岗位的成员依次请求以下路径：`/trade/prospects`、`/revenue`、`/projects`、`/projects/intelligence`、`/bids`、`/capabilities`、`/knowledge`、`/suppliers`、`/service-inbox`、`/reports`、`/marketing/employee`、`/operations/growth`、`/accounting`、`/install`、`/inventory`、`/blinds-orders`
- **THEN** 每一个都返回 302，`Location` 为 `/sales/home`（`route-gate.test.ts` 覆盖）

#### Scenario: 安装工敲营销与库存
- **WHEN** 只持 `installer` 岗位的成员请求 `/marketing/employee`、`/operations/growth`、`/inventory`
- **THEN** 每一个都返回 302，`Location` 为 `/install`（同一测试覆盖）

#### Scenario: 老板敲营收中心
- **WHEN** Sunny 持 `owner` 岗位的成员请求 `/revenue` 或 `/revenue/today`
- **THEN** 返回 302，`Location` 为 `/`（同一测试覆盖）

#### Scenario: 无工作区落地的岗位直接落任务页
- **WHEN** 只持 `fulfillment_vinyl` 岗位的成员请求 `/bids?tab=rfq`
- **THEN** 返回 302，`Location` 为 `/tasks`；不先到 `/`，也不带 `?tab=rfq`（同一测试覆盖）

#### Scenario: 落地页必放行且无环
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 对测试里的每一种身份，重定向目标都是放行的路径；从任一已登记路径出发，一次重定向就停在放行页面，测试通过

### Requirement: 平台 super_admin 不受路由门限制
平台 super_admin 的页面请求 SHALL 一律放行，与改动前一致，包括他不是当前企业 active 成员的情况。各页面既有的平台管理员门与 Autopilot 门照旧生效。侧栏等价断言对 super_admin 不适用。

#### Scenario: 平台管理员照旧
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`，以平台 super_admin 身份请求每一条已登记路径，包括当前企业里他不是成员、模块未开的路径
- **THEN** 全部放行，测试通过

### Requirement: 会话用户失效时回登录页
会话有效、但对应用户不存在或状态不是 active 时，需判定的页面请求 SHALL 302 到 `/login`，SHALL NOT 进入路由门判定或落 `/tasks`。登录即可的路由不查用户，行为与改动前一致。

#### Scenario: 停用账号
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`，以返回"用户已停用"的输入加载器请求 `/sales/home`
- **THEN** 响应为 302，`Location` 为 `/login`，测试通过

### Requirement: 判定输入取不到时一律拒绝
需要判定的页面请求如果取不到判定输入（例如数据库不可用），系统 SHALL 302 到 `/tasks`，SHALL NOT 放行被请求页面，并 SHALL 记一条服务端日志。

#### Scenario: 取输入失败
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`，以抛错的输入加载器请求 `/bids`
- **THEN** 响应为 302，`Location` 为 `/tasks`，测试通过

### Requirement: 重定向不泄露页面与判定细节
不放行时的响应 SHALL NOT 含被请求页面的任何内容，包括标题、按钮、筛选器与业务术语。响应头与正文 SHALL NOT 给出被拒原因、所缺权限键或对应的入口。

#### Scenario: 302 响应没有页面内容与原因
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`，以只持 `sales_rep` 的输入请求 `/trade/prospects`
- **THEN** 响应为 302，正文为空，响应头只有 `Location` 与框架默认头，没有说明判定原因的自定义头，测试通过

### Requirement: 登录即可的路由
以下路由 SHALL 对任一已登录用户放行，不看模块与岗位键：`/`、`/tasks` 及其子路由、`/notifications`、`/help`、`/settings`（索引页本身）、`/settings/account`、`/settings/appearance`、`/settings/notifications`、`/settings/wechat`、`/wechat`。首页 `/` 放行后仍按既有首页落地规则跳转。两个微信页在微信入口开关关闭时仍只显示"暂未开放"（见 `identity/wechat-entry`）；开关打开时，侧栏不显示"微信集成"的用户也能打开这两页；`/tasks`、`/notifications`、`/settings` 对侧栏里没有对应入口的纯销售同样放行。

#### Scenario: 白名单放行
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 对每一种身份，上述路由都放行，测试通过

#### Scenario: 销售从通知打开任务
- **WHEN** 只持 `sales_rep` 岗位的成员打开 `/tasks?open=<taskId>`
- **THEN** 页面正常打开

#### Scenario: 微信页由开关管辖
- **WHEN** 微信入口开关关闭，只持 `sales_rep` 岗位的成员打开 `/settings/wechat`
- **THEN** 页面显示"暂未开放"，不被重定向

### Requirement: 销售复盘页按复盘键放行
`/sales/analytics` SHALL 对启用 `sales` 模块、且持 `sales.analytics.read` 的成员放行，不再只对平台 super_admin 放行。放行后页面 SHALL NOT 显示"销售复盘页仅管理员可查看"，所见数据范围由接口按键与范围判定。

#### Scenario: 复盘键规则
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 持 `sales.analytics.read` 的 `owner`、`pricing_lead`、`accounting`、`sales_rep` 放行，`ops_lead`、`bids`、`installer` 不放行，测试通过

#### Scenario: 持复盘键的老板进销售复盘
- **WHEN** 合并后，在生产用 Sunny 持 `owner` 岗位的账号打开 `/sales/analytics`
- **THEN** 页面加载数据，不出现"销售复盘页仅管理员可查看"；核对结果记入报告

#### Scenario: 不持复盘键的运营被拦
- **WHEN** 只持 `ops_lead` 岗位的成员请求 `/sales/analytics`
- **THEN** 返回 302，`Location` 为 `/ops`

### Requirement: 平台管理员页只对平台 super_admin 放行
以下页面 SHALL 只对平台 super_admin 放行：`/agent-trace`、`/ai-activity`、`/settings/digital-employees/**`、`/settings/agent-skills`，以及项目的智能体、提示词、工具、知识库、反馈、反馈标签、质量子页（`/projects/<id>/{agents,prompts,tools,knowledge-bases,feedbacks,feedback-tags,quality}/**`）。企业老板与其他岗位 SHALL NOT 因岗位键进入这些页面。

#### Scenario: 平台管理员页规则
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 上列页面只对平台 super_admin 放行，测试通过

#### Scenario: 老板进不了平台管理员页
- **WHEN** Sunny 持 `owner` 岗位、平台角色为 `user` 的成员请求 `/ai-activity` 或 `/projects/<id>/prompts`
- **THEN** 返回 302，`Location` 为 `/`

### Requirement: 其余无侧栏入口的页面随相关入口放行
没有侧栏入口的其余页面 SHALL 随相关入口判定：
- `/sales/measure` 随"报价"；
- `/operations/tender-profile` 随"招投标中心"；
- `/inbox` 随"数字员工"；
- `/sales/calendar` 在"日历"可见者之外，SHALL 还对持 `install.task.update` 的安装工放行；
- `/sales/website-bookings` SHALL 对持 `sales.customer.create` 或 `sales.customer.read` 的成员与管理层放行；
- `/settings/email` SHALL 对持销售工作键、`project.create` / `project.update`、`trade.read` / `trade.manage` 的成员与管理层放行；
- `/organizations`（列表页本身）SHALL 在侧栏"成员与组织"可见时放行，用户在当前企业没有 active 成员身份时也放行（便于从"前往组织"进入）。

#### Scenario: 随入口规则
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 上列页面对测试身份的放行结果与本要求一致，测试通过

#### Scenario: 安装工看日历
- **WHEN** 只持 `installer` 岗位的成员打开 `/sales/calendar`
- **THEN** 页面正常打开（`installation/install-tasks`「安装工页面与日历」不变）

#### Scenario: 会计看网站预约
- **WHEN** 只持 `accounting` 岗位的成员打开 `/sales/website-bookings`
- **THEN** 页面正常打开（`calendar/website-booking-intake`「页面与入口」不变）

#### Scenario: 梦馨外贸绑定邮箱
- **WHEN** 梦馨只持 `trade_rep` 岗位的成员打开 `/settings/email`
- **THEN** 页面正常打开；只持 `installer` 岗位的成员请求同一路径返回 302 到 `/install`

### Requirement: 对象详情页按被链接的人放行
对象详情页 SHALL 按"谁会经站内链接或通知被带过去"放行，不随列表页收紧：
- `/blinds-orders/<id>`（含编辑）：企业启用 `window_covering` 模块，且持出单读、建单、安装派工、销售工作键之一，或是管理层。
- `/projects/<id>` 及其非平台管理员子页：企业启用 `bids` 或 `projects` 模块，且持项目读写键或运营键、或是当前企业内任一项目的 active 成员、或是管理层。
- `/sales/customers/<id>`：企业启用 `sales` 模块，且持销售工作键或外贸读键，或是管理层。
- `/capabilities/approvals/**`：全部企业成员，包括纯销售。

对应的列表页 SHALL 仍按其侧栏入口判定。

#### Scenario: 详情放行规则
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 上列四类详情页对测试身份的放行结果与本要求一致，对应列表页按侧栏判定，测试通过

#### Scenario: 销售打开自己的工艺单与客户
- **WHEN** 只持 `sales_rep` 岗位的成员打开 `/blinds-orders/<id>`、`/sales/customers/<id>`、`/capabilities/approvals`
- **THEN** 三个页面都正常打开；同一成员请求 `/blinds-orders` 返回 302 到 `/sales/home`

#### Scenario: 运营从交付项目点回源项目
- **WHEN** 只持 `ops_staff` 岗位的成员打开 `/projects/<id>?tab=files`
- **THEN** 页面正常打开；同一成员请求 `/projects` 返回 302 到 `/ops`

#### Scenario: 项目成员从通知打开项目
- **WHEN** 只持 `installer` 岗位、但是当前企业某项目 active 成员的人打开 `/projects/<id>`
- **THEN** 页面正常打开（项目内能看到什么仍由项目读权限接口决定）

#### Scenario: 招投标从工作台进审批中心
- **WHEN** 只持 `bids` 岗位的成员打开 `/capabilities/approvals`
- **THEN** 页面正常打开；同一成员请求 `/capabilities` 返回 302 到 `/bids`

#### Scenario: 外贸把报价转成销售客户
- **WHEN** 无行业包企业里平台角色为 `trade` 的成员、或梦馨只持 `trade_rep` 岗位的成员打开 `/sales/customers/<id>`
- **THEN** 页面正常打开

### Requirement: 未登记的路径一律拒绝
已登录区里没有登记可见规则的路径 SHALL 视为不放行，按"不放行时 302 到落地页"处理。系统 SHALL NOT 对未登记的路径默认放行。平台 super_admin 除外（见「平台 super_admin 不受路由门限制」），他请求未登记路径时与改动前一样，由页面自身决定（不存在即 404）。

#### Scenario: 未登记路径
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`，以任一非 super_admin 身份请求 `/no-such-workspace`
- **THEN** 返回 302 到该身份的落地页，测试通过

### Requirement: 每个页面都已登记
已登录区的每一个页面 SHALL 有登记的可见规则，且「页面 → 规则」的对应 SHALL 在测试快照里逐条列出。新增页面不在快照里时，测试 SHALL 失败，即使它落在已有前缀之下、能继承一条规则。已登录区以外的页面（登录、注册、选企业、大屏、客户报价、客户分享页）SHALL 在免登录清单或门外清单里。

#### Scenario: 源码断言
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 快照里 163 个已登录区页面与实际页面一一对应，每个都映射到其规则；6 个已登录区以外的页面全部在免登录或门外清单里，测试通过

#### Scenario: 新页面漏登记
- **WHEN** 在已登录区新增一个页面（例如 `/projects/<id>/new-tab`，落在已有前缀之下）而不更新快照，再运行同一测试
- **THEN** 测试失败，并打印该页面路径

### Requirement: 不经路由门的请求
以下请求 SHALL NOT 经路由门判定，行为与改动前一致：
- `/api/**`；
- 免登录路径；
- `public/` 静态文件：末段带文件扩展名、且第一段不是已登录区一级路径的请求。是否要求登录与改动前相同：图片（`svg` / `png` / `jpg` / `jpeg` / `gif` / `webp`）不要求登录，如 `/icons/icon-192x192.png`、`/logo.png`；其余（如 `/sw.js`、`/manifest.json`、`/sunny-quote.html`、`/sku-catalog.csv`）仍要求登录；
- `/login`、`/register`、`/select-org`；
- 错误上报隧道 `/monitoring`。

#### Scenario: 请求分类
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 上列请求全部判为不经路由门、不取判定输入；登录即可的路由放行且不取判定输入，测试通过

#### Scenario: 带扩展名的已登录区路径照样判定
- **WHEN** 只持 `sales_rep` 岗位的成员请求 `/trade/prospects/x.json` 或 `/projects/a.png`
- **THEN** 按页面判定，返回 302 到 `/sales/home`；未登录时与其他页面一样跳 `/login`（`route-gate.test.ts` 覆盖分类）

#### Scenario: 未登录时的静态文件
- **WHEN** 未登录的浏览器请求 `/icons/icon-192x192.png`（登录页上的图标）与 `/logo.png`（免登录的 `/display` 页用到），再请求 `/sw.js`
- **THEN** 两个图片正常返回，不被重定向；`/sw.js` 与改动前一样 302 到登录页（`route-gate.test.ts` 覆盖分类与先后）

#### Scenario: 静态文件不被重定向
- **WHEN** 只持 `installer` 岗位的成员请求 `/sunny-quote.html` 或 `/sw.js`
- **THEN** 响应与改动前相同，不是 302

### Requirement: 判定时效
岗位绑定、企业模块或成员身份变更后，路由门 SHALL 在 30 秒内按新状态判定。切换当前企业后的下一个请求 SHALL 立即按新企业判定。

#### Scenario: 缓存时效
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 判定输入缓存在 30 秒后失效；不同企业的输入互不复用；超过上限时最旧的先被淘汰，测试通过

#### Scenario: 移除岗位后
- **WHEN** 管理员解除某成员的 `bids` 岗位，30 秒后该成员请求 `/bids`
- **THEN** 返回 302 到其新的落地页

### Requirement: 两种模式都生效
路由门 SHALL 同时作用于两类企业，均不另立放行或拦截口径：
- 岗位模式企业：Sunny（窗饰）与梦馨（家纺外贸，`home_textile_trade_v1`）都属此类；
- 旧模式企业：没有行业包的企业，判定与其旧模式侧栏（平台角色规则）一致。

#### Scenario: 旧模式抽样
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 无行业包企业的 `trade` / `sales` / `boss` / `operations` 四个抽样（企业启用 `sales`、`trade`、`marketing`、`operations`、`product_content`、`supply_chain`），放行结果都与其旧模式侧栏一致，测试通过

#### Scenario: 梦馨老板照常
- **WHEN** 梦馨持 `owner` + `trade_rep` 岗位的成员（Cathy）请求 `/trade/prospects/<id>`、`/revenue`、`/product-content`、`/operations/growth`、`/settings/email`
- **THEN** 全部放行

#### Scenario: 梦馨外贸业务员进营销工作区
- **WHEN** 梦馨只持 `trade_rep` 岗位的成员请求 `/operations/growth`
- **THEN** 返回 302，`Location` 为 `/tasks`（梦馨外贸业务员进入首页后的既有落地）

#### Scenario: 旧模式销售与外贸进营销工作区
- **WHEN** 无行业包企业里平台角色为 `sales` 或 `trade` 的成员请求 `/operations/growth`
- **THEN** 返回 302 到各自落地页：销售为 `/sales/home`；外贸为 `/tasks`，即旧模式外贸进入首页后的既有落地

#### Scenario: 旧模式外贸进营收中心
- **WHEN** 无行业包企业（启用 `trade`）里平台角色为 `trade` 的成员请求 `/revenue`
- **THEN** 页面正常打开
