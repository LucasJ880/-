# Design：首页、底栏、索引页按同一张表（VIS-1b）

动机见 proposal.md「Why」，对外行为见各 spec 增量。本设计建立在 VIS-1a 之上：路由门 `src/lib/navigation/route-gate.ts`（门表、`isRouteAllowed`）与共享判定输入 `src/lib/navigation/context-server.ts`（`loadOrgNavigationInputs`、`ROUTE_GATE_LOADER`）。

## Context

现状（2026-11-09 在 `claude/vis-1b-home-and-shell` 上核对，基线为 VIS-1a 合并后的 main 加 #395 归档）：

- **岗位卡**：`POST_REGISTRY`（`src/lib/cockpit/posts.ts:95-263`）七项，每项一个 `nav`。`posts-read-model.ts:257` 对全部七项组装并取 KPI。`CockpitViewer` 只有 `{user, orgId, orgRole}`：`resolveCockpitViewer` 会读岗位键与岗位模式，但只用来过管理层门，不往下传。注册表模块有「无运行时导入」的规格约束（`cockpit/post-registry`「岗位注册表是代码事实」）。
- **「等你拍板」**（`waiting.ts`）：
  - 来源：审批中心「待我审批」同口径的条目，加上全组织 `needs_you` 的 workforce 作业。
  - 落点：审批条目一律跳 `/capabilities/approvals`（`waiting.ts:175,217`，测试 `waiting.test.ts:149` 锁定），作业跳 `/workforce/<id>`。
  - 归属：Sunny 原生审批（`sales.approve_quote_promotion`、`sales.update_quote_settings`、`sales.update_signed_quote`）按既有规则归在 `inbound_sales`，即梦馨的「询盘销售」卡下。
- **工作域**：解析规则在 `src/lib/workforce-runtime/work-domain.ts`（显式 > 所属项目 > 历史销售工具证据 > 解析不出）。作业列表接口（`api/workforce/jobs/route.ts`）只按企业过滤。
- **手机底栏**（`mobile-tab-bar.tsx`）：自己请求 `/api/auth/active-org`，用 `workspace-policy` 的函数判定页签（招投标用 `canAccessBidWorkspace`，AI 用「默认落地是 `/`」，助手无条件），不走导航注册表。
- **`/operations` 索引与 `/help`**：都是服务端静态清单。`/help` 有 9 行 `ROUTES` 和 `docs/PROJECT_AUDIT.md` 引用；注册表 `NavigationItem` 没有说明字段。注册表 71 项加系统底栏 1 项，共 72 项。
- **`route-gate.ts` 导入 `next/server`**：客户端组件不能直接用。侧栏、抽屉菜单、底栏各自请求 `/api/auth/active-org`，各自拼判定输入。

规划期探针（scratchpad，不进仓库）按现有代码与上面规则算出的可见集：
- Sunny 老板（微信关）：卡 = 投标、营销增长、项目交付、内容；
- 梦馨 Cathy：卡 = 询盘销售、营销增长、内容；
- 平台 super_admin（微信开）：卡 = 全部七张；
- 只启用 `sales` 的企业老板：卡 = 空；
- 出单：底栏无「AI」；
- `ops_staff` 的 `/operations` 索引：9 张卡片，不含投标业务档案。

## Goals / Non-Goals

**Goals:**

- 首页卡片、「等你拍板」落点、底栏页签、索引页、帮助地图、站内链接，全部用路由门的判定（同一门表、同一输入）回答「这个入口对我放行吗」，不再各写规则。
- 客户端有一个可复用的判定钩子。

**Non-Goals（不动的模块 / 文件）：**

