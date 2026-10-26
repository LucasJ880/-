# Design

## Context

- 自动化注册表 `src/lib/automation/registry.ts` 是 `as const satisfies readonly AutomationDefinition[]` 的常量数组，`AutomationKey` 由它派生；当前 28 项。它的 `category` 字段（projects / sales / service / marketing / operations）是给设置页分组用的，与岗位不是一回事：例如 `tender-watch` 是 `projects`，`inquiry-sla` 是 `service`，`aivora-sync` 是 `operations`。
- `PendingActionType`（`src/lib/pending-actions/types.ts`）是纯类型联合，14 个成员，运行时没有枚举数组。
- 产出方核查（交叉审查发现、已逐条 grep 复核）：`calendar.create_event` 由 `agent-runtime-v2/adapters.ts`（销售跟进提醒）、`agent-core/tools/sales-drafts.ts`、`assistant/scenarios/customer-followup.ts`、`ai-grader/actions/to-pending-action.ts` 产出；`grader.email_draft` 由 `agent-runtime-v2/adapters.ts`（客户跟进邮件，`targetType: "CUSTOMER"`）、`assistant/scenarios/gmail-draft.ts`、技能桥 `agent-core/skills/pending-action-bridge.ts`、ai-grader 产出；`grader.internal_note` 由 `agent-core/approval-gate.ts`（`targetType: "PROJECT"`）、技能桥、ai-grader（目标 QUOTE / OPPORTUNITY / CUSTOMER / PROJECT）产出；`grader.project_task` 由技能桥与 ai-grader 产出。`proactive/run-scan.ts` 不产任何 PendingAction。上下文字段分布不统一：有的写 `PendingAction.projectId`，有的写 `payload.metadata.targetType`，有的只有 `agentRunId`。
- workforce 工作域 `WORK_DOMAINS = ["tender", "delivery", "sales", "general"]`（`src/lib/workforce-runtime/work-domain.ts`），该模块导入 `@/lib/db` 与工具目录，导入耗时约 3 秒但不连库。
- AgentRun.runType 是自由字符串。源码里写入的取值共 7 个：`conversation`（messaging / mention gateway）、`assistant_dispatch`、`background_conversation`（`agent-runtime/queue.ts` 的 `BACKGROUND_RUN_TYPE`，经 update 写入）、`supervisor`（frozen）、`workforce_job`（按 `metadata.workDomain` 区分业务）、`fde_inbound_sales`（`FDE_RUN_TYPE`）、`runtime_v2`（`agent-runtime-v2/process.ts` 唯一写入点，intent 固定 `sales_followup_triage`）。
- CI（`.github/workflows/ci.yml`）跑的是 `npm run test:ci` = `scripts/test-ci-unit.sh`，不是 `test-all.sh`。
- KPI 候选读函数（只读、按 orgId）调研结论：

| 岗位 | 既有读函数 | 统计窗口 | 取的三个指标（格式） | 同一返回值里的敏感字段（不取） |
|---|---|---|---|---|
| inbound_sales | `revenue-spine/sla-metrics.ts#loadSlaMetrics` | 近 30 天（函数默认） | `inquiries.medianFirstResponseMinutes`（分钟）/ `inquiries.answeredWithin24hRate`（比率 0..1）/ `guardrail.total`（计数） | 无 |
| tender | `project-finance/portfolio.ts#getTenderPortfolioSummary` | 近 365 天（调用方传入；与 `/api/org/tender-portfolio` 默认一致） | `tenderSubmittedCount`（计数）/ `wonCount`（计数）/ `winRatePercentage`（百分比字符串 0..100） | `wonProjects.*Margin*` / `*Profit*` / `*RevenueCad`、`indicativeTenderValue`、`awardedValueCad`、各 `*BidCostCad` |
| marketing | `marketing/query-dashboard.ts#getMarketingDashboard` | 本月至今（服务器时区） | `summary.effectiveLeads`（计数）/ `summary.growthExecution`（得分 0..100）/ `summary.highPriorityIssues`（计数） | `funnel.economics.grossMarginRate` / `attributedGrossProfit` / `roi` / `breakEvenRoas`、`summary.revenue` / `summary.spend` |
| service | 无（只有写入型 `runServiceInboxSla`，计数内联在 `GET /api/service-inbox`） | — | — | — |
| projects | `operations/projects/query.ts#listDeliveryProjects` | 当前时点，按查看人可见范围 | `sections.needsAttention` / `sections.active` / `sections.onHold`（均计数） | 无 |
| ops_knowledge | `employee-ai/metrics.ts#getTeamLearningMetrics` | 全部历史 | `candidatePracticeCount`（计数）/ `activePlaybookCount`（计数）/ `acceptRate`（比率 0..1，无数据时为 0） | 无 |
| content | 无（只有写入型 `syncAivoraVideosForOrg`，计数内联在 `GET /api/operations/dashboard`） | — | — | — |

