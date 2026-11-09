# Tasks

## 1. 邀请码绑定企业

- [x] 1.1 `onboarding-rules.ts` 新增 `validateAdminInviteOrgBinding`（与 `checkOrgBoundInvite` 同一组常量）；`onboarding-rules.test.ts` 补用例；verify：34 passed
- [x] 1.2 `POST /api/admin/invite-codes` 接受 `orgId` / `orgRole`（企业须存在且启用）；`PATCH …/{id}` 补绑 / 改绑 / 解绑；`GET` 每个码带 `org`
- [x] 1.3 注册 `registerIntoOrg` 占用条件改为按上限（有上限 `usedCount < maxUses`，无上限不限）；verify：`onboarding-db.isolated` 82 passed（单次码语义不变）
- [x] 1.4 邀请码页：新建表单「加入企业」「企业内角色」（默认当前企业、排除个人工作区、选企业后只剩销售 / 外贸、自动带公司 logo）；列表「企业」列与补绑 / 改绑 / 解绑

## 2. 用户管理按企业隔离

- [x] 2.1 新增 `src/lib/users/list-scope.ts`（`resolveUserListScope`）+ 纯函数测试；`listUsers` 支持企业范围并带企业内角色；verify：4 passed
- [x] 2.2 `GET /api/users` 按范围返回（`orgId` / `scope=platform` / 当前工作企业 / 400 `ORG_SCOPE_REQUIRED` / 404）
- [x] 2.3 「用户管理」页默认当前企业（企业名 + 人数 + 企业内角色列），显式切换全平台，未选企业时提示

## 3. 测试与收尾

- [x] 3.1 新增 `org-scoped-users-db.isolated.test.ts`（建码校验、补绑、真实注册加入企业 + `sales_rep` + 无个人工作区、上限、用户列表范围与权限）；注册到测试脚本；verify：31 passed，无库跳过；`list-status.test.ts` 补注册并移出基线
- [x] 3.2 隔离库 + `next dev` 截图 `docs/acceptance/usr-1/01–06`（含注册页真实注册的新销售登录后进入企业销售首页）
- [x] 3.3 `check-test-registry.sh`、typecheck、`lint:baseline`、`test-runtime-architecture.sh`、`openspec validate org-scoped-user-onboarding --strict`
- [x] 3.4 `docs/QINGYAN_USR-1_REPORT.md` + TASKFLOW USR-1 行

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive org-scoped-user-onboarding --yes`。
