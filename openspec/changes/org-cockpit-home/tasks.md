# Tasks

## 1. 展示规则（纯函数）

- [ ] 1.1 新建 `src/lib/cockpit/presentation.ts`（健康度标签与色调、KPI 格式化、窗口口径、相对时间、操作者、等你 N 件计数文案、岗位名查找）与 `src/lib/cockpit/__tests__/presentation.test.ts`，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：`npx tsx src/lib/cockpit/__tests__/presentation.test.ts` 退出 0，覆盖七种健康度、五种 KPI 格式含 null、四种窗口、相对时间边界。

## 2. 展示组件

- [ ] 2.1 新建 `src/components/cockpit/org-cockpit-view.tsx`（`OrgCockpitView` 及横幅、岗位卡片、时间线、加载 / 错误 / 选择组织 / 无权限各状态，均无 hooks）与 `src/components/cockpit/__tests__/org-cockpit-view.test.tsx`（`renderToStaticMarkup` 夹具渲染），并注册。verify：`npx tsx src/components/cockpit/__tests__/org-cockpit-view.test.tsx` 退出 0，覆盖 spec「等你 N 件横幅」「七个岗位卡片」「company.log 时间线」「空态与错误态」「页面只读」的全部 scenario。

## 3. 容器与首页替换

- [ ] 3.1 新建 `src/components/cockpit/org-cockpit-home.tsx`（`"use client"`：首屏并发取两个接口、错误映射、加载更多、刷新），`src/app/(main)/page.tsx` 改为渲染 `OrgCockpitHome`（重定向逻辑不动）；在渲染测试里补源码静态断言。verify：渲染测试中静态断言通过（首页保留 `resolveHomeRedirect` 与登录检查、不再引用 `ManagementDashboardClient`；容器只出现 `/api/cockpit/posts` 与 `/api/cockpit/timeline` 两个接口、无非 GET 方法）；`npm run typecheck` 退出 0。

## 4. 视觉核对

- [ ] 4.1 离线渲染夹具 + 用 `@tailwindcss/postcss` 编译项目主题样式 + Playwright 截 1280 / 820 / 390 三档。verify：三张截图生成于 scratch 目录，人工核对后在报告中描述层级与响应式表现（无横向滚动、卡片列数 3 / 2 / 1）。

## 5. 门禁

- [ ] 5.1 跑全量门禁。verify：`npm run lint:baseline` 退出 0；`npm run test:ci` 输出 `CI unit subset PASS`；`npm test` 中 A-1 / A-2 / A-3 的新测试全部 PASS，其余失败项与 `origin/main` 基线逐条一致；`git diff --stat origin/main -- prisma/ vercel.json` 为空；`openspec validate org-cockpit-home --strict` 通过。

## 6. 收尾

- [ ] 6.1 写 `docs/QINGYAN_ORG_COCKPIT_A-3_REPORT.md`（做了什么 / 怎么验 / 截图说明 / 与任务书的偏差 / 交叉审查发现与处理 / staging 待验项）+ 更新 TASKFLOW 状态列（`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase A 表 A-3 → `[G]`）。verify：报告文件存在；`grep -n "^| A-3 " docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` 的状态列为 `[G]`。

## Workflow follow-up

- GATE-A（A-1 ~ A-3）在 staging：以 `seed:org:sunny-home-deco` 管理员登录，首页一屏可见 7 个岗位、心跳时间与健康色，"等你 N 件"与 `/capabilities/approvals` 待我审批 + `/workforce` 需要你一致；跑 Lighthouse 确认首屏 2 个 API 请求。
- PR（base = `claude/org-cockpit-read-model`）合并后再 `/opsx:archive org-cockpit-home --yes`（独立小 PR），A-3 状态列改为 `[x]`。
- 另开 change 清理未引用的 `src/components/dashboard/**`。
