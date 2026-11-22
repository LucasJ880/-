# Design：综合汇总没做出来不再扣住招标分析结果，受阻时说清原因与重试（FIX-20）

## Context

### 生产实测

2026-11-22「12-3 Indoor Canadian Flag」，来源是 Evan 当天的生产实测与 `[tender-alert]` 日志。时间都是多伦多时间：

- 16:27 创建 Job。
- t3 从 16:28 跑到 16:41；t4–t7 在 16:42 完成。
- 第 8 步 `t8_synthesis` 失败，原因是 **AI 账户余额不足**。
- 第 9 步因为依赖第 8 步，没有开始。
- 16:44:29 `[tender-alert]` 日志记的是 `code=blocked_graph`。

第 8 步确切的 `errorCode` / `errorMessage` 要跑附录里的两条只读 SQL 才能确定，容器里没有生产连接。

### 现状（main `2ef4f9c8`，逐条读代码）

**计划与第 8、9 步**
- 第 8 步只做 Job 级汇总，不调业务工具（`taskKind = synthesis`、无 `preferredTool`），依赖 t2–t7（`src/lib/tender-workforce/deterministic-plan.ts:184-208`）。
- 第 9 步依赖 t1、t3、t8（`:209-222`），测试 V2-CONV-14 断言这一点（`t5-seg3-v2-convergence.test.ts:196-212`）。
- 完成标准只绑 t3、t7、t9，不含 t8（`:239-261`）。

**第 8 步的产出没人看**
- `app/` 与 `components/` 里没有任何代码读综合结果。
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
- 读模型的步骤查询没有 `attemptCount` / `maxAttempts`（`read-model/service.ts:170-185`）。
- 读模型、停止原因模块、详情查询被源码断言禁止读 `errorMessage`（`stop-reason.test.ts:98-111`）。
- 步骤没有 `nextAttemptAt` 列（`prisma/schema.prisma:5519-5555`），失败后在下一轮立即重试。

**停止原因只在 Job 停下时才算**
- 只在 Job 为 failed / needs_human 时算停止原因（`projection.ts:600-607`）。
- 项目卡片在「进行中」时只写「AI 分析中 · x/y 个任务完成」（`agent-card.tsx:167-169`）。
- 作业页只写「N 项受阻」（`page.tsx:376-378`）。

**模型调用与费用预检**
- 第 8 步的模型调用不带超时（`synthesis.ts:239-246`），归 FIX-15。
- 余额不足时 SDK 抛 `RateLimitError`。`code` / `type`（`insufficient_quota`）在单独的属性上（`error.js:17-19`），综合汇总只拼了 `err.message`（`synthesis.ts:248-255`），所以错误码属性丢了，消息文本还在。
- 本组织月度费用预检失败时，报错是「配额限制：月 AI 费用已达 hard limit」（`ai/client.ts:181-183`）。默认 base URL 是 OpenAI（`ai/config.ts:88`），生产的 `OPENAI_BASE_URL` 待核对。

### 推断：为什么用户看到「进行中」「1 项受阻」「无通知」

「进行中」只对应 queued（已有计划）、planning、executing 等状态（`projection.ts:58-116`）。「1 项受阻」只数失败步骤（`:131-134`）。重试期间第 8 步是「待开始」，不计入受阻。

所以看到「进行中 + 1 项受阻」的那一刻，第 8 步已经最终失败，而 Job 还没开始下一轮。可能的情形是：失败所在时间片超过 45 秒，交还队列等下一次定时触发（每 2 分钟一次，`vercel.json:67-69`）。

日志表明 16:44:29 已经收尾、发了通知。所以「无通知」最可能的情形是：截图在 16:44:29 之前；或者通知到了，但写的是「前置步骤没有完成」，没看懂。附录的事件查询能看到 `job.failed` 的确切时刻。

### 生产 SQL 的四种结果，以及会不会改变本设计

