# FIX-12 报告：招标分析切片的模型调用守住绝对截止时间

| 项 | 值 |
|---|---|
| change | `tender-analysis-call-deadline`（新能力 `tender/analysis-slice-budget`，8 条要求、19 个场景） |
| TASKFLOW | FIX-12（Phase F（续）— 生产实测修复，2026-11-20） |
| 来源 | Evan 2026-11-20 生产实测「12-3 Indoor Canadian Flag」（Job 09:27 创建）：一键分析第 3 步 09:46:29、09:54:29 两次 504「Task timed out after 300 seconds」；11-19「12-01」Job 的「长时间没有进展」（`stale_running_exhausted`）同一根因 |
| 拍板 | 四件套 Lucas 2026-11-20 同意；截止失败计入 3 次上限同意；窗口门槛 45 → 80 秒为 Lucas 建议、本次采纳（design D8） |
| PR | LucasJ880/-#540（Draft） |
| 分支 | `claude/amazing-planck-0s5wnb` |
| 性质 | 修既有的超时链。零 schema、零新模型调用（只会少调）、没有出站。**没有开关——合并即生效** |

## 0. 一句话

以前：文件多、模型慢时，一键分析第 3 步会被平台 300 秒强制中断，这一段的结果没存下，项目一直「分析中」，最后报「长时间没有进展」。现在：每一段（切片）最多约 3 分 45 秒就存档让出，下一段接着跑。代价：模型特别慢时，个别页面段落在 3 次都没读完后会被跳过（写进分析的局限说明），中文综合解读或二次复核也可能这次没生成——这些以前是整个分析失败。

术语：terra = 主模型 `gpt-5.6-terra`，sol = 备用模型 `gpt-5.6-sol`（生产 GPT-6 Astra 没开，见交接文档 §0.5i）；retryCount 是日志里的重试序号；「窗口」= 分析时把文件切成的一段页面；「结构化输出层」= 把模型回复解析成 JSON 的那一层（`callStructured`），它在模型调用出错时会再调一次。

## 1. 时间线与来源

日志 t = 这一段定时任务（切片）开始，即 `/api/cron/agent-runs` 这次被调用的时刻；切片预算 240 秒（`AGENT_RUNS_INVOCATION_BUDGET_MS`），平台硬超时 300 秒。

| 时刻 | 调用 | 来源（已核对代码） |
|---|---|---|
| t+190s | 一批窗口，terra，retryCount 0，超时 35.3s | `advanceV2Analysis` WINDOWS 批次：剩 50.3s ≥ 45s 门槛，`callTimeoutFor(50.3s) = 35.3s` |
| t+225s | 两路「Request was aborted」 | `createCompletionDetailed` 的本方计时器；`classifyModelError` 因含 `aborted` 判为 retryable |
| t+225s → t+260s | sol，retryCount 1，35.3s | `createTenderCompletion` 的 fallback（terra 不是 Astra，没有 retry_same），**沿用同一个 `timeoutMs`** |
| **t+260s → t+295s** | **terra，retryCount 0，35.3s** | **`callStructured`（`tender-understanding/llm.ts`）的「transient 只额外重试一次」**：invoker 抛错后整条链再调一遍；钉住的模型仍是 terra（`createPinnedTenderInvoker` 只在备用**成功**后才换模型），`retryCount` 缺省 0 |
| t+295s → | sol（再一次 fallback） | 同上；t+300s 被硬杀，这一批没写检查点 |

一次窗口调用最坏 = 2（结构化层）× 2（主 + 备）× 超时。超时按剩余预算裁过，乘 4 就越过截止。Analyst 同理：本机复现 Analyst 第一遍最坏到 t+897s。

## 2. 做了什么

