# Tasks：三处旧的组织行锁换成不与外键检查互斥的那一种（FIX-4）

## 1. 换锁

- [ ] 1.1 `src/app/api/sunny-process/zebra-ratios/route.ts`、`src/app/api/install/warranty-settings/route.ts`、`src/lib/capabilities/governance/policy.ts`（两处）改为调用 `lockOrganizationRow`；verify：`grep -rn 'FROM "Organization".*FOR UPDATE' src scripts` 除注释与测试外没有结果；`npm run typecheck` 退出码 0

## 2. 测试

- [ ] 2.1 守卫测试补断言（没有对组织行的 `FOR UPDATE`；三处在读之前锁行）；verify：`npx tsx src/lib/organizations/__tests__/settings-write-guard.test.ts` 全部通过
- [ ] 2.2 新增隔离库测试并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/organizations/__tests__/org-row-lock-db.isolated.test.ts` 在本地隔离库全部通过，在改动之前的代码上失败；`bash scripts/check-test-registry.sh` 输出 OK
- [ ] 2.3 既有的四份隔离库测试不改断言重跑；verify：`settings-write-db`、`warranty-db`、`autogen-db`、`governance-hygiene-concurrency-gate` 全部通过

## 3. 验收

- [ ] 3.1 变异核对；独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate org-row-lock-no-key-update --strict` valid
- [ ] 3.2 写 `docs/QINGYAN_FIX-4_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FIX-4 一行，状态 `[G]`
