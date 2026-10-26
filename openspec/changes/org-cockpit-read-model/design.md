# Design

## Context

所有事实均已回源码核实（A-1 交叉审查发现调研代理会数错，故逐条复核）：

- **AutomationRun**（`prisma/schema.prisma` `model AutomationRun`）：`automationKey`、`orgId?`、`status`（running / succeeded / partial / skipped / failed）、`startedAt`、`completedAt`、`error?`；索引 `(automationKey, startedAt)`、`(orgId, automationKey, startedAt)`、`(status, startedAt)`。`runTrackedAutomation` 的 24 个调用点都不传 `orgId`，运行流是平台级的；超过 30 分钟仍为 running 的会在同一 key 下次运行时被标 failed（`automation/runner.ts` `STALE_RUN_MS`）。
- **调度**：`vercel.json` 23 条 cron（`marketing-automation` 一条 cron 承载 5 个自动化键）。`daily-brief` `[7]`、`trade-followup` `[9, 14]`、`wechat-push` `[7]`（`:30`）、`trade-daily` `[8]` 按组织时区门控（`orgsAtLocalHour`），非当值小时直接返回、不写运行记录；营销流按 `America/Toronto` 门控（`marketing/automation-schedule.ts`：sync-metrics `[1,7,13,19]`、health `[7]`、daily-brief `[8]`、experiment-review 周一 `[9]`；CRM 归因 `[7]`）。`marketing-mmm` 没有 cron（按需）。`employee-ai-practice-miner` 在 `EMPLOYEE_AI_LEARNING_ENABLED !== "1"` 时直接返回、不写记录。`getAutomationReadiness()` 按 `requiredEnv` 给出 `configured`。
- **待我审批**：`listCapabilityApprovals(access, { tab: "pending_mine" })`（`capabilities/approvals/query.ts`）合并 PendingAction（30 天窗口、take 200、逐行判决策权）、ApprovalRequest（经 `task.project.orgId`）与 ProductContentApproval，过滤 `status === "PENDING" && capabilities.canApprove`；返回 `ApprovalProjection`（`sourceType` / `sourceId` / `projectId` / `runId` / `actionType` / `title` / `createdAt`）与过滤后 `total`，`pageSize` 上限 100。访问上下文用 `buildCapabilitiesAccess(tenant)`，要求活跃成员身份。
- **需要你**：`listWorkforceJobViews({ orgId, status: "needs_you", limit ≤ 50 })` 返回 `WorkforceJobListItem`（`jobId` / `title` / `needsYou{type, title, pendingActionIds}` / `lastActivityAt`），不含工作域；工作域在 `AgentRun.metadata.workDomain`，旧作业缺失时 `resolveEffectiveWorkDomain`（只读查询）可解析。
- **需决策类通知**都是底层条目的提醒：FDE 草稿通知带 `metadata.pendingActionId`，营销计划审批通知带 `pendingActionId`，agent 审批通知 `entityType: "approval_request"`。
- **配额**：`DAILY_AGENT_RUNS` 在 `createAgentRun` 之前预留，命中时抛错、不建 run；审计 `writeCapabilityAuditEvent`（`action: "QUOTA_HARD_LIMIT_BLOCKED"`, `targetType: "quota"`, `targetId: "DAILY_AGENT_RUNS"`）在系统发起时因 `AuditLog.userId` 外键失败而被吞；通知 `notifyQuotaHardLimitBlocked` 发给组织 owner / org_admin（`type: "quota_hard_limit"`, `entityId: metric`），周期按 UTC 日。
- **索引**：AuditLog 有 `(orgId)`、`(createdAt)`、`(orgId, workspaceId, createdAt)`；AgentRunEvent 只有 `(orgId, runId)` 与 `(runId, sequence)` 唯一；Notification 有 `(userId, createdAt)`；PendingAction 有 `(orgId, status, createdAt)`；AgentRun 有 `(orgId, status)`。
- **脱敏**：`muse-bridge/contract.ts#containsOutboundSensitive(text, { strict })` 是纯函数（只依赖 zod 的模块），strict 额外拦"利润 / profit"。
- **组织与角色**：`resolveWorkforceApiOrgForUser`（只读，`read-model/api-org.ts`）；首页 `/` 的管理层判定 `canAccessManagementWorkspace(ctx)` 只看平台角色（超管 / 高管）与 `orgRole`（`org_admin` / `org_owner`）。`resolvePreferredOrgId` 会写库（`setUserActiveOrgId`），不能用。
- **KPI**：`getTenderPortfolioSummary` 函数内不检查 `TENDER_FINANCIAL_CONTROL_ENABLED`（只有路由 `financeDisabledResponse()` 检查）；`listDeliveryProjects` 需要 `OpsAccessContext`，既有路由用 `{ platformRole, orgRole, hasMembership, userId }` 构造。

