# Design：首页、底栏、索引页按同一张表（VIS-1b）

动机见 proposal.md「Why」，对外行为见各 spec 增量。本设计建立在 VIS-1a 之上：路由门 `src/lib/navigation/route-gate.ts`（门表、`isRouteAllowed`、`gateRedirectTarget`）与共享判定输入 `src/lib/navigation/context-server.ts`（`loadOrgNavigationInputs`、`ROUTE_GATE_LOADER`）。

## Context

现状（2026-11-09 在 `claude/vis-1b-home-and-shell` 上核对，基线为 VIS-1a 合并后的 main 加 #395 归档）：

- **岗位卡**：
  - `POST_REGISTRY`（`src/lib/cockpit/posts.ts:95-263`）七项，每项一个 `nav`。`posts-read-model.ts:257` 对全部七项组装并取 KPI。
  - `CockpitViewer` 只有 `{user, orgId, orgRole}`：`resolveCockpitViewer` 会读岗位键与岗位模式，但只用来过管理层门，不往下传。
  - 注册表模块有「无运行时导入」的规格约束（`cockpit/post-registry`「岗位注册表是代码事实」）。
- **落地页**：路由门的 `gateRedirectTarget`（`route-gate.ts:267`）对管理层返回 `/`。若首页自己在零卡时再跳 `/tasks`，就是两次跳转，违反 `navigation/route-gate`「一次重定向就停在放行页面」。
- **「等你拍板」**（`waiting.ts`）：
  - 来源：审批中心「待我审批」同口径的条目，加上全组织 `needs_you` 的 workforce 作业。
  - 落点：审批条目一律跳 `/capabilities/approvals`（`waiting.ts:175,217`，测试 `waiting.test.ts:149` 锁定），作业跳 `/workforce/<id>`。
  - 审批 id：条目只存来源 id（`waiting.ts:213`）。详情页用 `parseApprovalId` 解析，要求 `<来源类型>:<来源 id>`（`capabilities/approvals/types.ts:71-87`），既有链接都写成 `encodeURIComponent("PENDING_ACTION:" + id)`。
  - 截断：「待我审批」只取 100 条（`posts-read-model.ts:484`），`total = max(总数, 已取到) + 单独计数的作业`（`waiting.ts:246`）。
  - 归属：Sunny 原生审批（`sales.approve_quote_promotion`、`sales.update_quote_settings`、`sales.update_signed_quote`）按既有规则归在 `inbound_sales`，即梦馨的「询盘销售」卡下。
- **workforce 作业**：
  - 工作域解析在 `src/lib/workforce-runtime/work-domain.ts`（显式 > 所属项目 > 历史销售工具证据 > 解析不出），逐条查库（`work-domain.ts:151-190`），没有批量版本。
  - 作业只有两个创建方：助手跟进固定写 `sales`（`assistant/followup-task.ts:428`），投标触发固定写 `tender`（`tender-workforce/trigger-service.ts:201`）。没有创建方写 `general`；`general` 只会来自缺显式标记、所属项目工作域为默认 `general`（`schema.prisma:262`）的旧作业。
  - 列表：`listWorkforceJobViews`（`read-model/list-service.ts:239`）一次查 `limit + 1` 行做 keyset 翻页，响应只有 `{jobs, nextCursor}`；接口只按企业过滤。
  - 入口：「AI 任务」（`work-ai-jobs`）没有岗位键，岗位模式下对所有非纯销售成员可见，会计、安装工、出单、无岗位成员都能打开 `/workforce`。
- **手机底栏**（`mobile-tab-bar.tsx`）：自己请求 `/api/auth/active-org`，用 `workspace-policy` 的函数判定页签（招投标用 `canAccessBidWorkspace`，AI 用「默认落地是 `/`」，助手无条件），不走导航注册表；成员身份从企业列表回推（`mobile-tab-bar.tsx:111-113`），与服务端口径不同。
- **`/operations` 索引与 `/help`**：
  - 都是服务端静态清单。`/operations` 卡片是页内写死的 `Link`（`operations/page.tsx:47-155`）。
  - `/help` 有 9 行 `ROUTES` 和 `docs/PROJECT_AUDIT.md` 引用；注册表 `NavigationItem` 没有说明字段。注册表 71 项加系统底栏 1 项，共 72 项。
