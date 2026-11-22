# Tasks：数字员工的一次调用守住整次调用的截止时间（FIX-15）

## 1. 测试先行

- [ ] 1.1 新增两个测试并在同一步注册（注册行都带 `NODE_ENV=test` 前缀）：
  - `src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts`：不连库，包括纯函数（门槛与退化、四类调用的发不发 / 超时 / 截止是否起作用、「被中止」的两种形态、累计次数「截断 2 次 → 没发出 1 次 → 再截断」得 3）、直接调用综合、源码断言，以 t8 综合被截止为主例；注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - `src/lib/workforce-runtime/__tests__/invocation-deadline-db.isolated.test.ts`：隔离库，包括认领与开轮门槛、t8 截止交还与接续、累计次数跨让出保留与上限、规划截止；只注册进 `scripts/test-all.sh`。

  verify：`bash scripts/check-test-registry.sh` 输出 OK；改动前的代码上运行 `NODE_ENV=test npx tsx src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts` 失败（纯函数不存在、综合请求不带超时），输出贴进报告。

## 2. 实现

- [ ] 2.1 在 `src/lib/agent-runtime-v2/flags.ts` 加门槛常量与四个纯函数：剩余时间够不够；单次模型请求发不发、超时多少、截止是否起作用（含开工门槛退为 10 秒）；一次请求是不是被中止（SDK 中止错误的实例、名为 `AbortError` 的错误都算，不看文案）；累计截断次数写回多少、要不要转为失败。verify：CI 单测「门槛与超时」「被中止」「累计次数」三组通过；`npm run typecheck` 退出码 0。
- [ ] 2.2 t8 综合（首要）：
  - `synthesis.ts`：接收预算、带超时、被截止中止或没发出时返回 continuation（`ok` 为 true）；结果类型加 continuation；注入口参数加 `timeoutMs`。
  - `adapters.ts`：理由加 `INVOCATION_DEADLINE`。
  - `executor.ts`：批路径把预算传给综合；在 `if (batchContinuation)` 之前用累计函数算次数，满 3 次转入既有失败分支；让出分支写 `evidenceJson.continuation` 时一律带上 `deadlineCuts`。

  verify：CI 单测「综合」组与隔离库「t8」「累计次数」组通过；`t5-p11-resumability.test.ts`、隔离库上的 `p0-execution-alignment.test.ts` 与 `phase2b2-final-gate.test.ts` 通过数不变。
- [ ] 2.3 规划、风险旧分支、核验：
  - `processor.ts`：把预算传给规划；规划被截止中止或没发出时跳过轮次循环、走既有交还队列，事件 payload 加 `invocationDeadline: true`，`metadata.plannerDeadlineCuts` 写进同一次带防栅栏的交还写入。
  - `planner.ts`：带超时，加仅测试用的注入口。
  - `tools.ts`：风险旧分支用 `ctx.executionBudget`，被截止中止或没发出时返回 continuation。
  - `verifier.ts` 与 `process.ts`：两处核验调用传预算，复核带超时、时间不够不发、出错仍退回确定性结论；加仅测试用的注入口。
  - G4 若选 B：三处 `createCompletion` 各加一个 `workflow` 值与对应源码断言，规格加回一条要求。

  verify：CI 单测「规划 / 风险 / 核验」组与隔离库「规划」组通过；隔离库上的 `t1b-integration.test.ts` 通过数不变；`npm run typecheck` 退出码 0。
- [ ] 2.4 `processor.ts`：
  - 认领前的 80 秒门槛（不足就停止循环，计 `skippedForBudget`，不写状态与事件）。
  - 每轮前的 60 秒门槛（结束时间片，走既有交还队列，事件 payload 加 `invocationDeadline: true`）。
  - 返回 `skippedForBudget` 与 `deadlineContinuations`。

  verify：隔离库「认领 / 开轮」组通过；隔离库上 `phase2a-*.test.ts` 通过数不变；`obs-p1-latency-self-trigger.test.ts` 通过数不变。
- [ ] 2.5 路由与自触发：
  - `api/cron/agent-runs/route.ts`：两个计数进元数据，交给自触发判定。
  - `self-trigger.ts`：判定多一个可选输入，改写注释里第 1 层的含义。
  - G2 若不接受，只做计数与元数据。

  verify：CI 单测「自触发」组通过；`obs-p1-latency-self-trigger.test.ts` 通过数不变。

## 3. 验收

- [ ] 3.1 全部门禁。verify：
  - `npm test` 与既有失败清单对照，无新增失败；
  - CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；
  - `npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS（不新增冻结区文件、不新增被禁止方向的引用）；
  - `openspec validate workforce-invocation-deadline --strict` valid；
  - `git diff origin/main -- prisma/ vercel.json` 为空。
- [ ] 3.2 写 `docs/QINGYAN_FIX-15_REPORT.md`，并更新 TASKFLOW 状态列。
  - 报告写：改前 / 改后测试输出；四类调用上限与开工门槛的依据，以及上线后用生产库事件时间差怎样复核；与今天比多调、少调、由成功变失败的三种情形；G1–G4 的拍板结果；上线后观察什么；FIX-12 报告 §6「两个项目一个一个地重新分析」不再需要；多维审查结论。
  - TASKFLOW：在「Phase F（续）— 情报串联」表新增 FIX-15 一行，状态 `[~]`，排在 FIX-12 之后，FIX-13 / FIX-17 若先合并就排在它们之后。

  verify：报告存在；`grep -n "FIX-15" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行。

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent，各审一个维度：正确性与回归、安全 / 隐私与硬纪律、规格—代码—测试一致性、使用流畅与文案，另加时序、运行时架构守卫。逐条核实后再修，重跑测试；PR 正文写「多维审查」一节。
- 合并后 `/opsx:archive workforce-invocation-deadline --yes`（独立小 PR）。
