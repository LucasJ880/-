# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_VIS-1b_REPORT.md`。开工前先跑 design「验证方式」里 7 个受影响测试，记下基线（2026-11-09：226 / 58 / 139 / 79 / 96 / 63 / 132）。

## 1. 客户端可用的路由门判定、落地页与输入拼装

- [x] 1.1 拆出纯判定、落地页函数与输入拼装，并新增客户端钩子：
  - 拆出 `src/lib/navigation/route-gate-core.ts`：门表、匹配、`isRouteAllowed`、`gatePathVariants`、`GATED_TOP_SEGMENTS`。不导入 `next/server`。
  - 新增 `src/lib/navigation/landing.ts`：`isPostVisible`、`visiblePosts`、`resolveLandingPage`（管理层零可见卡 → `/tasks`），并把 `gateRedirectTarget` 搬进来改用它。
  - 新增 `src/lib/navigation/filter-context.ts`：`buildNavigationFilterContext`、`inputsFromActiveOrgResponse`；`context-server.ts` 的 loader 改用前者；active-org 路由的导航字段抽成纯函数 `activeOrgNavigationFields`（15 个响应键不变）。
  - `route-gate.ts` 重新导出 core 与 `gateRedirectTarget`，原导入方不变。
  - 新增 `src/lib/navigation/use-navigation-access.ts`：按 design D7 拼输入，返回 `canOpen(href)` 与 `landingPage`。super_admin 一律放行；输入未就绪时 `canOpen` 一律 false、`landingPage` 为 null。
  - 先写 `src/lib/navigation/__tests__/entry-visibility.test.ts`：
    - 输入拼装与 loader 产出逐字段相同（spec `navigation/entry-visibility`）；
    - 客户端判定与路由门一致：复用 route-gate 测试的身份与全部登记路径；
    - `route-gate-core.ts`、`landing.ts`、`filter-context.ts` 源码无 `next/server`。
  - `route-gate.test.ts` 加「没有可见岗位卡的管理层直接落任务页」（只启用 `sales` 的企业老板敲 `/bids` → `/tasks`）。
  - 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：`entry-visibility.test.ts`、`route-gate.test.ts`（页面快照不变）全过；`bash scripts/check-test-registry.sh` 通过。

## 2. 首页岗位卡

- [x] 2.1 按跳转页判定岗位卡可见：
  - `posts.ts`：`service` 加字面量 `requiresWechatEntry: true`。
  - `posts-read-model.ts`：新增 `resolveCockpitNavContext(viewer)`（`loadOrgNavigationInputs(userId, viewer.orgId)` + `buildNavigationFilterContext`），只由 `/api/cockpit/posts` 调用；按 design D1 过滤，只为可见卡取 KPI 与自动化。时间线与工作量接口不改。
  - `src/app/(main)/page.tsx`：登录检查照旧；判定输入改取 `ROUTE_GATE_LOADER`；`resolveLandingPage(ctx)` 不为 `/` 时跳转（零卡即 `/tasks`）。
  - `org-cockpit-view.tsx`：只渲染接口给的卡片；副标题去掉「七个岗位」；加载骨架改为三张；横幅条目只在岗位出现在 `posts` 里时显示岗位名。
  - 改测试：
    - `posts.test.ts` 加可见条件表；
    - `posts-read-model.test.ts` 把「七个岗位」改为按身份可见集（Sunny 老板 4 张、梦馨 3 张、super_admin 7 张、只启用 `sales` 企业 0 张且落地页为 `/tasks`），并断言不可见卡的 KPI 加载器未被调用；
    - `org-cockpit-view.test.tsx` 把「七张卡片」改为「按接口返回」；`page.tsx` 源码断言改为调用 `resolveLandingPage` 且输入取自路由门 loader；加副标题、骨架与横幅岗位名断言。
  - verify：三份测试全过。

## 3. workforce 作业可读域与「AI 任务」入口

- [x] 3.1 按工作域过滤作业并收窄入口：
  - 新增 `src/lib/workforce-runtime/readable-domains.ts`（对照表 + `canReadWorkDomain(domain | null, ctx)`）。
  - `read-model/list-service.ts`：`listWorkforceJobViews` 加可选可读判定，按 design D5 分批补扫（至多 5 批）、定游标；子行只为返回的作业取。
  - `api/workforce/jobs/route.ts` 与 `jobs/[id]/route.ts`：判定输入取 `loadOrgNavigationInputs(user.id, resolution.orgId)` + `buildNavigationFilterContext`；列表传入判定，详情不可读返回 404。
  - `workforce/page.tsx`：本页为空但 `nextCursor` 非空时保留「加载更多」，不显示空态。
  - `registry.ts`：新增 `POSITION_WORKFORCE`，给 `work-ai-jobs` 加 `positionPermissions`（design D6）。
  - 先写 `src/lib/workforce-runtime/__tests__/readable-domains.test.ts`：
    - 对照表（bids / ops_staff / sales_rep / 梦馨 trade_rep / owner / accounting / installer / fulfillment_vinyl / 无岗位 / super_admin / 通用 / 解析不出）；
    - 「AI 任务」可见 ⇔ 可读域非空（纯销售与旧模式 `sales` 除外），三类已知例外（Sunny 系统 `trade_rep`、梦馨 `project_manager`、梦馨平台角色 `trade` 无岗位）逐条断言；
    - 用注入读取器测过滤、跳过整批、扫描上限、批尾凑满时的游标；
    - 源码断言：详情接口走同一函数，`workforce/page.tsx` 在 `nextCursor` 非空时不渲染空态。
  - 改测试：`position-nav.test.ts` 一线岗位（accounting / installer / fulfillment_* / 无岗位）快照去掉 `work-ai-jobs`；`route-gate.test.ts` 加这些岗位敲 `/workforce` 的落地页。
  - 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：上述测试全过；`bash scripts/check-test-registry.sh` 通过。