- **`route-gate.ts` 导入 `next/server`**：客户端组件不能直接用。侧栏、抽屉菜单、底栏各自请求 `/api/auth/active-org`，各自拼判定输入。
- **路由门选企业**：`ROUTE_GATE_LOADER.loadContext` 用 `pickGateOrgId` 自己选企业（`context-server.ts:133`），不一定等于驾驶舱当前的 `viewer.orgId`。

规划期探针（scratchpad，不进仓库）按现有代码与本设计的规则算出的结果：
- 岗位卡：
  - Sunny 老板（微信关）= 投标、营销增长、项目交付、内容；
  - 梦馨 Cathy = 询盘销售、营销增长、内容；
  - 平台 super_admin（微信开）= 全部七张；
  - 只启用 `sales` 的企业老板 = 空，路由门当前把他送到 `/`（两跳）。
- 可读工作域：
  - `bids` = 投标、交付；`ops_staff` = 交付；`sales_rep` = 销售；梦馨 `trade_rep` = 销售；
  - Sunny 老板 = 全部；
  - 会计、安装工、出单、无岗位 = 无。
- 落地页：会计 `/accounting`、安装工 `/install`、出单 `/tasks`。
- 会计能开 `/blinds-orders/<id>`，但 `/blinds-orders` 与客户详情都不放行。
- 出单底栏无「AI」；`ops_staff` 的 `/operations` 索引 9 张卡片，不含投标业务档案。

## Goals / Non-Goals

**Goals:**

- 首页卡片、落地页、「等你拍板」落点、底栏页签、索引页、帮助地图、站内链接，全部用路由门的判定（同一门表、同一输入）回答「这个入口对我放行吗」，不再各写规则。
- 客户端有一个可复用的判定钩子，输入拼装与服务端是同一个函数。
- workforce 作业只给读得懂它的人看。

**Non-Goals（不动的模块 / 文件）：**

- `src/components/sidebar.tsx`、`mobile-nav-drawer.tsx`：不改用新钩子。它们已用 `resolveNavigationTree` 与同一 active-org 输入，行为一致。
- `src/lib/navigation/filter.ts`：判定函数不改。
- 路由门门表（`ROUTE_GATE_TABLE`）：规则不改，只拆文件。页面 → 规则快照不变，测试断言之。
- 首页时间线（`/api/cockpit/timeline`、company.log）、工作量面板（`/api/cockpit/workload`）、岗位日报（post-daily-digest）：不改。
- 审批中心（`/capabilities/approvals`）的可见集合与 `src/lib/capabilities/approvals/query.ts`：VIS-1d。
- `src/app/(main)/settings/page.tsx` 卡片、`header.tsx` 搜索、通知类型、AI 工具表：VIS-1c。
- `src/lib/workforce-runtime/work-domain.ts` 的解析规则：只调用，不改，也不做批量版。
- `/help` 页除功能地图与 `PROJECT_AUDIT` 引用外的其余段落：不动。

## Decisions

### D1 卡片可见 = 跳转页经路由门放行（+「客服」要微信开关）

卡片可见条件 = `isRouteAllowed(card.nav, ctx)`；平台 super_admin 视为放行。`service` 另带字面量标记 `requiresWechatEntry: true`，开关不为 true 时不可见（super_admin 也一样）。

判定函数 `isPostVisible` / `visiblePosts` 写在 `src/lib/navigation/landing.ts`，不写在注册表，以守住注册表「无运行时导入」。

被否决：按任务书原话给每张卡补 `moduleKey` + `positionPermissions`。那是第二套规则，会与跳转页的门规则漂移。例如「投标」卡若只认 `bids` 键，就与侧栏「招投标中心」对老板可见冲突（判断点 3 / VIS-1a Q10）。

### D2 读模型用驾驶舱企业的同一份输入，只为可见卡取数

`resolveCockpitViewer` 额外产出 `NavigationFilterContext`：
- 输入取 `loadOrgNavigationInputs(userId, viewer.orgId)`，即驾驶舱当前企业，不走 `ROUTE_GATE_LOADER.loadContext`（它用 `pickGateOrgId` 自己选企业）。
- 再经 D7 的 `buildNavigationFilterContext` 拼成判定输入，与路由门同一个函数。

