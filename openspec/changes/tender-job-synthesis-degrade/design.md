# Design：综合汇总没做出来不再扣住招标分析结果，受阻时说清原因与重试（FIX-20）

## Context

### 生产实测（据 Evan 2026-11-22 实测与 `[tender-alert]` 日志，待 SQL 核实）

2026-11-22「12-3 Indoor Canadian Flag」，时间都是多伦多时间：

- 16:27 创建 Job。
- t3 从 16:28 跑到 16:41；t4–t7 在 16:42 完成。
- 第 8 步 `t8_synthesis` 失败，Evan 给的原因是 **AI 账户余额不足**。
- 第 9 步因为依赖第 8 步，没有开始。
- 16:44:29 `[tender-alert]` 日志记的是 `code=blocked_graph`。

第 8 步确切的 `errorCode` / `errorMessage` 要跑附录里的两条只读 SQL 才能确定。容器里没有生产连接，这一步在 GATE 前由有权限的人做，见「留给 GATE」G1。

### 现状（main `2ef4f9c8`，逐条读代码）

**计划与第 8、9 步**
- 第 8 步只做 Job 级汇总，不调业务工具（`taskKind = synthesis`、无 `preferredTool`），依赖 t2–t7（`src/lib/tender-workforce/deterministic-plan.ts:184-208`）。
- 第 9 步依赖 t1、t3、t8（`:209-222`），测试 V2-CONV-14 断言这一点（`t5-seg3-v2-convergence.test.ts:196-212`）。
- 完成标准只绑 t3、t7、t9，不含 t8（`:239-261`）。

**第 8 步的产出没人看**
- `src/app/` 与 `src/components/` 里没有任何代码读综合结果（搜 `synthesisOf` / `jobSummary` / `t8_synthesis` 无结果）。
- 处理器写的 `job.completed` 只带 `status`、`correlation`（`processor.ts:534-541`），所以作业页「最终结果」永远是占位文字（`page.tsx:494-506`）。
- 第 9 步在 canonical V2 模式下只把 `synthesis.summary.slice(0,480)` 放进自己的返回值（`tools.ts:1116`），不写回分析记录。

**第 9 步怎样卡住**
- 第 9 步没找到综合结果就报 `INPUT_MISSING`（`tools.ts:1053-1060`）。
- 依赖只认完成、跳过、部分完成三种状态（`agent-runtime-v2/persist.ts:139-161`）。
- 第 8 步一失败，第 9 步就停在待开始。下一轮执行器把 Job 写成 `needs_human` / `blocked_graph`（`executor.ts:266-296`）。
- 收尾钩子随后把分析记录改为「AI 分析未完成」，错误码取 Job 的 `blocked_graph`（`job-failure-surfacing.ts:83`），并发失败通知，日志就是 `[tender-alert] … code=blocked_graph`（`alerts.ts:119-121`）。

**通知为什么写成「前置步骤没有完成」**
- 停止原因先查步骤错误码：`synthesis_failed` 不在表里，于是回落到 Job 的 `blocked_graph`，得出「前置步骤没有完成」（`read-model/stop-reason.ts:29-43,63-69`）。
- 收尾的已知标记表只认 `ANALYSIS_EMPTY`、429 限流、超时（`job-failure-surfacing.ts:30-34`）。OpenAI 余额不足的报错不命中：SDK 把消息拼成「`429 You exceeded your current quota…`」（`node_modules/openai/core/error.js:21-34`），429 前面没有 `HTTP` / `status` / `code`，也不含 `rate limit`。
- 所以通知正文推断是「卡在第 8 步〈Workforce 执行汇总〉：前置步骤没有完成」。

**重试与回收不留痕**
- 步骤失败后还会再试时，只写 `errorMessage`，不写 `errorCode`（`executor.ts:1662-1667`）。
- 处理器回收遗留的「执行中」步骤时只改状态，不写任何东西（`processor.ts:251-261`）。
- 批量路径的让出把错误码清成 `null`（`executor.ts:1615-1650`，`:1628`）。第 3 步一次分析要让出很多次，所以重试那次执行在第一次让出之后就看不出是重试。
- 成功写入不清错误码（`executor.ts:1797-1806`），之前失败过的步骤完成后，错误码还留在行上。
- 读模型的步骤查询没有 `attemptCount` / `maxAttempts`（`read-model/service.ts:170-185`）。
- 读模型、停止原因模块、详情查询被源码断言禁止读 `errorMessage`（`stop-reason.test.ts:98-111`）。
- 步骤没有 `nextAttemptAt` 列（`prisma/schema.prisma:5519-5555`），失败后在下一轮立即重试。

**停止原因只在 Job 停下时才算**
- 只在 Job 为 failed / needs_human 时算停止原因（`projection.ts:600-607`）。既有测试断言「已完成的 Job 不带停止原因」「等待审批不算停下」，用的步骤里有一个失败步骤（`stop-reason.test.ts:92-95`）。
- 项目卡片在「进行中」时只写「AI 分析中 · x/y 个任务完成」（`agent-card.tsx:167-169`）。
- 作业页只写「N 项受阻」（`page.tsx:376-378`）。

**运行时架构门禁**（`scripts/test-runtime-architecture.sh`）
- `agent-runtime-v2 → workforce-runtime` 是禁止方向（`runtime-architecture/guards.ts:137-138`）。基线按「文件 => 引用路径」逐条冻结，只许减少；多一条就报 `FORBIDDEN_IMPORT_DIRECTION_GROWTH`（`guards.ts:452-463`，基线 `runtime-architecture-baseline.json:346-361`）。`executor.ts => @/lib/workforce-runtime/constants` 已在基线里（`:348`）。
- `src/lib/agent-runtime-v2/` 是冻结区（`manifest.ts:250-260`），新增文件报 `FROZEN_AREA_NEW_FILE`，要在同一 PR 里更新基线（`guards.ts:358-366`）。
- 让出分支有字符窗口断言：`if (batchContinuation)` 之后 600 个字符内必须出现 `completedAt: null`（`t5-p11-resumability.test.ts:92-96`）。现在距离是 587 个字符，只剩 13 个字符的余量。

**模型调用与费用预检**
- 第 8 步的模型调用不带超时（`synthesis.ts:239-246`），归 FIX-15。
- 余额不足时 SDK 抛 `RateLimitError`。`code` / `type`（`insufficient_quota`）在单独的属性上（`error.js:17-19`），综合汇总只拼了 `err.message`（`synthesis.ts:248-255`），所以错误码属性丢了，消息文本还在。
- 本组织月度费用预检失败时，报错是「配额限制：月 AI 费用已达 hard limit」（`ai/client.ts:181-183`）。默认 base URL 是 OpenAI（`ai/config.ts:88`），生产的 `OPENAI_BASE_URL` 待核对。

