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
- **审批详情**（`getCapabilityApproval`，`:325-419`）：只校验企业，任何成员拿到 id 就能打开。批准 / 驳回 / 撤回 / 重试都先经它加载（`decision.ts:228`）。
- **能批判定**（`canDecidePending`，`:42-74`）：
  - 指定审批人，或没有指定审批人时的创建人；
  - 有工作区时按工作区审批角色；
  - 没有工作区时 org_owner / org_admin。
- **执行器**（`pending-actions/executor.ts:195`，`canDecideTeamApproval`，`marketing/team.ts:116-175`）：企业级草稿只认平台 super_admin、指定审批人、企业所有者（`Organization.ownerId`）、成员角色 `org_admin`、项目负责人与 project_admin，创建人本身不算。
- **四处另拼「团队审批范围」**（`getTeamApprovalAccessIds`，`team.ts:97-114`：本人拥有或任 org_admin 的企业 + 本人负责或任 project_admin 的项目）：
  - AI 助手「待我确认」列表 `api/ai/pending-actions/route.ts:36-62`（限当前企业）；
  - 侧栏红点 `count/route.ts:12-25`（**不限当前企业**，每 60 秒轮询，`use-pending-approvals-badge.ts:22`）；
  - 运营看板 `operations/dashboard/build-dashboard.ts:196-215`；
  - 审批收件箱 `approval/port.ts:76-90`：供 `/api/agent/approvals` 与 Muse 使用。Muse 的 `status`（`router.ts:266`）、`approve`（`:379`）、`next_step`（`:590`）都经它取「该用户可见的待批动作」，`reject` 同走端口。
- **首页「等你拍板」**（`posts-read-model.ts:500-515`）与审批中心概览（`overview/get-overview.ts:117`）都调 `listCapabilityApprovals(tab: pending_mine)`。
- **审批类型目录**（逐个生产方核对，见报告 §4）：
  - 写 PendingAction 的只有 `pending-actions/drafts.ts:189`（`createDraftBatch`）与让利审批路由的直接 upsert（`api/sales/quotes/[quoteId]/request-promotion-approval/route.ts:115`）。
  - 没有任何生产方设置工作区，工作区路径实际不生效。
  - 有审批键的类型：
    - `sales.approve_quote_promotion`（`sales.quote.discount.over_limit.approve`）
    - `sales.update_signed_quote`（`sales.quote.signed_amount.approve`）
    - `sales.update_quote_settings`（`sales.settings.manage`）
    - `orders.cancel_blinds_order`（`orders.cancel`）
    - `install.send_warranty_email`（`install.balance.confirm`）
    - `install.send_repair_visit_email`（`install.task.assign`）
    - `revenue_spine.propose_commercial_fact`（批准前校验 `trade.settings.manage`）
  - 没有审批键的类型：
    - `tender.send_rfq` / `tender.send_chase`（有项目，无指定审批人）；
    - `marketing.*`（增长中心项目，多数有指定审批人）；
    - `sales.send_inquiry_reply`（FDE 询盘回复，指定审批人 = 跟进销售）；
    - 助手 / Grader / 日历草稿（`sales.update_followup`、`sales.update_stage`、`calendar.create_event`、`grader.*`，无项目、无指定审批人）。
  - ApprovalRequest 的指定审批人 = 任务创建人；产品内容审批由申请人或企业管理员决定。
- **岗位键与页面**（按真实岗位模板与门表计算）：
  - Sunny `owner` 持上面全部销售 / 订单 / 安装审批键，招投标、品牌增长、产品内容页放行，营收中心不放行（未启用 `trade`）。
  - `accounting` 持 `install.balance.confirm`、`install.task.assign`。
  - `ops_lead` 持 `install.task.assign`。
  - 梦馨 Cathy（`owner` + `trade_rep`）持 `trade.settings.manage`，营收中心、品牌增长、产品内容页放行，招投标不放行。
- **规格**：现有主规格没有规定审批中心的可见集合；`navigation/route-gate` 规定 `/capabilities/approvals/**` 对全体成员放行（页面放行，内容另算），不改。

## Goals / Non-Goals

**Goals:**

- 审批中心、「待我确认」、红点、运营看板、审批收件箱（含 Muse）用同一个可见集合；企业管理员角色本身不再等于看全企业。
- 看不见的审批，在任何入口都批不了。
- 「本岗位负责的业务类型」从路由门与现有审批键派生，不新增权限键。

**Non-Goals（不动的模块 / 文件）：**

