# Design：通知、设置、搜索、AI 工具按同一张表收口（VIS-1c）

动机见 proposal.md「Why」，对外行为见各 spec 增量。本设计建立在 VIS-1a / 1b 之上：
- 路由门：`src/lib/navigation/route-gate-core.ts`（`ROUTE_GATE_TABLE`、`isRouteAllowed`）。
- 入口判定：`landing.ts`（`canOpenHref`、`visiblePosts`、`resolveLandingPage`）。
- 输入拼装：`filter-context.ts`；服务端 `context-server.ts`（`loadNavigationContextForOrg`）。
- 客户端钩子：`use-navigation-access.ts`（`ready`、`canOpen`、`landingPage`）。

## Context

现状（2026-11-09 在 `claude/vis-1c-notify-settings-search` 上核对，基线为 origin/main 439a19a；#409 尚未合并）：

- **通知类型**：
  - `src/lib/notifications/constants.ts` 登记 30 个类型。开关列表（`notification-type-toggle-list.tsx:6,28`）对所有人列出其中 27 个，只藏 `runtime_failed`、`evaluation_low`、`feedback`。
  - 开关在完整的 `enabledTypes` 上增删（`:15-25`），不在列表里的类型保存时状态不变。
  - 通知页筛选是页内常量 `TYPE_OPTIONS`（`notifications/page.tsx:189-197`），含未登记的 `project_dispatched`「项目分发」与 `quote_promotion_approval`「报价让利审核」。
  - 跳转表 `href.ts` 按 `entityType` 给落点，不看类型。逐个类型核对生产方：
    - `rfq_*`：写 `tender_rfq_round`，落在项目详情的投标页签；只发给项目负责人。
    - `agent_task`：项目 AI 标书包（`agent_task`）与效果图高清渲染完成（`visualizer_session`，发给销售）。
    - `agent_approval`：项目智能体审批写 `approval_request`。Muse 桥（`muse-bridge/events.ts:21-32`，开关 `MUSE_BRIDGE_ENABLED`）把 `approval.requested` / `approval.resolved` 也记成这个类型，发给审批人或提交人（`pending-actions/drafts.ts:409-418`，销售提交草稿时会收到）。跳转表没有这两种 `entityType`，回退到项目详情或无链接。
    - `project_update`：
      - 项目流转、文件、询价轮次、情报监控、采购记录扫描、标书分析写各自的 `entityType`，落在项目详情或无链接；
      - Muse 桥的询问 / 跟进事件也记成这个类型（`entityType: muse_inquiry` → `/sales/inquiries/<id>`，发给销售）。
    - `quote_signed`、`sales_daily_briefing`、`calendar_event`、`system` 的部分生产方不写 `entityType`，通知没有链接。
    - `followup`：写销售客户、商机、外贸线索或任务。`mention`：写任务与项目讨论。`task_assigned`：写任务与 `records_request`。
- **路由门里的项目详情**：`/projects/*` 的规则是 `route-project-detail`，另放行项目成员。持 `project.read` 或运营键的岗位（会计、运营主管、运营、出单）与老板、招投标都打得开，是项目成员的销售也打得开；不是成员的销售打不开。`/bids` 只对招投标与老板放行。
- **设置**：
  - `settings/page.tsx:13,58` 与 `settings/email/page.tsx:22,74` 按 `currentOrg.code === "mengxin-home-textile"` 切换发信文案。
  - 文案里写死 Cathy、QQ、`inquiry@mengxinhometextile.com` 与「切回 Sunny」。
  - 企业列表 `GET /api/organizations` 两条分支用 `include` 查企业（已带 `settingsJson`），响应逐字段列出、不含它；`OrgSummary`（`use-organizations.ts:6-15`）同样没有。
  - `/settings` 的「邮箱绑定」卡片（`settings/page.tsx:234-246`）对所有人显示，但 `/settings/email` 的门规则是 `route-email-settings`：安装工、运营主管、运营、会计、出单、无岗位成员点进去会被弹回落地页。
- **全局搜索**：
  - #409（待合并）修复任务范围被关键词 `OR` 覆盖的问题，引入 `src/lib/search/where.ts` 与 `search-where.test.ts`。
  - 项目范围是 `buildProjectVisibilityWhere`（`visibility.ts:35-65`）：本人所在企业的全部已分发项目，加本人负责的无企业项目与本人参与的项目。
  - 详情页的读判定 `requireProjectReadAccess`（`access.ts:116-165`）只放行负责人、本企业 org_admin（含 org_owner）、项目 active 成员。所以普通成员搜得到、打不开。
  - 不是项目成员的销售打不开项目详情，但仍搜得到全企业项目名。