1. 第 8 步 `errorCode = stale_running_exhausted`（两次被 300 秒强制结束）：不改设计。D2 的降级覆盖这个码，原因会写成「长时间没有进展」，不是余额不足；报告要更正原因描述。根治归 FIX-15。
2. `errorCode = synthesis_failed`：
   - `errorMessage` 是 `SYNTHESIS_MODEL_FAILED:` 加一段余额不足的英文：不改设计，D5 的规则命中。
   - 文本是别的写法（代理商的中文「余额不足」、`billing_hard_limit_reached` 之类）：只在 2.1 里把那段原文加进识别规则，结构不变。
   - 是 `配额限制：月 AI 费用已达 hard limit`：不改设计，命中 `org_ai_budget_exhausted`；报告把「AI 账户余额不足」更正为「本组织本月 AI 费用已达上限」。
   - 是 `SYNTHESIS_INVALID_OUTPUT` / `SYNTHESIS_NO_UPSTREAM`：降级与显示照做，余额不足的识别照加，报告写明这次不是余额问题。
3. Job 仍是 queued / running / executing：与 16:44:29 的收尾日志矛盾，说明有 Job 没被重新认领的另一类问题。本设计不变，另开任务查认领。
4. Job 是 `needs_human` / `blocked_graph`，但分析记录仍是 `AGENT_ANALYZING`：与日志矛盾（日志只在分析记录改成 `AGENT_FAILED` 之后才打，`analysis-run-service.ts:450-471`）。本设计不变，另查钩子日志「[workforce] job stopped hook failed」。

按日志推断的实际结果是：Job `needs_human` / `blocked_graph`、分析记录 `AGENT_FAILED` / `blocked_graph`。

## Goals / Non-Goals

**Goals**

- 第 8 步不管因为什么执行失败，第 9 步都在同一轮照常终态化，分析进入待审阅、Job 完成，不发失败通知。
- 受阻期间，作业页与项目卡片写明「正在第 N 次重试」和上一次的原因，不只写「N 项受阻」。
- 停下时，作业页、项目卡片、失败通知写失败那一步自己的原因；余额不足写成「AI 账户余额不足，请联系平台管理员充值」。
- 全部用确定性规则；零模型调用、零 schema、零新队列。

**Non-Goals（具体到文件）**

- `src/lib/workforce-runtime/synthesis.ts`：第 8 步的超时、截止让出归 FIX-15，本 change 不改这个文件。
- `src/lib/tender-workforce/deterministic-plan.ts`：计划不变，第 9 步仍依赖第 8 步。
- `src/lib/agent-runtime-v2/verifier.ts`、`persist.ts`、`planner.ts`、`process.ts`。
- `executor.ts` 里旧的单步执行路径（`:331-900`，只服务旧 runtime_v2）。
- `src/lib/workforce-runtime/resume.ts`、`lease-heartbeat.ts`、`constants.ts`。
- `src/lib/ai/**`：`classifyModelError` 把 429 判为可重试（`model-policy/retry.ts:56-58`）不改。
- `src/lib/tender-auto-analysis/alerts.ts`：通知摘要已直接使用收尾写的那句原因（`alerts.ts:41-52`），不改。完成通知归 FIX-16。
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

跳过的综合汇总，交接数据里的话要改：
- 摘要由「任务未执行（skipped）：…」（`handoff.ts:367-370`）改为「综合汇总未生成」；
- 警告由「该任务未产生业务写入（审批拒绝或无可写对象）」（`:460-462`）改为「综合汇总未生成：〈原因白话〉」。
其它跳过的任务保持原话。

被否决的备选：
- **保持 `failed`，让第 9 步与验证器忽略它。** 要改依赖推进、交接收集、验证器三处共用的运行时规则。验证器见到失败会走修复：只重置状态、不重置次数（`verifier.ts:400-429`），下一轮被预检判为耗尽（`executor.ts:1119-1127`），最后仍是 `needs_human`。
- **写成 `completed` 加一段拼出来的「综合结果」。** 违反综合汇总的设计法则「禁止字符串拼接冒充综合」（`synthesis.ts:17-18`），第 9 步也会把假摘要当真放进返回值。
- **把第 8 步从第 9 步的依赖里拿掉。** 要改计划契约与 V2-CONV-14。第 8 步失败仍会让验证器转人工，旧 Job 也不受益。

### D2 每一轮开始时统一降级，不在每个写失败的地方各做一次