- `src/lib/pending-actions/executor.ts` 与 `canDecideTeamApproval`：执行期处理人规则、各类型批准时的键校验都不改。
- `canDecidePending` 与 ApprovalRequest / 产品内容的能批规则：不改，只在可见集合之内生效。
- 审批卡的生成（`drafts.ts`、各生产方）、通知、`cockpit/waiting.ts` 落点表：不改。
- `src/lib/tenancy/workspace-rbac.ts`（工作区审批角色）：不改。
- 路由门门表与 `/capabilities/approvals/**` 的页面放行：不改。
- 旧模式（行业包没有岗位模板）企业：规则不变。

## Decisions

### D1 可见集合 = 本人相关 ∪ 处理人路径 ∪ 本岗位负责的类型（Q1、Q3）

一条审批对成员可见，当且仅当满足任一：
- 本人提交（PendingAction `createdById`、ApprovalRequest 任务创建人、产品内容 `requestedById`）；
- 本人是指定审批人；
- 本人是审批所在工作区的成员（保留既有路径，今天没有生产方写工作区）；
- 本人是审批所属项目的负责人或 project_admin（执行器认他们处理，例如询价卡的项目负责人）；
- 按类型的可见岗位条件放行（D2、D3）。

平台 super_admin 全部可见。

被否决：
- 按任务书只留「本人提交 / 被指派 ∪ 类型」。项目负责人是询价卡在执行器里的处理人；不在可见集合里，就会出现「能批却看不见」。
- 保留企业管理员看全企业。这正是任务书要去掉的。

### D2 类型的可见岗位 = 业务页面经路由门放行 ∧ 持审批键（有键时）（Q2）

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

判定：`canOpenHref(page, ctx) && (keys 为空 || ctx.permissionKeys 含任一 key)`。页面门本身就是「模块已开 ∧ 岗位持键」（任务书「判定来源只有一处」），审批键再收窄到能批的人。

被否决：
- 只看业务页面。报价单对全体销售放行，销售会看到彼此的让利申请。
- 只看审批键。Sunny 老板持 `trade.settings.manage`，但企业没开 `trade` 模块，只看键会让他看到营收类审批。
- 按任务书给营销、招投标补「营销键」「投标审批键」。这两种键不存在，新增违反「不新增权限键」。招投标中心与品牌增长的门已经是「模块 ∧ 岗位键」。

### D3 没有业务归属的草稿仍对企业管理员可见（Q4）

类型不在 D2 对照里的 PendingAction（助手、Grader、日历草稿等）对本企业 org_owner / org_admin 可见。

执行器只认企业管理员、项目负责人 / 管理员与指定审批人处理企业级草稿，创建人本身不算（`team.ts:86-94`）。对管理员藏起这些草稿，它们就没人能批。

被否决：只对创建人可见。今天这些草稿的唯一处理人就是企业管理员，藏起来等于卡死。

### D4 旧模式企业沿用原规则（Q5）

`ctx.positionMode === false` 时，可见集合退回改动前：org_owner / org_admin 全部可见，其余成员只见本人提交、本人为指定审批人、本人所在工作区的。

被否决：旧模式也按 D2。旧模式企业没有岗位模板，管理员通常不持岗位键，会一下子看不到任何业务审批。

### D5 纯函数与查询条件同义（Q6）

`audience.ts`（纯模块，无数据库）提供：
- `approvalFamilyOf(sourceType, type)`：类型 → 对照项（或「无业务归属」）。
- `visibleFamilies(viewer)`：本人放行的对照项。只依赖判定输入，每次请求算一次。
- `isApprovalVisible(item, viewer)`：单条判定，给 ApprovalRequest、产品内容与详情用。
- `pendingActionAudienceWhere(viewer)`：PendingAction 的 Prisma 条件。
  - super_admin 为 `{}`；旧模式管理员为 `{}`。
  - 其余为 `OR` 组合：本人提交、本人审批、工作区 in、项目 in、可见对照项的 `type in` / `type startsWith`。管理员另加「不属于任何对照项」（`NOT: { OR: [全部对照项条件] }`）。
- 测试用小求值器把条件跑在样例行上，断言与 `isApprovalVisible` 逐行一致（同 #409 的写法）。

`viewer` = `{ userId, orgId, isPlatformAdmin, isOrgAdmin, workspaceIds, projectIds, ctx }`：
- `projectIds`：本企业内本人负责或任 project_admin 的项目。
- `ctx`：判定输入，与路由门同源。

新增 `src/lib/approval/audience-server.ts` 的 `loadApprovalViewer(userId, orgId)`：
- 平台角色按 `userId` 从库里读，不信调用方传的 `role`：审批中心经端口执行时传的是组织角色（`decision.ts:416-420`），不能用来判 super_admin。
- 判定输入走路由门加载器缓存。`ROUTE_GATE_LOADER` 加 `loadContextForOrg(user, orgId)`，复用其按 `(userId, orgId)` 的 30 秒缓存与合并请求，不列计数、不写库。
- 另查成员角色、工作区、项目各一次（可并行）。