- **AI 工具表**：
  - `registry.list`（`tool-registry.ts:82-111`）按域、名称、企业禁用、平台角色、org_viewer、风险过滤，不看模块。
  - 模块只在执行期由 `canInvokeTool`（`tool-auth.ts:158`，模块判定在 `:214-225`）用私有的 `toolRequiredModules`（`:77-82`）与 `parseOrgModulesJson(modulesJson)` 判定。
  - 列表调用方：`engine.ts:325,583`（`toOpenAITools`）与 `GET /api/agent-core/tools`。人类对话不传 `allowedToolNames`（`pre-execute-guard.ts:32`），执行期不检查工具是否在本次列表里。
  - 12 个 `marketing_*` 工具 `domain: "system"`、`allowRoles: "*"`（`tools/_policy.ts`），所需模块按域落到 `["operations"]`，销售对话里也挂着。没有 `tender_*` 工具。
- **营销数字员工卡片**：
  - `digital-employee-workbench.tsx:137-146` 用 `canUseMarketingDigitalEmployee(effectiveRole ?? role)`（`marketing/access.ts:52-56`，`role !== "sales"`）。
  - 同一函数还用在营销数字员工接口（`api/marketing/employee/route.ts:38,141`）与微信消息里的营销员工路由（`agent-runtime/process.ts:328`），有测试 `sales-digital-employee-access.test.ts` 与源码断言 `effective-platform-role.test.ts:139-141`。
- **首页时间线（VIS-1b 遗留，代码审查 #4）**：
  - 接口只对管理层（`company-log`「时间线接口与岗位总览同一访问控制」）。
  - `timeline.ts` 三个来源：
    - 审计（本企业）；
    - AI 事件（本企业，`href` 对 `workforce_job` 一律 `/workforce/<runId>`，`:271`）；
    - 自动化运行（`:275-289`，平台级，不按企业）。
  - 自动化行会标出「运维与知识」「询盘销售」等对调用者不可见的岗位名。
  - 每路取 `limit + 1` 条；`mergeTimeline`（`:304-319`）归并后取前 `limit` 条，只在归并结果多于 `limit` 时以本页最后一条作游标。
  - `TimelineLookups.agentRuns` 已带 `metadata.workDomain`（显式工作域）。
  - `CompanyLogDeps` 没有判定输入；`posts-read-model.test.ts:308` 断言只有 posts 路由组装判定输入。
- **「总览」入口（VIS-1b 遗留，代码审查 #5）**：
  - 侧栏 `work-home`（`registry.ts:124-134`，`href: "/"`）没有岗位键，岗位模式下除纯销售（走销售侧栏）外对所有成员可见。
  - 非管理层点进去会被 `/` 按落地规则跳走（会计 → `/accounting`，出单、无岗位、梦馨外贸 → `/tasks`）。
  - 手机通用底栏首格在默认工作区不是安装、运营、招投标时固定为「总览」→ `/`（`mobile-tabs.ts:62`），两种模式相同。
  - 岗位模式的管理层 = 平台 super_admin 或持 `organization.dashboard.read`（`isManagementWorkspaceUser`，`workspace-policy.ts:98-108`）；该键只在 `owner` 模板里（`role-defaults.ts:244`）。导航的 `positionPermissions` 只看键，未绑岗位的 super_admin 不命中。
- **`cockpit/posts-overview`**：「等你 N 件按现成"待我审批"口径并与需要你去重」正文约 1100 字，`openspec validate --specs --strict` 报一条超长告警（VIS-1b 归档时记录）。

## Goals / Non-Goals

**Goals:**

- 通知开关与筛选、`/settings` 卡片、搜索结果、AI 工具列表、营销卡片、时间线链接与「总览」入口，都改用路由门（同一门表、同一输入）回答「这个入口对我放行吗」。
- 工具列表与执行期用同一个模块映射函数、同一份模块输入，列表不再多于执行期。
- 发信文案从写死企业代码改为企业设置，换企业不用改代码。

**Non-Goals（不动的模块 / 文件）：**

- `src/lib/notifications/href.ts`、`header.tsx` 的铃铛图标表、通知生成与投递（`shouldDeliverInApp` 及各生产方，含 Muse 桥）：不改。
- `src/lib/notifications/collab/preferences.ts` 的偏好存储格式：不改。
- `/settings` 内联的「Gmail 邮件发送」面板：标准模式下照旧对所有人显示（它绑定的是登录账号的个人 Gmail，不是一个跳转入口）。
- `/settings/digital-employees`、`/settings/agent-skills`、`/settings/wechat` 卡片的判定：不变。
- `src/lib/marketing/access.ts`：不改。`canUseMarketingDigitalEmployee` 及其在营销员工接口、微信路由里的用法照旧（API 层按模块拦截在 Out of scope）。
- `tool-auth.ts` 的执行期判定顺序与拒绝码；`agents/tool-authorization`「人类调用的过渡回退」：不改。
- `src/lib/workforce-runtime/work-domain.ts`：时间线不调用它逐条解析。
- 审批中心可见集合（VIS-1d）、以岗位预览（VIS-1e）。
- 首页工作量面板、岗位日报。
- 路由门门表（`ROUTE_GATE_TABLE`）：规则不改；`route-gate.test.ts` 快照不变。

