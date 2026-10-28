# Design

## Context

- `VisualizerSession` 没有 `orgId` 列，企业归属只能经 `customerId → SalesCustomer.orgId` 推出（`SalesCustomer.orgId` 非空，A2-3 起严格）。
- `src/lib/visualizer/access.ts` 三个判定（`visualizerSessionListScope` / `canSeeVisualizerSession` / `validateCustomerAccessForCreate`）都以 `isGlobalScope(role)` 短路；`ROLE_CAPABILITIES` 里 `admin`、`boss` 为 `dataScope: "all"`，`super_admin` 经 `getCapabilities` 同样为全部。调用方从不传企业，所以短路 = 跨企业全量。
- 19 个会话类路由（`src/app/api/visualizer/{sessions,images,regions,variants,product-options}/**`）、文件代理 `visualizer/sessions/{id}` 分支、AI 工具 `sales-visualizer.ts` 都只调这三个判定；`/api/visualizer/catalog/**` 已经用 `resolveSalesOrgIdForRequest`。
- 客户端调用全部经 `apiFetch`；`ORG_SCOPED_API_PREFIXES` 不含 `/api/visualizer/`，所以现在不带 `orgId`。
- PERM-1 口径：平台 super_admin 在任一企业内全权，但仍以请求的企业为上下文（`platformAdminBindings()` 的数据范围是 ORG，不是跨企业）。

## Goals / Non-Goals

**Goals:**
- 企业边界在判定函数内部强制：不传企业就编译不过，传了就不可能跨企业。
- 判定是纯函数，可脱离数据库单测。

**Non-Goals:**
- 不改 `src/lib/rbac/data-scope.ts`、`src/lib/rbac/capabilities.ts`、`src/lib/trade/access.ts`（销售 / 外贸其他调用方依赖现行为）。
- 不改 `src/app/api/visualizer/share/**`、`src/app/sales/share/visualizer/**`、`src/app/api/visualizer/catalog/**`。
- 不改 `prisma/schema.prisma`，不写迁移。
- 不改可视化页面组件（`src/app/(main)/sales/visualizer/**`、`src/app/(main)/sales/customers/[id]/**`）——`orgId` 由 `apiFetch` 注入。

## Decisions

**D1 企业来源 = 销售区同一解析 + 成员校验（新 `src/lib/visualizer/org-context.ts` 的 `resolveVisualizerOrgId(request, user)`）**
先调 `resolveSalesOrgIdForRequest`（普通用户取 `activeOrgId` / 唯一企业，带的 `orgId` 只做交叉校验；平台 `admin` / `super_admin` 必须显式 `orgId`），再对非 super_admin 查 `OrganizationMember` 为 active，否则 403。
- 否决"直接用 `resolvePreferredOrgId`"：它对平台 admin 返回任意企业列表中的偏好，且不做请求级交叉校验，与销售区口径不一致。
- 否决"只调 `resolveSalesOrgIdForRequest`"：它对平台 `admin` 只校验企业存在，`admin` 带任意 `orgId` 仍可跨企业——正是本次要堵的同类洞。

**D2 判定拆成纯函数 `src/lib/visualizer/access-policy.ts`（不 import db）**
- `visualizerSessionListScope(user, orgId)` → 始终返回 `{ AND: [{ customer: { orgId } }, (非全部范围时) { OR: [本人创建, 本人负责, 客户本人创建] }] }`，不再有 `null`。
- `visualizerSessionAccess(session, user, orgId)` → `"ok" | "not_found" | "forbidden"`：先比 `session.customer.orgId === orgId`（不等 → `not_found`），再 `super_admin` / `isGlobalScope` → `ok`，再本人三条 → `ok`，否则 `forbidden`。
- `customerCreateAccess(customer, user, orgId)` → 同样三态（含归档 400）。
`access.ts` 保留 db 读取（`validateCustomerAccessForCreate(customerId, user, orgId)`、`loadSessionBy*`）并 re-export；`SESSION_ACCESS_SELECT` 的 `customer` 增加 `orgId`。`canSeeVisualizerSession` 删除，强制每个调用点改为三态，靠 `npm run typecheck` 找全。
- 否决"保留 `canSeeVisualizerSession` 加可选 `orgId`"：可选参数会让漏传的调用点继续跨企业，且编译器不报。
- 否决"Prisma middleware / 扩展统一注入 orgId"：`VisualizerSession` 无 `orgId` 列，需要关系过滤，全局注入影响分享页等无登录路径。

