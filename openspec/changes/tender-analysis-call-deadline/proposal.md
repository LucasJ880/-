# Proposal：招标分析切片的模型调用守住绝对截止时间（FIX-12）

TASKFLOW：FIX-12（Phase F（续）— 生产实测修复，2026-11-20）

## Why

生产实测（2026-11-20「12-3 Indoor Canadian Flag」，Job 09:27 创建）一键分析第 3 步两次被 Vercel 300 秒硬杀（09:46:29、09:54:29，504「Task timed out after 300 seconds」），没留下检查点；11-19「12-01」Job 的「长时间没有进展」（`stale_running_exhausted`）是同一根因。窗口调用的超时按剩余预算裁到 35.3 秒是对的，但被中止后备用模型（terra → sol）和结构化输出层的「瞬时错误再试一次」都沿用同一个 35.3 秒重新计时，一次窗口调用最多变成四段 35.3 秒，越过 240 秒的切片预算一路跑到 300 秒。

## What Changes

已核对的时间线（日志 t = 本次调用开始）与来源：

| 时刻 | 调用 | 来源 |
|---|---|---|
| t+190s | 一批窗口，terra，retryCount 0，35.3s | `advanceV2Analysis` 的 WINDOWS 批次，`callTimeoutFor(50.3s)` |
| t+225s | 两路「Request was aborted」 | 我方 35.3s 计时器中止 |
| t+225s → t+260s | sol，retryCount 1，35.3s | `createTenderCompletion` 的 fallback，沿用同一 `timeoutMs` |
| t+260s → t+295s | terra，retryCount 0，35.3s | **`callStructured` 的「transient 只额外重试一次」**：invoker 抛错后整条链再调一遍；钉住的模型仍是 terra（只有备用成功才换），`retryCount` 缺省 0 |
| t+295s → | sol（再一次 fallback） | 同上，被 300s 硬杀截断 |

- 改为每个阶段开始时算出一个**绝对调用截止时间**（`本次切片截止 − PHASE_SAFETY_MS`，最短 1 秒），随请求传过结构化输出层、招标模型调用层直到每一次实际请求；每次请求（首调、同模型重试、换备用模型、结构化输出重试、瞬时错误重试）的超时取「阶段超时上限」与「截止时间 − 发起时刻」的较小者。
- 剩余不足 1 秒时不再发起请求；一次请求失败后剩余不足 5 秒（我方截止触发的中止必然落在这里）时，不做同模型重试、不换备用模型、不做结构化输出重试，直接返回错误码 `CALL_DEADLINE_EXCEEDED`。
- 窗口阶段：拿到 `CALL_DEADLINE_EXCEEDED` 的窗口记一次失败（计入既有的 3 次上限），本批结果写检查点后立即让出本切片，让出理由 `call_deadline`。
- 澄清、Analyst 两遍、落库前的中文化同样带截止时间；澄清 / Analyst 遇到截止按既有失败语义记下后让出，中文化遇到截止按既有「这一批保留原文」处理。
- 把窗口阶段「开一批新窗口」的剩余时间门槛从 45 秒提到 80 秒（design D8）：生产日志单次窗口调用 17–73 秒，45 秒门槛下一批最短只拿到 30 秒超时，t+190s 那批注定被裁短；80 秒时最短超时 65 秒。其它阶段门槛不变。
- 新增回归测试：注入慢模型（不在超时内返回），按 240 秒预算驱动一个切片，断言从开始到让出（含所有重试）不超过 `预算 + PHASE_SAFETY_MS`，且中止后没有任何重试或换模型的请求；另按生产时间线（两批各 95 秒、t+190s 还有窗口）断言不再开批、零裁短。两个用例在只加测试注入口、不加截止判断与新门槛的代码上都失败（分别到 t+435s、t+330s 才结束）。
- 补单元测试：招标模型调用层在有剩余时仍按原规则重试 / 换模型且每次超时不超过剩余；没有截止时间的调用方行为逐字节不变。

## Capabilities

### New Capabilities

- `tender/analysis-slice-budget`：招标 V2 分析单个切片的时间预算——模型调用（含全部重试与换模型）不越过切片截止时间，截止触发的失败怎样记、怎样让出。

### Modified Capabilities

（无。既有主规格里没有分析切片预算的要求；`tender/analysis-failure-surfacing` 的收尾行为不变。）

## Impact

- 代码：`src/lib/ai/model-policy/tender.ts`（截止时间、重试 / 换模型前的剩余判断、测试注入口）、`src/lib/tender-understanding/llm.ts`（请求带截止时间、遇截止不重试、新错误码）、`src/lib/tender-understanding/analyzer.ts` / `clarify.ts`、`src/lib/tender-analyst/synthesize.ts`（透传）、`src/lib/tender-auto-analysis/v2-resumable.ts`（每阶段算截止、截止即让出）、`src/lib/tender-auto-analysis/v2-cursor.ts`（窗口门槛 45s → 80s）、`src/lib/tender-auto-analysis/requirement-translate.ts`（中文化带截止）。
- 两条入口都受益：workforce 的 `/api/cron/agent-runs`（一键分析）与旧的 `/api/cron/tender-auto-analysis`，都经同一个 `advanceV2Analysis`。
- 测试：新增 `src/lib/tender-auto-analysis/__tests__/v2-slice-deadline.test.ts`（注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）；扩 `src/lib/ai/model-policy/__tests__/tender.test.ts`。
- 无 schema、无新开关、无新队列、无新 LLM 调用（只会少调）；合并即生效。

## Out of scope

- 不改切片预算与其它阈值：`AGENT_RUNS_INVOCATION_BUDGET_MS`（240s）、`maxDuration`（300s）、`V2_PHASE_MIN_MS` 里窗口以外的各阶段门槛、`PHASE_SAFETY_MS`（15s）、`HARD_MIN_PHASE_MS`（10s）、`MAX_WINDOW_ATTEMPTS`（3）、各阶段超时上限都不动。
- 不改 `ai.call` 日志里 `retryCount` 的口径（结构化输出层的重试仍记 0）；本次只在报告里写明它的来源。
- 不改 `kickQueuedWorkforceJobSlice` 以「被调用时刻」起算预算的做法（只在路由层调用，与本次 504 无关）。
- 不改切片之外的模型调用方（报价推导、分析备忘、供应商情报、补翻端点以外的调用等）：它们不传截止时间，行为不变。
- 不改 GPT-6 Astra 开关（生产 `flagDecision = kill_switch`，见交接文档）。
- 不补救 11-19「12-01」与 11-20「12-3」两个 Job：上线后在项目里重新发起分析。
