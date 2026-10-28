# Design

## Context

- 判定现状（2026-10-28 盘点）：
  - `canManageUsers(user.role)`（= `admin || super_admin || boss`）守 13 个路由：运营配置 11 个（brand-profile、content-plan ×4、matrix-accounts ×2、postiz/integrations、tender-profile、video-assets/sync、video-assets/[id]/fanout）+ 平台用户管理 2 个（users、users/[id]）。`users/[id]` PATCH / DELETE 另用 `isSuperAdmin`（同样是 admin 或 super_admin）与 `canDeleteUsers`（= canManageUsers）。
  - Playbook：`src/lib/operations/playbook/permissions.ts` 6 个同步函数按平台角色字符串判（批准 = admin/boss；起草 = 再加 operations/manager；读 = 任何角色），被 12 个路由调用。
  - 发布任务：`src/lib/operations/service.ts` `canApprovePublishJob`（admin/boss）+ `approveAndDispatchJob` 内"创建人不得自批，Boss 除外"。
  - 增长中心：`src/lib/marketing/access-policy.ts` `canEditMarketingBrandProfile`（admin / manager / org_member / org_admin 放行），经 `requireMarketingWriteAccess` 守约 20 个 `src/app/api/marketing/**` 写接口。
  - 运营中心入口：`workspace-policy.ts` `canAccessOperationsWorkspace` 含 `isOperationsStaff(platformRole)`；`/api/ops/home` 与 `/api/ops/projects/[id]` 构造的 `wsCtx` **不含** `permissionKeys`（页面侧 `resolveWorkspaceContextFromCookies` 已注入）。
  - `src/lib/operations/projects/access.ts` `isPlatformOrOrgManager` 含 `canManageUsers`（其中 boss 已被 `isManagementWorkspaceUser` → `isExecutiveRole` 覆盖，admin 已被 `isSuperAdmin` 覆盖，该行无独立效果）。
- 授权内核：`authorize()` 按岗位绑定（无绑定时按组织角色兼容回退）；平台 super_admin 经 `platformAdminBindings()` 拿到全部键 ORG（PERM-1）。运营路由都已用 `resolveRequestOrgIdForUser` 解析企业。
- `ContentPlanItem` 无创建人字段（`source` = ai / manual）；`MatrixAccountPlaybook` / `MatrixGroupPlaybook` 有 `submittedById`；`PublishJob` 有 `createdById`。

## Goals / Non-Goals

**Goals:**
- 上述所有运营 / 增长中心 / 平台用户管理判定只剩"权限键 + 资源（提交人 / 创建人）"与平台 super_admin。
- 判定集中在一个 helper 模块，路由只调 helper，不在路由里散写 `authorize` 参数。

**Non-Goals:**
- `src/lib/rbac/workspace-policy.ts` 的 `getDefaultWorkspace`、`isManagementWorkspaceUser`（含 `isExecutiveRole`）、`canAccessSalesWorkspace` 不动（PERM-4c）。
- `src/lib/navigation/registry.ts` 的 `requiredPlatformRoles`、`src/components/sidebar.tsx` / `mobile-nav-drawer.tsx` / `header.tsx` 的角色显示不动（PERM-4c）。
- `src/app/api/operations/market-intelligence/**`、`dashboard`、`brand-truth`、`glossary`、`metrics`、`config-health`：现状无角色判定，本次不加门槛（proposal Out of scope）。
- `src/app/api/operations/worker/**`（token 鉴权）、`src/lib/operations/service.ts` 的发布派发 / AI 审稿 / 自动批准逻辑、`PublishJob` 状态机不动。
- `src/lib/rbac/roles.ts` 的 `canManageUsers` / `canDeleteUsers` / `isSuperAdmin` 函数体不改（只加 `@deprecated` 注释）。

## 八条硬纪律对照

