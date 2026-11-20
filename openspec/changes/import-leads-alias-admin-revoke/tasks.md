# Tasks：「是不是同一家」只由组织管理员裁决，并能撤回（CHAIN-3c）

## 1. 纯函数

- [x] 1.1 `match-pure.ts`：`createCandidatePairFinder(winners)`（每个进口商与中标者之间「疑似同一家」的对，按规整名记忆）；`alias-decisions.ts` 的 `effectiveDecisions(rows)`（排除被撤回指向的，再取每对最新）；文字常量（verify：`npx tsx src/lib/tender-import-leads/__tests__/import-leads.test.ts` 新用例；`ImportLeadsView` 字面量补字段后通过）

## 2. 服务与接口

- [x] 2.1 `service.ts`：`loadDecisions` 读两种 action 并调用 `effectiveDecisions`；视图带 `decidedPairs`（名称用本项目写法、裁决人只取本组织现有成员、条数不含不采用的）与 `canDecideAliases`；`revokeImportLeadAlias`（404 → 409 → 锁内 409，写撤回审计行）；`importLeads`、`addImportLeadSupplier`、`decideImportLeadAlias` 返回的视图用调用人的真实 `canDecideAliases`（verify：隔离库用例「撤回确认与撤回否决」「不能撤回的情形」「列出与按钮」）
- [x] 2.2 `api-access.ts`：组织管理员判定（平台超级管理员；或本组织有效成员且组织角色 ≥ `org_admin`）与 `requireImportLeadsAliasDecide`；`aliases` 接口改用它，新增 `aliases/revoke` 接口；`route.ts`、`suppliers/route.ts` 把 `canDecideAliases` 传给服务（verify：隔离库用例「不是组织管理员」；401 / 404 / 开关 404 顺序不变；源码断言新路由走统一权限判定、不出站）

## 3. 界面

- [x] 3.1 `import-leads-panel.tsx` 与 `aggregate-pure.ts`：非管理员无裁决按钮并写那一句；两句确认改「组织管理员可以撤回」；「已裁决的」一节与撤回（先确认、结果一句、否决时再加一句）；只读说明与「等组织管理员确认」「要等组织管理员确认」（verify：`import-leads.test.ts` 源码断言逐字）

## 4. 测试与门禁

- [x] 4.1 `import-leads-db.isolated.test.ts`：加 EDITOR、ORG_OWNER、SUPER 三个身份与上述用例（含开关关时两个接口 404、视图里没有邮箱与用户 id）（verify：`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/import-leads-db.isolated.test.ts` 通过）
- [x] 4.2 既有期望只改槽里与导入结果里那两句文字（verify：`import-leads.test.ts`、`import-leads-db.isolated.test.ts` 的其余既有断言原样通过；`sourcing-suggestions.test.ts`、`readiness` 相关不受影响）
- [ ] 4.3 全量门禁（verify：`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`openspec validate import-leads-alias-admin-revoke --strict`；`git diff origin/main -- prisma/ vercel.json` 为空）
- [x] 4.4 写 `docs/QINGYAN_CHAIN-3c_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含多维审查与门禁结果、两个留给 GATE 的问题（撤回要不要填原因、「已标为不是同一家」要不要单独计数）；TASKFLOW 新增 CHAIN-3c 一行为 `[~]`）
