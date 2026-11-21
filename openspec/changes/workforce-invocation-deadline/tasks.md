# Tasks：数字员工的一次调用守住整次调用的截止时间（FIX-15）

## 1. 测试先行

- [ ] 1.1 新测试 `src/lib/workforce-runtime/__tests__/invocation-deadline.test.ts`（注入时钟与慢模型，覆盖规格全部场景），同一步注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：在改动前的代码上运行失败（第二个任务被认领、综合请求不带超时），输出贴进报告；`bash scripts/check-test-registry.sh` 输出 OK

## 2. 实现

- [ ] 2.1 `processor.ts`：认领前检查（不足 60 秒停止循环，返回未认领数量）与每轮前检查（不足 60 秒结束时间片，走既有交还队列）；verify：1.1 里「不再认领」「不开新一轮」两组场景通过，`phase2a-*.test.ts` 通过数不变
- [ ] 2.2 把 `executionBudget` 传到规划与核验（`process.ts` / `executor.ts`），四处模型调用加超时（min(上限, 剩余 − 15 秒)，最短 10 秒；不带预算时不变）；verify：1.1 里「模型调用不越过截止」两组场景通过，`npm run typecheck` 退出码 0
- [ ] 2.3 四处调用被本次的计时器中止时走交还队列（不计失败、不消耗尝试次数），其它错误走既有分支；verify：1.1 里「被截断交还队列」「模型返回 400」两组场景通过
- [ ] 2.4 `api/cron/agent-runs/route.ts`：自触发条件加上「有未认领」；verify：1.1 里「有未认领、没有让出」场景通过，`obs-p1-latency-self-trigger.test.ts` 通过数不变

## 3. 验收

- [ ] 3.1 全部门禁；verify：`npm test` 与既有失败清单对照无新增失败；CI 环境变量下 `bash scripts/test-ci-unit.sh` 末行 `CI unit subset PASS`；`npm run lint:baseline` PASS；`bash scripts/test-runtime-architecture.sh` PASS；`openspec validate workforce-invocation-deadline --strict` valid；`git diff origin/main -- prisma/ vercel.json` 为空
- [ ] 3.2 写 `docs/QINGYAN_FIX-15_REPORT.md`（改前 / 改后测试输出、四处超时上限的依据、上线后观察什么、多维审查结论）+ 更新 TASKFLOW 状态列（新增 FIX-15 一行，`[~]`）；verify：报告存在，`grep -n "FIX-15" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行

## Workflow follow-up

- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent（正确性与回归、安全 / 隐私与硬纪律、规格—代码—测试一致性、使用流畅与文案，另加时序），逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- 合并后 `/opsx:archive workforce-invocation-deadline --yes`（独立小 PR）。