- 跳转页面全部已存在：`/revenue`、`/bids`、`/operations/growth`、`/service-inbox`、`/projects`、`/ai-activity`、`/operations/dashboard`。

## Goals / Non-Goals

**Goals:**
- 一个零运行时依赖的岗位注册表，A-2 / A-3 / A-4 只从它取归属，不再各自维护映射。
- 漏归属在两处同时报错：`npm run typecheck`（编译期，报出缺失字面量）与 `npm test` / `npm run test:ci`（运行期，报出缺失 / 重复 / 全集外）。
- KPI 声明只引用既有读函数，路径在编译期解析到标量，且在声明层与取值层两道把敏感字段挡在外面。

**Non-Goals:**
- 不改 `src/lib/automation/registry.ts`、`src/lib/pending-actions/types.ts`、`src/lib/workforce-runtime/work-domain.ts`、`src/lib/cockpit/{metrics-engine,types,weekly-report}.ts`。
- 不改 `src/app/**` 任何页面或 API；不改 `prisma/**`、`vercel.json`、`src/lib/runtime-architecture/**`、`.github/workflows/ci.yml`。
- 不实现 KPI 取数、健康推算、等你 N 件、时间线（A-2）；不实现岗位卡片（A-3）；不实现工作量聚合（A-4）。
- 不改 `src/lib/service-inbox/**`、`src/lib/operations/service.ts`，不为 `service` / `content` 新写或抽取查询。
- 不改 `src/lib/ai-grader/**`、`src/lib/agent-runtime-v2/**`、`src/lib/agent-core/**`、`src/lib/assistant/**` 里任何 PendingAction 的产出逻辑或 payload 形状。

## Decisions

### D1 注册表形制：`as const satisfies readonly PostDefinition[]` 常量数组
- **选择**：仿 `AUTOMATION_REGISTRY`，一个按展示顺序排列的常量数组；`PostKey` 由数组派生。反查用模块加载时构建一次的 `Map`，未命中返回 `null`。
- **否决 A：`Record<PostKey, PostDefinition>`** —— 对象键无序，卡片顺序还得另存一份。
- **否决 B：放进 `Organization.settingsJson.cockpit.posts` 让租户配置** —— 任务书 Out of scope 明确"岗位归属是代码事实"；租户配置会让 A-4 的跨组织口径不一致。

