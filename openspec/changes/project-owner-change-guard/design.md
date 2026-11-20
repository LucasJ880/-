# Design：限制谁能更换项目负责人

## Context

- 项目负责人（`Project.ownerId`）在 `src/lib/project-finance/access.ts` 的 `decideFinancePrivilege` 里直接构成财务特权（`privileged = 平台超级管理员 || 组织范围 project.finance.manage || 是负责人`）。主规格 `projects/finance-access` 写明组织管理员本身 SHALL NOT 构成财务特权；组织范围的财务键只能由平台超级管理员在岗位绑定界面绑（`src/app/api/organizations/[orgId]/positions/route.ts`，`requirePlatformSuperAdmin`）。
- 今天能换现有项目负责人的入口有四个：
  1. `PATCH /api/projects/[id]`（`requireProjectWriteAccess`：平台超级管理员、负责人、本组织 `org_admin`、项目 `project_admin`）：`body.ownerId` 直接写进去，不校验目标；审计前后只有名称、描述、颜色、状态。
  2. `POST /api/projects/[id]/members`（同上）：加成员时 `duty: "owner"` 顺带设为负责人；目标须是在用用户且（有组织时）是本组织有效成员。没在项目里的组织管理员可以把自己加进来并设为负责人。
  3. `PATCH /api/projects/[id]/members/[memberId]`（同上）：`duty: "owner"`；`isSelfPromotion` 只拦「角色」路径，项目管理员可以把自己那一行改成主负责人。
  4. `PATCH /api/ops/projects/[id]`：执行项目的 `ownerId`，要求 `canManageDeliveryProjects`（平台 / 组织管理者——含 `org_owner` / `org_admin`、`operations.projects.manage`、`operations.manage`，`src/lib/operations/projects/access.ts`），只校验用户存在，不写审计。组织管理员可以把自己设为任何执行项目的负责人。
- 界面：项目详情「工作台」页签的「项目团队」卡片（`src/components/project-detail/tabs/workbench-tab.tsx`）：`canManage` 的人有「添加成员」表单（含身份下拉）和每行的「项目身份」下拉；成员数据由 `src/app/(main)/projects/[id]/page.tsx` 取 `GET /api/projects/[id]/members` 后传入。
- 新建执行项目的入口：中标后转执行（`src/lib/projects/handoff/execute.ts`），操作人选新项目的负责人（可以选自己）。

## Goals / Non-Goals

**Goals**：本身没有财务特权的人，不能通过换负责人拿到财务特权；四个入口同一个判定、同样的话；界面不给不能用的选项，并写明原因。

**Non-Goals**：
- `src/lib/project-finance/access.ts`（负责人仍有财务特权）、`src/lib/projects/access.ts`、`src/lib/operations/projects/access.ts` 的既有判定。
- `src/lib/projects/handoff/execute.ts`、`src/app/api/admin/project-intake/[id]/dispatch/route.ts`、`src/app/api/projects/route.ts`、`src/app/api/organizations/[orgId]/projects/route.ts`。
- `src/lib/projects/duty.ts`、`src/lib/projects/members-utils.ts` 的既有规则（「唯一项目管理员不能降级」「先指定新负责人」等照旧）。
- 岗位绑定、权限键定义（`src/lib/authorization/**`）。

## Decisions

### D1：谁能把负责人换成别人

允许：平台超级管理员；有财务特权的人（D2 的口径）；当前负责人（交给别人）；**管理者**——组织项目是本组织 `org_admin` 以上的有效成员，执行项目接口是它原来就要求的「能管理执行项目」的人（这个接口的既有门槛不变：不是管理者的人照旧 403 `无权重新分配负责人`）。个人项目（没有组织）没有管理者；而且个人项目的既有写权限只给负责人与平台超级管理员，项目管理员连修改都不能（既有 403 `无权修改该项目`），所以个人项目那两句 403 只有在纯函数里出现，隔离库只测个人项目的 400 与负责人交接。其他人 → 403 `只有项目负责人、组织管理员、持「管理项目财务」权限的人或平台管理员能更换项目负责人。`；个人项目写 `这是个人项目，只有项目负责人或平台管理员能更换负责人。`（`code: OWNER_CHANGE_FORBIDDEN`）。