## Decisions

### D1 通知类型按「处理页面」判定可见（Q1）

新增 `src/lib/notifications/type-visibility.ts`：
- 常量 `NOTIFICATION_TYPE_ENTRIES: Record<string, readonly string[]>`：每个类型对应一组处理页面（探测路径，动态段用占位 id，如 `/projects/_`）。处理页面取「收件人点开或去处理这类通知的页面」：有跳转的取落点，没跳转的取其工作区。
- 常量 `NOTIFICATION_FILTER_ENTRIES`：给通知页筛选里未登记的两项指定处理页面。
- 纯函数 `visibleNotificationTypes(canOpen)`、`visibleNotificationFilters(canOpen)`。

| 类型 | 处理页面 | 依据 |
|---|---|---|
| `task_due`、`calendar_event`、`followup`、`system`、`mention`、`task_assigned`、`task_status`、`task_comment` | `/tasks` | 任务页登录即可 → 对所有成员可见 |
| `project_update` | `/projects/_`、`/projects/intelligence/monitor`、`/sales/inquiries/_` | 项目流转与情报；Muse 询问事件发给销售 |
| `agent_approval` | `/capabilities/approvals/_` | 项目审批与 Muse 草稿审批都在审批中心处理，详情页对全体成员放行 |
| `agent_task` | `/projects/_`、`/sales/visualizer/_` | 标书包；效果图高清渲染发给销售 |
| `rfq_quote_received`、`rfq_reply_received`、`rfq_chase_ready`、`rfq_no_response` | `/bids` | 只发给投标项目负责人，处理在招投标流程 |
| `quote_signed` | `/sales/quote-sheet` | |
| `sales_daily_briefing` | `/sales/home`、`/sales` | |
| `install_completed`、`install_balance_confirmed`、`install_warranty_sent`、`install_warranty_failed`、`install_repair_*` | `/install`、`/accounting`、`/blinds-orders/_` | 按收件人分别落在会计、维修单、工艺单 |
| `order_stage` | `/blinds-orders/_` | |
| 筛选「项目分发」`project_dispatched` | `/projects/_` | 落在项目详情 |
| 筛选「报价让利审核」`quote_promotion_approval` | `/sales/quote-sheet` | 收件人是超限折扣的审批人（老板，或兜底的企业管理员），审批对象是报价单；通知本身落在审批详情（对全体成员放行，取它会让人人都看到这一项） |

按身份的结果（2026-11-09 用脚本按真实门表计算，Sunny / 梦馨默认模块，岗位模式，微信开关关）：

| 身份 | 看不到的类型 | 筛选里看不到 |
|---|---|---|
| 销售 `sales_rep`（非项目成员）、合价 `pricing_lead` | `rfq_*` | 项目分发 |
| 是项目成员的销售 | `rfq_*` | — |
| 招投标 `bids` | `quote_signed`、`sales_daily_briefing`、`order_stage` | 报价让利审核 |
| 运营主管 `ops_lead`、会计 `accounting`、出单 | `rfq_*`、`quote_signed`、`sales_daily_briefing` | 报价让利审核 |
| 运营 `ops_staff` | `rfq_*`、`install_*`、`quote_signed`、`sales_daily_briefing`、`order_stage` | 报价让利审核 |
| 安装工 `installer` | `rfq_*`、`project_update`、`agent_task`、`quote_signed`、`sales_daily_briefing`、`order_stage` | 项目更新、项目分发、报价让利审核 |
| 无岗位、梦馨外贸 `trade_rep` | 同安装工，另加 `install_*` | 同安装工 |
| 梦馨老板（`owner` + `trade_rep`） | `rfq_*`、`install_*`、`quote_signed`、`order_stage` | 项目分发、报价让利审核 |
| 老板 `owner`、super_admin | 无 | 无 |

被否决：
- 按任务书给每个类型补 `moduleKey`。模块是全企业开的：Sunny 开着 `bids`，按模块判定销售照样看到 `rfq_*`。这也是第二套规则。
- `rfq_*` 取落点 `/projects/_`。项目详情对会计、运营、出单也放行，他们从不收到询价通知，却会看到「催单待批」开关。

