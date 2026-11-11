# Design：审批中心与「待我确认」按岗位收口（VIS-1d）

动机见 proposal.md「Why」，对外行为见 spec 增量 `approvals/visibility`。本设计建立在 VIS-1a / 1b / 1c 之上：
- 路由门：`src/lib/navigation/route-gate-core.ts`，入口判定 `landing.ts` 的 `canOpenHref`。
- 判定输入：`filter-context.ts`；服务端 `context-server.ts` 的 `loadNavigationContextForOrg` 与路由门加载器 `ROUTE_GATE_LOADER`（按用户 + 企业 30 秒缓存）。

## Context

现状（2026-11-11 在 `claude/vis-1d-approvals-split` 上核对，基线 origin/main e4c51284）：

- **审批来源**（`src/lib/capabilities/approvals/query.ts`）：PendingAction、ApprovalRequest（旧项目智能体步骤审批）、ProductContentApproval。
- **审批中心列表**（`listCapabilityApprovals`）：
  - 三个来源各取窗口内最近 200 条，在内存里投影、筛 tab。
  - org_owner / org_admin 不再过滤，看全企业。
  - 其余成员只留：本人提交、本人为指定审批人、本人所在工作区的（`:291-306`）。
- **审批详情**（`getCapabilityApproval`，`:325-419`）：只校验企业，任何成员拿到 id 就能打开。
- **批准**（`decideCapabilityApproval`，`decision.ts`）：
  - 先查幂等缓存（`:220-226`，按 `(orgId, key)`），再经详情加载（`:228`）。
  - PendingAction 经审批端口执行（`:416-420`），传的 `role` 是组织角色。
- **能批判定**（`canDecidePending`，`:42-74`）：
  - 指定审批人，或没有指定审批人时的创建人；
  - 有工作区时按工作区审批角色；
  - 没有工作区时 org_owner / org_admin（`isOrgAdminRole`）。
- **执行器**（`pending-actions/executor.ts:195`，`canDecideTeamApproval`，`marketing/team.ts:116-172`）：企业级草稿只认平台 super_admin、指定审批人、企业所有者（`Organization.ownerId`）、成员角色 `org_admin`、项目负责人与 project_admin。创建人本身不算，成员角色 `org_owner` 本身也不算（`team.ts:143,148`）。
- **四处另拼「团队审批范围」**（`getTeamApprovalAccessIds`，`team.ts:97-114`：本人拥有或任 org_admin 的企业 + 本人负责或任 project_admin 的项目）：
  - AI 助手「待我确认」列表 `api/ai/pending-actions/route.ts:36-62`：限当前企业，不过滤过期；
  - 侧栏红点 `count/route.ts:12-25`：**不限当前企业**，只数未过期的，每 60 秒轮询（`use-pending-approvals-badge.ts:22`）；
  - 运营看板 `operations/dashboard/build-dashboard.ts:196-215`；
  - 审批收件箱 `approval/port.ts:76-90`：供 `/api/agent/approvals` 与 Muse 使用，不限企业。其中项目智能体审批一半来自 `getPendingApprovals`（`agent/approval.ts:121-128`：指定审批人为本人**或为空**，不限企业）。`/api/agent/approvals`（`route.ts:14-19`）不解析当前企业。
  - 运营看板的企业范围另含该企业项目上的无企业卡（`build-dashboard.ts:218-225`）。
- **审批端口**（`approval/port.ts`）：
  - `approveApprovalItem`（`:201`）/ `rejectApprovalItem`（`:413`）先处理已终态的重复调用（`:213-237`、`:424-438`，返回状态并收敛），再交执行器。
  - id 不存在时，经执行器返回 `{ ok: false, status: "failed", error: "草稿不存在", run: null }`（`executor.ts:191-193`）。
  - 项目智能体审批分支（`:387-410`）按 id 直接批，不做任何校验。
  - `ctx.orgId` 可为空（`:57`）。