**第 9 步终态化之后的既有动作**
- 完成通知（`analysis-run-service.ts:349-357`）、Muse `analysis.ready`（`tools.ts:1083-1089`）、外部情报自动检索（`tools.ts:1093-1100`）。
- 外部情报包括公开数据检索与 AI 分析师 / 策略草案，受开关控制（`tender-intel/orchestrate.ts:1-21`），失败不影响终态化。

### 推断：为什么用户看到「进行中」「1 项受阻」「无通知」

「进行中」只对应 queued（已有计划）、planning、executing 等状态（`projection.ts:58-116`）。「1 项受阻」只数失败步骤（`:131-134`）。重试期间第 8 步是「待开始」，不计入受阻。

所以看到「进行中 + 1 项受阻」的那一刻，第 8 步已经最终失败，而 Job 还没开始下一轮。可能的情形是：失败所在时间片超过 45 秒，交还队列等下一次定时触发（每 2 分钟一次，`vercel.json:67-69`）。

日志表明 16:44:29 已经收尾、发了通知。所以「无通知」最可能的情形是：截图在 16:44:29 之前；或者通知到了，但写的是「前置步骤没有完成」，没看懂。附录的事件查询能看到 `job.failed` 的确切时刻。

### 生产 SQL 的四种结果，以及会不会改变本设计

1. 第 8 步 `errorCode = stale_running_exhausted`（两次被 300 秒强制结束）：不改设计。D2 的降级覆盖这个码，原因会写成「长时间没有进展」，不是余额不足；报告要更正原因描述。根治归 FIX-15。
2. `errorCode = synthesis_failed`：
   - `errorMessage` 是 `SYNTHESIS_MODEL_FAILED:` 加一段余额不足的英文：不改设计，D5 的规则命中。
   - 文本是别的写法（代理商的中文「余额不足」、`billing_hard_limit_reached` 之类）：只在 tasks 2.1 里把那段原文加进识别规则，结构不变。
   - 是 `配额限制：月 AI 费用已达 hard limit`：不改设计，命中 `org_ai_budget_exhausted`；报告把「AI 账户余额不足」更正为「本组织本月 AI 费用已达上限」。
   - 是 `SYNTHESIS_INVALID_OUTPUT` / `SYNTHESIS_NO_UPSTREAM`：降级与显示照做，余额不足的识别照加，报告写明这次不是余额问题。
3. Job 仍是 queued / running / executing：与 16:44:29 的收尾日志矛盾，说明有 Job 没被重新认领的另一类问题。本设计不变，另开任务查认领。
4. Job 是 `needs_human` / `blocked_graph`，但分析记录仍是 `AGENT_ANALYZING`：与日志矛盾（日志只在分析记录改成 `AGENT_FAILED` 之后才打，`analysis-run-service.ts:450-471`）。本设计不变，另查钩子日志「[workforce] job stopped hook failed」。

按日志推断的实际结果是：Job `needs_human` / `blocked_graph`、分析记录 `AGENT_FAILED` / `blocked_graph`。

## Goals / Non-Goals

**Goals**

- 第 8 步不管因为什么执行失败，第 9 步都在同一轮照常终态化，分析进入待审阅、Job 完成，不发失败通知。
- 受阻期间，作业页与项目卡片写明「正在第 N 次重试」和上一次的原因，不只写「N 项受阻」；第 3 步重试那次执行让出之后仍然写着。
- 停下时，作业页、项目卡片、失败通知写失败那一步自己的原因；余额不足写成「AI 账户余额不足，请联系平台管理员充值」。
- 全部用确定性规则；零模型调用入口、零 schema、零新队列，运行时架构基线一行不改。

**Non-Goals（具体到文件）**

- `src/lib/workforce-runtime/synthesis.ts`：第 8 步的超时、截止让出归 FIX-15，本 change 不改这个文件。
- `src/lib/tender-workforce/deterministic-plan.ts`：计划不变，第 9 步仍依赖第 8 步。
- `src/lib/agent-runtime-v2/verifier.ts`、`persist.ts`、`planner.ts`、`process.ts`；`src/lib/agent-runtime-v2/` 下不新增文件。
- `executor.ts` 里旧的单步执行路径（`:331-900`，只服务旧 runtime_v2）。
- `src/lib/workforce-runtime/resume.ts`、`lease-heartbeat.ts`。
- `src/lib/runtime-architecture/runtime-architecture-baseline.json`：不改。
- `src/lib/ai/**`：`classifyModelError` 把 429 判为可重试（`model-policy/retry.ts:56-58`）不改。
- `src/lib/tender-auto-analysis/alerts.ts`：通知摘要已直接使用收尾写的那句原因（`alerts.ts:41-52`），不改。完成通知归 FIX-16。
- `src/lib/tender-intel/orchestrate.ts`：外部情报不改，降级后照跑，见 D4。
- `src/lib/muse-bridge/**`。
- `src/components/tender-analysis/analysis-panel.tsx`：FIX-13、FIX-16 都改它，本 change 不碰。
- `src/lib/workforce-runtime/read-model/list-service.ts` 与 `src/app/(main)/workforce/job-card.tsx`：列表卡片不改。
- `prisma/**`、`vercel.json`。

## Decisions

### D1 降级后的终态是「已跳过」，并带上交接数据

第 8 步执行失败而终止后，改成 `status = "skipped"`，保留原 `errorCode` / `errorMessage`，写 `completedAt`。`outputJson = { synthesisNotGenerated: true, reasonCode: <原错误码>, workforceHandoff }`，交接数据用既有的构建函数生成（`stepStatus: "skipped"`，上游交接数据按依赖声明序取）。

这一个状态能同时通过三道门：
- 依赖推进认 `skipped`（`persist.ts:139-161`）；
- 交接收集认 `skipped`，但要求带交接数据（`handoff.ts:139-143`、`:580-618`）；
- 验证器把 `skipped` 算作完成（`verifier.ts:115-125`），失败必需项只数 `failed` / `blocked`（`:37-59`）。

产出里**不写** `degraded: true`：验证器见到它会判「存在 PARTIAL/degraded 分析证据」，不能 PASS（`verifier.ts:127-138`）；交接数据也会加一条「上游证据为降级结果」的警告（`handoff.ts:472-474`）。

写入是条件更新：只在这一步仍为 `failed` 时改，命中一行才写事件，所以同一步至多降级一次、至多一条事件。上游交接数据收不齐、交接数据构建失败时，这一步保持失败，Job 按既有规则走 `blocked_graph`，停止原因写这一步自己的错误码。

