# Tasks：组织设置的写入加锁（FIX-3）

## 1. 入口

- [ ] 1.1 新增 `src/lib/organizations/settings-write.ts`（`lockOrganizationRow`、`mutateOrgSettings`、`mutateOrgSettingsInTx`；`fn` 为同步纯函数，返回 `{ next?, result }`）；verify：`npx tsx src/lib/organizations/__tests__/settings-write-db.isolated.test.ts` 中「入口并发写 12 个键全保留」与对照用例「不加锁的写法会丢键」通过

## 2. 改写入方

- [ ] 2.1 询价与 Muse：`inbound-sync.ts` 的游标、`prefs.ts` 的保存与学习、`binding.ts` 的绑定、`router.ts` 里 `set_preference` 的保存一步、询价设置接口、`tender-profile/store.ts`；verify：隔离库测试中「八种写入同时进行」「设置偏好与自动学习同时发生」「同时学习 4 家供应商」「询价设置接口 400 / 200 与审计」通过
- [ ] 2.2 其它模块：`playbook/enforcement.ts`、`calendar-watch/settings.ts` 与 `run.ts`、`blinds/discount-settings.ts`（事务里补锁行）、`organizations/onboarding.ts`（两处：补锁行；设置的合并挪进事务）；verify：`grep -rln "enforcement\|calendar-watch\|discount-settings\|onboarding" src --include=*.test.ts` 列出的既有测试不改断言全部通过
- [ ] 2.3 确认读取方、各 `with…` 纯函数、已锁行的三处没有改动；verify：`git diff --stat origin/main` 里没有 `zebra-ratios/route.ts`、`warranty-settings/route.ts`、`governance/policy.ts`

## 3. 测试

- [ ] 3.1 `settings-write-db.isolated.test.ts`（本地隔离库）与 `settings-write-guard.test.ts`（源码守卫，含一段不合规示例的反例），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK；隔离库测试连跑三次结果相同
- [ ] 3.2 证明测试测得到问题；verify：同一份隔离库测试在 `main` 的旧代码上跑，真实写入方并发的用例失败（丢键）

## 4. 验收与收尾

- [ ] 4.1 开 PR 前请一个不带结论的独立审查并处理其发现；全部门禁；verify：报告里逐条写明；`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate org-settings-locked-write --strict` valid
- [ ] 4.2 写 `docs/QINGYAN_FIX-3_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 FIX-3 一行，状态 `[G]`