### D2 穷举校验：类型层断言 + 运行期测试，双保险
- **选择**：
  - 类型层：用 `Exclude<全集, 已分配>` 构造"缺失集合"，交给只接受 `never` 的类型参数；漏一个就 `tsc` 报 TS2344，错误信息带出缺失字面量。对 `AutomationKey`、`WorkDomain` 查"漏"；对 `PendingActionType` 查"既不固定归属也不是通用类型"，并查"固定归属 ∩ 通用类型"为空。
  - 运行期：测试从 `AUTOMATION_REGISTRY` 与 `WORK_DOMAINS` 取运行时值；`PendingActionType` 没有运行时数组，测试**先剥掉整份源码的 `//` 与 `/* */` 注释**，再截取 `export type PendingActionType =` 到第一个 `;`，取出双引号字面量，并断言截取段去掉字面量、`|` 与空白后**没有残留**（出现子联合引用、单引号字面量等新写法就立刻红）。每个值统计命中岗位数，固定归属必须恰好为 1。
  - runType 没有类型全集：测试扫描 `src/**/*.ts(x)`（不含 `__tests__`）里的 `runType: "<字面量>"` 与 `*_RUN_TYPE = "<字面量>"`，得到代码真实写入的全集，逐个必须"归属一个岗位"或在"不归属"清单里；两份清单里出现但源码没写入的取值也算失败（防止清单过期）。
- **否决 A：只靠类型断言** —— `tsx` 不做类型检查，`npm test` 里看不到；而且类型断言只能查"漏"，查不了"重"。
- **否决 B：在 `pending-actions/types.ts` 加一个运行时 `PENDING_ACTION_TYPES` 数组** —— 改了 PendingAction 类型文件，违反 Out of scope；源码截取在仓库里已有先例（`pending-actions/__tests__/b2-approval-cas-static.test.ts`）。
- **否决 C：runType 全集从注册表自身的清单构造** —— 那样"缺失"与"全集外"永远为空，检查不可能失败（交叉审查 #10）。

### D3 归属规则：谁产出归谁；产出方不唯一的动作按行上下文归属
- **选择**：
  - 自动化：按任务书初版岗位清单；任务书没列的 `wechat-push`、`trade-daily` 归 `inbound_sales`；`approval-timeout` 归 `ops_knowledge`（全组织所有类型的审批过期，用户已认可）。
  - PendingAction 固定归属（10 种）：按命名空间，`sales.*` → `inbound_sales`、`marketing.*` → `marketing`、`tender.*` → `tender`。
  - PendingAction 通用动作类型（4 种：`calendar.create_event`、`grader.email_draft`、`grader.internal_note`、`grader.project_task`）：没有固定岗位，按每行上下文确定性归属——(1) 所属项目（`PendingAction.projectId`，为空时取目标类型为 `PROJECT` 的 `payload.targetId`）的工作域 → 该工作域的岗位；(2) 目标类型（先取 `payload.targetType`，为空再取 `payload.metadata.targetType`，大写比较）`PROJECT` → `projects`，`CUSTOMER` / `OPPORTUNITY` / `QUOTE` → `inbound_sales`；(3) `agentRunId` 对应 AgentRun 的 runType 所属岗位；(4) 其余 → 未归属。注册表只提供纯函数，入参由调用方（A-2）从行与关联表取好传入。
  - 工作域：`sales` → `inbound_sales`、`tender` → `tender`、`delivery` → `projects`、`general` → `ops_knowledge`（`general` 解析为 `system` 工具域，是平台级作业）。
  - runType：`fde_inbound_sales` 与 `runtime_v2` 归 `inbound_sales`；`workforce_job` 按工作域归属；`conversation` / `assistant_dispatch` / `background_conversation` / `supervisor` 不归属（人主动发起的对话、后台对话续跑、已冻结模块）。
- **否决 A：4 种通用动作固定归 `projects`（本 change 初稿）** —— 前提"只由 ai-grader / proactive-scan 产出"是错的（见 Context）；会把销售跟进的提醒与邮件草稿算到项目卡片上。
- **否决 B：4 种通用动作固定归 `inbound_sales`** —— 多数产出方是销售，但 approval-gate 的项目备注、技能产出的项目任务会被算到销售；而且对未带任何上下文的动作等于在猜。
- **否决 C：按标题 / 正文关键词判断** —— 违反"确定性优先"，且不同语言的文案会漂移。
- **否决 D：按 `AUTOMATION_REGISTRY.category` 自动推导岗位** —— category 与岗位口径不同（见 Context），推导会把三个 tender 自动化分进 `projects`。