跳过的综合汇总，交接数据里的话要改：
- 摘要由「任务未执行（skipped）：…」（`handoff.ts:367-370`）改为「综合汇总未生成」；
- 警告由「该任务未产生业务写入（审批拒绝或无可写对象）」（`:460-462`）改为「综合汇总未生成：〈原因白话〉」，原因按 `reasonCode` 查停止原因白话表（`read-model/stop-reason.ts`，同属 workforce-runtime，不涉及门禁）。

判定条件是「综合汇总任务、已跳过、产出带 `synthesisNotGenerated`」。其它跳过的任务保持原话。

被否决的备选：
- **保持 `failed`，让第 9 步与验证器忽略它。** 要改依赖推进、交接收集、验证器三处共用的运行时规则。验证器见到失败会走修复：只重置状态、不重置次数（`verifier.ts:400-429`），下一轮被预检判为耗尽（`executor.ts:1119-1127`），最后仍是 `needs_human`。
- **写成 `completed` 加一段拼出来的「综合结果」。** 违反综合汇总的设计法则「禁止字符串拼接冒充综合」（`synthesis.ts:17-18`），第 9 步也会把假摘要当真放进返回值。
- **把第 8 步从第 9 步的依赖里拿掉。** 要改计划契约与 V2-CONV-14。第 8 步失败仍会让验证器转人工，旧 Job 也不受益。

### D2 每一轮开始时统一降级，不在每个写失败的地方各做一次

在执行器每轮开头做这件事：位置是成员资格检查之后、`refreshReadySteps` 之前（`executor.ts:234-249`），只对 workforce Job 做。

- 符合 D3 的失败综合汇总步骤，先按执行器既有的任务校验收齐上游交接数据（`executor.ts:955` 起），再在同一个带防栅栏的写入里改成 D1 的终态。
- 然后写一条用户可见的 `step.completed` 事件：标题「〈步骤名〉（综合汇总未生成，已跳过）」，payload `{ stepKey, skipped: true, synthesisNotGenerated: true }`；事件类型沿用既有的（`executor.ts:1747-1752`）。

第 8 步会在三处被写成失败，统一放在轮首就都覆盖了：
- 执行失败且次数用尽（`executor.ts:1668-1674`）；
- 预检发现次数已尽（`:1119-1127`）；
- 处理器回收时次数已尽（`processor.ts:262-275`）。

同一轮里随后的依赖推进会把第 9 步提成待开始并执行它，不必再等一个时间片。

被否决的备选：
- **在三处写失败的地方各做一次。** 漏一处就回到今天的样子（与 CHAIN-0c D1 同理）。
- **在收尾钩子里做，再把 Job 重新排队。** 钩子的纪律与主规格都写明「只做收尾，不重试、不排队」（`domain-hooks.ts:7-8`）。而且那时处理器已经发出用户可见的 `job.failed`（`processor.ts:551-565`），还要多等一次定时触发（≤ 2 分钟）。

### D3 降级范围：招投标确定性计划里的原生综合汇总，且只降级执行失败

四个条件同时满足才降级：
- `metadata.workDomain = "tender"`；
- `metadata.planSource = "SERVER_AUTHORED"`（`workforce-runtime/server-plan.ts:34`）。这两个都是只有服务端能写的保留键（`job.ts:93-107`、`:244-247`），确定性计划一律走 canonical V2（`deterministic-plan.ts:18-20`、`trigger-service.ts:172-199`）。
- 这一步是原生综合汇总：任务说明 `taskKind = synthesis` 且没有 `preferredTool`，与执行器判断原生综合汇总的条件相同（`executor.ts:1156-1157`）。
- 错误码属于执行失败集合：`synthesis_failed`、`model_quota_exhausted`、`org_ai_budget_exhausted`、`step_attempts_exhausted`、`stale_running_exhausted`。

契约类错误码不降级：`workforce_task_invalid`、`workforce_worker_invalid`、`HANDOFF_*`、`handoff_build_failed`、`workforce_step_exception`。

- 前四类失败本身就让 Job 在同一轮立即 `needs_human`（`executor.ts:1138-1151`、`:1369-1378`、`:1780-1791` 经 `:1420-1449` 收敛），说明持久状态已经坏了，照旧停下。
- `handoff_build_failed` 即使是第 8 步自己的产出放不进交接数据（上游是好的），也不降级。理由是它在同一轮就把 Job 写成 `needs_human`、处理器随即挂起不再认领，轮首降级根本看不到它。要支持，就得改执行器共用的「需要人工处理」收敛，影响所有数字员工；这类失败是代码缺陷（产出超出交接契约），生产上没有出现过，只在报告里写明。

判定写成纯函数，位置见 D6。

被否决的备选：
- **对所有数字员工 Job 的原生综合汇总都降级。** 销售域由模型规划的计划里，下游写任务可能依赖综合汇总的内容；降级会改变销售语义，超出需求。
- **在任务说明里加一个「失败可跳过」字段。** 要改任务契约（`task-contract.ts:72-104`，未知字段被丢弃）、规划器与新旧读写两端，范围大一圈，见 G3。

### D4 第 9 步在 canonical V2 模式下把综合结果改为可选

`handleFinalizeAnalysis`（`tools.ts:1044`）先判定 canonical V2 证据（`:1065`），再查综合结果。判定逻辑：

- canonical V2 模式下没有综合结果，但声明依赖里的产出带 `synthesisNotGenerated: true`：照常终态化（`finalizeWorkforceTenderCanonicalV2Run`，只改状态，`analysis-run-service.ts:323-362`）。返回值不带 `jobSummary`，带 `synthesisNotGenerated: true`，摘要末尾加「；综合汇总未生成」。
- 依赖里既没有综合结果也没有跳过标记：照旧 `INPUT_MISSING`。
- V1 兼容模式照旧要求综合结果。它要用综合摘要写 `projectSummary`（`tools.ts:1187`），不降级。

终态化之后的既有动作照旧执行：完成通知、Muse `analysis.ready`、外部情报自动检索（`tools.ts:1083-1100`）。这些都是既有调用，不新增；余额不足时外部情报里的 AI 调用多半也会失败，失败被吞掉、不影响终态化。要不要在降级时跳过外部情报，见 G6。

被否决的备选：**让第 9 步直接读第 8 步的状态。** 工具只拿得到声明依赖的 `outputJson`（`executor.ts:83-99`），看不到状态。证据只能来自声明依赖的产出，这是 #89 的纪律。

### D5 失败原因在写入时归成错误码，读取侧只查错误码

归类是纯函数：输入错误文本与「是不是综合汇总」，输出错误码，判定顺序见规格。执行器批量路径的失败分支（`executor.ts:1661-1690`）在两种情况下都写这个码，并写进 `tool.failed` 事件：
- 还会重试：仍回到 `ready`，但多写 `errorCode`；
- 最终失败：写 `failed` 与 `errorCode`。