被否决：
- 每个入口各写一份过滤。这正是现在四处漂移的原因。
- 每次都调 `loadNavigationContextForOrg`（4 次查询加岗位绑定解析、不缓存）。红点每 60 秒轮询一次。

### D6 审批中心接入（Q7）

`query.ts`：
- 列表里，PendingAction 的 `where` 加 `AND: pendingActionAudienceWhere(viewer)`，在查询里过滤，取 200 条的截断发生在过滤之后。
- ApprovalRequest 与产品内容在投影前用 `isApprovalVisible`。
- 删掉 `:291-306` 的旧过滤块：它的规则已在可见集合里，旧模式由 D4 保持。
- 详情加载到行之后先判 `isApprovalVisible`，不可见抛 404（与「不存在」同一个错误）。批准 / 驳回 / 撤回 / 重试都经详情加载，不另改 `decision.ts`。
- `viewer` 在 `buildCapabilitiesAccess` 之后由 `loadApprovalViewer` 取（审批中心路由、概览、首页岗位总览三处）。`CapabilitiesAccessContext` 不改形状；`listCapabilityApprovals` / `getCapabilityApproval` 多一个可选参数 `viewer`。缺省时自行加载，测试可注入。

被否决：在 `decision.ts` 另加可见校验。详情已是唯一入口，再加一处就是第二套规则。

### D7 待我确认、红点、运营看板与收件箱：既有处理人范围 ∩ 可见集合（Q8）

- `marketing/team.ts` 新增 `teamApprovalScopeWhere(userId, access)`，把四处重复的 `OR` 抽成一个函数（行为不变）。
- 四处的条件都改为 `AND: [teamApprovalScopeWhere(...), pendingActionAudienceWhere(viewer)]`：
  - AI 列表；
  - 红点：另加当前企业条件（`resolveAssistantOrgId`，与列表一致，另含本人个人草稿）；
  - 运营看板（看板所在企业）；
  - 收件箱：`listApprovalInbox(userId, { orgId })`。调用方传企业：`/api/agent/approvals` 用当前企业，Muse 用 `identity.orgId`。
- 批准 / 驳回入口先判可见：
  - `api/ai/pending-actions/[id]` 在 `canDecideTeamApproval` 之前判，看不见返回 404；
  - `approval/port.ts` 的 `approveApprovalItem` / `rejectApprovalItem` 判 PendingAction 可见，看不见返回 `ok: false`「审批不存在」，不执行。Muse 的 `approve` / `reject` 由此生效；审批中心批准也经端口（`decision.ts:416`），已在详情处判过，这里再判一次结果相同。
- 个人草稿（无企业、无项目、无指定审批人）照旧只给创建人。

被否决：「待我确认」直接等于可见集合。那会把本人提交但执行器不让本人批的草稿也列进「待我确认」。「待我确认」是「我能处理的」，保留既有处理人范围再取交集。

### D8 隔离库测试在本机 Postgres 16 上跑（Q9）

`src/lib/approval/__tests__/audience-db.isolated.test.ts`：照 `org-scoped-users-db.isolated.test.ts` 的写法，无 `DATABASE_URL` / `DATABASE_ENVIRONMENT=isolated` 时跳过，`assertSafeTestDatabase` 只放行本机。

本次在容器里起一个临时 Postgres 16（`/usr/lib/postgresql/16`），用 `prisma migrate deploy` 建表，跑完即删。种子：
- 虚构的岗位模式企业（窗饰行业包），含持 `owner` 的 org_admin、不持岗位的 org_admin、只持 `accounting`、只持 `sales_rep` 两人、只持 `bids`；
- 虚构的家纺外贸企业，含 Cathy 同款岗位；
- 每类审批各一条。

用真实的 `listCapabilityApprovals`、`getCapabilityApproval`、`decideCapabilityApproval`、两个「待我确认」路由处理函数与 `listApprovalInbox` 断言。注册进 `scripts/test-all.sh`（CI 无库时跳过）。

被否决：只写纯函数测试。查询条件拼错（如 `OR` 覆盖，#409 的教训）只有真查询能抓到。

## 与八条硬纪律的关系

