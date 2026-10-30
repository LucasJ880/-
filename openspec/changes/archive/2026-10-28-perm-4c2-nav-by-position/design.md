# Design

## Context

- `workspace-policy.ts`：管理层 = super_admin / 平台 `boss`·`manager`（`isExecutiveRole`）/ 企业 `org_owner`·`org_admin`；销售工作区 = 管理层 / 平台 `sales`；默认落地按 `isSalesStaff` / `isOperationsStaff` 平台角色排序。运营 / 招投标 / 安装 / 会计入口已按权限键（4b / 5a / INSTALL-1）。
- 导航 `registry.ts`：48 处 `requiredPlatformRoles`（`NAV_ROLES_EXEC / SALES / OPERATIONS / TRADE / PROJECTS`）；`filter.ts` `platformRoleOk`：`requiredPermissions` 命中即可见（PERM-3 引入，只 2 个入口用），否则按平台角色；另有 `isNavGroupHiddenForRole` / `isNavItemHiddenForRole` 按平台角色隐藏整组 / 单条。
- 客户端导航上下文来自 `/api/auth/active-org`（已含 `permissionKeys`、`modules`、`orgRole`）；服务端页面用 `resolveWorkspaceContextFromCookies`（已含 `permissionKeys`）；`/api/ops/home`、`/api/ops/projects/[id]` 自建 wsCtx（4b 注入了 `permissionKeys`）。
- 岗位模板只存在于窗饰行业包（`POSITION_PROFILE_SETS`）；梦馨无行业包岗位、无绑定（拍板 2：保留旧规则）。
- 键分布（合并模板）：`owner` 无 `sales.quote.create`（有 update）；`accounting` 有 `sales.customer.read` / `sales.quote.read`；出单岗有 `sales.quote.read` / `project.read`——所以"销售专职"不能用读键判定。

## Goals / Non-Goals

**Goals**：窗饰企业的管理层、工作区、落地、侧栏、底栏全部按岗位键；梦馨行为不变；外贸入口按 `trade` 例外。

**Non-Goals**：
- 不删 `src/lib/rbac/nav-role-policy.ts`、`requiredPlatformRoles` 字段与 `NAV_ROLES_*`（旧模式在用）。
- 不改任何 API / 页面内部的权限判定（`src/app/api/**`、各 page 的数据门槛）。
- 不改 `src/lib/rbac/roles.ts` 的 `PLATFORM_ROLES`、`User.role`（4c3 压扁数据）。
- 不改 `src/app/(main)/trade/**`。

## Decisions

### D1 新键 `organization.dashboard.read` 作为管理层唯一信号，只给 `owner`
系统模板不绑（seed 会把 `org_owner` / `org_admin` 成员自动绑到同名模板，4c1 已踩过）。
- 否决：用 `audit.read` 等既有键推断——语义不对，后续给别的岗位加审计会误判为管理层。
- 否决：看岗位 profile key（`owner`）——客户端只有权限键，没有 profile key；多一种口径。

### D2 岗位模式 = 企业行业包有岗位模板
`hasPositionTemplates(industryPackId)`（`profilesForIndustryPack` 非空）；`WorkspacePolicyContext.positionMode` 与 `NavigationFilterContext.positionMode` 新增可选布尔，缺省 false = 旧模式（所有既有测试与调用方不传即旧行为）。`/api/auth/active-org` 返回 `positionMode`；`resolve-workspace-context` 与两个 ops API 一并带上（`permission-keys.ts` 新增 `loadPositionMode(orgId)`，与既有 `loadPermissionKeys` 并列调用；查不到行业包或出错按旧模式）。
- 否决：按"该成员有无岗位绑定"判——同一企业里有人有绑定有人没有，菜单口径会因人而异；压扁前后也会抖动。
- 否决：全部企业一起切——梦馨无岗位，菜单会消失（拍板 2 否决）。

### D3 导航用新字段 `positionPermissions`，不复用 `requiredPermissions`
岗位模式下 `platformRoleOk` 只看：`superAdminOnly` → 平台 super_admin（两种模式都生效）；`platformAdminOnly` → 原口径；`tradeEntry` → 平台角色 `trade` 或管理层；`positionPermissions` → 持任一；都没有 → 可见（再由工作区 / 模块 / 成员判定）。整组 / 单条按平台角色隐藏只在旧模式执行。旧模式完全走原逻辑（含现有 `requiredPermissions` 的 OR 语义）。

