# Tasks

## 1. 权限键、岗位与判定 helper

- [x] 1.1 `permissions.ts` 新增 `operations.content.draft`（"起草运营内容"，MEDIUM，`["ORG"]`）与 `operations.content.approve`（"批准运营内容"，HIGH，`["ORG"]`，`allowedPrincipalTypes: ["HUMAN"]`）；`role-defaults.ts`：`ops_staff`（窗饰并集）+ draft，`ops_lead` + draft + approve，`owner` + approve；`authorize.test.ts` 加两键登记、三个模板快照、其余模板不含。新建 `src/lib/operations/access.ts`（`holdsOpsPermission` / `requireOpsPermission` / 纯函数 `selfApprovalBlocked`，design D1）。verify：`npx tsx src/lib/authorization/__tests__/authorize.test.ts` 通过；typecheck。

## 2. 运营配置与入口

- [x] 2.1 13 个配置路由去掉 `canManageUsers`：brand-profile、content-plan（route / [id] / generate / [id]/dispatch）、matrix-accounts（route / [id]）、postiz/integrations、tender-profile、video-assets（route / sync / [id]/fanout）——读 `operations.read`、写 `operations.manage`；content-plan 起草 / 编辑 / 删除 / 生成 `operations.content.draft`，改为 `approved` `operations.content.approve`（D4），派发 `operations.manage`；tender-profile 读 `operations.read | project.read`、写 `operations.manage | project.update`（D5）；`tender-profile.test.ts` TP-05 源码断言同步。verify：`grep -rn "canManageUsers(" src/app/api/operations` 为空；`npx tsx src/lib/tender-profile/__tests__/tender-profile.test.ts` 通过；typecheck。
- [x] 2.2 `workspace-policy.ts` `canAccessOperationsWorkspace` 去掉 `isOperationsStaff`；抽出 `loadPermissionKeys(userId, orgId)` 共用函数（与 `resolve-workspace-context.ts` 同取法），`/api/ops/home`、`/api/ops/projects/[id]` 的 `wsCtx` 注入 `permissionKeys`；`projects/access.ts` 删除 `canManageUsers` 行（D7）。verify：`navigation-workspace.test.ts` 与 ops 相关已注册测试通过；typecheck。

## 3. 运营内容分权

- [x] 3.1 `playbook/permissions.ts` 改异步按键（D2）；12 个 Playbook 路由（matrix-accounts / matrix-groups 下 list / detail / ai-draft / submit / approve / reject 与 effective-context）改为 `await` + 传 `orgId`；approve 做自批判定、reject 不做；`playbook.test.ts` 平台角色用例改为岗位键用例。verify：`npx tsx src/lib/operations/__tests__/playbook.test.ts` 通过；`grep -rnE "role === \"(operations|manager)\"|isBoss\(" src/lib/operations/playbook` 为空。
- [x] 3.2 发布任务（D3）：`canApprovePublishJob(user, orgId)` 判 `operations.content.approve`；`approveAndDispatchJob` 自批改 `selfApprovalBlocked`（去掉 Boss 例外，参数 `actorRole` → `isPlatformSuperAdmin`）；`publish-jobs` 列表 GET 要 `operations.read`；approve / reject 路由同步。verify：`grep -rn "isBoss(" src/lib/operations/service.ts` 为空；publish-pipeline 相关已注册测试通过；typecheck。

## 4. 增长中心与平台用户管理

- [x] 4.1 `marketing/access-policy.ts` `canEditMarketingBrandProfile` 改为 `(user, orgId)` 异步判 `operations.manage`，`access.ts` 同步（D6）；`growth-center.test.ts` 第 111–115 行改为岗位键用例。`users/route.ts`、`users/[id]/route.ts` 的 `canManageUsers` / `isSuperAdmin` / `canDeleteUsers` → `isPlatformSuperAdmin`；`permissions-client.ts` 新增 `isPlatformSuperAdmin`，`/admin/users` 页面改用它；`roles.ts` 的 `canManageUsers` / `canDeleteUsers` 加 `@deprecated`（D8）。verify：`npx tsx src/lib/marketing/__tests__/growth-center.test.ts`、`security1-owner-manager.test.ts` 通过；`grep -rn "canManageUsers(" src/app/api` 为空；`npx eslint "src/app/(main)/admin/users/page.tsx"` 无新增 error。

## 5. 测试与收尾

- [ ] 5.1 新建 `src/lib/operations/__tests__/ops-access.test.ts`（`selfApprovalBlocked` 决策表 + 路由源码断言：无 `canManageUsers(`、权限函数均被 `await`）注册 test-all 与 test:ci；新建 `src/lib/operations/__tests__/ops-authorize-db.isolated.test.ts`（design 验证方式所列场景）注册 test-all。verify：本地 Postgres 16 + pgvector 隔离库跑通；`bash scripts/check-test-registry.sh` 通过。
- [ ] 5.2 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate perm-4b-ops-authorize --strict` 通过；写 `docs/QINGYAN_PERM-4b_REPORT.md`（做了什么 / 怎么验 / BREAKING 与上线顺序 / 已知限制：无判定的运营接口、唯一运营主管的内容由老板批）；`docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-4b 改 `[G]`；更新 `docs/QINGYAN_PERMISSION_HANDOFF.md`。verify：四条命令退出 0；`grep -c "PERM-4b .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后 `/opsx:archive perm-4b-ops-authorize --yes`（独立小 PR），TASKFLOW PERM-4b 改 `[x]`；确认 `openspec list --specs` 出现 `operations/config-access`、`operations/content-approval`、`marketing/growth-center-access`。
- 生产：合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`；确认 Marty / Maggie 岗位绑定生效。
