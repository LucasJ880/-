# VIS-1 可见性收口「看得见的都是能用的」— 任务书

TASKFLOW：新增 Phase V（登记到 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`，与 Phase K / P / C 的 Sunny 线并列）：VIS-1a ~ VIS-1e 五个 change，一个 change = 一个 PR，按下文「上线顺序」合并。
需求方：Sunny（Lucas，2026-11-08）："有一些内容明明没有权限、或者是别的后台流程，还是在账号上看到，体感很不好，应该隐藏。"
依据：
- `docs/Sunny销售系统_PM复审_2026-11-08.md`（项目文档）§不足「平台与运维」「会计 / 老板」两节；
- PERM-4c2 / PERM-7b 已把**侧栏**收成「岗位键 ∧ 模块」（`src/lib/navigation/filter.ts`、`docs/QINGYAN_PERMISSION_HANDOFF.md`），但侧栏以外的面没有同步收口；
- 现成样板：`src/app/(main)/bids/page.tsx`、`ops/page.tsx`、`accounting/page.tsx`、`install/page.tsx` 四个服务端重定向门，以及 COLLAB-1 的「开关不为 true 整页替换」机制（`src/lib/messaging/wechat-entry.ts` → `settings/wechat/layout.tsx`）。

## 一条规则

**一个入口（路由 / 首页卡片 / 底栏 / 通知类型 / 设置项 / 审批项 / AI 工具）只在「所属模块已开 ∧ 当前岗位持键」时出现；不满足就不出现——不是灰掉，不是点进去 403，不是先闪骨架再跳。** 反向同样成立：持键的人必须看得见（现在 `/sales/analytics` 把持 `sales.analytics.read` 的老板也挡在外面）。

判定来源只有一处：导航注册表 `src/lib/navigation/registry.ts` 的 `moduleKey / positionPermissions / workspaceAccess / platformAdminOnly` + `src/lib/tenancy/modules.ts` 的 `NAV_HREF_MODULES`。页面门、首页卡片、底栏、通知、帮助页都从它派生，不再各写一套。

## Why

侧栏收干净了，但其他面没有。今天一个 Sunny 账号能看到的、与自己无关的东西（均已在代码中核对，未运行应用）：

**1. 直接敲 URL 没有门。** `(main)/layout.tsx` 不做任何鉴权；`src/middleware.ts` 只拦登录态（另有一条按 JWT `role=sales` 拦 `/marketing` 的旧规则，`src/lib/marketing/route-access.ts`）。140 多个 `page.tsx` 里约 120 个是 `"use client"` 且无守卫：销售敲 `/trade/prospects`、`/revenue`、`/projects/intelligence`、`/capabilities`、`/workforce`、`/knowledge`、`/suppliers`、`/service-inbox`、`/reports` 一律先渲染整页骨架（标题、按钮、筛选器、业务术语），数据取决于 API 是否按键过滤。`isModuleEnabled / navHrefAllowedByModules / hasModule` 在页面层的全部调用只有 4 处 `window_covering` UI 切换，**模块从未在页面或 API 层生效**。

**2. 有门的口径不对。**
- `/marketing/**`、`/operations/growth/**`：口径是「非销售即可」（`src/lib/marketing/workspace-gate.ts`），安装工 / 会计 / 运营员工全部放行进营销工作区；
- `/sales/analytics`：客户端只认 `isSuperAdmin`（`page.tsx:133-143`），持 `sales.analytics.read` 的老板被挡——反向泄露；
- `/bids`：会计因持 `project.read` 被 `canAccessBidWorkspace` 放行（`workspace-policy.ts:62-66,145`）；
- `/inventory`：安装工 API 403 后页面空转（`inventory/page.tsx:73-81`），没有落点。

**3. 老板首页混着别家的业务。** `/` 的 `OrgCockpitHome` 固定渲染 `POST_REGISTRY` 全部 7 张岗位卡（`src/lib/cockpit/posts.ts`，`posts-read-model.ts:257` 直接 `POST_REGISTRY.map`）：询盘销售（→ `/revenue`，梦馨 FDE 收入脊柱）、投标、营销增长、客服、项目交付、运维与知识（→ `/ai-activity`，平台管理员页）、内容。「等你拍板」把全组织 PendingAction / ApprovalRequest / workforce job 混列，统一跳 `/capabilities/approvals`（`waiting.ts:174-250`）。`/operations` 索引页是服务端静态清单，无过滤。`/revenue` 能出现在 Sunny 菜单是因为 `moduleKey: ["trade","sales"]`（`registry.ts:657`、`modules.ts:67`）——Sunny 有 `sales` 就放行。

**4. 通知、设置、帮助、搜索全员一份。**
- `/settings/notifications` 的开关列表对所有人列出 `rfq_*`、`agent_approval` 等类型（`src/components/notification/notification-type-toggle-list.tsx`，类型清单 `src/lib/notifications/constants.ts`）；通知页筛选项含「报价让利审核 / 项目分发」（`notifications/page.tsx:190-196`）；铃铛图标表与跳转表含 `rfq_* / trade_prospect / muse_inquiry / revenue_opportunity`（`header.tsx:217-230`、`src/lib/notifications/href.ts:42-67`）。RFQ 通知实际只发给项目负责人，所以是**术语泄露**而非数据泄露，但销售看见「询价催单」开关一样困惑。
- `/settings` 索引硬编码 `MENGXIN_ORG_CODE` 切换发信文案（`settings/page.tsx:13,58`）。
- `/help` 是静态表（`help/page.tsx:3-13`），列 `/inbox`、`/organizations`、`/projects`「Prompt、知识库入口」，内容过时且不按组织 / 岗位。
- 全局搜索搜 task / project，范围是组织内全部项目（`src/app/api/search/route.ts:12`），含招标项目名。

**5. 审批中心与 AI 助手把所有来源混列。** `/capabilities/approvals` 对 `org_admin` 列全组织所有来源（`tender.send_rfq`、`tender.send_chase`、`marketing.send_blast`、`revenue_spine.*`，`src/lib/capabilities/approvals/query.ts:88-230`）；AI 助手「待我确认」把 org_admin 的整个 `orgId` 放进 OR（`src/lib/marketing/team.ts:97-114`、`api/ai/pending-actions/route.ts:36-58`）。Sunny 原生审批其实有专属落点（超限折扣 → `/sales/quote-sheet?mode=order&quoteId=`；质保邮件 → `/accounting` 待收尾款页签），却同时落进上面两处，与招标 / 外贸混在一起。AI 助手工具表 `registry.list` 只按派生角色 + orgRole 过滤、**不按模块**（`src/lib/agent-core/tool-registry.ts:82-100`；模块只在执行时查 `src/lib/tenancy/tool-auth.ts`），12 个 `marketing_*` 工具 `allowRoles: "*"` 对销售也挂载。

**6. 「AI 任务」「数字员工」在销售侧栏里。** `SALES_SIDEBAR` 含 `work-ai-jobs`（→ `/workforce`，列全组织 AI job，招标 / 外贸 / 营销混列，`api/workforce/jobs/route.ts:29-70`）与 `work-assistant`（`src/lib/navigation/__tests__/position-nav.test.ts:136-146`）。

**7. 老板模板自带外贸键。** 窗饰 `owner` 模板含 `trade.read / trade.manage / trade.settings.manage`（`src/lib/authorization/role-defaults.ts:245-248`，PERM-6a 注释"Sunny 开外贸模块后老板可用"）；Sunny 没开 `trade` 模块，但 `/trade/**` 无页面门、API 只看键 → 老板敲 URL 能进全量外贸界面。

**8. 平台管理员没法自检。** `super_admin` 拿到整个权限注册表（`resolve-effective-permissions.ts:117-119`），没有任何「以某岗位预览」设施（全库 grep 无命中）。Lucas 看到的永远不是 Bob / Lynn / 安装工看到的，上面 1–7 条才拖到今天。

结果：Lynn（销售）能看到招标项目列表、全组织 AI 任务、询价通知开关；Bob（老板）首页第一张卡是梦馨的「询盘销售」，点进去是一条红色报错；安装工能进营销工作区和客服微信对话。每一条都不是数据事故，但每一条都在说"这不是给你做的系统"。

## What（五个 change）

### VIS-1a `vis-1a-route-gate`：路由级可见性门（服务端）

- 新增纯函数 `resolveRouteGate(pathname, ctx) → "allow" | { redirect: string }`，输入与 `isNavItemVisible` 同一个 `NavigationFilterContext`，判定复用 `filter.ts` 的 `modulesOk / positionPermissionOk / workspaceAccessOk / platformAdminOnly`——**不写第二套规则**。
- 新增「路由前缀 → 导航项 key」映射表（代码常量，零 schema），覆盖 `(main)` 下全部一级路径及其子路由（`/trade/**` → `biz-trade*`，`/revenue/**` → `biz-revenue`，`/projects/intelligence/**` → `nav-project-intel`，`/bids/**` → `ws-bids`，`/workforce/**` → `work-ai-jobs`，`/capabilities/**`、`/workforce/**`、`/knowledge`、`/suppliers`、`/service-inbox`、`/reports`、`/operations/**`、`/marketing/**`、`/projects/**`、`/bids/**`、`/install/**`、`/accounting`、`/inventory`、`/blinds-orders/**`、`/sales/**`、`/organizations/**`、`/admin/**`、`/ai/**`、`/memory`、`/agent-trace`、`/ai-activity`、`/product-content/**`、`/suppliers/**`、`/wechat`、`/tasks/**`、`/notifications`、`/inbox`、`/assistant`、`/settings/**`、`/help`）。
- 显式白名单：仅需登录即可的路由（`/settings/account`、`/settings/appearance`、`/settings/notifications`、`/notifications`、`/help`、`/select-org`）写在同一张表里，标 `public_after_login`。**映射表之外的 `(main)` 路由默认拒绝**（fail-closed，与 `filter.ts:75` 口径一致）。
- 在 `src/app/(main)/layout.tsx` 做服务端判定（`resolveWorkspaceContextFromCookies` 已有），不满足 → `redirect(getDefaultWorkspace(ctx))`，与 `bids/page.tsx` 现有行为一致；不新增 403 页面；不在客户端判定后再跳。
- 删除被取代的旧门：`middleware.ts` 的 `role=sales` 拦 `/marketing` 规则与 `src/lib/marketing/route-access.ts`、`workspace-gate.ts` 的「非销售即可」；`/sales/analytics` 的 `isSuperAdmin` 判定改为门表（键 `sales.analytics.read`）；`bids/ops/accounting/install` 四个页面级 `redirect` 改为依赖 layout 门（保留函数，去重复）。
- 修 `/revenue` 的 `moduleKey` 为 `["trade"]`、`NAV_HREF_MODULES["/revenue"]` 同步；`biz-revenue` 不再因 `sales` 放行。
- `/bids` 的 `canAccessBidWorkspace`：去掉 `project.read` 兜底，只认 `bids` 岗位键（会计看结算走 `/accounting` 的「项目结算」页签，不需要进 `/bids`）。
- 源码断言测试：遍历 `src/app/(main)/**/page.tsx`，每个路径必须命中映射表或白名单，否则测试失败——这是防止以后新页面又漏门的唯一机制。
- 表驱动测试：4 个岗位（`sales_rep / installer / accounting / owner`）× 全部一级路由 → allow / redirect 目标，快照与 `position-nav.test.ts` 的侧栏快照一致（侧栏可见 ⇔ 路由放行）。

### VIS-1b `vis-1b-home-and-shell`：首页、底栏、索引页按同一张表

- `POST_REGISTRY` 每张岗位卡补 `moduleKey` + `positionPermissions`（代码常量）；`posts-read-model.ts` 渲染前用 `isNavItemVisible` 同口径过滤；`inbound_sales` 卡 `moduleKey: "trade"`，`ops_knowledge` 卡 `platformAdminOnly`。一张卡都不剩时首页不渲染空壳，`resolveHomeRedirect` 落到默认工作区。
- 「等你拍板」（`waiting.ts`）只列当前岗位可批的动作类型：按 `POST_REGISTRY[*].pendingActionTypes` 与可见卡取交集；Sunny 原生审批项（`quote_promotion_approval`、质保邮件、折扣设置变更）跳各自专属落点，不再统一跳 `/capabilities/approvals`。
- `mobile-tab-bar.tsx`「招投标」底栏项改为与侧栏 `ws-bids` 同判定（现只看 `modulesJson` 含 `bids`）。
- `/operations` 索引页（`operations/page.tsx:143-153`）改为从可见导航生成，不再静态列「投标业务档案」等。
- `/help` 功能地图改为从当前用户可见导航树生成：`NavigationItem` 新增可选 `description` 字段（代码常量，`src/lib/navigation/types.ts`），给 72 项各补一句；删除静态 `ROUTES` 与 `docs/PROJECT_AUDIT.md` 引用。
- 销售侧栏：`work-ai-jobs` 与 `work-assistant` 从 `salesWorkspaceVisible` 中移除（判断点 5 拍板后执行）；`/workforce` 列表按 `POST_REGISTRY` 可见卡的 `workDomains / agentRunTypes` 过滤，无可读域的人不见此项。

### VIS-1c `vis-1c-notify-settings-search`：通知类型、设置、搜索、AI 工具按模块收口

- `src/lib/notifications/constants.ts` 每个类型补 `moduleKey`（代码常量）；`notification-type-toggle-list.tsx` 与 `notifications/page.tsx` 的筛选项只列「模块已开」的类型；`header.tsx` 图标表与 `href.ts` 跳转表不改（收到就要能渲染）。
- `/settings` 索引：`MENGXIN_ORG_CODE` 硬编码改读组织 `settingsJson.ui.senderCopy`（零 schema，既有 JSON 位）；`digital-employees / agent-skills / wechat` 入口判定不变。
- 全局搜索（`api/search/route.ts`）：项目范围从「组织内全部」改为「当前用户可读」（复用 `src/lib/projects/access.ts` 的读判定），且仅在用户持 `project.read` 时搜项目；任务范围不变。
- AI 助手工具表 `tool-registry.ts` 的 `registry.list` 增加模块过滤，口径与执行期 `tool-auth.ts` 完全一致（同一个映射函数，不复制表）；`marketing_*` 工具 `allowRoles: "*"` 改为随 `marketing` 模块与营销键。
- 数字员工工作台「营销增长员工」可见性从「派生角色 ≠ sales」改为 `marketing` 模块 ∧ 营销键（`src/lib/marketing/access.ts:52-56`）。

### VIS-1d `vis-1d-approvals-split`：审批中心按模块 ∧ 岗位

- `src/lib/capabilities/approvals/query.ts`：`org_admin` 不再等于「全组织所有来源」；可见集合 = 本人提交 / 被指派 ∪ 「所属模块已开 ∧ 本岗位持对应审批键」的类型。`tender.*` 要 `bids` 键，`marketing.*` 要营销键，`revenue_spine.*` / `trade.*` 要 `trade` 模块 ∧ 外贸键，`sales.*`（折扣 / 让利 / 签约改价）要销售审批键。
- AI 助手「待我确认」（`api/ai/pending-actions` 与 `count`）与 `getTeamApprovalAccessIds` 改用同一个集合函数。
- `super_admin` 不受此限（平台运维需要全量）。
- 隔离库测试：Sunny owner（org_admin）看不到 `tender.send_rfq` 以外的招标项（若其无 `bids` 键则一条不见）、看不到任何 `trade.*`；梦馨 Cathy 的外贸审批不受影响。

### VIS-1e `vis-1e-preview-as-position`：平台管理员「以岗位预览」

- 仅 `super_admin` 可用：`/organizations/[orgId]` 成员页加「以此岗位预览」按钮，写一枚 httpOnly cookie（`qy_preview`：orgId + 岗位 key + 过期 2 小时），零 schema。
- `resolveWorkspaceContextFromCookies` 读到预览 cookie 时，用该岗位模板的键替换 `permissionKeys`，`positionMode=true`，`platformRole` 视同 `user`——导航、路由门、首页、通知、审批、AI 工具全部跟着变；**预览态所有写操作（非 GET API）返回 409 `PREVIEW_READONLY`**，避免以假身份动数据。
- 顶部常驻横幅「正在以〈岗位〉预览 · 退出」，退出清 cookie。
- 这是 1a–1d 的验收工具：Lucas 不用借 Lynn 的账号就能看到 Lynn 看到的。

## 判断点（请拍板）

1. **口径**：A（推荐）「模块已开 ∧ 岗位持键」双门，判定全部从导航注册表派生；B 只按岗位键、模块不管。B 挡不住老板的 `/trade/**`（模板里带键），且与侧栏 `modulesOk` 口径不一致。
2. **未授权直达 URL 的行为**：A（推荐）服务端 302 到默认工作区，与现有 `/bids` 一致、零新页面；B 渲染 403 页。B 多一个页面、多一处文案，而且"告诉你有但不给你看"正是这次要消除的体感。
3. **`/projects` 与 `/bids` 在 Sunny 的归属**：推荐只对持 `bids` 键的岗位（Bill、蒋晨）与老板可见；会计不再经 `project.read` 进 `/bids`，结算走 `/accounting`。Sunny 确实在投 Alberta 的标，所以是"收给对的人"，不是"藏起来"。
4. **老板模板里的外贸三键**：A（推荐）模板不动，靠 1a 的模块门——`trade` 模块没开就不出现，开了老板立刻可用；B 从窗饰 owner 模板删键。B 会让将来开外贸时又要改模板。
5. **销售侧栏的「AI 任务」「数字员工」**：A（推荐）移出 `salesWorkspaceVisible`，`/workforce` 按可读域过滤后对销售本来也是空的；B 保留。
6. **1e 预览是否纳入本期**：推荐纳入，放在最后一个 PR；没有它，1a–1d 的验收只能靠借账号。
7. **项目详情的招标五页签**（`src/lib/tender/detail-tabs.ts`，对所有 project 固定渲染「招标要求 / 标书与报价 / 情报 / 提交」）：推荐**本期不做**（Out of scope），Sunny 的项目就是招标项目，1a 把它收给对的人就够了；非招标 `workDomain` 的去招标化另立。

### 拍板结果 · VIS-1（2026-11-08，Lucas："按照你的推荐做这个就行"）

1. 口径取 **A**：「模块已开 ∧ 岗位持键」双门，判定全部从导航注册表派生。
2. 未授权直达 URL 取 **A**：服务端 302 到默认工作区，不做 403 页。
3. `/projects` 与 `/bids` 只对持 `bids` 键的岗位与老板可见；会计不再经 `project.read` 进 `/bids`。
4. 老板模板的外贸三键取 **A**：模板不动，靠模块门。
5. 销售侧栏移除「AI 任务」「数字员工」（`work-ai-jobs`、`work-assistant` 去掉 `salesWorkspaceVisible`）；`/workforce` 按可读域过滤。
6. 1e「以岗位预览」**纳入本期**，作为最后一个 PR。
7. 项目详情招标五页签**本期不做**，留在 Out of scope。

## Impact

- 修改（1a）：`src/app/(main)/layout.tsx`、新增 `src/lib/navigation/route-gate.ts` + 映射表、`src/middleware.ts`（删旧规则）、`src/lib/marketing/route-access.ts` / `workspace-gate.ts`（删或改为调门表）、`src/lib/rbac/workspace-policy.ts`（`canAccessBidWorkspace` 去 `project.read`）、`src/lib/navigation/registry.ts` + `src/lib/tenancy/modules.ts`（`/revenue`）、`sales/analytics/page.tsx`。
- 修改（1b）：`src/lib/cockpit/posts.ts`、`posts-read-model.ts`、`waiting.ts`、`src/components/mobile-tab-bar.tsx`、`operations/page.tsx`、`help/page.tsx`、`registry.ts`（`salesWorkspaceVisible`）、`api/workforce/jobs/route.ts`。
- 修改（1c）：`src/lib/notifications/constants.ts`、`src/components/notification/notification-type-toggle-list.tsx`、`notifications/page.tsx`、`settings/page.tsx`、`api/search/route.ts`、`src/lib/agent-core/tool-registry.ts`、`src/lib/marketing/access.ts`。
- 修改（1d）：`src/lib/capabilities/approvals/query.ts`、`src/lib/marketing/team.ts`、`api/ai/pending-actions/*`。
- 修改（1e）：`src/lib/rbac/resolve-workspace-context.ts`、`organizations/[orgId]` 成员页、`src/components/app-shell.tsx`（横幅）、一个 `api/admin/preview` 路由（set / clear cookie）、`api` 写操作统一入口（`authorize()` 处加预览只读判定）。
- 测试：每个 change 至少一个纯函数表驱动测试 + 1a 的源码断言；1d 一个隔离库测试；全部在同一 task 里注册进 `scripts/test-all.sh`。`position-nav.test.ts` 的四份侧栏快照不应变化（除判断点 5 移除两项）。
- 零 schema；不新增权限键；不新增 LLM 调用；不触碰出站；不新增队列。
- 八条硬纪律：1、2、3、5、6、7 不涉及；4（脱敏）不涉及；8（测试注册）每个 change 遵守。

## 上线顺序与 BREAKING

合并前（Lucas）：**先把 `config/positions/sunny.json` 的 9 个 `TODO:` 占位填成真实邮箱并跑绑定**，否则岗位模式下无键的人在 1a 之后敲任何业务 URL 都会被弹回默认工作区——那是"系统更空了"，不是"系统更干净了"。

1. VIS-1a（最大体感；BREAKING：老板失去 `/trade/**` 直达、会计失去 `/bids`、安装工失去营销工作区）；
2. VIS-1b（首页 / 底栏 / 帮助）；
3. VIS-1c（通知 / 设置 / 搜索 / AI 工具）；
4. VIS-1d（审批中心；BREAKING：Sunny org_admin 不再见全量审批，梦馨不受影响）；
5. VIS-1e（预览）。

每个 change 合并后 archive 一个小 PR，并把 Phase V 状态列改为实际值。

## Out of scope

- 项目详情招标五页签的去招标化（判断点 7）。
- `BlindsOrder` 补 `orgId`、`FabricInventory` 加租户隔离（零 schema 纪律之外，另立）。
- Postgres RLS。
- 新增任何权限键或岗位模板；岗位模板内容本身（PERM 线）。
- 英文界面 / i18n（另立，见项目文档 PM 复审「一个季度」）。
- `/display`、`/quote/[token]`、`/sales/share/visualizer/[token]` 等免登录页。
- API 层按模块拦截（本期只做页面 / 入口层；API 继续按键 + 成员身份判定，1a 的 302 发生在 API 之前）。

## 验收（以 1e 预览逐岗位核对，或借账号）

**Lynn（`sales_rep`）**
- 侧栏 = 日历、销售首页、客户与商机、报价、报价记录、我的业绩、邮箱绑定、使用说明（判断点 5 执行后无「AI 任务」「数字员工」）；
- 敲 `/trade/prospects`、`/revenue`、`/projects`、`/projects/intelligence`、`/bids`、`/capabilities`、`/workforce`、`/knowledge`、`/suppliers`、`/service-inbox`、`/reports`、`/marketing/employee`、`/operations/growth`、`/accounting`、`/install`、`/inventory`、`/blinds-orders` 全部 302 → `/sales/home`，无骨架闪现；
- `/settings/notifications` 开关列表无 `rfq_*`、`agent_*`、`trade_*`；通知页筛选项无「项目分发」；
- 全局搜索搜不到任何项目；
- `/help` 只列她侧栏里的页面；
- AI 助手工具表无 `marketing_*`、`tender_*`、`trade_*`。

**安装工（`installer`）**
- 侧栏 = 公共项 + 安装任务；`/marketing/**`、`/operations/growth/**`、`/service-inbox`、`/inventory`、`/knowledge` 全部 302 → `/install`；
- 首页 `/` 302 → `/install`，不见岗位卡。

**Miki（`accounting` + `pricing_lead`）**
- `/accounting` 四页签正常；`/bids` 302（判断点 3）；项目结算在 `/accounting`「项目结算」页签可见；
- 审批中心只见折扣 / 让利 / 质保邮件类，不见 `tender.*`、`marketing.*`。

**Bob（`owner`）**
- `/` 岗位卡只有：投标（持 `bids` 键时）、营销增长、项目交付、内容（`product_content` 开）；**没有**「询盘销售」「运维与知识」「客服」（`WECHAT_BINDING_ENABLED` 不为 true 时）；
- 「等你拍板」只列 Sunny 原生审批 + 投标（若持键）；点折扣审批落到 `/sales/quote-sheet?mode=order&quoteId=`，点质保邮件落到 `/accounting`；
- `/sales/analytics` 可见（反向修复）；`/revenue`、`/trade/**` 302 → `/`；
- 手机底栏「招投标」仅在持 `bids` 键时出现；
- `/settings` 发信文案不再按 `MENGXIN_ORG_CODE` 硬编码。

**Lucas（`super_admin`）**
- 一切照旧；`/organizations/sunny-home-deco` 成员页可「以 Lynn 的岗位预览」，横幅出现，侧栏 / 首页 / 通知设置与上面 Lynn 的验收一致，任何 POST / PUT 返回 409 `PREVIEW_READONLY`；退出后恢复。

**工程**
- `npm run test:ci` 通过；新增测试全部在 `scripts/test-all.sh` 注册；`npm run typecheck` 通过；
- 源码断言：`src/app/(main)/**/page.tsx` 每一个都命中路由门映射表或白名单；
- `grep` 业务代码无 `role === "sales"` 之类按平台角色拦路由的残留；
- `openspec validate <change>` 通过，specs 增量覆盖：路由门行为（302 目标）、首页卡片可见规则、通知类型可见规则、审批集合规则、预览 cookie 行为与只读 409。

---

## 附录 · 后续队列（不属于本任务书的 change；供 PM 复审落地时逐个 `/opsx:propose`）

来自 `docs/Sunny销售系统_PM复审_2026-11-08.md`「两周内（P0）」一节，按体感收益排序。每条一个 change，Why / What / 验收各一句，细节到 propose 时再展开。

| ID | Why | What | 验收 |
|---|---|---|---|
| U-1 快速报价下线 | 内嵌旧 HTML `public/sunny-quote.html` 与服务端定价分叉（无绳 75" 上限、无 Fauxwood / Allusion），预览金额 ≠ 存库金额 | `quote-sheet` 默认 Tab 改为详细订单；旧 HTML 入口删除；AI 报价录入（`ai-quote-intake`）入口搬进 Order Form | 黄金 158 条在 Order Form 路径全过；`rough-quote-panel.tsx` 删除；仓库无 `sunny-quote.html` 引用 |
| U-2 量房直通详细订单 | 量房页生成的报价无 `formDataJson`，Order Form 要从零重填（`quote-sheet/page.tsx:807`） | 量房保存即产出完整 `formDataJson`；Order Form 加「导入量房」；量房页保存草图（`sketchRef`）、照片、控制侧、安装深度；localStorage 草稿；桌面侧栏加量房入口 | 量房 → 打开详细订单零弹窗零重填；断网保存后恢复不丢 |
| U-3 手工工艺单绑客户 + 状态机收口 | 手工单无 `customerId` 无法排安装（`blinds-orders/[id]/page.tsx:599`）；`confirmed` 可一键「标记完成」跳过安装收款（`page.tsx:93`，PUT 只守 draft / cancelled） | 新建 / 编辑页客户选择器；PUT 不允许跨状态；详情页补「开工」「备货完成」；`completed` 只能从 `installed` 进入 | 隔离库测试：每条非法跃迁 409；手工单可排安装 |
| U-4 安装排期进日历 + 通知安装工 + 客户确认 | 安装预约不调 `syncAppointmentToGoogle`，不通知被分配者，`reminderSentAt` 全仓无人写 | `transition/route.ts` 排期后推 Google 并通知安装工；客户安装日期确认邮件（PendingAction 审批后发）；前一日提醒挂 `daily-brief` | 安装工铃铛 + 日历同时出现；客户邮件先审批；提醒写 `reminderSentAt` |
| U-5 定金方式回 e-Transfer | 加拿大最常用方式被移除，只留兼容旧数据（`deposit-payment-methods.ts:17-28`） | `CURRENT_METHODS` 加回 `etransfer`，登记与会计口径同步 | 定金登记可选 e-Transfer；会计 CSV 正确归类 |
| U-6 客户面英文化 + 公司信息进设置 | 可视化分享页纯中文（`share-viewer.tsx`）；PDF 抬头与客户页品牌不一致且写死（`quote-pdf.ts:77`、`quote/[token]/page.tsx:17`）；税标签 Tax | 分享页接 i18n（EN 默认 / 中 / FR）；公司名、地址读既有品牌事实源 `MarketingBrandProfile`（`src/lib/brand/org-brand-truth.ts` 的 `legalName / addressLine`，`/operations/brand` 页已可编辑）；HST 号落 `Organization.settingsJson.pricing`（既有 JSON 位）；税标签 HST | 分享页英文；PDF 与客户页抬头一致且来自品牌资料；无硬编码地址 |
| U-7 nightly 备份 | 工艺参数 / 收口 / 尾款全在 `AuditLog`，无 pg_dump、Blob 不备份 | `vercel.json` 加 nightly cron 调 Neon 分支快照 API + Blob 清单导出到独立 bucket；失败发站内通知 | 连续 3 天产物存在；恢复演练文档 |
| U-8 导航命名统一 | 「报价」「报价记录」「全部报价」三名一物 | 侧栏「报价工作台」「报价列表」；页内标题同步 | `position-nav.test.ts` 快照更新一次 |
