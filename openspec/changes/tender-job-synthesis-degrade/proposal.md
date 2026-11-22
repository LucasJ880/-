# Proposal：综合汇总没做出来不再扣住招标分析结果，受阻时说清原因与重试（FIX-20）

TASKFLOW：FIX-20（Phase F（续）— 生产实测修复，2026-11-22）。「从失败的这一步继续」拆到同一工作树里的第二个 change `tender-job-continue-from-failed`（FIX-20b），理由见 design「拆分」。

受影响的 Muse 意图：无（`status` / `ask` / `rfq` / `compare` / `chase` / `price_scenario` / `next_step` 都不改，不改 `src/lib/muse-bridge/**`）。受影响的 Muse 事件：`analysis.ready`。综合汇总这一步失败时，第 9 步现在会照常终态化，所以这条事件会按既有规则发出；以前这种情况整次分析停住，不发这条事件。事件内容一个字不改。

## Why

2026-11-22「12-3 Indoor Canadian Flag」一键分析（Job 16:27 多伦多时间创建）：t1–t7 已在 16:42 前算完；第 8 步综合汇总因 AI 账户余额不足失败了两次，第 9 步因为依赖它没有开始，canonical 结果停在「分析中」。页面上只显示「1 项受阻」；16:44:29 发出的失败通知把原因写成了 Job 级的 `blocked_graph`，也就是「前置步骤没有完成」，没写那一步自己的原因。来源是 Evan 2026-11-22 的生产实测和 `[tender-alert]` 日志。第 8 步只给整个 Job 写一段汇总，canonical 语义一条都不产出（`src/lib/tender-workforce/deterministic-plan.ts:184-208`），这段汇总在任何页面上也不显示，所以它失败了不该扣住第 9 步。

## What Changes

- **让综合汇总步骤失败时降级。** 范围是招投标确定性计划的 Job 里那一步不调业务工具、只汇总上游的综合汇总（第 8 步），触发条件是它因执行失败而终止：模型报错、输出不合格、重试次数用尽、长时间没有进展。每一轮开始时，系统把它改成「已跳过」，带上交接数据，写一条步骤完成事件，第 9 步照常开工。契约损坏一类的失败（上游交接数据缺失或损坏、任务说明损坏）不在此列，照旧停下。
- **让第 9 步在 canonical V2 模式下接受「综合汇总已跳过」。** 声明依赖里的第 8 步带着跳过标记时，第 9 步照常把分析记录改成待审阅，不再报 `INPUT_MISSING`。旧的 V1 兼容模式、以及依赖里既没有综合结果也没有跳过标记的情况，照旧报 `INPUT_MISSING`。
- **改写跳过时交接数据里的话。** 综合汇总被跳过时，摘要写「综合汇总未生成」，警告写原因，不再写「该任务未产生业务写入（审批拒绝或无可写对象）」。步骤产出里不写 `degraded: true`，否则验证器会把整次判为不完整。
- **写明「AI 数字员工的综合汇总未生成」及原因，共三处。**
  - 作业页「最终结果」一节。
  - 项目卡片：分析待审阅时，在「分析结果已就绪，请在下方审阅确认」那一行下面。这张卡片挂在审阅面板顶部，所以审阅面板里也看得到。
  - 卡片接口与作业接口各多一个字段。
  - 文案不用 FIX-16 的「中文综合解读」字样。
- **归类失败原因：写入时就记成错误码。**
  - 错误里含 `insufficient_quota` 或 `exceeded your current quota`（不分大小写），记为 `model_quota_exhausted`，白话是「AI 账户余额不足，请联系平台管理员充值」。
  - 含「月 AI 费用已达 hard limit」，记为 `org_ai_budget_exhausted`，白话是「本组织本月 AI 费用已达上限，请组织管理员调高月度上限」。
  - 其余照旧，记为 `synthesis_failed` 或 `tool_failed`。
  - 还有下一次重试的那次失败也写错误码。现在只写错误原文，不写错误码（`src/lib/agent-runtime-v2/executor.ts:1667`）。
- **记下中断回收的痕迹。** 处理器把遗留的「执行中」步骤改回「待开始」时，写错误码 `stale_running_recovered`，再写一条不对用户显示的 `step.ready` 事件。现在这一步什么都不留（`src/lib/workforce-runtime/processor.ts:251-261`）。
- **让作业页与项目卡片写明「正在第 N 次重试」和上一次的原因。** 依据只有步骤的状态、`attemptCount`、`maxAttempts` 和错误码，不读错误原文。
- **算出停止原因：只要有失败的步骤就算，不再只在 Job 失败或需要人工处理时才算。** 作业页把原因写在「N 项受阻」旁边；项目卡片在「AI 分析中」那一行写同一句。
- **改写停止原因的规则。**
  - 失败那一步自己的错误码优先，Job 级的 `blocked_graph`（「前置步骤没有完成」）只在没有失败步骤时用。
  - 白话表新增 `synthesis_failed`（「综合汇总生成失败」）、`model_quota_exhausted`、`org_ai_budget_exhausted`、`stale_running_recovered`（「上一次执行时间过长被中断」）。
  - 收尾的已知标记表新增「AI 账户余额不足」，排在「模型调用被限流」之前。
