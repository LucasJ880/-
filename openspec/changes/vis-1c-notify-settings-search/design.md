# Design：通知、设置、搜索、AI 工具按同一张表收口（VIS-1c）

动机见 proposal.md「Why」，对外行为见各 spec 增量。本设计建立在 VIS-1a / 1b 之上：
- 路由门：`src/lib/navigation/route-gate-core.ts`（`ROUTE_GATE_TABLE`、`isRouteAllowed`）。
- 入口判定：`landing.ts`（`canOpenHref`、`visiblePosts`、`resolveLandingPage`）。
- 输入拼装：`filter-context.ts`；服务端 `context-server.ts`（`loadNavigationContextForOrg`）。
- 客户端钩子：`use-navigation-access.ts`（`ready`、`canOpen`、`landingPage`）。

## Context

现状（2026-11-09 在 `claude/vis-1c-notify-settings-search` 上核对，基线为 origin/main 439a19a）：

- **通知类型**：
  - `src/lib/notifications/constants.ts` 登记 30 个类型。开关列表（`notification-type-toggle-list.tsx:6,28`）对所有人列出其中 27 个，只藏 `runtime_failed`、`evaluation_low`、`feedback`。
  - 开关在完整的 `enabledTypes` 上增删（`:15-25`），不在列表里的类型保存时状态不变。
  - 通知页筛选是页内常量 `TYPE_OPTIONS`（`notifications/page.tsx:189-197`），含未登记的 `project_dispatched`「项目分发」与 `quote_promotion_approval`「报价让利审核」。
  - 跳转表 `href.ts` 按 `entityType` 给落点，不看类型。逐个类型核对生产方写的 `entityType`：
    - `agent_task`：项目 AI 标书包（`agent_task`）与效果图高清渲染（`visualizer_session`，发给销售）。
    - `agent_approval`：只写 `approval_request`；跳转表没有这一项，回退到项目详情。
    - `rfq_*`：写 `tender_rfq_round`，落在项目详情的投标页签。
    - `project_update`：写 `project`、`project_files`、`tender_rfq_round`、`tender_watch`、`procurement_scan_run`、`tender_analysis_run`，落在项目详情或情报页。
    - `followup`：写销售客户、商机、外贸线索或任务。`mention`：写任务与项目讨论。`task_assigned`：写任务与 `records_request`。
- **设置**：
  - `settings/page.tsx:13,58` 与 `settings/email/page.tsx:22,74` 按 `currentOrg.code === "mengxin-home-textile"` 切换发信文案。
  - 文案里写死 Cathy、QQ、`inquiry@mengxinhometextile.com` 与「切回 Sunny」。
  - 企业列表 `GET /api/organizations` 两条分支都逐字段列出响应，不含 `settingsJson`；`OrgSummary`（`use-organizations.ts:6-15`）同样没有。
  - `/settings` 的「邮箱绑定」卡片（`settings/page.tsx:234-246`）对所有人显示，但 `/settings/email` 的门规则是 `route-email-settings`：安装工、出单、无岗位成员点进去会被弹回落地页。
- **全局搜索**：
  - #409 修好了任务范围被关键词 `OR` 覆盖的问题，引入 `src/lib/search/where.ts`。
  - 项目范围仍是 `buildProjectVisibilityWhere`（`visibility.ts:35-65`）：本人所在企业的全部已分发项目。
  - 详情页的读判定 `requireProjectReadAccess`（`access.ts:116-165`）只放行负责人、本企业 org_admin（含 org_owner）、项目 active 成员。所以普通成员搜得到、打不开。
  - 销售按 VIS-1a 打不开项目详情，但仍搜得到全企业项目名。
- **AI 工具表**：
  - `registry.list`（`tool-registry.ts:82-111`）按域、名称、企业禁用、平台角色、org_viewer、风险过滤，不看模块。
  - 模块只在执行期由 `tool-auth.ts:214-225` 用私有的 `toolRequiredModules`（`:77-82`）与 `parseOrgModulesJson(modulesJson)` 判定。
  - 列表调用方：`engine.ts:325,583`（`toOpenAITools`）与 `GET /api/agent-core/tools`。
  - 12 个 `marketing_*` 工具 `domain: "system"`、`allowRoles: "*"`（`tools/_policy.ts`），所需模块按域落到 `["operations"]`，销售对话里也挂着。没有 `tender_*` 工具。