`assemblePostsCockpit` 先按 D1 过滤，`loadPostKpis` 与自动化健康只对可见卡调用。

被否决：
- 读模型自己再查一遍岗位键与模块。这是第三份输入，正是 VIS-1a 要消除的。
- 直接用 `ROUTE_GATE_LOADER`。多企业成员切换驾驶舱企业时，卡片会按另一家企业的模块算。

### D3 首页与路由门共用落地页函数，零卡 → `/tasks`

`landing.ts` 新增 `resolveLandingPage(ctx)`：
- 先取既有 `resolveHomeRedirect`；
- 返回空（管理层）时，有可见卡为 `/`，零卡为 `/tasks`。

`gateRedirectTarget` 搬进 `landing.ts`，改用它；`(main)/page.tsx` 的管理层分支也用它，零卡时 `redirect("/tasks")`。`route-gate.ts` 重新导出 `gateRedirectTarget`，原导入方不变。spec 增量 MODIFIED `navigation/route-gate`「不放行时 302 到落地页」。

被否决：
- 只在 `page.tsx` 里跳：路由门先把人送到 `/` 再跳一次，两跳，违反路由门规格。
- 渲染空壳：任务书明确不要。
- 跳默认工作区：对管理层，默认工作区就是 `/`，会循环。

### D4 「等你拍板」按类型给落点，落点放行才列（Q1）

新增落点表，每种 PendingAction 类型对应一个页面与 payload 里的 id 字段，见 spec `cockpit/posts-overview`。

落点规则：
- `sales.update_quote_settings` 落 `/sales/cockpit`（折扣设置卡所在页，只对管理层放行，与该审批的审批人一致）。
- 没有专属落点的 PendingAction、payload 缺 id 的条目、ApprovalRequest 与产品内容审批，落审批详情。链接写成 `/capabilities/approvals/${encodeURIComponent(`${sourceType}:${sourceId}`)}`，与审批中心列表、报价审批接口同写法。条目需带 `sourceType` 才能拼出。

过滤：
- 条目只在落点对调用者放行时计入。
- 审批详情页对全部企业成员放行（VIS-1a），所以退回详情的条目不会因此被过滤；真正被滤掉的是落点在不可用模块里的条目，例如 Sunny 的 `revenue_spine.*`。

截断：未取到的「待我审批」行判不了落点，原样计入 `total`，并标 `truncated: true`。`total` = 已取到且放行 + 未取到 + 单独计数的作业。

被否决：
- 任务书写的「与可见岗位卡的 `pendingActionTypes` 取交集」。Sunny 原生的折扣 / 签约改价审批归在不可见的「询盘销售」卡下，取交集会把老板自己的待批藏掉。归属规则是 A-1 的规格，本 change 不改它（只影响卡片计数，不影响列不列）。
- 截断时把未取到的行按 0 计。总数会凭空变小，「等你 N 件」比审批中心少。

### D5 workforce 作业按「工作域 → 导航入口」判定可读（Q2、Q8）

新增 `src/lib/workforce-runtime/readable-domains.ts`，对照表与 spec `agents/workforce-job-scope` 一致：
- 投标随 `ws-bids`；
- 交付随 `ws-ops` 或 `nav-projects`；
- 销售随 `sales-home` 或 `biz-trade`（梦馨外贸员看不到「销售首页」，但「询盘销售」卡挂的就是销售域）；
- 通用与解析不出的随管理层（`isManagementWorkspaceUser`）；
- super_admin 全部可读。

各处如何用：
- **列表接口**：`listWorkforceJobViews` 增加可选的可读判定参数。
  - 每批仍取 `limit + 1` 行，逐行用既有 `resolveEffectiveWorkDomain` 解析工作域并过滤，凑满 `limit` 条或扫满 5 批为止。
  - 游标：凑满时 `nextCursor` 指向本页最后一条，扫满时指向最后扫描的一行。
  - 响应形状不变（`{jobs, nextCursor}`），没有计数字段。
  - 子行（步骤、事件、PendingAction）只为返回的作业批量取。
  - 前端：`/workforce` 页在本页为空但 `nextCursor` 非空时保留「加载更多」，不显示空态。
