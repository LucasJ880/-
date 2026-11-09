# Proposal：邀请码直接绑定企业 + 用户管理按企业隔离（USR-1）

TASKFLOW：USR-1。Lucas 2026-11-09 提出（Sunny 新员工用销售邀请码注册后什么都看不到）。

## Why

- 平台「邀请码」页的「公司归属」只决定登录后左上角的联合品牌 logo（`companyIdsJson`），不决定加入哪个企业。用这样的码注册，注册接口走旧路径，给新用户建一个「×× 的工作区」个人企业；在 Sunny 这种岗位模式企业里，没有成员关系和岗位就什么都看不到，只能再由平台管理员手动加成员、绑岗位。
- `InviteCode` 早就有 `orgId` / `orgRole` 两列，注册接口也早就支持「带企业的邀请码 → 直接加入企业、设为当前企业、自动绑默认岗位、不建个人工作区」，但只有厂家入驻向导能生成这种码，平台邀请码页填不了企业。
- 平台「用户管理」列的是全平台所有用户：管理员在 Sunny 下打开，看到的是所有企业的人和所有个人工作区账号，分不清谁是 Sunny 的员工。

## What Changes

**邀请码绑定企业**
- `POST /api/admin/invite-codes` 接受 `orgId`（选填）与 `orgRole`（`org_member` / `org_admin`，缺省 `org_member`）。填了企业时：平台角色必须是 `sales` / `trade`（与注册时的二次校验 `checkOrgBoundInvite` 同口径），企业必须存在且启用，否则 400。不填企业 = 原行为。
- `PATCH /api/admin/invite-codes/{id}` 接受 `orgId`（字符串或 `null`）与 `orgRole`：给已有的码补绑企业（校验同上，按该码的平台角色），或解绑（`orgRole` 一并清空）。已经用这个码注册的人不受影响。
- `GET /api/admin/invite-codes` 每个码带上 `org`（id / 名称 / 状态，未绑定为 `null`）。
- 邀请码页：新建表单增加「加入企业」与「企业内角色」；默认选中当前企业（个人工作区不在可选列表里）；选了企业后「绑定角色」只剩销售 / 外贸；列表增加「企业」列，可以对已有的码补绑 / 改绑 / 解绑企业。
- 公司 logo 跟随企业、收进后台（Lucas 2026-11-09）：邀请码页去掉「公司归属」选择与「公司」列，用户管理详情去掉「公司归属」选择。绑定企业（建码或补绑 / 改绑）时，服务端按该企业关联的公司写入码上的公司 logo，企业没有关联公司则不带；不绑企业的码仍接受接口旧参数 `companyIds`（兼容）。左上角显示本来就优先取当前企业关联的公司，这次只是不再让人手选。
- 注册：带企业的码按使用上限允许多人先后注册（原来按读到的已用次数做比对，多人同时注册时后到的人会误报「已达上限」；改为「已用次数 < 上限」的条件更新，单次码语义不变）。其余沿用既有企业邀请码注册路径：加入企业、当前企业设为该企业、岗位模式企业按既有规则自动绑默认岗位（平台 sales → `sales_rep`、trade → `trade_rep`）、不建个人工作区。

**用户管理按企业隔离**
- `GET /api/users`（仍只允许平台 super_admin）增加范围：`orgId=…` 只列该企业的在册（active）成员，每行带企业内角色；`scope=platform` 列全平台用户（原行为）；两者都没给时用当前工作企业，没有当前企业则 400 `ORG_SCOPE_REQUIRED`。响应带 `scope`（企业 id / 名称，或 platform）。
- 「用户管理」页默认只显示当前企业的员工（标题下写明「当前企业：××，共 N 人」，多一列企业内角色）；要看全平台用户需要显式切到「全平台」；没有选企业时提示先选企业。

## Capabilities

### New Capabilities
- `identity/invite-org-binding`：平台邀请码绑定企业，注册直接加入企业。
- `identity/org-scoped-user-admin`：平台用户管理按企业范围列人。

### Modified Capabilities
- 无。`identity/member-management` 的「平台用户管理仅平台 super_admin」不变（本次只加范围，不放宽权限）。

受影响的 Muse 意图：无。

## Impact

- 修改：`src/app/api/admin/invite-codes/route.ts`、`src/app/api/admin/invite-codes/[id]/route.ts`、`src/app/(main)/admin/invite-codes/page.tsx`（含去掉公司归属）、`src/app/api/auth/register/route.ts`（企业码占用条件）、`src/lib/organizations/onboarding-rules.ts`（新校验函数）、`src/app/api/users/route.ts`、`src/lib/users/service.ts`、`src/app/(main)/admin/users/page.tsx`（含去掉详情里的公司归属）、测试注册脚本。
- 新增：`src/lib/users/list-scope.ts`、纯函数测试、`org-scoped-users-db.isolated.test.ts`、`docs/QINGYAN_USR-1_REPORT.md`、`docs/acceptance/usr-1/*`。
- 硬纪律：零 schema（`InviteCode.orgId` / `orgRole` 与 `OrganizationMember` 都是既有列）、零出站、零 LLM、不新增队列；权限不放宽（两处接口仍只放行平台 super_admin）。

## Out of scope

- 已注册账号用邀请码「加入企业」（已有密码的邮箱注册仍返回「该邮箱已注册」；这类账号仍由平台管理员在企业成员页添加）。
- 带企业的码分配销售 / 外贸以外的平台角色（运营、老板等仍走成员页手动添加 + 岗位绑定）。
- 企业管理员自助管理成员（`identity/member-management` 规定成员增删改只属于平台管理员，不变）。
- 邀请码列表按企业筛选。
