# Design：路由级可见性门（VIS-1a）

动机见 proposal.md「Why」，对外行为见 `specs/navigation/route-gate/spec.md` 与两份 MODIFIED 增量。

## Context

现状（2026-11-08 在代码上核对）：

- `src/app/(main)/layout.tsx` 不做任何判定，只套 `WechatEntryProvider` 与 `AppShell`。
- `src/middleware.ts` 跑在 Edge runtime，只做两件事：按 JWT 拦未登录；按 JWT `role === "sales"` 拦 `/marketing/**`、`/operations/growth/**` 与 `/api/marketing/**`。
- 163 个 `(main)` 页面里：57 个有硬门（41 个经中间层 layout，16 个页面自带）；12 个只在接口 403 后显示错误；94 个除登录外没有门。
- 页面自带的服务端门（`bids`、`accounting`、`ops/**`、`install/**`）都落在 `(main)/loading.tsx` 的 Suspense 边界之内，所以重定向前骨架已经吐给浏览器了。
- 侧栏在客户端用 `/api/auth/active-org` 的返回值调 `isNavItemVisible` 判定。服务端页面另用 `resolveWorkspaceContextFromCookies` 拼判定输入，两份输入不一致：后者没有行业包模块兜底（`withIndustryPackModules`），也没有 `workspaceIds`。

Next 16.2 的两条约束（本仓库版本 `next@16.2.0`），已用最小夹具实测：

1. layout 在站内软导航时不重渲染，也拿不到当前路径。门放在 `(main)/layout.tsx`（任务书原方案）只能管硬加载。
2. `(main)/loading.tsx` 会包住 `(main)/layout` 之下的全部段，包括并行路由槽。门放在任何子段 layout、页面或 `@gate` 槽里，硬加载都会先返回 200 和页面内容，再由流式脚本在客户端跳走。

夹具实测（在 scratchpad 里，不进仓库）：

- 夹具结构：`app/(main)/layout.tsx` 渲染 `{gate}{children}`；`(main)/loading.tsx`；`@gate/[...path]/page.tsx` 对 `/secret` 调 `redirect`；`/home`、`/open`、`/secret`、`/secret/sub` 四个 `"use client"` 页面。
- 结果一：`@gate` 槽方案下，`curl /secret` 返回 200，正文里有 `SECRET-CONTENT`，末尾才是 `<meta http-equiv="refresh">`。
- 结果二：改成 `src/middleware.ts` 并设 `export const config = { runtime: "nodejs" }`，用 `node:fs` 证明确实跑在 Node 上。`curl /secret/sub` 与带 `RSC: 1` 头的请求都直接返回 302 `Location: /home`，正文没有页面内容。Playwright 从 `/home`、`/open` 点链接进 `/secret`，都落在 `/home`，`MutationObserver` 全程没有看到 `SECRET` 出现在 DOM 里。
- 结果三：链接预取请求也会经过中间件（预取头对中间件不可见，无法区分），所以每个预取都会被判定一次。

## Goals / Non-Goals

**Goals:**

- 一个咽喉点：所有 `(main)` 页面请求（硬加载、软导航、预取）在渲染前判定，判定前不出任何页面字节。
- 一份输入：路由门与侧栏用同一个服务端构造器产出的判定输入，口径就是 `isNavItemVisible`。
- 一张表：门表是代码常量；覆盖面由源码断言保证；表外路径 fail-closed。

**Non-Goals（不动的模块 / 文件）：**

- `src/app/(main)/layout.tsx`：不加判定。
- `src/lib/navigation/filter.ts`：`isNavItemVisible` 等判定函数不改，只复用。
- `src/components/sidebar.tsx`、`mobile-nav-drawer.tsx`、`mobile-tab-bar.tsx`：文件不改。但 `mobile-tab-bar.tsx:249` 的「招投标」底栏调用 `canAccessBidWorkspace`，会随 D7 的口径一起变化：会计与出单不再见。这已在 spec `navigation/position-based-visibility`「手机底栏的招投标入口与招投标中心同口径」声明；底栏统一改走侧栏判定属 VIS-1b。
- 全部 `/api/**` 路由的鉴权：不改。`src/lib/marketing/access.ts` 的 `requireMarketingReadAccess`、中间件对 `/api/marketing/**` 的旧模式拦截都保留。
- 既有的同口径 layout 门保留，作纵深防御：
  - `PlatformAdminGate`：`admin/onboarding`、`agent-trace`、`memory`、`capabilities/runs`、`projects/[id]/{agents,feedback-tags,feedbacks,knowledge-bases,prompts,quality,tools}`、`settings/{agent-skills,digital-employees}`。
  - `AutopilotGate`：`ai/autopilot`。
  - COLLAB-1 的 `settings/wechat/layout.tsx`、`wechat/layout.tsx`。
