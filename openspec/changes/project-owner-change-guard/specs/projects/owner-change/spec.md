## Purpose

项目负责人自动拥有项目财务特权；本能力规定谁能更换项目负责人、谁能把自己设为负责人、新负责人要满足什么，使本身没有财务特权的人不能通过换负责人拿到它。

## ADDED Requirements

### Requirement: 谁能把负责人换成别人
把现有项目的负责人换成另一个人时，系统 SHALL 只放行：平台超级管理员、在项目组织持组织范围 `project.finance.manage` 的人、当前负责人，以及管理者（组织项目是本组织 `org_admin` 以上的有效成员；执行项目接口是它原来就要求的能管理执行项目的人）。个人项目没有管理者。其他人 SHALL 得到 403 `{ error, code }`，`code` 为 `OWNER_CHANGE_FORBIDDEN`，`error` 为 `只有项目负责人、组织管理员、持「管理项目财务」权限的人或平台管理员能更换项目负责人。`（个人项目为 `这是个人项目，只有项目负责人或平台管理员能更换负责人。`）。新负责人与当前负责人相同的请求 SHALL 不算更换。

#### Scenario: 换给别人
- **WHEN** 不是负责人的项目管理员、组织管理员、当前负责人、持组织范围 `project.finance.manage` 的项目管理员、平台超级管理员分别把负责人换成本组织另一位在用成员
- **THEN** 不是负责人的项目管理员 403 `OWNER_CHANGE_FORBIDDEN`、负责人不变；其余四种成功（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`；`npx tsx src/lib/projects/__tests__/owner-change.test.ts`）

### Requirement: 不能把自己设为负责人
把自己设为现有项目的负责人时，系统 SHALL 只放行平台超级管理员与在项目组织持组织范围 `project.finance.manage` 的人。其他人（含组织管理员、项目管理员、能管理执行项目的人）SHALL 得到 403，`code` 为 `OWNER_SELF_ASSIGN_FORBIDDEN`，`error` 为 `不能把自己设为负责人：需要「管理项目财务」权限。可以请项目负责人或组织管理员把负责人交给你。`（个人项目为 `不能把自己设为负责人：请项目负责人把负责人交给你。`）。

#### Scenario: 换给自己
- **WHEN** 组织管理员、不是负责人的项目管理员、持组织范围 `project.finance.manage` 的项目管理员、平台超级管理员分别把自己设为负责人；组织管理员经执行项目接口把自己设为执行项目的负责人
- **THEN** 组织管理员与项目管理员 403 `OWNER_SELF_ASSIGN_FORBIDDEN`、负责人不变；持财务键的项目管理员与（是本组织成员的）平台超级管理员成功，不是本组织成员的平台超级管理员通过权限判定后按「新负责人的条件」400（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`）

### Requirement: 新负责人的条件
新负责人（含把自己设为负责人的人）SHALL 是在用的用户；项目属于组织时，SHALL 还是该组织的有效成员。经 `PATCH /api/projects/{项目}`、`PATCH /api/projects/{项目}/members/{成员}`、`PATCH /api/ops/projects/{项目}` 更换时不满足 SHALL 返回 400，`code` 为 `OWNER_INVALID`，`error` 为 `新的负责人必须是本组织在用的成员。`（个人项目为 `新的负责人必须是在用的用户。`）；经 `POST /api/projects/{项目}/members` 加成员时照原来的检查与说法返回。权限判定（前两条）SHALL 先于这条。

#### Scenario: 不合格的新负责人
- **WHEN** 组织管理员经 `PATCH /api/projects/{项目}` 把负责人换成已停用的用户、换成别的组织的成员；经成员接口把一位已离开本组织的项目成员设为负责人；不是负责人的项目管理员把负责人换成已停用的用户
- **THEN** 前三次 400 `OWNER_INVALID`、负责人不变；最后一次是 403（权限先判）（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`）

### Requirement: 同时更换负责人
写入新负责人时，系统 SHALL 只在负责人仍是本次请求读到的那个人时写入；否则 SHALL 返回 409，`code` 为 `OWNER_CONFLICT`，`error` 为 `负责人刚被别人改过，请刷新后看清现在的负责人再操作。`，整个请求不写。

#### Scenario: 负责人已被改过
- **WHEN** 按读到的旧负责人写入时，库里的负责人已经是另一个人
- **THEN** 写入失败、负责人仍是另一个人；四个入口遇到这种情况都返回 409 `OWNER_CONFLICT`（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`；`npx tsx src/lib/projects/__tests__/owner-change.test.ts` 源码断言）

