# Proposal：限制谁能更换项目负责人（CHAIN-2c）

TASKFLOW：CHAIN-2c（新增一行；Phase F（续）— 情报串联的后续；CHAIN-2b #532 留给 GATE 的第 ② 条：「能编辑项目的人可以把负责人改成自己，从而按负责人拿到财务查看权」；Lucas 2026-11-20 GATE 答「可以」，另立 change）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

项目负责人自动拥有项目财务特权（`projects/finance-access`），而三个入口都只要求「能修改本项目」就能换负责人，项目管理员、组织管理员都可以把自己设为负责人，绕过「组织管理员本身不构成财务特权」与「财务键只由平台管理员绑定」。

## What Changes

- 限制谁能更换负责人：只有平台超级管理员、当前负责人、本组织组织角色不低于 `org_admin` 的有效成员、在本组织持组织范围 `project.finance.manage` 的人能把负责人换成别人；其他能修改本项目的人（如不是负责人的项目管理员）→ 403，整个请求不写库。
- 禁止把自己设为负责人：只有平台超级管理员与持组织范围 `project.finance.manage` 的人（本来就有财务特权）能把自己设为负责人；组织管理员、项目管理员把自己设为负责人 → 403，整个请求不写库。
- 校验新负责人：必须是在用的用户，项目属于组织时还必须是该组织的有效成员；不是 → 400，不写库（`PATCH /api/projects/{项目}` 原来不校验）。
- 统一三个入口：`PATCH /api/projects/{项目}` 的 `ownerId`、`POST /api/projects/{项目}/members` 的 `duty: "owner"`、`PATCH /api/projects/{项目}/members/{成员}` 的 `duty: "owner"` 用同一个判定；负责人不变的请求照旧。
- 补审计：`PATCH /api/projects/{项目}` 换了负责人时，审计的前后记录带上负责人。
- 改成员页：成员列表接口返回调用人能不能换负责人、能不能把自己设为负责人；不能的人在「项目身份」下拉里看不到「主负责人」（自己那一行按后一项判断）。

## Out of scope

- 不改执行项目接口 `PATCH /api/ops/projects/{项目}` 的负责人重新分配（它已按「管理执行项目」权限收口；运营管理者能否把自己设为负责人留给 GATE，design 风险一节）。
- 不改项目派发（`/api/admin/project-intake/{项目}/dispatch`，只有平台管理员）与新建项目时的负责人（建项目的人就是负责人）。
- 不改「负责人拥有财务特权」这条规则本身（`src/lib/project-finance/access.ts`），不改财务键的绑定入口。
- 不改项目的其它可编辑字段与 `requireProjectWriteAccess` 的判定。
- 不新增权限键、角色或开关。

## Capabilities

### New Capabilities

- `projects/owner-change`：谁能更换项目负责人、不能把自己设为负责人、新负责人的条件、三个入口同一口径、审计、成员页的显示。

### Modified Capabilities

无（`projects/finance-access` 不改：负责人仍有财务特权，本 change 只收紧谁能成为负责人）。

## Impact

- 新增：`src/lib/projects/owner-change.ts`（纯判定 + 读取调用人的组织角色与财务键）。
- 修改：`src/app/api/projects/[id]/route.ts`（PATCH）、`src/app/api/projects/[id]/members/route.ts`（GET 返回两个标记、POST）、`src/app/api/projects/[id]/members/[memberId]/route.ts`（PATCH）、`src/components/project-detail/tabs/workbench-tab.tsx`（「主负责人」选项）。
- 测试：新增 `src/lib/projects/__tests__/owner-change.test.ts` 与 `owner-change-db.isolated.test.ts`（注册进 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`）。
- 零 schema、零依赖、零新增模型调用、零出站。
