# Design

## Context

- 自动化注册表 `src/lib/automation/registry.ts` 是 `as const satisfies readonly AutomationDefinition[]` 的常量数组，`AutomationKey` 由它派生；当前 28 项。它的 `category` 字段（projects / sales / service / marketing / operations）是给设置页分组用的，与岗位不是一回事：例如 `tender-watch` 是 `projects`，`inquiry-sla` 是 `service`，`aivora-sync` 是 `operations`。
- `PendingActionType`（`src/lib/pending-actions/types.ts`）是纯类型联合，14 个成员，运行时没有枚举数组。
- workforce 工作域 `WORK_DOMAINS = ["tender", "delivery", "sales", "general"]`（`src/lib/workforce-runtime/work-domain.ts`），该模块导入 `@/lib/db` 与工具目录，导入耗时约 3 秒但不连库。
- AgentRun.runType 是自由字符串。仓库里写入的取值只有 `conversation`（messaging / mention gateway）、`assistant_dispatch`、`supervisor`（frozen）、`workforce_job`（按 `metadata.workDomain` 区分业务）、`fde_inbound_sales`（`FDE_RUN_TYPE`）。
- KPI 候选读函数（只读、按 orgId）调研结论：

| 岗位 | 既有读函数 | 取的三个指标 | 同一返回值里的敏感字段（不取） |
|---|---|---|---|
| inbound_sales | `revenue-spine/sla-metrics.ts#loadSlaMetrics` | `inquiries.medianFirstResponseMinutes` / `inquiries.answeredWithin24hRate` / `guardrail.total` | 无 |
| tender | `project-finance/portfolio.ts#getTenderPortfolioSummary` | `tenderSubmittedCount` / `wonCount` / `winRatePercentage` | `wonProjects.*Margin*` / `*Profit*`、`indicativeTenderValue`、`awardedValueCad` |
| marketing | `marketing/query-dashboard.ts#getMarketingDashboard` | `summary.effectiveLeads` / `summary.growthExecution` / `summary.highPriorityIssues` | `funnel.economics.grossMarginRate` / `attributedGrossProfit` / `roi` / `breakEvenRoas` |
| service | 无（只有写入型 `runServiceInboxSla`，计数内联在 `GET /api/service-inbox`） | — | — |
| projects | `operations/projects/query.ts#listDeliveryProjects` | `sections.needsAttention` / `sections.active` / `sections.onHold` | 无 |
| ops_knowledge | `employee-ai/metrics.ts#getTeamLearningMetrics` | `candidatePracticeCount` / `activePlaybookCount` / `acceptRate` | 无 |
| content | 无（只有写入型 `syncAivoraVideosForOrg`，计数内联在 `GET /api/operations/dashboard`） | — | — |

- 跳转页面全部已存在：`/revenue`、`/bids`、`/operations/growth`、`/service-inbox`、`/projects`、`/ai-activity`、`/operations/dashboard`。

## Goals / Non-Goals

**Goals:**
- 一个零运行时依赖的岗位注册表，A-2 / A-3 / A-4 只从它取归属，不再各自维护映射。
- 漏归属在两处同时报错：`npm run typecheck`（编译期，报出缺失字面量）与 `npm test`（运行期，报出缺失 / 重复）。
- KPI 声明只引用既有读函数，且在声明层就把敏感字段挡在外面。

**Non-Goals:**
- 不改 `src/lib/automation/registry.ts`、`src/lib/pending-actions/types.ts`、`src/lib/workforce-runtime/work-domain.ts`、`src/lib/cockpit/{metrics-engine,types,weekly-report}.ts`。
- 不改 `src/app/**` 任何页面或 API；不改 `prisma/**`、`vercel.json`、`src/lib/runtime-architecture/**`。
- 不实现 KPI 取数、健康推算、等你 N 件、时间线（A-2）；不实现岗位卡片（A-3）；不实现工作量聚合（A-4）。
- 不改 `src/lib/service-inbox/**`、`src/lib/operations/service.ts`，不为 `service` / `content` 新写或抽取查询。

## Decisions

