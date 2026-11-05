# notifications/click-targets Specification

## Purpose
通知点开后去哪里：顶栏铃铛、通知页与邮件链接共用同一张对照表，新增讨论区与项目文件两个目标；未登录的人打开链接，登录后回到原来要去的页面，且只会回到站内地址。

## Requirements

### Requirement: 跳转地址的取用顺序
一条通知的跳转地址 SHALL 按以下顺序，取第一条有结果的规则：
1. 安装、尾款、质保、返修类通知：与本次之前相同（含 `installation/balance-confirmation`「通知落点」）；
2. 按 `entityType` 取「协作对象」「业务对象」「销售与营收对象」三条跳转地址规则；
3. 带项目与活动：`/projects/{projectId}?activity={activityId}`；
4. 带项目：`/projects/{projectId}`。

都没有结果时，没有跳转地址。地址里的 id SHALL 做 URL 编码。

#### Scenario: 只带项目
- **WHEN** 一条通知的 `entityType` 不在上述三条规则里，带 `projectId` 为 P，不带活动
- **THEN** 跳转地址为 `/projects/P`

#### Scenario: 什么都不带
- **WHEN** 一条通知的 `entityType` 不在上述三条规则里，也不带项目
- **THEN** 没有跳转地址

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/notification-href.test.ts`
- **THEN** 取用顺序、三条规则的每一行、`next` 校验与登录跳转地址的断言全部通过，铃铛与通知页使用同一规则的源码断言通过，退出码 0

### Requirement: 协作对象的跳转地址
按 `entityType`，协作对象的跳转地址 SHALL 为：
- `task`：`/tasks?open={entityId}`
- `project_discussion`：`/projects/{projectId}?tab=workbench#project-discussion`
- `project_files`：`/projects/{projectId}?tab=files`
- `project`：`/projects/{entityId}`

#### Scenario: 讨论区提及
- **WHEN** 一条 `project_discussion` 通知的 `projectId` 为 P
- **THEN** 跳转地址为 `/projects/P?tab=workbench#project-discussion`

#### Scenario: 项目文件上传
- **WHEN** 一条 `project_files` 通知的 `projectId` 为 P
- **THEN** 跳转地址为 `/projects/P?tab=files`

### Requirement: 业务对象的跳转地址
按 `entityType`，工艺单、审批与外贸对象的跳转地址 SHALL 为：
- `blinds_order`：`/blinds-orders/{entityId}`
- `approval`：`/capabilities/approvals/{entityId}`
- `trade_prospect`：`/trade/prospects/{entityId}`
- `trade_booth_summary`：`/trade/booth-cards?day={entityId}`

#### Scenario: 工艺单通知
- **WHEN** 一条 `blinds_order` 通知的 `entityId` 为 B
- **THEN** 跳转地址为 `/blinds-orders/B`

### Requirement: 销售与营收对象的跳转地址
按 `entityType`，销售与营收对象的跳转地址 SHALL 为：
- `muse_inquiry`：`/sales/inquiries/{entityId}`
- `sales_quote`：`/sales/quote-sheet?mode=order&quoteId={entityId}`，带组织时加 `&orgId={orgId}`
- `sales_customer`：`/sales/customers/{entityId}`
- `sales_actions`：`/sales?view=customers`
- `visualizer_session`：`/sales/visualizer/{entityId}`
- `revenue_opportunity`：`/revenue/{entityId}`

#### Scenario: 带组织的报价通知
- **WHEN** 一条 `sales_quote` 通知的 `entityId` 为 Q、组织为 O
- **THEN** 跳转地址为 `/sales/quote-sheet?mode=order&quoteId=Q&orgId=O`

### Requirement: 铃铛、通知页与邮件跳到同一地址
点开通知时：
- 顶栏铃铛与通知页 SHALL 跳到对照表给出的同一地址；
- 照旧把通知标为已读；
- 照旧为安装类、报价类与展会小结通知记住所选组织。

没有跳转地址时，只标为已读，不跳转。

邮件里的链接 SHALL 为站点根地址加同一地址；没有跳转地址时，指向 `/notifications`。

#### Scenario: 铃铛里点审批通知
- **WHEN** 在顶栏铃铛点开一条 `entityType = approval` 的通知
- **THEN** 跳到 `/capabilities/approvals/{entityId}`，与在通知页点开相同

#### Scenario: 铃铛与通知页的任务地址一致
- **WHEN** 分别在铃铛与通知页点开同一条 `entityType = task` 的通知
- **THEN** 两处都跳到 `/tasks?open={entityId}`

### Requirement: 讨论区锚点
打开带 `#project-discussion` 的项目地址时，项目页 SHALL 打开工作台标签，并在讨论区渲染出来后滚动到讨论区。

#### Scenario: 从提及通知进入
- **WHEN** 点开一条讨论区提及通知
- **THEN** 项目页显示工作台，讨论区滚动到可见位置

### Requirement: 未登录访问后回到原页面
未登录访问需要登录的页面时，系统 SHALL 跳到 `/login?next={原路径与查询串}`；原路径为 `/` 时，不带 `next`。登录成功后（包括中间经过选择组织页），SHALL 进入 `next`；原地址带锚点时，SHALL 保留该锚点。未登录的接口请求 SHALL 仍返回 401。

#### Scenario: 从邮件链接进入
- **WHEN** 未登录的用户打开邮件里的 `https://qingyan.ca/tasks?open=T1`
- **THEN** 先跳到 `/login?next=%2Ftasks%3Fopen%3DT1`；登录后进入 `/tasks?open=T1`

#### Scenario: 接口请求
- **WHEN** 未登录请求 `/api/notifications`
- **THEN** 返回 401，不跳转

### Requirement: 登录后只回到站内地址
登录页与选择组织页 SHALL 只接受满足以下全部条件的 `next`：
- 以 `/` 开头；
- 不以 `//` 开头；
- 不含反斜杠、空白或控制字符。

其他值 SHALL 当作 `/` 处理；SHALL NOT 跳到站外地址。

#### Scenario: 站外地址
- **WHEN** 打开 `/login?next=//evil.example`，或 `/login?next=/\evil.example`，然后登录
- **THEN** 登录后进入 `/`