在执行器每轮开头做这件事：位置是成员资格检查之后、`refreshReadySteps` 之前（`executor.ts:234-249`），只对 workforce Job 做。符合 D3 的失败综合汇总步骤，先在同一个带防栅栏的写入里改成 D1 的终态，再写一条用户可见的 `step.completed` 事件（标题「〈步骤名〉（综合汇总未生成，已跳过）」，payload `{ stepKey, skipped: true, synthesisNotGenerated: true }`；事件类型沿用既有的，`executor.ts:1747-1752`）。

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
- `metadata.planSource = "SERVER_AUTHORED"`。这两个都是只有服务端能写的保留键（`job.ts:93-107`、`:244-247`），确定性计划一律走 canonical V2（`deterministic-plan.ts:18-20`、`trigger-service.ts:172-199`）。
- 这一步是原生综合汇总：任务说明 `taskKind = synthesis` 且没有 `preferredTool`，与执行器判断原生综合汇总的条件相同（`executor.ts:1156-1157`）。
- 错误码属于执行失败集合：`synthesis_failed`、`model_quota_exhausted`、`org_ai_budget_exhausted`、`step_attempts_exhausted`、`stale_running_exhausted`。

契约类错误码不降级：`workforce_task_invalid`、`workforce_worker_invalid`、`HANDOFF_*`、`handoff_build_failed`、`workforce_step_exception`。这些失败本身就让 Job 立即 `needs_human`（`executor.ts:1138-1151`、`:1369-1378`），说明持久状态已经坏了，照旧停下。判定写成纯函数，放进新文件 `src/lib/workforce-runtime/step-failure.ts`。

被否决的备选：
- **对所有数字员工 Job 的原生综合汇总都降级。** 销售域由模型规划的计划里，下游写任务可能依赖综合汇总的内容；降级会改变销售语义，超出需求。
- **在任务说明里加一个「失败可跳过」字段。** 要改任务契约（`task-contract.ts:72-104`，未知字段被丢弃）、规划器与新旧读写两端，范围大一圈，见 G2。

### D4 第 9 步在 canonical V2 模式下把综合结果改为可选

`handleFinalizeAnalysis`（`tools.ts:1044`）先判定 canonical V2 证据（`:1065`），再查综合结果。判定逻辑：

- canonical V2 模式下没有综合结果，但声明依赖里的产出带 `synthesisNotGenerated: true`：照常终态化（`finalizeWorkforceTenderCanonicalV2Run`，只改状态，`analysis-run-service.ts:323-362`）。返回值不带 `jobSummary`，带 `synthesisNotGenerated: true`，摘要末尾加「；综合汇总未生成」。
- 依赖里既没有综合结果也没有跳过标记：照旧 `INPUT_MISSING`。
- V1 兼容模式照旧要求综合结果。它要用综合摘要写 `projectSummary`（`tools.ts:1187`），不降级。

被否决的备选：**让第 9 步直接读第 8 步的状态。** 工具只拿得到声明依赖的 `outputJson`（`executor.ts:83-99`），看不到状态。证据只能来自声明依赖的产出，这是 #89 的纪律。

### D5 失败原因在写入时归成错误码，读取侧只查错误码

`step-failure.ts` 导出纯函数：输入错误文本与「是不是综合汇总」，输出错误码，判定顺序见规格。执行器批量路径的失败分支（`executor.ts:1661-1690`）在两种情况下都写这个码，并写进 `tool.failed` 事件：
- 还会重试：仍回到 `ready`，但多写 `errorCode`；
- 最终失败：写 `failed` 与 `errorCode`。

收尾的标记表（`job-failure-surfacing.ts:30-34`）复用同一个函数识别余额不足，排在限流之前。

为什么这样不违反 `stop-reason.test.ts:98-111`：那条断言只管读模型的投影、停止原因模块和详情查询不读 `errorMessage`。
- 本设计里读错误文本的只有写入侧（执行器）和收尾这条路。收尾按标记读失败步骤的错误原文是 CHAIN-0c 已有的先例（`job-failure-surfacing.ts:45-49`）。
- 读模型拿到的只是错误码，详情查询本来就取错误码（`service.ts:179-180`）。

