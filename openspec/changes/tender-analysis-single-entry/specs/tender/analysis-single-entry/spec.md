# Spec Delta

## Purpose

项目页招标分析的发起入口：哪几个按钮、谁看得到；一键分析与旧的自动分析两条流程在服务端互斥、被挡住时怎么回答；开了一键分析的组织上传后不自动发起；「AI 数字员工 · 投标分析」卡片在启动期间与启动失败时怎么显示，以及卡片按钮的样子。

## ADDED Requirements

### Requirement: 能用卡片发起的人只看到卡片上的发起按钮
「能用卡片发起」指组织开了一键分析，并且当前用户过了建作业时的用户级开关（角色按岗位派生）；项目写权限不在这个判定里。能用卡片发起的人在「招标要求」页签上，系统 SHALL NOT 显示分析面板的「重新分析当前投标文件包」与空态的「分析投标文件」，发起分析的按钮 SHALL 只有卡片上的「开始 AI 分析」或「重新分析」。旧按钮隐藏时，空态说明 SHALL 为「暂无分析记录。请在上方「AI 数字员工 · 投标分析」卡片上发起分析。」

#### Scenario: 能用卡片发起
- **WHEN** 卡片接口返回 `canStart` 为 `true`，项目已有一份待审分析
- **THEN** 面板不显示「重新分析当前投标文件包」；项目还没有分析记录时，面板不显示「分析投标文件」，空态说明为上面那句（`npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts`）

#### Scenario: 卡片接口还没返回
- **WHEN** 面板已加载完，卡片接口还没有返回
- **THEN** 两个旧按钮都不显示（同一测试）

### Requirement: 卡片接口失败时旧按钮照常显示
卡片接口返回非 2xx 或请求失败时，面板 SHALL 按「不能用卡片发起」处理，显示两个旧按钮。

#### Scenario: 接口失败
- **WHEN** 卡片接口返回 500
- **THEN** 面板显示「重新分析当前投标文件包」（有分析记录时）或「分析投标文件」（没有时）（`npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts`）

### Requirement: 过不了用户级开关的人看状态、用旧按钮
组织开了一键分析，但当前用户过不了用户级开关时，卡片 SHALL 照常显示最近一单的状态，SHALL NOT 显示「开始 AI 分析」或「重新分析」，SHALL 显示「你的账号还没开通 AI 数字员工分析，请用本页下方的分析按钮」；面板的两个旧按钮 SHALL 照常显示。卡片「取消」按钮的显示条件不变。

#### Scenario: 不在名单里的用户
- **WHEN** 组织开了一键分析，用户级开关的用户名单不含当前用户，项目最近一单已完成
- **THEN** 卡片接口 `canStart` 为 `false`；卡片显示「AI 分析完成，结果已生成」和上面那句说明，没有发起按钮；面板显示「重新分析当前投标文件包」（`single-entry.test.ts` 纯函数；`single-entry-db.isolated.test.ts` 读接口）

### Requirement: 没开一键分析的组织页面与自动入队不变
组织没开一键分析时：卡片 SHALL NOT 显示；面板的两个旧按钮 SHALL 在卡片接口返回（或失败）之后照常显示；自动开关开时，文件处理完 SHALL 照常入队一次旧管线分析；自动开关关时，上传 SHALL 照常逐文件入队；「重新分析当前投标文件包」与「分析投标文件」SHALL 照常新建旧管线记录。

#### Scenario: 开关关时旧入口照常
- **WHEN** 一键分析开关关，发起一键分析，再对一个新项目入队旧管线分析
- **THEN** 一键分析返回 `FEATURE_DISABLED`、卡片接口 `enabled` 为 `false`，旧管线入队 `enqueued` 为 `true`（`t1b-integration.test.ts` 的 T1B-14，隔离库执行）

