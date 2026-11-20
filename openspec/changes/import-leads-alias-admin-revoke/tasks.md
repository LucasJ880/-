# Tasks：「是不是同一家」只由组织管理员裁决，并能撤回（CHAIN-3c）

## 1. 服务

- [ ] 1.1 `service.ts`：`loadDecisions` 同时读裁决与撤回、每对取最新一行（最新是撤回 → 没有裁决）；纯函数 `latestDecisionOf(rows)` 单测（verify：`npx tsx src/lib/tender-import-leads/__tests__/import-leads.test.ts` 新用例）
- [ ] 1.2 `service.ts`：`revokeImportLeadAlias`（锁内查最新一行；不是裁决 → 409；写撤回审计行）与视图的 `decidedPairs`、`canDecideAliases`（verify：隔离库用例「撤回确认与撤回否决」「不能撤回的情形」）

## 2. 接口与权限

- [ ] 2.1 `api-access.ts`：组织管理员判定（平台超级管理员；或有效成员且组织角色 ≥ `org_admin`）；`aliases` 接口改为读权限门 + 组织管理员，新增 `aliases/revoke` 接口（verify：隔离库用例「不是组织管理员」；401 / 404 / 开关 404 顺序不变）

## 3. 界面

- [ ] 3.1 `import-leads-panel.tsx` 与 `aggregate-pure.ts` 的文字：非管理员无裁决按钮并写那一句；两句确认改「组织管理员可以撤回」；「已裁决的」一节与撤回（先确认、结果一句）（verify：`import-leads.test.ts` 源码断言逐字）

## 4. 测试与门禁

- [ ] 4.1 `import-leads-db.isolated.test.ts`：原先用项目编辑者裁决的用例改用组织管理员，加编辑者 403、撤回、再裁决、跨项目、供应商关联不变、平台超级管理员、404 / 409（verify：`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/import-leads-db.isolated.test.ts` 通过）
- [ ] 4.2 既有不改期望（verify：除权限与两句确认文字外，`import-leads.test.ts`、`import-leads-db.isolated.test.ts` 的既有断言原样通过；`sourcing-suggestions.test.ts`、`supplier-groups-db.isolated.test.ts` 通过）
- [ ] 4.3 全量门禁（verify：`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`openspec validate import-leads-alias-admin-revoke --strict`；`git diff origin/main -- prisma/ vercel.json` 为空）
- [ ] 4.4 写 `docs/QINGYAN_CHAIN-3c_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含多维审查与门禁结果；TASKFLOW 新增 CHAIN-3c 一行为 `[~]`）