### D2 隐藏不改偏好、不停投递（Q2）

开关列表只渲染 `visibleNotificationTypes` 与既有三个隐藏类型的差集，增删照旧作用在完整的 `enabledTypes` 上，所以隐藏类型的存值原样提交。生成、投递、铃铛渲染与跳转都不读这张表。

按 D1 的取法，已知收件人都打得开处理页面，看得到开关。唯一已知例外：不是招投标岗位的人当了投标项目负责人，会收到 `rfq_*` 却看不到其开关，通知照常投递。

被否决：隐藏即关闭投递，或保存时把隐藏类型写成关。这会让一个人换岗位后静默丢通知，而且改的是通知规则（Out of scope）。

### D3 两处 UI 用客户端钩子，未就绪不渲染类型

- `notification-type-toggle-list.tsx`：取 `useNavigationAccess()`。`ready` 为假时显示加载占位，不先列全量再收。
- `notifications/page.tsx`：同上。筛选只列「全部类型」与可见项；当前选中项不可见时回到「全部类型」。

被否决：在服务端把可见类型算好随偏好接口下发。那要改 `/api/notifications/preferences` 的响应形状，钩子已经给出同一判定。

### D4 发信文案读 `settingsJson.ui.senderCopy`，加回填脚本（Q3）

- 新增 `src/lib/settings/sender-copy.ts`：
  - `readSenderCopy(settingsJson) → "platform_relay" | null`：只认这一个值。
  - `withSenderCopy(settingsJson, mode) → 新 settingsJson`：保留其他键；`clear` 时只删 `ui.senderCopy`，`ui` 为空时删 `ui`。
- `GET /api/organizations` 两条分支的响应各多一个 `senderCopy: readSenderCopy(org.settingsJson)`（`include` 已取到，不多查）；`OrgSummary` 加同名可选字段。
- 两页把 `isMengxinOrg` 换成 `currentOrg?.senderCopy === "platform_relay"`。代发文案改为通用写法：
  - 标题「〈企业名〉发信通道」。
  - 正文写「询盘通知与审批后的跟进邮件由平台发信通道以下方『公司发件身份』发出，不使用 Gmail」。
  - 有个人 Gmail 时提示它只是登录账号的个人绑定，不要在此解除。
  - 不再出现 Cathy、QQ、`inquiry@…` 与「Sunny」。
- 新增 `scripts/set-org-sender-copy.ts`，参数与校验照 `scripts/bind-positions.ts`：
  - 运行条件：显式开关 `ALLOW_SENDER_COPY_UPDATE=true`，且 `--actor` 为平台 super_admin；不满足时退出码非 0、不读写企业设置。
  - `--dry-run` 只打印前后值。
  - 写库时用 `src/lib/audit/logger.ts` 记一条审计（`organization.settings.sender_copy`，含前后值）。
- `scripts/seed-org-mengxin-home-textile.ts` 同步写入 `ui.senderCopy = "platform_relay"`，重跑种子不回退。

上线：部署前在生产对梦馨跑一次脚本。没跑的话，梦馨会显示标准的邮箱绑定文案与 Gmail / SMTP 区块。这不影响发信，只是文案错了。

被否决：
- 把整段文案（标题、正文、收件地址）存进 `settingsJson`。这样企业专属文案能保留，但等于往库里放界面文本，还得做编辑入口与转义。
- 保留代码里的梦馨专属文案，只把判定键换成 `senderCopy: "mengxin_relay"`。这仍是给单个租户写死文案。

### D5 「邮箱绑定」卡按 `canOpen("/settings/email")`

`settings/page.tsx` 已是客户端组件，取 `useNavigationAccess()`；卡片只在 `ready && canOpen("/settings/email")` 时渲染。其余卡片不动。安装工、运营主管、运营、会计、出单、无岗位成员不再看到这张卡（他们本来就打不开）。

被否决：卡片一律显示、点进去再跳。这正是 VIS-1 要消除的「点进去被弹回」。

### D6 搜索项目 = 项目详情门 ∧ 详情页读判定（Q4）

- `src/lib/search/where.ts` 新增纯函数 `buildReadableProjectWhere(userId, adminOrgIds)`：
  `{ intakeStatus: "dispatched", OR: [{ ownerId }, { orgId: { in: adminOrgIds } }, { members: { some: { userId, status: "active" } } }] }`。
  它与 `requireProjectReadAccess` 同口径：负责人不限企业，org_admin / org_owner 只看本企业，active 成员只看自己参与的项目。