### D4 KPI 声明是"指针"，取数留给 A-2；路径在编译期校验
- **选择**：
  - `kpi` 是可辨识联合：`{ kind: "existing_read", source, window, metrics: [三个 {path, label, format}] }` 或 `{ kind: "unavailable", reason }`。`source` 形如 `"src/lib/revenue-spine/sla-metrics.ts#loadSlaMetrics"`，只是字符串，不 import。
  - 同文件维护一个**纯类型**映射 `source → Awaited<ReturnType<typeof import("@/lib/…")["fn"]>>`；类型层递归解析每个指标路径，解析不到或不是标量（number / string / null）就报 `<岗位>:<路径>`（交叉审查 #2 的原型思路）。`typeof import()` 在类型位置，编译后被擦除，运行时仍零依赖。测试再静态核对：映射里的 `src/lib/X.ts` 与 `@/lib/X` 一致、导出名一致、模块确实 `export async function`。
  - `window` 是结构化值（`rolling_days` / `month_to_date` / `point_in_time` / `all_time`），A-2 据此传参（tender 需要 `{from, to}`）并在卡片上标注口径；`format` 只能是 `count` / `rate` / `percentage_string` / `minutes` / `score`——**没有金额格式**，这是白名单。
  - 提供纯函数 `pickKpiMetrics(spec, result)`：只按声明路径取三个值返回，A-2 不得把读函数结果对象整体透出。
- **否决 A：在注册表里直接放取数函数引用** —— 会把 `@/lib/db` 与六个业务模块拖进运行时，A-1 就不再是纯函数。
- **否决 B：只做"路径每一段出现在源码里"的静态核对（本 change 初稿）** —— 交叉审查用 10 个不存在的路径全部骗过了它（如 `sections.total`）。
- **否决 C：给 `service` / `content` 现在就抽一个读函数** —— 那是新写 / 搬迁查询，超出 A-1；搬迁 `GET /api/service-inbox` 的内联查询要带行为不变测试，放 A-2。
- **否决 D：tender 改用 muse-bridge 的 `loadStatusRows`** —— 未导出，且任务书规定 A 阶段不碰 `muse-bridge`。

### D5 跳转路径用既有页面，测试核对 `page.tsx` 存在
- **选择**：`nav` 写 URL 路径，测试把它映射到 `src/app/(main)<nav>/page.tsx` 检查存在。`ops_knowledge` 选 `/ai-activity`（所有登录成员可见），不选 `/ai/autopilot`（需要 `autopilot.view` 权限且受观察开关控制）。
- **否决：新建 `/cockpit/<post>` 详情页** —— D-2 定了不新建 `/cockpit`；任务书 A-3 要求不新增顶层导航。

### D6 测试同时进 `test-all.sh` 与 CI 子集
- **选择**：`scripts/test-ci-unit.sh` 末尾架构守卫之前加一行 `npx tsx src/lib/cockpit/__tests__/posts.test.ts`。该测试纯逻辑、无 DB、约 3 秒。
- **否决：只注册 `test-all.sh`** —— CI 不跑 `test-all.sh`，"重复归属 / KPI 指针漂移 / 跳转页被删 / 敏感词"只在本地才拦得住（交叉审查 #4）。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 不涉及（不碰 Prisma、不读写任何表或组织设置） |
| 2 | 出站先审批 | 不涉及（无任何出站；只登记 PendingAction 类型的归属方式，不创建、不执行、不改产出逻辑） |
| 3 | 禁止第三套队列 | 不涉及（无 scheduler / queue / worker；只是常量表与纯函数） |
| 4 | 脱敏 | **触碰**：KPI 指向的 `getTenderPortfolioSummary` 与 `getMarketingDashboard` 返回值含毛利率 / 利润 / 营收 / 估值 / 中标金额。遵守方式：格式白名单无金额；敏感词正则拦截路径与标签；`pickKpiMetrics` 只取声明路径。A-2 取数时仍须经 `pickKpiMetrics` 并过 Muse 脱敏函数 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守：归属全部查表，通用动作类型按结构化字段归属，不读标题 / 正文，零 LLM 调用 |
| 8 | 测试注册 | **触碰**：新测试 `src/lib/cockpit/__tests__/posts.test.ts` 在同一 task 内注册进 `scripts/test-all.sh`（并进 CI 子集）；`ci/test-registry-baseline.txt` 不加行 |