- 调用方：
  - 审批中心批准；
  - Muse `approve` / `reject`；
  - 催单自动批准（`tender-rfq/chase-service.ts:306`，以批准该轮的人的身份）；
  - 微信回数字确认（`wechat-confirm.ts:193,235`）：批次只含本人提交的卡（`:77-81`），传的企业为空（`:38-41`）；
  - 项目智能体步骤审批路由（`api/agent/tasks/[taskId]/steps/[stepId]/approve|reject`），只要求项目读权限。
- **RFQ 原地审批**（`tender-rfq/web-entry-approval.ts:69`）对每张卡调一次 `getCapabilityApproval`；`loadRfqSendEmails`（`:90-98`）按项目返回待发邮件正文。
- **Muse 意图与审批**（`muse-bridge/router.ts`）：
  - `status`（`:266`）、`ask`（`:379`，取最早待批 id）、`next_step`（`:590`）经收件箱取「该用户可见的待批动作」；
  - `approve`（`:89-108`）按 id 先查类型、判是否要网页预览，再交端口；
  - `reject` 交端口；
  - `chase` 起草催单时可能自动批准（`chase-service.ts:353`），经端口。
- **首页「等你拍板」**（`posts-read-model.ts:500-515`）与审批中心概览（`overview/get-overview.ts:117`）都调 `listCapabilityApprovals(tab: pending_mine)`。
- **审批类型目录**（逐个生产方核对，见报告 §4）：
  - 写 PendingAction 的只有 `pending-actions/drafts.ts:189`（`createDraftBatch`）与让利审批路由的直接 upsert（`api/sales/quotes/[quoteId]/request-promotion-approval/route.ts:115`）。20 个已登记类型。
  - 没有任何生产方设置工作区，工作区路径实际不生效。
  - 有审批键的类型：
    - `sales.approve_quote_promotion`（`sales.quote.discount.over_limit.approve`）
    - `sales.update_signed_quote`（`sales.quote.signed_amount.approve`）
    - `sales.update_quote_settings`（`sales.settings.manage`）
    - `orders.cancel_blinds_order`（`orders.cancel`）
    - `install.send_warranty_email`（`install.balance.confirm`）
    - `install.send_repair_visit_email`（`install.task.assign`）
    - `revenue_spine.propose_commercial_fact`（批准前校验 `trade.settings.manage`）
  - 没有专属审批键的类型：
    - `sales.send_inquiry_reply`：FDE 询盘回复，指定审批人 = 跟进销售；
    - `tender.send_rfq` / `tender.send_chase`：有项目，无指定审批人；
    - `marketing.*`：增长中心项目，多数有指定审批人，技能桥生成的两类没有。`operations.content.approve` 存在，但只用于运营发布任务（`/api/operations/publish-jobs/*`），不是营销审批键，梦馨老板也不持；
    - 助手 / Grader / 日历草稿：`sales.update_followup`、`sales.update_stage`、`calendar.create_event`、`grader.*`，无项目、无指定审批人。
  - ApprovalRequest 的指定审批人 = 任务创建人；产品内容审批由申请人或企业管理员决定。
- **岗位键与页面**（按真实岗位模板与门表计算）：
  - Sunny `owner` 持上面全部销售 / 订单 / 安装审批键，招投标、品牌增长、产品内容页放行，营收中心不放行（未启用 `trade`）。
  - `accounting` 持 `install.balance.confirm`、`install.task.assign`；`ops_lead` 持 `install.task.assign`。
  - 梦馨 Cathy（`owner` + `trade_rep`）持 `trade.settings.manage`，营收中心、品牌增长、产品内容页放行，招投标不放行。
- **规格**：
  - 现有主规格没有规定审批中心的可见集合。
  - `navigation/route-gate` 规定 `/capabilities/approvals/**` 对全体成员放行（页面放行，内容另算），不改。
  - `tender/rfq-followup-preapproval` 规定「批准人已无审批权而未能执行时，这条审批记录留作待批」。

## Goals / Non-Goals

**Goals:**

- 审批中心、「待我确认」、红点、运营看板、审批收件箱（含 Muse）用同一个可见集合；企业管理员角色本身不再等于看全企业。
- 看不见的审批，在审批中心、AI 助手与审批端口（含 Muse、项目智能体步骤审批、催单自动批准）都批不了，返回与「不存在」完全相同的结果。
- 「本岗位负责的业务类型」从路由门与现有审批键派生，不新增权限键。

