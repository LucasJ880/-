# Design

## Context

- `src/app/(main)/page.tsx` 是服务端组件：`resolveWorkspaceContextFromCookies()` 无会话 → `redirect("/login")`；`resolveHomeRedirect(ctx)` 非空 → 重定向（非管理层去 `/ops`、`/bids`、`/sales/home`、`/tasks` 等）；否则渲染客户端组件 `ManagementDashboardClient`。`resolveHomeRedirect` 用的管理层判定与 A-2 接口的 `canAccessManagementWorkspace` 是同一个函数。
- `ManagementDashboardClient` 及 `src/components/dashboard/**` 只被首页引用。其能力在别处仍有入口：秘书简报（`/assistant` 数字员工工作台、销售 AI 提醒面板）、日历（`/sales/calendar`）、任务（`/tasks`）。
- 客户端统一用 `apiFetch`（`src/lib/api-fetch.ts`，带 cookie、401 跳登录）。`/api/cockpit/*` 不在 `ORG_SCOPED_API_PREFIXES` 中，所以请求里不带 `orgId`；服务端按数据库里的活动组织解析，与 `/workforce` 页面一致。
- A-2 的响应形状见 `src/lib/cockpit/posts-read-model.ts`（`PostsCockpitResponse` / `CompanyLogResponse`）与 `timeline.ts`（`TimelineEntry`）。
- 视觉规范 `DESIGN.md`，已落成 `globals.css` 主题 token：页面宣纸 `#f2f0eb`、卡片玉白 `bg-card`、半透明边框 `border-border/60`、文字 `text-foreground` / `text-muted`、语义色 `bg-success-bg text-success` 等、黛青 `accent` 只用于交互；字重最高 600；可交互元素最小 44px；8px 网格。仓库已有 `PageHeader`、`StatusBadge`（tone：neutral / info / success / warning / danger）、`EmptyState`，并有 workforce 页的骨架屏、错误态、加载更多范式。
- 仓库已有组件服务端静态渲染测试先例：`src/components/assistant/__tests__/followup-outcome-render.test.tsx`（`renderToStaticMarkup`，tsx 运行），并已注册进 test-all 与 test-ci-unit。

## Goals / Non-Goals

**Goals:**
- 首页一屏看完三块：等你 N 件、七个岗位、company.log。数据只来自 A-2 两个接口，首屏两次请求。
- 展示逻辑（色调、格式化、文案）全部在纯函数里，组件渲染可在无浏览器、无数据库的情况下测试。
- 每种加载 / 错误 / 空状态都有明确界面。

**Non-Goals:**
- 不改 `src/lib/cockpit/{posts,schedule,waiting,timeline,posts-read-model}.ts` 与 `src/app/api/cockpit/**`（A-1 / A-2）。
- 不改 `src/app/(main)/layout.tsx`、侧栏、`src/lib/rbac/**`、`src/lib/api-fetch.ts`。
- 不删除 `src/components/dashboard/**`（另开清理 change）；不改 `/assistant`、`/tasks`、`/sales/calendar`。
- 不做轮询 / 推送、移动端专版、工作量面板（A-4）。

## Decisions

### D1 容器与展示分离
- **选择**：`OrgCockpitHome`（`"use client"`）负责取数与状态（loading / error / data / 时间线翻页 / 刷新），把结果交给无状态的 `OrgCockpitView`；`OrgCockpitView` 及其子组件（横幅、岗位卡片、时间线）不含 hooks，用 `renderToStaticMarkup` 即可测试。
- **否决：一个组件里边取数边渲染** —— 服务端静态渲染不执行 effect，只能测到加载态；拆开后展示逻辑可以直接喂夹具测。