### Requirement: 四个入口同一口径
`PATCH /api/projects/{项目}` 的 `ownerId`、`POST /api/projects/{项目}/members` 的 `duty: "owner"`、`PATCH /api/projects/{项目}/members/{成员}` 的 `duty: "owner"`、`PATCH /api/ops/projects/{项目}` 的 `ownerId` SHALL 用同一个判定与同样的话（执行项目接口原来的「能管理执行项目」门槛不变）。被拒时 SHALL NOT 写入同一请求里的任何字段（含名称、日期、成员角色），SHALL NOT 新增成员、写项目事件、写审计或同步日历。

#### Scenario: 被拒时整个请求不写
- **WHEN** 不是负责人的项目管理员经 `PATCH /api/projects/{项目}` 同时改名称与负责人；经成员接口加一位新成员并设为负责人；经成员接口把自己那一行改为主负责人；组织管理员经执行项目接口同时改名称并把自己设为负责人
- **THEN** 四次都是 403；项目名称不变、没有新成员、他的成员角色与身份不变，没有新的审计行（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`；`npx tsx src/lib/projects/__tests__/owner-change.test.ts` 源码断言）

### Requirement: 换负责人的审计
经 `PATCH /api/projects/{项目}` 换了负责人时，审计的前后记录 SHALL 各带负责人；没有换负责人时审计内容 SHALL 与原来相同。经 `PATCH /api/ops/projects/{项目}` 换了负责人时 SHALL 写一条审计，前后记录各带负责人。经成员接口换负责人的审计照原来的规则。

#### Scenario: 审计
- **WHEN** 组织管理员经 `PATCH /api/projects/{项目}` 把负责人交给另一位成员；另一次只改名称；组织管理员经执行项目接口把执行项目的负责人交给另一位成员
- **THEN** 第一条与第三条审计的前后记录分别是原负责人与新负责人；第二条不含负责人（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`）

### Requirement: 成员接口的两个标记
`GET /api/projects/{项目}/members` SHALL 返回调用人的 `ownerChange: { canChange, canSelfAssign }`：调用人能修改本项目时，分别等于「谁能把负责人换成别人」与「不能把自己设为负责人」两条的判定；不能修改本项目的人两项 SHALL 都是 false；调用人就是负责人时 `canSelfAssign` SHALL 为 false。

#### Scenario: 标记
- **WHEN** 不是负责人的项目管理员、组织管理员、持财务键的项目管理员、只读成员读取成员列表
- **THEN** 依次为 `canChange` false / `canSelfAssign` false、true / false、true / true、false / false（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`）

### Requirement: 项目团队卡片的「主负责人」与说明
项目团队卡片里，每行的「项目身份」下拉在 `canChange` 为 false 时 SHALL NOT 提供「主负责人」，调用人自己那一行还 SHALL 要 `canSelfAssign`；当前负责人那一行 SHALL 照旧显示「主负责人」。「添加成员」的身份下拉 SHALL 同样处理（选的人是自己时看 `canSelfAssign`），不能给时显示并提交「参与者」。能修改本项目、`canChange` 为 false 时卡片 SHALL 写 `只有项目负责人、组织管理员、持「管理项目财务」权限的人或平台管理员能更换负责人。`；能换给别人、不能换给自己且自己不是负责人时 SHALL 写 `把自己设为负责人需要「管理项目财务」权限；可以请项目负责人或组织管理员把负责人交给你。`（个人项目两句见 design D6）。

#### Scenario: 卡片
- **WHEN** 读取卡片源码与说明文字
- **THEN** 两个下拉按两个标记给「主负责人」、当前负责人那一行照旧、不能给时用「参与者」、两句说明逐字（`npx tsx src/lib/projects/__tests__/owner-change.test.ts`）
