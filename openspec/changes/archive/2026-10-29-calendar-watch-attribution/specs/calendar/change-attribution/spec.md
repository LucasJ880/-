# Spec Delta

## Purpose

观察组织指定的 Google 共享日历的新增、修改与删除，把每条变更确定性地归因到青砚、成员本人、网站预约或不明，记入账本、通知相关的人，并按来源与成员统计期间内的日程数；全程只读 Google。

## ADDED Requirements

### Requirement: 观察配置的读取与授权
`GET` 与 `PUT /api/organizations/{orgId}/calendar-watch-settings` SHALL 要求调用者在该企业持 `sales.settings.manage`（平台 super_admin 视为持有），否则返回 403。`GET` SHALL 返回开关、读取账号、观察日历、网站识别规则、成员邮箱别名、通知岗位，以及每个日历的上次运行时间、阶段与上次错误；SHALL NOT 返回 Google 同步令牌或分页令牌。

#### Scenario: 无权限
- **WHEN** 只持 `sales_rep` 岗位的成员请求 `GET` 或 `PUT`
- **THEN** 返回 403，配置不变；隔离库测试 `calendar-watch-db.isolated.test.ts` 覆盖

#### Scenario: 老板读取
- **WHEN** 持 `owner` 岗位的成员请求 `GET`
- **THEN** 返回 200，响应中没有 `syncToken` 与 `pageToken` 字样

### Requirement: 保存配置时校验
`PUT` SHALL 校验：读取账号是该企业在职成员，合并后为开启时还须已连接 Google 日历，否则 400 `READER_NOT_CONNECTED`；开启时每个观察日历都在读取账号可见的日历列表中，否则 400 `CALENDAR_NOT_ACCESSIBLE`（关闭开关不查 Google，保证随时可停）；邮箱字段为合法邮箱、通知岗位为该企业存在的岗位键，否则 400 `INVALID_SETTINGS`。校验通过才写入，并写一条审计；系统维护的游标 SHALL NOT 被 `PUT` 覆盖。未配置过的组织 SHALL 视为关闭，通知岗位缺省为 `owner` 与 `ops_lead`。

#### Scenario: 读取账号看不到该日历
- **WHEN** `PUT` 的观察日历不在读取账号的 Google 日历列表里
- **THEN** 返回 400 `CALENDAR_NOT_ACCESSIBLE`，配置不变；`calendar-watch-db.isolated.test.ts` 覆盖

#### Scenario: 关闭不查 Google
- **WHEN** 读取账号的 Google 授权已失效，老板 `PUT { "enabled": false }`
- **THEN** 返回 200，观察停止，游标保留；`calendar-watch-db.isolated.test.ts` 覆盖

#### Scenario: 缺省值
- **WHEN** 读取从未配置过的组织
- **THEN** `enabled` 为 `false`，`notifyPositions` 为 `["owner","ops_lead"]`；`npx tsx src/lib/calendar-watch/__tests__/calendar-watch-pure.test.ts` 覆盖

### Requirement: 只读 Google
日历观察 SHALL 只调用 Google 日历的读取接口，SHALL NOT 新建、修改或删除任何 Google 日历事件，也 SHALL NOT 修改青砚的预约。

#### Scenario: 观察一轮后预约不变
- **WHEN** 观察一轮处理了新增、修改、删除各一条
- **THEN** 青砚预约表与 Google 写接口均未被调用或改动；`calendar-watch-db.isolated.test.ts` 以注入的读取函数验证写接口零调用

### Requirement: 增量读取与游标
每个开启组织的每个观察日历 SHALL 独立维护游标：已有同步令牌时只拉取上次之后的变化；没有令牌时做全量读取（不带时间过滤，按页续读，跨轮次保存分页位置），读完最后一页保存新令牌。Google 返回 410 时 SHALL 清除该日历的游标并在下一轮重做全量；读取账号授权失效时 SHALL 记录错误、当天最多通知读取账号一次，且不影响其它日历与组织。

