# Tasks：「是不是同一家」只由组织管理员裁决，并能撤回（CHAIN-3c）

## 1. 纯函数

- [x] 1.1 `match-pure.ts`：`createCandidatePairFinder(winners)`（每个进口商与中标者之间「疑似同一家」的对，按规整名记忆）；`alias-decisions.ts` 的 `effectiveDecisions(rows)`（排除被撤回指向的，再取每对最新）；文字常量（verify：`npx tsx src/lib/tender-import-leads/__tests__/import-leads.test.ts` 新用例；`ImportLeadsView` 字面量补字段后通过）

## 2. 服务与接口

- [x] 2.1 `service.ts`：`loadDecisions` 读两种 action 并调用 `effectiveDecisions`；视图带 `decidedPairs`（名称用本项目写法、裁决人只取本组织现有成员、条数不含不采用的）与 `canDecideAliases`；`revokeImportLeadAlias`（422 → 404 → 409 → 锁内 409，写撤回审计行）；`importLeads`、`addImportLeadSupplier`、`decideImportLeadAlias` 返回的视图用调用人的真实 `canDecideAliases`（verify：隔离库用例「撤回确认与撤回否决」「不能撤回的情形」「列出与按钮」）
- [x] 2.2 `api-access.ts`：组织管理员判定（平台超级管理员；或本组织有效成员且组织角色 ≥ `org_admin`）与 `requireImportLeadsAliasDecide`；`aliases` 接口改用它，新增 `aliases/revoke` 接口；`route.ts`、`suppliers/route.ts` 把 `canDecideAliases` 传给服务；撤回要写原因（Lucas 2026-11-20 GATE）：`aggregate-pure.ts` 的 `normalizeRevokeReason`；撤回接口在「请求不完整」之后判原因、400 不写库；服务把原因写进撤回审计（verify：隔离库用例「不是组织管理员」；401 / 404 / 开关 404 顺序不变；源码断言新路由走统一权限判定、不出站；撤回原因的规整与 400：`import-leads.test.ts` 的原因规整与接口顺序断言；隔离库「撤回原因」用例）

## 3. 界面

- [x] 3.1 `import-leads-panel.tsx` 与 `aggregate-pure.ts`：非管理员无裁决按钮并写那一句；两句确认改「组织管理员可以撤回」；「已裁决的」一节与撤回（先确认、结果一句、否决时再加一句）；只读说明与「等组织管理员确认」「要等组织管理员确认」；撤回在这一对下面先写后果、再填原因（按裁决标识开、没填不能点）；已标为不是同一家的单独计数（槽里一行、已裁决的一节标题后面，`rejectedPairsSummaryZh` / `decidedCountsZh`；涉及条数由服务去重算好放进视图 `rejectedPairRecordCount`，`countRecordsTouchingRejected`）（verify：`import-leads.test.ts` 源码断言逐字）

## 4. 测试与门禁

- [x] 4.1 `import-leads-db.isolated.test.ts`：加 EDITOR、ORG_OWNER、SUPER 三个身份与上述用例（含开关关时两个接口 404、视图里没有邮箱与用户 id）（verify：`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/import-leads-db.isolated.test.ts` 通过）
- [x] 4.2 既有期望只改槽里与导入结果里那两句文字（verify：`import-leads.test.ts`、`import-leads-db.isolated.test.ts` 的其余既有断言原样通过；`sourcing-suggestions.test.ts`、`readiness` 相关不受影响）
- [x] 4.3 全量门禁（verify：`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`openspec validate import-leads-alias-admin-revoke --strict`；`git diff origin/main -- prisma/ vercel.json` 为空）
- [x] 4.4 写 `docs/QINGYAN_CHAIN-3c_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含多维审查与门禁结果、GATE 的三个问题与 Lucas 2026-11-20 的回答（平台超级管理员也能、撤回要填原因、否决单独计数，三项都已做）；TASKFLOW 新增 CHAIN-3c 一行为 `[~]`）

## 5. 交叉验证后修订（2026-11-23）

- [x] 5.1 F1 槽里那一句按实际待确认的条数说：`service.ts` 的 `classify` 数还在待确认的记录（每条记录只加一次），视图带 `pendingLeadCount`；`slotSummaryZh` 全部在等写「都在等」、只有一部分写 `其中 K 条在等组织管理员确认是不是同一家`；规格「情报页签的供应链槽」与 design D5 同步（verify：`import-leads.test.ts` 那个组合；`alias-decisions-db.isolated.test.ts` 的「待确认条数按记录数」「其中 1 条在等」）
- [x] 5.2 F2 对抗用例并进正式测试：新文件 `alias-decisions-db.isolated.test.ts`（注册进 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`）——两个组织同一对、并发撤回 / 并发裁决、锁内重读与锁内 / 锁外比对标识（测试先拿住同一把锁）、裁决人已不是本组织现有成员、没有采购方时 422；纯函数对抗用例并进 `import-leads.test.ts`（verify：读裁决去掉组织过滤、锁内不重读（撤回 / 裁决）、锁内或锁外不比对标识、裁决人不按组织或不按在职，逐个改坏后都失败，改回后通过）
- [x] 5.3 F3 撤回失败（409 / 404）后：面板刷新，这条裁决已不在视图里就收起表单、清掉原因，别的「撤回」只在表单对应的裁决还在时才灰（verify：`import-leads.test.ts` 源码断言）
- [x] 5.4 F5 撤回 422 的范围写进规格（没有可比对的历史中标者，与导入同一判定）；F6 design D3 的提示与 D5 一致、`match-pure.ts` 注释挪回 `candidatePairKeys`；F4 / F7 写进报告「已知限制」（verify：`openspec validate import-leads-alias-admin-revoke --strict`）
- [x] 5.5 门禁重跑（verify：本 change 与 CHAIN-3b 单跑、全量只有既有 10 项失败、CI 子集、typecheck、lint:baseline、注册、架构守卫、strict validate）