- `src/lib/rbac/resolve-workspace-context.ts`：不改，首页 `/` 等服务端页面继续用它。
- `src/lib/authorization/role-defaults.ts`：岗位模板不改（判断点 4：老板外贸三键靠模块门挡）。
- `src/lib/permissions-client.ts` 的 `canAccessModule`：无调用方，不动。
- `src/lib/tender/detail-tabs.ts`：判断点 7，不动。

## Decisions

### D1 门放在 Node.js runtime 的中间件里

`src/middleware.ts` 的 `config` 加 `runtime: "nodejs"`。登录校验之后，对需要判定的页面请求调路由门：不放行就 `NextResponse.redirect(target, 302)`。302 已在夹具里实测（硬加载与软导航都生效）。

被否决的备选：

- 门放在 `(main)/layout.tsx`（任务书原方案）：拿不到路径，软导航不重渲染，只能管硬加载。
- 每个门表前缀放一个服务端 layout 或页面门：一是落在 `loading.tsx` 之内，先出骨架再跳（夹具结果一同理）；二是要新增约 80 个样板文件；三是父段 layout 在软导航间保持不变，「从子段回到父段根页面」时不会重新判定。
- `@gate` 并行路由槽：夹具结果一，页面内容先进 HTML。
- 保留 Edge 中间件，另签一枚「允许条目快照」cookie：要新增 cookie、过期刷新与权限变更后的失效机制，复杂度高于收益。
- 顺手把文件改名为 Next 16 的 `proxy.ts`：同为 Node runtime，收益只是去掉弃用告警，却要改动若干读 `src/middleware.ts` 源码的既有断言，留到以后。

### D2 判定输入只有一个构造器

中间件只做胶水，判定入口是 `route-gate.ts` 导出的请求处理函数。它接收 `NextRequest` 与一个可注入的判定输入加载器，返回「放行」或 302 响应，所以测试不连库也能断言 HTTP 层行为（状态码、`Location`、正文、响应头）。

新增服务端模块 `src/lib/navigation/context-server.ts`，按 `(userId, 平台角色)` 产出 `NavigationFilterContext`（不含 `pathname`）。字段与来源：

| 字段 | 来源 |
|---|---|
| 当前企业 | `resolvePreferredOrgId` |
| `modules` | `withIndustryPackModules(parseOrgModulesJson(modulesJson), industryPackId)` |
| `positionMode` | `hasPositionTemplates(industryPackId)` |
| `permissionKeys` | `resolveEffectiveBindings` 的 ALLOW 键 |
| `orgRole` / `hasMembership` | 仅 active 成员 |
| `workspaceIds` | 当前企业 active 的工作区成员关系 |
| `hasBidCapability` | 当前企业内 active 的项目成员关系 |
| `isPlatformAdmin` | `role === "super_admin"` |
| `autopilotAllowed` | `hasAutopilotCapability(user, "autopilot.view")`，与 `/api/auth/me` 同 |
| `wechatEntryEnabled` | `isWechatBindingEnabled()` |

`/api/auth/active-org` 改为调用它取这些字段，响应 JSON 字段与取值不变。

被否决：路由门直接复用 `resolveWorkspaceContextFromCookies`。它读 `next/headers` 的 cookies，中间件里用不了；又缺行业包模块兜底与 `workspaceIds`，会与侧栏判定不一致，正是要消除的东西。

### D3 每个页面请求都判定，进程内缓存 30 秒

预取也经过中间件（夹具结果三）。一个页面有 N 个侧栏链接，就会触发 N 次判定，每次要 6–8 次查询。处理办法：

