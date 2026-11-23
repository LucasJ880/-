# agents/agent-tasks-recent-view Specification

## Purpose
`GET /api/agent/tasks/recent`（调用者自己建的最近任务）返回哪些任务、不是平台管理员的人看到的步骤内容、不返回什么；项目任务列表 `GET /api/agent/tasks?projectId=` 的条数；以及 `/api/agent/tasks/` 下的每个路由都登记在授权布线契约测试里。

## Requirements

### Requirement: 只返回调用者现在仍能打开项目的任务
`GET /api/agent/tasks/recent` SHALL 只返回同时满足下面两条的任务：
- 任务是调用者建的；
- 调用者现在能打开任务所属的项目，判断与 `GET /api/agent/tasks/:taskId` 的项目读权限相同。

对不是平台 super_admin 的调用者，「能打开」SHALL 指：项目已分发，且调用者是项目负责人、项目所在组织里组织成员身份为 active 的所有者或管理员、或该项目的 active 成员（不论项目角色）。平台 super_admin SHALL 看到自己建的全部任务，包括未分发项目上的。以岗位预览身份访问的 super_admin SHALL 按预览身份判断。

#### Scenario: 还能打开项目的人照常看到
- **WHEN** 项目的 active 只读成员、项目所在组织的管理员（不是项目成员）、项目负责人（已离开该组织、不是项目成员）分别调用 `GET /api/agent/tasks/recent`，各自在这个已分发项目上建过任务
- **THEN** 三次都返回 200，各自建的这些任务都在 `tasks` 里

