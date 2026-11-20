# Design：限制谁能更换项目负责人

## Context

- 项目负责人（`Project.ownerId`）在 `src/lib/project-finance/access.ts` 的 `decideFinancePrivilege` 里直接构成财务特权（`privileged = 平台超级管理员 || 组织范围 project.finance.manage || 是负责人`），也就有 `canReadAll`。主规格 `projects/finance-access` 写明组织管理员本身 SHALL NOT 构成财务特权；组织范围的财务键只能由平台超级管理员在岗位绑定界面绑（`src/app/api/organizations/[orgId]/positions/route.ts`，`requirePlatformSuperAdmin`）。
- 今天能换负责人的入口有三个，都只要求 `requireProjectWriteAccess`（= `requireProjectManageAccess`：平台超级管理员、负责人、本组织 `org_admin`、项目 `project_admin`）：
  1. `PATCH /api/projects/[id]`：`body.ownerId` 直接写进 `data.ownerId`，不校验目标是谁、是否在用、是否本组织成员；审计的前后记录只有名称、描述、颜色、状态，不含负责人。
  2. `POST /api/projects/[id]/members`：加成员时 `duty: "owner"` 顺带把他设为负责人；目标必须是在用用户且（有组织时）是本组织有效成员；已是成员 → 409。
  3. `PATCH /api/projects/[id]/members/[memberId]`：`duty: "owner"` 把一个现有成员设为负责人并升为 `project_admin`；`isSelfPromotion` 只拦「角色」路径，不拦「身份」路径，所以项目管理员可以把自己那一行改成主负责人。审计带前后负责人。
- 界面：项目详情「工作台」页签的成员表（`src/components/project-detail/tabs/workbench-tab.tsx`），`canManage` 的人每行有「项目身份」下拉（主负责人 / 主采购人 / 参与者），改了就调第 3 个入口。
- 别的入口：执行项目 `PATCH /api/ops/projects/[id]` 的 `ownerId`（已要求 `canManageDeliveryProjects`，目标只校验存在）；项目派发（平台超级管理员）；新建项目（建的人就是负责人）。

## Goals / Non-Goals

**Goals**：能修改本项目但本身没有财务特权的人，不能通过换负责人拿到财务特权；三个入口同一个判定、同一句话；界面不给不能用的选项。

**Non-Goals**：
- `src/lib/project-finance/access.ts`（负责人仍有财务特权）、`src/lib/projects/access.ts`（`requireProjectWriteAccess` 的判定不变）。
- `src/app/api/ops/projects/[id]/route.ts`、`src/app/api/admin/project-intake/[id]/dispatch/route.ts`、`src/app/api/projects/route.ts`、`src/app/api/organizations/[orgId]/projects/route.ts`。
- `src/lib/projects/duty.ts`、`src/lib/projects/members-utils.ts` 的既有规则（「唯一项目管理员不能降级」「先指定新负责人」等照旧）。
- 岗位绑定、权限键定义（`src/lib/authorization/**`）。

## Decisions

### D1：谁能把负责人换成别人

允许：平台超级管理员；当前负责人（把负责人交给别人）；本组织组织角色不低于 `org_admin` 的有效成员；在本组织持组织范围 `project.finance.manage` 的人。其他能修改本项目的人（不是负责人的项目管理员）→ 403 `只有当前负责人、组织管理员、有全企业「管理项目财务」权限的人或平台管理员能更换项目负责人。`（`code: OWNER_CHANGE_FORBIDDEN`）。

理由：当前负责人本来就有财务特权，交给别人不扩大特权的范围；组织管理员管人、派活，把项目交给某个员工是他的正常工作（交给别人不让他自己拿到特权）；持 `project.finance.manage` 的人本来就有特权。

- 备选 A：只有平台超级管理员与持 `project.finance.manage` 的人能换。否决：组织管理员日常要把项目派给员工，当前负责人交接也要找平台管理员，流程走不通。
- 备选 B：照旧（能修改本项目的人都能换），只禁「换成自己」。否决：项目管理员可以把负责人换成同伙，同伙再换回来，等于没有限制。

### D2：谁能把自己设为负责人

只有平台超级管理员与持组织范围 `project.finance.manage` 的人（本来就有财务特权）。组织管理员、项目管理员把自己设为负责人 → 403 `不能把自己设为项目负责人：负责人能看本项目的全部财务数据。请让当前负责人、有全企业「管理项目财务」权限的人或平台管理员来指定。`（`code: OWNER_SELF_ASSIGN_FORBIDDEN`）。当前负责人「把自己设为负责人」是没有变化的请求，照旧通过。

- 备选：组织管理员也能把自己设为负责人。否决：主规格 `projects/finance-access` 写明组织管理员本身不构成财务特权；允许它就等于组织管理员随时能拿到任何项目的财务特权。