识别的字面量：
- `insufficient_quota`：OpenAI 的错误 `code` / `type`，代理或别的链路可能把它带进文本。
- `exceeded your current quota`：OpenAI 余额不足时的消息，SDK 会拼进 `err.message`（`error.js:21-34`）。
- 「月 AI 费用已达 hard limit」：本组织月度费用预检（`ai/client.ts:183`；已有先例按「配额限制」前缀判定费用超限，`sales/period/narrative-pure.ts:402-405`）。
- 生产的确切文本以附录 SQL 为准，见上面「四种结果」第 2 条。

被否决的备选：
- **读模型直接读 `errorMessage` 识别。** 违反 CHAIN-0c 的读模型纪律与它的源码断言。
- **只让项目卡片读分析记录上的原因。** 作业页仍然不知道，三处说不成同一句。
- **在 `synthesis.ts` 返回结构化错误码。** 那个文件归 FIX-15，而且第 3 步等工具步骤的报错覆盖不到。

### D6 余额不足仍按既有次数重试，本次不加「不可重试」

识别到余额不足或费用上限，第 8 步仍按 `maxAttempts`（默认 2，`agent-runtime-v2/flags.ts:74`）试满。理由：

- **代价很小。** 第二次尝试在下一轮立即发生，没有间隔。供应商在生成前就拒绝，推断不计 token。降级后第 8 步失败不再扣住结果，少试一次对用户看到的结果没有区别，只早几秒。
- **识别规则会决定流程，风险要压低。** 识别规则依赖供应商的报错文本，生产确切值还没核对。只用它决定「显示什么话」，认错了最多显示得粗一点。拿它来决定「跳过重试」，认错了会吞掉一次本该成功的 429 限流重试。
- **执行器是所有数字员工共用的。** 加「不可重试」要在执行器里开一条新的结果通道，影响面超出本需求。

被否决的备选（G1 的 B）：识别到即把这一步直接写成最终失败。

### D7 重试与中断回收的痕迹

- 还会重试的失败写错误码，见 D5。
- 处理器回收遗留的「执行中」步骤、且次数未尽时（`processor.ts:251-261`），写 `errorCode = "stale_running_recovered"`，`attemptCount` 不变（被强制结束的那次已经计过）。同时为每一步写一条 `step.ready` 事件，`visibleToUser: false`，payload `{ stepKey, recoveredFrom: "stale_running", attempt }`。事件类型沿用既有的（`agent-runtime-v2/schemas.ts:132`、`agent-runtime/types.ts:55`）。
- 读模型的重试判定：步骤为「待开始」且 `attemptCount ≥ 1`，或为「执行中」且 `attemptCount ≥ 2`，并且 `errorCode` 不为空。第几次重试 = 待开始时为 `attemptCount`、执行中时为 `attemptCount − 1`；最多重试 `maxAttempts − 1` 次。
  - 认领时不清错误码（`executor.ts:1273-1285`），所以重试执行中也看得到。
  - 让出会清错误码（`:1626-1628`），所以 t3 正常让出不会被误判为重试。
- 详情查询多取 `attemptCount`、`maxAttempts`，`WorkforceTaskView` 多一个 `retry?: { attempt, maxRetries, reasonZh }`。

被否决的备选：
- **从 `tool.failed` 事件推。** 一次分析有上百条事件，payload 里有错误原文（`executor.ts:1678-1690`）；中断回收没有事件。
- **新增写入 `job.retrying` 进用户时间线。** 要改事件类型（`agent-runtime/types.ts:11-88` 里没有它），超出需求，见 Out of scope。

### D8 停止原因的规则

`stop-reason.ts` 改两处：

1. **错误码表新增：**
   - `synthesis_failed` → 「综合汇总生成失败」
   - `model_quota_exhausted` → 「AI 账户余额不足，请联系平台管理员充值」
   - `org_ai_budget_exhausted` → 「本组织本月 AI 费用已达上限，请组织管理员调高月度上限」
   - `stale_running_recovered` → 「上一次执行时间过长被中断」
2. **查表规则：** 所取的那一步是失败步骤时，只用它自己的错误码，查不到写「执行出错」，不再回落到 Job 的错误码。不是失败步骤时（停在第一个未完成的、或每步都完成）才用 Job 的错误码。

