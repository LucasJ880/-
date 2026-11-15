# Tasks：报价表助手的保存与推导和报价引擎串行（FIX-9）

## 1. 测试先行

- [ ] 1.1 新增隔离库测试 `src/lib/tender-pricing/__tests__/pricing-helper-lock-db.isolated.test.ts`（design D5：事务 A 持项目行锁并写镜像 / 改价待定 / 人工模型，轮询 `pg_blocking_pids` 确认路由被挡住后再提交），覆盖 spec 三条 Requirement 的全部 Scenario，并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：在 FIX-8 版本的路由上跑，镜像交错的 save 与 derive 场景失败；`bash scripts/check-test-registry.sh` 输出 OK

## 2. 修复

- [ ] 2.1 `src/lib/quote-engine/tender-bid.ts` 的 `lockProject` 加 `export`（函数体不动）；verify：`npx tsx src/lib/quote-engine/__tests__/quote-engine-contract.test.ts` 与 `quote-ops-contract.test.ts` 照旧通过
- [ ] 2.2 `save` 分支整段移入 `db.$transaction`（先 `lockProject`，事务内读房间、校验、按 FIX-8 规则合并、经 `tx` 写回；判别联合映射 409 / 400 / 200；事务选项 `{ maxWait: 5_000, timeout: 15_000 }`）；verify：新测试的 save 场景通过，`pricing-helper-save-db.isolated.test.ts` 17 项不改断言全部通过
- [ ] 2.3 `derive` 分支：模型调用与 409 / 429 / 404 判断留在事务外，写入移入同样的事务（`lockProject` → 重读房间 → 只改 `pricingDerivedAt` / `pricingModel`，人工模型按重读结果判断，返回值按重读结果给出，重读不到房间返回 409）；verify：新测试的 derive 场景全部通过
- [ ] 2.4 `src/lib/tender-pricing/__tests__/pricing-helper.test.ts` 补守卫 PH-10d：路由两条写路径都在 `$transaction` 内先 `lockProject`、经 `tx.bidIntelligenceRoom.update` 写，路由里没有 `db.bidIntelligenceRoom.update`；verify：`npx tsx src/lib/tender-pricing/__tests__/pricing-helper.test.ts` 通过，把任一分支改回 `db.` 写时 PH-10d 失败

## 3. 验收

- [ ] 3.1 全部门禁；verify：`npm test` 无新增失败、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`openspec validate pricing-helper-save-locks-project --strict` valid
- [ ] 3.2 写 `docs/QINGYAN_FIX-9_REPORT.md` + TASKFLOW 加 FIX-9 一行、状态列 `[~]`；verify：两处文件存在且 TASKFLOW 的 FIX-9 行指向本 change 与报告

## Workflow follow-up

- FIX-8（`pricing-helper-save-keeps-bid-mirror`）先合并、先归档；本 change 合并后再 `/opsx:archive pricing-helper-save-locks-project --yes`（独立小 PR），归档时把 TASKFLOW 的 FIX-9 状态列改为实际值。