- 先查门表。命中「登录即可」或「不经路由门」（`/api/**`、免登录路径、末段带扩展名的静态文件、`/login`、`/register`、`/select-org`、Sentry 隧道 `/monitoring`）的请求不查库。
- 其余请求每次都要：校验 JWT（不查库）、查用户状态与平台角色、解析当前企业 id，各一次轻查询。切换企业因此立即生效。
- 其余判定输入按 `(userId, orgId)` 在进程内缓存 30 秒，最多 500 条，超出时淘汰最旧的。
- 构造器抛错时 fail-closed：302 到 `/tasks`，并打一条服务端日志（spec「判定输入取不到时一律拒绝」）。

spec「判定时效」把这 30 秒写成了对外承诺。

被否决：

- 不缓存：预取风暴会把每次页面加载放大成上百次查询。
- 缓存放 cookie：与 D1 的快照方案同理。
- TTL 拉长到分钟级：撤岗后的滞后超出可接受范围。

### D4 门表结构与对象详情页

条目格式为「路径模式 → 导航项 key 列表（任一可见即放行）」或「登录即可」。路径模式按段匹配：`*` 匹配一段，结尾 `=` 表示只匹配本路径。多条命中时取最具体的：字面段优先于 `*`，长前缀优先于短前缀。

判定某导航项时，连同它的父链一起要求可见（`cap-approvals` 这类子项本身不带限制，靠父项「AI 工作中心」）。

门表条目另有一个可选标记「项目成员也放行」，只用于 `/projects/*`：成员身份有效且当前企业内有 active 项目成员关系（即 `hasBidCapability`）时直接放行。这是门表唯一一处不经导航项的条件，因为「是项目成员」无法用岗位键表达；项目内能看到什么仍由 `requireProjectReadAccess` 等接口按项目判定。

无侧栏入口的路由在 `src/lib/navigation/registry.ts` 新增 `ROUTE_ONLY_NAV_ITEMS` 登记。这些条目只做门、不进侧栏，由同一个 `isNavItemVisible` 判定。

被否决：

- 正则门表：难以对 163 个页面做覆盖断言。
- 给个别路由写自定义判定函数：等于第二套规则。

对象详情页的放行面按站内链接与通知来源（`notificationHref` 是唯一的通知跳转表）决定：

| 门条目 | 放行键（岗位模式） | 谁会被带过去（来源） |
|---|---|---|
| `/blinds-orders/*` | `orders.fulfillment.read` / `sales.order.create` / `install.task.assign` / 销售工作键 / 管理层，`window_covering` 模块，销售侧栏可见 | 销售：`sales/quote-sheet/page.tsx:2147`、`sales/customers/[id]/orders-list.tsx:22`、`sunny-process/autogen.ts:268`、`install/balance.ts:203`；订单阶段通知收件人（`src/lib/notifications/collab/recipients.ts:80-88`：创建人、商机负责人、出单、安装派工） |
| `/projects/*`（详情及子页） | `project.read` / `project.create` / `project.update` / `operations.read` / `operations.manage` / 管理层，或「项目成员也放行」，`bids` 或 `projects` 模块 | 运营：`ops/delivery-project-detail.tsx:317/333`、`operations/projects/query.ts:422`、`operations/dashboard/build-dashboard.ts`；任务抽屉；带 `projectId` 的通知（`href.ts:38-45`） |
| `/sales/customers` | 销售工作键 / `trade.read` / 管理层，`sales` 模块，销售侧栏可见；旧模式含平台角色 `trade` | 外贸：`src/app/(main)/trade/convert-trade-quote-to-sales-dialog.tsx:129/159`、`trade/prospects/[id]/page.tsx:919`；`sales_customer` 通知 |
| `/capabilities/approvals` | 企业成员，销售侧栏可见（分组 `WORK`，不受旧模式「AI 工作中心整组隐藏」影响） | 招投标与运营工作台：`bids-workspace-shell.tsx:39`、`ops-workspace-shell.tsx:350/456`；RFQ 抽屉 `tender-rfq/web-entry-approval.ts:34`；`approval` 通知（`href.ts:50`） |

