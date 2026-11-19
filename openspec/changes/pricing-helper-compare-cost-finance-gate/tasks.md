# Tasks：报价表助手的比价落地价只给有财务查看权的人（FIX-12）

## 1. 测试先行

- [ ] 1.1 新增隔离库测试 `src/lib/tender-pricing/__tests__/compare-cost-finance-gate-db.isolated.test.ts`（真实路由 + 真实授权表：项目负责人、`accounting` 只读成员、`bids` 只读成员、`bids` 项目管理员；读取、带声明保存、只改毛利、改选后的过时提示、开关关闭），并在同一 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：在改动前的路由上跑，「没有财务查看权」的几项失败、其余通过（记下失败数）；`bash scripts/check-test-registry.sh` 输出 OK

## 2. 修复

- [ ] 2.1 比价建议加「受限」状态与说明文字，过时提示对它返回空；「来自比价矩阵」一行对它只显示说明；`compare-cost-source.test.tsx` 补纯函数与呈现断言（只有说明、没有金额 / 按钮 / 来源 / 过时提示）；verify：`npx tsx src/lib/tender-pricing/__tests__/compare-cost-source.test.tsx` 全部通过，`npm run typecheck` 退出码 0
- [ ] 2.2 路由：开关开启时 GET 与 POST save 各求一次财务查看权；没有的人 GET 给受限的一项（不取数、来源与过时提示为空），save 不采信声明、响应不带 `ourCostSource`；同步更新 `compare-cost-source.test.tsx` 里对这个路由的源码断言；verify：`compare-cost-finance-gate-db.isolated.test.ts` 全部通过（连跑 3 次），`compare-cost-source-db.isolated.test.ts`、`pricing-helper-save-db.isolated.test.ts`、`pricing-helper-lock-db.isolated.test.ts`、`pricing-helper.test.ts` 照旧通过
- [ ] 2.3 变异核对：分别去掉 GET 的判定、save 的声明判定、save 响应的判定；verify：每一种变异下 `compare-cost-finance-gate-db.isolated.test.ts` 都有对应项重新失败，还原后全部通过

## 3. 门禁与报告

- [ ] 3.1 全部门禁；verify：`npm test`（本机隔离库）没有 main 上之外的失败、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/check-test-registry.sh` OK、`openspec validate pricing-helper-compare-cost-finance-gate --strict` valid
- [ ] 3.2 写 `docs/QINGYAN_FIX-12_REPORT.md`（改了什么、测试结果与变异核对、留下的口子：已保存的我方成本、询价区比价矩阵、Muse 决定 A）+ 更新 TASKFLOW：`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 加 FIX-12 一行；verify：报告存在，TASKFLOW 里有 FIX-12 一行、状态 `[~]`

## Workflow follow-up

- 开 PR（一个 change = 一个 PR），经 Evan 拍板合并。
- 合并后 `/opsx:archive pricing-helper-compare-cost-finance-gate --yes`，独立小 PR；同步把 TASKFLOW 的 FIX-12 状态改成实际值，并确认 `openspec list --specs` 里 `tender/pricing-compare-cost-source` 的要求数变为 7。