- **详情接口**：不可读返回 404。
- **「等你拍板」的作业**：同一函数。

被否决：
- 按可见岗位卡的 `workDomains` 过滤（任务书原话）。销售域归在「询盘销售」卡下，Sunny 老板会丢掉自己企业的销售域作业。
- 在数据库层按 `metadata.workDomain` 过滤。缺显式标记的旧作业要经项目或工具证据才能解析，数据库层做不到。
- 过滤后直接返回短页、不补扫。一页可能整页为空却显示「加载更多」，翻很多次才见到一条。
- 批量化解析。要改 `work-domain.ts`，是 Non-Goal；新作业都带显式标记，解析零查询，只有旧作业逐条查。

### D6 「AI 任务」只对有可读工作域的人出现（Q8）

`work-ai-jobs` 新增 `positionPermissions: [...POSITION_WORKFORCE]`，常量取 D5 各入口在岗位模式下认的键的并集：
- 管理键 `organization.dashboard.read`；
- 招投标写键 `project.create` / `project.update`；
- 运营键 `operations.read` / `operations.manage`；
- 销售工作键 `sales.quote.create` / `sales.quote.pricing_close`；
- 外贸键 `trade.read`。

旧模式不读 `positionPermissions`，不变。路由门 `/workforce/**` 规则就是 `work-ai-jobs`，自动跟随。

防漂移：`readable-domains.test.ts` 对每种测试身份（纯销售除外）断言「AI 任务可见 ⇔ 可读工作域非空」。

被否决：
- 给导航项加「任一入口可见即可见」的新字段：要改 `filter.ts` 判定函数（Non-Goal），且侧栏、抽屉、路由门三处都要跟着认。
- 保留入口、列表为空：任务书写明「无可读域的人不见此项」。

### D7 拆出客户端可用的路由门判定、落地页、输入拼装与钩子

文件划分：
- `src/lib/navigation/route-gate-core.ts`：门表、匹配、`isRouteAllowed`、`gatePathVariants`、`GATED_TOP_SEGMENTS`。不导入 `next/server`。
- `src/lib/navigation/landing.ts`：`isPostVisible`、`visiblePosts`、`resolveLandingPage`、`gateRedirectTarget`（导入 core 与 `cockpit/posts`）。
- `src/lib/navigation/filter-context.ts`：
  - `buildNavigationFilterContext(inputs, user, flags)`：`ROUTE_GATE_LOADER.loadContext` 与 D2 都改用它；
  - `inputsFromActiveOrgResponse(body)`：客户端把 active-org 响应还原成同一份输入，成员身份取响应里的 `hasMembership`，不再从企业列表回推。
- `route-gate.ts`：只留请求处理、TTL 缓存与 `NextResponse`，重新导出 core 与 `gateRedirectTarget`，原有导入方不变。

客户端钩子 `src/lib/navigation/use-navigation-access.ts`：
- 输入：`/api/auth/active-org`、`useCurrentUser`（平台角色、Autopilot）、`useWechatEntryEnabled`，经上面两个函数拼出判定输入。
- 返回：
  - `canOpen(href)`：super_admin 一律 true；输入未就绪时一律 false；
  - `landingPage`：未就绪时为 null。

测试防漂移：对同一份企业输入，`buildNavigationFilterContext(inputsFromActiveOrgResponse(activeOrgBody(inputs)), …)` 与 loader 的产出逐字段相同。`activeOrgBody` 是 active-org 路由抽出的纯映射。

被否决：
- 客户端直接导入 `route-gate.ts`：会把 `next/server` 拖进客户端包。
- 每个组件自己拼输入：现在已有三份重复，底栏的成员身份已经和服务端不同。
- 只测 core 函数与自己一致：测不到输入拼装这一真正会漂移的地方。

### D8 底栏页签逐个 `canOpen`

`mobile-tab-bar.tsx` 的布局判定（销售 / 通用）不变。每个页签加 `canOpen(tab.href)`：
- 「招投标」= `canOpen("/bids")`，即与侧栏 `ws-bids` 同判定；
- 「AI」= `canOpen("/capabilities")`；
- 「助手」= `canOpen("/assistant")`；
- 销售布局的「首页 / 客户 / 报价 / 日历」同样逐个判定。