| `/projects/*/{agents,prompts,tools,knowledge-bases,feedbacks,feedback-tags,quality}` | 平台 super_admin | 与这些子页既有的 `PlatformAdminGate` 同口径；单独登记，否则会被上一行放宽 |
| `/sales/calendar` | 侧栏「日历」可见，或持 `install.task.update`（`window_covering` 模块） | `installation/install-tasks`「安装工在既有日历页 SHALL 能看到分配给自己的安装预约」 |
| `/sales/website-bookings` | `sales.customer.create` / `sales.customer.read` / 管理层，`sales` 模块，销售侧栏可见 | `calendar/website-booking-intake`「页面对有查看权的成员」；接口口径是任意范围的 `sales.customer.create` 或全企业范围的 `sales.customer.read`（`api/sales/website-bookings/route.ts:5`），门只看持键，范围仍归接口 |

「销售侧栏可见」指条目带 `salesWorkspaceVisible`：纯销售的侧栏只显示带此标记的条目，不带就会把 Lynn 弹回。

对应的列表页（`/blinds-orders`、`/blinds-orders/new`、`/blinds-orders/zebra-ratios`、`/projects`、`/capabilities`）仍按侧栏入口判定。

以下站内链接在本 change 后仍会被弹回，留给 VIS-1b 按「看不见就不出现」收掉链接本身：

- 工艺单详情 → `/install/repairs/[id]`（`blinds-orders/[id]/page.tsx:721`），销售点会被弹回。
- 招投标交接 → `/ops/**`（`projects/handoff-dialog.tsx:177/200`），今天已被页面门弹回，行为不变。
- 微信推送里的 `/agent-trace` 链接（`agent-runtime/workbench-link.ts`），今天已被 `PlatformAdminGate` 弹回，行为不变。

### D5 登录即可白名单与门外清单

白名单：`/`、`/tasks/**`、`/notifications`、`/help`、`/settings`（只是索引）、`/settings/{account,appearance,notifications}`、`/settings/wechat`、`/wechat`。逐条理由：

- `/`：首页自带落地重定向（spec `navigation/position-based-visibility`「岗位模式的默认落地」），不再叠一层门。
- `/tasks`：任务通知（`href.ts:36`）与「无落地 → `/tasks`」兜底都要用。纯销售侧栏里没有「我的工作」，所以不能按侧栏入口判定。
- `/notifications`：头部铃铛。
- `/settings` 索引：销售日历的「重新连接 Google」（`sales/calendar/page.tsx:358`）、报价复核（`quote-digital-employee-review.tsx:46`）与 Google OAuth 回调（`api/auth/google/callback`）都会落到这里；按「企业设置」入口判定会把纯销售弹走。索引页上的卡片怎么收属 VIS-1c。
- 两个微信页：`identity/wechat-entry` 规定开关关闭时任何已登录用户直接访问都显示「暂未开放」。路由门放行，交给 COLLAB-1 的整页替换；本 change 不改那份规格。

门外清单：`(auth)` 组的 `/login`、`/register`、`/select-org`，中间件 `PUBLIC_PATHS`，末段带扩展名的路径（`public/` 下的文件全部带扩展名，已核对），以及 `/monitoring`。

`/settings/email` 不进白名单，门表指向「邮箱绑定」或「招投标中心」任一可见即可。销售要用；招投标的 RFQ 入口在授权邮箱未连接时提示去这里（`tender-rfq/web-entry-pure.ts:63`）。

被否决：

- `/settings` 按「企业设置」入口判定：理由如上。
- 微信页按「微信集成」入口判定：与 `identity/wechat-entry` 冲突。

### D6 302 目标与防环

目标 = `resolveHomeRedirect(workspaceContextFromNav(ctx)) ?? "/"`，即该用户进入首页后最终停留的页面：管理层为 `/`，其余为首页落地规则的结果（岗位模式没有落地时为 `/tasks`）。不用 `getDefaultWorkspace`，因为它对出单、无岗位成员返回 `/`，而 `/` 在白名单里，会先到 `/` 再被首页跳一次。目标本身不放行，或与被请求路径相同时，改落 `/tasks`。重定向不带原查询串，也不加任何说明判定原因的响应头。

测试对每种身份断言：目标必放行，且一跳即停（目标不是 `/` 以外还会再跳的页面）。

被否决：

- 一律跳 `/`，或用 `getDefaultWorkspace`：非管理层到 `/` 还会被首页再跳一次。
- 403 页：判断点 2 已否。

### D7 招投标口径（判断点 3）

`canAccessBidWorkspace` 在岗位模式下：

