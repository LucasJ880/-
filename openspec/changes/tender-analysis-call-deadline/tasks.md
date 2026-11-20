# Tasks：招标分析切片的模型调用守住绝对截止时间（FIX-12）

## 1. 注入口与回归测试先行

- [x] 1.1 `createTenderCompletion` / `createPinnedTenderInvoker` 加可选注入口 `now`（缺省 `Date.now`）与 `complete`（缺省 `createCompletionDetailed`），不改任何判定；新建 `src/lib/tender-auto-analysis/__tests__/v2-slice-deadline.test.ts`（虚拟时钟调度器 + 慢模型；生产时间线：240 秒预算、两批各 95 秒、第三批 t+190s 起），同一步注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：在只有注入口的代码上运行，慢模型用例与生产时间线用例都失败（让出时刻 435s / 330s > 255s，且中止后出现 sol / terra 重试请求），输出贴进报告；`bash scripts/check-test-registry.sh` 输出 OK

## 2. 截止时间贯穿调用链

- [x] 2.1 `src/lib/ai/model-policy/tender.ts`：请求带 `deadlineAt` 时每次请求超时取 `min(timeoutMs, deadlineAt − now)`；剩余 < 0.5s 不发请求；可重试的失败后剩余 < 5s 抛带 `code = "CALL_DEADLINE_EXCEEDED"` 的截止错误、不进 `decideTenderRecovery`；不带 `deadlineAt` 时逐字节旧行为；`tender.test.ts` 补用例（截止中止零重试、剩余充足照旧换备用且超时 ≤ 剩余、无截止时备用超时 = 原超时）；verify：`npx tsx src/lib/ai/model-policy/__tests__/tender.test.ts` 全过
- [x] 2.2 `src/lib/tender-understanding/llm.ts`：`LlmCallRequest.deadlineAt`；`callStructured` 遇截止错误记日志、以 `CALL_DEADLINE_EXCEEDED` 返回、不做 transient 重试；钉住模型的 invoker 透传 `deadlineAt`；`runExtractionWindow` / `resolveClarificationItem` / `runAnalystPassA|B` 透传；`translateRequirementTexts` 把它的截止时间放进每批请求；verify：`input-completeness.test.ts`、`tender-org-propagation.test.ts`、`v2-resumable.test.ts` 照旧通过，`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0
- [x] 2.3 `src/lib/tender-auto-analysis/v2-resumable.ts`：每个阶段开工时算 `callDeadlineAt = now + callTimeoutFor(remaining)` 传下去；窗口批次 / 澄清 / Analyst 任一拿到 `CALL_DEADLINE_EXCEEDED` → 按既有语义记下 → 写检查点 → 以 `call_deadline` 让出；verify：`v2-slice-deadline.test.ts` 的截止用例全过（慢模型让出 ≤ 255s 且 = 225s、中止后零重试、窗口失败 1 次、下一切片重跑、Analyst / 澄清撞截止、中文化带截止），`t5-p11-resumability.test.ts` 照旧通过
- [x] 2.4 `src/lib/tender-auto-analysis/v2-cursor.ts`：`V2_PHASE_MIN_MS.WINDOWS` 45s → 80s（design D8）；`v2-slice-deadline.test.ts` 补「剩余 50 秒不开新批 / 剩余 85 秒照常开批、超时 70 秒」，生产时间线用例按 80 秒门槛断言 t+190s 让出、零裁短；verify：`v2-slice-deadline.test.ts`、`v2-resumable.test.ts`、`worker-budget-guards.test.ts`、`t5-p11-resumability.test.ts`、`t5-seg2-v2-spine.test.ts`、`t5-seg3-v2-convergence.test.ts` 全过

## 3. 验收

- [ ] 3.1 全部门禁；verify：`npm test` 与既有失败清单（`docs/QINGYAN_CHAIN-3_REPORT.md` §4）对照无新增失败；CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；`npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS；`openspec validate tender-analysis-call-deadline --strict` valid；`git diff origin/main -- prisma/ vercel.json` 为空
- [ ] 3.2 写 `docs/QINGYAN_FIX-12_REPORT.md`（时间线与来源、改前 / 改后测试输出、多维审查结论）+ 更新 TASKFLOW 状态列（新增 FIX-12 一行，`[~]`）；verify：报告存在，`grep -n "FIX-12" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent（正确性与回归、安全 / 隐私与硬纪律、规格—代码—测试一致性、使用流畅与文案、性能与时序），逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- Draft PR 合并后 `/opsx:archive tender-analysis-call-deadline --yes`（独立小 PR，至少一个子 agent 核对主规格与 delta、TASKFLOW 状态）。