## Goals / Non-Goals

**Goals:**
- 两个只读 API 的全部业务规则（调度、健康度、归属、去重、归并分页、脱敏）落在纯函数里，表驱动测试覆盖；DB 装配层只做查询与拼装，依赖可注入。
- 与既有页面口径一致：等你 N 件 = `/capabilities/approvals` 待我审批 ∪ `/workforce` 需要你；跳转用既有页面。
- 任何一个来源失败只影响自己那一块（KPI `error`、`truncated`），接口整体照常返回。

**Non-Goals:**
- 不改 `src/lib/automation/**`、`src/lib/capabilities/**`、`src/lib/workforce-runtime/**`、`src/lib/muse-bridge/**`、`src/lib/project-finance/**`、`src/lib/marketing/**`、`src/lib/operations/**`、`src/lib/employee-ai/**`、`src/lib/revenue-spine/**`、`src/lib/cockpit/{posts,metrics-engine,types,weekly-report}.ts`。
- 不改 `src/app/api/cockpit/route.ts`（旧老板驾驶舱）及任何既有路由；不改 `src/app/(main)/**`（A-3）。
- 不改 `prisma/**`、`vercel.json`、`src/lib/runtime-architecture/**`、`.github/workflows/**`。
- 不实现工作量 / 成本聚合（A-4）、配额命中通知（B-5）、缓存或实时推送。

## Decisions

### D1 调度用类型化表，不解析 `cadence` 文本
- **选择**：`AUTOMATION_SCHEDULES: Record<AutomationKey, AutomationSchedule>`，三种形态：`cron`（UTC cron 表达式 + 路由路径，每次触发都记录运行）；`local_hours`（唤醒 cron + 路由路径 + 门控小时 + 时区 `"org"` 或固定 IANA + 可选星期，只在门控小时记录）；`on_demand`。可选 `enabledEnv` 描述"开关未开就不跑"（practice-miner）。支持的 cron 子集：分 / 时字段为 `*`、`*/N`、数字或逗号列表，日 / 月为 `*`，星期为 `*` 或单个数字；遇到不支持的写法测试即失败。
- 测试交叉核对：每条非按需调度在 `vercel.json` 里有同路径同 `schedule` 的 cron；路由源码里含 `runTrackedAutomation("<key>"`（或营销流的 `AUTOMATION_KEY` 映射）；`local_hours` 的门控数组与路由源码一致（组织时区的四个看 `orgsAtLocalHour(…, [h])`，营销的看 `automation-schedule.ts`）。
- **否决 A：解析 `cadence` 中文文本** —— 文本有"每日 4 次，Activepieces 执行""按需/月度"等不规则写法，且与真实调度可能漂移；任务书 Out of scope 也不许改注册表去规范化它。
- **否决 B：运行时读 `vercel.json`** —— 部署产物里不一定带这个文件；运行时读文件也不是纯函数。
- **否决 C：用 "上次开始 + 周期" 推下次** —— 对门控型（只在本地 7 点记录）与"每小时第 25 分"类不准；按 cron 触发时刻推才与实际一致。

### D2 健康度：先判"不该有心跳"，再判"心跳坏了"，最后判"心跳慢了"
- **选择**：单自动化顺序 `n/a` → `not_configured` → `never_ran` → `failed`（含 running 超 30 分钟，与 runner 的僵尸回收阈值一致）→ `late`（距上次开始 > 最长正常间隔 × 1.5）→ `on_time`。`partial` 与 `skipped` 视为跑过。岗位取最严重者，顺序 `failed > quota_hit > late > never_ran > not_configured > on_time > n/a`；配额命中只抬升有 AgentRun 工作的岗位。
- 最长正常间隔：cron 型在 8 天窗口内枚举触发时刻取最大相邻差（模块级按表达式缓存）；门控型取门控小时的最大环形间隔（带星期为 7 天），不随 DST 微调（1.5 倍系数吸收 ±1 小时）。
- **否决 A：late 用固定 1 小时宽限** —— 对每 2 分钟的队列太宽、对每周任务太窄。
- **否决 B：`partial` 算 `failed`** —— partial 是"部分组织 / 条目失败"，整条流水线在跑；卡片会长期标红，失去信号。明细里保留 `lastRun.status` 供人判断。