- 管理层：仍只看模块（`bids` 或 `projects`）。
- 非管理层：只认 `project.create` / `project.update`。`project.read` 与 `hasBidCapability`（是某项目成员）不再放行。
- 旧模式口径不变。

`nav-projects`、`nav-project-intel`、`nav-intel-{awards,competitors,agencies,supply,monitor}`、`nav-suppliers` 的 `positionPermissions` 从 `["project.read"]` 改为 `["project.create", "project.update", "organization.dashboard.read"]`。

后果：

- 会计与三个出单岗位的侧栏少 `ws-bids` 和项目 / 情报 / 供应商组，`position-nav.test.ts` 的这 4 份快照相应更新。其余岗位快照不变。
- 他们仍能经 D4 的 `/projects/*` 打开被链接到的项目详情；项目成员（含销售、安装工）同样能打开，只是不再因此看到 `/bids` 与项目列表。
- 默认落地不受影响：会计的落地判定用的是 `NON_ACCOUNTING_HOME_PERMISSIONS`，不看招投标工作区。

被否决：

- 两种模式都去掉 `project.read`：旧模式里未配置模块的企业，持 `project.read` 的 `org_member` 会丢 `/bids`，超出 Sunny 范围。
- 保留「项目成员即放行」：判断点 3 说的是只认招投标键。

### D8 营销工作区改由路由门管辖

- `/marketing/**` 与 `/operations/growth/**` 指向「品牌增长」入口（`growth-hub`：`marketing` / `operations` 模块，岗位模式要求运营键）。
- 删除 `src/lib/marketing/workspace-gate.ts`，以及只调用它的 `marketing/layout.tsx`、`operations/growth/layout.tsx` 两个文件。
- 中间件删掉营销页面分支，保留 `/api/marketing/**` 分支。
- `route-access.ts` 删 `isMarketingPagePath` / `isMarketingWorkspacePath`，保留 `isMarketingApiPath` 与 `canAccessMarketingWorkspace`（API 判定在用）。

被否决：整个删掉 `route-access.ts`。API 读守卫和旧模式 API 拦截依赖它，而 API 层在本期范围之外。

### D9 `/sales/analytics` 按复盘键

`ROUTE_ONLY_NAV_ITEMS` 登记一条：`sales` 模块，`positionPermissions` / `requiredPermissions` 均为 `["sales.analytics.read"]`，`salesWorkspaceVisible: true`（合价与销售岗位是「纯销售」，也持此键）。页面删掉 `isSuperAdmin` 判定和「无权限访问」块；数据请求不再在客户端按平台角色跳过。

两个接口本来就按键判定：

- `customer-matrix` 用 `resolveSalesScope(…, "sales.analytics.read")`。
- `reps` 要求组织级 `sales.customer.read`。只持本人范围的人这个接口会 403，页面的销售下拉为空即可，不报错。

注意：系统 `sales_rep` 模板持 `sales.analytics.read`，所以 Lynn 也能进这页，看到的是本人范围的数据。这是「持键的人必须看得见」的直接结果。

被否决：只对管理层开放。这与任务书「持 `sales.analytics.read` 的老板也挡在外面是反向泄露」的口径相反。

### D10 去掉页面里重复的工作区重定向

`bids/page.tsx`、`accounting/page.tsx`、`ops/page.tsx`、`ops/projects/page.tsx`、`ops/projects/[id]/page.tsx`、`install/**/page.tsx` 删掉 `canAccess*` 判定后的 `redirect`。保留 `if (!session) redirect("/login")` 与 `canAccess*` 函数本身，侧栏与底栏在用。

被否决：两层都保留。任务书要求去重复；而且页面里的那层在 `loading.tsx` 之内，正是骨架闪现的来源之一。

### D11 收件箱与知识库：本 change 照侧栏现状（待拍板 Q1）

岗位模式下，「收件箱」（`work-inbox` → `/service-inbox`）与「知识库」（`mgmt-knowledge` → `/knowledge`）没有声明岗位键，对除纯销售外的所有成员可见。安装工、会计、出单、无岗位成员的侧栏快照里都有这两项。路由门与侧栏一致，所以本 change 后安装工仍能进这两页。

任务书验收要求安装工敲这两个时 302，但这需要先决定「客服收件箱 / 知识库对哪些岗位可见」。凡侧栏含公共项的岗位快照都可能变化：`position-nav.test.ts` 里最多 11 份，纯销售与合价不受影响。