**Non-Goals（不动的模块 / 文件）：**

- `src/lib/pending-actions/executor.ts` 与 `canDecideTeamApproval`：执行期处理人规则、各类型批准时的键校验都不改。
- `canDecidePending` 与 ApprovalRequest / 产品内容的能批规则：不改，只在可见集合之内生效。
- 审批卡的生成（`drafts.ts`、各生产方）、通知、`cockpit/waiting.ts` 落点表：不改。
- `tender-rfq/chase-service.ts`、`wechat-confirm.ts`：不改。前者在端口拒绝时本来就留作待批，后者只处理本人相关的卡。
- `src/lib/tenancy/workspace-rbac.ts`（工作区审批角色）：不改。
- 产品内容自己的决定接口（`api/product-content/jobs/[id]/approvals/*`、`approve-plan`）：有自己的成员校验，不改；本次只管审批中心里的产品内容审批。
- `loadRfqSendEmails`：按项目返回该项目待发邮件正文，调用方已有项目权限，不改（见 Risks）。
- 路由门门表与 `/capabilities/approvals/**` 的页面放行：不改。
- 旧模式（行业包没有岗位模板）企业：全部行为不变（D4）。

## Decisions

### D1 可见集合 = 本人相关 ∪ 处理人路径 ∪ 本岗位负责的类型（Q1、Q3）

岗位模式企业里，一条审批对成员可见，当且仅当满足任一：
- 本人提交（PendingAction `createdById`、ApprovalRequest 任务创建人、产品内容 `requestedById`）；
- 本人是指定审批人；
- 本人是审批所在工作区的成员（保留既有路径，今天没有生产方写工作区）；
- 本人是审批所属项目的负责人或 project_admin（执行器认他们处理，例如询价卡的项目负责人）；
- 按类型的可见岗位条件放行（D2、D3）。

平台 super_admin 全部可见。

被否决：
- 按任务书只留「本人提交 / 被指派 ∪ 类型」。项目负责人是询价卡在执行器里的处理人；不在可见集合里，就会出现「能批却看不见」。
- 保留企业管理员看全企业。这正是任务书要去掉的。

### D2 类型的可见岗位 = 业务页面经路由门放行 ∧ 持审批键（列了键时）（Q2）

新增 `src/lib/approval/audience.ts`，常量 `APPROVAL_FAMILIES`：

| 类型 | 业务页面 | 审批键 |
|---|---|---|
| `sales.approve_quote_promotion` | `/sales/quote-sheet` | `sales.quote.discount.over_limit.approve` |
| `sales.update_signed_quote` | `/sales/quote-sheet` | `sales.quote.signed_amount.approve` |
| `sales.update_quote_settings` | `/sales/cockpit` | `sales.settings.manage` |
| `orders.cancel_blinds_order` | `/blinds-orders/_` | `orders.cancel` |
| `install.send_warranty_email` | `/accounting` | `install.balance.confirm` |
| `install.send_repair_visit_email` | `/install` | `install.task.assign` |
| `revenue_spine.*`、`sales.send_inquiry_reply` | `/revenue` | `trade.settings.manage` |
| `tender.*`、ApprovalRequest | `/bids` | — |
| `marketing.*` | `/marketing` | — |
| ProductContentApproval | `/product-content` | — |

判定：`canOpenHref(page, ctx) && (keys 为空 || ctx.permissionKeys 含任一 key)`。页面门本身就是「模块已开 ∧ 岗位持键」，审批键再收窄到负责这类审批的人。

关于两类特例：
- `sales.send_inquiry_reply` 没有专属审批键，按外贸营收的管理键 `trade.settings.manage` 收口，与商务事实提案、营收策略同一个键。否则全体外贸业务员（持 `trade.manage`）会看到彼此的询盘回复草稿。
- `marketing.*` 不用 `operations.content.approve`：那个键只管运营发布任务；梦馨老板不持它，用它会让梦馨没有指定审批人的营销草稿没人看得见、也就没人批。