#### Scenario: 令牌过期
- **WHEN** 拉取返回 410
- **THEN** 该日历游标被清空，阶段回到全量，下一轮从头读取；`calendar-watch-db.isolated.test.ts` 覆盖

#### Scenario: 授权失效
- **WHEN** 读取账号的 Google 授权已失效
- **THEN** 该日历 `lastError` 为 `token_expired`，读取账号收到一条"重新连接 Google 日历"通知，同一天重复运行不再发第二条

### Requirement: 在既有定时任务中运行
日历观察 SHALL 作为既有 `/api/cron/sales-actions` 定时任务中一个独立受跟踪的步骤运行（名称 `calendar-watch`），只处理开启的组织；一个组织或日历出错 SHALL NOT 阻止其它组织与日历；每轮每个日历最多读取固定页数，未读完的下一轮续读。

#### Scenario: 一个组织出错
- **WHEN** 两个开启组织中一个的读取抛错
- **THEN** 另一个组织照常处理，步骤结果列出出错组织；`calendar-watch-db.isolated.test.ts` 覆盖

### Requirement: 确定性归因
每条变更 SHALL 按以下顺序取首个命中的规则归因，规则编号写入账本：R1 事件 ID 等于本企业某预约的 Google 事件 ID → 青砚（成员为预约创建人）；R2 创建者邮箱（不区分大小写）属于配置的网站预约账号，或标题 / 描述包含任一网站标记 → 网站；R3 创建者邮箱等于在职成员的账号邮箱、其 Google 日历连接邮箱或配置的别名 → 成员；R4 其余 → 不明。删除事件缺少创建者等字段时 SHALL 沿用该事件上一条账本的值。SHALL NOT 调用任何模型。

#### Scenario: 规则顺序
- **WHEN** 一条事件既命中青砚预约、其创建者邮箱又是成员邮箱
- **THEN** 归因为青砚（R1）；`calendar-watch-pure.test.ts` 逐条覆盖 R1–R4 与优先级

#### Scenario: 网站账号同时是成员
- **WHEN** 网站预约用的 Google 账号同时是某成员的日历连接邮箱，并已配置为网站预约账号
- **THEN** 该账号建的日程归因为网站（R2），不算该成员；`calendar-watch-pure.test.ts` 覆盖

#### Scenario: 别名命中
- **WHEN** 销售用私人邮箱在 Google 建日程，该邮箱已配置为其别名
- **THEN** 归因为该成员（R3）

### Requirement: 成员分桶
归因到成员时 SHALL 按该成员在本企业的岗位派生角色分桶：管理层 → `management`，销售 → `sales`，运营 → `ops`，其余 → `other`；规则与 PERM-4c4 的岗位派生平台角色一致。

#### Scenario: 运营岗
- **WHEN** 只持 `ops_lead` 岗位的成员在 Google 建日程
- **THEN** 账本中该条 `bucket` 为 `ops`；`calendar-watch-pure.test.ts` 覆盖

### Requirement: 账本与幂等
每条观察到的变更 SHALL 写一条审计记录（动作 `calendar.watch.observed`），含变更类型（新建 / 修改 / 删除）、Google 创建与更新时间、创建者邮箱、开始结束时间、标题（截 120 字）、归因与命中规则；修改时含改了哪些字段的前后值。同一事件同一 Google 更新时间 SHALL 只记一次，重放或重复运行不新增记录。

#### Scenario: 重复运行
- **WHEN** 同一批变更被处理两次
- **THEN** 账本与通知条数不变；`calendar-watch-db.isolated.test.ts` 覆盖

### Requirement: 不留存描述与不外泄邮箱
账本 SHALL NOT 存储日程描述全文（描述只在归因时用于匹配网站标记）；统计接口在销售本人范围 SHALL NOT 返回任何创建者邮箱或他人姓名。

#### Scenario: 账本无描述
- **WHEN** 一条带描述的日程被记入账本
- **THEN** 账本记录中不含描述文字；`calendar-watch-pure.test.ts` 覆盖