`job-failure-surfacing.ts` 的顺序改为：具体原因码 → 已知标记（余额不足排第一）→ 笼统错误码 → 「执行出错」。收尾写进分析记录的错误码取失败步骤的（`:83`）。这样 `[tender-alert]` 日志的 `code=`、通知元数据、通知正文（`alerts.ts:41-52` 直接用这句）都是那一步自己的。

被否决的备选：**只把 `synthesis_failed` 加进表。** 别的码不在表里时，仍会写出「前置步骤没有完成」。

### D9 只要有失败的步骤就算停止原因

`projection.ts:600-607` 的条件从「Job 为 failed / needs_human」改为「Job 为 failed / needs_human，或有任一步骤 `failed`」。

作业页进度一节的显示：
- 「N 项受阻」后面写这句原因；
- 有重试的步骤时，写 D7 的重试句；
- 两样都没有时保持现状。

「任务未能完成」卡仍只在 Job 失败时出现（`page.tsx:268`，CHAIN-0c 源码断言 `stop-reason.test.ts:109-110`）。

被否决的备选：**保持只在停下时算。** 两轮之间那一两分钟，作业页仍是今天这样只有「N 项受阻」。

### D10 显示位置与零 schema 的数据来源

**数据来源：** 全部由步骤行推出。`taskKind` 来自任务说明（`projection.ts:186-198`），加上状态、错误码、尝试次数。作业视图多一个 `synthesisNotGenerated?: { stepIndex, stepTitle, reasonZh }`，判定是「`taskKind = synthesis` 且 `status = skipped`」。综合汇总不需要审批（`deterministic-plan.ts:204`），走不到审批跳过那条路（`executor.ts:1693-1760`），所以这个判定只会因降级成立。

**作业页**（`page.tsx`）：
- 进度一节（`:357-389`）：受阻原因与重试句；
- 全部任务（`:419-448`）：该行下面一行小字写重试句；
- 最终结果（`:494-506`）：有 `synthesisNotGenerated` 时写「AI 数字员工的综合汇总未生成：〈原因〉。其余步骤的结果不受影响。」，否则保持占位文字。

**项目卡片接口**（`trigger-service.ts:297-367`）从已经拿到的作业视图转出三项：`retrying`、`blockedReason`（= 停止原因整句）、`synthesisNotGenerated`。

**项目卡片**（`agent-card.tsx`）：
- 「AI 分析中」那一行（`:167-169`）后接重试句或受阻句；
- 分析待审阅那一行（`:252-254`）下面写「本次 AI 数字员工的综合汇总未生成：〈原因〉。不影响下方的招标分析结果，可照常审阅。」

卡片挂在审阅面板顶部（`analysis-panel.tsx:463-465`；FIX-13 合并后为 `:472`），所以审阅面板里也看得到，不改面板文件。CHAIN-0c 卡片的源码断言（`job-failure-surfacing.test.ts:81-83`）保持成立。

被否决的备选：
- **在审阅面板头部另放一句。** FIX-13、FIX-16 都在改这个文件的这一块；而且面板的数据来自分析记录接口，拿不到 Job 的步骤。
- **在分析记录的摘要 JSON 里记一个标记。** 那是 canonical 位，第 9 步明文不碰（`analysis-run-service.ts:308-322`）。
- **写进 `errorMessageSanitized`。** 终态化时会被清空（`:339-342`）。

### D11 文案与 FIX-16 区分

本 change 说的是「AI 数字员工的综合汇总」，即 Job 级的执行汇总。FIX-16 说的是「中文综合解读」，即 canonical 分析里 Analyst 写的解读，属于招标分析结果本身。本 change 的所有句子不用「解读」二字。卡片上那句明说「不影响下方的招标分析结果」，免得被读成分析缺了一块。

### 拆分：「从失败的这一步继续」单独成 FIX-20b

它需要五样东西：可继续的判定、重置步骤 / Job / 分析记录、接口新 action、卡片按钮与通知末句，外加两个测试与门禁。并进来后 tasks 超过 8 条。

它另成 change `tender-job-continue-from-failed`（同一工作树），依赖本 change：
- 「关键步骤」的定义要排除已会降级的综合汇总；
- 「失败那一步自己的原因」由本 change 提供。

### 相邻改动与合并顺序