理由：当前负责人本来就有财务特权，交给别人不扩大特权的范围；管理者派活、交接是正常工作（交给别人不让他自己拿到特权）；有财务特权的人本来就有。

- 备选 A：只有平台超级管理员与有财务特权的人能换。否决：组织管理员日常要把项目派给员工，负责人交接也要找平台管理员，流程走不通。
- 备选 B：照旧（能修改本项目的人都能换），只禁「换成自己」。否决：项目管理员可以把负责人换成同伙，同伙再换回来，等于没有限制。

### D2：谁能把自己设为负责人

只有有财务特权的人：平台超级管理员，或在项目组织持组织范围 `project.finance.manage` 的人。用 `resolveFinancePrivilege(user, orgId, null).privileged` 判断——`ownerId` 传 `null` 时它只剩「平台超级管理员 || 组织范围 `project.finance.manage`」，与项目财务接口同一口径，不改 `project-finance/access.ts`。个人项目只有平台超级管理员。其他人 → 403 `不能把自己设为负责人：需要「管理项目财务」权限。可以请项目负责人或组织管理员把负责人交给你。`；个人项目写 `不能把自己设为负责人：请项目负责人把负责人交给你。`（`code: OWNER_SELF_ASSIGN_FORBIDDEN`）。当前负责人「把自己设为负责人」是没有变化的请求，照旧通过。

- 备选：组织管理员也能把自己设为负责人。否决：主规格 `projects/finance-access` 写明组织管理员本身不构成财务特权；允许它就等于组织管理员随时能拿到任何项目的财务特权。

### D3：新负责人的条件

必须是在用的用户；项目属于组织时还必须是该组织的有效成员。不满足 → 400 `新的负责人必须是本组织在用的成员。`；个人项目写 `新的负责人必须是在用的用户。`（`code: OWNER_INVALID`）。这条对平台超级管理员把自己设为负责人同样适用（他不是本组织成员时 400）。适用于第 1、3、4 个入口；第 2 个入口原来就有这两条检查（404 `用户不存在或已停用`、403 `该用户须先加入所属组织后，才能加入项目`），沿用原来的话，只先判权限。

- 备选：第 1 个入口也要求新负责人先是项目成员。否决：项目成员关系由成员接口管理，`PATCH` 原来不要求；本 change 只管财务特权的扩散。

### D4：同一个判定、整个请求失败、先权限后目标

新增 `src/lib/projects/owner-change.ts`（纯函数 `decideOwnerChange`、`checkNewOwner`、`ownerChangeFlags`、`ownerChangeHint` 与固定文字，不依赖 db，页面也用）与 `src/lib/projects/owner-change-access.ts`（服务端：取调用人身份、查新负责人、带条件写入、`guardOwnerChange` 把两步串起来）。四个入口在写库之前调用；新负责人与当前相同即通过。被拒时**整个请求**返回错误、不写任何字段，不新增成员、不写项目事件、审计与日历。先判权限（403）再判目标（400），四个入口口径一致。响应体都是 `{ error, code }`。

- 备选：`PATCH` 里只丢掉 `ownerId`、其它字段照写。否决：用户看到「保存成功」却没换成负责人，容易误以为已经换了。

### D5：同时更换

写入负责人用 `updateMany({ where: { id, ownerId: 读到的负责人 }, data: { ownerId: 新负责人 } })`，在原来的事务里、其它字段之前；影响行数不是 1（同事刚换过）就回滚整个事务，返回 409 `负责人刚被别人改过，请刷新后看清现在的负责人再操作。`（`code: OWNER_CONFLICT`）。

- 备选：事务里 `SELECT … FOR UPDATE` 再比对。否决：要写原生 SQL；带条件的 `updateMany` 在 Postgres 里同样会等对方提交后重新判断条件，效果相同、改动更小。

### D6：审计与项目团队卡片

