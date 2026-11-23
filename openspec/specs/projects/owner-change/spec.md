# projects/owner-change Specification

## Purpose
项目负责人自动拥有项目财务特权；本能力规定谁能更换项目负责人、谁能把自己设为负责人、新负责人要满足什么，使本身没有财务特权的人不能通过换负责人拿到它。

## Requirements

### Requirement: 谁能把负责人换成别人
把现有项目的负责人换成另一个人时，系统 SHALL 只放行：平台超级管理员、在项目组织持组织范围 `project.finance.manage` 的人、当前负责人，以及管理者（组织项目是本组织 `org_admin` 以上的有效成员；执行项目接口是它原来就要求的能管理执行项目的人）。个人项目没有管理者。其他人 SHALL 得到 403 `{ error, code }`，`code` 为 `OWNER_CHANGE_FORBIDDEN`，`error` 为 `只有项目负责人、组织管理员、持「管理项目财务」权限的人或平台管理员能更换项目负责人。请找现在的主负责人或组织管理员。`（个人项目为 `这是个人项目，只有项目负责人或平台管理员能更换负责人。`）。新负责人与当前负责人相同的请求 SHALL 不算更换。

#### Scenario: 换给别人
- **WHEN** 不是负责人的项目管理员、组织管理员、当前负责人、持组织范围 `project.finance.manage` 的项目管理员、平台超级管理员分别把负责人换成本组织另一位在用成员
- **THEN** 不是负责人的项目管理员 403 `OWNER_CHANGE_FORBIDDEN`、负责人不变；其余四种成功（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`；`npx tsx src/lib/projects/__tests__/owner-change.test.ts`）

#### Scenario: 执行项目接口上不是组织管理员的管理者
- **WHEN** 运营主管（岗位含「管理执行项目」、组织角色是普通成员）经 `PATCH /api/ops/projects/{项目}` 同时改名并把自己设为负责人、把负责人换成已停用的用户、交给本组织另一位在用成员
- **THEN** 依次 403 `OWNER_SELF_ASSIGN_FORBIDDEN`（名称与负责人都不变、没有新审计）、400 `OWNER_INVALID`、成功并写审计（前后负责人）（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`）

### Requirement: 不能把自己设为负责人
把自己设为现有项目的负责人时，系统 SHALL 只放行平台超级管理员与在项目组织持组织范围 `project.finance.manage` 的人。其他人（含组织管理员、项目管理员、能管理执行项目的人）SHALL 得到 403，`code` 为 `OWNER_SELF_ASSIGN_FORBIDDEN`，`error` 为 `你不能把自己设为主负责人（需要「管理项目财务」权限），可以请现在的主负责人或另一位组织管理员交给你。`（个人项目为 `不能把自己设为负责人：请项目负责人把负责人交给你。`）。

#### Scenario: 换给自己
- **WHEN** 组织管理员、不是负责人的项目管理员、持组织范围 `project.finance.manage` 的项目管理员、平台超级管理员分别把自己设为负责人；组织管理员经执行项目接口把自己设为执行项目的负责人
- **THEN** 组织管理员与项目管理员 403 `OWNER_SELF_ASSIGN_FORBIDDEN`、负责人不变；持财务键的项目管理员与（是本组织成员的）平台超级管理员成功，不是本组织成员的平台超级管理员通过权限判定后按「新负责人的条件」400（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`）

### Requirement: 新负责人的条件
新负责人（含把自己设为负责人的人）SHALL 是在用的用户；项目属于组织时，SHALL 还是该组织的有效成员。经 `PATCH /api/projects/{项目}`、`PATCH /api/projects/{项目}/members/{成员}`、`PATCH /api/ops/projects/{项目}` 更换时不满足 SHALL 返回 400，`code` 为 `OWNER_INVALID`，`error` 为 `新负责人必须是本组织的有效成员（账号没停用、没离开组织），请换一位。`（个人项目为 `新负责人的账号已停用，请换一位。`）；经 `POST /api/projects/{项目}/members` 加成员时照原来的检查与说法返回。权限判定（前两条）SHALL 先于这条。

#### Scenario: 不合格的新负责人
- **WHEN** 组织管理员经 `PATCH /api/projects/{项目}` 把负责人换成已停用的用户、换成别的组织的成员；经成员接口把一位已离开本组织的项目成员设为负责人；不是负责人的项目管理员把负责人换成已停用的用户
- **THEN** 前三次 400 `OWNER_INVALID`、负责人不变；最后一次是 403（权限先判）（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`）

### Requirement: 同时更换负责人
写入新负责人时，系统 SHALL 只在负责人仍是本次请求读到的那个人时写入；否则 SHALL 返回 409，`code` 为 `OWNER_CONFLICT`，`error` 为 `负责人刚被别人换过了，请刷新页面，看清现在的负责人再操作。`，整个请求不写。