被否决：
- 只看业务页面。报价单对全体销售放行，销售会看到彼此的让利申请。
- 只看审批键。Sunny 老板持 `trade.settings.manage`，但企业没开 `trade` 模块，只看键会让他看到营收类审批。
- 按任务书给营销、招投标补「营销键」「投标审批键」。这两种键不存在，新增违反「不新增权限键」。招投标中心与品牌增长的门已经是「模块 ∧ 岗位键」。

### D3 没有业务归属的草稿对执行期认的企业处理人可见（Q4）

类型不在 D2 对照里的 PendingAction（助手、Grader、日历草稿等），对执行器认的企业处理人可见：企业所有者（`Organization.ownerId`）与成员角色 `org_admin`。判定与 `team.ts:143,148` 相同，避免「看得见却批不了」。

执行器只认这些人、项目负责人 / 管理员与指定审批人处理企业级草稿，创建人本身不算。对他们藏起这些草稿，它们就没人能批。

被否决：
- 只对创建人可见。今天这些草稿的唯一处理人就是企业管理员，藏起来等于卡死。
- 按 `isOrgAdminRole`（含成员角色 `org_owner`）判。成员角色 `org_owner` 但不是企业所有者的人看得见、执行器却不让批。

### D4 旧模式企业全部行为不变（Q5）

`ctx.positionMode === false` 时：
- 审批中心列表沿用改动前的过滤：org_owner / org_admin 全部可见，其余成员只见本人提交、本人为指定审批人、本人所在工作区的；
- 详情、「待我确认」、红点、运营看板、收件箱与批准 / 驳回入口都不按可见集合收窄。实现上 `pendingActionAudienceWhere` 返回 `{}`，`isApprovalVisible` 返回 true。
- 例外：红点与收件箱改为「只含当前企业」（D7）对旧模式同样适用。这是租户隔离，不是可见集合；今天它们跨企业，是与列表不一致的缺陷。

被否决：
- 旧模式也按 D2。旧模式企业没有岗位模板，管理员通常不持岗位键，会一下子看不到任何业务审批。
- 旧模式只沿用列表规则、其余也按它收窄。旧模式的项目负责人会在「待我确认」、Muse 与 AI 助手里失去本项目的卡，执行器却仍让他们批。

### D5 纯函数与查询条件同义（Q6）

`audience.ts`（纯模块，无数据库）提供：
- `approvalFamilyOf(sourceType, type)`：类型 → 对照项（或「无业务归属」）。
- `visibleFamilies(viewer)`：本人放行的对照项。只依赖判定输入，每次请求算一次。
- `isApprovalVisible(item, viewer)`：单条判定，给 ApprovalRequest、产品内容、详情与端口用。
- `legacyListVisible(item, viewer)`：旧模式审批中心列表的原规则。
- `pendingActionAudienceWhere(viewer)`：PendingAction 的 Prisma 条件。
  - super_admin 与旧模式为 `{}`。
  - 其余为 `OR` 组合：本人提交、本人审批、工作区 in、项目 in、可见对照项的 `type in` / `type startsWith`。企业处理人另加「不属于任何对照项」（`NOT: { OR: [全部对照项条件] }`）。
- 测试用小求值器把条件跑在样例行上，断言与 `isApprovalVisible` 逐行一致（同 #409 的写法）。

`viewer` 的字段：
- 身份：`userId`、`orgId`、`isPlatformAdmin`、`isOrgHandler`（企业所有者或成员角色 `org_admin`，D3）。
- 旧模式列表用：`isOrgAdminRole`。
- 路径：`workspaceIds`、`projectIds`（本企业内本人负责或任 project_admin 的项目）。
- `ctx`：判定输入，与路由门同源。

新增 `src/lib/approval/audience-server.ts` 的 `loadApprovalViewer(userId, orgId)`：
- 平台角色按 `userId` 从库里读，不信调用方传的 `role`。审批中心经端口执行时传的是组织角色（`decision.ts:416-420`），不能用来判 super_admin。
- 判定输入走路由门加载器缓存：`RouteGateLoader`（类型在 `route-gate.ts`）加 `loadContextForOrg(user, orgId)`。
  - 复用 `${userId}:${orgId}` 的 30 秒缓存与请求合并，不列计数、不写库。
  - 非成员得到 `hasMembership: false`，什么都看不见。
  - 测试里的假加载器随之补这一方法。