1. 零 schema：触碰。新键是代码常量 + 岗位模板绑定；自批判定用既有 `submittedById` / `createdById`；不加字段。
2. 出站先审批：触碰（不放松）。发布任务仍须人工批准（或企业已开启的自动批准）才派发；本次只把"谁能批"从平台角色换成 `operations.content.approve`，并去掉 Boss 自批例外，审批更严。派发 / 扇出仍要求 `operations.manage`。
3. 禁止第三套队列：不涉及。不新增队列 / 调度 / 注册表 / 审批类型。
4. 脱敏：不涉及（不触碰 Muse 通道与金额输出）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：不涉及（纯权限判定，无 LLM）。
8. 测试注册：触碰。新测试文件在 `scripts/test-all.sh` 注册，纯函数测试加入 `scripts/test-ci-unit.sh`。

## Decisions

### D1 一个 helper 模块 `src/lib/operations/access.ts`
导出 `holdsOpsPermission(user, orgId, key)`（`authorize` 包一层，super_admin 由平台绑定覆盖）、`requireOpsPermission(user, orgId, key | key[], message)` → `NextResponse | null`（任一键允许即过），以及纯函数 `selfApprovalBlocked({ actorId, authorId, isPlatformSuperAdmin })`。Playbook / 发布任务 / 运营配置路由都只调这里。
- 否决：每个路由内联 `authorize({...})`。理由：25 个路由会出现 25 份同构判定，口径一处漂移就分叉（PERM-4a 已在销售区见过）。

### D2 Playbook 权限函数改为异步、按键判定，保留函数名
`canReadPlaybook / canEditPlaybookDraft / canSubmitPlaybook / canApprovePlaybook` 改为 `(user, orgId) => Promise<boolean>`，分别映射 `operations.read` / `operations.content.draft` / `operations.content.draft` / `operations.content.approve`；`assertCanApprovePlaybook` 改为 `(user, orgId, submittedById, action: "approve" | "reject")`，approve 时做自批判定，reject 不做。12 个调用路由同步改为 `await` 且传 `orgId`（路由里 orgId 已解析，个别在判定之后解析的需前移）。
- 否决：新建一套函数并保留旧的同步版本。理由：旧版本按平台角色判，留着会被新代码误用。

### D3 发布任务：路由判键，service 判自批
`canApprovePublishJob` 改为 `(user, orgId)` 异步判 `operations.content.approve`；`approveAndDispatchJob` 的自批判定改为 `selfApprovalBlocked`（只有平台 super_admin 例外），参数从 `actorRole` 改为 `isPlatformSuperAdmin`。reject 路由只判键。
- 否决：把键判定也放进 service。理由：service 无 request / user 上下文，现状就是路由判权限，保持分层。

### D4 选题"已通过"不做自批
`ContentPlanItem` 无创建人字段，零 schema 不能加；选题通过只是进入可派发状态，对外发布仍要过发布任务审核（D3 的自批判定在那里生效）。PATCH 把 `status` 改为 `approved` 要求 `operations.content.approve`，其余编辑要求 `operations.content.draft`。
- 否决：用 AuditLog 反查选题创建人。理由：AI 生成的选题没有人类创建人，反查结果对多数选题为空，规则形同虚设又增加查询。

### D5 投标档案读写对招投标岗开放
投标档案是投标主体信息，实际维护人是招投标岗（`bids`：`project.read / update`），老入口挂在运营下只是位置。读 = `operations.read | project.read`，写 = `operations.manage | project.update`。
- 否决：只按 `operations.*`。理由：会让招投标岗（Lucas / Bill / 蒋晨）维护不了自己的投标档案，而运营岗与投标主体无关。

### D6 增长中心：`canEditMarketingBrandProfile` 改异步按键
签名改为 `(user, orgId) => Promise<boolean>`（`operations.manage`），`getMarketingBrandProfileAccess` / `requireMarketingWriteAccess` 内部调用；20 个营销路由不改。`membershipRole` 返回值保留（前端用于提示）。
- 否决：在 20 个路由逐一加判定。理由：现有单点 helper 已覆盖全部写接口，改一处即全覆盖。

### D7 运营中心入口与 ops API 注入权限键
`canAccessOperationsWorkspace` 去掉 `isOperationsStaff`；`/api/ops/home` 与 `/api/ops/projects/[id]` 构造 `wsCtx` 时用 `resolveEffectiveBindings` 注入 `permissionKeys`（与 `resolve-workspace-context.ts` 同一取法，抽成共用函数）。`projects/access.ts` 删除 `canManageUsers` 行（无独立效果，见 Context）。
- 否决：保留 `isOperationsStaff` 到 4c。理由：任务书 4b 第 5 条；且 Sunny 运营两人已有岗位，入口按岗位更准确。