### D3 等你 N 件复用 `/capabilities/approvals` 的"待我审批"，并上 workforce 需要你
- **选择**：`listCapabilityApprovals(access, { tab: "pending_mine", pageSize: 100 })` 取第 (1) 部分（结果 `total > items` 时 `truncated: true`）；`listWorkforceJobViews({ orgId, status: "needs_you", limit: 50 })` 取第 (2) 部分（有 `nextCursor` 时 `truncated: true`）。去重：作业 `needsYou.pendingActionIds` 非空且全部在 (1) 的 PendingAction `sourceId` 集合里时不计。
- 岗位归属：PendingAction 再按 `sourceId` 批量取 `type / projectId / agentRunId / payload` 交给 A-1 的 `postForPendingAction`（项目工作域取 `projectId`，为空时取 `payload.targetType === "PROJECT"` 的 `payload.targetId`，再批量查 `Project.workDomain`；目标类型取 `payload.targetType ?? payload.metadata.targetType`；runType 批量查 `AgentRun`）。ApprovalRequest 按 `projectId` 的工作域，判定不出归 `projects`（它们由 `project-inspection` 的旧任务流产生）。ProductContentApproval 归 `content`。
- **否决 A：照搬 `/api/ai/pending-actions` 的可见性 OR** —— 只含 PendingAction，漏掉 ApprovalRequest 与产品内容审批，且不判决策权（能看见 ≠ 能拍板）。
- **否决 B：把需决策类 Notification 也并进来** —— 已核实它们都是 PendingAction / ApprovalRequest 的提醒，并进来只会重复计数。
- **否决 C：用侧栏角标的计数接口** —— 它不限定当前组织（跨组织），与驾驶舱按组织的口径冲突。

### D4 时间线：三路各取 `limit + 1`，按 `(at, id)` 倒序归并，游标编码 `(at, id)`
- **选择**：每路查询条件 = 本组织（AutomationRun 除外）+ `at ≥ now - days` + 严格早于游标（`at < c.at` 或 `at = c.at 且 id < c.id`），`orderBy [at desc, id desc]`，`take limit + 1`；纯函数归并后取前 `limit`，若合并结果多于 `limit` 则 `nextCursor = 第 limit 条的 (at, id)`。三路的 `id` 加前缀（`audit:` / `event:` / `run:`）保证全局唯一与稳定排序。游标为 base64url JSON `{t, i}`，解码失败 400。
- AgentRunEvent 只取 `visibleToUser` 且在 9 种事件类型白名单内的；AutomationRun 只取 `failed / partial` 或最长正常间隔 ≥ 24 小时的键。岗位归属与 `href` 按 spec，批量查 `AgentRun(id, runType, metadata)` 与 `PendingAction(id, type, projectId, agentRunId, payload)`。审计日志摘要只用 `action` 与 `targetType`，不读 `beforeData / afterData`。
- **否决 A：offset 分页** —— 新条目写入时页码漂移，翻页会重复或遗漏。
- **否决 B：只取 AuditLog** —— AI 与自动化的动作大多不进 AuditLog，company.log 会只剩人的操作。
- **否决 C：给 AuditLog / AgentRunEvent 加 `(orgId, createdAt)` 索引** —— 违反零 schema；以窗口 + 条数上限 + 白名单兜底，并把 `EXPLAIN` 列为 staging 验证项。

### D5 访问控制：withAuth → 只读组织解析 → 管理层判定
- **选择**：`withAuth` → `resolveWorkforceApiOrgForUser`（失败按 `workforceOrgFailureHttp`）→ 查 `OrganizationMember(orgId, userId)` 得 `orgRole` → `canAccessManagementWorkspace({ platformRole, orgRole, hasMembership })` 为假则 403。读模型拿到 `{ userId, platformRole, orgId, orgRole }`，待我审批的访问上下文用 `buildCapabilitiesAccess`（无成员身份时第 (1) 部分记为 `truncated` 且为空，不让接口整体失败）。
- **否决 A：所有组织成员可看** —— 岗位视图汇总了全组织审批、投标中标数、营销线索与日志，普通成员不应在一个接口里拿到全部；首页本身也只对管理层开放。
- **否决 B：沿用旧 `/api/cockpit` 的 `organizationMember.findFirst({ userId })`** —— 多组织时任意取一个，跨组织风险。

### D6 KPI 取数：类型化加载器 + `pickKpiMetrics` + 各自隔离
- **选择**：`KPI_LOADERS: { [S in PostKpiSource]: (ctx) => Promise<PostKpiSourceResults[S]> }`，漏配一个来源 tsc 报错；`Promise.allSettled` 并发，失败的岗位记 `error` 并 `console.error`（不带结果内容）。投标加载器先查 `isFinancialControlEnabled()`，关闭时直接返回 `disabled` 不调用；窗口取注册表声明的 365 天。项目加载器用 `{ view: "team", pageSize: 1 }`（`sections` 在分页前统计）。返回前一律经 `pickKpiMetrics`。
- **否决：为每个 KPI 新写精简查询** —— 违反任务书"指向既有读函数，不新写查询"。