- 另查企业所有者、成员角色、工作区、项目，可并行。

判定输入最多旧 30 秒：批准时执行器还会按库里的当前状态重判处理人，不会因此多批。这份缓存在路由处理函数的进程里，与中间件的不是同一份（两者分开打包），各自 30 秒。

端口的判定 `portCardVisible(card, ctx)` 按审批所属企业取 viewer（不按调用方当前企业：微信传空），顺序：
1. 平台 super_admin → 可见；
2. 卡没有企业（个人草稿）→ 只有创建人或指定审批人可见；
3. 调用方带了企业且与卡的企业不同 → 视为不存在；
4. 卡所属企业为旧模式 → 可见；
5. 不是该企业 active 成员 → 不可见；
6. 其余按 `isApprovalVisible`。

每一步都有纯函数测试。

被否决：
- 每个入口各写一份过滤。这正是现在四处漂移的原因。
- 每次都调 `loadNavigationContextForOrg`（4 次查询加岗位绑定解析、不缓存）。红点每 60 秒轮询一次。

### D6 审批中心接入（Q7）

`query.ts`：
- 列表：
  - 岗位模式下，PendingAction 的 `where` 加 `AND: pendingActionAudienceWhere(viewer)`，在查询里过滤，取 200 条的截断发生在过滤之后。
  - ApprovalRequest 与产品内容在投影前用 `isApprovalVisible`。这两类仍是取 200 条后在内存里过滤；量很小（ApprovalRequest 是冻结的旧栈），列入 Risks。
  - 旧模式沿用 `:291-306` 的过滤（改为调 `legacyListVisible`）。
- 详情加载到行之后先判 `isApprovalVisible`，不可见抛 404（与「不存在」同一个错误）。
- `decision.ts` 的幂等缓存：
  - 读取挪到第一次 `getCapabilityApproval`（`:228`）之后、过期判断（`:231-246`）与能力检查（`:249-269`）之前。挪到更后面会让已执行或已过期的重放拿不到缓存。
  - 只在幂等记录的 `approvalKey` 与 `action` 都与本次请求相同时命中。今天按 `(orgId, key)` 命中，拿别人卡的幂等键配自己可见的审批 id 也能取到那张卡的缓存结果。零 schema，表里已有这两列。
- `viewer` 的取法：
  - `listCapabilityApprovals` / `getCapabilityApproval` 多一个可选参数 `viewer`，缺省时自行用 `loadApprovalViewer` 取；调用方（审批中心路由、概览、首页岗位总览）不改调用形状。
  - `CapabilitiesAccessContext` 不改形状。
  - `decision.ts` 只取一次，传给它的 6 处 `getCapabilityApproval` 与端口。
  - `web-entry-approval.ts` 对一个项目的多张卡也只取一次。

被否决：在 `decision.ts` 另加一整套可见校验。详情已是唯一入口，再加一处就是第二套规则。

### D7 待我确认、红点、运营看板、收件箱与端口（Q8）

范围：
- `marketing/team.ts` 新增 `teamApprovalScopeWhere(userId, access)`，把四处重复的 `OR` 抽成一个函数（行为不变）。
- 新增 `src/lib/approval/pending-mine.ts`：`pendingMineWhere(viewer, teamAccess)` = 处理人范围 ∩ `pendingActionAudienceWhere(viewer)` ∩ 当前企业（另含本人个人草稿）。四处都用它：
  - AI 列表：`listMyPendingActions`，照旧不过滤过期，过期的照常显示为已过期；
  - 红点：`countMyPendingActions` = 同一条件 + 未过期。当前企业取 `resolveAssistantOrgId`（与列表相同）；解析不出时只数本人未过期的个人草稿，照旧返回 200；
  - 运营看板：看板所在企业；
  - 收件箱：`listApprovalInbox(userId, { orgId })`，调用方传企业。`/api/agent/approvals` 用 `resolveAssistantOrgId`（与「待我确认」相同），解析不出时只给本人的个人草稿；Muse 用 `identity.orgId`。收件箱里的项目智能体审批一半（`getPendingApprovals`）同样只取该企业项目上的、可见的。
  - 运营看板沿用它自己的企业范围（含该企业项目上的无企业卡），再取可见集合的交集。