- **营销数字员工卡片**：
  - `digital-employee-workbench.tsx:137-146` 用 `canUseMarketingDigitalEmployee(effectiveRole ?? role)`（`marketing/access.ts:52-56`，`role !== "sales"`）。
  - 该函数只有这一个调用方；营销接口用同文件的 `requireMarketingReadAccess`，不用它。
- **首页时间线（VIS-1b 遗留，代码审查 #4）**：
  - `timeline.ts` 三个来源：
    - 审计（本企业）；
    - AI 事件（本企业，`href` 对 `workforce_job` 一律 `/workforce/<runId>`，`:271`）；
    - 自动化运行（`:275-289`，平台级，不按企业）。
  - 自动化行会标出「运维与知识」「询盘销售」等对调用者不可见的岗位名。
  - `TimelineLookups.agentRuns` 已带 `metadata.workDomain`（显式工作域）。
  - `CompanyLogDeps` 没有判定输入；`posts-read-model.test.ts:308` 断言只有 posts 路由组装判定输入。
- **「总览」入口（VIS-1b 遗留，代码审查 #5）**：
  - 侧栏 `work-home`（`registry.ts:124-134`，`href: "/"`）没有岗位键，岗位模式下对所有成员可见。
  - 非管理层点进去会被 `/` 按落地规则跳走（会计 → `/accounting`，出单、无岗位、梦馨外贸 → `/tasks`）。
  - 手机通用底栏首格在默认工作区不是安装、运营、招投标时固定为「总览」→ `/`（`mobile-tabs.ts:62`）。
  - 岗位模式下 `organization.dashboard.read`（`POSITION_MGMT`）只在 `owner` 模板里（`role-defaults.ts:244`）。
- **`cockpit/posts-overview`**：「等你 N 件按现成"待我审批"口径并与需要你去重」正文约 1100 字，`openspec validate --specs --strict` 报一条超长告警（VIS-1b 归档时记录）。

## Goals / Non-Goals

**Goals:**

- 通知开关与筛选、`/settings` 卡片、搜索结果、AI 工具列表、营销卡片、时间线链接与「总览」入口，都改用路由门（同一门表、同一输入）回答「这个入口对我放行吗」。
- 工具列表与执行期用同一个模块映射函数、同一份模块输入，列表不再多于执行期。
- 发信文案从写死企业代码改为企业设置，换企业不用改代码。

**Non-Goals（不动的模块 / 文件）：**

- `src/lib/notifications/href.ts`、`header.tsx` 的铃铛图标表、通知生成与投递（`shouldDeliverInApp` 及各生产方）：不改。
- `src/lib/notifications/collab/preferences.ts` 的偏好存储格式：不改。
- `/settings` 内联的「Gmail 邮件发送」面板：标准模式下照旧对所有人显示（它绑定的是登录账号的个人 Gmail，不是一个跳转入口）。
- `/settings/digital-employees`、`/settings/agent-skills`、`/settings/wechat` 卡片的判定：不变。
- `src/lib/marketing/access.ts` 的 `requireMarketingReadAccess` / `requireMarketingWriteAccess`：不改（API 层按模块拦截在 Out of scope）。
- `tool-auth.ts` 的执行期判定顺序与拒绝码；`agents/tool-authorization`「人类调用的过渡回退」：不改。
- `src/lib/workforce-runtime/work-domain.ts`：时间线不调用它逐条解析。
- 审批中心可见集合（VIS-1d）、以岗位预览（VIS-1e）。
- 首页工作量面板、岗位日报。
- 路由门门表（`ROUTE_GATE_TABLE`）：规则不改；`route-gate.test.ts` 快照不变。

## Decisions

### D1 通知类型的入口 = 它的通知会落到的页面（Q1）

