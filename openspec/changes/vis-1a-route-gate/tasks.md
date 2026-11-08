# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_VIS-1a_REPORT.md`。开工前先跑 design「验证方式」里 10 个受影响测试，记下基线（2026-11-08：86 / 63 / 34 / 26 / 76 / 3 / 21 / 19 / 164 / 91）。

## 1. 注册表与工作区口径

- [x] 1.1 改注册表与工作区策略：
  - `src/lib/navigation/registry.ts`：新增 `ROUTE_ONLY_NAV_ITEMS`，不进 `NAVIGATION_REGISTRY` 也不进侧栏。共 9 条：审批中心、工艺单详情、项目详情、客户详情、销售复盘、平台管理员页、安装日历、网站预约、邮箱绑定（6.1 独立审查后加第 10 条 `route-project-member`，给「项目成员也放行」补模块条件）。键、模块与 `salesWorkspaceVisible` 按 design D4 / D9。`nav-projects`、`nav-project-intel`、`nav-intel-{awards,competitors,agencies,supply,monitor}`、`nav-suppliers` 的 `positionPermissions` 改为 `project.create` / `project.update` / `organization.dashboard.read`；`biz-revenue` 的 `moduleKey` 改为 `"trade"`。
  - `src/lib/tenancy/modules.ts`：`NAV_HREF_MODULES["/revenue"]` 改为 `["trade"]`。
  - `src/lib/rbac/workspace-policy.ts`：`canAccessBidWorkspace` 在岗位模式下非管理层只认 `project.create` / `project.update`，旧模式不变。
  - 测试：
    - `position-nav.test.ts` 更新 accounting 与三个出单岗位的快照，并补三条 spec 场景断言：会计 / 出单即使 `hasBidCapability` 也不见招投标与项目情报；`bids` / `owner` 可见；启用 `sales` 未启用 `trade` 时，岗位模式老板与无行业包企业的平台 `boss` 都不见营收中心。
    - `workspace-policy.test.ts` 补岗位模式的 `canAccessBidWorkspace` 用例：会计、出单、只是项目成员的安装工为 false；`bids`、`owner`、`ops_lead` + `bids` 为 true；旧模式用例不变。
  - verify：`position-nav.test.ts`、`navigation-ia.test.ts`、`navigation-workspace.test.ts`、`workspace-policy.test.ts`、`wechat-entry-nav.test.ts` 全过；`position-nav` 里除上述 4 份快照外其余快照未改。

## 2. 门表与纯判定