**D3 跨企业 = 404，同企业无权 = 403**
与 `sales/record-access`（"跨企业或不存在 SHALL 返回 404"）一致，不暴露他企业资源存在性。路由统一用一个 `visualizerAccessResponse(access)` 映射（`not_found` → 404 "可视化方案不存在"，`forbidden` → 403 原文案）。
- 否决"一律 403"：可用来探测他企业方案 ID 是否存在。

**D4 super_admin 的范围**
在所解析的企业内等同全部范围；企业边界对其同样生效（只是 D1 不要求成员关系）。与 `platformAdminBindings()` 的 ORG 范围一致。
- 否决"super_admin 不过滤"（`salesCreatedScope` 现行为）：违背 PERM-1 "在请求的企业上下文内"，且列表会混入多企业数据。

**D5 文件代理按方案所属企业的成员关系**
`<img src="/api/files/visualizer/sessions/…">` 无法带 `orgId`，所以取方案的 `customer.orgId` 作为上下文：非 super_admin 必须是该企业活跃成员，再走 `visualizerSessionAccess(session, user, session.customer.orgId)`。
- 否决"用 `activeOrgId`"：用户切换企业后旧页面图片全部 403；成员关系已经排除跨租户。
- 否决"沿用 `hasOrgAccess`"：它对平台 `admin` 无条件放行。

**D6 客户端 `apiFetch` 登记 `/api/visualizer/`**
自动在 query 带组织切换器选中的 `orgId`；JSON body 也会被补 `orgId`，各路由 body 校验只取已知字段（apply 时逐个确认无白名单拒绝）。
- 否决"在每个页面组件手动拼 `orgId`"：调用点 20+，易漏。

**D7 AI 工具**
`ctx.orgId`（`ToolExecutionContext.orgId: string`）作为企业；客户名搜索 where 显式加 `orgId: ctx.orgId`（`salesCreatedScope` 对 super_admin 返回 `null`）。

## 与八条硬纪律的关系

1. 零 schema：遵守。无 model / 字段 / 迁移；企业归属经 `customer.orgId` 关系过滤。
2. 出站先审批：不涉及（`share/email` 路由只加企业判定，发送链路不变）。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及 Muse 通道；本次是租户隔离，SHALL NOT 输出他企业数据见 spec。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及（`share/email` 发件逻辑不动）。
7. 确定性优先：遵守。判定是纯查表 / 比较，无 LLM。
8. 测试注册：遵守。新测试 `src/lib/visualizer/__tests__/access-policy.test.ts` 注册到 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（纯函数），`scripts/check-test-registry.sh` 通过，不动 `ci/test-registry-baseline.txt`。

## 验证方式

- `npx tsx src/lib/visualizer/__tests__/access-policy.test.ts`：用内存 fixtures（企业 A 梦馨 / 企业 B Sunny 各若干方案）+ 一个只支持 `AND / OR / 等值 / 关系嵌套` 的极小 where 求值器，断言 `boss` / `admin` / `super_admin` / `sales` 在 A 上下文的列表结果不含 B；三态判定跨企业为 `not_found`；新建校验跨企业 404。
- `npm run typecheck`（证明所有调用点都已传 `orgId`）、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`npm test`。
- `grep -rn "canSeeVisualizerSession\|isGlobalScope" src/app/api/visualizer src/lib/visualizer src/lib/agent-core/tools/sales-visualizer.ts "src/app/api/files"`：`canSeeVisualizerSession` 为空，`isGlobalScope` 只出现在 `access-policy.ts`。
- `npx -y @fission-ai/openspec@1.15.0 validate visualizer-org-boundary --strict`。

## Risks / Trade-offs

- [平台 admin / super_admin 原先不带 `orgId` 也能用] → `apiFetch` 自动注入组织切换器选中的企业；未选企业时返回 400 提示选择，与销售区一致。
- [多企业成员切换企业后，旧标签页里的可视化请求会因 `orgId` 不一致 403] → 与销售区现行为一致，刷新即可。
- [平台 `admin` 不是目标企业成员时失去访问] → 有意为之，与 `sales/record-access`"平台角色不带来隐含权限"一致；Lucas（super_admin）不受影响。
- [`customer.orgId` 关系过滤增加一次 join] → `SalesCustomer` 主键 join，列表 `take: 100`，可忽略。

## Migration Plan

无数据迁移。部署即生效；回滚 = revert 本 PR。