收尾的标记表（`job-failure-surfacing.ts:30-34`）复用同一份余额不足的识别规则，排在限流之前。

为什么这样不违反 `stop-reason.test.ts:98-111`：那条断言只管读模型的投影、停止原因模块和详情查询不读 `errorMessage`。
- 本设计里读错误文本的只有写入侧（执行器）和收尾这条路。收尾按标记读失败步骤的错误原文是 CHAIN-0c 已有的先例（`job-failure-surfacing.ts:45-49`）。
- 读模型拿到的只是错误码，详情查询本来就取错误码（`service.ts:179-180`）。

识别的字面量：
- `insufficient_quota`：OpenAI 的错误 `code` / `type`，代理或别的链路可能把它带进文本。
- `exceeded your current quota`：OpenAI 余额不足时的消息，SDK 会拼进 `err.message`（`error.js:21-34`）。
- `no credits remaining`：2026-11-22 生产 Vercel 日志里 OpenAI 429 的原话（多伦多时间 16:40:31 起，Lucas 提供；实施时补入）。确切原文以 FIX-15 分支 `docs/acceptance/fix-15/prod-check.sql` A 段的结果为准，结果回来若不同再补。
- 「月 AI 费用已达 hard limit」：本组织月度费用预检（`ai/client.ts:183`；已有先例按「配额限制」前缀判定费用超限，`sales/period/narrative-pure.ts:402-405`）。
- 生产的确切文本以附录 SQL 为准，见上面「四种结果」第 2 条与 G1。

被否决的备选：
- **读模型直接读 `errorMessage` 识别。** 违反 CHAIN-0c 的读模型纪律与它的源码断言。
- **只让项目卡片读分析记录上的原因。** 作业页仍然不知道，三处说不成同一句。
- **在 `synthesis.ts` 返回结构化错误码。** 那个文件归 FIX-15，而且第 3 步等工具步骤的报错覆盖不到。

### D6 归类规则与降级判定放在 `src/lib/workforce-runtime/constants.ts`

- 这个文件是「零依赖，供 executor 等低层安全引用」（`constants.ts:2`），执行器已经引用它（`executor.ts:23`，基线 `runtime-architecture-baseline.json:348`）。往里加纯函数与码表，执行器只是从同一个路径多取几个名字，不新增引用边，门禁不变。
- 放进去的东西：
  - 错误码常量：`model_quota_exhausted`、`org_ai_budget_exhausted`、`stale_running_recovered`；
  - 识别字面量与归类函数（D5）；
  - 降级用的执行失败码集合与判定函数（D3）。判定函数入参只用基本类型（业务域、计划来源、是否原生综合汇总、错误码），计划来源按字面量 `"SERVER_AUTHORED"` 比较，测试断言它与 `PLAN_SOURCE.SERVER_AUTHORED`（`server-plan.ts:34`）相等，`constants.ts` 仍然零依赖。
- 其它地方从同一处取：
  - `processor.ts` 本来就从 `./constants` 引用（`processor.ts:38-42`），回收时写的 `stale_running_recovered` 用这里的常量；
  - `job-failure-surfacing.ts` 从 `@/lib/workforce-runtime/constants` 取余额不足的识别（`tender-workforce → workforce-runtime` 不在禁止方向表里，`guards.ts:137-172`）；
  - 停止原因的白话表仍在 `read-model/stop-reason.ts`（加四个码），`handoff.ts` 从那里取原因白话；
  - FIX-20b 的「执行失败码集合」也从 `constants.ts` 取，两份 change 用同一份。
- 被否决的备选：
  - **新文件 `src/lib/workforce-runtime/step-failure.ts`。** 执行器引用它就多一条 `agent-runtime-v2 → workforce-runtime` 的引用边，门禁报 `FORBIDDEN_IMPORT_DIRECTION_GROWTH`（`guards.ts:452-463`）。
  - **新文件放在 `src/lib/agent-runtime-v2/`。** 冻结区新增文件报 `FROZEN_AREA_NEW_FILE`（`guards.ts:358-366`），要改基线；FIX-15 design D1 也按冻结区处理。
  - **写在 `executor.ts` 内部再导出。** 处理器、收尾和纯函数测试都得引用整个执行器（它连着数据库、模型、工具注册），CI 单测要拖进一大串依赖；规则放在运行时执行文件里，也不像是共用的码表。

### D7 余额不足仍按既有次数重试，本次不加「不可重试」

识别到余额不足或费用上限，第 8 步仍按 `maxAttempts`（默认 2，`agent-runtime-v2/flags.ts:74`）试满。理由：

- **代价很小。** 第二次尝试在下一轮立即发生，没有间隔。供应商在生成前就拒绝，推断不计 token。降级后第 8 步失败不再扣住结果，少试一次对用户看到的结果没有区别，只早几秒。
- **识别规则会决定流程，风险要压低。** 识别规则依赖供应商的报错文本，生产确切值还没核对。只用它决定「显示什么话」，认错了最多显示得粗一点。拿它来决定「跳过重试」，认错了会吞掉一次本该成功的 429 限流重试。
- **执行器是所有数字员工共用的。** 加「不可重试」要在执行器里开一条新的结果通道，影响面超出本需求。

被否决的备选（G2 的 B）：识别到即把这一步直接写成最终失败。

### D8 重试与中断回收的痕迹

- 还会重试的失败写错误码，见 D5。
- 处理器回收遗留的「执行中」步骤、且次数未尽时（`processor.ts:251-261`），写 `errorCode = "stale_running_recovered"`，`attemptCount` 不变（被强制结束的那次已经计过）。同时为每一步写一条 `step.ready` 事件，`visibleToUser: false`，payload `{ stepKey, recoveredFrom: "stale_running", attempt }`。事件类型沿用既有的（`agent-runtime-v2/schemas.ts:132`、`agent-runtime/types.ts:55`）。
- **让出时保留重试标记。** 批量路径的让出分支（`executor.ts:1615-1650`）现在把 `errorCode` 清成 `null`。改为：这次认领本身是重试时（认领后的 `attemptCount ≥ 2`），保留行上的错误码；第一次执行时照旧清掉。
  - 让出把尝试次数退回 1、状态回到 `ready`，错误码还在，所以下面的重试判定在让出之后仍然成立，下一次认领又是 `attemptCount = 2`、错误码还在。
  - `errorMessage` 照旧清掉，读取侧只用错误码。
  - 字符窗口：`errorCode` 那一行挪到 `completedAt: null` 之后，或者先在 `if (batchContinuation)` 之前算好值、块内只写一个短变量名。`if (batchContinuation)` 到 `completedAt: null` 之间不增加字符，P11-CONT-05/06/07/07b 原样通过（`t5-p11-resumability.test.ts:86-113`）。
  - 只有可续跑的工具会让出（第 3 步；FIX-15 之后还有第 8 步与风险分析旧分支），所以只影响这几步。