新增 `src/lib/notifications/type-visibility.ts`：
- 常量 `NOTIFICATION_TYPE_ENTRIES: Record<string, readonly string[]>`，每个类型对应一组探测路径。路径按「该类型各生产方写的 `entityType` 经跳转表落到的页面」取并集，含动态段时用占位 id（如 `/projects/_`）。
- 纯函数 `visibleNotificationTypes(canOpen)`：返回任一入口 `canOpen` 为真的类型。
- 通知页筛选另有常量 `NOTIFICATION_FILTER_ENTRIES`，给未登记的两项指定入口：「项目分发」→ `/projects`，「报价让利审核」→ `/capabilities/approvals/_`。

| 类型 | 入口 | 说明 |
|---|---|---|
| `task_due`、`calendar_event`、`followup`、`system`、`mention`、`task_assigned`、`task_status`、`task_comment` | `/tasks`（另列各自的业务页） | 任务页登录即可 → 对所有成员可见 |
| `project_update` | `/projects/_`、`/projects/intelligence/monitor` | |
| `agent_approval` | `/projects/_` | 跳转表无 `approval_request`，回退项目详情 |
| `rfq_quote_received`、`rfq_reply_received`、`rfq_chase_ready`、`rfq_no_response` | `/projects/_` | 落在项目详情投标页签 |
| `agent_task` | `/projects/_`、`/sales/visualizer/_` | 效果图高清渲染完成会发给销售 |
| `quote_signed` | `/sales/quote-sheet` | |
| `sales_daily_briefing` | `/sales/home`、`/sales` | |
| `install_completed`、`install_balance_confirmed`、`install_warranty_sent`、`install_warranty_failed`、`install_repair_*` | `/install`、`/accounting`、`/blinds-orders/_` | 按收件人分别落在会计、维修单、工艺单 |
| `order_stage` | `/blinds-orders/_` | |

被否决：
- 按任务书给每个类型补 `moduleKey`。那是第二套规则：例如 `rfq_*` 记 `bids` 模块后，Sunny 全员都会看到，因为模块是全企业开的。它也和「看得见 ⇔ 打得开」脱节。
- 用 `/bids` 当 `rfq_*` 的入口。`rfq_*` 的通知实际落在项目详情；入口取落点，才和点开后能不能打开一致。

### D2 隐藏不改偏好、不停投递（Q2）

开关列表只渲染 `visibleNotificationTypes` 与既有三个隐藏类型的差集，增删照旧作用在完整的 `enabledTypes` 上，所以隐藏类型的存值原样提交。生成、投递、铃铛渲染与跳转都不读这张表。

被否决：
- 隐藏即关闭投递，或保存时把隐藏类型写成关。这会让一个人换岗位后静默丢通知，而且改的是通知规则（Out of scope）。
- 本期不做「收到了但看不到开关」的补救。按 D1 的入口取法，收件人能打开落点就看得见开关。

### D3 两处 UI 用客户端钩子，未就绪不渲染类型

- `notification-type-toggle-list.tsx`：取 `useNavigationAccess()`。`ready` 为假时显示加载占位，不先列全量再收。
- `notifications/page.tsx`：同上。筛选只列「全部类型」与可见项；当前选中项不可见时回到「全部类型」。

被否决：在服务端把可见类型算好随偏好接口下发。那要改 `/api/notifications/preferences` 的响应形状，钩子已经给出同一判定。

### D4 发信文案读 `settingsJson.ui.senderCopy`，加回填脚本（Q3）

- 新增 `src/lib/settings/sender-copy.ts`：
  - `readSenderCopy(settingsJson) → "platform_relay" | null`：只认这一个值。
  - `withSenderCopy(settingsJson, mode) → 新 settingsJson`：保留其他键；`clear` 时只删 `ui.senderCopy`，`ui` 为空时删 `ui`。
