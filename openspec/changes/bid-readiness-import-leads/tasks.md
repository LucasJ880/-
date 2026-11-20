# Tasks：投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录（CHAIN-3b）

## 1. 计数

- [ ] 1.1 新增 `src/lib/tender-import-leads/readiness-count.ts`：`countImportLeadsForReadiness({ orgId, projectId })`（开关关 → 0 不查；条件见 design D1）（verify：`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/readiness-count-db.isolated.test.ts` 的计数用例）

## 2. 工作区读取

- [ ] 2.1 `workspace-view.ts`：`WorkspaceContext.importLeadCount`（可选）；`deriveMaterials` 在 > 0 时加 `IMPORT_LEADS`（verify：`npx tsx src/lib/tender-bid-workspace/__tests__/workspace-view.test.ts` 新用例；缺省时读取结果与改动前 `JSON.stringify` 相同）
- [ ] 2.2 `store.ts`：`loadWorkspaceContext` 并行取计数，出错按 0 并 warn（verify：隔离库用例经 `GET` 投标工作区读取看到阶段为执行、不在未接通清单）

## 3. 测试与门禁

- [ ] 3.1 新测试登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`bash scripts/check-test-registry.sh` 通过）
- [ ] 3.2 既有不改期望（verify：`stage-policy.test.ts`、`workspace-view.test.ts`、`bid-workspace-db.isolated.test.ts`、`readiness-submission-db.isolated.test.ts`、`import-leads.test.ts`、`import-leads-db.isolated.test.ts` 原样通过）
- [ ] 3.3 全量门禁（verify：`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`openspec validate bid-readiness-import-leads --strict`；`git diff origin/main -- prisma/ vercel.json` 为空）
- [ ] 3.4 写 `docs/QINGYAN_CHAIN-3b_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含多维审查与门禁结果；TASKFLOW 新增 CHAIN-3b 一行为 `[~]`）