#### Scenario: 与项目读权限逐人一致（隔离库测试）
- **WHEN** 用隔离库运行 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/agent-tasks/__tests__/recent-view-db.isolated.test.ts`，测试对每个夹具用户，比较 `?limit=20` 返回的任务序列与「对该用户建过任务的每个项目逐一检查项目读权限，放行的任务按建立时间倒序取前 20 条」
- **THEN** 每个用户两边完全相同（含顺序），全部用例通过，退出码为 0

### Requirement: 打不开项目的人看不到自己在那里建过的任务
下面这些调用者 SHALL NOT 在 `GET /api/agent/tasks/recent` 的结果里看到自己在对应项目上建过的任务：
- 项目成员身份已停用的原项目成员；
- 别的组织的用户，包括别的组织的管理员；
- 同一组织里不是该项目成员、也不是组织所有者或管理员的用户；
- 组织成员身份已停用、又不是该项目成员的原组织管理员；
- 不是 super_admin 的人，对未分发项目上的任务（包括项目负责人名下的巡检任务）。

#### Scenario: 被移出项目的人
- **WHEN** 一个原项目成员（成员身份已改为 inactive）调用 `GET /api/agent/tasks/recent`，他以前在这个项目上建过两条任务
- **THEN** 返回 200，`tasks` 里没有这两条任务，正文里不出现这个项目的名字

#### Scenario: 在别的企业的项目上建过任务的人
- **WHEN** 乙组织的管理员调用 `GET /api/agent/tasks/recent`，他以前在甲组织的项目上建过一条任务
- **THEN** 返回 200，`tasks` 里没有这条任务

#### Scenario: 同企业但不是项目成员
- **WHEN** 甲组织的普通成员（不是项目成员、不是组织管理员）调用 `GET /api/agent/tasks/recent`，他以前在甲组织的一个项目上建过一条任务
- **THEN** 返回 200，`tasks` 里没有这条任务

#### Scenario: 未分发项目上的巡检任务
- **WHEN** 项目负责人（不是 super_admin）调用 `GET /api/agent/tasks/recent?triggerType=cron`，系统以他的名义在一个未分发的项目上建过巡检任务
- **THEN** 返回 200，`tasks` 里没有这条巡检任务；super_admin 以同样方式查看自己在未分发项目上建的任务时，任务在结果里

### Requirement: 触发方式筛选与排序照旧
`triggerType` 参数 SHALL 照旧只返回该触发方式的任务；结果 SHALL 照旧按建任务时间从新到旧排列；响应形状 SHALL 照旧是 `{ tasks }`。

#### Scenario: 只按触发方式筛
- **WHEN** 项目负责人在同一个已分发项目上有 cron 与 manual 两种任务，调用 `GET /api/agent/tasks/recent?triggerType=cron`
- **THEN** `tasks` 里只有 cron 任务

#### Scenario: cron 筛选下的排序
- **WHEN** 一个成员在能打开的项目上有 11 条 cron 任务与若干 manual 任务，调用 `GET /api/agent/tasks/recent?triggerType=cron`
- **THEN** `tasks` 是其中最新的 10 条 cron 任务，按建任务时间从新到旧

### Requirement: 条数上限按可见任务计
`limit` 参数 SHALL 只在去掉首尾空白后是十进制正整数（不带正负号、小数点、指数、前导零或十六进制前缀）时使用；缺省、空串、0、负数、小数、`0x10`、`1e1`、`5.0`、`+3` 或不是数字时 SHALL 按 10；大于 20 时 SHALL 按 20。任何情况下 `tasks` SHALL NOT 多于 20 条。

上限 SHALL 作用在筛掉打不开的项目之后：结果是调用者能打开的任务里最近的 N 条，打不开的项目上的任务 SHALL NOT 占用名额。

#### Scenario: 新近的不可见任务不挤掉可见任务
- **WHEN** 一个项目成员在他能打开的项目上有 22 条较早的任务，另在打不开的项目上有 25 条更新的任务，调用 `GET /api/agent/tasks/recent?limit=5`
- **THEN** 返回 200，`tasks` 是他能打开的项目上最新的 5 条任务，打不开的项目上的任务一条都不出现

#### Scenario: 不带 limit 与超过上限
- **WHEN** 同一个成员分别不带 `limit`、带 `?limit=50` 调用
- **THEN** 两次都返回 200；不带时 `tasks` 是能打开的项目上最新的 10 条，带 50 时是最新的 20 条

#### Scenario: 负数的 limit
- **WHEN** 同一个成员调用 `GET /api/agent/tasks/recent?limit=-5`
- **THEN** 返回 200，`tasks` 是能打开的项目上最新的 10 条，不是最早的那些

#### Scenario: 不是十进制正整数的 limit
- **WHEN** 同一个成员分别以 `abc`、`0`、`2.5`、空串、`0x10`、`1e1`、`5.0`、`+3`（查询串里写作 `%2B3`）作为 `limit` 调用 `GET /api/agent/tasks/recent`
- **THEN** 每次都返回 200，`tasks` 都是能打开的项目上最新的 10 条

#### Scenario: 交给查询的条数（不连库）
- **WHEN** 运行 `npx tsx src/lib/agent-tasks/__tests__/recent-route-args.test.ts`
- **THEN** 退出码为 0；25 种 `limit` 写法下，最近任务交给查询的条数都按上面的规则、都在 1 到 20 之间

### Requirement: 项目任务列表的条数
`GET /api/agent/tasks?projectId=` 的 `limit` 参数 SHALL 用与上一条相同的十进制正整数规则；不是时 SHALL 按 20，大于 100 时 SHALL 按 100。任何情况下 `tasks` SHALL NOT 多于 100 条，负数 SHALL NOT 让结果从最早的任务取起。其余行为（项目读权限、排序、字段）SHALL 不变。

#### Scenario: 负数与非法的 limit
- **WHEN** 项目成员以 `-5`、`-1000`、`abc`、`0`、`2.5`、`0x10` 作为 `limit` 调用 `GET /api/agent/tasks?projectId=<项目>`，该项目上共有 41 条任务
- **THEN** 每次都返回 200，`tasks` 是该项目最新的 20 条，按建任务时间从新到旧

#### Scenario: 合法与超过上限的 limit
- **WHEN** 同一个成员分别不带 `limit`、带 `?limit=5`、带 `?limit=150` 调用
- **THEN** 依次是最新的 20 条、最新的 5 条、全部 41 条（按上限 100 取），都从新到旧

### Requirement: 不是平台管理员的人看到的检查报告为空
对不是平台管理员的调用者（包括以岗位预览身份访问的 super_admin），`GET /api/agent/tasks/recent` 返回的每一步 SHALL 带 `checkReportJson`，值 SHALL 为 `null`。其余字段 SHALL 照旧：
- 任务的编号、类型、触发方式、意图、状态、当前步序、总步数、建立与完成时间、所属项目的编号与名字；
- 步骤的编号、标题、状态、摘要。

响应 SHALL NOT 新增字段。

#### Scenario: 只读成员看自己的任务
- **WHEN** 项目的 active 只读成员调用 `GET /api/agent/tasks/recent`，他建的一条任务有一步的检查报告带「步骤执行失败：…」的原始报错
- **THEN** 返回 200；这条任务的每一步 `checkReportJson` 都是 `null`；步骤标题、状态、摘要与库里一致

#### Scenario: 以岗位预览身份访问的 super_admin
- **WHEN** super_admin 以预览企业丙的岗位预览身份调用 `GET /api/agent/tasks/recent`，他是丙的项目 P6 的 active 成员、在 P6 上建过一条任务；他另在丙的项目 P5（不是项目成员）与别的企业的项目上建过任务
- **THEN** 返回 200；`tasks` 里只有 P6 上那一条，它的每一步 `checkReportJson` 都是 `null`

#### Scenario: 列表步骤投影的单测
- **WHEN** 运行 `npx tsx src/lib/agent-tasks/__tests__/dto.test.ts`
- **THEN** 退出码为 0；用例覆盖：不是平台管理员时步骤上的内部字段（输入、输出、检查报告）都为 `null`，其余键不变、不新增键；平台管理员原样

#### Scenario: 交给查询的字段（不连库）
- **WHEN** 运行 `npx tsx src/lib/agent-tasks/__tests__/recent-route-args.test.ts`，它截获最近任务接口交给任务查询的参数
- **THEN** 退出码为 0；任务、项目、步骤三层选出的字段集合恰好是本条列出的那些（不含原始报错、输入、输出、审批与创建人）；不是平台管理员时步骤 `checkReportJson` 为 `null`

### Requirement: 不是平台管理员的人拿不到检查报告里的内容
对上一条所说的调用者，`GET /api/agent/tasks/recent` 的响应正文 SHALL NOT 包含：
- 步骤检查报告里的任何文字，包括其中的原始报错与夹带的模型原始输出；
- 报价相关的单价、总价与利润率，包括报价审查写进检查报告的「利润率」问题；
- 调用者打不开的项目的名字、编号，以及那些项目上任务的意图与步骤摘要。

#### Scenario: 标记串不出现在响应里
- **WHEN** 只读成员调用 `GET /api/agent/tasks/recent?limit=20`；他建的任务里，一步的检查报告带原始报错标记串，另一步的检查报告带价格标记串与「利润率 7.5%，低于 10% 安全线」；他另在打不开的项目上建过任务
- **THEN** 响应正文里不出现原始报错标记串、价格标记串与「利润率」字样，也不出现那个打不开的项目的名字

### Requirement: 平台管理员照旧看到全部原文
平台管理员（平台 super_admin，不在岗位预览中）调用 `GET /api/agent/tasks/recent`，任务范围（自己建的全部任务）与每一步的内容（含检查报告原文）SHALL 与改动前一致；条数按「条数上限按可见任务计」一条。这个接口 SHALL NOT 修改任何任务或步骤；库里保存的检查报告 SHALL 不因调用者身份而改变。

#### Scenario: 平台管理员查看
- **WHEN** 平台 super_admin（不属于任务所在的组织）调用 `GET /api/agent/tasks/recent?limit=20`，他在已分发与未分发的项目上都建过任务，其中一步的检查报告带原始报错
- **THEN** 返回 200；这些任务都在结果里；那一步的 `checkReportJson` 与库里保存的一字不差

#### Scenario: 不是平台管理员的人看过之后，库里不变
- **WHEN** 只读成员调用 `GET /api/agent/tasks/recent` 之后，平台 super_admin 查询同一批任务与步骤的库内记录
- **THEN** 任务与步骤的每个字段都与调用前一致，检查报告仍是原文

### Requirement: 未登录返回 401
没有有效登录会话的请求调用 `GET /api/agent/tasks/recent`，系统 SHALL 返回 401，正文 `error` 为「未登录」，SHALL NOT 返回任何任务。账号状态不是 active 的用户带着此前签发的会话调用，SHALL 按未登录处理。

#### Scenario: 未登录与已停用账号
- **WHEN** 不带会话调用 `GET /api/agent/tasks/recent`；账号已停用、此前建过任务的用户带着旧会话调用同一接口
- **THEN** 两次都返回 401，正文没有 `tasks` 字段

### Requirement: AgentTask 接口目录的每个路由都登记在授权布线契约里
仓库 SHALL 有一个不依赖数据库的授权布线契约测试，覆盖 `src/app/api/agent/tasks/` 目录下（含子目录）的每一个路由文件（`route.ts` / `.tsx` / `.js` / `.jsx` / `.mjs`）。下面任一情况该测试 SHALL 失败（退出码非 0）并点名文件：目录里有没登记的路由文件；登记了不存在的文件；最近任务接口缺项目可读范围的筛选、按平台管理员区分的步骤投影或 `limit` 校验；最近任务接口的步骤字段选了原始报错、输入或输出，或认不出步骤字段。

#### Scenario: 当前目录全部登记
- **WHEN** 运行 `npx tsx src/app/api/agent/tasks/__tests__/authz-contract.test.ts`
- **THEN** 退出码为 0，输出列出该目录下 7 个路由文件都已登记，最近任务接口的登记通过

#### Scenario: 新加的路由没登记
- **WHEN** 在 `src/app/api/agent/tasks/` 下新加一个 `route.ts` 或 `route.js`、但没有加进登记表，再运行同一测试
- **THEN** 退出码非 0，输出点名这个新文件

#### Scenario: 登记了不存在的文件
- **WHEN** 登记表里的一个文件被删掉或改名，再运行同一测试
- **THEN** 退出码非 0，输出点名这个文件，测试不中途崩溃

#### Scenario: 最近任务接口选了原始报错
- **WHEN** 最近任务接口的步骤字段里加上原始报错，再运行同一测试
- **THEN** 退出码非 0，输出点名 `recent/route.ts`