1. **绝对截止时间贯穿全链**：每个阶段开工时算 `callDeadlineAt = max(now + 1s, 切片截止 − 15s)`（锚定切片截止），经阶段函数 → `callStructured` → 钉住模型的 invoker → `createTenderCompletion`；每一次请求（首调、同模型重试、换备用、结构化重试、瞬时错误重试）在发起那一刻取 `min(阶段上限, 截止 − now)`。
2. **截止即停**：剩余 < 0.5s 不发请求；一次请求以可重试的错误失败（本方截止中止必然落在这里）或输出不合格之后剩余 < 5s，不重试、不换模型，抛 `TenderCallDeadlineError`（`code = CALL_DEADLINE_EXCEEDED`，文案不含 timeout / aborted，任何一层都不会判为可重试）；`callStructured` 认这个错误直接返回，不做 transient 重试；结构化层的第二次尝试带 `retry` 标记，剩余 < 5s 时 invoker 不发；最后一次换备用撞截止同样记为截止；不可重试的错误（400 等）照旧原样返回；发之前就拒的不记调用日志。
3. **截止即让出**：窗口批次 / 澄清 / Analyst 任一遍拿到 `CALL_DEADLINE_EXCEEDED` → 按既有语义记下（窗口 attempts + 1、澄清记未解决、Analyst 失败次数 + 1）→ 写检查点 → 以 `call_deadline` 让出。
4. **中文化**：`translateRequirementTexts` 把它已有的总预算截止放进每批请求——落库前那次与「补翻」接口 `POST /api/projects/[id]/bid-fit/translate`（100 秒预算、`maxDuration` 120 秒）都受益。
5. **窗口门槛 45s → 80s**（design D8）：生产单次窗口 17–73s，45s 门槛下最短超时 30s；80s 时最短 65s。t+190s 剩 50s 的那一批现在不开，直接让出。
6. **测试注入口**：`createTenderCompletion` / `createPinnedTenderInvoker` 可选 `now`、`complete`，缺省即原实现，注释标 `@internal`（生产不得传：会绕过费用预检与记账）。

没有截止时间的调用方（单次编排 `analyzeTender`、报价推导、分析备忘、供应商情报等）不传 `deadlineAt`，行为逐字节不变（`tender.test.ts` DL-03）。

## 3. 测试：改前 / 改后

新测试 `src/lib/tender-auto-analysis/__tests__/v2-slice-deadline.test.ts`：真实的切片推进器 + 结构化层 + 招标模型调用层（含重试 / 换备用），只把最底层的「发请求」换成慢模型，虚拟时钟（一批 3 个窗口在虚拟时间里真并行），毫秒级跑完。

**在「只加注入口、不加截止判断与新门槛」的代码上**（task 1.1）——31 项里 24 项失败，完整复现生产里 terra 0 → sol 1 → terra 0 → sol 1 的四段：

```
· SD-01 让出于 435.0s，理由 budget_remaining_ms=-195000，请求 18 次
  p7 gpt-5.6-terra retryCount=0 155.0s→225.0s timeout=70.0s aborted
  p7 gpt-5.6-sol retryCount=1 225.0s→295.0s timeout=70.0s aborted
  p7 gpt-5.6-terra retryCount=0 295.0s→365.0s timeout=70.0s aborted
  p7 gpt-5.6-sol retryCount=1 365.0s→435.0s timeout=70.0s aborted
✗ SD-01 切片从开始到让出（含所有重试）≤ 预算 + PHASE_SAFETY_MS（435.0s ≤ 255.0s）
· SD-03 让出于 330.0s，理由 budget_remaining_ms=-90000，请求 18 次      ← 生产时间线（t+190s 起一批 35s）
· SD-04 让出于 415.0s；备用请求 … 215.0s timeout=70.0s … 345.0s timeout=70.0s
· SD-05 让出于 390.0s（CLARIFY/budget_remaining_ms=-150000）
· SD-06 让出于 897.0s（ANALYST_A/budget_remaining_ms=-657000）
通过 7，失败 24
```

只加截止判断、还没改门槛时，SD-03（生产时间线）已从 330s 降到 225s，只剩「t+190s 仍开了一批」三项失败；改门槛后全过。

**改后**（多维审查修复之后，用例从 31 增到 43）——43 / 43：

```
· SD-01 让出于 225.0s，理由 call_deadline，请求 9 次
· SD-03 让出于 190.0s，理由 budget_remaining_ms=50000，请求 6 次
· SD-04 让出于 225.0s；备用请求 p7 215.0s timeout=10.0s，p8 215.0s timeout=10.0s，p9 215.0s timeout=10.0s
· SD-05 让出于 225.0s（CLARIFY/call_deadline）；澄清请求 主 150.0s timeout=60.0s，备 210.0s timeout=15.0s
· SD-06 让出于 225.0s（ANALYST_A/call_deadline）；Analyst 请求 主 1.0s timeout=224.0s
· SD-12 让出于 225.0s；请求 主@0.0s/180.0s ×3 备@180.0s/45.0s ×3        ← 全部窗口都不返回
通过 43，失败 0
```

| 测试 | 开工前 | 结束 |
|---|---|---|
| `v2-slice-deadline.test.ts`（新） | — | 43（SD-01…SD-12） |
| `model-policy/__tests__/tender.test.ts` | 39 | 55（DL-01…DL-11） |
| 改动涉及模块的其余 26 个已注册测试（model-policy 9 个、tender-understanding 4 个、v2-resumable、worker-budget-guards、t5-p11 / seg2 / seg3、analyst-synthesis、memo-v2、analyst-memo-v1、bid-draft、pricing-helper、rfi-export、bid-fit-usability、search-brief） | 全过 | 全过，通过数不变 |

