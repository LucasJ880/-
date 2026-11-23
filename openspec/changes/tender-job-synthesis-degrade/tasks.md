# Tasks：综合汇总没做出来不再扣住招标分析结果，受阻时说清原因与重试（FIX-20）

前置：GATE G1（生产 SQL）的结果已贴进 design「生产实测」。

## 1. 测试先行

- [x] 1.1 新建两个测试，并在同一步注册。
  - 纯函数测试 `src/lib/workforce-runtime/__tests__/step-failure-visibility.test.ts`，覆盖 design「验证方式」第一组：归类规则、降级判定、交接数据的话、重试投影（含重试中让出后）、停止原因新规则与计算时机、`synthesisNotGenerated` 投影、源码断言。注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - 隔离库测试 `src/lib/tender-workforce/__tests__/synthesis-degrade-db.isolated.test.ts`：预置 t1–t7 已完成的确定性计划 Job，第 8 步用测试注入口抛「429 You exceeded your current quota, please check your plan and billing details」，用真处理器驱动；另有中断回收、第 3 步失败、契约损坏三组。注册进 `scripts/test-all.sh`。
  - verify：在改动前的代码上运行，余额不足用例失败（第 9 步待开始、Job `needs_human` / `blocked_graph`、原因「前置步骤没有完成」），把输出贴进报告；`bash scripts/check-test-registry.sh` 输出 OK。

## 2. 实现

- [x] 2.1 写入侧的归类与痕迹。
  - `src/lib/workforce-runtime/constants.ts`：加错误码常量、归类规则（design D5）、降级判定（D3），保持零依赖（D6）。G1 的结果若显示余额不足的原文不是现有写法，把那段原文加进规则。
  - `executor.ts` 批量路径的失败分支（`:1661-1690`）：还会重试与最终失败两种情况都写归类后的错误码，`tool.failed` 事件同码。
  - `executor.ts` 批量路径的让出分支（`:1615-1650`）：重试那次认领让出时保留错误码，`if (batchContinuation)` 到 `completedAt: null` 之间不加字符（D8）。
  - `processor.ts` 回收段（`:251-261`）：写 `stale_running_recovered` 与不对用户显示的 `step.ready` 事件。
  - verify：`step-failure-visibility.test.ts` 的归类、回收、让出用例通过；`npx tsx src/lib/tender-workforce/__tests__/t5-p11-resumability.test.ts` 通过数不变；`phase2b2-final-gate.test.ts`、`phase2a-stale-worker.test.ts` 通过数不变。
- [x] 2.2 综合汇总降级与第 9 步。
  - `executor.ts` 每轮开头（`:234-249` 之间）按 D2 降级：条件更新、命中才写 `step.completed` 事件；交接数据收不齐时保持失败。
  - `handoff.ts` 跳过综合汇总时的摘要与警告（`:367-370`、`:460-462`）。
  - `tools.ts` 第 9 步按 D4：先判 canonical V2，再处理综合结果可选。
  - verify：隔离库测试的余额不足、中断回收、第 3 步失败、契约损坏、canonical 摘要逐字节不变、依赖里什么都没有，这六组全过；`t5-seg3-v2-convergence.test.ts`、`p0-execution-alignment.test.ts`、`phase2b1-task-handoff.test.ts` 通过数不变。
- [x] 2.3 读模型。
  - `stop-reason.ts`：新码；失败步骤只用自己的码，非失败步骤只用 Job 的码（D9）。
  - `projection.ts`：按 D10 的条件算停止原因，加重试投影与 `synthesisNotGenerated`（D8、D11，后者只对招投标服务端计划）。
  - `types.ts`；`service.ts` 步骤查询多取 `attemptCount`、`maxAttempts`。
  - 投影与停止原因里不出现 `errorMessage`。
  - verify：`npx tsx src/lib/workforce-runtime/read-model/__tests__/stop-reason.test.ts` 全过（含新场景、既有源码断言与 `:92-95` 两条）；`projection-golden.test.ts`、`list-service.test.ts`、`service-read-only.test.ts` 通过数不变。
- [x] 2.4 收尾与通知（`job-failure-surfacing.ts`）。
  - 原因顺序改为：具体码 → 已知标记 → 笼统码 → 执行出错；已知标记里余额不足排第一，从 `constants.ts` 取同一份识别规则。
  - 写进分析记录的错误码取失败步骤的。
  - verify：`npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts` 与 `NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing-db.isolated.test.ts` 全过。场景包括：分析记录与 `[tender-alert]` 的码为 `model_quota_exhausted`；三处原因一字不差；通知不含 `quota` 与「前置步骤没有完成」。
- [x] 2.5 界面。
  - `src/app/(main)/workforce/[id]/page.tsx`：进度一节写受阻原因与重试句，任务行写重试句，最终结果写综合汇总未生成。
  - `trigger-service.ts` 卡片接口加 `retrying`、`blockedReason`、`synthesisNotGenerated`。
  - 项目卡片：进行中那一行与待审阅那一行。FIX-18 已合并时写进 `src/lib/tender-workforce/agent-card-view.ts`，否则写在 `agent-card.tsx`。组件不自己拼原因文字。
  - verify：`operator-ux.test.ts` 与 `job-failure-surfacing.test.ts` 的源码断言通过（既有卡片断言不改；FIX-18 已合并时对它的纯函数做用例）；`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0；本地三张截图贴进报告：作业页重试中、作业页最终结果、项目卡片待审阅。

## 3. 验收

- [ ] 3.1 全部门禁。verify：
  - `npm test` 与既有失败清单对照，无新增失败；
  - CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；
  - `npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` 末行 `runtime-architecture guards PASS`；
  - `openspec validate tender-job-synthesis-degrade --strict` valid；
  - `git diff origin/main -- prisma/ vercel.json src/lib/runtime-architecture/runtime-architecture-baseline.json src/lib/workforce-runtime/synthesis.ts src/components/tender-analysis/analysis-panel.tsx` 为空；`git diff origin/main --stat -- src/lib/agent-runtime-v2/` 只列出 `executor.ts`。
- [x] 3.2 写 `docs/QINGYAN_FIX-20_REPORT.md`，并更新 TASKFLOW 状态列（新增 FIX-20 一行，`[~]`）。
  - 报告 §1 写生产事实：来源是 Evan 2026-11-22 实测与 `[tender-alert]` 16:44:29 `code=blocked_graph`；抄入 design 附录的两条 SQL 与 G1 跑出的结果，按 design「四种结果」写明结论。
  - 报告还要写：改前 / 改后的测试输出；与 FIX-15、FIX-18、FIX-20b 的合并顺序与让出分支的协调；契约损坏时原因改为「执行出错」；多维审查结论。
  - verify：报告存在；`grep -n "FIX-20" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行。

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent，维度：正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案，外加「运行时共用路径」（执行器与处理器改动对销售域 Job 的影响、运行时架构门禁）。逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- 合并后 `/opsx:archive tender-job-synthesis-degrade --yes`（独立小 PR）。
