# Design

## Context

- 动机与偏差见 proposal.md；对外行为见 `specs/cockpit/workload/spec.md`。
- **归属规则已存在**：
  - A-1 `src/lib/cockpit/posts.ts`：`postForAgentRunType` / `postForWorkDomain` / `postForPendingAction`、`UNCLASSIFIED_PROJECT_DOMAIN`；
  - A-2 `src/lib/cockpit/waiting.ts`：`PendingActionRow`、`projectIdOf`、`targetTypeOf`、`lookupIdsFor`；
  - A-2 `src/lib/cockpit/posts-read-model.ts`："7 天 AI 运行"的两个查询条件 `agentRunTypeCountWhere`（运行类型）与 `workforceDomainCountWhere`（`runType = "workforce_job"` 且 `metadata.workDomain` 精确相等）；窗口为 `now - 7×24h`，按 `createdAt`。
- **数据源事实**（核对见 `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`"A-4 预研事实"）：
  - **AgentRun**：`orgId` 必填；无 `(orgId, createdAt)` 索引。
  - **AutomationRun**：`orgId` 恒为空（平台级）；有 `(automationKey, startedAt)` 索引。
  - **PendingAction**：
    - 状态只有 pending / approved / executed / rejected / failed；
    - 有 `decidedAt`、`decidedById`、`executedAt`、`failureReason`、`updatedAt`（Prisma `@updatedAt`，`updateMany` 也会刷新）；
    - 索引 `(orgId, status, createdAt)`。
    - 失败原因的写入方：`approval/port.ts` 与 `executor.ts` 写"已过期"；`capabilities/approvals/decision.ts` 写"已取消"（有决策人）；`executor.ts` 与 `agent-runtime/pending-link.ts` 写"关联任务已取消，动作未执行"；`pending-actions/supersede.ts` 写 `SYSTEM_SUPERSESSION_REASON_CODES` 前缀加证据。
  - **询盘**：`SalesAction` 有 `employeeKey = FDE_EMPLOYEE_KEY`、`actionType = "inbound_inquiry"`、`pendingActionId`、`agentRunId`、`inputContext.guardrailBlockedAt`。`sla-metrics.ts` 已导出 `isOnboardingTestInquiry`、`utmSourceOf`、`TRADE_SHOW_SOURCE`、`INBOUND_INQUIRY_ACTION_TYPE`。跟进护栏审计动作为 `FOLLOW_UP_GUARDRAIL_AUDIT_ACTION`（`fde/no-reply-followup.ts`）。
  - **AiUsageLedger**：有 `orgId`、`runId?`、`sourceType`、`inputTokens?`、`outputTokens?`、`costAmount Decimal`、`currency`、`occurredAt`；索引 `(orgId, occurredAt)`。只有对话接口（stream-guard 写入请求上下文的组织）与产品内容模块会写入带组织的记账。
  - **组织时区**：`resolveOrgTimezone(settingsJson)` / `loadOrgTimezone(orgId)`（`src/lib/automation/registry.ts`），缺省 America/Toronto；`getLocalTimeParts(date, tz).date` 给本地日期。
- **首页**：A-3 的 `OrgCockpitView` 无 hooks，容器 `OrgCockpitHome` 只引用两个接口（渲染测试静态断言）。

## Goals / Non-Goals

**Goals:**
- 汇总、结局判定、归属、分天、规则、阈值全部是纯函数，表驱动测试覆盖；读模型只负责查询与把行喂给纯函数。
- 近 7 天 AI 运行与岗位卡片逐位相等（同一组查询条件）。
- 首屏请求数不变。

**Non-Goals:**
- 不改 `src/lib/cockpit/{posts,schedule,waiting,timeline,posts-read-model,presentation,home-state}.ts` 的现有导出与行为。新增函数只放在新文件里；A-2 的两个查询条件函数原样复用。
- 不改 `src/app/api/cockpit/{posts,timeline}/route.ts`。
- 不改 `src/lib/revenue-spine/sla-metrics.ts`、`src/lib/pending-actions/**`、`src/lib/approval/**`、`src/lib/capabilities/usage/**`、`src/lib/ai/usage-ledger-bridge.ts`（只读引用其导出常量）。
- 不改 `prisma/schema.prisma`、`vercel.json`、`src/app/(main)/layout.tsx`、侧栏。

## Decisions

### D1 纯函数 `computeWorkload(rows, options)` + 读模型装配
- **选择**：分两层。
  - **读模型**（`workload-read-model.ts`）把六类来源读成扁平行，并提前解析出归属所需的查找表。六类来源：AI 运行、自动化日计数、待审批动作、询盘、跟进护栏审计、用量记账。
  - **`computeWorkload`**（`workload.ts`）做全部判定与汇总：结局、归属、分天、近 7 天、规则。
  - 依赖可注入：测试用假依赖覆盖装配；生产查询条件由导出的纯函数构造，并直接断言。这与 A-2 的做法一致。
