# Proposal：限制谁能更换项目负责人（CHAIN-2c）

TASKFLOW：CHAIN-2c（新增一行；Phase F（续）— 情报串联的后续；CHAIN-2b #532 留给 GATE 的第 ② 条：「能编辑项目的人可以把负责人改成自己，从而按负责人拿到财务查看权」；Lucas 2026-11-20 GATE 答「可以」，另立 change）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

项目负责人自动拥有项目财务特权（`projects/finance-access`），而四个入口都允许本身没有财务特权的人把自己设为负责人（项目管理员、组织管理员、能管理执行项目的人），绕过「组织管理员本身不构成财务特权」与「财务键只由平台管理员绑定」。

## What Changes

- 限制谁能把负责人换成别人：组织项目只放行平台超级管理员、当前负责人、本组织 `org_admin` 以上的有效成员、在本组织持组织范围 `project.finance.manage` 的人；执行项目接口照旧只让能管理执行项目的人换；个人项目只放行平台超级管理员与当前负责人；其他人 → 403。
- 禁止把自己设为负责人：只有平台超级管理员与在本组织持组织范围 `project.finance.manage` 的人（本来就有财务特权）能把自己设为负责人；其他人 → 403。
- 校验新负责人：必须是在用的用户，项目属于组织时还必须是该组织的有效成员；不是 → 400（加成员接口照原来的检查与说法）。
- 防止同时更换：只在负责人仍是读到的那个人时才写入，否则 409，不覆盖同事刚做的更换。
- 统一四个入口：`PATCH /api/projects/{项目}` 的 `ownerId`、`POST /api/projects/{项目}/members` 的 `duty: "owner"`、`PATCH /api/projects/{项目}/members/{成员}` 的 `duty: "owner"`、`PATCH /api/ops/projects/{项目}` 的 `ownerId` 用同一个判定；被拒时整个请求不写；负责人不变的请求照旧。
- 补审计：`PATCH /api/projects/{项目}` 换了负责人时审计前后带负责人；`PATCH /api/ops/projects/{项目}` 换负责人时新写一条审计。
- 改项目团队卡片：成员列表接口返回调用人能不能把负责人换成别人、能不能换成自己；每行的「项目身份」下拉与「添加成员」的身份下拉按这两项决定给不给「主负责人」；不能换（或不能换给自己）时在卡片上写一句说明。

## Out of scope

- 不改中标后转执行的交接（`src/lib/projects/handoff/execute.ts`）：它新建执行项目，操作人可以把自己选为新项目的负责人——新建项目时建的人当负责人是正常流程，而且新项目一开始只带中标金额，投标团队本来就知道（留给 GATE，design 风险一节）。
- 不改项目派发（`/api/admin/project-intake/{项目}/dispatch`，只有平台管理员）与新建项目时的负责人（建项目的人就是负责人）。
- 不改「负责人拥有财务特权」这条规则本身（`src/lib/project-finance/access.ts`），不改财务键的绑定入口。
- 不改项目的其它可编辑字段与 `requireProjectWriteAccess`、执行项目的 `canEditOwnedDeliveryProject` / `canManageDeliveryProjects` 判定。
- 不新增权限键、角色或开关。

## Capabilities

### New Capabilities

- `projects/owner-change`：谁能把负责人换成别人、不能把自己设为负责人、新负责人的条件、同时更换、四个入口同一口径、审计、项目团队卡片。

### Modified Capabilities

无（`projects/finance-access` 不改：负责人仍有财务特权，本 change 只收紧谁能成为负责人）。

## Impact

- 新增：`src/lib/projects/owner-change.ts`（纯判定、固定文字、卡片说明；页面也用）、`src/lib/projects/owner-change-access.ts`（服务端：调用人的身份、新负责人检查、带条件的写入）。
- 修改：`src/app/api/projects/[id]/route.ts`（PATCH）、`src/app/api/projects/[id]/members/route.ts`（GET 返回 `ownerChange`、POST）、`src/app/api/projects/[id]/members/[memberId]/route.ts`（PATCH）、`src/app/api/ops/projects/[id]/route.ts`（PATCH）、`src/app/(main)/projects/[id]/page.tsx`（把 `ownerChange` 传给工作台）、`src/components/project-detail/tabs/workbench-tab.tsx`（项目团队卡片）。
- 测试：新增 `src/lib/projects/__tests__/owner-change.test.ts` 与 `owner-change-db.isolated.test.ts`（注册进 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`）。
- 零 schema、零依赖、零新增模型调用、零出站。