- `src/components/sidebar.tsx`、`mobile-nav-drawer.tsx`：不改用新钩子。它们已用 `resolveNavigationTree` 与同一 active-org 输入，行为一致。
- `src/lib/navigation/filter.ts`：判定函数不改。
- 路由门门表（`route-gate.ts` 的 `ROUTE_GATE_TABLE`）：规则不改，只拆文件。页面 → 规则快照不变，测试断言之。
- 首页时间线（`/api/cockpit/timeline`、company.log）、工作量面板（`/api/cockpit/workload`）、岗位日报（post-daily-digest）：不改。
- 审批中心（`/capabilities/approvals`）的可见集合与 `src/lib/capabilities/approvals/query.ts`：VIS-1d。
- `src/app/(main)/settings/page.tsx` 卡片、`header.tsx` 搜索、通知类型、AI 工具表：VIS-1c。
- `src/lib/workforce-runtime/work-domain.ts` 的解析规则：只调用，不改。
- `/help` 页除功能地图与 `PROJECT_AUDIT` 引用外的其余段落：不动。

## Decisions

### D1 卡片可见 = 跳转页经路由门放行（+「客服」要微信开关）

卡片可见条件 = `isRouteAllowed(card.nav, ctx)`；平台 super_admin 视为放行。`service` 另带字面量标记 `requiresWechatEntry: true`，开关不为 true 时不可见。可见判定写在读模型里，不写在注册表，以守住注册表「无运行时导入」。

被否决：按任务书原话给每张卡补 `moduleKey` + `positionPermissions`。那是第二套规则，会与跳转页的门规则漂移。例如「投标」卡若只认 `bids` 键，就与侧栏「招投标中心」对老板可见冲突（判断点 3 / VIS-1a Q10）。

### D2 读模型拿到完整的判定输入，只为可见卡取数

`resolveCockpitViewer` 额外产出 `NavigationFilterContext`。来源与中间件相同：`ROUTE_GATE_LOADER.loadUser` / `loadContext`，按 `(userId, orgId)` 有 30 秒缓存。`assemblePostsCockpit` 先按 D1 过滤，`loadPostKpis` 与自动化健康只对可见卡调用。

被否决：读模型自己再查一遍岗位键与模块。这是第三份输入，正是 VIS-1a 要消除的。

### D3 首页零卡 → `/tasks`

`page.tsx` 在管理层分支里用与 D1 相同的可见岗位函数计算；为空时 `redirect("/tasks")`。

被否决：
- 渲染空壳：任务书明确不要。
- 跳默认工作区：对管理层，默认工作区就是 `/`，会循环。

### D4 「等你拍板」按类型给落点，落点放行才列（Q1）

新增落点表，每种 PendingAction 类型对应一个页面与 payload 里的 id 字段，见 spec `cockpit/posts-overview`。审批条目的 `href` 取落点；没有对应 id 时退回 `/capabilities/approvals/<approvalId>`。条目只在落点对调用者放行时计入 `total` 与 `items`。审批详情页对全部企业成员放行（VIS-1a），所以退回详情的条目不会因此被过滤；真正被滤掉的是落点在不可用模块里的条目，例如 Sunny 的 `revenue_spine.*`。

被否决：任务书写的「与可见岗位卡的 `pendingActionTypes` 取交集」。Sunny 原生的折扣 / 签约改价审批归在不可见的「询盘销售」卡下，取交集会把老板自己的待批藏掉。归属规则是 A-1 的规格，本 change 不改它（只影响卡片计数，不影响列不列）。

### D5 workforce 作业按「工作域 → 导航入口」判定可读（Q2）

新增 `src/lib/workforce-runtime/readable-domains.ts`。对照表与 spec `agents/workforce-job-scope` 一致：投标随 `ws-bids`，交付随 `ws-ops` 或 `nav-projects`，销售随 `sales-home`，通用随 `work-ai-jobs`；解析不出的随管理层（`isManagementWorkspaceUser`）；super_admin 全部可读。

各处如何用：
- 列表接口：先取一页作业，再用既有 `resolveEffectiveWorkDomain` 解析每条的工作域（所属项目批量查），过滤后返回。计数与分页按过滤后的结果。
- 详情接口：不可读返回 404。
- 「等你拍板」的作业：同一函数。