- 读模型的重试判定：步骤为「待开始」且 `attemptCount ≥ 1`，或为「执行中」且 `attemptCount ≥ 2`，并且 `errorCode` 不为空。第几次重试 = 待开始时为 `attemptCount`、执行中时为 `attemptCount − 1`；最多重试 `maxAttempts − 1` 次。
  - 认领时不清错误码（`executor.ts:1273-1285`），所以重试执行中也看得到。
  - 第一次执行中途让出照旧清错误码，所以 t3 正常让出不会被误判为重试。
- 详情查询多取 `attemptCount`、`maxAttempts`，`WorkforceTaskView` 多一个 `retry?: { attempt, maxRetries, reasonZh }`。

被否决的备选：
- **从 `tool.failed` 事件推。** 一次分析有上百条事件，payload 里有错误原文（`executor.ts:1678-1690`）；中断回收没有事件。
- **新增写入 `job.retrying` 进用户时间线。** 要改事件类型（`agent-runtime/types.ts:11-88` 里没有它），超出需求，见 Out of scope。
- **把重试标记记在步骤 `evidenceJson.continuation` 里。** FIX-15 D6 在同一个位置记截断次数，两份 change 会抢同一个 JSON 键；读模型现在也不取 `evidenceJson`，还要多取一列。

### D9 停止原因的规则

`stop-reason.ts` 改三处：

1. **错误码表新增：**
   - `synthesis_failed` → 「综合汇总生成失败」
   - `model_quota_exhausted` → 「AI 账户余额不足，请联系平台管理员充值」
   - `org_ai_budget_exhausted` → 「本组织本月 AI 费用已达上限，请组织管理员调高月度上限」
   - `stale_running_recovered` → 「上一次执行时间过长被中断」
2. **所取的那一步是失败步骤：** 只用它自己的错误码，查不到写「执行出错」，不回落到 Job 的错误码。
3. **所取的那一步不是失败步骤**（停在第一个未完成的、或每步都完成）：只用 Job 的错误码，**不读这一步上留下的错误码**；Job 的码也查不到时，Job 为需要人工处理写「需要人工处理」，否则写「执行出错」。

第 3 条是因为 D5、D8 之后，「待开始」「已完成」的步骤上也会留着错误码（成功写入不清错误码，`executor.ts:1797-1806`）。如果照旧先查步骤码，「每步都完成、验证器判人工」会写成第 9 步某次重试的旧原因，「发起人身份失效、t3 待开始」会写成「上一次执行时间过长被中断」。

这样一来，失败步骤的码不认识而 Job 为需要人工处理时（例如契约损坏 `workforce_task_invalid`），原因从今天的「需要人工处理」变成「执行出错」。这是有意的：失败的那一步就该说那一步出了错，规格写明。

`job-failure-surfacing.ts` 的顺序改为：具体原因码 → 已知标记（余额不足排第一）→ 笼统错误码 → 「执行出错」；不是失败步骤时规则同上第 3 条。收尾写进分析记录的错误码取失败步骤的（`:83`）。这样 `[tender-alert]` 日志的 `code=`、通知元数据、通知正文（`alerts.ts:41-52` 直接用这句）都是那一步自己的。

被否决的备选：
- **只把 `synthesis_failed` 加进表。** 别的码不在表里时，仍会写出「前置步骤没有完成」。
- **成功写入时顺手清掉错误码，读取规则不动。** 要改执行器共用的完成写入（单步与批量两条路径），而且回收标记与重试标记在下一次失败前就会消失，排查时少了线索。

### D10 什么时候算停止原因

`projection.ts:600-607` 的条件从「Job 为 failed / needs_human」改为：
- Job 为 failed / needs_human；或
- Job 投影为「进行中」或「排队」（即排队、规划、执行、校验、修复等未停下的状态，`projection.ts:58-116`），并且有步骤 `failed`。

已完成、部分完成、已取消、等待审批的 Job 照旧不带停止原因，`stop-reason.test.ts:92-95` 原样通过。

作业页进度一节的显示：
- 「N 项受阻」后面写这句原因；
- 有重试的步骤时，写 D8 的重试句；
- 两样都没有时保持现状。

「任务未能完成」卡仍只在 Job 失败时出现（`page.tsx:268`，CHAIN-0c 源码断言 `stop-reason.test.ts:109-110`）。

被否决的备选：
- **保持只在停下时算。** 两轮之间那一两分钟，作业页仍是今天这样只有「N 项受阻」。
- **只要有失败步骤就算，不看 Job 状态。** 等待审批、部分完成的 Job 也会出现「卡在第 N 步」，与「等待你确认」「部分完成」的提示打架，并且推翻既有测试。

### D11 显示位置与零 schema 的数据来源

**数据来源：** 全部由步骤行推出。`taskKind` 来自任务说明（`projection.ts:186-198`），加上状态、错误码、尝试次数。

作业视图多一个 `synthesisNotGenerated?: { stepIndex, stepTitle, reasonZh }`。判定是：Job 元数据 `workDomain = tender` 且 `planSource = SERVER_AUTHORED`（视图本来就读元数据，`projection.ts:622`），并且某一步 `taskKind = synthesis`、`status = skipped`。

- 招投标确定性计划里综合汇总不需要审批（`deterministic-plan.ts:204`），走不到审批跳过那条路（`executor.ts:1693-1760`），所以在这个范围里这个判定只会因降级成立。
- 销售等由模型规划的计划里，综合汇总若被标成需要审批、审批被拒，也会是已跳过；限定范围后不会被误标为「未生成」。

**作业页**（`page.tsx`）：
- 进度一节（`:357-389`）：受阻原因与重试句；
- 全部任务（`:419-448`）：该行下面一行小字写重试句；
- 最终结果（`:494-506`）：有 `synthesisNotGenerated` 时写「AI 数字员工的综合汇总未生成：〈原因〉。招标分析结果请到项目里审阅。」，否则保持占位文字。

**项目卡片接口**（`trigger-service.ts:297-367`）从已经拿到的作业视图转出三项：`retrying`、`blockedReason`（= 停止原因整句）、`synthesisNotGenerated`。

**项目卡片**：
- 「AI 分析中」那一行（`agent-card.tsx:167-169`）后接重试句或受阻句；
- 分析待审阅那一行（`:252-254`）下面写「本次 AI 数字员工的综合汇总未生成：〈原因〉。招标分析结果见下方。」
- FIX-18 先合并时，这两句写进它抽出的卡片显示纯函数（`src/lib/tender-workforce/agent-card-view.ts`，FIX-18 design D11），源码断言改为对这个纯函数做用例。

