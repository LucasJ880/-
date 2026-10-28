# Proposal

TASKFLOW：无（安全修复；PERM-4 平台角色读路径盘点中发现，任务书 `docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` 未覆盖 `src/app/api/visualizer/**`）

## Why

`src/lib/visualizer/access.ts` 对 `dataScope = "all"` 的平台角色（`admin`、`boss`、`super_admin`）直接返回"不过滤"，可视化方案的列表 / 详情 / 新建校验都不带企业条件，于是梦馨的老板能列出并打开 Sunny 的可视化方案与客户（跨企业读）。本次让每一个可视化接口都限定在调用者的当前企业内。

## What Changes

- 新增可视化接口的企业解析：沿用销售区 `resolveSalesOrgIdForRequest`（`activeOrgId`；平台 admin / super_admin 须显式 `orgId`），并且对非 super_admin 校验其在该企业是活跃成员，否则 403。
- 把可视化方案的可见性判定改为"先企业、后范围"的纯函数：方案所属客户的 `orgId` 不等于当前企业时一律不可见（含 `boss` / `admin` / `super_admin`）；同一企业内 `dataScope = "all"` 的角色与平台 super_admin 看企业内全部，其他角色仍按"本人创建 / 本人负责 / 本人创建的客户"。
- 列表 where 片段始终带 `customer.orgId = 当前企业`，不再有返回 `null`（不过滤）的分支。
- 新建 / 打开方案前的客户校验加企业条件：客户不属于当前企业时返回 404（与"客户不存在"同文案，不暴露存在性）。
- 跨企业访问单个方案（以及经图片 / 窗区 / 变体 / 产品选项反查到的方案）返回 404，同企业内无权仍返回 403。
- 改 19 个 `src/app/api/visualizer/**` 会话类路由与 `src/lib/agent-core/tools/sales-visualizer.ts` 两个工具：全部传入当前企业；AI 工具按 `ctx.orgId` 限定，客户名搜索显式带 `orgId`。
- 文件代理 `src/app/api/files/[...path]` 的 `visualizer/sessions/{id}/…`：要求调用者是该方案所属企业的活跃成员（平台 super_admin 例外），再按同一判定放行。
- 客户端 `apiFetch` 把 `/api/visualizer/` 登记为按企业隔离的前缀，自动带上组织切换器选中的 `orgId`。
- 新增纯函数测试，证明企业 A 的 `boss` / `admin` / `super_admin` 看不到企业 B 的方案与客户；注册到 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## Capabilities

### New Capabilities
- `sales/visualizer-access`: 可视化方案（session 及其图片、窗区、变体、产品选项、文件）的企业边界与企业内可见范围判定，以及新建 / 打开方案时的客户校验

### Modified Capabilities
（无）

## Out of scope

- 可视化方案改走岗位权限键 `authorize(sales.customer.read …)`：企业内可见范围保持现状（`dataScope = "all"` 看全部，其余看本人），另立 change。
- 公开分享页 `/api/visualizer/share/[token]/**`（按 token 鉴权，不涉及登录用户企业）。
- 产品库 `/api/visualizer/catalog/**` 与文件代理 `visualizer/catalog/{orgId}/…`、其他前缀的 `hasOrgAccess` 平台 admin 放行（不涉及方案与客户）。
- `src/lib/rbac/data-scope.ts` 的 `salesCreatedScope` / `salesAssignableScope` 对 super_admin 返回 `null` 的既有行为（销售区其他调用方）。
- 零 schema：`VisualizerSession` 不加 `orgId` 字段，企业归属经 `customer.orgId` 推出。

## Impact

- `src/lib/visualizer/access.ts`、新增 `src/lib/visualizer/access-policy.ts`（纯函数）、新增 `src/lib/visualizer/org-context.ts`
- `src/app/api/visualizer/{sessions,sessions/open,sessions/[id]/**,images/[imageId]/**,regions/[regionId],variants/[variantId]/**,product-options/[id]}/route.ts`
- `src/app/api/files/[...path]/route.ts`、`src/lib/agent-core/tools/sales-visualizer.ts`、`src/lib/api-fetch.ts`
- 测试：`src/lib/visualizer/__tests__/access-policy.test.ts`；`scripts/test-all.sh`、`scripts/test-ci-unit.sh`
- 对外行为：平台 admin / super_admin 调可视化接口须带 `orgId`（`apiFetch` 自动带）；跨企业方案从 200 变为 404