### Requirement: 首次全量只建基线
没有游标时的全量读取 SHALL 只把 Google 创建时间不早于基线起点（缺省为组织当地 60 天前，可配置）的事件记为"新建"写入账本，SHALL NOT 为全量读取到的任何事件发送通知。

#### Scenario: 开启当天
- **WHEN** 首次开启观察，日历里已有 300 条历史日程
- **THEN** 零条通知；只有基线起点之后创建的日程进入账本；`calendar-watch-db.isolated.test.ts` 覆盖

### Requirement: 变更通知
增量读取到的新建、修改、删除 SHALL 给通知岗位的持有人与命中预约的负责人各发一条站内通知（同一变更同一收件人只发一次）；新建通知 SHALL NOT 发给归因到的创建者本人。修改通知 SHALL 写明标题或起止时间的前后值并写明"修改人未知"；两者都没变的修改（如只改描述、参会人）与既无标题又无时间的删除只记账本；此前没有账本的修改（基线前创建、重复日程的单次改动）按现值通知。源自青砚的新建、经青砚推送的修改与青砚解除同步造成的删除（上一条账本归因青砚且已无预约持有该事件）SHALL NOT 发通知；在 Google 侧对青砚预约的修改与删除照常通知。

#### Scenario: Google 侧改时间
- **WHEN** 有人在 Google 把一条量房从 14:00 改到 16:00
- **THEN** 老板与运营主管各收到一条通知，正文含"14:00 → 16:00"与"修改人未知"；`calendar-watch-db.isolated.test.ts` 覆盖

#### Scenario: 销售自己新建
- **WHEN** 归因为某销售本人的新建日程
- **THEN** 该销售不收到这条新建通知，老板与运营主管收到

#### Scenario: 基线前创建的日程被改
- **WHEN** 一条 90 天前建的安装日程在 Google 被改到 11/10 16:00
- **THEN** 记为修改，老板与运营主管收到"现为 11/10 16:00–17:00"与"修改人未知"的通知；`calendar-watch-db.isolated.test.ts` 覆盖

#### Scenario: 同一事件在两个观察日历
- **WHEN** 一条邀请同时出现在两个观察日历
- **THEN** 账本按日历各记一条，每位收件人只收一条通知，新建统计只计一次；`calendar-watch-db.isolated.test.ts` 覆盖

#### Scenario: 青砚推送不通知
- **WHEN** 青砚建的预约推到 Google 后被观察到，随后有人在 Google 侧把它删除
- **THEN** 推送观察不发通知，删除发通知；两条都记入账本；`calendar-watch-pure.test.ts` 覆盖

### Requirement: 统计接口
`GET /api/sales/calendar/attribution?from&to` SHALL 按 `sales.analytics.read` 授权，期间按组织当地日解释，参数校验与期间汇总相同（不合法 400 `INVALID_PERIOD`）。新建按 Google 创建时间、修改与删除按 Google 更新时间落在期间计；按成员的修改 / 删除数指该成员名下（归因为其创建）的日程被修改 / 删除的次数。全企业范围 SHALL 返回按来源的新建数、按成员计数与不明来源样例；本人范围 SHALL 只返回本人一行，不返回按来源计数与样例。

#### Scenario: 销售看本人
- **WHEN** 只持 `sales_rep` 的销售请求统计
- **THEN** `byActor` 只有本人一行，响应无 `bySource` 与 `unknownSamples`；`calendar-watch-db.isolated.test.ts` 覆盖

#### Scenario: 老板看全企业
- **WHEN** 老板请求 10 月统计，账本中 10 月新建 3 条成员、1 条网站、1 条不明
- **THEN** `bySource` 为成员 3、网站 1、不明 1、青砚 0，`unknownSamples` 含那条不明的创建者邮箱

### Requirement: 统计上限不静默
单次统计读取账本 SHALL 有行数上限（20,000 行）；命中上限时响应 SHALL 带 `truncated: true`，未命中为 `false`。

#### Scenario: 未命中上限
- **WHEN** 老板请求 10 月统计，账本远少于上限
- **THEN** 响应 `truncated` 为 `false`；`calendar-watch-pure.test.ts` 覆盖截断标记透传