## 4. 门禁

| 项 | 结果 |
|---|---|
| `npm test`（本机，带隔离库，多维审查修复之后） | `703/713 通过, 10 失败`；10 项全在既有失败清单里（`docs/QINGYAN_CHAIN-3_REPORT.md` §4：来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB 75 / 76）；清单里的 Mention Gateway M2-A 这次在新建的隔离库上通过 |
| CI 环境变量下 `bash scripts/test-ci-unit.sh` | `CI unit subset PASS`（审查修复之后重跑） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（无新增指纹） |
| `bash scripts/test-runtime-architecture.sh` | PASS |
| `bash scripts/check-test-registry.sh` | 已注册 680 个，历史欠账 66 条 |
| `openspec validate tender-analysis-call-deadline --strict` | valid |
| `git diff origin/main -- prisma/ vercel.json` | 空 |

## 5. 多维审查

开 PR 前并行派了五个子 agent，各审一个维度，只给 diff 与四件套、不给结论；每条意见先核实再处理（两条关键说法——SDK 重试等待不看 signal、同一次调用的第二个任务不看截止——读源码核实属实；两个复现脚本在修复后重跑确认）。

| 维度 | 意见 | 处理 |
|---|---|---|
| 正确性与回归 | 小预算（本地 / 测试）下调用截止 = 开工 + 1s，而「不发请求」阈值也是 1s，过 1 毫秒首次请求就被拒，白吃一次窗口 / Analyst 尝试（脚本复现：12 秒预算第 1 切片发出 0 个请求） | **已修**：阈值 0.5s；重跑脚本第 1 切片发出 4 个请求、3 个窗口有结果；新增 DL-10、SD-09、SD-10 |
| | 最后一次换备用在截止时被中止，原样抛出，上一层没有重试机会时记成 `TRANSIENT_MODEL_ERROR`、按预算不足让出 | **已修**：最后一次请求失败也按「可重试且剩余 < 5s → 截止」判；重跑脚本得 `CALL_DEADLINE_EXCEEDED`；新增 DL-11 |
| | 调用截止用 `now()` 在 `buildResult` 等同步计算之后取，截止会被推后这段 CPU 时间 | **已修**：锚定切片截止 `max(now + 1s, 切片截止 − 15s)` |
| | 发之前就被拒的请求也记一条日志，算进 `llmCalls` | **已修**：只在真的发过请求时记日志（SD-07 断言 `llmCalls = 0`） |
| | 费用预检在计时器开始之前；单次编排的中文化现在也受 240 秒总预算约束；澄清被截止后永久记为未解决 | 不改：15 秒余量盖得住预检；中文化受预算约束是规格要求（「中文化不越过它的总预算」已写明两个调用方）；澄清的保守方向与既有失败相同 → 另开任务（§7） |
| | 没有同一批里有成功有截止的用例 | **已补** SD-08 |
| 安全 / 隐私与硬纪律 | 八条硬纪律都不违反；测试注入口若被生产调用方传入会绕过费用预检与记账（今天没有任何路径能传到） | **已修**：注释标 `@internal`；`check-test-registry` 与运行时架构守卫通过 |
| 规格—代码—测试一致性 | 规格写「任何失败 < 5s 都记截止」，代码对不可重试错误原样抛出 | **已修规格**：可重试的失败或输出不合格才记截止，不可重试的原样结束（加场景「不可重试的错误原样结束」） |
| | 补翻接口 `bid-fit/translate` 也被约束了，规格与 proposal 没写 | **已补**：规格「中文化不越过它的总预算」写明两个调用方，proposal Impact 与 design D6 补上 |
| | 「剩余不足 1 秒」与「最短 1 秒」冲突 | **已修**（同正确性第 1 条），规格加场景「最短 1 秒的截止仍发出首次请求」 |
| | 场景缺断言：混合批次、Analyst 第二遍、小预算、全部窗口都不返回、中文化截止保留原文；SD-07 上界太松；SD-03 没断言让出理由 | **已补** SD-07（收紧 + 截止批次）、SD-08、SD-09、SD-10、SD-11、SD-12，SD-03 断言理由 |
| | design / tasks 写错函数名 `translateRequirementsZh`；场景标题「被中止后」实为限流；「之前结束」应为「不晚于」；报告测试数 5 应为 4；Impact 漏 `index.ts`；What 要点没以动词开头 | **已修** |
| | 局限说明里会出现英文码 `CALL_DEADLINE_EXCEEDED` | 规格补「3 次用尽后按既有规则计入局限说明」；中文化另开任务（§7） |
| 使用流畅与文案 | 上线后的观察写法不对（时间充裕时照旧换备用属正常）；缺白话摘要；术语没解释；「t =」含糊；按钮名应为「重新分析当前投标文件包」 | **已修**（§0、§1、§6） |
| | Analyst 两次超时后没有中文解读却没有说明；复核没跑完却显示「未通过 AI 质检」；局限说明里的英文码可能经 Analyst 带到项目解读；被截止的澄清检查永久记为未解决、照样发问 | 不改：都是既有的降级路径（本次只是让它们从「被硬杀」变成「能走到」）；§6 写明可能看到的降级；另开任务（§7） |
| 时序与性能 | SDK 两次重试之间的等待不看 signal（openai 6.32.0 `retryRequest`，本机实测中止 2 秒、`retry-after: 6` → 6.06 秒返回） | 不改：调用截止到硬超时约 75 秒余量；关掉 SDK 重试会让限流时直接换 sol、改变模型用法。design Context 第 5 条原先「被计时器整体截住」的说法已改正；§7 记为观察项 |
| | 同一次调用里第二个任务不看截止（`processor.ts` 785–791、472–474），可能从 226 秒起再跑一轮不受预算约束的步骤；PERSIST 只留 5 秒余量；旧 cron 的 FINALIZE 无时限；kick 的预算起点；`processQueuedAgentRuns` 无界 | 不改：都是既有的、不在本次的重试链里，也不是这次 504 的原因（日志是同一个任务的窗口链）→ 另开任务（§7，第二个任务列为最高优先） |
| | 预算在 [80, 80 + 开销) 秒时窗口永远开不了批（门槛悬崖从 45 移到 80）；旧 cron 认领门槛 45 秒低于窗口门槛 80 秒 | 不改：生产固定 240 秒；只影响测试 / 脚本与吞吐，记入 design D8 的影响面 |
| | 虚拟时钟测试看不到 SDK 等待、预检、检查点写入耗时 | 不改：这些在 `complete` 注入口之下，属于上面的观察项；测试覆盖的是本次改动的重试链 |

