# Tasks：投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录（CHAIN-3b）

## 1. 有没有导入记录

- [x] 1.1 新增 `src/lib/tender-import-leads/readiness-count.ts`：`hasImportLeadsForReadiness({ orgId, projectId })`（开关关 → false 不查；`findFirst`；条件见 design D1；只 import `@/lib/db` 与 `./flags`）；新增 `src/lib/tender-import-leads/__tests__/readiness-count-db.isolated.test.ts` 并同时登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/readiness-count-db.isolated.test.ts` 的判定用例通过，每一步与 `storedLeadCount > 0` 一致；`bash scripts/check-test-registry.sh` 通过）

## 2. 工作区读取

- [x] 2.1 `workspace-view.ts`：`WorkspaceContext.hasImportLeads`（可选）；`deriveMaterials` 为 true 时加 `IMPORT_LEADS`（verify：`npx tsx src/lib/tender-bid-workspace/__tests__/workspace-view.test.ts` 新用例；缺省与 false 的读取结果相同；既有断言不动）
- [x] 2.2 `store.ts`：`loadWorkspaceContext` 与其它查询并行取这一项（verify：隔离库用例经 `GET` 投标工作区读取看到阶段为执行、不在未接通清单；开关关时读取结果与没有记录时相同）
- [x] 2.3 源码断言：两个字面量等于 `service.ts` 的 `IMPORT_LEAD_PLATFORM` / `IMPORT_LEAD_KIND`，`readiness-count.ts` 只 import `@/lib/db` 与 `./flags`（verify：`npx tsx src/lib/tender-import-leads/__tests__/import-leads.test.ts` 新断言通过）

## 3. 门禁与报告

- [x] 3.1 既有不改期望（verify：`stage-policy.test.ts`、`workspace-view.test.ts`、`bid-workspace-db.isolated.test.ts`、`readiness-submission-db.isolated.test.ts`、`import-leads.test.ts`、`import-leads-db.isolated.test.ts` 原样通过）
- [ ] 3.2 全量门禁（verify：`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`openspec validate bid-readiness-import-leads --strict`；`git diff origin/main -- prisma/ vercel.json` 为空）
- [x] 3.3 写 `docs/QINGYAN_CHAIN-3b_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含多维审查与门禁结果、stage-policy 主规格措辞的后续；TASKFLOW 新增 CHAIN-3b 一行为 `[~]`）