被否决：只改「招投标」一项（任务书原话）。「AI」页签也会把出单与无岗位成员带到被拦的页面（VIS-1a 报告 §8）。

### D9 `/operations` 索引按放行过滤（Q9）

页内卡片改成本地常量数组（`href`、标题、说明、图标），文案不变。服务端页面用 `ROUTE_GATE_LOADER` 取当前用户输入：
- 平台 super_admin 全部显示（`isRouteAllowed` 本身没有 super_admin 放行）；
- 其余逐张按 `isRouteAllowed(card.href)` 过滤；
- 一张都不放行时显示「暂无可用的运营入口」。

被否决：按任务书改成从导航注册表生成卡片。索引卡片有导航里没有的条目（营销数字员工、矩阵账号、视频资产等），注册表放不下它们的文案；从可见导航生成的帮助地图另见 D10。

### D10 `/help` 功能地图从可见导航树生成

`NavigationItem` 新增可选 `description`，72 项各写一句（不超过 40 字，测试断言非空）。`help/page.tsx` 用 `ROUTE_GATE_LOADER` 的输入调 `resolveNavigationTree([...NAVIGATION_REGISTRY, ...SYSTEM_NAV_ITEMS], ctx)`，按侧栏分组列出「名称 + 说明」。删除 `ROUTES` 与 `PROJECT_AUDIT` 引用。

被否决：说明写进 i18n 文案表。目前标签已有 i18n key，说明没有英文需求（i18n 另立）。

### D11 销售侧栏去「AI 任务」「数字员工」（判断点 5，Q3）

`work-ai-jobs`、`work-assistant` 去掉 `salesWorkspaceVisible`。按 VIS-1a「侧栏可见 ⇔ 放行」，纯销售与旧模式 `sales` 同时失去 `/workforce/**`、`/assistant`、`/inbox`。`/tasks` 的「进入协同空间」（指向 `/assistant`）按 D12 隐藏。

被否决：只去掉 `work-ai-jobs`、保留数字员工。判断点 5 拍板的是两项都去掉；后果写进 Q3 供确认。

### D12 站内链接收口

在 D7 钩子上逐处判断：
- **工艺单详情 / 编辑页**：
  - 回列表与删除后跳转，在 `/blinds-orders` 不放行时，先退到该单客户详情（`order.customerId` 存在且 `canOpen` 时），否则退到钩子的 `landingPage`。落地页由路由门保证放行。
  - 收口页签的维修单链接在 `/install/repairs/<id>` 不放行时不渲染。
- **数字员工工作台**：客户提醒、「打开销售工作区」「创建报价」逐个 `canOpen`。
- **`/tasks` 的「进入协同空间」**：`canOpen("/assistant")`。

被否决：
- 留着链接让路由门弹回。这正是任务书说的「点进去被弹回」。
- 客户详情不放行时退到 `/tasks`（初稿写法）。会计有自己的落地页 `/accounting`，退到 `/tasks` 等于丢了上下文。
- 退到「上一页」（`router.back()`）。直接打开详情页时没有上一页，删除后也不该回到已删的单。

## 与八条硬纪律的关系

1. 零 schema：不改 Prisma。新字段（`description`、`requiresWechatEntry`）与 `POSITION_WORKFORCE` 都是代码常量；工作域解析读既有 `AgentRun.metadata`。
2. 出站先审批：不涉及。审批条目只改落点链接，不改审批流程。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及。落点链接只带实体 id；「等你拍板」的标题与摘要沿用既有脱敏。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：落点表、工作域对照、入口键并集都是查表，零 LLM 调用。
8. 测试注册：新增 `entry-visibility.test.ts`、`readable-domains.test.ts`，在各自 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过。

## Risks / Trade-offs