- **改用失败那一步自己的错误码收尾。** 收尾写进分析记录的错误码，取失败那一步的错误码，不再取 Job 的 `blocked_graph`。所以 `[tender-alert]` 日志的 `code=`、失败通知元数据里的 `errorCode`、通知正文里「卡在第 N 步…」的原因，都是那一步自己的。
- **新增两个测试，注册进 `scripts/test-all.sh`。**
  - 纯函数测试 `src/lib/workforce-runtime/__tests__/step-failure-visibility.test.ts`，同时注册进 `scripts/test-ci-unit.sh`。
  - 隔离库测试 `src/lib/tender-workforce/__tests__/synthesis-degrade-db.isolated.test.ts`。

## Capabilities

### New Capabilities

- `tender/analysis-synthesis-degrade`：招投标一键分析里，综合汇总步骤失败时不扣住 canonical 结果，以及「综合汇总未生成」在哪里、怎样写明。
- `agents/workforce-step-retry-visibility`：数字员工步骤失败时原因怎样归类、重试与中断回收怎样留痕，作业页与项目卡片怎样显示「正在第 N 次重试」和受阻原因。

### Modified Capabilities

- `tender/analysis-failure-surfacing`：原因取失败那一步自己的；三处（作业页、项目卡片、失败通知）说同一句；分析记录与 `[tender-alert]` 日志的错误码取失败那一步的。

## Impact

- 改动的文件：
  - `src/lib/agent-runtime-v2/executor.ts`：两处。批量执行路径的失败分支写归类后的错误码（`:1661-1690`）；每一轮开始时先做综合汇总降级（`:234-249` 之间）。
  - `src/lib/workforce-runtime/processor.ts`：遗留执行回收那一段（`:251-261`）。
  - `src/lib/workforce-runtime/handoff.ts`：跳过时的摘要与警告（`:367-370`、`:460-462`）。
  - 新增 `src/lib/workforce-runtime/step-failure.ts`：归类规则、降级判定，都是纯函数。
  - `src/lib/tender-workforce/tools.ts`：第 9 步（`:1044-1120`）。
  - `src/lib/workforce-runtime/read-model/stop-reason.ts`、`projection.ts`、`types.ts`、`service.ts`：步骤查询多取 `attemptCount`、`maxAttempts`。
  - `src/lib/tender-workforce/job-failure-surfacing.ts`、`src/lib/tender-workforce/trigger-service.ts`：卡片接口字段。
  - `src/app/(main)/workforce/[id]/page.tsx`、`src/components/tender-analysis/agent-card.tsx`。
- 测试：新增上面两个文件。扩 `stop-reason.test.ts`、`job-failure-surfacing.test.ts`、`job-failure-surfacing-db.isolated.test.ts`、`operator-ux.test.ts` 的场景。`t5-seg3-v2-convergence.test.ts`（V2-CONV-14：第 9 步仍依赖第 8 步）不改期望。
- 依赖：FIX-15 `workforce-invocation-deadline` 给第 8 步的模型调用加整次调用截止时间。两边改动互不依赖，先后合并都行，相邻处见 design「相邻改动与合并顺序」。
- 无 schema、无开关、无新队列、无新模型调用。合并即生效。

## Out of scope

- 第 8 步模型调用的超时，以及「截止时间到了就交还队列、不算失败」，归 FIX-15。本 change 只处理最终失败之后怎么办。
- 「从失败的这一步继续」归 FIX-20b `tender-job-continue-from-failed`。
- 识别到余额不足时不重试：本次不改，design D6 写了理由，留给 GATE。
- 招标分析模型层（`src/lib/ai/model-policy/retry.ts:56-58` 把 429 一律判为可重试，也包括余额不足）怎样换备用模型、怎样重试：不改。
- 作业页对「模型调用被限流 / 单次调用超时 / 模型调用全部失败」三种已知标记：仍按错误码显示「工具执行失败」，与项目卡片、通知粗细不同，这是 CHAIN-0c 的既有取舍，只在报告里写明。
- 作业列表卡片（`src/app/(main)/workforce/job-card.tsx`）的「N 项受阻」不加原因。
- 用户时间线里的重试条目：`job.retrying` 只有读取映射、没有写入方（`projection.ts:440`），不新增。
- 分析完成通知与 Muse `analysis.ready` 的文案：归 FIX-16。本次不在完成通知里提综合汇总。
- 第 8 步标题「Workforce 执行汇总」里的英文：不改。
- 不补救 2026-11-22「12-3」这个 Job：上线后在项目里重新分析，或者等 FIX-20b 合并后点「从失败的这一步继续」。
