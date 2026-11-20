# Design：招标分析切片的模型调用守住绝对截止时间

## Context

动机与生产时间线见 proposal.md「Why」「What Changes」。调用链（由外到内）：

1. `advanceV2Analysis`（`src/lib/tender-auto-analysis/v2-resumable.ts`）：切片推进器，拿到 `deadlineAt`（路由层从 HTTP 调用开始算，`AGENT_RUNS_INVOCATION_BUDGET_MS = 240_000`），每个阶段前用 `canStartPhase` 判断能否开工，用 `callTimeoutFor(remaining) = max(1s, remaining − PHASE_SAFETY_MS)` 算**一个相对超时**传下去。
2. `runExtractionWindow` / `resolveClarificationItem` / `runAnalystPassA|B`：把超时与本阶段上限（180s / 60s / 240s）取小，交给 `callStructured`。
3. `callStructured`（`src/lib/tender-understanding/llm.ts`）：最多 2 次尝试；invoker 抛错时「transient 只额外重试一次」，结构化输出不合格时带错误反馈再试；**两种重试都用同一个 `req.timeoutMs`**。
4. 钉住模型的 invoker → `createTenderCompletion`（`src/lib/ai/model-policy/tender.ts`）：首调失败后按 `decideTenderRecovery` 做同模型重试（只对 Astra）或换备用模型（terra / Astra → sol）；**每一次都用同一个 `timeoutMs`**。`createPinnedTenderInvoker` 只在备用**成功**后才把钉住的模型换成备用。
5. `createCompletionDetailed`（`src/lib/ai/client.ts`）：`setTimeout(abort, timeoutMs)`；OpenAI SDK 自身的重试在同一个 signal 下，被计时器整体截住。被中止时 SDK 抛「Request was aborted.」，`classifyModelError` 因含 `aborted` 判为 retryable。

所以一次窗口调用的最坏用时是 `2（callStructured）× 2（主 + 备）× timeoutMs`；`timeoutMs` 是按剩余预算裁的，乘以 4 就越过了切片截止。t+260s 那轮 terra / retryCount 0 就是第 3 层的 transient 重试（`retryCount` 缺省 0，钉住模型仍是 terra）。

`analyzeTender` 单次编排与其它招标模型调用方（报价推导、分析备忘、供应商情报等）走同一个 `callStructured` / invoker，但不在切片里、没有截止时间。

## Goals / Non-Goals

**Goals:**
- 截止时间是一个绝对时刻，从阶段开始一路带到每一次实际请求；任何重试、换模型都只能用剩下的时间。
- 截止触发的失败在最内层就停下，不向上游的任何重试层伪装成「可重试」。
- 能在毫秒级的单测里按生产时间线（240 秒、t+190s、35.3 秒）复现并守住。

**Non-Goals（不动的模块 / 文件）:**
- `src/lib/ai/client.ts`：不改 `createCompletionDetailed` 的签名与计时方式（全平台共用）。
- `src/lib/ai/model-policy/retry.ts`：不改 `classifyModelError`；`decideTenderRecovery` / `isTenderFallbackAllowed` 的判定不变。
- `src/lib/tender-auto-analysis/v2-cursor.ts`：只改 `V2_PHASE_MIN_MS.WINDOWS`（D8）；`CLARIFY` / `ANALYST_A` / `ANALYST_B` / `PERSIST` 门槛、`PHASE_SAFETY_MS`、`HARD_MIN_PHASE_MS`、`MAX_WINDOW_ATTEMPTS`、`MAX_ANALYST_ATTEMPTS`、`callTimeoutFor`、`canStartPhase` 不改；游标结构不加字段（错误码只是 `lastErrorCode` 的一个新取值）。
- `src/lib/tender-auto-analysis/worker.ts` 的 `MIN_RUN_SLICE_MS`（45s，旧 cron 认领下一个 run 的门槛）与 `src/lib/workforce-runtime/processor.ts` 的 `WORKFORCE_SLICE_BUDGET_MS`（45s）不改：它们管的是「还要不要认领」，不是窗口开批。
- `src/lib/workforce-runtime/constants.ts`、`src/app/api/cron/agent-runs/route.ts`、`src/app/api/cron/tender-auto-analysis/route.ts`：预算与 `maxDuration` 不变。
- `src/lib/workforce-runtime/processor.ts`：`kickQueuedWorkforceJobSlice` 的预算起点不改。
- 切片外的 `callStructured` 调用方（`tender-pricing/derive.ts`、`tender-analyst-memo/**`、`supplier-intel/search-brief.ts`、`tender-intel/market-pricing.ts`、`quote-engine/import/classify-ai.ts`、`projects/generate/rfi-export.ts`、`tender-bid-draft/synthesize.ts`、`tender-auto-analysis/reply-resolution.ts`）：不传截止时间，行为不变。

## Decisions

### D1 截止时间是请求上的一个绝对时刻（`deadlineAt`，epoch 毫秒）