- [首页接口多一次判定输入查询] → 一次 `loadOrgNavigationInputs`（与 active-org 接口同查询）；首页本就只对管理层。
- [作业列表补扫] → 一次请求至多 5 批 × 51 行。新作业带显式工作域，解析零查询；只有旧作业逐条查项目或步骤。扫满仍不满一页时前端保留「加载更多」。
- [「AI 任务」入口与可读域用两种写法表达] → 测试逐身份断言二者等价；新增可读域入口时测试会先红。
- [客户端钩子在输入到达前一律不显示入口，底栏首帧可能少几个页签] → 与侧栏现状一致（侧栏同样等 active-org）；spec 要求「不先显示后消失」。
- [梦馨老板首页从 7 张卡变 3 张] → 与其模块一致（无 `bids` / `projects` 模块）；Q4 请确认。
- [销售失去 `/assistant`；会计、安装工、出单失去 `/workforce`] → Q3、Q8。
- [既有断言要改] → `waiting.test.ts:149`「每条审批 href = 列表页」改为落点表断言；`org-cockpit-view.test.tsx`「七张卡片」改为按接口返回渲染；`position-nav.test.ts` 一线岗位快照去掉 `work-ai-jobs`。
- [主规格 Purpose 里的「七个岗位」] → `cockpit/posts-overview` 与 `cockpit/home-view` 的 Purpose 写着「七个岗位」，归档只合并 Requirement、不改 Purpose，这两句会留在主规格里。规格不手写，留待以后某个改这两份规格的 change 顺手更新；报告里记一笔。

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
- `src/lib/navigation/__tests__/entry-visibility.test.ts`：输入拼装与 loader 一致、客户端判定与路由门一致、底栏页签、索引页卡片、帮助地图、72 条说明、站内链接目标与返回链。
- `src/lib/workforce-runtime/__tests__/readable-domains.test.ts`：对照表、「AI 任务」等价、列表补扫与游标、详情 404。

门禁：
- `npm run test:ci`、`npm test`（注意 13 个环境类失败）、`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx next build --webpack`。
- `openspec validate vis-1b-home-and-shell --strict`。

## 审核关注点（偏离或补充任务书之处，请拍板）

- Q1（D4）：「等你拍板」按「落点放行」过滤，而不是任务书写的「与可见岗位卡取交集」，否则老板自己的折扣审批会被藏掉。
  - 连带后果：`marketing.*`、`grader.*`、`calendar.*` 等没有专属落点的审批退回审批详情，详情页对全体成员放行，所以照样列出。任务书验收里 Bob 的「只列 Sunny 原生审批 + 投标」不会严格成立；收窄要等 VIS-1d 定审批中心可见集合。
- Q2（D5）：workforce 可读域按「工作域 → 导航入口」判定，而不是任务书写的「按可见岗位卡的 `workDomains`」，否则 Sunny 老板看不到本企业的销售域作业。销售域另认「外贸」，否则梦馨外贸员看不到自己的询盘作业。
- Q3（D11）：判断点 5 的直接后果是纯销售也失去 `/assistant`（数字员工对话）与 `/inbox`。`/tasks` 的「进入协同空间」随之隐藏。若销售仍需要 AI 对话，应只去掉「AI 任务」、保留「数字员工」。
- Q4（D1）：梦馨老板 Cathy 的首页从 7 张卡变为 3 张（询盘销售、营销增长、内容），因为梦馨未启用 `bids` / `projects`、微信开关关闭。
- Q5（D1）：卡片可见规则用「跳转页放行」，不在卡上补 `moduleKey` / `positionPermissions`。
- Q6（D3）：管理层零卡时落 `/tasks`，首页与路由门共用这一规则（改动 VIS-1a 已归档的「不放行时 302 到落地页」）。
- Q7：Bob（`owner`）首页保留「投标」卡与底栏「招投标」，与判断点 3、VIS-1a Q10 一致；任务书验收写的「持 bids 键时」以此为准。
- Q8（D5、D6）：通用域与解析不出的作业只对管理层可读；「AI 任务」只对至少可读一个工作域的人出现，会计、安装工、出单与无岗位成员不再看到它。
  - 依据：任务书「无可读域的人不见此项」；通用域在岗位表里归平台专属的「运维与知识」卡；现在没有创建方写 `general`，只有项目默认 `general` 的旧作业会落到这里。
  - 另一选择：通用域对所有能开 `/workforce` 的人可读、入口不收窄。那样一线岗位会看到未分类项目上的全部旧作业。
- Q9（D9）：`/operations` 索引过滤页内静态卡片，不按任务书改为「从可见导航生成」，因为索引卡片多数不在导航里。
