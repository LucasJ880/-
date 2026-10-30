# Proposal

TASKFLOW：PERM-7b（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）。
任务书：`docs/QINGYAN_PERM-7b_PLATFORM_ADMIN_TASKBRIEF.md`。判断点按推荐（A / 取消 `trade` 保留 / 压扁纳入 `admin` / 旧模式不开例外）；用户 2026-10-28 确认："按推荐方法去实施7B"。

## Why

设计稿 §2.1 的平台层只有 `super_admin` 与 `user`，业务能力全看岗位。4a–7 已把各业务域收到"岗位键或 super_admin"，但平台 `admin` 这个值本身仍被当作平台管理员：

- 三个共用判定（`isSuperAdmin` / `isAdmin` / `isPlatformAdmin`）与客户端同名函数都是 `admin || super_admin`，61 个文件在用。
- 由此平台 `admin` 还能跨企业：
  - `requireOrgRole` 旁路；
  - 企业列表 / 详情 / 归档；
  - 项目访问与可见性；
  - 显式 orgId 解析；
  - 入驻控制台、能力运行记录、项目诊断、新建企业、平台公司与邀请码。
- 约 20 处手写 `role === "admin" || role === "super_admin"` 同口径。
- AI 一侧：派生角色把 `admin` 原样透传；工具注册表里 `admin` 档能调全部工具；Muse 管理层名单含 `admin`。
- 邀请码与平台用户修改接口还能签发 `admin`。

任何平台 `admin` 账号都是事实上的跨企业管理员，绕开了 4a–7 的岗位收口。

## What Changes

- **平台特权只认 `super_admin`**：
  - `isSuperAdmin` / `isAdmin` / `isPlatformAdmin`、`permissions-client` 同名函数、`useCurrentUser().isPlatformAdmin` 改为只认 `super_admin`；
  - 守卫 `requirePlatformAdmin` / `requireSuperAdmin` / `requireRole` 的平台旁路随之只认 `super_admin`；
  - 约 20 处手写平台 admin 判断改调共用判定。
  - 平台 `admin` 由此等同 `user`：能力全看岗位绑定（旧模式企业另有企业角色兼容回退）。
- **AI 一侧**：
  - 派生角色的保留名单只剩 `super_admin`：岗位模式下平台 `admin` 与 `trade` 也按权限键派生；
  - 工具注册表只有 `super_admin` 对应 `admin` 工具档，原始 `admin` 按 `user`；
  - Muse 销售管理层名单去掉 `admin`。
- **不再签发**：邀请码与平台用户修改接口不再接受 `admin`；已有的 `admin` 邀请码注册按 `user` 落。
- **压扁纳入 `admin`**：`collapse-platform-roles` 范围加 `admin → user`，前置校验同 4c3 / 6c（须有岗位绑定）。
- **测试**：既有测试里用平台 `admin` 构造"有平台特权的人"的，改为 `super_admin`；被测行为不变。

## Capabilities

### New Capabilities
- `authorization/platform-admin-scope`：平台特权（跨企业访问、平台控制台入口、AI 平台工具档、平台角色签发）只属于 `super_admin`。

### Modified Capabilities
- `agents/position-derived-role`："岗位派生平台角色规则"只保留 `super_admin`。
- `authorization/platform-role-collapse`："压扁范围"加 `admin`。

## Out of scope

- 删除平台角色枚举值（`admin / boss / manager / operations / sales / trade`）：压扁在处理数据，枚举清理另做。
- 设计稿 §2.1 的"平台管理员操作"审计标记、敏感操作自批记录。
- super_admin 的跨企业范围本身。
- 入驻向导"平台管理员不能被指定为工厂老板"的限制：它是限制而不是特权，保留。

## Impact

- 修改：
  - `src/lib/rbac/roles.ts`、`src/lib/rbac/platform-admin.ts`、`src/lib/permissions-client.ts`、`src/lib/hooks/use-current-user.ts`、`src/lib/auth/guards.ts`；
  - 手写判断所在文件（design D3 列表）；
  - `src/lib/rbac/effective-platform-role.ts`、`src/lib/agent-core/tool-registry.ts`、`src/lib/muse-bridge/sales-pure.ts`；
  - `src/app/api/admin/invite-codes/route.ts`、`src/app/api/users/[id]/route.ts`、`src/app/api/auth/register/route.ts`；
  - `src/lib/authorization/platform-role-collapse.ts`。
- 新增测试：`src/lib/rbac/__tests__/platform-admin-scope.test.ts`（纯）、`platform-admin-scope-db.isolated.test.ts`（隔离库）。
- 零 schema；无新权限键。
- **BREAKING（合并即生效）**：
  - 所有平台 `admin` 账号失去跨企业访问、入驻控制台、能力运行记录、诊断视图、新建企业、邀请码与平台公司、AI 全部工具；
  - 合并前 Lucas 须把平台运维账号改为 super_admin，并确认其余 `admin` 账号已绑岗位；
  - 6b（#307）先合并。