- `api/search/route.ts`：
  - 平台 super_admin 不判定门（`isRouteAllowed` 本身没有 super_admin 放行），项目与任务两处都不加范围。
  - 其余用户：判定输入 `resolvePreferredOrgId` + `loadNavigationContextForOrg(user, orgId)`；`isRouteAllowed("/projects/_", ctx)` 为假时不查项目，`projects: []`。
  - 项目条件改用 `buildProjectSearchWhere(buildReadableProjectWhere(...), q)`。
  - 任务条件照旧用 `buildProjectVisibilityWhere`（任务范围不变）。
- #409 的源码断言「路由用 `buildProjectSearchWhere(projectWhere, q)`」随之改写。
- 搜索面板（`header.tsx`）不改：项目为空时它本来就不显示项目分组。

被否决：
- 按任务书「持 `project.read` 才搜项目」。是项目成员的销售不持 `project.read`，却打得开自己参与的项目，按键判定会让他搜不到；反过来运营键也能开项目详情。键和路由门是两套口径，结果入口应跟「能不能打开」同源。
- 复用 `buildProjectVisibilityWhere` 再在内存里逐条调 `requireProjectReadAccess`：N 次查询，且 `take: 5` 后再筛会少于 5 条。

### D7 工具列表按模块过滤，与执行期同一函数同一输入（Q5）

- `tool-auth.ts`：
  - 导出 `toolRequiredModules(toolName, domain)`，加一条 `marketing_` 前缀规则 → `["marketing"]`（写法同 `product_content_`）。
  - 把 `:214-225` 抽成导出的纯函数 `toolModulesSatisfied(tool, modulesJson)`，`canInvokeTool` 改调它，拒绝码与判定顺序不变。
- `RegistryFilters` 加 `modulesJson?: unknown`；`list` 调同一个 `toolModulesSatisfied`。解析为 null 时不按模块过滤，与执行期一致。
- `engine.ts` 两处 `toOpenAITools` 传 `modulesJson: options.modulesJson`，即执行期 `ctx.modulesJson` 的来源（`engine.ts:172,249`）。
- `GET /api/agent-core/tools` 按 `resolvePreferredOrgId` 查该企业 `modulesJson` 传入。
- 测试除「列表 = 执行期」外，另写具体期望（只启用 `sales` 时没有 `trade_*`、`marketing_*`、`project_*`），避免两边调同一函数时测试同义反复。

被否决：在 `tool-registry.ts` 复制一份域 → 模块表。任务书明确不复制，复制会漂移。

### D8 人类对话的营销工具另要「品牌增长」入口（Q5）

- `RegistryFilters` 加 `entryGate?: { marketing: boolean }`。值为 `{ marketing: false }` 时剔除 `marketing_*`；缺省不限制。`AgentRunOptions`（`agent-core/types.ts`）加同名可选字段，由 engine 转给列表。
- 给人用的三个入口传入，值为 `{ marketing: isSuperAdmin || isRouteAllowed("/marketing", ctx) }`，判定输入用该请求企业的 `loadNavigationContextForOrg`：
  - `api/ai/threads/[threadId]/messages/route.ts`
  - `api/agent-core/chat/route.ts`
  - `GET /api/agent-core/tools`
- 外贸对话（`trade/chat-assistant.ts:279`）也是人类入口，但只取 trade / secretary 域，到不了 `marketing_*`，不传。
- 数字员工与后台运行（`agent-runtime/process.ts`、技能运行、提及网关）不传，行为不变。它们的工具按数字员工岗位的所需权限判定（`agents/tool-authorization`「数字员工调用只认所需权限」）。
- 执行期不加这道门：人类调用仍按「人类调用的过渡回退」只看平台角色。人类对话不传 `allowedToolNames`，所以模型若调用列表外的 `marketing_*`，执行期不会拦（见 Q5）。

被否决：
- 把 `marketing_*` 的 `allowRoles` 从 `"*"` 改成角色列表。岗位模式下派生平台角色不区分运营与会计，挡不住会计。
- 新增营销权限键。硬纪律「不新增权限键」。
- 本期给人类对话加「只许调用本次列表里的工具」的执行期白名单。它会同时影响全部工具与运行级临时工具，范围超出本 change。

### D9 营销数字员工卡片按 `canOpen("/marketing/employee")`（Q6）

工作台取 `useNavigationAccess()`，卡片条件改为 `canOpen("/marketing/employee")`（钩子对 super_admin 一律放行）。`canUseMarketingDigitalEmployee` 本身保留：营销员工接口与微信路由仍用它，测试不变。
- 源码断言放在 `entry-visibility.test.ts`（与 spec 场景同处）。
- `residual-reads.test.ts:163` 去掉对营销入口的 `effectiveRole` 断言；它对应的「前端按派生角色显示业务模块」随之 MODIFIED（D13）。