被否决：本 change 里自行选键（例如收件箱 = 运营键 ∨ 销售工作键 ∨ 管理层）。这是任务书没有给出的岗位口径，应由需求方拍板。

### D12 两种模式都生效

路由门在旧模式企业（梦馨）同样生效，判定就是旧模式侧栏的平台角色规则，不另立口径。表驱动测试带 4 个旧模式抽样（`trade` / `sales` / `boss` / `operations`）。

后果：旧模式「品牌增长」要求平台角色 super_admin / `boss` / `manager` / `operations`，所以 `trade` / `user` 失去 `/marketing/**`、`/operations/growth/**`。改动前中间件只拦 `sales`，因此这一条在 proposal 里标为 BREAKING，spec `marketing/growth-center-access` 也写了旧模式外贸场景。

被否决：只在岗位模式生效。那样旧模式还得保留中间件按 `role=sales` 拦营销页面的旧规则，与「判定来源只有一处」相反。

## 与八条硬纪律的关系

1. 零 schema：不改 Prisma、不写 migration。门表与「只做门」的条目都是代码常量，缓存只在进程内存里。
2. 出站先审批：不涉及。
3. 禁止第三套队列：不涉及。进程内缓存不是队列 / 调度 / 租约 / 注册表，没有后台任务。
4. 脱敏：不涉及敏感字段。spec「重定向不泄露页面与判定细节」写明 302 响应里不出页面内容与判定原因。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。`/settings/email` 只是页面门，不改 EmailProvider 的查找规则。
7. 确定性优先：门表查表判定，零 LLM 调用。
8. 测试注册：新增的 `src/lib/navigation/__tests__/route-gate.test.ts` 在同一 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，`bash scripts/check-test-registry.sh` 通过；`ci/test-registry-baseline.txt` 不新增行。

## Risks / Trade-offs

- [中间件改 Node runtime 后要把 Prisma 打进中间件包，Vercel 构建或部署可能失败] → task 4.1 本地跑 `next build --webpack` 并确认构建输出里有 `ƒ Proxy (Middleware)`；PR 的 Vercel Preview 部署必须成功才合并。回滚就是 revert 本 PR，无数据迁移。
- [每个页面请求多一次权限解析，预取放大请求量] → 登录即可与不经门的请求不查库，其余按 D3 缓存。合并后在 Vercel 日志里对比中间件耗时，写进报告。
- [旧模式（梦馨）里侧栏不显示、却有站内链接或通知指向的页面会被弹回] → 已知两条：
  - 旧模式 `sales` 收到的 `revenue_opportunity` 通知跳 `/revenue/[id]`（PERM-6c 已让营收中心只认外贸键，入口本就不可见）。
  - 无企业成员身份的用户点「前往组织」（`/organizations`）。
  
  报告里请梦馨侧确认。
- [未登记或不存在的路径从 404 变成 302] → spec「门表之外的路径一律拒绝」写明了，可接受。
- [判定滞后最多 30 秒] → spec「判定时效」写明。切换企业立即生效（企业 id 每次请求都重新解析）。
- [Lynn 在 VIS-1b 之前仍能进 `/workforce`、`/assistant`] → 侧栏还有这两项，路由门保持一致；proposal Out of scope 写明。
- [Next 16 对 `middleware.ts` 打弃用告警] → 只是告警，改名不在本期。

## Migration Plan

1. 合并前：Lucas 把 `config/positions/sunny.json` 的 `TODO:` 邮箱占位填实并跑岗位绑定（proposal「合并前置」）。
2. 合并后在生产用真实账号逐条走 spec 场景：Lynn、安装工、Miki、Bob 敲 proposal 列出的 URL，看 302 目标；Bob 打开 `/sales/analytics` 有数据；Lynn 从报价单点开工艺单正常。VIS-1e 合并后可改用岗位预览复核。
3. 回滚：revert 本 PR 即恢复原中间件与页面门，无数据变更。

## 验证方式