被否决：
- 按可见岗位卡的 `workDomains` 过滤（任务书原话）。销售域归在「询盘销售」卡下，Sunny 老板会丢掉自己企业的销售域作业。
- 在数据库层按 `metadata.workDomain` 过滤。缺显式标记的旧作业要经项目或工具证据才能解析，数据库层做不到。

### D6 拆出客户端可用的路由门判定 + 钩子

纯判定部分搬到 `src/lib/navigation/route-gate-core.ts`，不导入 `next/server`：门表、匹配、`isRouteAllowed`、`gatePathVariants`、`gateRedirectTarget`。`route-gate.ts` 只留请求处理、TTL 缓存与 `NextResponse`，并重新导出 core，原有导入方不变。

新增客户端钩子 `src/lib/navigation/use-navigation-access.ts`：
- 输入：`/api/auth/active-org`（已返回模块、岗位键、岗位模式、工作区、投标能力信号）、`useCurrentUser`（平台角色、Autopilot）、`useWechatEntryEnabled`。拼出与侧栏相同的 `NavigationFilterContext`。
- 返回 `canOpen(href)`：super_admin 一律 true；输入未就绪时一律 false。

被否决：
- 客户端直接导入 `route-gate.ts`：会把 `next/server` 拖进客户端包。
- 每个组件自己拼输入：现在已有三份重复，再加更多会漂移。

### D7 底栏页签逐个 `canOpen`

`mobile-tab-bar.tsx` 的布局判定（销售 / 通用）不变。每个页签加 `canOpen(tab.href)`：
- 「招投标」= `canOpen("/bids")`，即与侧栏 `ws-bids` 同判定；
- 「AI」= `canOpen("/capabilities")`；
- 「助手」= `canOpen("/assistant")`；
- 销售布局的「首页 / 客户 / 报价 / 日历」同样逐个判定。

被否决：只改「招投标」一项（任务书原话）。「AI」页签也会把出单与无岗位成员带到被拦的页面（VIS-1a 报告 §8）。

### D8 `/operations` 索引按放行过滤

服务端页面用 `ROUTE_GATE_LOADER` 取当前用户输入，卡片清单不变，逐张按 `isRouteAllowed(card.href)` 过滤；一张都不放行时显示「暂无可用的运营入口」。

被否决：改成从导航注册表生成卡片。索引卡片有导航里没有的条目（营销员工、矩阵、资产等），注册表放不下它们的文案。

### D9 `/help` 功能地图从可见导航树生成

`NavigationItem` 新增可选 `description`，72 项各写一句（不超过 40 字，测试断言非空）。`help/page.tsx` 用 `ROUTE_GATE_LOADER` 的输入调 `resolveNavigationTree([...NAVIGATION_REGISTRY, ...SYSTEM_NAV_ITEMS], ctx)`，按侧栏分组列出「名称 + 说明」。删除 `ROUTES` 与 `PROJECT_AUDIT` 引用。

被否决：说明写进 i18n 文案表。目前标签已有 i18n key，说明没有英文需求（i18n 另立）。

### D10 销售侧栏去「AI 任务」「数字员工」（判断点 5，Q3）

`work-ai-jobs`、`work-assistant` 去掉 `salesWorkspaceVisible`。按 VIS-1a「侧栏可见 ⇔ 放行」，纯销售与旧模式 `sales` 同时失去 `/workforce/**`、`/assistant`、`/inbox`。`/tasks` 的「进入协同空间」（指向 `/assistant`）按 D11 隐藏。

被否决：只去掉 `work-ai-jobs`、保留数字员工。判断点 5 拍板的是两项都去掉；后果写进 Q3 供确认。

### D11 站内链接收口

在 D6 钩子上逐处判断：
- **工艺单详情 / 编辑页**：回列表与删除后跳转，在 `/blinds-orders` 不放行时改去该单客户详情（`order.customerId`），没有客户时去 `/tasks`；收口页签的维修单链接在 `/install/repairs/<id>` 不放行时不渲染。
- **数字员工工作台**：客户提醒、「打开销售工作区」「创建报价」逐个 `canOpen`。
- **`/tasks` 的「进入协同空间」**：`canOpen("/assistant")`。