被否决：按任务书写「`marketing` 模块 ∧ 营销键」的新表达式。`/marketing` 的门规则 `growth-hub` 已经是模块 ∧ 岗位键（`registry.ts:867-877`），按页面判定就是这个口径。

### D10 时间线按可见岗位与可读作业收口（Q7，VIS-1b 遗留 #4）

- `posts-read-model.ts`：
  - `CompanyLogDeps` 照 `PostsCockpitDeps`（`:209`）加 `navContext(viewer): Promise<RouteGateContext>`，时间线路由与岗位总览共用 `resolveCockpitNavContext(viewer)`；改掉 `:429` 那句「只由 posts 路由调用」的注释。
  - 自动化来源在查询里过滤：`visibleKeys = ctx.isPlatformAdmin ? null : visibleAutomationKeys(ctx)`，`automationRunTimelineWhere(window, lowFrequencyKeys, visibleKeys)` 在 `AND` 里加 `{ automationKey: { in: visibleKeys } }`，null 时不加。super_admin 要单独放行，因为微信开关关时 `visiblePosts` 对 super_admin 也不含「客服」，否则 `service-inbox-sla` 会被滤掉。
  - `isTimelineAutomationRun`（`:788`）与查询里的条件同口径，不会再滤掉查询放进来的行。
- `landing.ts` 新增 `visibleAutomationKeys(ctx)`：可见岗位的 `automationKeys` 并集。岗位 → 自动化归属是注册表常量，查询内过滤后每路仍取 `limit + 1` 条，翻页不重复不遗漏。
- `timeline.ts` 的 AI 事件行：`workforce_job` 的 `href` 按 `canReadWorkDomain(asWorkDomain(run.workDomain), ctx)` 给出；没有显式工作域的旧作业只在 `readsEveryWorkDomain(ctx)` 时给出（否则详情页按有效工作域解析可能 404）。
- 审计行不过滤：它们来自本企业，岗位不可见不等于事情与调用者无关。
- `org-cockpit-view.tsx` 的 `CompanyLog`：岗位格只在 `post` 出现在 `posts` 里时显示名字。`post` 为空照旧显示「未归属」。
- 改测试：
  - `posts-read-model.test.ts:308`：posts 与 timeline 两个路由组装判定输入，workload 不组装。
  - `posts-read-model.test.ts:356-380`：mock 补 `navContext`；其中 `href === "/workforce/run-1"`（销售域作业）的断言要求调用者可读销售域，按此设判定输入。

被否决：
- 查出来后再在内存里过滤自动化行。被滤掉的行仍占 `limit + 1` 的名额，游标会越过后面可见的行，违反「翻页 SHALL NOT 重复或遗漏」。
- 为每条 AI 事件调用 `resolveEffectiveWorkDomain`。一页最多几十次查库；旧作业链接只对可读全部工作域的人出现，作业本身仍在 `/workforce` 列表里。
- 审计行也按岗位过滤。老板会看不到本企业归到「询盘销售」的折扣审批记录，和 VIS-1b Q1 的取舍相反。

### D11 「管理总览」只对管理层，底栏首格指向落地页（Q8，VIS-1b 遗留 #5）

- `NavigationItem` 加可选字面量 `managementOnly: true`（代码常量）。`filter.ts` 的 `positionPermissionOk` 在岗位模式下遇到它时返回 `isManagementWorkspaceUser(navWorkspaceCtx(ctx))`（同 `tradeEntry` 的写法），所以未绑岗位的 super_admin 仍看得到。`work-home` 标上它。旧模式不变。
- `mobile-tabs.ts`：通用布局在默认工作区不是 `/install`、`/ops`、`/bids` 时，首格按 `resolveLandingPage(ctx)` 取：`/tasks` →「任务」，`/accounting` →「会计」，其余情况仍为「总览」→ `/`。两种模式相同（旧模式下这类成员的落地页还可能是 `/ops`、`/bids` 等，那些照旧显示「总览」，进去后按落地规则跳转）。
- `mobile-tab-bar.tsx`：`TAB_ICONS` 与 `tabMatch`（`:31-73`）补两个新页签键 `tasks`、`accounting`。
- 路由门对 `/` 仍是登录即可（`/=`），不改。
- 受影响快照：`position-nav.test.ts` 非管理层侧栏去掉 `work-home`；`entry-visibility.test.ts` 的底栏首格按身份更新。

被否决：
- `work-home` 用 `positionPermissions: [...POSITION_MGMT]`。它只看键，未绑岗位的 super_admin 会丢掉这一项，和「岗位模式的管理层」不一致。
- 首格对非管理层直接去掉。底栏会只剩一两个页签，入口反而更少。