- `GET /api/organizations` 两条分支各多查 `settingsJson`，响应只多一个 `senderCopy: readSenderCopy(settingsJson)`；`OrgSummary` 加同名可选字段。
- 两页把 `isMengxinOrg` 换成 `currentOrg?.senderCopy === "platform_relay"`。代发文案改为通用写法：
  - 标题「〈企业名〉发信通道」。
  - 正文写「询盘通知与审批后的跟进邮件由平台发信通道以下方『公司发件身份』发出，不使用 Gmail」。
  - 有个人 Gmail 时提示它只是登录账号的个人绑定，不要在此解除。
  - 不再出现 Cathy、QQ、`inquiry@…` 与「Sunny」。
- 新增 `scripts/set-org-sender-copy.ts`：照 `scripts/bind-positions.ts` 的写法：
  - 运行条件：显式开关 `ALLOW_SENDER_COPY_UPDATE=true`，且 `--actor` 为平台 super_admin。
  - `--dry-run` 只打印前后值。
  - 写库时记一条 `auditLog`（`organization.settings.sender_copy`）。
- `scripts/seed-org-mengxin-home-textile.ts` 同步写入 `ui.senderCopy = "platform_relay"`，重跑种子不回退。

上线：部署前在生产对梦馨跑一次脚本。没跑的话，梦馨会显示标准的邮箱绑定文案与 Gmail / SMTP 区块。这不影响发信，只是文案错了。

被否决：
- 把整段文案（标题、正文、收件地址）存进 `settingsJson`。这样企业专属文案能保留，但等于往库里放界面文本，还得做编辑入口与转义。
- 保留代码里的梦馨专属文案，只把判定键换成 `senderCopy: "mengxin_relay"`。这仍是给单个租户写死文案。

### D5 「邮箱绑定」卡按 `canOpen("/settings/email")`

`settings/page.tsx` 已是客户端组件，取 `useNavigationAccess()`；卡片只在 `ready && canOpen("/settings/email")` 时渲染。其余卡片不动。

被否决：卡片一律显示、点进去再跳。这正是 VIS-1 要消除的「点进去被弹回」。

### D6 搜索项目 = 读判定 ∧ 项目详情门（Q4）

- `src/lib/search/where.ts` 新增纯函数 `buildReadableProjectWhere(userId, adminOrgIds)`：
  `{ intakeStatus: "dispatched", OR: [{ ownerId }, { orgId: { in: adminOrgIds } }, { members: { some: { userId, status: "active" } } }] }`。
  它与 `requireProjectReadAccess` 同口径：负责人不限企业，org_admin / org_owner 只看本企业，active 成员只看自己参与的项目。
- `api/search/route.ts`：
  - 判定输入：`resolvePreferredOrgId` + `loadNavigationContextForOrg(user, orgId)`；`isRouteAllowed("/projects/_", ctx)` 为假时不查项目，`projects: []`。
  - 项目条件改用 `buildProjectSearchWhere(buildReadableProjectWhere(...), q)`。
  - 任务条件照旧用 `buildProjectVisibilityWhere`（任务范围不变）。
  - super_admin 两处都不加范围。
- 搜索面板（`header.tsx`）不改：项目为空时它本来就不显示项目分组。

被否决：
- 按任务书「持 `project.read` 才搜项目」。键和门是两套口径：会计持 `project.read` 却打不开项目详情（VIS-1a 判断点 3），会搜到打不开的项目。
- 复用 `buildProjectVisibilityWhere` 再在内存里逐条调 `requireProjectReadAccess`：N 次查询，且 `take: 5` 后再筛会少于 5 条。

### D7 工具列表按模块过滤，与执行期同一函数同一输入（Q5）

- `tool-auth.ts` 导出 `toolRequiredModules(toolName, domain)`，并加一条 `marketing_` 前缀规则 → `["marketing"]`（写法同 `product_content_`）。
- `RegistryFilters` 加 `modulesJson?: unknown`。`list` 用 `parseOrgModulesJson(modulesJson)` 与同一个 `toolRequiredModules` 过滤；解析为 null 时不按模块过滤，与执行期一致。
- `engine.ts` 两处 `toOpenAITools` 传 `modulesJson: options.modulesJson`，就是执行期 `ctx.modulesJson` 的来源（`engine.ts:172,249`）。
- `GET /api/agent-core/tools` 按 `resolvePreferredOrgId` 查该企业 `modulesJson` 传入。
- 测试：对每个已注册工具与若干模块组合，把 `list` 结果与执行期模块判定逐一比对。执行期判定抽成导出的纯函数 `toolModulesSatisfied(tool, modulesJson)`，`canInvokeTool`（`tool-auth.ts:158`）与 `list` 都调它。

