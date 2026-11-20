## Purpose

项目负责人自动拥有项目财务特权；本能力规定谁能更换项目负责人、谁能把自己设为负责人、新负责人要满足什么，使本身没有财务特权的人不能通过换负责人拿到它。

## ADDED Requirements

### Requirement: 谁能把负责人换成别人
把项目负责人换成另一个人时，系统 SHALL 只放行：平台超级管理员、当前负责人、本组织组织角色不低于 `org_admin` 的有效成员、在本组织持组织范围 `project.finance.manage` 的人。其他人（包括不是负责人的项目管理员）SHALL 得到 403 `只有当前负责人、组织管理员、有全企业「管理项目财务」权限的人或平台管理员能更换项目负责人。`（`code` 为 `OWNER_CHANGE_FORBIDDEN`）。新负责人与当前负责人相同的请求 SHALL 不算更换，照原来的规则处理。

#### Scenario: 换给别人
- **WHEN** 不是负责人的项目管理员、组织管理员、当前负责人、持组织范围 `project.finance.manage` 的成员、平台超级管理员分别把负责人换成本组织另一位在用成员
- **THEN** 项目管理员 403 `OWNER_CHANGE_FORBIDDEN`、负责人不变；其余四种成功（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`；`npx tsx src/lib/projects/__tests__/owner-change.test.ts`）

### Requirement: 不能把自己设为负责人
把自己设为项目负责人时，系统 SHALL 只放行平台超级管理员与在本组织持组织范围 `project.finance.manage` 的人；组织管理员、项目管理员等其他人 SHALL 得到 403 `不能把自己设为项目负责人：负责人能看本项目的全部财务数据。请让当前负责人、有全企业「管理项目财务」权限的人或平台管理员来指定。`（`code` 为 `OWNER_SELF_ASSIGN_FORBIDDEN`）。

#### Scenario: 换给自己
- **WHEN** 组织管理员、不是负责人的项目管理员、持组织范围 `project.finance.manage` 的成员、平台超级管理员分别把自己设为负责人
- **THEN** 组织管理员与项目管理员 403 `OWNER_SELF_ASSIGN_FORBIDDEN`、负责人不变；持财务键的成员与平台超级管理员成功（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`）

### Requirement: 新负责人的条件
新负责人 SHALL 是在用的用户；项目属于组织时，SHALL 还是该组织的有效成员。经 `PATCH /api/projects/{项目}` 或 `PATCH /api/projects/{项目}/members/{成员}` 更换时不满足 SHALL 返回 400 `新的负责人必须是本组织在用的成员。`（`code` 为 `OWNER_NOT_ORG_MEMBER`）；经 `POST /api/projects/{项目}/members` 加成员时照原来的规则返回。权限判定（前两条）SHALL 先于这条。

#### Scenario: 不合格的新负责人
- **WHEN** 组织管理员经 `PATCH /api/projects/{项目}` 把负责人换成已停用的用户、换成别的组织的成员；经成员接口把一位已离开本组织的项目成员设为负责人；不是负责人的项目管理员把负责人换成已停用的用户
- **THEN** 前三次 400 `OWNER_NOT_ORG_MEMBER`、负责人不变；最后一次是 403（权限先判）（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`）

### Requirement: 三个入口同一口径
`PATCH /api/projects/{项目}` 的 `ownerId`、`POST /api/projects/{项目}/members` 的 `duty: "owner"`、`PATCH /api/projects/{项目}/members/{成员}` 的 `duty: "owner"` SHALL 用同一个判定与同样的话。被拒时 SHALL NOT 写入同一请求里的任何字段（含名称、日期、成员角色），SHALL NOT 新增成员、写项目事件、写审计或同步日历。

#### Scenario: 被拒时整个请求不写
- **WHEN** 不是负责人的项目管理员经 `PATCH /api/projects/{项目}` 同时改名称与负责人；经成员接口加一位新成员并设为负责人；经成员接口把自己那一行改为主负责人
- **THEN** 三次都是 403；项目名称不变、没有新成员、他的成员角色与身份不变，没有新的审计行（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`；`npx tsx src/lib/projects/__tests__/owner-change.test.ts` 源码断言）

### Requirement: 换负责人的审计
经 `PATCH /api/projects/{项目}` 换了负责人时，审计的前后记录 SHALL 各带负责人；没有换负责人时审计内容 SHALL 与原来相同。经成员接口换负责人的审计照原来的规则（带前后负责人或身份）。

#### Scenario: 审计
- **WHEN** 组织管理员经 `PATCH /api/projects/{项目}` 把负责人交给另一位成员；另一次只改名称
- **THEN** 前一条审计的前后记录分别是原负责人与新负责人；后一条不含负责人（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`）

### Requirement: 成员页的「主负责人」选项
`GET /api/projects/{项目}/members` SHALL 返回调用人的 `ownerChange: { canChange, canSelfAssign }`，分别对应前两条要求的判定。项目详情成员表里，`canChange` 为 false 时「项目身份」下拉 SHALL NOT 提供「主负责人」；调用人自己那一行在 `canSelfAssign` 为 false 时 SHALL NOT 提供「主负责人」；当前负责人那一行照旧显示「主负责人」。

#### Scenario: 选项
- **WHEN** 不是负责人的项目管理员、组织管理员、持财务键的成员读取成员列表
- **THEN** 依次为 `canChange` false / `canSelfAssign` false、true / false、true / true；成员表按这两个标记决定给不给「主负责人」（`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`；`npx tsx src/lib/projects/__tests__/owner-change.test.ts` 源码断言）