- [x] 2.1 写判定函数与测试：
  - 新增 `src/lib/navigation/route-gate.ts`，包含五部分：
    - 门表常量：按 design D4 / D5，按段匹配、`*` 单段、`=` 精确、最具体优先；含 `/projects/*` 的「项目成员也放行」标记、`/organizations` 的「无成员身份也放行」标记与项目平台管理员子页条目。
    - 请求分类：API / 免登录 / `public/` 静态文件 / 门外 / 登录即可 / 需判定。静态文件 = 末段带扩展名且第一段不是已登录区一级路径。
    - `resolveRouteGate(pathname, ctx)`：导航项连父链判定，`wechatEntryEnabled` 照实传入。
    - 302 目标：`resolveHomeRedirect ?? "/"`，不放行或同路径时落 `/tasks`。
    - 请求处理函数：接收 `NextRequest` 与可注入的输入加载器，返回放行或 302。用户停用或不存在 → `/login`；平台 super_admin → 放行。
  - 新增可注入时钟的 TTL 缓存（30 秒、500 条上限、超出淘汰最旧）。
  - 先写 `src/lib/navigation/__tests__/route-gate.test.ts`：
    - 表驱动：Sunny 11 种岗位身份 + 梦馨 2 种（`trade_rep`；`owner` + `trade_rep`，按 `DEFAULT_MENGXIN_MODULES`）+ 4 个无行业包企业抽样（启用 `sales` / `trade` / `marketing` / `operations` / `product_content` / `supply_chain`）× 全部登记路径的放行 / 302 目标；super_admin 全放行（含未登记路径）。
    - 侧栏等价只对「只对应单个侧栏入口」的路由断言；登录即可、只做门条目、带标记的路由按各自规则断言。
    - 侧栏可见 ⇔ 放行；默认工作区必放行；两步无环；
    - 源码断言：遍历 `src/app/(main)/**/page.tsx`，与测试里的「页面 → 规则」快照逐条一致（163 条，新页面不在快照里即失败）；`(main)` 外 6 个页面在免登录或门外清单；`public/` 下文件都带扩展名且一级目录不与已登录区重名。
    - spec `navigation/route-gate` 每条可在纯函数层验证的场景各一条断言：Lynn / 安装工 / 老板 / 会计 / ops_lead / bids / ops_staff / 出单 / 梦馨两种身份 / 无行业包抽样。
    - 缓存：过期、上限淘汰、不同企业不串。
    - 请求分类：`/api/**`、静态文件、免登录、门外、白名单不调加载器。
    - HTTP 层：用 `NextRequest` 构造请求，断言 302、`Location`、正文为空、无自定义说明头、不带原查询串；加载器抛错时落 `/tasks`；停用用户落 `/login`。
    - 带扩展名的已登录区路径（如 `/trade/prospects/x.json`）判为需判定。
    - 判定顺序（design D3）中纯函数层可验证的部分：登录即可的路由不调用户查询。未登录时图片与 `/sw.js` 的先后依赖中间件，在 4.1 用中间件层断言验证。
  - 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：`npx tsx src/lib/navigation/__tests__/route-gate.test.ts` 全过；`bash scripts/check-test-registry.sh` 通过；`ci/test-registry-baseline.txt` 无新增行。

## 3. 共享判定输入

- [x] 3.1 新增 `src/lib/navigation/context-server.ts`：按 design D2 的字段表产出判定输入。
  - 中间件用：当前企业 = `activeOrgId`，为空时取唯一 active 成员关系；只读、不调 `resolvePreferredOrgId`；用户状态 / 平台角色 / 当前企业 id 每次请求重新解析，企业侧字段走第 2 组的缓存，按 `(userId, orgId)` 分键。
  - active-org 用：企业仍由 `resolvePreferredOrgId` 决定，不走缓存。
  - `src/app/api/auth/active-org/route.ts` 改为用它取 modules / orgRole / workspaceIds / hasBidCapability / permissionKeys / positionMode。route-gate 测试补源码断言：active-org 响应的 JSON 键集合与改动前一致，且 active-org 从 `context-server` 取输入。verify：`npm run typecheck` 通过；route-gate 测试全过。

## 4. 中间件接入

- [x] 4.1 改 `src/middleware.ts`：`config` 加 `runtime: "nodejs"`，`matcher` 改为只排除 `_next/static`、`_next/image`、`favicon.ico`；登录校验之后按第 2 组的请求分类判定，需判定的页面请求经 `context-server` 取输入、调 `resolveRouteGate`，不放行就 `NextResponse.redirect(target, 302)`，不带原查询串、不加说明判定原因的响应头；取输入失败时 302 到 `/tasks` 并记日志；删除营销页面分支，保留 `/api/marketing/**` 分支。`public/sw.js` 的 `VERSION` 提到 `qingyan-v4`。route-gate 测试补中间件层断言（直接调用 `middleware`）：未登录请求 `public/` 图片放行、未登录请求 `/sw.js` 跳 `/login`、未登录请求 `/projects/a.png` 跳 `/login`；补源码断言：中间件声明 `runtime: "nodejs"`、从 `context-server` 取输入、调用 `route-gate` 的请求处理函数、不再导入 `isMarketingWorkspacePath` / `isMarketingPagePath`；`config.matcher` 不再含图片扩展名排除；`public/sw.js` 的 `VERSION` 为 `qingyan-v4`。verify：route-gate 测试、`npx tsx scripts/public-route-auth-contracts.test.ts`（基线 164）、`notification-href.test.ts`（基线 91）全过；`NODE_OPTIONS=--max-old-space-size=$(node scripts/build-heap-mb.mjs) npx next build --webpack` 成功，构建输出含 `ƒ Proxy (Middleware)`。