被否决：在 `tool-registry.ts` 复制一份域 → 模块表。任务书明确不复制，复制会漂移。

### D8 营销工具另要「品牌增长」入口（Q5）

- `RegistryFilters` 加 `entryGate?: { marketing: boolean }`。值为 `{ marketing: false }` 时剔除 `marketing_*`；缺省不限制。
- 给人用的两个对话入口传入：`api/ai/threads/[threadId]/messages/route.ts`、`api/agent-core/chat/route.ts`，以及 `GET /api/agent-core/tools`。值为 `{ marketing: isSuperAdmin || isRouteAllowed("/marketing", ctx) }`，判定输入用该请求企业的 `loadNavigationContextForOrg`。
- 数字员工与后台运行（`agent-runtime/process.ts`、技能运行、提及网关）不传，行为不变。它们的工具按数字员工岗位的所需权限判定（`agents/tool-authorization`「数字员工调用只认所需权限」）。
- 执行期不加这道门。人类调用按「人类调用的过渡回退」只看平台角色；列表里没有的工具模型不会调用。

被否决：
- 把 `marketing_*` 的 `allowRoles` 从 `"*"` 改成角色列表。岗位模式下派生平台角色不区分运营与会计，挡不住会计。
- 新增营销权限键。硬纪律「不新增权限键」。

### D9 营销数字员工卡片按 `canOpen("/marketing/employee")`（Q6）

工作台取 `useNavigationAccess()`，卡片条件改为 `canOpen("/marketing/employee")`（钩子对 super_admin 一律放行）。删除只剩这一个调用方的 `canUseMarketingDigitalEmployee`。`residual-reads.test.ts:163` 改为断言工作台按该页面判定。

被否决：按任务书写「`marketing` 模块 ∧ 营销键」的新表达式。`/marketing` 的门规则 `growth-hub` 已经是模块 ∧ 岗位键（`registry.ts:867-877`），按页面判定就是这个口径。

### D10 时间线按可见岗位与可读作业收口（Q7，VIS-1b 遗留 #4）

- `posts-read-model.ts`：`CompanyLogDeps` 加 `navContext: RouteGateContext | null`（null = super_admin，不限制）。时间线路由与岗位总览共用 `resolveCockpitNavContext(viewer)`。
- `timeline.ts`：
  - 自动化行：只保留 `postForAutomation` 非空且在 `visiblePosts(ctx)` 里的。该来源是平台级的，按岗位收口是唯一能做的过滤。
  - AI 事件行：`workforce_job` 的 `href` 只在 `canReadWorkDomain(asWorkDomain(run.workDomain), ctx)` 时给出。缺显式工作域的旧作业按「解析不出」判定（只对管理层可读）。
  - 审计行：不过滤。它们来自本企业，岗位不可见不等于事情与调用者无关。
- 游标：过滤发生在组装条目之后、截断之前。自动化来源多取的条数不变，被过滤掉的条目不占页长，一页可能少于 `limit`，`nextCursor` 照旧由三源中最旧的已取条目给出。
- `org-cockpit-view.tsx` 的 `CompanyLog`：岗位格只在 `post` 出现在 `posts` 里时显示名字。`post` 为空照旧显示「未归属」。
- `posts-read-model.test.ts:308` 的断言改为：posts 与 timeline 两个路由组装判定输入，workload 不组装。

被否决：
- 为每条 AI 事件调用 `resolveEffectiveWorkDomain`。一页最多几十次查库；旧作业链接对非管理层不出现，作业本身仍在 `/workforce` 列表里，代价是少一个链接。
- 审计行也按岗位过滤。老板会看不到本企业梦馨口径下归到「询盘销售」的折扣审批记录，和 VIS-1b Q1 的取舍相反。

