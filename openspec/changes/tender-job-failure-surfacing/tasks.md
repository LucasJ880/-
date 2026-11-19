# Tasks：招标分析失败立刻告诉人（CHAIN-0c）

开工前跑一遍要触碰模块的已注册测试并记下基线（`workforce-runtime` 与 `tender-workforce` 的纯函数测试、`alerts` 相关测试、`operator-ux`，隔离库里与 workforce 处理器相关的），写进报告。

## 1. 原因与收尾

- [x] 1.1 新增 `src/lib/workforce-runtime/read-model/stop-reason.ts`（错误码 → 中文、停在哪一步、整句拼装，纯函数）与 `src/lib/tender-workforce/job-failure-surfacing.ts`（叠加招投标已知标记的纯函数 + `surfaceTenderJobStopped` 收尾服务：调既有 `failWorkforceTenderAnalysisRun`，`updated` 时写审计）；新增 `src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts` 并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts` 全部通过
- [x] 1.2 新增 `src/lib/workforce-runtime/domain-hooks.ts`，`processor.ts` 在 slice 结果为失败 / 需要人工处理且未丢租约时、清扫写失败后调用（try/catch，不改返回值）；`tender-auto-analysis/alerts.ts` 摘要带原因、补 Job 错误码；verify：`npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts` 的源码断言通过，既有 alerts / processor 相关测试不改期望值通过

## 2. 显示

- [x] 2.1 读模型：步骤快照带 `errorCode`，详情视图 `stopReason`，`needsYou.detail` 兜底；详情页「任务未能完成」卡与「系统未记录原因」；新增 `src/lib/workforce-runtime/read-model/__tests__/stop-reason.test.ts` 并注册；verify：该测试通过，`src/app/(main)/workforce/__tests__/operator-ux.test.ts` 与既有 read-model 测试通过
- [x] 2.2 `trigger-service.ts` 的 `latestAnalysisRun.failureReason` 与 `agent-card.tsx` 显示原因；verify：`job-failure-surfacing.test.ts` 的卡片源码断言通过，`npm run typecheck` 通过

## 3. 端到端与收尾

- [x] 3.1 新增隔离库 `src/lib/tender-workforce/__tests__/job-failure-surfacing-db.isolated.test.ts`（needs_human 与 failed 两条路径、两人各一条通知、审计一条、重放不重复、非招投标不触发、已待审阅不改、清扫路径、项目卡片接口带原因）并注册；verify：本机隔离库全部通过
- [ ] 3.2 全量门禁：`npm test`（与 main 对照失败名单）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-job-failure-surfacing --strict`；`git diff --stat main -- prisma/ vercel.json` 为空；verify：输出写进报告
- [ ] 3.3 写 `docs/QINGYAN_CHAIN-0c_REPORT.md` + 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` CHAIN-0c 状态列；verify：两个文件在 PR diff 里

## Workflow follow-up

- `/opsx:verify` → 交叉审查 → PR → 合并 → `/opsx:archive tender-job-failure-surfacing --yes`（独立小 PR）。
- 生产上拿到「12-01 21C31-254242」的 AgentRun 错误码与事件后，把实际走的路径补进报告复现段。
