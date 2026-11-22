# Tasks：招标一键分析失败后，从失败的这一步继续（FIX-20b）

前置：FIX-20 `tender-job-synthesis-degrade` 与 FIX-18 `tender-analysis-single-entry` 已合并（design G6）。

## 1. 测试先行

- [ ] 1.1 新建两个测试，并在同一步注册。
  - 纯函数测试 `src/lib/tender-workforce/__tests__/continue-eligibility.test.ts`：design D1 八条逐条正反例、拒绝原因取第一条且九句逐字、旧 Job 停在综合汇总、「失败」状态不可继续、继续次数与执行次数的边界、源码断言（判定文件不连库，`trigger-service.ts` 不直接写 Job 与步骤）。注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - 隔离库测试 `src/lib/tender-workforce/__tests__/continue-from-failed-db.isolated.test.ts`：预置第 3 步失败（带检查点）的确定性计划 Job 与「AI 分析未完成」分析记录；覆盖路由 400 / 403（只读、开关）/ 404 / 409、两次继续并发、继续与重新分析并发、旧管线在跑、真处理器跑完、第二轮收尾与通知、第三次被拒、截断次数被清、卡片接口。注册进 `scripts/test-all.sh`。
  - verify：在改动前的代码上运行失败（`continue` 返回 400「未知的 action」，卡片接口没有 `continuable`），输出贴进报告；`bash scripts/check-test-registry.sh` 输出 OK。

## 2. 实现

- [ ] 2.1 可继续判定（design D1、D7）。
  - 新文件 `src/lib/tender-workforce/continue-eligibility.ts`：纯函数，执行失败码集合取自 `src/lib/workforce-runtime/constants.ts`。
  - `trigger-service.ts`：读出判定所需的数据（含文件指纹重算、审计条数），状态投影加 `continuable`（判定成立且当前用户 `canStart`）。
  - verify：`npx tsx src/lib/tender-workforce/__tests__/continue-eligibility.test.ts` 全过；隔离库测试的卡片接口用例通过；`t1b-integration.test.ts` 通过数不变。
- [ ] 2.2 继续动作（design D2、D3）。
  - `src/lib/workforce-runtime/resume.ts` 新增独立导出函数：一个事务里做 Job 与失败步骤的条件重置、写恢复事件，并调用两段域回调；`resumeWorkforceJob` 不改。
  - `trigger-service.ts` 提供域回调：拿项目锁与锁内复查；分析记录改回分析中；事务内写审计 `tender.workforce.continued`。
  - verify：隔离库测试的五组用例通过：已完成步骤不再执行、第 3 步从检查点续跑、两次继续并发只成功一次、继续与重新分析并发后只有一单在跑、同一条分析记录进入待审阅；`phase2c1-pause-resume.test.ts`、`t5-p11-resumability.test.ts` 通过数不变；`bash scripts/test-runtime-architecture.sh` 末行 `runtime-architecture guards PASS`。
- [ ] 2.3 入口与卡片（design D4、D5）。
  - `src/app/api/projects/[id]/tender-analysis/agent/route.ts`：新 action `continue`，先过 `canStart`，返回码按规格。
  - 卡片：可继续时显示主按钮「从失败的这一步继续」，「重新分析」降为次按钮（写在 FIX-18 的 `agent-card-view.ts`）；继续成功后清掉 `agent-card.tsx` 的「已通知结束」记号。
  - verify：隔离库测试的 400 / 403 / 404 / 409 用例通过；`job-failure-surfacing.test.ts` 卡片用例（两个按钮、继续后清记号、既有断言不改）通过；`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0；本地截图（可继续的卡片、继续后回到「AI 分析中」、跑完后面板已刷新）贴进报告。
- [ ] 2.4 按轮收尾与通知（design D6）。
  - `job-failure-surfacing.ts` 按审计条数算轮次，在改记录之前判可继续，经 `analysis-run-service.ts` 传给 `alerts.ts` 的失败通知。
  - 第 n 轮的去重键带 `r{n}`；可继续时改末句。
  - verify：`NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing-db.isolated.test.ts`（同一轮重放仍一条）与 `continue-from-failed-db.isolated.test.ts`（继续后再停下，共两条审计、两条通知；末句）全过；`alerts.test.ts` 通过数不变。

## 3. 验收

- [ ] 3.1 全部门禁。verify：
  - `npm test` 与既有失败清单对照，无新增失败；
  - CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；
  - `npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS；
  - `openspec validate tender-job-continue-from-failed --strict` valid；
  - `git diff origin/main -- prisma/ vercel.json src/lib/runtime-architecture/runtime-architecture-baseline.json src/lib/agent-runtime-v2/ src/lib/workforce-runtime/processor.ts` 为空。
- [ ] 3.2 写 `docs/QINGYAN_FIX-20b_REPORT.md`，并更新 TASKFLOW 状态列（新增 FIX-20b 一行，`[~]`）。报告写：可继续判定的八条与九句拒绝原因、改前 / 改后测试输出、与 FIX-20 和 FIX-18 的合并顺序、「12-3」上线后点继续的结果（待生产实测补）、多维审查结论。verify：报告存在；`grep -n "FIX-20b" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行。

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent，维度：正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案，外加「权限」（继续与重新分析同口径、`canStart`、跨项目 Job、以谁的身份执行）与「并发」（两个继续、继续与重新分析、继续与定时认领、继续与旧管线）。逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- 合并后 `/opsx:archive tender-job-continue-from-failed --yes`（独立小 PR）。