1. 零 schema：不改 Prisma。类型对照是代码常量；判定输入来自既有岗位绑定与企业模块。
2. 出站先审批：只收窄谁能看见、谁能批，不改审批流程与执行器；看不见的审批一律批不了，不会多出出站。
3. 禁止第三套队列：不涉及，不新增队列或 cron。
4. 脱敏：列表与详情的投影（`adapters.ts`）与可见模式（`resolveDetailAccessMode`）不变；看不见的不再返回任何字段。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：类型对照、可见判定、查询条件都是查表与纯函数，零 LLM 调用。
8. 测试注册：两个新测试都注册进 `scripts/test-all.sh`。纯函数的另进 `scripts/test-ci-unit.sh`；隔离库的在 CI 无库时跳过。`bash scripts/check-test-registry.sh` 通过。

## Risks / Trade-offs

- [Sunny 体感变化小] → Sunny 老板持全部销售 / 订单 / 安装审批键，且招投标、品牌增长、产品内容放行，只少营收类（Sunny 没有）。真正收窄的是不持 `owner` 岗位的企业管理员，以及「待我确认」里同一批人。见 Q10。
- [不持对应岗位的管理员看不到营销、招投标卡] → 执行器仍认他们能批，但入口都看不见、批不了。卡的指定审批人与项目负责人照常可见可批。
- [持键的非管理员看得见、未必批得了] → 例如会计看得到别人确认尾款时生成的质保邮件卡，能批判定不变，不在「待我审批」里。这是「本岗位负责的类型」的本义。
- [多一次判定输入加载] → 审批中心、「待我确认」、红点、看板每次请求多一次 `loadApprovalViewer`：判定输入走 30 秒缓存，另 3 次轻查询。
- [红点数改为只数当前企业] → 多企业成员的红点数可能变小，与列表一致后才是真实可处理数。
- [首页「等你拍板」随之变化] → 不持对应岗位的管理员的横幅少掉这些类型。
- [既有断言要改] → `phase3a3-approvals-rbac.test.ts` / `phase3a3-approvals-smoke.test.ts`（管理员看全量的断言，后者要数据库）、`posts-read-model.test.ts`（待我审批加载器的注入）、`fact-proposals.test.ts` 与 `research-plan.test.ts`（若断言收件箱范围）、`durable-followup-m1.isolated.test.ts`。

## 验证方式

开工前先跑受影响测试、记基线（tasks.md 开头）。

新测试：
- `src/lib/approval/__tests__/audience.test.ts`：对照表、按身份的可见类型、可见集合与查询条件逐行同义、旧模式、super_admin。
- `src/lib/approval/__tests__/audience-db.isolated.test.ts`：见 D8。

门禁：
- `npm run test:ci`、`npm test`（环境类失败与 origin/main 相同）；隔离库测试在本机库上实跑一次，输出写进报告。
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx next build --webpack`。
- `openspec validate vis-1d-approvals-split --strict`。

## 审核关注点（偏离或补充任务书之处，请拍板）

- Q1（D1）：可见集合比任务书多两条路径：项目负责人 / project_admin（执行器认他们批询价卡）与工作区成员（既有路径，今天不生效）。
- Q2（D2）：类型按「业务页面放行 ∧ 审批键（有键时）」。营销、招投标没有审批键，不新增，按品牌增长、招投标中心的门判定。
- Q3（D1）：企业管理员角色本身不再看全企业的业务类型审批。**BREAKING**。
- Q4（D3）：没有业务归属的草稿（助手、Grader、日历）仍对企业管理员可见，否则没人能批。
- Q5（D4）：旧模式企业不变。
- Q6（D5）：判定输入加一个按 `(用户, 企业)` 缓存的加载方法，红点轮询不加重数据库。
- Q7（D6）：详情不可见按 404（与「不存在」同一错误），不给「无权查看」提示，避免暴露这条审批存在。
- Q8（D7）：
  - 「待我确认」= 既有处理人范围 ∩ 可见集合，不直接等于可见集合。
  - 红点数改为只数当前企业。
  - Muse 的 `status` / `approve` / `reject` / `next_step` 随之收口。
- Q9（D8）：隔离库测试在容器里临时起本机 Postgres 16 跑，CI 无库时跳过。
- Q10：任务书验收与实际绑定的差异：
  - Miki 在 `config/positions/sunny.json` 里同时持 `owner`，所以她看到的与老板相同，不是任务书写的「只见折扣 / 让利 / 质保」。
  - Sunny 老板按 VIS-1a Q10 持招投标，看得到全部 `tender.*`。
  - 任务书写的「看不到任何 `trade.*`」成立，但代码里没有 `trade.*` 审批类型，实际是看不到 `revenue_spine.*`。
- Q11：实现前核对发现的执行器问题不在本 change 修，建议各自另立：
  - 创建人批不了自己的企业级草稿；
  - 多位持键人只存第一位为审批人；
  - 销售 / 订单的键校验在认领之后，失败会消耗审批卡；
  - 审批中心把组织角色当平台角色传给执行器。