## 5. 删除被取代的旧门

- [x] 5.1 删除被取代的门：
  - 删 `src/lib/marketing/workspace-gate.ts` 及只调用它的 `src/app/(main)/marketing/layout.tsx`、`src/app/(main)/operations/growth/layout.tsx`。
  - `src/lib/marketing/route-access.ts` 删 `isMarketingPagePath` / `isMarketingWorkspacePath`，保留 API 判定。
  - `bids/page.tsx`、`accounting/page.tsx`、`ops/page.tsx`、`ops/projects/page.tsx`、`ops/projects/[id]/page.tsx`、`install/**/page.tsx` 删掉工作区重定向，保留未登录跳转。
  - `sales/analytics/page.tsx` 删 `isSuperAdmin` 判定与「无权限访问」块，数据请求不再按平台角色跳过。
  - 同步改断言：`residual-reads.test.ts` 的「营销 layout 服务端门槛」改为「营销页面经路由门」，「中间件原判定保留」改为只看 API 分支；`route-access.test.ts` 去掉页面路径用例，正式注册进 `scripts/test-all.sh` 并从 `ci/test-registry-baseline.txt` 删掉它那一行（基线只减不增）。
  - verify：`residual-reads.test.ts`、`route-access.test.ts`、`ops-access.test.ts`、route-gate 测试全过；`grep -rn "guardMarketingWorkspacePage\|isMarketingPagePath\|isMarketingWorkspacePath" src` 只剩 route-gate 测试里的反向断言；按平台角色拦页面路由的残留为零（API 层的 `canAccessMarketingWorkspace` 按 design Q8 保留）：`grep -n 'role === "sales"\|role !== "sales"' src/middleware.ts` 与 `grep -rn 'role === "sales"' "src/app/(main)"` 都无输出；`bash scripts/check-test-registry.sh` 通过。

## 6. 门禁

- [ ] 6.1 跑整体门禁并做独立审查：
  - `npm test`（全量）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate vis-1a-route-gate --strict`。
  - 另起独立审查：只给任务书、spec 增量与 diff，不给本设计的结论；逐条处理审查意见。
  - 发现 spec 没覆盖的对外行为时先补 spec 增量再改代码。
  - verify：全部通过；审查结论与处理写进报告。

## 7. 收尾

- [ ] 7.1 写 `docs/QINGYAN_VIS-1a_REPORT.md` 并更新 TASKFLOW：
  - 报告内容：基线与改动后测试数、受影响岗位的放行 / 302 表、侧栏快照差异、构建输出、design「审核关注点」Q1–Q9 的拍板结果、已知仍会弹回的站内链接、合并后生产核对清单。
  - TASKFLOW：`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase V 的 VIS-1a 状态列改为 `[G]（change vis-1a-route-gate；待合并）`；任务描述若与拍板后的实际交付不一致（如 Q1、Q2 的结论），同步改描述。
  - verify：报告文件存在；`git diff docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 只改 VIS-1a 一行。

## Workflow follow-up

- 开 PR（一个 change = 一个 PR），PR 的 Vercel Preview 部署必须成功；合并前确认 Lucas 已完成 `config/positions/sunny.json` 邮箱填实与岗位绑定。
- PR 合并后 `/opsx:archive vis-1a-route-gate --yes`（独立小 PR），同时把 VIS-1a 状态改为 `[x]（#<PR>；archive …）`，并确认 `openspec list --specs` 出现 `navigation/route-gate`。