### D2 取数：首屏两个并发请求，翻页按需
- **选择**：挂载时两个接口并发（`Promise.all([loadPosts(), loadTimeline()])`），每个接口的请求、状态码、JSON 解析各自兜底，谁先到谁先渲染，一个失败不影响另一个；"加载更多"用 `?cursor=<nextCursor>` 追加；"刷新"重取两者；时间线出错时可只重试时间线。
- **错误映射**（纯函数 `errorKindFrom(status, body)`，在 `presentation.ts`）：401 → `session_expired`（给"重新登录"链接；`apiFetch` 只在响应带 session 标记时自动跳登录）；403 + `needsSelection` → `org_selection`；403 + `error === "无组织"` → `no_org`；403 + `error === "账号已停用"`（`withAuth`）→ `account_disabled`；其他 403 → `forbidden`（非管理层）；其他非 2xx、网络错误、30 秒超时或响应不是 JSON → `server`（可重试）。两处文案做成常量，测试对照 `workforceOrgFailureHttp` 与 `guards.ts` 核对。
- **错误范围**：鉴权类错误（两个接口同一套鉴权）收起整页；岗位总览的 `server` 错误只占岗位区，时间线照常显示；时间线的鉴权类错误只显示原因、不给重试。"重试"只重载出错的那个接口。
- **状态机**（纯 reducer，`src/lib/cockpit/home-state.ts`，表驱动测试覆盖交错顺序）：岗位总览与时间线各存"最近一次请求编号"，编号不等的响应丢弃（首屏慢于刷新时不会覆盖）。"加载更多"的响应只在列表仍停在发请求那一页（`nextCursor` 相同且仍在加载中）时拼接，并按 `id` 去重；期间刷新或单独重试替换了列表，旧游标结果直接丢弃——不会把旧第 2 页拼到新第 1 页后面。"加载更多"失败保留已加载条目，按钮变成"加载失败，点此重试"。"刷新中"只在最近一次刷新完成时结束。
- **页面时钟**：相对时间以服务端 `generatedAt` 为基准（岗位总览未到时先用时间线响应的 `window.to`），加上收到响应后流逝的时间（`serverNow`），避免客户端时钟偏差把过去的事显示成"x 分钟后"；每 60 秒本地走一次，"更新于 x 分钟前"会随时间变旧。不重新请求接口。
- **否决 A：服务端组件里直接调读模型** —— 首页服务端组件解析组织用的是 `resolvePreferredOrgId`（会写库），与 A-2 接口的只读组织解析口径不同，可能出现"首页显示 A 组织、点进去是 B 组织"；统一走接口保证口径一致。
- **否决 B：时间线也首屏拉多页** —— 违反"首屏 ≤ 2 个请求"。

### D3 展示规则放 `src/lib/cockpit/presentation.ts`
- **选择**：健康度 → `{label, tone}`（`failed` 失败 / `quota_hit` 配额已满 → danger；`late` 迟到 / `never_ran` 未运行过 → warning；`on_time` 正常 → success；`not_configured` 未配置 / `n/a` 按需 → neutral）；KPI 格式化（count 千分位、rate ×100 保留一位小数向下取（0.9996 → 99.9%，不会把未满显示成 100%）、percentage_string 原值加 %、minutes 转"x 小时 y 分"、score 取整、null → "—"）；窗口口径（近 N 天 / 本月至今 / 当前 / 全部）；相对时间；操作者（system → 系统、ai → AI、用户 → actorName 或"成员"）；等你 N 件计数文案（截断加 +）。纯函数，测试注册受 `qa/test-registry` 约束。
- **否决：写在组件文件里** —— 组件测试只能间接覆盖分支，且 `src/components/**` 不在测试注册校验范围内。

### D4 布局与样式按 DESIGN.md
- **选择**：`PageHeader`（标题"岗位视图"、生成时间、时区、"心跳与自动化次数为平台级"、刷新按钮）→ 横幅（`bg-card` 卡片，`warning` 色图标，总数大号数字，前 5 条列表，"去审批"链接用 `accent` 底 + `--on-accent` 字色）→ 卡片网格 → 时间线（单列列表，窄屏时间 / 岗位 / 操作者一行、摘要另起一行）。健康度用 `StatusBadge`；卡片整卡是 `Link`（最小高度满足 44px）；字重最高 `font-semibold`（600）。
- **卡片列数按内容区宽度而不是视口**：桌面侧栏固定 240px（`md` 起显示，可折叠到 60px），视口断点会在 1280 宽时只剩约 990px 内容区。用 Tailwind 4 自带的 container query：网格外层 `@container`，`grid-cols-1 @2xl:grid-cols-2 @4xl:grid-cols-[repeat(3,minmax(0,1fr))]`（内容区 ≥ 672px 两列，≥ 896px 三列）。三列和 KPI 行都用任意值写法，避开 `globals.css` 在 768–1024px 视口把 `.grid-cols-3` 强制改成两列的 `!important` 覆盖。KPI 标签最多两行（`line-clamp-2`），悬停 `title` 显示全称。
- **计数**：待审批、需要你、近 7 天次数一律千分位（`formatCount`）。近 7 天的 AI 运行数（按本组织）与自动化运行数（平台级）分两段写，不相加。
- **可访问性**：岗位区有读屏标题（`sr-only` 的 h2），加载中的区域标 `aria-busy`。
- **否决：新建一套颜色 / 组件** —— DESIGN.md 要求复用既有 token；`StatusBadge` 已覆盖五种语义色调。