## Risks / Trade-offs

- [通用动作类型的上下文字段分布不统一，部分行（如 runtime-v2 的日历提醒在未带 `agentRunId` 时）会落到"未归属"] → A-2 / A-3 显式展示"未归属 N 件"，计入"等你 N 件"总数；规则不猜，宁可未归属。
- [`listDeliveryProjects` 需要 `OpsAccessContext`，结果按查看人可见范围过滤，`take: 500` 封顶] → `window.kind = point_in_time` 并在 A-3 卡片标注"你可见的项目"；与 `/projects` 页面口径一致。
- [`getTenderPortfolioSummary` 按项目循环取成本切片（N+1），函数内部不检查 `TENDER_FINANCIAL_CONTROL_ENABLED`（只有路由检查）] → A-2 调用前必须先过同一个开关，开关关闭时卡片显示"未开启"；窗口按 365 天、结果短时缓存由 A-2 定。
- [`getTeamLearningMetrics` 无上限读取 `humanFeedbackEvent`；`acceptRate` 无数据时为 0 而不是空] → A-2 用 `usageCount` 判断"暂无数据"；量级大了再加窗口。
- [给 A-2 / A-4 的提示] 旧的销售 `workforce_job` 可能没有 `metadata.workDomain`，按工作域归属时要走 `resolveEffectiveWorkDomain` 而不是读原始 metadata；`AutomationRun` 写入时基本不带 `orgId`，岗位心跳实际是平台级；`proactive-scan` 也扫销售，它归 `projects` 只代表"谁看它的心跳"，不代表它产出的提醒都属于项目。
- [源码截取读 PendingActionType 依赖书写格式] → 见 D2：全文去注释 + 残留断言 + 成员数下限断言。
- [`main` 上 `scripts/check-test-registry.sh` 当前已失败（PR #242 带入 2 个未注册的 trade 测试）] → 本 change 不处理；验证时确认本 change 的测试不在未注册列表里，失败项只有那 2 个既有文件。

## 验证方式

- `npx tsx src/lib/cockpit/__tests__/posts.test.ts` → 退出 0，打印通过条数。
- 反向验证（临时改动，验证后恢复并 `cmp` 确认逐字节一致）：注入未归属自动化键 / 重复归属，测试退出 1 并打印该键；从 `posts.ts` 删掉一个自动化键与一个动作类型、把一个 KPI 路径改成不存在的 `sections.total`，局部 `tsc` 分别报 TS2344 且错误信息含对应字面量。
- `npm run typecheck`、`npm run lint:baseline` 退出 0；`bash scripts/test-ci-unit.sh` 中本测试 PASS（CI 子集里其他测试如需 DB 以 CI 环境为准）。
- `bash scripts/check-test-registry.sh` 的未注册列表里不含 `src/lib/cockpit/__tests__/posts.test.ts`（只剩 2 个既有 trade 欠账）。
- `npm test` 与 `origin/main` 基线逐条比对失败清单，只允许多出本测试的 PASS。
- `git diff --stat origin/main -- prisma/ vercel.json` 为空；`openspec validate org-cockpit-posts --strict` 通过。

## Migration Plan

无部署动作：新文件当前没有调用方，合并即生效、零行为变化。回滚 = revert 该 PR。