## 6. 上线后

- 合并部署后，「12-01」「12-3」两个项目在项目页「AI 数字员工 · 投标分析」卡片上点「重新分析」（一键分析，走 `/api/cron/agent-runs`）。分析面板里的「重新分析当前投标文件包」走旧的自动分析管线（`/api/cron/tender-auto-analysis`），同样经 `advanceV2Analysis`、同样受本次修复保护，但不是一键分析那条路。
- 观察：Vercel 上 `/api/cron/agent-runs` 不应再出现 300 秒 504。切片开始后约 225 秒处被截止中止的请求，之后**不再**跟备用模型或重试请求，这一段以 `call_deadline` 让出；切片前段时间充裕时，主模型出错后照旧换备用（terra 0 → sol 1）、结构化层照旧再试一次，属正常。
- 可能看到的降级（以前是整个分析失败）：Analyst 两次都没在时限内完成 → 这份分析没有中文综合解读，页面回到逐条原文的视图；Analyst 复核没完成 → 横幅「部分结论未通过 AI 质检」（复核其实是没跑完，文案不准，见 §7）；澄清检查被截止 → 按保守方向照样生成澄清问题。

## 7. 没做的（另开任务或等观察）

建议另开的两个 change（会话里生成建议任务的工具超时，没能排上，以本节为准）：

1. **切片之外仍可能越过 300 秒的路径**（时序审查，最高优先）：`processQueuedWorkforceJobs(2)` 两个任务共用一个 240 秒预算，循环与轮次都不看 `executionBudget.deadlineAt`，第二个任务可能在 226 秒之后开一轮不受预算约束的步骤（如 `tender_risk_analysis` 不带超时调 `createCompletion`）；PERSIST 中文化只留 5 秒余量、其后落库事务最长 130 秒；旧 cron 的 FINALIZE 无时限；`kickQueuedWorkforceJobSlice` 的预算从被调用时刻起算；`processQueuedAgentRuns` 在 workforce 之前无界（实测约 48 秒）；OpenAI SDK 重试之间的等待不看 signal；费用预检在计时器之前。
2. **降级结果用白话说清楚**（体验审查）：局限说明里的英文错误码改中文、不说「窗口」；Analyst 两次没完成时说明为什么没有中文解读；复核没跑完与「未通过」分开；被截止的澄清检查下一切片重查（或像 D8 一样提高澄清门槛），或在问题上注明「没来得及核对文件里是否已有答案」。

另记：

- `ai.call` 的 `retryCount` 口径：结构化层的重试仍记 0（本报告 §1 写明来源）；要改成递增另开小 change。
- 门槛 80s 是按 Lucas 给的 17–73s 定的；上线后看 `call_deadline` 让出与窗口耗时分布再调。