#### Scenario: 负责人已被改过
- **WHEN** 组织管理员经 `PATCH /api/projects/{项目}` 同时改名称并换负责人、经 `PATCH /api/projects/{项目}/members/{成员}` 把一位成员设为主负责人，两次都在权限判定之后、写入之前负责人被换成另一个人（测试里在开事务前改库）；另按读到的旧负责人直接调用带条件写入
- **THEN** 两个路由都返回 409 `OWNER_CONFLICT`，负责人仍是另一个人；`PATCH /api/projects/{项目}` 的名称没写，成员接口那一行的角色不变、没有新审计；直接写入也失败；另两个入口用同一写入并同样返回 409（源码断言）（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`；`npx tsx src/lib/projects/__tests__/owner-change.test.ts` 源码断言）

### Requirement: 四个入口同一口径
`PATCH /api/projects/{项目}` 的 `ownerId`、`POST /api/projects/{项目}/members` 的 `duty: "owner"`、`PATCH /api/projects/{项目}/members/{成员}` 的 `duty: "owner"`、`PATCH /api/ops/projects/{项目}` 的 `ownerId` SHALL 用同一个判定与同样的话。执行项目接口原来的门槛不变：不能管理执行项目的人 SHALL 照旧得到 403 `{ error: "无权重新分配负责人", code: "FORBIDDEN" }`，这个接口 SHALL NOT 返回 `OWNER_CHANGE_FORBIDDEN`。被拒时 SHALL NOT 写入同一请求里的任何字段（含名称、日期、成员角色），SHALL NOT 新增成员、写项目事件、写审计或同步日历。

#### Scenario: 被拒时整个请求不写
- **WHEN** 不是负责人的项目管理员经 `PATCH /api/projects/{项目}` 同时改名称与负责人；经成员接口加一位新成员并设为负责人；经成员接口把自己那一行改为主负责人；组织管理员经执行项目接口同时改名称并把自己设为负责人
- **THEN** 四次都是 403；项目名称不变、没有新成员、他的成员角色与身份不变，没有新的审计行（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`；`npx tsx src/lib/projects/__tests__/owner-change.test.ts` 源码断言）

### Requirement: 换负责人的审计
经 `PATCH /api/projects/{项目}` 换了负责人时，审计的前后记录 SHALL 各带负责人；没有换负责人时审计内容 SHALL 与原来相同。经 `PATCH /api/ops/projects/{项目}` 换了负责人时 SHALL 写一条审计，前后记录各带负责人。经 `POST /api/projects/{项目}/members` 加成员并换了负责人时，审计 SHALL 在原来的内容上加前后负责人；经 `PATCH /api/projects/{项目}/members/{成员}` 的审计照原来的规则（已带前后负责人）。

#### Scenario: 审计
- **WHEN** 组织管理员经 `PATCH /api/projects/{项目}` 把负责人交给另一位成员；另一次只改名称；经加成员接口加一位成员并设为负责人；经执行项目接口把执行项目的负责人交给另一位成员
- **THEN** 第一、三、四条审计的前后记录分别是原负责人与新负责人；第二条不含负责人；被拒的请求都没有新审计行（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`）

### Requirement: 成员接口的两个标记
`GET /api/projects/{项目}/members` SHALL 返回调用人的 `ownerChange: { canChange, canSelfAssign }`：调用人能修改本项目（与项目详情接口的 `canManage` 同一口径）时，分别等于「谁能把负责人换成别人」与「不能把自己设为负责人」两条的判定；不能修改本项目的人两项 SHALL 都是 false，且不为此查询授权；调用人就是负责人时 `canSelfAssign` SHALL 为 false。

#### Scenario: 标记
- **WHEN** 不是负责人的项目管理员、组织管理员、持财务键的项目管理员、只读成员、持财务键但在项目里只是只读成员的人读取成员列表
- **THEN** 依次为 `canChange` false / `canSelfAssign` false、true / false、true / true、false / false、false / false（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`）

### Requirement: 项目团队卡片的「主负责人」选项
项目团队卡片里，每行的「项目身份」下拉在 `canChange` 为 false 时 SHALL NOT 提供「主负责人」，调用人自己那一行还 SHALL 要 `canSelfAssign`，项目属于组织时已离开组织的成员那一行 SHALL NOT 提供；当前负责人那一行 SHALL 照旧显示「主负责人」。「添加成员」的身份下拉 SHALL 同样处理（选的人是自己时看 `canSelfAssign`）；选了「主负责人」后又选了不能给的人，身份 SHALL 改回「参与者」。换主负责人前 SHALL 先确认 `把主负责人换成「{姓名}」？`，调用人是现在的负责人时再加 `换完后你不能自己改回来，要请新的主负责人或组织管理员交还。`；收到 409 SHALL 刷新卡片。判断「调用人是不是负责人」SHALL 看项目的负责人，不看成员行。

#### Scenario: 选项与确认
- **WHEN** 读取卡片源码与确认文字
- **THEN** 两个下拉按两个标记与组织成员关系给「主负责人」、当前负责人那一行照旧、选了不能给的人改回「参与者」、换前确认逐字、409 刷新、负责人看项目本身（`npx tsx src/lib/projects/__tests__/owner-change.test.ts`）

### Requirement: 项目团队卡片的说明
项目属于组织、调用人能修改本项目时：`canChange` 为 false SHALL 写 `你不能更换主负责人。需要更换，请找现在的主负责人或组织管理员。`；`canChange` 为 true、`canSelfAssign` 为 false 且调用人不是负责人时 SHALL 写 `你不能把自己设为主负责人（需要「管理项目财务」权限），可以请现在的主负责人或另一位组织管理员交给你。`；其余情况与个人项目 SHALL NOT 写说明（个人项目能修改的只有负责人与平台超级管理员）。

#### Scenario: 说明
- **WHEN** 分别按不能换、能换不能给自己、负责人本人、有财务特权、不能修改本项目、个人项目计算说明
- **THEN** 依次是第一句、第二句、不写、不写、不写、不写（`npx tsx src/lib/projects/__tests__/owner-change.test.ts`）
