# Proposal：综合汇总没做出来不再扣住招标分析结果，受阻时说清原因与重试（FIX-20）

TASKFLOW：FIX-20（Phase F（续）— 生产实测修复，2026-11-22）。「从失败的这一步继续」拆到同一工作树里的第二个 change `tender-job-continue-from-failed`（FIX-20b），理由见 design「拆分」。

受影响的 Muse 意图：无（`status` / `ask` / `rfq` / `compare` / `chase` / `price_scenario` / `next_step` 都不改，不改 `src/lib/muse-bridge/**`）。受影响的 Muse 事件：`analysis.ready`。综合汇总这一步失败时，第 9 步现在会照常终态化，所以这条事件会按既有规则发出；以前这种情况整次分析停住，不发这条事件。事件内容一个字不改。

## Why

据 Evan 2026-11-22 实测与 `[tender-alert]` 日志（第 8 步确切的错误码与原文待 design 附录的 SQL 核实），「12-3 Indoor Canadian Flag」一键分析的第 8 步综合汇总因 AI 账户余额不足失败，第 9 步因为依赖它没有开始，canonical 结果停在「分析中」，页面只显示「1 项受阻」，16:44:29 的失败通知写的是 Job 级的 `blocked_graph`（「前置步骤没有完成」），不是那一步自己的原因。第 8 步只给整个 Job 写一段汇总，不产出任何 canonical 语义（`src/lib/tender-workforce/deterministic-plan.ts:184-208`），任何页面也不显示这段汇总，所以它失败了不该扣住第 9 步。

## What Changes