被否决：留着链接让路由门弹回。这正是任务书说的「点进去被弹回」。

## 与八条硬纪律的关系

1. 零 schema：不改 Prisma。新字段（`description`、`requiresWechatEntry`）都是代码常量；工作域解析读既有 `AgentRun.metadata`。
2. 出站先审批：不涉及。审批条目只改落点链接，不改审批流程。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及。落点链接只带实体 id；「等你拍板」的标题与摘要沿用既有脱敏。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：落点表、工作域对照都是查表，零 LLM 调用。
8. 测试注册：新增 `entry-visibility.test.ts`、`readable-domains.test.ts`，在各自 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过。

## Risks / Trade-offs

- [首页接口多一次判定输入解析] → 走 `ROUTE_GATE_LOADER` 的 30 秒缓存，同一用户通常已被中间件缓存过。
- [作业列表逐条解析工作域] → 每页最多 50 条，所属项目一次批量查询。
- [客户端钩子在输入到达前一律不显示入口，底栏首帧可能少几个页签] → 与侧栏现状一致（侧栏同样等 active-org）；spec 要求「不先显示后消失」。
- [梦馨老板首页从 7 张卡变 3 张] → 与其模块一致（无 `bids` / `projects` 模块）；Q4 请确认。
- [销售失去 `/assistant`] → Q3。
- [`waiting.test.ts:149`「每条审批 href = 列表页」等既有断言要改] → 改为落点表断言；`org-cockpit-view.test.tsx`「七张卡片」改为按接口返回渲染。

## 验证方式

基线（2026-11-09，`claude/vis-1b-home-and-shell`）：

| 测试 | 通过数 |
|---|---|
| `posts.test.ts` | 226 |
| `waiting.test.ts` | 58 |
| `posts-read-model.test.ts` | 139 |
| `org-cockpit-view.test.tsx` | 79 |
| `position-nav.test.ts` | 96 |
| `navigation-ia.test.ts` | 63 |
| `route-gate.test.ts` | 132 |

新测试：
- `src/lib/navigation/__tests__/entry-visibility.test.ts`：客户端判定与路由门一致、底栏页签、索引页卡片、帮助地图、72 条说明、站内链接目标。
- `src/lib/workforce-runtime/__tests__/readable-domains.test.ts`：对照表、列表过滤、详情 404。

门禁：
- `npm run test:ci`、`npm test`（注意 13 个环境类失败）、`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx next build --webpack`。
- `openspec validate vis-1b-home-and-shell --strict`。

## 审核关注点（偏离或补充任务书之处，请拍板）

- Q1（D4）：「等你拍板」按「落点放行」过滤，而不是任务书写的「与可见岗位卡取交集」，否则老板自己的折扣审批会被藏掉。
- Q2（D5）：workforce 可读域按「工作域 → 导航入口」判定，而不是任务书写的「按可见岗位卡的 `workDomains`」，否则 Sunny 老板看不到本企业的销售域作业。
- Q3（D10）：判断点 5 的直接后果是纯销售也失去 `/assistant`（数字员工对话）与 `/inbox`。`/tasks` 的「进入协同空间」随之隐藏。若销售仍需要 AI 对话，应只去掉「AI 任务」、保留「数字员工」。
- Q4（D1）：梦馨老板 Cathy 的首页从 7 张卡变为 3 张（询盘销售、营销增长、内容），因为梦馨未启用 `bids` / `projects`、微信开关关闭。
- Q5（D1）：卡片可见规则用「跳转页放行」，不在卡上补 `moduleKey` / `positionPermissions`。
- Q6（D3）：管理层零卡时首页 302 到 `/tasks`。
- Q7：Bob（`owner`）首页保留「投标」卡与底栏「招投标」，与判断点 3、VIS-1a Q10 一致；任务书验收写的「持 bids 键时」以此为准。