- 个人草稿（无企业、无项目、无指定审批人）照旧只给创建人。

批准 / 驳回入口：
- `api/ai/pending-actions/[id]`：在 `canDecideTeamApproval` 之前判可见，看不见返回与不存在相同的 404 响应（`{ error: "草稿不存在" }`，`route.ts:72-74`）。
- 端口 `approveApprovalItem` / `rejectApprovalItem`：
  - PendingAction 一进来就按 D5 的 `portCardVisible` 判可见，在已终态重复分支（`port.ts:213-237`、`:424-438`）之前。看不见时返回与 id 不存在时完全相同的对象，不执行、不收敛、不透露状态。测试断言两者相等。
  - 项目智能体审批分支同样先判可见（企业取 `task.project.orgId`），看不见按不存在返回。项目智能体步骤审批路由由此生效。
  - 调用方的影响：
    - 审批中心：已在详情处判过，结果相同。
    - 催单自动批准：批准人已看不见时端口拒绝，`chase-service.ts:306` 按既有逻辑留作待批，符合 `tender/rfq-followup-preapproval`「批准人已无审批权…留作待批」。
    - 微信回数字确认：只处理本人提交的卡，始终可见，不受影响。
- `muse-bridge/router.ts` 的 `approve`：先判可见，再判是否要网页预览。看不见时直接返回「不存在」，不按类型给不同答复。

被否决：
- 「待我确认」直接等于可见集合。那会把本人提交、但执行器不让本人批的草稿也列进「待我确认」。「待我确认」是「我能处理的」，保留既有处理人范围再取交集。
- 在执行器里判可见。执行器也被系统流程调用，判定输入在那里不可得，且执行器本身不改（Non-Goals）。

### D8 隔离库测试在本机 Postgres 16 上跑（Q9）

`src/lib/approval/__tests__/audience-db.isolated.test.ts`：照 `org-scoped-users-db.isolated.test.ts` 的写法，无 `DATABASE_URL` / `DATABASE_ENVIRONMENT=isolated` 时跳过，`assertSafeTestDatabase` 只放行本机。

本次在容器里起一个临时 Postgres 16（`/usr/lib/postgresql/16`），用 `prisma migrate deploy` 建表，跑完即删。种子：
- 虚构的岗位模式企业（窗饰行业包），含：
  - 持 `owner` 的 org_admin；
  - 不持岗位、不是项目负责人的 org_admin；
  - 只持 `accounting`；
  - 只持 `sales_rep` 两人；
  - 只持 `bids`。
- 虚构的家纺外贸企业，含 Cathy 同款岗位。
- 虚构的旧模式企业，含项目负责人。
- 每类审批各一条，另有一条已执行的卡、一条另一企业的草稿。

用真实的函数断言：`listCapabilityApprovals`、`getCapabilityApproval`、`decideCapabilityApproval`、`listMyPendingActions` / `countMyPendingActions`、`listApprovalInbox` 与端口。注册进 `scripts/test-all.sh`（CI 无库时跳过）。

同一个库补跑调用端口或审批查询的既有隔离库测试，与 origin/main 同库对照：
- `phase3a3-approvals-smoke`
- `b2-approval-cas.isolated`
- `durable-followup-m1.isolated`
- `booth-cards-db`
- `website-inquiry-async-db`
- `revenue-spine-db`
- `onboarding-db`
- workforce 的 `phase2c1-pause-resume`、`phase2c1-expiry-races`、`p0-execution-alignment`
- `install/warranty-db.isolated`、`repair-visit-email-db.isolated`（岗位模式企业里经 AI 助手 `[id]` 路由批准）
- `tender-rfq/followup-auto-db.isolated`（催单自动批准经端口）
- `messaging/wechat-binding-confirm-db.isolated`、`revenue-spine/owner-today-db.isolated`（微信经端口）