卡片挂在审阅面板顶部（`analysis-panel.tsx:463-465`；FIX-13 合并后为 `:475`），所以审阅面板里也看得到，不改面板文件。CHAIN-0c 卡片的源码断言（`job-failure-surfacing.test.ts:81-83`）保持成立。

被否决的备选：
- **在审阅面板头部另放一句。** FIX-13、FIX-16 都在改这个文件的这一块；而且面板的数据来自分析记录接口，拿不到 Job 的步骤。
- **在分析记录的摘要 JSON 里记一个标记。** 那是 canonical 位，第 9 步明文不碰（`analysis-run-service.ts:308-322`）。
- **写进 `errorMessageSanitized`。** 终态化时会被清空（`:339-342`）。

### D12 文案与 FIX-16 区分

本 change 说的是「AI 数字员工的综合汇总」，即 Job 级的执行汇总。FIX-16 说的是「「项目解读」页」，即 canonical 分析里 Analyst 写的解读，属于招标分析结果本身（FIX-16 proposal「与 FIX-20 的分界」）。本 change 的所有句子不用「解读」二字。

卡片上那句只说「招标分析结果见下方」，不说「不影响」「可照常审阅」。原因是 AI 账户余额不足时第 3 步（含两遍「项目解读」）也可能部分失败，同一屏下方会出现 FIX-16 的「这次没有生成「项目解读」……请人工通读后判断」；这里再说「可照常审阅」，两句就互相打架。第 8 步只管 Job 级汇总，本来就没资格判断分析结果完不完整。

被否决的备选：
- **不写说明，只靠作业页上第 8 步的状态「已跳过」。** 项目页上的人看不到作业页；「已跳过」也看不出是没做出来，还是本来就不用做。
- **沿用步骤标题，写「执行汇总未生成」。** 见 G4 的 B：与标题对得上，但不是 Evan 原话里的「综合汇总」。
- **写「不影响下方的招标分析结果，可照常审阅」。** 理由见上：会和 FIX-16 的未完成说明冲突。

### 拆分：「从失败的这一步继续」单独成 FIX-20b

它需要五样东西：可继续的判定、重置步骤 / Job / 分析记录、接口新 action、卡片按钮与通知末句，外加两个测试与门禁。并进来后 tasks 超过 8 条。

它另成 change `tender-job-continue-from-failed`（同一工作树），依赖本 change：
- 「关键步骤」的定义要排除已会降级的综合汇总；
- 「失败那一步自己的原因」与执行失败码集合由本 change 提供。

被否决的备选：**合成一个 change。** tasks 超过 8 条，违反 `rules.tasks`；两件事的风险面也不同（本 change 只动执行器与显示，FIX-20b 要新增写入口与权限）。

### 相邻改动与合并顺序

- **FIX-13**（#546，先合并）：改 `analysis-panel.tsx`、`exclusion-text.ts` 等，本 change 不碰，无冲突；它在 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 各加注册行，本 change 的注册行加在它之后。
- **FIX-15** `workforce-invocation-deadline`：
  - 它改 `processor.ts` 的认领循环与轮次循环（`:472-474`、`:785-791`）、`executor.ts` 的预算透传、`synthesis.ts` 的超时；本 change 改 `executor.ts:234-249`、`:1661-1690` 与 `processor.ts:251-261`，不同段落。
  - **同一个让出分支**（`executor.ts:1615-1650`）两边都改：FIX-15 D6 在 `if (batchContinuation)` 之前读截断次数、在块内写 `evidenceJson.continuation.deadlineCuts`；本 change 只改块内 `errorCode` 那一个值。约定：
    - 两边都不在 `if (batchContinuation)` 与 `completedAt: null` 之间加字符（现在只有 13 个字符的余量），`t5-p11-resumability.test.ts` 不改期望；
    - 本 change 不碰 `evidenceJson`，FIX-15 不碰 `errorCode`；
    - 后合并的一方变基后重跑 `t5-p11-resumability.test.ts` 与 `step-failure-visibility.test.ts` 的源码断言。
  - FIX-15 先合并时，被截止时间截断的第 8 步交还队列、不消耗次数（FIX-15 design D2）；截断满 3 次后以 `INVOCATION_DEADLINE_REPEATED` 失败（FIX-15 design D6），本 change 把它归为 `synthesis_failed`，照样降级。
- **FIX-16** `tender-analysis-incomplete-notes`：改 `alerts.ts` 的完成通知、分析面板、「项目解读」页，本 change 都不碰；它不改 Muse（Muse 文案在它的 G3，登记为后续 change）。只有文案要区分，并且卡片那句不能与它的未完成说明冲突，见 D12。
- **FIX-18**（招标分析只留一个入口）：也改 `agent-card.tsx` 与 `api/projects/[id]/tender-analysis/agent` 接口，并把卡片的状态文案与按钮抽成纯函数 `agent-card-view.ts`，改写 `job-failure-surfacing.test.ts` 里三条卡片断言。
  - 本 change 只在卡片状态行加两句、在 GET 的状态投影里加字段，不动按钮与 POST。
  - FIX-18 先合并：本 change 的两句写进 `agent-card-view.ts`，测试对纯函数做用例。本 change 先合并：FIX-18 抽纯函数时把这两句一并搬过去。两种顺序都是语义上的迁移，不只是文本冲突，后合并的一方在报告里写明。
  - FIX-20b 要加按钮与 POST 的新 action，排在 FIX-18 之后合并，见 G8。

## 与八条硬纪律的关系

