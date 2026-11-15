# Tasks：报价表助手保存不再冲掉报价引擎镜像的我方报价（FIX-8）

## 1. 测试先行

- [x] 1.1 新增隔离库测试 `src/lib/tender-pricing/__tests__/pricing-helper-save-db.isolated.test.ts`：用 `writeBidMirrorsTx` / `writePendingMirrorsTx` 镜像报价，调真实路由保存；verify：在改动之前的代码上失败（17 项里 5 项失败）

## 2. 修复

- [x] 2.1 保存分支写 `{ ...原 pricingInputs, ...inputs }`，原值不是对象时当空对象；返回形状不变；verify：`npx tsx src/lib/tender-pricing/__tests__/pricing-helper-save-db.isolated.test.ts` 17 项全部通过（本地隔离库），`npx tsx src/lib/tender-pricing/__tests__/pricing-helper.test.ts` 照旧通过

## 3. 测试注册与验收

- [x] 3.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [x] 3.2 全部门禁；verify：`npm test` 无新增失败、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`openspec validate pricing-helper-save-keeps-bid-mirror --strict` valid
- [x] 3.3 TASKFLOW 加 FIX-8 一行；verify：TASKFLOW 里有 FIX-8 一行，状态 `[~]`（合并后 archive 时改为实际值）