### D1 注册表形制：`as const satisfies readonly PostDefinition[]` 常量数组
- **选择**：仿 `AUTOMATION_REGISTRY`，一个按展示顺序排列的常量数组；`PostKey` 由数组派生。反查（自动化 / 动作类型 / 工作域 / runType → 岗位）用模块加载时构建一次的 `Map`，未命中返回 `null`。
- **否决 A：`Record<PostKey, PostDefinition>`** —— 对象键无序，卡片顺序还得另存一份。
- **否决 B：放进 `Organization.settingsJson.cockpit.posts` 让租户配置** —— 任务书 Out of scope 明确"岗位归属是代码事实"；租户配置会让 A-4 的跨组织口径不一致。

### D2 穷举校验：类型层断言 + 运行期测试，双保险
- **选择**：
  - 类型层：用 `Exclude<AutomationKey, 已分配的键>` 等构造"缺失集合"，赋给一个只在缺失集合为 `never` 时才成立的常量；漏一个就 `tsc` 报错，错误信息里带出缺失字面量。对 `AutomationKey`、`PendingActionType`、`WorkDomain` 各做一次。
  - 运行期：测试从 `AUTOMATION_REGISTRY` 与 `WORK_DOMAINS` 取运行时值；`PendingActionType` 没有运行时数组，测试读 `src/lib/pending-actions/types.ts` 源码，截取 `export type PendingActionType =` 到第一个 `;` 之间的字符串字面量。每个值统计命中岗位数，必须恰好为 1。
- **否决 A：只靠类型断言** —— `tsx` 不做类型检查，`npm test` 里看不到；而且类型断言只能查"漏"，查不了"重"。
- **否决 B：在 `pending-actions/types.ts` 加一个运行时 `PENDING_ACTION_TYPES` 数组** —— 改了 PendingAction 类型文件，违反 Out of scope；源码截取在仓库里已有先例（`pending-actions/__tests__/b2-approval-cas-static.test.ts` 等静态断言测试）。
- 风险：联合类型的书写格式变了（例如改成从数组派生），源码截取会读到 0 个成员。测试断言"读到的成员数 ≥ 14"兜住，一旦截取失效立刻红而不是静默通过。

### D3 归属规则：谁产出归谁，偏差逐条写进 proposal
- **选择**：
  - 自动化：按任务书初版岗位清单；任务书没列的 `wechat-push`、`trade-daily` 归 `inbound_sales`；`approval-timeout` 归 `ops_knowledge`（它处理全组织所有类型的 PendingAction 过期与审批升级，不是投标专属）。
  - PendingAction：按产出方归属。`grader.*` 与 `calendar.create_event` 只由 `ai-grader/actions/to-pending-action.ts` 产出（`proactive-scan` 的分级结果），归 `projects`；其余按命名空间（`sales.*` → `inbound_sales`、`marketing.*` → `marketing`、`tender.*` → `tender`）。
  - 工作域：`sales` → `inbound_sales`、`tender` → `tender`、`delivery` → `projects`、`general` → `ops_knowledge`（`general` 解析为 `system` 工具域，是平台级作业）。
  - runType：只有 `fde_inbound_sales` 归属（`inbound_sales`）；`workforce_job` 不按 runType 归属；`conversation` / `assistant_dispatch` / `supervisor` 是人主动发起的对话或已冻结模块，不归任何岗位。
- **否决：`approval-timeout` 按任务书放 `tender`** —— 该 cron 失败时会把投标卡片染成 failed，而失败原因可能是营销草稿过期处理出错；岗位健康必须只反映本岗位的活。改回去只需移动一行，GATE 若坚持原方案可直接改。
- **否决：按 `AUTOMATION_REGISTRY.category` 自动推导岗位** —— category 与岗位口径不同（见 Context），推导会把三个 tender 自动化分进 `projects`。

### D4 KPI 声明是"指针"，取数留给 A-2
- **选择**：`kpi` 是可辨识联合：`{ kind: "existing_read", module, exportName, metrics: [三个 {path, label}] }` 或 `{ kind: "unavailable", reason }`。`module` 是仓库相对路径字符串，不 import，注册表因此保持零运行时依赖；A-2 写类型化的取数适配器，按 `module#exportName` 调用并按 `path` 取值。
- 测试只做静态核对：模块文件存在、源码含 `export async function <exportName>`、每个 `path` 的每一段都出现在模块源码里、路径与标签不命中敏感词正则。
- **否决 A：在注册表里直接放取数函数引用** —— 会把 `@/lib/db` 与六个业务模块拖进注册表，A-1 就不再是纯函数，测试也得连库或打桩。
- **否决 B：给 `service` / `content` 现在就抽一个读函数** —— 那是新写 / 搬迁查询，超出 A-1；而且搬迁 `GET /api/service-inbox` 的内联查询会改动既有路由，应在 A-2 里带着行为不变测试做。
- **否决 C：tender 改用 muse-bridge 的 `loadStatusRows`** —— 未导出，且属于 muse-bridge 内部；任务书规定 A 阶段不碰 `muse-bridge`。

