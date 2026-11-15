# Tasks：报价表助手的写入与报价同步串行（FIX-9）

## 1. 测试先行

- [x] 1.1 新增隔离库测试 `src/lib/tender-pricing/__tests__/pricing-helper-lock-db.isolated.test.ts`：报价同步在 `lockProject` 下写镜像、先不提交，这期间调真实路由保存 / 推导；verify：在改动之前的代码上失败（17 项里 4 项失败，连跑 3 次相同）

## 2. 修复

- [x] 2.1 导出 `lockProject`（`src/lib/quote-engine/tender-bid.ts`，行为不变）；verify：`npx tsx src/lib/quote-engine/__tests__/quote-ops-contract.test.ts` 照旧通过
- [x] 2.2 路由的保存与推导改为「事务 → 锁项目行 → 重读 → 在最新值上算 → 写回」，保存的计算抽成纯函数，模型调用留在锁外；verify：`pricing-helper-lock-db.isolated.test.ts` 17 项全部通过（连跑 3 次），`pricing-helper-save-db.isolated.test.ts` 17 项、`pricing-helper.test.ts` 照旧通过
- [x] 2.3 变异核对：去掉锁调用；verify：`pricing-helper-lock-db.isolated.test.ts` 重新失败 4 项
- [x] 2.4 与 FLOW-H2（#476）的成本来源合在一起：rebase 到含 #476 的 main 后照原样保留来源逻辑，比价取数在锁外；verify：`compare-cost-source.test.tsx` 83 项、`compare-cost-source-db.isolated.test.ts` 42 项照旧通过；`pricing-helper-lock-db.isolated.test.ts` 在 main 的路由上失败 4 项、改动后全部通过

## 3. 测试注册与验收

- [x] 3.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [x] 3.2 全部门禁；verify：`npm test` 无新增失败、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`openspec validate pricing-helper-write-lock --strict` valid
- [x] 3.3 TASKFLOW 加 FIX-9 一行；verify：TASKFLOW 里有 FIX-9 一行，状态 `[~]`