### D8 平台用户管理用 `isPlatformSuperAdmin`
`users` / `users/[id]` 的 `canManageUsers` / `isSuperAdmin` / `canDeleteUsers` 全部换成 `isPlatformSuperAdmin`；`/admin/users` 页面的 `canManageUsers` / `isAdmin` 换成客户端新增的 `isPlatformSuperAdmin`（`permissions-client.ts`，与服务端同名同义）。
- 否决：按岗位键（如 `identity.member.manage`）。理由：平台用户是跨企业的平台资源，不属于任何企业岗位；PERM-2 已定"成员 / 岗位管理仅平台管理员"。

## Risks / Trade-offs

- [老板失去运营配置与增长中心写权，是 BREAKING] → 拍板决定（设计稿 §4-9"老板看过程和结果"）；老板保留读与内容批准（`operations.content.approve`）。报告写明。
- [平台 admin / boss 失去平台用户管理] → 拍板决定；只有 Lucas（super_admin）管理平台用户。
- [Maggie（平台角色 operations）在 seed 前无岗位键会进不了 /ops] → 上线顺序：先对 Sunny 重跑 `seedOrgAuthorizationProfiles` 并确认 Marty / Maggie 已绑 `ops_lead` / `ops_staff`（PERM-1 绑定文件已列）。
- [Marty 是唯一运营主管：他创建的发布任务与提交的 Playbook 只能由老板批] → 拍板决定；Sunny 有 4 位老板岗。
- [12 个 Playbook 路由改异步调用，漏 await 会把 Promise 当真值放行] → 函数返回 `Promise<boolean>`，TypeScript 对 `if (!promise)` 不报错，所以测试里对每个路由做源码断言（含 `await can…`）+ 隔离库端到端覆盖代表路由。
- [无判定的运营接口仍开放读写] → 列入已知限制，后续单独 change 评估。

## Migration Plan

1. 合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（ops_staff / ops_lead / owner 模板变了，幂等）。
2. 确认 Marty / Maggie 的岗位绑定已生效（`config/positions/sunny.json`）。
3. 回滚：revert PR；模板回退需再跑 seed。

## 验证方式

- `npx tsx src/lib/authorization/__tests__/authorize.test.ts`：两新键登记与 HUMAN-only、ops_staff / ops_lead / owner 快照、其余模板不含。
- 新增 `src/lib/operations/__tests__/ops-access.test.ts`（纯函数：`selfApprovalBlocked` 决策表；Playbook / 发布 / 配置 / 增长中心 / users 路由源码断言：无 `canManageUsers(`、无平台角色字符串、权限函数均被 `await`）。
- 改写 `src/lib/operations/__tests__/playbook.test.ts`（平台角色用例改为岗位绑定用例）、`src/lib/marketing/__tests__/growth-center.test.ts`、`src/lib/tender-profile/__tests__/tender-profile.test.ts`（TP-05 源码断言）、`src/lib/rbac/__tests__/security1-owner-manager.test.ts`（`canManageUsers` 仍存在但标 deprecated）。
- 新增隔离库端到端 `src/lib/operations/__tests__/ops-authorize-db.isolated.test.ts`（本地 Postgres 16 + pgvector）：销售读品牌档案 403 / 老板 200、老板改品牌档案 403 / Marty 200、Maggie 扇出 403；Maggie 起草并提交 Playbook 200、Marty 自批 403、老板批 200；Maggie 批发布任务 403、Marty 批 Maggie 的任务允许、boss 自批 403；增长中心销售写 403 / Marty 200 / Maggie `canEdit=false`；招投标岗写投标档案 200；平台 admin 列用户 403；平台角色 operations 无岗位进 `/api/ops/home` 403、Maggie 200。
- `grep -rn "canManageUsers(" src/app/api` 为空；`grep -rnE "role === \"(operations|manager|boss)\"|isBoss\(" src/lib/operations src/lib/marketing src/app/api/operations src/app/api/marketing` 为空（测试除外）。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`；`openspec validate perm-4b-ops-authorize --strict`。