### D11 「管理总览」只对管理层，底栏首格指向落地页（Q8，VIS-1b 遗留 #5）

- `registry.ts`：`work-home` 加 `positionPermissions: [...POSITION_MGMT]`，只在岗位模式生效。旧模式不变。
- `mobile-tabs.ts`：通用布局在默认工作区不是 `/install`、`/ops`、`/bids` 时，首格按 `resolveLandingPage(ctx)` 取：`/` →「总览」，`/tasks` →「任务」，`/accounting` →「会计」，其他落地页沿用「总览」。
- 路由门对 `/` 仍是登录即可（`/=`），不改。
- 受影响快照：`position-nav.test.ts` 非管理层侧栏去掉 `work-home`；`navigation-workspace.test.ts:97-100` 与 `entry-visibility.test.ts` 的底栏首格按身份更新。

被否决：首格对非管理层直接去掉。底栏会只剩一两个页签，入口反而更少。

### D12 拆分「等你 N 件」规格（Q9）

用 REMOVED + ADDED 拆成四条：「组成与去重」「计数与截断」「销售与安装审批的落点」「其余审批的落点」。原有 8 个场景按内容分配，文字只移动了「运行测试」说明的位置。不用 MODIFIED：MODIFIED 必须保留整条正文和全部场景，拆不开。代码与 `waiting.test.ts` 不改。

## 与八条硬纪律的关系

1. 零 schema：不改 Prisma。发信文案落在既有 `Organization.settingsJson`；入口对照、模块映射都是代码常量。
2. 出站先审批：不涉及。发信文案只改说明文字，不改发信通道与审批。营销工具剔除只缩小列表，不放宽执行。
3. 禁止第三套队列：不涉及，不新增队列或 cron。
4. 脱敏：
   - 企业列表只透出 `senderCopy` 一个已知值，不透出 `settingsJson`。
   - 代发文案去掉写死的人名与邮箱。
   - 时间线摘要沿用 `redactCockpitText`。
5. 不爬登录页：不涉及。
6. 邮箱分离：不改。代发企业照旧不显示 Gmail / SMTP 绑定区块，提示个人 Gmail 不用于该企业发信。
7. 确定性优先：入口对照、模块映射、落地页、读判定都是查表与纯函数，零 LLM 调用。
8. 测试注册：新增测试在各自 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，`bash scripts/check-test-registry.sh` 通过：
   - `src/lib/notifications/__tests__/type-visibility.test.ts`
   - `src/lib/settings/__tests__/sender-copy.test.ts`
   - `src/lib/agent-core/__tests__/tool-list-modules.test.ts`

   既有的 `src/lib/cockpit/__tests__/timeline.test.ts` 只加用例。

## Risks / Trade-offs

- [梦馨文案依赖生产回填] → 部署前跑脚本（D4）。没跑时只是文案回到标准模式，不影响发信；报告给出命令。
- [代发文案变通用，少了 Cathy / QQ / 询盘地址] → 发件身份仍由下方「公司发件身份」卡片显示；询盘收件人是梦馨的业务事实，不该写在通用界面里。
- [`agent_task` 对销售可见] → 任务书验收写「无 `agent_*`」。销售确实会收到效果图高清渲染完成的 `agent_task`，按 D1 应看得到开关；`agent_approval` 对销售不可见。见 Q1。
- [搜索判定按当前企业] → 判定输入取 `resolvePreferredOrgId` 的企业。多企业成员在另一企业可读的项目，只在那个企业的项目详情门对其放行时才搜得到。Sunny 成员都是单企业。
- [搜索多一次判定输入查询] → 每次搜索多一次 `loadNavigationContextForOrg`（与 active-org 同查询）。面板有 300 ms 防抖。
- [工具列表多一次判定输入查询] → 每次人类对话多一次。判定输入只用于营销工具入口；`modulesJson` 已在 options 里。
- [时间线一页可能少于 limit] → 被滤掉的平台级自动化不占页长。前端已按 `nextCursor` 判断「加载更多」，不按条数。
- [旧作业在时间线不带链接] → 见 D10 被否决项。
- [零可见卡的管理层] → 侧栏仍有「管理总览」，点进去落 `/tasks`（VIS-1b Q6）；底栏首格随落地页变「任务」。
- [既有断言要改] → `wechat-entry-render.test.tsx`（设置页结构）、`residual-reads.test.ts:163`、`posts-read-model.test.ts:308`、`position-nav.test.ts`、`navigation-workspace.test.ts:97-100`、`entry-visibility.test.ts` 底栏、`collab-preferences.test.ts`（若断言开关列表全量）。