`LlmCallRequest` 加可选 `deadlineAt`；`advanceV2Analysis` 每个阶段开工时算 `callDeadlineAt = now + callTimeoutFor(remaining)`（等于 `deadlineAt − 15s`，最短 now + 1s，与现在的相对超时完全同值），经阶段函数 → `callStructured` → invoker → `createTenderCompletion`。每一次请求在**发起那一刻**算 `min(阶段上限, callDeadlineAt − now)`。

- 否决：每层继续传相对超时、在重试前按已用时间扣减。要在三层各自记起点，`callStructured` 与 `createTenderCompletion` 互不知道对方用了多少，漏一层就重演本次事故。
- 否决：重试时把超时按次数折半（主 35s、备 17s…）。仍可能越过截止（层数相乘），且把可用时间浪费掉。

### D2 只在招标模型调用层看时钟，`callStructured` 只认一个带类型的「截止」错误

`createTenderCompletion` 是唯一读时钟、算超时、决定要不要再请求的地方：发起前剩余 < 1s 不发；失败后剩余 < 5s 抛 `TenderCallDeadlineError`（`code = "CALL_DEADLINE_EXCEEDED"`）而不进入 `decideTenderRecovery`。`callStructured` 捕到这个错误（按 `code` 识别）就记日志、以 `CALL_DEADLINE_EXCEEDED` 返回，不做 transient 重试；结构化不合格后的第二次尝试照常调 invoker，由 invoker 在剩余不足时抛同一个错误。

- 否决：在 `createCompletionDetailed` 里统一做截止。它是全平台共用的入口（聊天、报价、销售……），改它的影响面远超本次。
- 否决：`callStructured` 自己也读 `Date.now()` 判截止。两处时钟要保持一致，测试里的虚拟时钟要注入两遍；而且测试用的假 invoker 会被误判。

### D3 「我方截止触发」按剩余时间判定，不解析错误文本

规则：失败后若 `callDeadlineAt − now < 5_000`，不论错误是本方计时器中止、限流还是 5xx，一律按截止处理。本方计时器在截止时刻触发时剩余必然 ≈ 0，落在这条规则里。

- 否决：认「Request was aborted」/ `APIUserAbortError` 文本判断是不是我方中止。依赖 SDK 的错误文案，换供应商或升级 SDK 就失效；也分不清「阶段上限到了」与「截止到了」。
- 5 秒的取舍：不足 5 秒的备用请求几乎不可能完成一次窗口抽取，只会多烧一次调用再被中止。阶段上限先到（如澄清 60s）而剩余还多时，不受此限，照旧换模型。

### D4 截止失败的窗口计入 3 次上限

截止触发的窗口失败与其它失败一样 `attempts + 1`、`lastErrorCode = CALL_DEADLINE_EXCEEDED`。

- 否决：截止失败不计次数。若某窗口每次都在切片尾部被排到（或本身就超过任何切片能给的时长），会无限续跑，最后又以「长时间没有进展」收场——正是本次要消除的现象。计次数后最多 3 次就以「窗口 LLM 抽取失败」进 limitations，分析照常完成。下一切片从满预算开始，窗口拿到的超时是阶段上限 180s 而不是尾巴上的 35s，第二次通常就能完成。

### D5 任一阶段撞上截止就立即让出

窗口批次、澄清、Analyst 任一遍拿到 `CALL_DEADLINE_EXCEEDED` 后：照既有语义记下结果 → 写检查点 → `yieldNow(phase, "call_deadline")`。

- 否决：记下后 `continue` 回循环顶部交给 `canStartPhase` 判断。生产预算下结果相同（剩余约 15s < 45s 门槛），但小预算环境里门槛退化为 10s，会接着开一批只有 1 秒超时的请求，必然再撞截止，白白多一次检查点写入与调用。

### D6 落库前的中文化用它自己的截止时间

`translateRequirementsZh` 已经有「总预算 → 截止 → 每批取剩余」的结构，只是没往下传。改为把它算出的截止时间放进每批请求的 `deadlineAt`。总预算公式（`min(240s, max(10s, remaining − 5s))`）不改。

- 否决：在 PERSIST 阶段也改用 `callTimeoutFor(remaining)` 作为中文化预算。会把中文化预算缩短 10 秒，属于另一处取舍，不在本次「重试不越过截止」的范围里。

### D7 测试用注入的完成函数 + 虚拟时钟

`createPinnedTenderInvoker` / `createTenderCompletion` 增加两个可选注入口：`now`（缺省 `Date.now`）与 `complete`（缺省 `createCompletionDetailed`）。回归测试用一个小的虚拟时钟调度器：慢模型返回「`min(模型耗时, 超时)` 之后结束」的承诺；驱动循环在微任务清空后把时钟拨到最近的到期点。这样一批 3 个并行窗口在虚拟时间里是真正并行的，单测毫秒级跑完，且可以精确断言 t+190s / t+225s。