### D12 拆分「等你 N 件」规格（Q9）

用 REMOVED + ADDED 拆成四条：「组成与去重」「计数与截断」「销售与安装审批的落点」「其余审批的落点」。原有 8 个场景按内容分配，每条的首个场景写明测试命令，其余文字不变。不用 MODIFIED：MODIFIED 必须保留整条正文和全部场景，拆不开。代码与 `waiting.test.ts` 不改。

### D13 既有规格的连带修改

本 change 让下面几条既有规格的字面不再成立，用 MODIFIED 改写，正文与场景名不变，只加前提或例外：

- `authorization/position-mode-residual-reads`「前端按派生角色显示业务模块」：营销数字员工入口不再按 `effectiveRole`，改指 entry-visibility。
- `identity/wechat-entry`「设置页微信入口」：「邮箱绑定」不显示时微信卡片照旧在该位置；场景加「`/settings/email` 对其放行」。
- `tender/rfq-notifications`「四个询价通知类型」、`notifications/activity-events`「新增五个通知类型」：场景「设置页列出新类型」加「处理页面对其放行的用户」。
- `navigation/position-based-visibility`「岗位模式判定」：旧模式例外清单加「底栏首格指向落地页」。
- `cockpit/company-log`「来源范围有界」两个场景、「条目的岗位归属只用结构化字段」一个场景：加调用者前提（D10）。

被否决：不改这些规格，靠新 capability 覆盖。归档后主规格会同时有两条相反的要求。

## 与八条硬纪律的关系

1. 零 schema：不改 Prisma。发信文案落在既有 `Organization.settingsJson`；处理页面对照、模块映射、`managementOnly` 都是代码常量。
2. 出站先审批：不涉及。发信文案只改说明文字，不改发信通道与审批。营销工具剔除只缩小列表，不放宽执行。
3. 禁止第三套队列：不涉及，不新增队列或 cron。
4. 脱敏：
   - 企业列表只透出 `senderCopy` 一个已知值，不透出 `settingsJson`。
   - 代发文案去掉写死的人名与邮箱。
   - 时间线摘要沿用 `redactCockpitText`。
5. 不爬登录页：不涉及。
6. 邮箱分离：不改。代发企业照旧不显示 Gmail / SMTP 绑定区块，提示个人 Gmail 不用于该企业发信。
7. 确定性优先：处理页面对照、模块映射、落地页、读判定都是查表与纯函数，零 LLM 调用。
8. 测试注册：新增测试在各自 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，`bash scripts/check-test-registry.sh` 通过：
   - `src/lib/notifications/__tests__/type-visibility.test.ts`
   - `src/lib/settings/__tests__/sender-copy.test.ts`
   - `src/lib/agent-core/__tests__/tool-list-modules.test.ts`

   既有的 `timeline.test.ts`、`posts-read-model.test.ts`、`search-where.test.ts` 只加或改用例。

## Risks / Trade-offs

- [梦馨文案依赖生产回填] → 部署前跑脚本（D4）。没跑时只是文案回到标准模式，不影响发信；报告给出命令。
- [代发文案变通用，少了 Cathy / QQ / 询盘地址] → 发件身份仍由下方「公司发件身份」卡片显示；询盘收件人是梦馨的业务事实，不该写在通用界面里。
- [销售仍看得到 `agent_*` 与 `project_update`] → 任务书验收写「无 `agent_*`」。销售确实会收到效果图渲染完成（`agent_task`）、Muse 草稿审批（`agent_approval`）与 Muse 询问（`project_update`），藏掉开关就关不掉它们。见 Q1。
- [任务结果仍带项目名] → 任务范围不变：本企业项目里的任务照旧搜得到，结果行带项目名，即使该项目本人打不开。收窄任务范围不在任务书内；见 Q4。
- [负责人与成员的项目可跨企业] → `buildReadableProjectWhere` 与详情页同口径：本人负责或参与的其他企业项目也搜得到（打得开）。项目详情门只按当前企业判定一次。
- [搜索与人类对话各多一次判定输入查询] → `loadNavigationContextForOrg` 是 4 次查询加岗位绑定解析。搜索面板已有 300 ms 防抖；人类对话每轮一次。
- [人类对话可越过列表调用营销工具] → 见 D8 末条与 Q5。
- [时间线少了平台级运行] → Sunny 老板看不到归在「询盘销售」「运维与知识」下的自动化行：`daily-brief`、`sales-action-sync`、`wechat-push`、`inquiry-sla`、`calendar-watch`、`muse-reminder-scan`、`approval-timeout`、`post-daily-digest`、`notify-email-*` 等。它们是平台级运行，不分企业，失败也不是某个企业的事；平台管理员照旧全部看得到。见 Q7。
- [零可见卡的管理层] → 侧栏仍有「管理总览」，点进去落 `/tasks`（VIS-1b Q6）；底栏首格随落地页变「任务」。
- [既有断言要改] → `wechat-entry-render.test.tsx`（设置页结构）、`residual-reads.test.ts:163`、`posts-read-model.test.ts:308,356-380`、`position-nav.test.ts`、`entry-visibility.test.ts` 底栏、`search-where.test.ts` 路由源码断言、`collab-preferences.test.ts`（若断言开关列表全量）。