映射（`MGMT = organization.dashboard.read`，`SALES = sales.quote.create | sales.quote.pricing_close`）：

| 入口 | 岗位模式 |
|---|---|
| 日程、销售中心 / 首页、全部报价、报价单、业绩、邮箱设置 | `SALES` 或 `MGMT` |
| 企业经营（`/operations/center`）、AI 能力、经营驾驶舱 | `MGMT` |
| 工艺单、面料库存 | 沿用 `requiredPermissions`（PERM-3） |
| 招投标项目、项目情报 ×7、供应商 | `project.read` |
| 品牌增长、运营内容、市场情报 | `operations.read` / `operations.manage` |
| 报告 | `operations.read` / `operations.manage` 或 `MGMT` |
| 外贸 ×12、营收中心 ×2、产品内容 | `tradeEntry`（`trade` 或管理层） |
| 知识库、微信集成 | 所有成员（旧模式只对销售隐藏；岗位模式不按"是否销售"区分） |
| 平台用户管理 | 新字段 `superAdminOnly`：只对平台 super_admin（两种模式都是，与 4b 接口口径一致；既有 `platformAdminOnly` 含平台 admin，不够严） |
- 否决：直接给这些入口加 `requiredPermissions`——旧模式里 `requiredPermissions` 命中即放行，会改变梦馨的菜单（成员角色兼容回退给了 org_owner 若干读键）。

### D4 岗位模式下的工作区与落地
`isManagementWorkspaceUser` = super_admin ∨ `MGMT`；`canAccessSalesWorkspace` = 管理层 ∨ `SALES`；`getDefaultWorkspace` 顺序：管理层 `/` → `SALES` `/sales/home` → `operations.*` `/ops` → `project.create|update` `/bids` → `accounting.read` `/accounting` → `install.task.update` `/install`（出单岗也持 `install.task.read`，不能据此落地）→ `/`（`resolveHomeRedirect` 再兜底到 `/tasks`）。会计落地的"非销售 / 运营专职"在岗位模式下即"不持 `SALES` / `operations.*`"。旧模式原样。
- 否决：销售用 `sales.customer.read` 判——会计与出单岗都持有，会被误落到销售首页。

### D5 底栏销售布局 = 默认落地为 `/sales/home`
`mobile-tab-bar` 的 `isSales` 改为 `positionMode ? getDefaultWorkspace(wsCtx) === "/sales/home" : user.role === "sales"`。
- 否决：岗位模式下也看平台角色——压扁后全员 `user`，销售会失去销售底栏。

## 与八条硬纪律的关系

1. 零 schema：触碰。新键是代码常量；`positionMode` 由既有 `Organization.industryPackId` 推导。
2. 出站先审批：不涉及。
3. 第三套队列：不涉及。
4. 脱敏：不涉及（只改可见性，不改数据输出）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：触碰。全部查表；不新增 LLM 调用。
8. 测试注册：触碰。新测试注册 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（纯函数）。

## Risks / Trade-offs

- **BREAKING（Sunny）**：平台角色不再影响菜单与落地；没绑 `owner` 的老板不再是管理层（会落到其岗位工作区）。上线前确认 Sunny 老板都绑了 `owner`（PERM-1 绑定文件）。
- 知识库 / 微信集成在岗位模式下对销售也可见（D3 表）——这是有意的放宽，审核时可改为限定岗位。
- 两套导航逻辑并存到梦馨落岗位为止；旧模式测试全部保留以防回归。

## 验证方式

- `npx tsx src/lib/authorization/__tests__/authorize.test.ts`（新键登记与模板）
- `npx tsx src/lib/navigation/__tests__/position-nav.test.ts`（新，纯：岗位模式判定、每岗位落地 + 侧栏快照（owner / sales_rep / pricing_lead / ops_lead / ops_staff / accounting / bids / fulfillment_* / installer / 多岗并集）、平台角色无影响反例、外贸例外、平台用户管理只 super_admin、底栏布局；旧模式抽样与改动前一致）
- 既有回归原样通过：workspace-policy 26、default-workspace 8、home-redirect 9、navigation-workspace 34、navigation-ia 63、nav-active-matcher 21、accounting 38
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate perm-4c2-nav-by-position --strict`