1. **零 schema：** 遵守。只写既有列（`AgentRunStep.status / errorCode / completedAt / outputJson`）与既有事件表。错误码是字符串列的新取值，没有迁移。`outputJson` 里的 `synthesisNotGenerated` / `reasonCode` 是这一步自己的执行产出，与每一步完成时写产出相同，不是新的扩展数据位。
2. **出站先审批：** 不新增任何出站。第 9 步终态化后照既有规则发 Muse `analysis.ready` 与站内完成通知，并照既有规则跑外部情报的公开数据检索；现在降级时也会发生，内容不变，不是新的出站类型。
3. **禁止第三套队列：** 遵守。降级在执行器既有的一轮里做，不新增扫描、定时任务、队列、租约、worker 注册；回收痕迹在既有回收段里写。所有写入都在基线已登记的写入方里（`executor.ts`、`processor.ts`），不新增被禁止方向的引用，运行时架构基线不改（D6）。
4. **脱敏：** 遵守。新字段与新句子只有固定中文、步骤名与序号，不出原始错误文本与内部码（规格里有 SHALL NOT）；Muse 通道内容不变。
5. **不爬登录页：** 不涉及。
6. **邮箱分离：** 不涉及。
7. **确定性优先：** 遵守。归类、降级、显示全是查表与状态判断，零新增模型调用入口。降级后第 9 步终态化，随之跑的外部情报 AI 分析是正常完成路径上的既有调用（D4、G6），不是为处理受阻新加的调用。
8. **测试注册：** 遵守。`step-failure-visibility.test.ts` 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`synthesis-degrade-db.isolated.test.ts` 注册进 `scripts/test-all.sh`；`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `npx tsx src/lib/workforce-runtime/__tests__/step-failure-visibility.test.ts`（纯函数，不用库）：
  - 归类规则：OpenAI 余额不足文本、`insufficient_quota`、费用预检、普通 400 / 限流不误认；
  - 降级判定：销售域、模型规划、契约码都不降级；`"SERVER_AUTHORED"` 字面量等于 `PLAN_SOURCE.SERVER_AUTHORED`；
  - 交接数据的话；
  - 重试投影：待开始、执行中、第一次执行让出后、重试中让出后、没失败过；
  - 停止原因新规则：失败步骤只用自己的码；非失败步骤只用 Job 的码（完成的步骤上留着旧码也不读）；
  - 停止原因的计算时机：进行中有失败步骤算，等待审批、已完成不算；
  - `synthesisNotGenerated` 投影：只对招投标服务端计划；
  - 源码断言：降级与说明不引用模型调用入口；读模型不读 `errorMessage`；`constants.ts` 没有任何 `import`；执行器让出分支在重试时保留错误码。
- 隔离库 `NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/synthesis-degrade-db.isolated.test.ts`：
  - 预置 t1–t7 已完成、交接数据齐全的确定性计划 Job，用 `setWorkforceSynthesisModelForTests`（`synthesis.ts:172-181`）让第 8 步抛 OpenAI 余额不足错误；
  - 真处理器驱动；
  - 断言：两次尝试与错误码、第 8 步跳过且只有一条跳过事件、第 9 步完成、分析记录待审阅且摘要逐字节不变、Job 完成、无失败通知；
  - 中断回收路径；第 3 步失败照旧停下；契约损坏不降级；
  - 卡片接口三个新字段与搜不到原文。
  - 改动前的代码上，余额不足用例应失败：第 9 步待开始、Job `needs_human` / `blocked_graph`、原因「前置步骤没有完成」。
- 扩展的测试：
  - `stop-reason.test.ts`：新码；失败步骤不回落 Job 码；非失败步骤不读步骤码；进行中也算原因；源码断言与 `:92-95` 仍过；
  - `job-failure-surfacing.test.ts`：余额不足标记排在限流前；具体码优先；卡片源码断言；
  - `job-failure-surfacing-db.isolated.test.ts`：分析记录错误码取步骤的；三处一字不差；
  - `operator-ux.test.ts`：作业页新文案。
- 回归：
  - `t5-seg3-v2-convergence.test.ts`、`t5-p11-resumability.test.ts`、`p0-execution-alignment.test.ts`、`phase2b2-final-gate.test.ts`、`phase2a-stale-worker.test.ts`、`phase2b1-task-handoff.test.ts`、`projection-golden.test.ts`、`list-service.test.ts`、`service-read-only.test.ts` 通过数不变；
  - `bash scripts/test-runtime-architecture.sh` 末行 `runtime-architecture guards PASS`；
  - `npm run typecheck`、`npm run lint:baseline`、CI 子集、`npm test` 对照既有失败清单；
  - `git diff origin/main -- prisma/ vercel.json src/lib/runtime-architecture/runtime-architecture-baseline.json` 为空。

## Risks / Trade-offs

- **识别规则认不出生产上的余额不足写法。** 后果是显示退回笼统的「综合汇总生成失败」，降级照样发生，结果照样进待审阅。附录 SQL 核对后，在 tasks 2.1 里补字面量（G1）。
- **进度显示「9 / 9 项任务完成」，但综合汇总没生成。** 跳过一律计入完成，是既有口径（`projection.ts:122-126`）；靠「最终结果」与卡片上那句说明补上，见 G5。
- **已经停在 `needs_human` 的旧 Job 不会被降级救回。** 停下的 Job 不再被认领（`constants.ts:14-21` 不含 needs_human），所以「12-3」这个 Job 要重新分析，或者等 FIX-20b 点「从失败的这一步继续」。
- **错误码留在后来成功、或还在待开始的步骤上。** 读取侧只在失败步骤上用步骤码、只在待开始 / 执行中判重试（D8、D9），不影响显示；排查时还多了线索。
- **契约损坏时原因从「需要人工处理」变成「执行出错」。** 见 D9 末，报告写明。
- **降级后外部情报照跑，余额不足时其中的 AI 调用也会失败。** 失败被吞掉、记在调查室的外部情报状态里，不影响分析结果，见 G6。

## Migration Plan

无数据迁移、无开关。合并部署即生效；回滚 = 回退本 PR。上线后观察：
- 第 8 步失败的 Job 走到已完成；
- `[tender-alert]` 的 `code=` 不再出现 `blocked_graph`（除非真是停在未开始的步骤）。

## 留给 GATE

**G1 生产 SQL 由谁、什么时候跑**
- A（推荐）GATE 前由有生产只读权限的人跑附录两条 SQL，结果贴进本 design「生产实测」一节，再按「四种结果」定 tasks 2.1 的识别字面量与报告的原因描述。
- B 先实施，报告里写「待补」。后果：生产文本若不是现有写法，余额不足会显示成笼统的「综合汇总生成失败」（降级照常）；报告里的根因描述也可能要事后更正（比如其实是被强制结束两次）。
- 推荐 A：只要几分钟，而且识别字面量是这次要写进代码的东西。

**G2 识别到余额不足 / 费用上限时，要不要跳过重试**
- A（推荐）不跳过，照既有次数重试（D7）。后果：多一次立即失败的请求，降级晚几秒，执行器不改。
- B 识别到即最终失败。后果：执行器加一条「不可重试」通道，影响所有数字员工；规则一旦误认，会吞掉一次真正的限流重试。
- 推荐 A：降级之后少试一次对结果没有影响，而识别文本还没在生产核对。

**G3 降级范围**
- A（推荐）只限招投标确定性计划里的原生综合汇总（D3）。
- B 所有数字员工 Job 的原生综合汇总。后果：销售计划的语义变了。
- C 任务说明加「失败可跳过」字段，由计划逐步声明。后果：改任务契约与规划器，范围大一圈。
- 推荐 A：需求只针对第 8 步，A 用两个服务端保留键就能确定性地判断。

**G4 用户看到的说法**
- A（推荐）「AI 数字员工的综合汇总未生成」。
- B「执行汇总未生成」，与步骤标题「Workforce 执行汇总」对得上，但不含 Evan 原话里的「综合汇总」。
- 推荐 A：用 Evan 定的词，加「AI 数字员工的」与 FIX-16 的「「项目解读」页」区分。

**G5 跳过的综合汇总在进度里算不算完成**
- A（推荐）算（9/9），靠说明句补上。
- B 不计入分子（8/9），要给跳过的步骤开一个例外口径，影响所有用跳过表示审批拒绝的 Job。
- 推荐 A。

**G6 降级后，第 9 步终态化之后的外部情报照不照跑**
- A（推荐）照跑。与正常完成完全一样：公开数据检索与 AI 分析师 / 策略草案都是既有调用，不新增；余额不足时其中的 AI 调用会失败、被吞掉，记在外部情报状态里。
- B 降级时跳过外部情报。后果：要在第 9 步终态化里加一个分支（改 `tools.ts` 的终态化路径），用户事后要到情报页手动点「立即检索外部情报」；余额充值之后也不会自动补跑。
- 推荐 A：不新增调用，行为与正常完成一致；B 为一个少见的组合多一条分支。

**G7 「写明综合汇总未生成」的范围**
- A（推荐）只写作业页「最终结果」与项目卡片（含审阅面板顶部）。
- B 完成通知里也写。后果：改 `alerts.ts` 的完成通知，FIX-16 正在改这一段，要与它合并文案。
- C 作业列表卡片的「N 项受阻」也加原因。后果：列表接口要多查每个作业的步骤错误码（`list-service.ts`），列表卡片空间也放不下整句。
- 推荐 A：Evan 原话「结果照常进入待审阅，写明……」指的是审阅的地方，审阅面板顶部的卡片已经写明；B 等 FIX-16 合并后再定。Muse `analysis.ready` 的文字两份 change 都不改，FIX-16 G3 登记为后续 change，编号待定。

**G8 与 FIX-18 的合并顺序**
- 推荐：本 change 与 FIX-18 先后不限，按 D11 与「相邻改动」迁移卡片的两句；FIX-20b 排在 FIX-18 之后。理由：只有 FIX-20b 动卡片按钮与 POST。

## 附：生产核对 SQL（只读，PostgreSQL）

时间列是不带时区的 `TIMESTAMP(3)`，存 UTC（迁移 `00000000000000_greenfield_baseline_pre_phase4/migration.sql:2872-2873`）。AgentRun 没有 projectId 列，靠 `metadata->>'projectId'` 关联项目（`trigger-service.ts:66-80`）；分析记录用 `idempotencyKey = 'tender-workforce:v1:' || jobId` 关联（`analysis-run-service.ts:57-59`）。多伦多 11 月为 UTC−5，16:27 即 21:27 UTC。

```sql
-- ① Job 状态 + t8 步骤 + t9 状态 + 分析记录
WITH job AS (
  SELECT r."id", r."orgId", r."status", r."errorCode", r."errorMessage", r."attempts",
         r."leaseExpiresAt", r."nextAttemptAt", r."createdAt", r."updatedAt"
  FROM "AgentRun" r
  JOIN "Project" p ON p."id" = r."metadata"->>'projectId' AND p."orgId" = r."orgId"
  WHERE r."runType" = 'workforce_job'
    AND r."metadata"->>'workDomain' = 'tender'
    AND p."name" ILIKE '%12-3 Indoor Canadian Flag%'
    AND r."createdAt" >= TIMESTAMP '2026-11-22 21:20:00'
    AND r."createdAt" <  TIMESTAMP '2026-11-22 21:45:00'
)
SELECT j."id" AS job_id, j."status" AS job_status, j."errorCode" AS job_error_code,
       LEFT(j."errorMessage", 300) AS job_error_message, j."attempts" AS job_attempts,
       j."leaseExpiresAt", j."nextAttemptAt", j."updatedAt" AS job_updated_at,
       s."status" AS t8_status, s."attemptCount", s."maxAttempts", s."errorCode" AS t8_error_code,
       LEFT(s."errorMessage", 500) AS t8_error_message, s."startedAt", s."completedAt",
       t9."status" AS t9_status,
       tar."id" AS analysis_run_id, tar."status" AS analysis_status, tar."errorCode" AS analysis_error_code