- **FIX-13**（#546，先合并）：改 `analysis-panel.tsx`、`exclusion-text.ts` 等，本 change 不碰，无冲突。
- **FIX-15** `workforce-invocation-deadline`：两边在同文件的不同段落，先后都行。
  - 它改 `processor.ts` 的认领循环与轮次循环（`:472-474`、`:785-791`）、`executor.ts` 的预算透传、`synthesis.ts` 的超时；
  - 本 change 改 `executor.ts:234-249`、`:1661-1690` 与 `processor.ts:251-261`。
  - FIX-15 先合并时，被截止时间截断的第 8 步交还队列、不消耗次数（FIX-15 design D4），本 change 的降级只会在真失败之后发生。
- **FIX-16**：改 `alerts.ts` 的完成通知、分析面板、解读视图、Muse，本 change 都不碰。只有文案要区分，见 D11。
- **FIX-18**（招标分析只留一个入口）：也改 `agent-card.tsx` 与 `api/projects/[id]/tender-analysis/agent` 接口。
  - 本 change 只在卡片里加显示行、在 GET 的状态投影里加字段，不动按钮与 POST，谁后合并谁变基，只有文本级冲突。
  - FIX-20b 要加按钮与 POST 的新 action，排在 FIX-18 之后合并，见 G5。

## 与八条硬纪律的关系

