# Tasks：招标一键分析失败后，从失败的这一步继续（FIX-20b）

前置：FIX-20 `tender-job-synthesis-degrade` 已合并；按 design G4 排在 FIX-18 之后合并。

## 1. 测试先行

- [ ] 1.1 新建两个测试，并在同一步注册。
  - 纯函数测试 `src/lib/tender-workforce/__tests__/continue-eligibility.test.ts`：design D1 七条逐条正反例、拒绝原因取第一条、旧 Job 停在综合汇总、次数上限边界。注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - 隔离库测试 `src/lib/tender-workforce/__tests__/continue-from-failed-db.isolated.test.ts`：预置第 3 步失败（带检查点）的确定性计划 Job 与「AI 分析未完成」分析记录；覆盖路由 403 / 404 / 409 / 并发、真处理器跑完、第二轮收尾与通知、卡片接口。注册进 `scripts/test-all.sh`。
  - verify：在改动前的代码上运行失败（`continue` 返回 400「未知的 action」，卡片接口没有 `continuable`），输出贴进报告；`bash scripts/check-test-registry.sh` 输出 OK。

## 2. 实现

- [ ] 2.1 `src/lib/tender-workforce/trigger-service.ts`：可继续判定（design D1，纯函数加只读查询，含文件指纹重算），状态投影加 `continuable`。verify：`continue-eligibility.test.ts` 全过；隔离库测试的卡片接口用例通过；`t1b-integration.test.ts` 通过数不变。
- [ ] 2.2 同文件新增继续动作（design D2）。
  - 一个事务里三处条件更新：Job、失败步骤、分析记录。
  - Job 元数据的继续次数加 1。
  - 提交后写 `job.resumed` 事件与审计 `tender.workforce.continued`。
  - verify：隔离库测试的四组用例通过：已完成步骤不再执行、第 3 步从检查点续跑、并发只成功一次、同一条分析记录进入待审阅；`phase2c1-pause-resume.test.ts`、`t5-p11-resumability.test.ts` 通过数不变；`git diff origin/main -- src/lib/workforce-runtime/resume.ts` 为空。
- [ ] 2.3 `src/app/api/projects/[id]/tender-analysis/agent/route.ts`：新 action `continue`，返回码按规格。`src/components/tender-analysis/agent-card.tsx`：可继续时显示主按钮「从失败的这一步继续」，「重新分析」降为次按钮。verify：隔离库测试的 403 / 404 / 409 用例通过；`job-failure-surfacing.test.ts` 卡片源码断言（两个按钮、既有断言不改）通过；`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0；本地截图（可继续的卡片、继续后回到「AI 分析中」）贴进报告。
- [ ] 2.4 按轮收尾与通知（design D6）。
  - `job-failure-surfacing.ts` 读继续次数与可继续判定，经 `analysis-run-service.ts` 传给 `alerts.ts` 的失败通知。
  - 第 n 轮的去重键带 `r{n}`；可继续时改末句。
  - verify：`NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing-db.isolated.test.ts`（同一轮重放仍一条）与 `continue-from-failed-db.isolated.test.ts`（继续后再停下，共两条审计、两条通知；末句）全过；`alerts.test.ts` 通过数不变。

## 3. 验收

- [ ] 3.1 全部门禁。verify：
  - `npm test` 与既有失败清单对照，无新增失败；
  - CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；
  - `npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS（没有新的队列 / 调度登记）；
  - `openspec validate tender-job-continue-from-failed --strict` valid；
  - `git diff origin/main -- prisma/ vercel.json` 为空。
- [ ] 3.2 写 `docs/QINGYAN_FIX-20b_REPORT.md`，并更新 TASKFLOW 状态列（新增 FIX-20b 一行，`[~]`）。报告写：可继续判定的七条与拒绝原因、改前 / 改后测试输出、与 FIX-20 和 FIX-18 的合并顺序、「12-3」上线后点继续的结果（待生产实测补）、多维审查结论。verify：报告存在；`grep -n "FIX-20b" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行。

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent，维度：正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案，外加「权限」（继续与重新分析同口径、跨项目 Job）与「并发」（两个继续、继续与定时认领同时发生）。逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- 合并后 `/opsx:archive tender-job-continue-from-failed --yes`（独立小 PR）。