### D5 视觉核对用离线渲染 + 真实主题样式 + Playwright 截图
- **选择**：在 scratch 目录用 `renderToStaticMarkup(<OrgCockpitView … />)` 渲染夹具，用 `@tailwindcss/postcss` 编译 `src/app/globals.css` 并扫描 `src/components/cockpit/**` 与复用组件得到真实样式，拼成静态 HTML，用预装的 Playwright 截 1280 / 820 / 390 三档宽度。截图随报告给出，不入库。
- **否决：起 `next dev` 登录看真页面** —— 容器无数据库，登录与 A-2 接口都跑不起来；离线渲染能核对布局与样式，真页面的 Lighthouse 留到 staging。

### D6 不在本 change 删除旧仪表盘
- **选择**：只把首页换成新组件，`src/components/dashboard/**` 留作未引用代码，另开清理 change（会给出 `spawn_task` 建议）。
- **否决：同 PR 删除约 20 个文件** —— 与本 change 的可审查性冲突，且这些文件若有并行改动会产生冲突。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 不涉及（纯前端，不碰 Prisma） |
| 2 | 出站先审批 | 遵守：页面零 mutation，不发任何非 GET 请求，审批一律跳 `/capabilities/approvals` 完成 |
| 3 | 禁止第三套队列 | 不涉及（无轮询、无后台任务） |
| 4 | 脱敏 | **触碰**：页面展示的文本全部来自 A-2 已脱敏的字段（标题、摘要、KPI 只含声明指标），页面不自行拼接金额 / 毛利 / 估值 / 报价；渲染测试断言脱敏提示原样显示 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守：展示规则查表，零 LLM 调用 |
| 8 | 测试注册 | **触碰**：`src/lib/cockpit/__tests__/presentation.test.ts` 与 `src/components/cockpit/__tests__/org-cockpit-view.test.tsx` 在各自 task 内注册进 test-all 与 test-ci-unit |

## Risks / Trade-offs

- [旧首页的简报 / 日历 / 任务 / AI 建议入口消失] → D-2 已决定；能力在 `/assistant`、`/sales/calendar`、`/tasks` 仍可用，报告列出供 Evan 知悉。
- [多组织用户：客户端选中的组织（localStorage）与数据库活动组织不一致时，岗位视图显示的是活动组织] → 与 `/workforce` 同口径；页头显示组织 id 对应的时区与生成时间，GATE 时在 staging 验证切换组织后的表现。
- [首屏等待 A-2 接口（KPI 最长 5 秒超时）] → 骨架屏 + 时间线与卡片各自独立加载。
- [旧首页每 5 分钟触发的主动提醒扫描（`POST /api/proactive/scan`）随替换停止；定时任务只覆盖开了自动化偏好的用户] → 新页面只读，不补发；在 proposal 偏差 5 中列为 GATE 决策项，可选后续 change 让定时任务为管理层同步提醒通知（不执行自动动作）。
- [离线截图不等于真页面] → 布局与样式用真实主题编译；交互与数据在 staging 走 GATE-A 第 3 条。

## 验证方式

- `npx tsx src/lib/cockpit/__tests__/presentation.test.ts`：健康度映射、KPI 各格式、窗口口径、相对时间、操作者、计数文案。
- `npx tsx src/components/cockpit/__tests__/org-cockpit-view.test.tsx`：夹具渲染（七张卡顺序与链接、健康度文案与色调类、KPI 数值与"未接入 / 未开启 / 暂不可用"、横幅计数与截断"+"、未归属提示、配额提示、时间线条目与链接、空时间线、脱敏提示原样显示、无"批准 / 驳回 / 执行"按钮）；错误态 / 选择组织态 / 加载态渲染；源码静态断言（首页保留重定向且不再引用旧组件、容器只调用两个接口且只用 GET）。
- 截图：1440 / 1280 / 1024 / 820 / 390 五档，夹具外面套一个与 `AppShell` 一致的 240px 侧栏和内容区内边距，人工核对层级、色调、留白、列数与无横向滚动。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`npm test`（与基线比对）。
- `openspec validate org-cockpit-home --strict`。

## Migration Plan

无数据迁移。合并后管理层打开 `/` 即为岗位视图；回滚 = revert 该 PR（旧组件文件仍在，回滚即恢复旧首页）。
