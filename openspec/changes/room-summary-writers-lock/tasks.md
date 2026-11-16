# Tasks：调查室 summaryJson 的其它写入方改走写入入口，并加守卫（FIX-11）

## 1. 测试先行

- [x] 1.1 隔离库测试 `src/lib/tender-room/__tests__/room-summary-writers-db.isolated.test.ts`（跟标抓取期间同步提交 / 停止盯梢、投标工作区 vs. 先读后写的同步、确认竞争对手与停止盯梢 vs. 未提交的同步）；verify：在 FIX-10 的代码上 14 项里 7 项失败（含 `40P01 deadlock detected`）
- [x] 1.2 守卫测试 `src/lib/tender-room/__tests__/summary-write-guard.test.ts`；verify：在 FIX-10 的代码上失败（列出 7 个文件的直接写入）

## 2. 迁移

- [x] 2.1 跟标：`tender-intel/watch.ts`（盯梢已停掉就不写不通知）、`tender-watch/route.ts`（设置 / 停止）
- [x] 2.2 外部情报：`tender-intel/orchestrate.ts`（状态与结果；报价模型按最新值判断）、`external-intel/award-history/route.ts`（竞争对手、授标确认，事务里先锁项目行）
- [x] 2.3 投标草稿 `tender-bid-draft/generate.ts`、分析备忘 `tender-analyst-memo/v2/pipeline.ts`
- [x] 2.4 投标工作区 `tender-bid-workspace/store.ts` 改锁项目行；verify：隔离库测试 14 项全部通过（连跑 3 次），守卫通过；这几个模块已注册的 29 个测试照旧通过

## 3. 测试注册与验收

- [x] 3.1 两个新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [x] 3.2 全部门禁；verify：`npm test` 无新增失败、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate room-summary-writers-lock --strict` valid
- [x] 3.3 TASKFLOW 加 FIX-11 一行；verify：状态 `[~]`