- `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`，包含四部分：
  - 表驱动：12 种岗位模式身份 + 4 个旧模式抽样 × 全部门表路径；
  - 侧栏可见 ⇔ 放行；默认工作区必放行；两步无环；
  - 源码断言：163 个 `(main)` 页面全部命中、6 个 `(main)` 外页面在清单里、中间件声明 `runtime: "nodejs"` 且调用路由门、旧营销页面门已删；
  - 请求分类：`/api/**`、静态文件、免登录与白名单路径不取判定输入。
  - 中间件层：用 `NextRequest` 构造请求、注入假的输入加载器，断言 302 状态、`Location`、正文为空、无自定义说明头、查询串不带、加载器抛错时落 `/tasks`。
- 受影响的既有测试（2026-11-08 基线）：

  | 测试 | 基线 |
  |---|---|
  | `position-nav.test.ts` | 86 |
  | `navigation-ia.test.ts` | 63 |
  | `navigation-workspace.test.ts` | 34 |
  | `workspace-policy.test.ts` | 26 |
  | `residual-reads.test.ts` | 76 |
  | `route-access.test.ts` | 3 |
  | `ops-access.test.ts` | 21 |
  | `wechat-entry-nav.test.ts` | 19 |

  改动后全部通过；`position-nav` 只有 accounting 与三个出单岗位的快照变化。
- `bash scripts/check-test-registry.sh`、`npm run typecheck`、`npm run lint:baseline`、`npm test`。
- `npx next build --webpack`：构建成功，输出含 `ƒ Proxy (Middleware)`。
- `openspec validate vis-1a-route-gate --strict`。

## 审核关注点（偏离任务书之处，请拍板）

- Q1（D11）：收件箱 / 知识库对安装工等岗位是否隐藏、用哪组键。本 change 默认照侧栏现状不动。若要在 1a 一并收，需给出两项各自的岗位键，并接受相应侧栏快照变化。
- Q2（D1）：门的位置从任务书写的 `(main)/layout.tsx` 改为 Node runtime 中间件，理由与夹具实测见 Context 与 D1。
- Q3（D4）：对象详情页的放行面宽于列表页，以免销售、运营、招投标被自己的站内链接和通知弹回。任务书验收里 Lynn 的 `/blinds-orders`、`/projects` 302 指的是列表页，仍然成立。
- Q4（D12）：路由门在梦馨（旧模式）同样生效。直接后果：旧模式平台角色 `trade` / `user` 不再能进营销工作区（改动前中间件只拦 `sales`），proposal 已标为 BREAKING。
- Q5（验收数据）：`config/positions/sunny.json` 里 Miki 绑定的是 `owner` + `pricing_lead` + `accounting`（Bob、Bill 也都带 `owner`）。任务书验收按「Miki = `accounting` + `pricing_lead`」写了「`/bids` 302」，按这份绑定 Miki 是管理层，`/bids` 放行。路由门只按键判定，验收应以绑定文件为准，或先改绑定。本 change 的测试按岗位组合写，不按人名。
- Q6（D5）：白名单比任务书宽：任务书只列 `/settings/account`、`/settings/appearance`、`/settings/notifications`、`/notifications`、`/help`、`/select-org`，本 change 还放行 `/`、`/tasks/**`、`/settings` 索引与两个微信页（理由见 D5）。另外 `/select-org` 不在 `(main)` 下，归门外清单。
- Q7（D7）：任务书 Impact 说「四份侧栏快照不应变化（除判断点 5 移除两项）」，但判断点 3 本身就要求会计不再进 `/bids`，所以 accounting 与三个出单岗位的快照会变（少招投标与项目 / 情报 / 供应商组）。
- Q8（D8）：任务书要删 `route-access.ts` 的「非销售即可」，并验收「grep 业务代码无 `role === "sales"` 按平台角色拦路由的残留」。本 change 删掉页面层的判定，保留 API 层的 `canAccessMarketingWorkspace`（`requireMarketingReadAccess` 与中间件 `/api/marketing/**` 分支在用），因为 API 层在任务书 Out of scope 里。grep 验收因此限定为页面路由（`src/middleware.ts` 的页面分支与 `src/app/(main)/**`）。
- Q9（D4）：`inventory/fabric-stock-access` 写的是「库存列表 SHALL 对持 `inventory.read` 的人开放」，`sales_rep` 模板持 `inventory.read`。本 change 照任务书验收让 Lynn 的 `/inventory` 页面 302（侧栏对纯销售不显示库存），库存接口对她仍开放。这里按「该 spec 说的是接口」理解；如果它说的是页面，需改那份 spec。