#### Scenario: 两条自动路径照常
- **WHEN** 组织没开一键分析，自动开关开时文件处理完；另一个项目自动开关关时上传一份招标 PDF
- **THEN** 两次都新建了一条旧管线记录（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/tender-workforce/__tests__/single-entry-db.isolated.test.ts`）

### Requirement: 卡片接口返回能否发起、是否正在启动与文件提示
`GET /api/projects/:id/tender-analysis/agent` 的 `agent` SHALL 带三个字段：`canStart`（布尔，按上面的定义）、`starting`（布尔：本项目正有一单在发起、还没建完时为 `true`）、`packageHint`（`null`、`{"kind":"ready"}` 或 `{"kind":"not_yet_analyzed","count":N}`）。原有的 `enabled`、`job`、`latestAnalysisRun` SHALL 保持原样。

#### Scenario: 正在启动
- **WHEN** 另一个请求正在为本项目发起分析、还没建完（测试里用另一个事务拿住发起用的锁）
- **THEN** 卡片接口 `starting` 为 `true`；那个事务结束后变回 `false`（`single-entry-db.isolated.test.ts`）

#### Scenario: 名单里的用户
- **WHEN** 组织开了一键分析，当前用户在用户级开关的名单里
- **THEN** `canStart` 为 `true`（同一测试）

### Requirement: 卡片接口不输出开关与身份细节
卡片接口 SHALL NOT 返回用户级开关的名单内容、当前用户的岗位或派生角色、发起用的锁的键，也 SHALL NOT 返回别人发起时带的请求号。

#### Scenario: 响应里没有这些字段
- **WHEN** 读卡片接口的响应
- **THEN** 只有 `enabled`、`canStart`、`starting`、`packageHint`、`job`、`latestAnalysisRun` 六个键，没有名单、角色、锁键与请求号（`single-entry-db.isolated.test.ts`）

### Requirement: 一键分析发起时旧管线在跑就不新建
发起一键分析（开始或重新分析）时，如果本项目有一条旧管线记录处于 PENDING、EXTRACTING 或 ANALYZING，系统 SHALL NOT 新建作业，SHALL NOT 取消本项目已有的一键分析作业，SHALL NOT 改动那条旧管线记录，SHALL 返回 HTTP 409，正文为 `{"error":"这个项目已经有一单招标文件分析在进行，进度见本页顶部「招标文件分析」一栏；那一单结束后再点。","code":"ACTIVE_JOB_EXISTS"}`。

#### Scenario: 旧管线排队中点重新分析
- **WHEN** 项目有一条 PENDING 的旧管线记录，还有一张已完成的一键分析作业，用户在卡片上点「重新分析」
- **THEN** 返回 409 和上面的正文；作业数不变，已完成的作业仍是已完成，旧管线记录仍是 PENDING（`single-entry-db.isolated.test.ts`）

### Requirement: 一键分析发起时停掉旧管线失败后的自动重试
发起一键分析时，本项目旧管线里「已失败、尝试次数没到上限、定时任务还会重试」的记录 SHALL 先被标为已被替代，再新建作业；尝试次数已到上限的失败记录 SHALL NOT 被改动。如果标记时那条记录已被定时任务认领，系统 SHALL 按「旧管线在跑」返回 409。

#### Scenario: 失败待重试
- **WHEN** 项目有一条 FAILED、已尝试 2 次的旧管线记录，用户点「开始 AI 分析」
- **THEN** 发起成功；那条记录变成 SUPERSEDED，之后定时任务不再认领它（`single-entry-db.isolated.test.ts`）

#### Scenario: 重试已用完
- **WHEN** 那条 FAILED 记录已尝试 5 次
- **THEN** 发起成功，那条记录仍是 FAILED（同一测试）

### Requirement: 旧管线发起时一键分析在跑就不新建
发起旧管线分析时，如果本项目有一张招投标作业处于排队、规划、执行、校验、修复、等审批或等人处理，或者有一条「AI 数字员工分析中」的领域记录，系统 SHALL NOT 新建记录。旧管线的发起包括：重新分析当前投标文件包、分析投标文件、单条记录的重新分析接口、上传与文件处理完后的自动入队。手动入口 SHALL 返回 HTTP 409、码 `ACTIVE_RUN_EXISTS`，文案为「AI 数字员工正在分析这个项目（或在等人处理），进度见「AI 数字员工 · 投标分析」卡片；那一单结束后再发起。」自动入队 SHALL 以原因 `workforce_active` 结束。

#### Scenario: 一键分析排队中点旧按钮
- **WHEN** 项目有一张排队中的一键分析作业，调用 `POST …/tender-analysis/package`，`action` 分别为 `reanalyze` 与 `enqueue`
- **THEN** 两次都返回 409、`code` 为 `ACTIVE_RUN_EXISTS`、`error` 为上面那句；旧管线记录数不变（`single-entry-db.isolated.test.ts`）

#### Scenario: 等人处理也算
- **WHEN** 一键分析作业处于等人处理，调用单条记录的重新分析接口
- **THEN** 返回 409，文案同上，不新建记录（同一测试）

#### Scenario: 码表
- **WHEN** 把原因 `workforce_active` 规范化
- **THEN** 得到 `ACTIVE_RUN_EXISTS`、409 与上面那句（`npx tsx src/lib/tender-auto-analysis/__tests__/enqueue-outcome.test.ts`）

### Requirement: 两条入口同时发起至多一单
同一项目上，两条流程的发起 SHALL 串行判定：同时从两条入口发起，结束时两条流程处于进行中的记录合计 SHALL 恰好为一单，另一条入口 SHALL 得到上面对应的 409。

#### Scenario: 并发
- **WHEN** 对同一项目同时调用一键分析的「开始」和旧管线的「重新分析」，重复 10 轮（每轮先清场）
- **THEN** 每一轮结束时，进行中的一键分析作业与进行中的旧管线记录合计为 1（`single-entry-db.isolated.test.ts`）

### Requirement: 被挡住的回答不带对方记录
上面两种 409 与 `workforce_active` 的结果 SHALL NOT 带对方流程那一单的记录号或作业号、发起人、内部错误原文。

#### Scenario: 响应里没有对方的号
- **WHEN** 旧管线入口被一键分析作业挡住
- **THEN** 响应里没有那张作业的号，也没有 `runId`（`single-entry-db.isolated.test.ts`）

### Requirement: 开了一键分析的组织上传后不自动发起
组织开了一键分析时，上传逐文件入队与文件处理完后的自动入队 SHALL NOT 发起任何分析（两条流程都不发起），SHALL 以原因 `agent_card_manual` 结束；上传时 SHALL 照常写入文件的内容指纹。规范化后 SHALL 为 `AUTO_DISABLED`、HTTP 200、`ok` 为 `true`，文案为「已开通 AI 数字员工分析：上传后不自动分析，请在「AI 数字员工 · 投标分析」卡片上发起」。

#### Scenario: 处理完不自动发起
- **WHEN** 组织开了一键分析，自动开关开，项目文件全部处理完
- **THEN** 结果原因为 `agent_card_manual`，没有新建作业或旧管线记录（`single-entry-db.isolated.test.ts`；源码里没有固定请求号见 `npx tsx src/lib/tender-auto-analysis/__tests__/obs-p2p3-single-pipeline.test.ts`）

#### Scenario: 上传逐文件也不发起
- **WHEN** 组织开了一键分析，自动开关关，上传一份招标 PDF
- **THEN** 上传响应里的分析结果原因为 `agent_card_manual`，没有新建记录，这份文件的内容指纹已写入（`single-entry-db.isolated.test.ts`）

### Requirement: 卡片提示文件已就绪或有文件没纳入
能用卡片发起的人，在本项目没有一单在跑时：本项目从来没有一键分析作业、且文件包已就绪（没有文件还在处理）时，卡片 SHALL 显示「文件已就绪，点「开始 AI 分析」」；最近一次一键分析之后有 N 个能读的文件没纳入、且文件包已就绪时，卡片 SHALL 显示「有 N 个能读的文件还没纳入这次分析，重新分析后会一起纳入。」其它情况 SHALL NOT 显示文件提示。

#### Scenario: 刚传完文件
- **WHEN** 项目没有任何一键分析作业，文件都已处理完
- **THEN** `packageHint` 为 `{"kind":"ready"}`，卡片显示「文件已就绪，点「开始 AI 分析」」（`single-entry-db.isolated.test.ts` 读接口；`single-entry.test.ts` 纯函数）

#### Scenario: 分析之后又传了文件
- **WHEN** 最近一次一键分析已完成，之后又上传并处理完 2 个能读的文件
- **THEN** `packageHint` 为 `{"kind":"not_yet_analyzed","count":2}`，卡片显示「有 2 个能读的文件还没纳入这次分析，重新分析后会一起纳入。」（同两个测试）

### Requirement: 点下去到新任务出现之间显示「正在启动」
从用户点卡片的「开始 AI 分析」或「重新分析」，到卡片读到新作业为止，卡片的状态行 SHALL 为「正在启动…」，发起按钮 SHALL 为不可点的「正在启动…」，SHALL NOT 显示「上次 AI 分析已取消」。卡片接口 `starting` 为 `true` 时，卡片 SHALL 同样这样显示，并且像排队、分析中那样定时重新读取。

#### Scenario: 自己点的
- **WHEN** 最近一单已取消，用户点「重新分析」，请求还没返回
- **THEN** 状态行为「正在启动…」，按钮为不可点的「正在启动…」（`npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts`）

#### Scenario: 别人点的
- **WHEN** 卡片接口返回 `starting` 为 `true`，最近一单为已取消
- **THEN** 状态行为「正在启动…」，不是「上次 AI 分析已取消」（同一测试）

### Requirement: 旧单已取消而新单没建成时说清楚
用户点「重新分析」后，旧单已被取消、新作业没能建成时，卡片 SHALL 重新读取接口，状态行 SHALL 为「上一单已取消，新的分析没能启动」，下面 SHALL 显示接口返回的失败原因，按钮 SHALL 为可点的「重新分析」。没有这次失败的人看到的 SHALL 仍是「上次 AI 分析已取消」。

#### Scenario: 建单失败
- **WHEN** 最近一单为已取消，这次点「重新分析」得到 500「启动 AI 分析失败，请稍后重试」
- **THEN** 状态行为「上一单已取消，新的分析没能启动」，下面一行为「启动 AI 分析失败，请稍后重试」，按钮为「重新分析」（`single-entry.test.ts` 纯函数；卡片失败后重新读取见同一测试的源码断言）

#### Scenario: 被挡住而没有取消
- **WHEN** 最近一单已完成，这次点「重新分析」得到 409（旧管线在跑）
- **THEN** 状态行仍为「AI 分析完成，结果已生成」，下面一行为 409 的那句文案（同一测试）

### Requirement: 卡片按钮是正常按钮
卡片的「开始 AI 分析」「重新分析」「正在启动…」SHALL 是主题色底、对比色字、悬停加深的主按钮，与「招标要求」页签「向业主提问」同样的写法；「取消」SHALL 是有边框的次按钮。卡片里每个颜色类 SHALL 引用主题里已定义的颜色或 Tailwind 自带的色阶，SHALL NOT 引用 `primary`、`primary-foreground`、`muted-foreground`，SHALL NOT 用 `bg-muted` 作底色。

#### Scenario: 卡片的颜色类都有定义
- **WHEN** 枚举卡片源码里的颜色类，逐个对照 `src/app/globals.css` 的主题颜色
- **THEN** 每个都有定义；发起按钮的类与「向业主提问」一致（`npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts`）

### Requirement: 旧管线重新分析照旧替换未批准的结果
旧管线的重新分析新建记录成功后，本项目所有未批准的待审结果 SHALL 照旧标为已被替代，不分它来自哪条流程；已批准的结果 SHALL NOT 被改动。

#### Scenario: 一键分析的待审结果被替换
- **WHEN** 没有一单在跑，项目最新的是一份一键分析产生的待审结果，过不了用户级开关的人点「重新分析当前投标文件包」
- **THEN** 新建一条 PENDING 的旧管线记录，那份待审结果变成 SUPERSEDED（`single-entry-db.isolated.test.ts`）