### D3：新负责人的条件

必须是在用的用户（`status = "active"`）；项目属于组织时，还必须是该组织的有效成员（`OrganizationMember.status = "active"`）。不满足 → 400 `新的负责人必须是本组织在用的成员。`（`code: OWNER_NOT_ORG_MEMBER`）。第 2 个入口原来就有这两条检查（404 `用户不存在或已停用`、403 `该用户须先加入所属组织后，才能加入项目`），保留原来的话；第 1、3 个入口新增这条检查。

- 备选：第 1 个入口也要求新负责人先是项目成员。否决：项目成员关系由成员接口管理，`PATCH` 原来不要求，一并要求会让既有的「项目信息」编辑失败；本 change 只管财务特权的扩散。

### D4：同一个判定、整个请求失败

新增 `src/lib/projects/owner-change.ts`：纯函数 `decideOwnerChange({ isSuperAdmin, isCurrentOwner, isOrgAdmin, holdsFinanceManage, actorUserId, currentOwnerId, targetUserId })` 返回通过或 `{ status, code, messageZh }`；另有一个读取函数取调用人在项目组织里的组织角色与是否持组织范围 `project.finance.manage`（复用 `authorize`，与 `resolveFinancePrivilege` 同一口径）。三个入口在写库之前调用；`targetUserId === currentOwnerId` 视为没有更换，直接通过。被拒时**整个请求**返回错误、不写任何字段（`PATCH` 里一起改的名称、日期等也不写），不发项目事件、不写审计、不同步日历。判定顺序：先 D3 的 400（目标不合格）还是先 D1 / D2 的 403？先 403（不该让没权限的人通过错误信息探测用户是否在组织里）。

- 备选：`PATCH` 里只丢掉 `ownerId`、其它字段照写。否决：用户看到「保存成功」却没换成负责人，容易误以为已经换了。

### D5：审计与成员页

- `PATCH /api/projects/[id]` 的审计：负责人有变化时，`beforeData` / `afterData` 各多一个 `ownerId`（其它情况与原来相同）。第 3 个入口原来就记前后负责人；第 2 个入口记 `duty`。
- `GET /api/projects/[id]/members` 多返回 `ownerChange: { canChange: boolean, canSelfAssign: boolean }`（调用人）。成员表：`canChange` 为 false 时「项目身份」下拉里没有「主负责人」；自己那一行在 `canSelfAssign` 为 false 时没有「主负责人」；当前负责人那一行照旧显示「主负责人」。

- 备选：界面不改，靠接口报错。否决：人选了才被拒，体验差；而且看到选项会以为自己有这个权限。

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

- 纯函数：`npx tsx src/lib/projects/__tests__/owner-change.test.ts`——`decideOwnerChange` 各身份 × 换给别人 / 换给自己 / 不变；三个入口的源码断言（写库前调用判定、被拒时提前返回）；两句话逐字。
- 隔离库：`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts`——身份：平台超级管理员、负责人、组织管理员、不是负责人的项目管理员、持组织范围 `project.finance.manage` 的成员；三个入口各自：项目管理员换负责人 403 且库里负责人不变、名称等字段也没写；组织管理员换给别人成功、换给自己 403；持财务键的人换给自己成功；负责人交给别人成功；新负责人不在组织 / 已停用 400；负责人不变的 `PATCH` 照常保存；审计带前后负责人；成员接口的两个标记。
- 既有不改期望：项目详情、成员相关的既有测试原样通过（全量里核对）。
- 全量：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`。

## Risks / Trade-offs

- **GATE：谁能更换负责人**。本 change 按 D1 / D2 取「平台超级管理员、当前负责人、组织管理员（只能交给别人）、持组织范围 `project.finance.manage` 的人」；Lucas 若想更严（例如组织管理员也不能换）或更松（例如项目管理员在本组织内可以交接），改 `decideOwnerChange` 一处与测试。
- 组织管理员仍可以把负责人交给同伙，同伙因此拿到财务特权。组织管理员本来就管成员与岗位以外的授权，这在信任范围内；要堵上只能只让持财务键的人换（备选 A），流程代价大。
- 执行项目接口 `PATCH /api/ops/projects/[id]` 不在本次：它要求「管理执行项目」（平台或组织管理者、`operations.projects.manage`、`operations.manage`），运营管理者可以把执行项目的负责人换成自己。要不要同样收紧，留给 GATE。
- 原来能换负责人的项目管理员（不是负责人）会被拒；他们需要找当前负责人或组织管理员。这是对现有用法的收紧，PR 里写明。
- `PATCH` 的负责人校验是新加的：原来传一个不存在或已停用的用户 id 不会被拦（不存在的会在写库时撞外键报错，已停用、不在组织的会被直接写成负责人），现在是 400。