## 验证方式

开工前的受影响测试基线见 tasks.md 开头（12 份，2026-11-09 实测）。新测试见「与八条硬纪律的关系」第 8 条。

门禁：
- `npm run test:ci`、`npm test`（13 个环境类失败与 origin/main 相同）。
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx next build --webpack`。
- `openspec validate vis-1c-notify-settings-search --strict`。归档后 `openspec validate --specs --strict` 的超长告警从 3 条变 2 条（剩 `authorization/position-catalog`、`sunny/process-order-autogen`，不在本 change 范围）。

## 审核关注点（偏离或补充任务书之处，请拍板）

拍板结果（Lucas 2026-11-10）：Q1–Q9 全部按推荐执行。

- Q1（D1）：通知类型按「处理页面经路由门放行」判定，不按任务书写的「每个类型补 `moduleKey`」。
  - 理由：模块是全企业开的，Sunny 开着 `bids`，按模块判定销售照样看到 `rfq_*`。
  - `rfq_*` 的处理页面取招投标中心，不取落点项目详情，否则会计、运营、出单都会看到询价开关。
  - 与任务书验收的差异：销售仍看得到 `agent_task`、`agent_approval`、`project_update` 与筛选「项目更新」，因为她们会收到这几类通知（见 Risks）。只藏 `rfq_*` 与「项目分发」。
  - 另一选择：照任务书把 `agent_*`、`project_update` 也对销售藏掉，代价是销售关不掉自己会收到的通知。
- Q2（D2）：隐藏类型保留偏好、照常投递。另一选择是隐藏即停投，那会改通知规则。
- Q3（D4）：发信文案用企业设置里的一个枚举值加通用文案，梦馨专属的人名与邮箱从界面去掉；部署前需在生产跑一次回填脚本。另一选择是把整段文案存进企业设置。
- Q4（D6）：搜索项目按「项目详情门 ∧ 详情页读判定」，不按任务书写的「持 `project.read`」。
  - 理由：是项目成员的销售不持 `project.read` 却打得开自己参与的项目；键和门不同源。
  - 结果：普通成员从「全企业项目」收窄为「自己负责或参与的项目」；不是项目成员的销售搜不到项目。
  - 任务结果的范围与其中的项目名不变（任务书「任务范围不变」）。
- Q5（D7、D8）：
  - `marketing_*` 所需模块从 `operations` 改为 `marketing`，Sunny 与梦馨都开着，执行期不受影响。
  - 「品牌增长」入口只加在人类对话的工具列表上。数字员工与后台运行不受影响。
  - 执行期不加门：模型若调用列表外的营销工具（列表里没有，正常不会发生），仍会按平台角色执行。要堵这一口需加「只许调用本次列表里的工具」的执行期白名单，建议另立。
  - 任务书写的 `tender_*` 工具不存在，无需处理。
- Q6（D9）：营销卡片按营销数字员工页的门判定；`canUseMarketingDigitalEmployee` 保留给营销员工接口与微信路由，接口层不动。
- Q7（D10）：
  - 时间线的自动化行在查询里按可见岗位过滤，Sunny 老板因此看不到「询盘销售」「运维与知识」下的平台级运行（含 `daily-brief`、`sales-action-sync` 等也服务 Sunny 的自动化）。
  - 审计行不按岗位过滤，只藏岗位名。
  - 没有显式工作域的旧作业只对可读全部工作域的人带链接。
- Q8（D11）：
  - 岗位模式下「管理总览」只对管理层（平台 super_admin 或持 `organization.dashboard.read`，即 `owner`）出现。**BREAKING**：非管理层侧栏少一项。
  - 底栏首格在落地页为 `/tasks` 或 `/accounting` 时改指落地页，两种模式都生效：会计「会计」；出单、无岗位、梦馨外贸「任务」；其余仍「总览」。
- Q9（D12）：「等你 N 件」拆成四条而不是两条，因为落点表单独一条仍超 500 字。