1. **零 schema：** 遵守。只写既有列（`AgentRunStep.status / errorCode / completedAt / outputJson`）与既有事件表。错误码是字符串列的新取值，没有迁移。
2. **出站先审批：** 不新增任何出站。第 9 步终态化后照既有规则发 Muse `analysis.ready` 与站内完成通知，现在降级时也会发，内容不变，不是新的出站类型。
3. **禁止第三套队列：** 遵守。降级在执行器既有的一轮里做，不新增扫描、定时任务、队列、租约、worker 注册；回收痕迹在既有回收段里写。
4. **脱敏：** 遵守。新字段与新句子只有固定中文、步骤名与序号，不出原始错误文本与内部码（规格里有 SHALL NOT）；Muse 通道内容不变。
5. **不爬登录页：** 不涉及。
6. **邮箱分离：** 不涉及。
7. **确定性优先：** 遵守。归类、降级、显示全是查表与状态判断，零模型调用。降级还少了一次第 9 步之后的人工介入。
8. **测试注册：** 遵守。`step-failure-visibility.test.ts` 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`synthesis-degrade-db.isolated.test.ts` 注册进 `scripts/test-all.sh`；`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `npx tsx src/lib/workforce-runtime/__tests__/step-failure-visibility.test.ts`（纯函数，不用库）：
  - 归类规则：OpenAI 余额不足文本、`insufficient_quota`、费用预检、普通 400 / 限流不误认；
  - 降级判定：销售域、模型规划、契约码都不降级；
  - 交接数据的话；
  - 重试投影（待开始 / 执行中 / 让出后 / 没失败过）；
  - 停止原因新规则；
  - `synthesisNotGenerated` 投影；
  - 源码断言：降级与说明不引用模型调用入口；读模型不读 `errorMessage`。
- 隔离库 `NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/synthesis-degrade-db.isolated.test.ts`：
  - 预置 t1–t7 已完成、交接数据齐全的确定性计划 Job，用 `setWorkforceSynthesisModelForTests` 让第 8 步抛 OpenAI 余额不足错误；
  - 真处理器驱动；
  - 断言：两次尝试与错误码、第 8 步跳过、第 9 步完成、分析记录待审阅且摘要逐字节不变、Job 完成、无失败通知；
  - 中断回收路径；第 3 步失败照旧停下；契约损坏不降级；
  - 卡片接口三个新字段与搜不到原文。
  - 改动前的代码上，余额不足用例应失败：第 9 步待开始、Job `needs_human` / `blocked_graph`、原因「前置步骤没有完成」。
- 扩展的测试：
  - `stop-reason.test.ts`：新码；失败步骤不回落 Job 码；进行中也算原因；源码断言仍过；
  - `job-failure-surfacing.test.ts`：余额不足标记排在限流前；具体码优先；卡片源码断言；
  - `job-failure-surfacing-db.isolated.test.ts`：分析记录错误码取步骤的；三处一字不差；
  - `operator-ux.test.ts`：作业页新文案。
- 回归：
  - `t5-seg3-v2-convergence.test.ts`、`p0-execution-alignment.test.ts`、`phase2b2-final-gate.test.ts`、`phase2b1-task-handoff.test.ts`、`projection-golden.test.ts`、`list-service.test.ts`、`service-read-only.test.ts` 通过数不变；
  - `npm run typecheck`、`npm run lint:baseline`、`bash scripts/test-runtime-architecture.sh`、CI 子集、`npm test` 对照既有失败清单；
  - `git diff origin/main -- prisma/ vercel.json` 为空。

## Risks / Trade-offs

- **识别规则认不出生产上的余额不足写法。** 后果是显示退回笼统的「综合汇总生成失败」，降级照样发生，结果照样进待审阅。附录 SQL 核对后，在 2.1 里补字面量。
- **进度显示「9 / 9 项任务完成」，但综合汇总没生成。** 跳过一律计入完成，是既有口径（`projection.ts:122-126`）；靠「最终结果」与卡片上那句说明补上，见 G4。
- **已经停在 `needs_human` 的旧 Job 不会被降级救回。** 停下的 Job 不再被认领（`constants.ts:14-21` 不含 needs_human），所以「12-3」这个 Job 要重新分析，或者等 FIX-20b 点「从失败的这一步继续」。
- **t3 重试中途让出会清掉错误码。** 之后显示不出「正在重试」，只显示进度。让出本身就是在推进，可以接受。
- **`stale_running_recovered` 留在后来成功的步骤上。** 读模型只在待开始 / 执行中 / 失败时用错误码，不影响显示。

## Migration Plan

无数据迁移、无开关。合并部署即生效；回滚 = 回退本 PR。上线后观察：
- 第 8 步失败的 Job 走到已完成；
- `[tender-alert]` 的 `code=` 不再出现 `blocked_graph`（除非真是停在未开始的步骤）。

## 留给 GATE

**G1 识别到余额不足 / 费用上限时，要不要跳过重试**
- A（推荐）不跳过，照既有次数重试（D6）。后果：多一次立即失败的请求，降级晚几秒，执行器不改。
- B 识别到即最终失败。后果：执行器加一条「不可重试」通道，影响所有数字员工；规则一旦误认，会吞掉一次真正的限流重试。
- 推荐 A：降级之后少试一次对结果没有影响，而识别文本还没在生产核对。

**G2 降级范围**
- A（推荐）只限招投标确定性计划里的原生综合汇总（D3）。
- B 所有数字员工 Job 的原生综合汇总。后果：销售计划的语义变了。
- C 任务说明加「失败可跳过」字段，由计划逐步声明。后果：改任务契约与规划器，范围大一圈。
- 推荐 A：需求只针对第 8 步，A 用两个服务端保留键就能确定性地判断。

**G3 用户看到的说法**
- A（推荐）「AI 数字员工的综合汇总未生成」。
- B「执行汇总未生成」，与步骤标题「Workforce 执行汇总」对得上，但不含 Evan 原话里的「综合汇总」。
- 推荐 A：用 Evan 定的词，加「AI 数字员工的」与 FIX-16 的「中文综合解读」区分。

**G4 跳过的综合汇总在进度里算不算完成**
- A（推荐）算（9/9），靠说明句补上。
- B 不计入分子（8/9），要给跳过的步骤开一个例外口径，影响所有用跳过表示审批拒绝的 Job。
- 推荐 A。

**G5 与 FIX-18 的合并顺序**
- 推荐：本 change 与 FIX-18 先后不限；FIX-20b 排在 FIX-18 之后。理由：只有 FIX-20b 动卡片按钮与 POST。

## 附：生产核对 SQL（只读，PostgreSQL）

时间列是不带时区的 `TIMESTAMP(3)`，存 UTC（迁移 `00000000000000_greenfield_baseline_pre_phase4/migration.sql:2872-2873`）。AgentRun 没有 projectId 列，靠 `metadata->>'projectId'` 关联项目（`trigger-service.ts:66-80`）；分析记录用 `idempotencyKey = 'tender-workforce:v1:' || jobId` 关联（`analysis-run-service.ts:57-59`）。

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