测试要点：
- 种子先绑岗位再取 viewer。
- 旧模式「可见校验放行」用非处理人调 AI 助手与端口，断言得到「无权操作该草稿」（执行器的拒绝）而不是「不存在」：证明可见校验已放行，且没有执行。
- Muse 用命令处理函数 `handleMuseCommand` 的 `approve`，断言看不见的卡与不存在的 id 答复相同。
- 幂等：为看不见的卡预置一条幂等记录，断言 404。

被否决：只写纯函数测试。查询条件拼错（如 `OR` 覆盖，#409 的教训）只有真查询能抓到。

## 与八条硬纪律的关系

1. 零 schema：不改 Prisma。类型对照是代码常量；判定输入来自既有岗位绑定与企业模块。
2. 出站先审批：只收窄谁能看见、谁能批，不改审批流程与执行器；看不见的审批一律批不了，不会多出出站。催单自动批准在批准人看不见时留作待批，不会因此多发。
3. 禁止第三套队列：不涉及，不新增队列或 cron。
4. 脱敏：列表与详情的投影（`adapters.ts`）与可见模式（`resolveDetailAccessMode`）不变；看不见的不再返回任何字段，端口也不透露其状态。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：类型对照、可见判定、查询条件都是查表与纯函数，零 LLM 调用。
8. 测试注册：两个新测试都注册进 `scripts/test-all.sh`。纯函数的另进 `scripts/test-ci-unit.sh`；隔离库的在 CI 无库时跳过。`bash scripts/check-test-registry.sh` 通过。

## Risks / Trade-offs

- [Sunny 体感变化小] → Sunny 老板持全部销售 / 订单 / 安装审批键，且招投标、品牌增长、产品内容放行，只少营收类（Sunny 没有）。真正收窄的是不持 `owner` 岗位的企业管理员，以及「待我确认」里同一批人。见 Q10。
- [不持对应岗位的管理员看不到营销、招投标卡] → 卡的指定审批人与项目负责人照常可见可批。
- [持键或过门的非管理员看得见、未必批得了] → 例如会计看得到别人确认尾款时生成的质保邮件卡，运营看得到全部营销卡。能批判定不变，这些不在「待我审批」里。
- [多一次判定输入加载] → 审批中心、「待我确认」、红点、看板、端口每次请求多一次 `loadApprovalViewer`：判定输入走 30 秒缓存，另几次轻查询。
- [红点数改为只数当前企业] → 多企业成员的红点数可能变小，与列表一致后才是真实可处理数。
- [首页「等你拍板」随之变化] → 不持对应岗位的管理员的横幅少掉这些类型。
- [ApprovalRequest 与产品内容仍是取 200 条后过滤] → 范围窄的人可能看不到窗口之外更早的可见条目。这两类量小，ApprovalRequest 是冻结的旧栈。
- [看得见、在审批中心却显示批不了] → 岗位模式的项目负责人按 D1 看得见本项目的询价卡，但 `canDecidePending` 不认项目负责人（`query.ts:53-73`），审批中心与 RFQ 面板显示批不了，AI 助手与 Muse 却能批（执行器认）。这是既有的两处规则不一致，列入 Q11。
- [审批中心显示能批、执行器却拒绝] → 成员角色 `org_owner` 但不是企业所有者、又持老板岗位的人：`canDecidePending` 按 `isOrgAdminRole` 给能批，执行器不认（`team.ts:143,148`）。既有问题，列入 Q11。
- [RFQ 面板的待发邮件正文] → `loadRfqSendEmails` 按项目返回，看不见某张卡的项目成员仍能在该项目面板看到正文。调用方已有项目权限，本次不改。
- [`tender/rfq-web-entry` 的提示文字] → 「需要组织管理员批准」「需要项目负责人或组织管理员批准」在不持招投标岗位的管理员那里不再准确。Sunny 老板都持招投标，文字照旧成立；不改该规格与界面，列入 Q12。
- [既有断言要改] → 主要有这些：
  - `phase3a3-approvals-rbac.test.ts`（管理员看全量的断言）；
  - `posts-read-model.test.ts`（待我审批加载器的注入）；
  - route-gate 测试的假加载器（补 `loadContextForOrg`）；
  - 断言收件箱 / 端口调用形状的测试（`fact-proposals`、`draft-feedback`、`b2-approval-cas-static`、`approval-resume`、`research-plan`）。

