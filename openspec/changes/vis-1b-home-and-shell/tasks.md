# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_VIS-1b_REPORT.md`。开工前先跑 design「验证方式」里 7 个受影响测试，记下基线（2026-11-09：226 / 58 / 139 / 79 / 96 / 63 / 132）。

## 1. 客户端可用的路由门判定

- [ ] 1.1 拆出纯判定并新增客户端钩子：
  - 拆出 `src/lib/navigation/route-gate-core.ts`：门表、匹配、`isRouteAllowed`、`gatePathVariants`、`gateRedirectTarget`、`GATED_TOP_SEGMENTS`。不导入 `next/server`。`route-gate.ts` 重新导出这些，原导入方不变。
  - 新增 `src/lib/navigation/use-navigation-access.ts`：按 design D6 拼与侧栏相同的判定输入，返回 `canOpen(href)`。super_admin 一律 true；输入未就绪一律 false。
  - 先写 `src/lib/navigation/__tests__/entry-visibility.test.ts`：
    - 客户端判定与路由门一致：复用 route-gate 测试的身份与全部登记路径；
    - `route-gate-core.ts` 源码无 `next/server`。
  - 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：`entry-visibility.test.ts`、`route-gate.test.ts`（132，页面快照不变）全过；`bash scripts/check-test-registry.sh` 通过。

## 2. 首页岗位卡

- [ ] 2.1 按跳转页判定岗位卡可见：
  - `posts.ts`：`service` 加字面量 `requiresWechatEntry: true`。
  - `posts-read-model.ts`：`resolveCockpitViewer` 产出判定输入（`ROUTE_GATE_LOADER`）；按 design D1 过滤，只为可见卡取 KPI 与自动化。
  - `src/app/(main)/page.tsx`：管理层零卡时 `redirect("/tasks")`。
  - `org-cockpit-view` 只渲染接口给的卡片。
  - 改测试：`posts.test.ts` 加可见条件表；`posts-read-model.test.ts` 把「七个岗位」改为按身份可见集（Sunny 老板 4 张、梦馨 3 张、super_admin 7 张、只启用 `sales` 企业 0 张），并断言不可见卡的 KPI 加载器未被调用；`org-cockpit-view.test.tsx` 把「七张卡片」改为「按接口返回」，并加零卡跳转的源码断言。
  - verify：三份测试全过。

## 3. 「等你拍板」

- [ ] 3.1 按类型给落点并按落点过滤：
  - `waiting.ts`：新增落点表（spec `cockpit/posts-overview`，用读模型已取到的 PendingAction payload）。审批条目 `href` 取落点，缺 id 时退回 `/capabilities/approvals/<approvalId>`。只计入落点放行的条目。需要你作业只计入可读工作域的（第 4 组函数）。
  - `waiting.test.ts`：把「每条审批 href = 列表页」改为落点表断言，并加 spec 三个场景（折扣 → 报价单、质保 → 会计页、营收脊柱在 Sunny 不列）与作业按可读域过滤。
  - verify：`waiting.test.ts`、`posts-read-model.test.ts` 全过。

## 4. workforce 作业可读域

- [ ] 4.1 按工作域过滤作业：
  - 新增 `src/lib/workforce-runtime/readable-domains.ts`（对照表 + `canReadWorkDomain(domain | null, ctx)`）。
  - `api/workforce/jobs/route.ts` 列表先解析工作域（既有 `resolveEffectiveWorkDomain`，所属项目批量）再过滤；`api/workforce/jobs/[id]/route.ts` 不可读返回 404。
  - 先写 `src/lib/workforce-runtime/__tests__/readable-domains.test.ts`：对照表（bids / ops_staff / sales_rep / owner / super_admin / 解析不出），用注入作业列表测过滤，源码断言详情接口走同一函数。注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：该测试全过；`bash scripts/check-test-registry.sh` 通过。

## 5. 侧栏、底栏与站内链接

- [ ] 5.1 改侧栏、底栏与站内链接：
  - `registry.ts`：`work-ai-jobs`、`work-assistant` 去掉 `salesWorkspaceVisible`。
  - `mobile-tab-bar.tsx`：每个页签按 `canOpen` 出现，布局判定不变。
  - 按 design D11 收掉站内链接：`blinds-orders/[id]/page.tsx`、`blinds-orders/[id]/edit/page.tsx`、`assistant/digital-employee-workbench.tsx`、`tasks/tasks-classic.tsx`。
  - 改测试：
    - `position-nav.test.ts`：`SALES_SIDEBAR` 去两项，`OWNER_SIDEBAR` 与旧模式 sales 期望同步，其余快照不变。
    - `navigation-ia.test.ts`：旧模式销售不再含 `/assistant`。
    - `route-gate.test.ts`：Lynn 的 `/workforce`、`/assistant`、`/inbox` → `/sales/home`。
    - `entry-visibility.test.ts`：底栏页签表（出单无「AI」、会计无「招投标」、底栏「招投标」与侧栏一致）、站内链接目标判定，以及四处接线的源码断言。
    - 同步 position-nav 里对 `mobile-tab-bar.tsx` 的源码正则。
  - verify：上述测试全过。

## 6. 索引页与帮助地图

- [ ] 6.1 让索引页与帮助地图按可见入口生成：
  - `types.ts` 加 `description?: string`，注册表 72 项各写一句（不超过 40 字）。
  - `help/page.tsx` 按 design D9 从可见导航树生成功能地图，删 `ROUTES` 与 `PROJECT_AUDIT` 引用。
  - `operations/page.tsx` 按 D8 过滤卡片并加空态。
  - `entry-visibility.test.ts` 加：72 条说明非空且不超过 40 字；地图生成纯函数对 `sales_rep` 的结果等于其侧栏可见入口；`ops_staff` 的索引卡片 9 张、不含投标业务档案；两页源码不再含 `ROUTES` / `PROJECT_AUDIT`。
  - verify：`entry-visibility.test.ts` 全过；`npm run typecheck` 通过（容器内 `NODE_OPTIONS=--max-old-space-size=8192`）。

## 7. 门禁

- [ ] 7.1 跑整体门禁并做独立审查：
  - `npm run test:ci`、`npm test`（13 个环境类失败需在 `origin/main` 上复现同样失败）、typecheck、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx next build --webpack`、`openspec validate vis-1b-home-and-shell --strict`。
  - 另起独立代码审查：只给任务书、spec 增量与 diff，不给 design；逐条处理。
  - 发现 spec 没覆盖的对外行为时先补 spec 增量。
  - verify：全部通过；审查结论与处理写进报告。

## 8. 收尾

- [ ] 8.1 写 `docs/QINGYAN_VIS-1b_REPORT.md` 并更新 TASKFLOW：
  - 报告内容：基线与改动后测试数、按身份的卡片 / 等你拍板 / 底栏 / 帮助地图对照表、侧栏快照差异、design「审核关注点」Q1–Q7 的拍板结果、合并后生产核对清单。
  - TASKFLOW：`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 VIS-1b 状态列改为 `[G]（change vis-1b-home-and-shell；待合并）`。
  - verify：报告文件存在；`git diff docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 只改 VIS-1b 一行。

## Workflow follow-up

- 一个 change = 一个 PR；合并后 `/opsx:archive vis-1b-home-and-shell --yes`（独立小 PR），VIS-1b 状态改为 `[x]（#<PR>；archive …）`。
