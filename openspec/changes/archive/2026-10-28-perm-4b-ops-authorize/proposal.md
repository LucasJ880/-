# Proposal

TASKFLOW：PERM-4b（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）；任务书 `docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` PERM-4b 段（判断点见末尾"拍板结果 · PERM-4b"，2026-10-28 已定）

## Why

运营配置、发布审核、Playbook 批准、增长中心写操作都按平台角色字符串判定（`canManageUsers` = 平台 admin 或 boss；`isAdmin || isBoss`；`role === "operations"`），运营主管 Marty 绑了 `ops_lead` 岗位却改不了运营配置、批不了发布，而任何同企业成员都能读运营配置、改增长中心。设计稿 §4-9 定的是"运营自己维护，老板看过程和结果"。

## What Changes

- 新增权限键 `operations.content.draft`（起草 / 改草稿 / 提交审核，ORG）绑 `ops_staff`、`ops_lead`；`operations.content.approve`（批准 / 驳回发布任务与 Playbook，ORG，HIGH）绑 `ops_lead`、`owner`。
- 运营配置接口（品牌档案、内容计划、矩阵账号、postiz 集成、视频资产、投标档案）：读要求 `operations.read`，写要求 `operations.manage`，删除 `canManageUsers` 判定。**BREAKING**：平台角色 boss 不再能改运营配置；不持 `operations.read` 的成员（如销售）读不到这些配置。投标档案另对持 `project.read` / `project.update` 的招投标岗开放读 / 写。
- 内容计划：创建 / 修改 / 删除选题与 AI 生成选题要求 `operations.content.draft`；把选题改为已通过要求 `operations.content.approve`（选题无创建人字段，多为 AI 生成，不做自批判定；对外发布仍要过发布任务审核）；派发与视频扇出要求 `operations.manage`。
- Playbook（账号与账号组）：读要求 `operations.read`；新建 / 改草稿 / AI 草稿 / 提交要求 `operations.content.draft`；批准 / 驳回要求 `operations.content.approve` 且不是提交人。删除按平台角色 `operations` / `manager` / `boss` 的判定。
- 发布任务：列表要求 `operations.read`；批准 / 驳回要求 `operations.content.approve` 且不是任务创建人；删除"Boss 可自批"例外，只保留平台 super_admin 例外。
- 增长中心（营销）全部写接口要求 `operations.manage`；企业普通成员只读。**BREAKING**：org_member / org_admin / 平台 manager 不再因组织或平台角色可写。
- 平台用户管理 `GET /api/users`、`GET/PATCH /api/users/{id}`（管理他人）只允许平台 super_admin；`/admin/users` 页面同步只对平台 super_admin 显示。**BREAKING**：平台 admin / boss 失去平台用户管理。
- 运营中心 `/ops` 入口只按 `operations.*` 权限与管理层放行，去掉平台角色 `operations` 放行；运营项目团队判定去掉 `canManageUsers`。
- `src/lib/rbac/roles.ts` 的 `canManageUsers` 标 `@deprecated`（PERM-4c 删除）。

## Capabilities

### New Capabilities
- `operations/config-access`: 运营配置（品牌档案、内容计划、矩阵账号、postiz、视频资产、投标档案、发布任务列表）与运营中心入口的读写权限判定
- `operations/content-approval`: 运营内容（选题、Playbook、发布任务）的起草 / 提交 / 批准分权与不得自批规则
- `marketing/growth-center-access`: 增长中心写操作的权限判定

### Modified Capabilities
- `authorization/position-catalog`: 登记 `operations.content.draft` / `operations.content.approve`；运营人员、运营主管、老板模板追加对应绑定
- `identity/member-management`: 平台用户管理接口只属于平台 super_admin

## Out of scope

- 默认工作区跳转（`getDefaultWorkspace`）、导航 `requiredPlatformRoles`、`permissions-client.ts` 其余函数与平台角色压扁（PERM-4c）。
- 当前**没有任何角色判定**的运营接口（`market-intelligence/**`、`dashboard`、`brand-truth`、`glossary`、`metrics`、`config-health`）不在本次收紧范围：本次只替换既有的角色字符串判定，不给无判定的接口新增门槛；列入报告的已知限制。
- worker 接口（`operations/worker/**`，token 鉴权）、出站发布的审批流程本身（发布任务仍须人工批准或企业开启的自动批准，不改）、外贸 `requireRole`（PERM-6）、数字员工（PERM-5）。
- `canManageUsers` 函数本身不删（4c 删除）。

## Impact

- `src/lib/authorization/permissions.ts`、`role-defaults.ts`、`__tests__/authorize.test.ts`
- 新建 `src/lib/operations/access.ts`（权限判定 helper）；`src/lib/operations/playbook/permissions.ts`、`src/lib/operations/service.ts`（`canApprovePublishJob` / `approveAndDispatchJob`）、`src/lib/operations/projects/access.ts`
- `src/app/api/operations/**` 中 13 个配置路由与 12 个 Playbook / 发布任务路由
- `src/lib/marketing/access-policy.ts`、`access.ts`（影响 `src/app/api/marketing/**` 约 20 个写接口，路由本身不改）
- `src/app/api/users/route.ts`、`[id]/route.ts`；`src/app/(main)/admin/users/page.tsx`；`src/lib/permissions-client.ts`
- `src/lib/rbac/workspace-policy.ts`、`roles.ts`
- 测试：`growth-center.test`、`tender-profile.test`、`security1-owner-manager.test`、playbook / publish 相关测试与新增用例
- 零 schema；上线需对 Sunny 重跑 `seedOrgAuthorizationProfiles`（ops_staff / ops_lead / owner 模板变了）