### D5 跳转路径用既有页面，测试核对 `page.tsx` 存在
- **选择**：`nav` 写 URL 路径，测试把它映射到 `src/app/(main)<nav>/page.tsx` 检查存在。`ops_knowledge` 选 `/ai-activity`（所有登录成员可见），不选 `/ai/autopilot`（需要 `autopilot.view` 权限且受观察开关控制，无权限的人点卡片会落在拒绝页）。
- **否决：新建 `/cockpit/<post>` 详情页** —— D-2 定了不新建 `/cockpit`；任务书 A-3 要求不新增顶层导航。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 不涉及（不碰 Prisma、不读写任何表或 settingsJson） |
| 2 | 出站先审批 | 不涉及（无任何出站；只登记 PendingAction 类型的归属，不创建、不执行） |
| 3 | 禁止第三套队列 | 不涉及（无 scheduler / queue / worker；只是常量表） |
| 4 | 脱敏 | **触碰**：KPI 声明指向的 `getTenderPortfolioSummary` 与 `getMarketingDashboard` 返回值含毛利率 / 利润 / 估值 / 中标金额。遵守方式：KPI 只声明白名单计数 / 比率字段，测试用敏感词正则拦截路径与标签（spec "岗位 KPI 不输出敏感字段"）。A-2 取数时仍须只取声明的路径并过 Muse 脱敏函数 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守：归属是查表，零 LLM 调用 |
| 8 | 测试注册 | **触碰**：新测试 `src/lib/cockpit/__tests__/posts.test.ts` 在同一 task 内注册进 `scripts/test-all.sh`；`ci/test-registry-baseline.txt` 不加行 |

## Risks / Trade-offs

- [`listDeliveryProjects` 需要 `OpsAccessContext`，结果按查看人可见范围过滤，不是全组织总数] → A-2 用当前登录人的 ctx 调用，卡片标注"你可见的项目"；这与 `/projects` 页面口径一致，可接受。
- [`getTenderPortfolioSummary` 按项目循环取成本切片，N+1 偏重，且必须传时间窗口] → A-2 决定窗口与缓存；A-1 只锁定"取哪三个字段"。
- [`getTeamLearningMetrics` 无上限读取 `humanFeedbackEvent`] → 当前量级小；A-2 若发现慢再加窗口，不在 A-1 处理。
- [源码截取读 PendingActionType 依赖书写格式] → 见 D2，成员数下限断言兜底。
- [`approval-timeout` 归属与任务书不同] → proposal 偏差 3 显式列出，供 GATE 拍板。
- [`main` 上 `scripts/check-test-registry.sh` 当前已失败（PR #242 带入 2 个未注册的 trade 测试）] → 本 change 不处理；验证时确认本 change 的测试不在未注册列表里，失败项只有那 2 个既有文件。

## 验证方式

- `npx tsx src/lib/cockpit/__tests__/posts.test.ts` → 退出 0，打印通过条数。
- 反向验证（临时改动，验证后恢复）：在测试里注入一个假自动化键 / 把某个岗位的一个动作类型挪到另一岗位，测试分别报"未归属" / "重复"并退出 1；临时从 `posts.ts` 删掉一个自动化键，`npm run typecheck` 报错且错误信息含该键。
- `npm run typecheck` 退出 0；`npm run lint:baseline` 退出 0。
- `bash scripts/check-test-registry.sh` 的未注册列表里不含 `src/lib/cockpit/__tests__/posts.test.ts`（只剩 2 个既有 trade 欠账）。
- `git diff --stat origin/main -- prisma/ vercel.json` 为空。
- `openspec validate org-cockpit-posts` 通过。

## Migration Plan

无部署动作：新文件当前没有调用方，合并即生效、零行为变化。回滚 = revert 该 PR。
