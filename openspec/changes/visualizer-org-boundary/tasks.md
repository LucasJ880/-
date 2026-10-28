# Tasks

## 1. 判定核心

- [ ] 1.1 新增 `src/lib/visualizer/access-policy.ts`（不 import db）：`visualizerSessionListScope(user, orgId)`（始终带 `customer.orgId`）、`visualizerSessionAccess(session, user, orgId)` 与 `customerCreateAccess(customer, user, orgId)` 三态（design D2 / D4）；新增 `src/lib/visualizer/__tests__/access-policy.test.ts`（中文用例名，内存 fixtures + 极小 where 求值器，覆盖 spec"方案列表只含当前企业 / 企业内可见范围 / 跨企业单条访问返回 404 / 新建与打开方案只针对当前企业客户"各场景），注册到 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：`npx tsx src/lib/visualizer/__tests__/access-policy.test.ts` 全过，`bash scripts/check-test-registry.sh` 通过。
- [ ] 1.2 改 `src/lib/visualizer/access.ts`：re-export 1.1 的纯函数，`SESSION_ACCESS_SELECT.customer` 加 `orgId`，`validateCustomerAccessForCreate(customerId, user, orgId)` 改用 `customerCreateAccess`（跨企业 404"客户不存在"），删除 `canSeeVisualizerSession`，新增 `visualizerAccessResponse(access)`（404 / 403 映射）；新增 `src/lib/visualizer/org-context.ts` 的 `resolveVisualizerOrgId(request, user)`（design D1）。verify：`npm run typecheck` 的报错只剩各调用点缺 `orgId` / 引用已删函数。

## 2. 调用点

- [ ] 2.1 会话入口路由 `src/app/api/visualizer/sessions/route.ts`（GET / POST）、`sessions/open/route.ts`、`sessions/[id]/reuse-candidates/route.ts`：先 `resolveVisualizerOrgId`，列表 / 候选 where 用新 scope，新建 / 打开传 `orgId`，打开时复用目标也走三态。verify：`npx tsc --noEmit` 对这三个文件无报错。
- [ ] 2.2 `src/app/api/visualizer/sessions/[id]/{route,images/route,images/clone/route,share/route,share/email/route,variants/route}.ts`：解析企业 + `visualizerSessionAccess`；clone 的候选源方案逐个用同一企业判定。verify：`npx tsc --noEmit` 对这些文件无报错，`grep -n "canSeeVisualizerSession" src/app/api/visualizer/sessions -r` 为空。
- [ ] 2.3 `src/app/api/visualizer/{images/[imageId]/**,regions/[regionId],variants/[variantId]/**,product-options/[id]}/route.ts`（共 10 个文件）：解析企业 + 三态判定。verify：`npm run typecheck` 全绿，`grep -rn "canSeeVisualizerSession" src` 为空。
- [ ] 2.4 文件代理 `src/app/api/files/[...path]/route.ts` 的 `visualizer/sessions` 分支按方案所属企业成员关系放行（design D5）；AI 工具 `src/lib/agent-core/tools/sales-visualizer.ts` 两个工具传 `ctx.orgId`，客户名搜索 where 加 `orgId: ctx.orgId`（design D7）。verify：`npm run typecheck` 全绿；`grep -n "isAdmin\|visualizerSessionListScope(" "src/app/api/files/[...path]/route.ts" src/lib/agent-core/tools/sales-visualizer.ts` 中 `visualizerSessionListScope` 调用都带 `ctx.orgId`。
- [ ] 2.5 `src/lib/api-fetch.ts` 的 `ORG_SCOPED_API_PREFIXES` 加 `/api/visualizer/`（design D6），并逐个确认可视化 JSON 路由的 body 校验（`src/lib/visualizer/validators.ts` 及各路由）不因多出的 `orgId` 字段报错。verify：`grep -n "orgId\|strict\|unknown key" src/lib/visualizer/validators.ts` 无白名单拒绝；`npm run lint:baseline` 通过。

## 3. 集成检查

- [ ] 3.1 全量门禁：`npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`npm test`、`npx -y @fission-ai/openspec@1.15.0 validate visualizer-org-boundary --strict` 全绿；`grep -rn "isGlobalScope" src/app/api/visualizer src/lib/visualizer` 只命中 `access-policy.ts`。

## Workflow follow-up

- `/opsx:verify visualizer-org-boundary` 后开 PR（一个 change = 一个 PR）。
- PR 合并后 `/opsx:archive visualizer-org-boundary --yes`（独立小 PR），新建 `openspec/specs/sales/visualizer-access/spec.md`；本 change 无 TASKFLOW ID，不改状态列。