### D7 脱敏：复用 Muse 检测函数，驾驶舱自己的替换文案
- **选择**：`redactCockpitText(text)`：截断到 300 字，`containsOutboundSensitive(text, { strict: true })` 命中则返回 `COCKPIT_REDACTED`（"（该内容含内部财务信息，驾驶舱不展示，请到对应页面查看。）"）。作用于等你 N 件的标题、时间线摘要与自动化错误信息。
- **否决：直接用 `sanitizeOutbound`** —— 其替换文案写的是"不通过 Muse 通道输出，请在青砚内查看"，在青砚自己的首页上语义错误。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守：不加模型 / 字段 / 索引 / migration；只读既有表 |
| 2 | 出站先审批 | 不涉及：无任何出站，不创建也不执行 PendingAction，只读计数 |
| 3 | 禁止第三套队列 | 遵守：不新增 cron / scheduler / queue / worker；调度表只用于推算展示，不触发任何运行 |
| 4 | 脱敏 | **触碰**：投标 / 营销 KPI 读函数返回值含毛利率 / 利润 / 估值 / 中标金额，条目标题与日志摘要可能含敏感词。遵守方式：KPI 只经 `pickKpiMetrics` 取声明路径；自由文本经 `containsOutboundSensitive`（strict）整段替换；审计日志不读变更前后数据 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守：健康度、归属、去重、排序全部查表 / 纯函数，零 LLM 调用 |
| 8 | 测试注册 | **触碰**：4 个新测试在各自 task 内注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` |

## Risks / Trade-offs

- [接口一次调用多个重读函数（投标 N+1、营销看板、待我审批逐行判权、28 次最近运行）] → 首页只在打开时调用；各块 `allSettled` 隔离；A-3 若实测慢再加短缓存（另开 change）。
- [AuditLog / AgentRunEvent 无 `(orgId, createdAt)` 索引] → 7 天窗口 + `limit + 1` + 事件白名单；staging 上跑 `EXPLAIN ANALYZE` 记入报告；不达标再评估是否申请 schema 例外。
- [平台级心跳：别的组织的运行也会刷新本组织卡片的心跳] → 响应标 `heartbeatScope: "platform"`，A-3 卡片注明"平台级"。
- [配额命中两路信号都可能漏（系统发起的审计写入失败、非管理员收不到通知）] → 驾驶舱只对管理层开放，查看人本身就是通知收件人；平台超管 / 高管若非组织管理员则只能依赖审计记录。
- [待我审批的 PendingAction 只看 30 天窗口] → PendingAction 默认 24 小时过期，30 天外的待审批实际已过期；与 `/capabilities/approvals` 口径一致。
- [`resolveEffectiveWorkDomain` 对缺工作域的旧作业逐个查询] → 只对需要你作业（≤ 50）做，且只在缺失时。

## 验证方式

- `npx tsx src/lib/cockpit/__tests__/schedule.test.ts`：调度表 vs `vercel.json` / 路由源码交叉核对；`nextDueAt` 表驱动（上海 / 多伦多 / DST 切换 2026-11-01 / 星期门控 / 按需）；最长间隔与健康度各分支。
- `npx tsx src/lib/cockpit/__tests__/waiting.test.ts`：归属、去重、截断、排序、前 10 条、未归属计数、脱敏。
- `npx tsx src/lib/cockpit/__tests__/timeline.test.ts`：信封、归属、白名单、三路归并翻页不重不漏、游标编解码与 400 参数校验、脱敏。
- `npx tsx src/lib/cockpit/__tests__/posts-read-model.test.ts`：注入假依赖装配整份响应（七岗位顺序、KPI 四种状态、配额抬升、财务开关关闭不调用）；静态断言读模型与路由源码只读、每个 `db.<model>.` 查询都带 `orgId`（AutomationRun 除外）、不出现 `resolvePreferredOrgId`；路由走 `withAuth` + `resolveWorkforceApiOrgForUser` + `canAccessManagementWorkspace`。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`npm test`（与基线比对）、`npm run test:runtime-architecture`。
- `git diff --stat origin/main -- prisma/ vercel.json` 为空；`openspec validate org-cockpit-read-model --strict` 通过。
- staging（GATE 时）：`EXPLAIN ANALYZE` 时间线三条查询；以 `seed:org:sunny-home-deco` 组织管理员调用两个接口核对数字。

## Migration Plan

无部署动作与数据迁移：新增两个只读路由，合并即可用；回滚 = revert 该 PR。