## 验证方式

开工前先跑受影响测试、记基线（数值写进 tasks.md 第 1 条前）：

| 测试 |
|---|
| `src/lib/notifications/__tests__/collab-preferences.test.ts` |
| `src/lib/notifications/__tests__/notification-href.test.ts` |
| `src/lib/search/__tests__/search-where.test.ts` |
| `src/lib/navigation/__tests__/entry-visibility.test.ts` |
| `src/lib/navigation/__tests__/position-nav.test.ts` |
| `src/lib/navigation/__tests__/route-gate.test.ts` |
| `src/lib/cockpit/__tests__/posts-read-model.test.ts` |
| `src/lib/cockpit/__tests__/waiting.test.ts` |
| `src/components/cockpit/__tests__/org-cockpit-view.test.tsx` |
| `wechat-entry-render.test.tsx`、`residual-reads.test.ts`、`navigation-workspace.test.ts` |

新测试见「与八条硬纪律的关系」第 8 条。

门禁：
- `npm run test:ci`、`npm test`（13 个环境类失败与 origin/main 相同）。
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx next build --webpack`。
- `openspec validate vis-1c-notify-settings-search --strict`。归档后 `openspec validate --specs --strict` 的超长告警从 1 条变 0 条。

## 审核关注点（偏离或补充任务书之处，请拍板）

- Q1（D1）：通知类型按「落点页面经路由门放行」判定可见，不按任务书写的「每个类型补 `moduleKey`」。
  - 模块是全企业开的，Sunny 开着 `bids`，按模块判定销售照样看到 `rfq_*`。
  - 连带后果：`agent_task` 对销售可见（效果图高清渲染完成会发给销售），任务书验收的「无 `agent_*`」只对 `agent_approval` 成立。
- Q2（D2）：隐藏类型保留偏好、照常投递。另一选择是隐藏即停投，那会改通知规则。
- Q3（D4）：发信文案用企业设置里的一个枚举值加通用文案，梦馨专属的人名与邮箱从界面去掉；部署前需在生产跑一次回填脚本。另一选择是把整段文案存进企业设置。
- Q4（D6）：搜索项目按「项目详情门 ∧ 详情页读判定」，不按任务书写的「持 `project.read`」，否则会计会搜到打不开的项目。普通成员从「全企业项目」收窄为「自己负责或参与的项目」。
- Q5（D7、D8）：
  - `marketing_*` 所需模块从 `operations` 改为 `marketing`，Sunny 与梦馨都开着，执行期不受影响。
  - 「品牌增长」入口只加在列表上，执行期不加门。数字员工与后台运行不受影响。
  - 任务书写的 `tender_*` 工具不存在，无需处理。
- Q6（D9）：营销卡片按营销数字员工页的门判定，删掉 `canUseMarketingDigitalEmployee`；营销接口的读写门不动。
- Q7（D10）：时间线只滤平台级自动化行；审计行不按岗位过滤（只藏岗位名）；旧作业不逐条解析工作域，非管理层不带链接。
- Q8（D11）：岗位模式下「管理总览」只对持 `organization.dashboard.read` 的人（即 `owner`）出现。底栏首格改指落地页：会计「会计」，出单 / 无岗位 / 梦馨外贸「任务」。**BREAKING**：非管理层侧栏少一项。
- Q9（D12）：「等你 N 件」拆成四条而不是两条，因为落点表单独一条仍超 500 字。