- **否决：在 SQL 里按天分组（`$queryRaw` + `date_trunc ... AT TIME ZONE`）**：要写原生 SQL；结局判定这类规则要在 SQL 和 TS 里各写一遍；也没法用表驱动测试覆盖。

### D2 AI 运行复用 A-2 的查询条件
- **选择**：
  - 运行类型部分用 `agentRunTypeCountWhere(orgId, since, runTypes)` 取行（`createdAt`、`runType`）；
  - workforce 作业逐个工作域用 `workforceDomainCountWhere(orgId, since, domain)` 取行；
  - 纯函数按"运行类型 → 岗位""工作域 → 岗位"计数。
  - 近 7 天合计用 `at ≥ now - 7×24h` 计算，与 A-2 相同，测试用同一批夹具断言两边相等。
  - 不属于任何岗位的运行（对话等）不读：A-2 的卡片也不统计它们，"未归属"行的 AI 运行恒为 0。
- **否决：读全部 AgentRun 再在内存里归属**：对话类运行量大，且会和卡片口径不一致。

### D3 平台自动化按本地日逐日 `groupBy`
- **选择**：对 N 个本地日的边界（`zonedLocalToUtc` 算出），各做一次 `automationRun.groupBy({ by: ["automationKey"], where: { automationKey in 注册表, startedAt in [dayStart, nextDayStart) } })`，走 `(automationKey, startedAt)` 索引。近 7 天合计另做一次 `startedAt ≥ now - 7×24h` 的 `groupBy`。
- **否决：取全部运行行**：每 2 分钟一次的自动化 14 天就有上万行。

### D4 待审批动作按 `updatedAt ≥ 窗口起点` 取
- **选择**：`where: { orgId, updatedAt: { gte: from } }`，因为窗口内创建或决策的动作，其 `updatedAt` 都 ≥ 窗口起点。
  - 只选结局判定与归属需要的列：`type`、`status`、`failureReason`、`decidedById`、`createdAt`、`decidedAt`、`executedAt`、`updatedAt`、`projectId`、`agentRunId`、`payload`。其中 `payload` 只用来取目标类型与目标 id，不进响应。
  - 归属查找表复用 A-2 的 `lookupIdsFor` + 项目工作域 / 运行类型查询。
  - 询盘回复动作再用 `SalesAction.pendingActionId in (...)` 取询盘上下文，判定测试与展会。
- **否决：`OR(createdAt, decidedAt, executedAt)`**：三个条件拼 OR 同样走不了索引，还更啰嗦。`(orgId, updatedAt)` 没有索引，列入 staging `EXPLAIN` 待验项。

### D5 结局判定是一张有序规则表
- **选择**：按顺序判定，第一条命中即停。
  1. 失败原因以入驻测试作废码开头 → 排除；
  2. `pending` → 待定（不计结局）；
  3. `approved` / `executed` → 批准；
  4. `rejected` 且原因以"关联任务已取消"开头 → 取消；其余 `rejected` → 驳回；
  5. `failed` 且原因为"已过期" → 过期；
  6. `failed` 且原因为"已取消" → 取消；
  7. `failed` 且原因以另外两个系统作废码开头 → 作废；
  8. `failed` 且有决策人 → 批准 + 执行失败；
  9. 其余 `failed` → 系统失败。
  - 作废码列表直接引用 `SYSTEM_SUPERSESSION_REASON_CODES`。"已过期""已取消""关联任务已取消"三个字面量放成常量，测试读写入方源码核对，防止漂移。
- **否决：按 `decidedById` 是否为空区分人工 / 系统**：`approval-timeout` 的过期与人工取消都要靠失败原因才能分开。

### D6 用量归属与"未入账"
- **选择**：取窗口内本组织记账行：`occurredAt`、`runId`、`sourceType`、`inputTokens`、`outputTokens`、`costAmount`、`currency`。
  - 有 `runId` 的，按运行的类型 / 工作域归属（批量查 `AgentRun`）；
  - `sourceType = PRODUCT_CONTENT` 的，归内容；
  - 其余归"未归属"。
  - 成本只汇总 USD；某行窗口内一条记账都没有时标"未入账"。
  - 成本以美元数值返回（保留 4 位小数），区块显示 `$x.xx`。
- **否决：按 `metadata.monitorSource` / `metadata.route` 猜岗位**：来源字符串散落在约 60 个调用点，没有登记表，猜错比不归属更糟。

### D7 首页区块：插槽 + 独立容器，点击才请求
- **选择**：
  - `OrgCockpitView` 新增可选 `workloadSlot?: ReactNode`，渲染在卡片与 company.log 之间；它仍然无 hooks。
  - `OrgCockpitHome` 传入 `<OrgCockpitWorkload />`。
  - 新文件 `org-cockpit-workload.tsx` 包含两部分：
    - 客户端容器：持有收起 / 加载中 / 失败 / 就绪四种状态，点击按钮才 `apiFetch("/api/cockpit/workload")`；
    - 无 hooks 的展示组件 `WorkloadPanel`。
  - A-3 渲染测试里"容器只引用两个接口"的断言不变；本 change 的测试另外断言工作量接口只出现在区块文件里。
