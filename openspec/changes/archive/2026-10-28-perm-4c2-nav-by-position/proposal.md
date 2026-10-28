# Proposal

TASKFLOW：PERM-4c2（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）；任务书 `docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` PERM-4c 段 What-2 / What-3（拍板见"拍板结果 · PERM-4c"第 2–4 条，2026-10-28 已定）

## Why

侧栏、底栏、默认落地页与管理层判定仍按平台角色（`boss` / `manager` / `operations` / `sales` / `trade`）渲染（设计稿 §5 冲突 C5），与岗位无关：PERM-4c3 把 Sunny 平台角色压扁成 `user` 后，按现状所有人都会看到同一套菜单、落到同一个页面。本次让窗饰企业（有岗位模板的企业）的可见性与落地完全由岗位权限键决定，梦馨（无岗位）保持现状。

## What Changes

- 新增权限键 `organization.dashboard.read`（"查看企业经营总览"，MEDIUM，ORG，只允许人类）：只绑 `owner`；它是"管理层"的唯一岗位信号（拍板 4）。
- 引入"岗位模式"：当前企业的行业包有岗位模板（窗饰 `window_covering_services_v1`）时为岗位模式，否则为旧模式（梦馨）。`/api/auth/active-org` 与服务端工作区上下文返回该标记。
- 岗位模式下的工作区判定（`workspace-policy`）：
  - 管理层 = 平台 super_admin 或持 `organization.dashboard.read`；
  - 销售工作区 = 管理层或持 `sales.quote.create` / `sales.quote.pricing_close`；
  - 运营 / 招投标 / 安装 / 会计判定照旧按权限键（4b / 5a / INSTALL-1 已是）；
  - 默认落地：管理层 `/` → 销售 `/sales/home` → 运营 `/ops` → 招投标 `/bids` → 会计 `/accounting` → 安装 `/install` → `/tasks`，全部按键，不看平台角色。
- 岗位模式下的导航：每个业务入口按 `requiredPermissions` 判定（映射见 design D3），平台角色不再参与，按平台角色整组 / 单条隐藏的规则不生效；外贸（`/trade/**`、营收中心、产品内容）入口在岗位模式下按"平台角色 `trade` 或管理层"判定（拍板 3）；平台用户管理入口只对平台 super_admin。
- 底栏（`mobile-tab-bar`）销售布局改为"默认工作区是 `/sales/home`"判定，不再看平台角色 `sales`。
- 旧模式（梦馨）：工作区、导航、底栏逻辑与本次改动前完全一致。**BREAKING（窗饰企业）**：平台角色 `boss` / `manager` / `operations` / `sales` 不再影响 Sunny 的菜单与落地；老板要持 `owner` 岗位才是管理层。

## Capabilities

### New Capabilities
- `navigation/position-based-visibility`: 岗位模式 / 旧模式的判定，岗位模式下管理层、各工作区、默认落地、导航入口、底栏的可见性规则，外贸入口例外

### Modified Capabilities
- `authorization/position-catalog`: 登记 `organization.dashboard.read`，`owner` 绑定
- `accounting/workspace`: 会计默认落地在岗位模式下不再看平台角色

## Out of scope

- 平台角色压扁脚本与关闭兼容回退（PERM-4c3）；`User.role` 列与 `PLATFORM_ROLES` 枚举不动。
- 外贸模块 `requireRole`（PERM-6）；`/trade/**` 页面内部判定。
- 梦馨落岗位模板与绑定。
- 页面与 API 本身的权限判定（只改导航可见性、落地与底栏布局；接口门槛已由 PERM-1 至 5 按键判定）。
- `nav-role-policy.ts` 文件删除（旧模式仍要用）；`requiredPlatformRoles` 字段保留给旧模式与外贸。

## Impact

- `src/lib/authorization/permissions.ts`、`role-defaults.ts`、`__tests__/authorize.test.ts`
- `src/lib/rbac/workspace-policy.ts`（`positionMode` 输入、岗位模式分支）、`src/lib/rbac/resolve-workspace-context.ts`、`src/lib/authorization/role-defaults.ts`（`hasPositionTemplates(industryPackId)`）
- `src/app/api/auth/active-org/route.ts`（返回 `positionMode`）
- `src/lib/navigation/{types,filter,registry}.ts`（`requiredPermissions` 铺开、岗位模式分支、外贸例外）
- `src/components/{sidebar,mobile-nav-drawer,mobile-tab-bar}.tsx`（传 `positionMode`；底栏销售判定）
- 测试：workspace-policy / default-workspace / home-redirect / navigation-workspace / navigation-ia / nav-active-matcher 补岗位模式用例（旧模式用例保持），新增每岗位"落地 + 导航"快照测试
- 零 schema；上线需对 Sunny 重跑 `seedOrgAuthorizationProfiles`（owner 加 `organization.dashboard.read`）