## 4. 「等你拍板」

- [x] 4.1 按类型给落点并按落点过滤：
  - `waiting.ts`：
    - 新增落点表（spec `cockpit/posts-overview`，用读模型已取到的 PendingAction payload）；
    - 审批条目带 `sourceType`，无专属落点时 `href` 为 `/capabilities/approvals/${encodeURIComponent(`${sourceType}:${sourceId}`)}`；
    - 只计入落点放行的条目（super_admin 全部放行），截断时按 spec 口径算 `total`；
    - 需要你作业只计入可读的（第 3 组函数）。
  - `waiting.test.ts`：把「每条审批 href = 列表页」改为落点表断言，并加 spec 场景：折扣 → 报价单、折扣设置 → 销售驾驶舱、质保 → 会计页、`grader.email_draft` → 编码后的详情、营收脊柱在 Sunny 不列、截断总数 117、作业按可读域过滤。
  - verify：`waiting.test.ts`、`posts-read-model.test.ts` 全过。

## 5. 侧栏、底栏与站内链接

- [x] 5.1 改侧栏、底栏与站内链接：
  - `registry.ts`：`work-ai-jobs`、`work-assistant` 去掉 `salesWorkspaceVisible`。
  - `mobile-tab-bar.tsx`：改用钩子，每个页签按 `canOpen` 出现，布局判定不变，不再从企业列表回推成员身份。
  - 按 design D12 收掉站内链接：`blinds-orders/[id]/page.tsx`、`blinds-orders/[id]/edit/page.tsx`（返回链：客户详情 → `landingPage`）、`assistant/digital-employee-workbench.tsx`、`tasks/tasks-classic.tsx`、`tender-analysis/agent-card.tsx`（「查看执行详情」）。
  - 改测试：
    - `position-nav.test.ts`：`SALES_SIDEBAR` 去两项，`OWNER_SIDEBAR` 与旧模式 sales 期望同步。
    - `navigation-ia.test.ts`：旧模式销售不再含 `/assistant`。
    - `route-gate.test.ts`：Lynn 的 `/workforce`、`/assistant`、`/inbox` → `/sales/home`。
    - `entry-visibility.test.ts`：
      - 底栏页签表：出单无「AI」，会计无「招投标」，底栏「招投标」与侧栏一致；
      - 站内链接目标与返回链：销售 → 客户详情，会计 → `/accounting`；
      - 五处接线的源码断言。
    - 同步 position-nav 里对 `mobile-tab-bar.tsx` 的源码正则。
  - verify：上述测试全过。

## 6. 索引页与帮助地图

- [ ] 6.1 让索引页与帮助地图按可见入口生成：
  - `types.ts` 加 `description?: string`，注册表 72 项各写一句（不超过 40 字）。
  - `help/page.tsx` 按 design D10 从可见导航树生成功能地图，删 `ROUTES` 与 `PROJECT_AUDIT` 引用。
  - `operations/page.tsx` 按 D9 把卡片改成常量数组，super_admin 全显，其余按 `isRouteAllowed` 过滤，加空态。
  - `entry-visibility.test.ts` 加：
    - 72 条说明非空且不超过 40 字；
    - 地图生成纯函数对 `sales_rep` 的结果等于其侧栏可见入口；
    - `ops_staff` 的索引卡片为 spec 列出的 9 张、不含投标业务档案；super_admin 全部；
    - 两页源码不再含 `ROUTES` / `PROJECT_AUDIT`。
  - verify：`entry-visibility.test.ts` 全过；`npm run typecheck` 通过（容器内 `NODE_OPTIONS=--max-old-space-size=8192`）。

## 7. 门禁

- [ ] 7.1 跑整体门禁并做独立审查：
  - `npm run test:ci`、`npm test`（13 个环境类失败需在 `origin/main` 上复现同样失败）、typecheck、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx next build --webpack`、`openspec validate vis-1b-home-and-shell --strict`。
  - 另起独立代码审查：只给任务书、spec 增量与 diff，不给 design；逐条处理。
  - 发现 spec 没覆盖的对外行为时先补 spec 增量。
  - verify：全部通过；审查结论与处理写进报告。

## 8. 收尾

- [ ] 8.1 写 `docs/QINGYAN_VIS-1b_REPORT.md` 并更新 TASKFLOW：
  - 报告内容：
    - 基线与改动后测试数；
    - 按身份的对照表：卡片、落地页、等你拍板、可读工作域、底栏、帮助地图；
    - 侧栏快照差异（含一线岗位去掉「AI 任务」）；
    - design「审核关注点」Q1–Q10 的拍板结果；
    - 主规格 Purpose 遗留的「七个岗位」；
    - 合并后生产核对清单。
  - TASKFLOW：`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 VIS-1b 状态列改为 `[G]（change vis-1b-home-and-shell；待合并）`。
  - verify：报告文件存在；`git diff docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 只改 VIS-1b 一行。

## Workflow follow-up

- 一个 change = 一个 PR；合并后 `/opsx:archive vis-1b-home-and-shell --yes`（独立小 PR），VIS-1b 状态改为 `[x]（#<PR>；archive …）`。