## 验证方式

开工前的受影响测试基线见 tasks.md 开头。

新测试：
- `src/lib/approval/__tests__/audience.test.ts`：对照表、按身份的可见类型、可见集合与查询条件逐行同义、旧模式、super_admin、源码断言（四处同一条件函数、端口与路由的判定顺序）。
- `src/lib/approval/__tests__/audience-db.isolated.test.ts`：见 D8。

门禁：
- `npm run test:ci`、`npm test`（环境类失败与 origin/main 相同）；隔离库测试在本机库上实跑，输出写进报告。
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx next build --webpack`。
- `openspec validate vis-1d-approvals-split --strict`。

## 审核关注点（偏离或补充任务书之处，请拍板）

拍板结果（Lucas 2026-11-11）：Q1–Q12 全部按推荐执行。

- Q1（D1）：可见集合比任务书多两条路径。
  - 项目负责人 / project_admin：执行器认他们批询价卡。
  - 工作区成员：既有路径，今天不生效。
- Q2（D2）：类型按「业务页面放行 ∧ 审批键（列了键时）」。
  - 营销、招投标没有审批键，不新增，按品牌增长、招投标中心的门判定。
  - 询盘回复按外贸营收的管理键。
  - 运营看得到全部营销卡、批不了（指定审批人照常）。
- Q3（D1）：岗位模式企业里，企业管理员角色本身不再看全企业的业务类型审批。**BREAKING**。
- Q4（D3）：没有业务归属的草稿（助手、Grader、日历）仍对执行器认的企业处理人（企业所有者与成员角色 `org_admin`）可见，否则没人能批。
- Q5（D4）：旧模式企业全部行为不变，不只是列表。
- Q6（D5）：判定输入加一个按 `(用户, 企业)` 缓存的加载方法，红点轮询不加重数据库；判定输入最多旧 30 秒。
- Q7（D6）：详情不可见按 404（与「不存在」同一错误），不给「无权查看」提示，避免暴露这条审批存在；幂等重放同样先判可见。
- Q8（D7）：
  - 「待我确认」= 既有处理人范围 ∩ 可见集合，不直接等于可见集合。
  - 红点数改为只数当前企业、未过期；解析不出企业时只数个人草稿。
  - 收件箱（`/api/agent/approvals`、Muse，含项目智能体审批一半）改为只含当前企业；红点与收件箱的这一条对旧模式同样适用（租户隔离）。
  - 看不见的审批在端口与 AI 助手返回与 id 不存在时完全相同的结果。
  - 受影响的 Muse 意图：`status` / `ask` / `next_step`（经收件箱）、`approve` / `reject`（经端口，`approve` 先判可见）、`chase`（自动批准经端口，批准人看不见时留作待批）。
- Q9（D8）：隔离库测试在容器里临时起本机 Postgres 16 跑，CI 无库时跳过。
- Q10：任务书验收与实际绑定的差异：
  - Miki 在 `config/positions/sunny.json` 里同时持 `owner`，所以她看到的与老板相同，不是任务书写的「只见折扣 / 让利 / 质保」。
  - Bob（`owner`）按 VIS-1a Q10 持招投标，看得到全部 `tender.*`。他是 org_admin，按 `canDecidePending` 的企业管理员兜底，营销与产品内容卡也会进他的「待我审批」，不是任务书写的「只列 Sunny 原生审批 + 投标」。
  - 任务书写的「看不到任何 `trade.*`」成立，但代码里没有 `trade.*` 审批类型，实际是看不到 `revenue_spine.*`。
- Q11：实现前核对发现的执行器问题不在本 change 修，建议各自另立：
  - 创建人批不了自己的企业级草稿；
  - 多位持键人只存第一位为审批人；
  - 销售 / 订单的键校验在认领之后，失败会消耗审批卡；
  - 审批中心把组织角色当平台角色传给执行器；
  - 审批中心的能批判定与执行器不一致：不认项目负责人，却认成员角色 `org_owner`。
- Q12：`tender/rfq-web-entry` 的「需要组织管理员批准」提示文字不改（见 Risks）。