- 否决：真实计时器 + 缩小预算。小预算下阶段门槛退化为 10 秒、安全余量固定 15 秒，测试至少跑十几秒且时序不稳。
- 否决：替换全局 `Date.now` / 用 `node:test` 的 mock timers。会影响同进程里的其它代码，且这里的测试不用 `node:test` 跑。

### D8 窗口阶段开新一批的门槛 45 秒 → 80 秒

依据（Lucas 2026-11-20 读生产日志）：单次窗口调用耗时 17–73 秒；一批并发 3 个窗口，批次用时取最慢的那个。门槛 45 秒时，一批最短只拿到 `45 − 15 = 30` 秒超时，大半窗口必然被裁短——t+190s（剩 50 秒、超时 35.3 秒）那批就是这样。截止修好之后这类批次不再越过 300 秒，但仍白烧一次尝试和一次调用的费用。门槛 80 秒时最短超时 65 秒，覆盖日志里绝大多数窗口；剩余 45–80 秒的那段直接让出，下一切片从满预算开始，失败的窗口排在待办最前面。

- 否决：保持 45 秒。截止修好后不会再被硬杀，但每个切片尾部很可能多一批注定被裁短的请求：每次都烧掉一次尝试（3 次上限）与费用。
- 否决：90 秒（最短超时 75 秒，覆盖到观测最大值 73 秒）。比 80 秒多空出 10 秒尾巴，换来的只是覆盖最慢那一小部分窗口；Lucas 建议「80 秒左右」，取 80，生产观测后可再调。
- 否决：按历史耗时动态估算门槛。要存统计、跨切片读写，引入非确定性，超出本次范围。
- 影响面：只有切片预算 ≥ 80 秒时生效（生产两条入口都是 240 秒）；预算小于 80 秒（本地 / 测试）退化为 `HARD_MIN_PHASE_MS`，与现在预算小于 45 秒时的行为相同。

## 与八条硬纪律的关系

1. 零 schema：不涉及（不加模型、字段、迁移；`CALL_DEADLINE_EXCEEDED` 存在既有游标 JSON 的 `lastErrorCode` 里）。
2. 出站先审批：不涉及（没有任何对外发送）。
3. 禁止第三套队列：遵守——只改既有切片推进器里的时间分配，不新增 scheduler / queue / lease / worker；续跑仍靠既有 workforce runtime 与 cron。
4. 脱敏：不涉及（不产生新的输出文本；日志只多一个错误码）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守——不新增 LLM 调用，只会减少注定失败的重试；截止判断是确定性的时间比较。
8. 测试注册：新测试 `src/lib/tender-auto-analysis/__tests__/v2-slice-deadline.test.ts` 同一 task 内注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `npx tsx src/lib/tender-auto-analysis/__tests__/v2-slice-deadline.test.ts`：慢模型（t+155s 起一批、超时 70 秒）→ 让出不晚于 255s（且实际为 225s）、中止后零重试 / 零换模型、窗口失败计 1 次、理由 `call_deadline`、下一切片重跑；生产时间线（两批各 95 秒）→ t+190s 让出、不开第三批；Analyst / 澄清撞截止；剩余充足时照旧换备用且超时 ≤ 剩余。
- 同一测试在「只加注入口、不加截止判断与新门槛」的代码上运行：慢模型用例失败（435s）、生产时间线用例失败（330s）——在报告里贴输出。
- `npx tsx src/lib/ai/model-policy/__tests__/tender.test.ts`：截止错误、剩余阈值、无截止时行为不变。
- 既有：`v2-resumable.test.ts`、`t5-p11-resumability.test.ts`、`input-completeness.test.ts`、`tender-org-propagation.test.ts`、`requirement-translate` 相关测试保持通过。
- `npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npm run test:ci`（CI 环境变量）、`npm test`（对照既有失败清单）、`openspec validate tender-analysis-call-deadline --strict`。

## Risks / Trade-offs

- [窗口在切片尾部被排到、超时被裁短，撞截止会吃掉一次尝试] → D8 把最短超时提到 65 秒；3 次上限下仍有两次满预算机会（失败的窗口在下一切片排最前面）。
- [门槛 80 秒让每个切片尾部最多空出约 80 秒] → 生产批次用时约 60–75 秒，原本这段时间里开的批次大多被裁短；空出的尾巴换来的是少烧尝试与费用。
- [5 秒阈值让「剩 6 秒时换备用」仍会发生，备用大概率被中止] → 有界（不越过截止），只多一次短请求；阈值是常量，生产观测后可调。
- [不传截止时间的调用方仍是旧行为，最坏 4× 超时] → 它们不在 300 秒硬超时的切片里；本次 Non-Goals 已列明。
- [测试注入口出现在生产代码里] → 两个可选参数，缺省即原实现；不在任何 API 上暴露。

## Migration Plan

无数据迁移、无开关。合并部署即生效；回滚 = 回退本 PR。上线后两个卡住的项目（「12-01」「12-3」）在项目页点「重新分析」。
