# Tasks

## 1. 展示规则（纯函数）

- [x] 1.1 新建 `src/lib/cockpit/presentation.ts`（健康度标签与色调、KPI 格式化、窗口口径、相对时间、操作者、等你 N 件计数文案、岗位名查找）与 `src/lib/cockpit/__tests__/presentation.test.ts`，同一 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：`npx tsx src/lib/cockpit/__tests__/presentation.test.ts` 退出 0，覆盖七种健康度、五种 KPI 格式含 null、四种窗口、相对时间边界。

## 2. 展示组件

- [x] 2.1 新建 `src/components/cockpit/org-cockpit-view.tsx`（`OrgCockpitView` 及横幅、岗位卡片、时间线、加载 / 错误 / 选择组织 / 无权限各状态，均无 hooks）与 `src/components/cockpit/__tests__/org-cockpit-view.test.tsx`（`renderToStaticMarkup` 夹具渲染），并注册。verify：`npx tsx src/components/cockpit/__tests__/org-cockpit-view.test.tsx` 退出 0，覆盖 spec「等你 N 件横幅」「七个岗位卡片」「company.log 时间线」「空态与错误态」「页面只读」的全部 scenario。

## 3. 容器与首页替换

- [x] 3.1 新建 `src/components/cockpit/org-cockpit-home.tsx`（`"use client"`：首屏并发取两个接口、错误映射、加载更多、刷新），`src/app/(main)/page.tsx` 改为渲染 `OrgCockpitHome`（重定向逻辑不动）；在渲染测试里补源码静态断言。verify：渲染测试中静态断言通过（首页保留 `resolveHomeRedirect` 与登录检查、不再引用 `ManagementDashboardClient`；容器只出现 `/api/cockpit/posts` 与 `/api/cockpit/timeline` 两个接口、无非 GET 方法）；`npm run typecheck` 退出 0。

## 4. 视觉核对

- [x] 4.1 离线渲染夹具 + 用 `@tailwindcss/postcss` 编译项目主题样式 + Playwright 截图（夹具外套与 `AppShell` 一致的 240px 侧栏与内容区内边距），宽度 1440 / 1280 / 1024 / 820 / 390。verify：截图生成于 scratch 目录，人工核对后在报告中描述层级与响应式表现（无横向滚动；卡片列数按内容区宽度 3 / 3 / 2 / 1 / 1）。
- [x] 4.2 处理独立交叉审查的应修项：容器两接口各自兜底与过期响应丢弃、时间线单独重试与"加载更多"失败可重试、`errorKindFrom`（401 / 无组织）与 `serverNow` 纯函数、动作数拆分与千分位、container query 列数、可访问性与样式细节；同步 proposal（偏差 2、新增偏差 5 GATE 决策项）、design（D2 / D4）、spec。verify：展示规则测试与渲染测试退出 0；`npx eslint src/components/cockpit src/lib/cockpit/presentation.ts` 无报错；`openspec validate org-cockpit-home --strict` 通过。
- [x] 4.3 处理第二轮交叉审查：取数状态转移抽成纯 reducer `src/lib/cockpit/home-state.ts`（刷新与加载更多交错、旧编号响应丢弃、按 id 去重）+ `src/lib/cockpit/__tests__/home-state.test.ts`，同一 task 注册进两个测试脚本；岗位总览服务端错误不再收起时间线、重试只重载出错的接口；"刷新中"只在最近一次刷新完成时结束；请求 30 秒超时；停用账号错误态；时间线鉴权类错误不给重试；横幅计数千分位；design D3 比率口径。verify：`npx tsx src/lib/cockpit/__tests__/home-state.test.ts` 退出 0 且含"刷新后到达的旧游标结果被丢弃"；`bash scripts/check-test-registry.sh` 只列出 main 上既有的 2 个 trade 测试。

## 5. 门禁

- [ ] 5.1 跑全量门禁。verify：`npm run lint:baseline` 退出 0；`npm run test:ci` 输出 `CI unit subset PASS`；`npm test` 中 A-1 / A-2 / A-3 的新测试全部 PASS，其余失败项与 `origin/main` 基线逐条一致；`git diff --stat origin/main -- prisma/ vercel.json` 为空；`openspec validate org-cockpit-home --strict` 通过。

## 6. 收尾

- [ ] 6.1 写 `docs/QINGYAN_ORG_COCKPIT_A-3_REPORT.md`（做了什么 / 怎么验 / 截图说明 / 与任务书的偏差 / 交叉审查发现与处理 / staging 待验项）+ 更新 TASKFLOW 状态列（`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase A 表 A-3 → `[G]`）。verify：报告文件存在；`grep -n "^| A-3 " docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` 的状态列为 `[G]`。

## Workflow follow-up

- GATE-A（A-1 ~ A-3）在 staging：以 `seed:org:sunny-home-deco` 管理员登录，首页一屏可见 7 个岗位、心跳时间与健康色，"等你 N 件"与 `/capabilities/approvals` 待我审批 + `/workforce` 需要你一致；跑 Lighthouse 确认首屏 2 个 API 请求。
- PR（base = `claude/org-cockpit-read-model`）合并后再 `/opsx:archive org-cockpit-home --yes`（独立小 PR），A-3 状态列改为 `[x]`。
- 另开 change 清理未引用的 `src/components/dashboard/**`。