- **否决：把规则结果并进 `/api/cockpit/posts` 让岗位卡片直接标红**：要改 A-2 的响应形状，还会让首屏接口多出六类查询，拖慢首屏。可以作为后续 change：读模型稳定后，把规则结果按需带进岗位卡片。

### D8 走势小图按 dataviz 规范手写 SVG
- **选择**：每行一个约 112×28 的内联 SVG，画 14 根柱：AI 运行用中性色，提出用强调色叠在其上。规则如下：
  - 不引入图表库；
  - 颜色取主题 token；
  - 有 `aria-label` 写明数值概要；
  - 数值表格是主信息，小图只做形状提示。
  - 实施前加载 `dataviz` 技能核对配色与可读性。
- **否决：引入 recharts 等图表库**：14 个点的小图不值得加依赖，且需在客户端渲染，打破展示组件可服务端静态渲染测试的约定。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守：只读 `Organization.settingsJson.cockpit.workloadThresholds`（既有 JSON 位），不写；不改 Prisma |
| 2 | 出站先审批 | 遵守：接口与区块零 mutation，不触发任何动作；规则只展示 |
| 3 | 禁止第三套队列 | 遵守：不加 cron / 队列 / 后台任务；区块点击才请求 |
| 4 | 脱敏 | **触碰**：响应只含计数、token、成本合计与固定文案，不含动作标题 / 载荷 / 失败原因原文 / 客户信息 / 报价金额；测试断言夹具里的邮箱与金额不出现在响应中 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守：结局与规则全部查表 / 阈值比较，零 LLM 调用 |
| 8 | 测试注册 | **触碰**：`src/lib/cockpit/__tests__/{workload,workload-read-model}.test.ts` 与 `src/components/cockpit/__tests__/org-cockpit-workload.test.tsx` 在各自 task 内注册进 test-all 与 test-ci-unit |

## Risks / Trade-offs

- [`PendingAction` 按 `(orgId, updatedAt)` 无索引] → 走 `(orgId, status, createdAt)` 的 orgId 前缀；行数上限 5000 并标 `truncated`；staging 跑 `EXPLAIN ANALYZE`。
- [`AgentRun` 无 `(orgId, createdAt)` 索引]（A-2 同一问题）→ 条件里带 `runType`；上限 5000；staging `EXPLAIN`。
- [成本基本"未入账"] → 如实显示"未入账"；补记账另开 change（让 FDE / 定时任务的 AI 调用带组织入账）。
- [空转规则对"本来就不产待审批"的 AI 运行会误报] → 默认最小运行数 1 照任务书；组织可调高 `idleMinRuns`；标红只是信号。
- [按 `updatedAt` 取的结局日：过期动作没有决策时间，取最后更新时间] → 过期由定时任务一次性写入，之后不再更新，最后更新时间即过期时间。
- [跟进护栏审计无法区分测试 / 展会] → 全计入询盘销售行，与 SLA 指标的 `guardrail.followUp` 同口径。

## 验证方式

- `npx tsx src/lib/cockpit/__tests__/workload.test.ts`（≥ 15 个表驱动用例）：
  - 结局判定九条规则与其优先级；
  - 过期不计入驳回；改过再批"未接入"；
  - 分天：上海、多伦多，以及 2026-11-01 夏令时；
  - 近 7 天边界；
  - 四条规则，含样本不足与成本中位数；
  - 阈值逐项校验；
  - 测试询盘排除、展会单列；
  - 用量归属与"未入账"。
- `npx tsx src/lib/cockpit/__tests__/workload-read-model.test.ts`：
  - 参数校验；
  - 假依赖装配；
  - 查询条件纯函数断言，含与 A-2 同一组条件、近 7 天与卡片相等；
  - 行数上限标 `truncated`；
  - 响应不含夹具里的邮箱 / 金额；
  - 读模型与路由源码只读、路由只导出 `GET`、复用 `resolveCockpitViewer`。
- `npx tsx src/components/cockpit/__tests__/org-cockpit-workload.test.tsx`：
  - 收起态只有按钮；就绪态表格与合计；
  - 规则命中行的危险色与原因；
  - "未入账""未接入""不适用"说明；
  - 展会 / 未归属行全 0 时隐藏；失败态重试；
  - 源码静态断言：工作量接口只在区块文件、首页容器仍只两个接口、展示组件无 hooks、区块无非 GET 请求。
- 视觉核对：离线渲染夹具 + 真实主题样式 + 模拟侧栏，截 1280 / 820 / 390。
- 全量门禁：
  - `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`；
  - `npm test` 与基线比对；
  - `git diff --stat origin/main -- prisma/ vercel.json` 为空；
  - `openspec validate org-cockpit-workload --strict`。

## Migration Plan

无数据迁移。合并后首页多一个默认收起的区块；回滚 = revert 该 PR。阈值不设置即用默认值。