FROM job j
LEFT JOIN "AgentRunStep" s  ON s."runId" = j."id" AND s."stepKey" = 't8_synthesis'
LEFT JOIN "AgentRunStep" t9 ON t9."runId" = j."id" AND t9."stepKey" = 't9_finalize_analysis'
LEFT JOIN "TenderAnalysisRun" tar ON tar."idempotencyKey" = 'tender-workforce:v1:' || j."id"
ORDER BY j."createdAt";

-- ② 同一 run 里与 t8 相关的事件 + 21:41 UTC 之后的 Job 级事件
WITH job AS (
  SELECT r."id" FROM "AgentRun" r
  JOIN "Project" p ON p."id" = r."metadata"->>'projectId' AND p."orgId" = r."orgId"
  WHERE r."runType" = 'workforce_job' AND r."metadata"->>'workDomain' = 'tender'
    AND p."name" ILIKE '%12-3 Indoor Canadian Flag%'
    AND r."createdAt" >= TIMESTAMP '2026-11-22 21:20:00' AND r."createdAt" < TIMESTAMP '2026-11-22 21:45:00'
)
SELECT e."sequence", e."createdAt", e."eventType", e."title", e."visibleToUser",
       e."payload"->>'stepKey' AS step_key, e."payload"->>'attempt' AS attempt,
       e."payload"->>'errorCode' AS error_code, LEFT(e."payload"->>'error', 500) AS error_500,
       LEFT(e."payload"->>'report', 200) AS report
FROM job j JOIN "AgentRunEvent" e ON e."runId" = j."id"
WHERE (e."payload"->>'stepKey' = 't8_synthesis'
       AND e."eventType" IN ('task.claimed','step.started','tool.started','tool.failed','tool.completed','step.completed'))
   OR (e."createdAt" >= TIMESTAMP '2026-11-22 21:41:00'
       AND e."eventType" IN ('job.claimed','job.queued','job.failed','job.waiting_human','run.needs_human','job.completed'))
ORDER BY e."sequence";
```

## GATE 结论

Evan 2026-11-22 看过修订版：「GATE 按你的推荐来」——上面「留给 GATE」各条都按推荐（A / B 以各条写的推荐为准）。其中 G1（FIX-20）「GATE 前由有权限的人跑附录 SQL」：容器里没有生产连接，SQL 结果到之前，识别字面量先按 SDK 报错格式推出的「insufficient_quota / exceeded your current quota」实现，结果到后在实现 PR 里核对改正并补进报告 §1。