- `PATCH /api/projects/[id]`：负责人有变化时，审计 `beforeData` / `afterData` 各多一个 `ownerId`；账本事件的 `changedFields` 照旧带 `ownerId`。`PATCH /api/ops/projects/[id]`：换了负责人时新写一条审计（`update` / `project`，前后 `ownerId`）。成员接口原来的审计不变。
- `GET /api/projects/[id]/members` 多返回 `ownerChange: { canChange, canSelfAssign }`：在调用人能修改本项目（与写权限同一口径）时分别等于 D1「换给别人」与 D2「换给自己」的判定；不能修改本项目的人两项都是 false（他们本来就看不到下拉）。调用人就是负责人时 `canSelfAssign` 为 false（没有可换的）。
- 卡片：每行「项目身份」下拉在 `canChange` 为 false 时没有「主负责人」，自己那一行还要 `canSelfAssign`；当前负责人那一行照旧有「主负责人」（它是当前值）。「添加成员」的身份下拉同样处理（选的人是自己时按 `canSelfAssign`）；选了「主负责人」后又换成不能给的人，下拉显示并提交「参与者」。能修改本项目、但 `canChange` 为 false 时卡片写 `只有项目负责人、组织管理员、持「管理项目财务」权限的人或平台管理员能更换负责人。`；能换给别人、不能换给自己、自己又不是负责人时写 `把自己设为负责人需要「管理项目财务」权限；可以请项目负责人或组织管理员把负责人交给你。`（个人项目各有一句）。

- 备选：界面不改，靠接口报错。否决：人选了才被拒，体验差；看到选项会以为自己有这个权限。

## 与八条硬纪律的关系

1. 零 schema：遵守（不改 `prisma/`；审计写既有 `AuditLog`）。
2. 出站先审批：不涉及（没有对外发送）。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及新的输出；被拒时的话不含财务数据。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守（纯判定，零模型调用）。
8. 测试注册：新增两个测试，同时登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- 纯函数：`npx tsx src/lib/projects/__tests__/owner-change.test.ts`——`decideOwnerChange` 各身份 × 换给别人 / 换给自己 / 不变 × 有组织 / 个人项目；`checkNewOwner`；`ownerChangeFlags`、`ownerChangeHint`；文字逐字；四个入口与卡片的源码断言（写库前调用判定、带条件写入、被拒提前返回、409、审计）。
- 隔离库：`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`——身份：平台超级管理员、负责人、组织管理员、不是负责人的项目管理员、持组织范围 `project.finance.manage` 且是项目管理员的成员；四个入口；被拒时名称等字段、成员、审计都不变；新负责人不合格 400；带条件写入在负责人已变时冲突；审计；成员接口的两个标记；个人项目。
- 既有不改期望：成员、执行项目相关的既有测试原样通过。
- 门禁：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate project-owner-change-guard --strict`；全量 `npm test` 由会话统一跑。

## Risks / Trade-offs

- **GATE：谁能更换负责人**。本 change 按 D1 / D2 取「平台超级管理员、有财务特权的人、当前负责人、管理者（只能交给别人）」；要更严（例如组织管理员也不能换）或更松（例如项目管理员在本组织内可以交接），改 `decideOwnerChange` 一处与测试。
- 管理者仍可以把负责人交给同伙，同伙因此拿到财务特权；两位组织管理员也可以互相指定对方为负责人。组织管理员本来就在信任范围内；要堵上只能只让有财务特权的人换（D1 备选 A），流程代价大。
- **GATE：中标后转执行**（`src/lib/projects/handoff/execute.ts`）：操作人可以把自己选为新执行项目的负责人，从而有那个新项目的财务特权。本次不改（新建项目、只带中标金额），要不要同样限制由 GATE 定。
- 执行项目接口：能管理执行项目但不是组织管理员的人（`operations.projects.manage`、`operations.manage`）照旧可以把负责人交给别人，但不能再交给自己；这对运营管理者是收紧。
- 原来能换负责人的项目管理员（不是负责人）会被拒，要找当前负责人或组织管理员；这是对现有用法的收紧，PR 里写明。
- `PATCH` 的负责人校验是新加的：原来传一个不存在或已停用的用户 id 不会被拦（不存在的会在写库时撞外键报错，已停用、不在组织的会被直接写成负责人），现在是 400。
