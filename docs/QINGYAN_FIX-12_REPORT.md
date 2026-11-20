# FIX-12 报告：招标分析切片的模型调用守住绝对截止时间

| 项 | 值 |
|---|---|
| change | `tender-analysis-call-deadline`（新能力 `tender/analysis-slice-budget`，8 条要求） |
| TASKFLOW | FIX-12（Phase F（续）— 生产实测修复，2026-11-20） |
| 来源 | Lucas 2026-11-20 生产实测「12-3 Indoor Canadian Flag」（Job 09:27 创建）：一键分析第 3 步 09:46:29、09:54:29 两次 504「Task timed out after 300 seconds」；11-19「12-01」Job 的「长时间没有进展」（`stale_running_exhausted`）同一根因 |
| 拍板 | 四件套 Lucas 2026-11-20 同意；截止失败计入 3 次上限同意；窗口门槛 45 → 80 秒为 Lucas 建议、本次采纳（design D8） |
| PR | Draft，见 TASKFLOW |
| 分支 | `claude/amazing-planck-0s5wnb` |
| 性质 | 修既有的超时链。零 schema、零新模型调用（只会少调）、没有出站。**没有开关——合并即生效** |

## 1. 时间线与来源

日志 t = 本次调用开始；切片预算 240 秒（`AGENT_RUNS_INVOCATION_BUDGET_MS`），平台硬超时 300 秒。

| 时刻 | 调用 | 来源（已核对代码） |
|---|---|---|
| t+190s | 一批窗口，terra，retryCount 0，超时 35.3s | `advanceV2Analysis` WINDOWS 批次：剩 50.3s ≥ 45s 门槛，`callTimeoutFor(50.3s) = 35.3s` |
| t+225s | 两路「Request was aborted」 | `createCompletionDetailed` 的本方计时器；`classifyModelError` 因含 `aborted` 判为 retryable |
| t+225s → t+260s | sol，retryCount 1，35.3s | `createTenderCompletion` 的 fallback（terra 不是 Astra，没有 retry_same），**沿用同一个 `timeoutMs`** |
| **t+260s → t+295s** | **terra，retryCount 0，35.3s** | **`callStructured`（`tender-understanding/llm.ts`）的「transient 只额外重试一次」**：invoker 抛错后整条链再调一遍；钉住的模型仍是 terra（`createPinnedTenderInvoker` 只在备用**成功**后才换模型），`retryCount` 缺省 0 |
| t+295s → | sol（再一次 fallback） | 同上；t+300s 被硬杀，这一批没写检查点 |

一次窗口调用最坏 = 2（结构化层）× 2（主 + 备）× 超时。超时按剩余预算裁过，乘 4 就越过截止。Analyst 同理：本机复现 Analyst 第一遍最坏到 t+897s。

## 2. 做了什么

1. **绝对截止时间贯穿全链**：每个阶段开工时算 `callDeadlineAt = now + callTimeoutFor(remaining)`（= 切片截止 − 15s，最短 1s），经阶段函数 → `callStructured` → 钉住模型的 invoker → `createTenderCompletion`；每一次请求（首调、同模型重试、换备用、结构化重试、瞬时错误重试）在发起那一刻取 `min(阶段上限, 截止 − now)`。
2. **截止即停**：剩余 < 1s 不发请求；一次请求失败后剩余 < 5s（本方截止中止必然落在这里）不重试、不换模型，抛 `TenderCallDeadlineError`（`code = CALL_DEADLINE_EXCEEDED`，文案不含 timeout / aborted，任何一层都不会判为可重试）；`callStructured` 认这个错误直接返回，不做 transient 重试；结构化层的第二次尝试带 `retry` 标记，剩余 < 5s 时 invoker 不发。
3. **截止即让出**：窗口批次 / 澄清 / Analyst 任一遍拿到 `CALL_DEADLINE_EXCEEDED` → 按既有语义记下（窗口 attempts + 1、澄清记未解决、Analyst 失败次数 + 1）→ 写检查点 → 以 `call_deadline` 让出。
4. **中文化**：`translateRequirementTexts` 把它已有的总预算截止放进每批请求。
5. **窗口门槛 45s → 80s**（design D8）：生产单次窗口 17–73s，45s 门槛下最短超时 30s；80s 时最短 65s。t+190s 剩 50s 的那一批现在不开，直接让出。
6. **测试注入口**：`createTenderCompletion` / `createPinnedTenderInvoker` 可选 `now`、`complete`，缺省即原实现。

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

**改后**——31 / 31：

```
· SD-01 让出于 225.0s，理由 call_deadline，请求 9 次
· SD-03 让出于 190.0s，理由 budget_remaining_ms=50000，请求 6 次
· SD-04 让出于 225.0s；备用请求 p7 215.0s timeout=10.0s，p8 215.0s timeout=10.0s，p9 215.0s timeout=10.0s
· SD-05 让出于 225.0s（CLARIFY/call_deadline）；澄清请求 主 150.0s timeout=60.0s，备 210.0s timeout=15.0s
· SD-06 让出于 225.0s（ANALYST_A/call_deadline）；Analyst 请求 主 1.0s timeout=224.0s
通过 31，失败 0
```

| 测试 | 开工前 | 结束 |
|---|---|---|
| `v2-slice-deadline.test.ts`（新） | — | 31 |
| `model-policy/__tests__/tender.test.ts` | 39 | 53（DL-01…DL-09） |
| 改动涉及模块的其余 26 个已注册测试（model-policy 9 个、tender-understanding 5 个、v2-resumable、worker-budget-guards、t5-p11 / seg2 / seg3、analyst-synthesis、memo-v2、analyst-memo-v1、bid-draft、pricing-helper、rfi-export、bid-fit-usability、search-brief） | 全过 | 全过，通过数不变 |

## 4. 门禁

（见下方，跑完后填）

## 5. 多维审查

（见下方，审查后填）

## 6. 上线后

- 合并部署后，「12-01」「12-3」两个项目在项目页点「重新分析」。
- 观察：Vercel 上 `/api/cron/agent-runs` 不应再出现 300 秒 504；`ai.call` 日志里一个窗口最多一次主模型请求后就让出（`call_deadline`），不再有 terra 0 → sol 1 → terra 0 的连续段。

## 7. 没做的（另开任务或等观察）

- `ai.call` 的 `retryCount` 口径：结构化层的重试仍记 0（本报告 §1 写明来源）；要改成递增另开小 change。
- `kickQueuedWorkforceJobSlice` 的预算从被调用时刻起算，不从 HTTP 请求开始（只在路由层调用，与本次 504 无关）。
- 门槛 80s 是按 Lucas 给的 17–73s 定的；上线后看 `call_deadline` 让出与窗口耗时分布再调。