- 把招投标服务端确定性计划里综合汇总步骤（第 8 步）的执行失败，在第 9 步开工之前改为「已跳过」，带上交接数据，写一条步骤完成事件。执行失败指模型报错、输出不合格、重试次数用尽、长时间没有进展被回收且次数用尽；契约损坏类失败照旧停下。
- 让第 9 步在 canonical V2 模式下遇到「综合汇总已跳过」的标记时，照常把分析记录改为待审阅；V1 兼容模式、以及依赖里既没有综合结果也没有标记时，照旧报 `INPUT_MISSING`。
- 改写被跳过的综合汇总交接数据里的话：摘要写「综合汇总未生成」，警告写「综合汇总未生成：〈原因〉」。
- 在作业详情接口与作业页「最终结果」一节写明「AI 数字员工的综合汇总未生成：〈原因〉」，只对招投标服务端计划的 Job。
- 在项目卡片接口和分析待审阅时的项目卡片上写明同一句，后面只加「招标分析结果见下方。」，不对分析结果是否完整下判断。
- 在步骤失败时（包括还会再试的那一次）按确定性规则写错误码：余额不足记 `model_quota_exhausted`，本组织月度 AI 费用到上限记 `org_ai_budget_exhausted`，其余照旧记 `synthesis_failed` / `tool_failed`。
- 在处理器回收遗留的「执行中」步骤时，给这一步写错误码 `stale_running_recovered`，再写一条不对用户显示的 `step.ready` 事件。
- 在一步重试那次执行中途让出时保留它的错误码，第 3 步重试期间就一直显示「正在第 N 次重试」。
- 在作业页任务行与「进度」一节、项目卡片「AI 分析中」那一行写明「正在第 N 次重试（最多重试 M 次）。上一次没成功：〈原因〉」，依据只有步骤状态、尝试次数与错误码。
- 在 Job 失败、需要人工处理、或进行中但有失败步骤时算停止原因，作业页写在「N 项受阻」旁边，项目卡片写在「AI 分析中」那一行。
- 改停止原因的取码规则：所取的是失败步骤时只用它自己的错误码；不是失败步骤时只用 Job 的错误码，不读该步骤上留下的错误码。
- 往停止原因白话表里加四个码：`synthesis_failed`、`model_quota_exhausted`、`org_ai_budget_exhausted`、`stale_running_recovered`。
- 把收尾的原因顺序改为：具体原因码 → 招投标已知标记（余额不足排第一）→ 笼统错误码 → 「执行出错」。
- 让收尾写进分析记录的错误码取失败那一步自己的，`[tender-alert]` 日志的 `code=` 与失败通知元数据里的 `errorCode` 随之改变。
- 新增纯函数测试 `src/lib/workforce-runtime/__tests__/step-failure-visibility.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- 新增隔离库测试 `src/lib/tender-workforce/__tests__/synthesis-degrade-db.isolated.test.ts`，注册进 `scripts/test-all.sh`。

## Capabilities

### New Capabilities

- `tender/analysis-synthesis-degrade`：招投标一键分析里，综合汇总步骤失败时不扣住 canonical 结果，以及「综合汇总未生成」在哪里、怎样写明。
- `agents/workforce-step-retry-visibility`：数字员工步骤失败时原因怎样归类、重试与中断回收怎样留痕，作业页与项目卡片怎样显示「正在第 N 次重试」和受阻原因。

### Modified Capabilities

- `tender/analysis-failure-surfacing`：原因取失败那一步自己的；三处（作业页、项目卡片、失败通知）说同一句；分析记录与 `[tender-alert]` 日志的错误码取失败那一步的；进行中有失败步骤时作业页也写原因。

## Impact

- 改动的文件：
  - `src/lib/workforce-runtime/constants.ts`：新增归类规则与降级判定。这是零依赖模块，执行器本来就引用它（`executor.ts:23`），不新增被禁止方向的引用，见 design D6。
  - `src/lib/agent-runtime-v2/executor.ts`：三处。每轮开头先做综合汇总降级（`:234-249` 之间）；批量执行路径的失败分支写归类后的错误码（`:1661-1690`）；批量路径的让出分支在重试中保留错误码（`:1615-1650`）。
  - `src/lib/workforce-runtime/processor.ts`：遗留执行回收那一段（`:251-261`）。
  - `src/lib/workforce-runtime/handoff.ts`：跳过综合汇总时的摘要与警告（`:367-370`、`:460-462`）。
  - `src/lib/tender-workforce/tools.ts`：第 9 步（`:1044-1120`）。
  - `src/lib/workforce-runtime/read-model/stop-reason.ts`、`projection.ts`、`types.ts`、`service.ts`：步骤查询多取 `attemptCount`、`maxAttempts`。
  - `src/lib/tender-workforce/job-failure-surfacing.ts`、`src/lib/tender-workforce/trigger-service.ts`：卡片接口字段。
  - `src/app/(main)/workforce/[id]/page.tsx`；项目卡片 `src/components/tender-analysis/agent-card.tsx`。FIX-18 先合并时，改在它抽出的 `src/lib/tender-workforce/agent-card-view.ts`。
- 测试：
  - 新增上面两个文件。
  - 扩 `stop-reason.test.ts`、`job-failure-surfacing.test.ts`、`job-failure-surfacing-db.isolated.test.ts`、`operator-ux.test.ts` 的场景。
  - `t5-seg3-v2-convergence.test.ts`（V2-CONV-14：第 9 步仍依赖第 8 步）与 `t5-p11-resumability.test.ts`（让出分支的字符窗口断言）不改期望。
- 依赖：FIX-15 `workforce-invocation-deadline` 给第 8 步的模型调用加整次调用截止时间，并改同一个让出分支。两边先后合并都行，协调方式见 design「相邻改动与合并顺序」。
- 无 schema、无开关、无新队列、无新模型调用入口；不改运行时架构基线 `src/lib/runtime-architecture/runtime-architecture-baseline.json`。合并即生效。

## Out of scope

- 第 8 步模型调用的超时，以及「截止时间到了就交还队列、不算失败」，归 FIX-15。本 change 只处理最终失败之后怎么办。
- 「从失败的这一步继续」归 FIX-20b `tender-job-continue-from-failed`。
- 识别到余额不足时不重试：本次不改，理由见 design D7，留给 GATE。
- 招标分析模型层怎样换备用模型、怎样重试，不改。`src/lib/ai/model-policy/retry.ts:56-58` 把 429 一律判为可重试，余额不足也在内。
- 作业页对「模型调用被限流 / 单次调用超时 / 模型调用全部失败」三种已知标记，仍按错误码显示「工具执行失败」，与项目卡片、通知粗细不同。这是 CHAIN-0c 的既有取舍；把它们也改成写入时归码，要动第 3 步等工具的报错约定，超出本需求，只在报告里写明。
- 作业列表卡片（`src/app/(main)/workforce/job-card.tsx`）的「N 项受阻」不加原因，见 design「留给 GATE」G7。
- 分析完成站内通知的文案归 FIX-16 `tender-analysis-incomplete-notes`，本次不在完成通知里提综合汇总，见 G7。
- Muse `analysis.ready` 的文案：不在本次；FIX-16 把它列在「留给 GATE」G3，登记为后续 change，编号待定。
- 第 8 步自己的交接数据构建失败（`handoff_build_failed`）不降级，理由见 design D3。
- 用户时间线里的重试条目：`job.retrying` 只有读取映射、没有写入方（`projection.ts:441`），不新增。
- 第 8 步标题「Workforce 执行汇总」里的英文，不改。
- 不补救 2026-11-22「12-3」这个 Job：上线后在项目里重新分析，或者等 FIX-20b 合并后点「从失败的这一步继续」。
