# Proposal：「是不是同一家」只由组织管理员裁决，并能撤回（CHAIN-3c）

TASKFLOW：CHAIN-3c（新增一行；Phase F（续）— 情报串联的后续；CHAIN-3 安全审查留给 GATE 的一项、交接文档第四十四次 §0.5h「之后还有什么」第 3 条；Lucas 2026-11-20 GATE 决定「别名裁决只允许组织管理员做，并做撤回（同样只限组织管理员，撤回写审计记录）」）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

CHAIN-3 让任何能修改本项目的人做「是不是同一家」的裁决，而裁决对本组织所有项目生效、不能撤回；一次误判会悄悄改掉别的项目的线索，也没有办法纠正。

## What Changes

- 收紧裁决权限：只有本组织的组织管理员（含组织所有者；平台超级管理员按既有规则，与授标记录的确认 / 撤回同一口径）能确认或否决；其他人调用 → 403「只有组织管理员能确认、否决或撤回「是不是同一家」（对本组织所有项目生效）。」，不写库。
- 新增撤回：组织管理员可以撤回一对已有的裁决（`POST …/import-leads/aliases/revoke`，带页面上那条裁决的标识）；撤回写一条审计（`tender.import_lead_alias_revoked`，带被撤回的裁决与它的审计行、撤回人、时间），这一对回到「要确认是不是同一家」，本组织所有项目随之改变；撤回之后可以重新裁决。不是本项目里的一对 → 404；没有可撤回的裁决或裁决已被同事换掉 → 409；本采购方的历史中标者读不出 → 422。
- 新增「已裁决的」一节：面板列出本项目涉及的、已有裁决的每一对（两个名称、结论、裁决人、时间、涉及几条记录），组织管理员看到「撤回」（先确认一次范围）。
- 修改界面：不是组织管理员的人看得到待确认的一对，但没有裁决按钮，写明只有组织管理员能确认或否决、在那之前这些记录不进汇总、请组织管理员来处理（逐字见 design D5）；裁决前的两句确认把「不能撤回」改为「组织管理员可以撤回」。
- 返回真实的裁决权限：读视图与导入、加入供应商库接口返回的视图都带调用人的 `canDecideAliases`；导入与加入供应商库的权限不变（仍是能修改本项目的人）。
- 保留已有的裁决：CHAIN-3 的开关在生产默认关，若已有裁决照旧有效，组织管理员可以撤回。
- 改说法：槽里与导入结果里的「等你确认」「要你确认」改为「等组织管理员确认」「要等组织管理员确认」，只读说明去掉「确认」。

## Out of scope

- 不做组织级的「全部别名裁决」管理页（只在有相关记录的项目面板里列出与撤回）。
- 撤回不解除已经建立的供应商关联、不删除任何供应商或线索（只改「挂上 / 待确认 / 不显示」的读时判定）。
- 不改导入、匹配三档的规则、出口商汇总、加入供应商库。
- 不新增权限键。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/import-leads`：修改「疑似同一家由人裁决」「裁决前先让人确认范围」「接口与权限」「审计」；新增「撤回裁决」「已裁决的一节」「已裁决的一节不带出的内容」。

## Impact

- 新增：`src/lib/tender-import-leads/alias-decisions.ts`（从审计行算有效裁决，纯函数）。
- 修改：`src/lib/tender-import-leads/match-pure.ts`（列出候选的对）、`src/lib/tender-import-leads/service.ts`（裁决读取认撤回、撤回服务、视图带已裁决的对与真实的裁决权限）、`src/lib/tender-import-leads/api-access.ts`（组织管理员判定）、`src/lib/tender-import-leads/aggregate-pure.ts`（视图类型与文字）、`src/app/api/projects/[id]/tender-intel/import-leads/{route.ts,aliases/route.ts,suppliers/route.ts}`；新增 `…/aliases/revoke/route.ts`；`src/components/tender-intel/import-leads-panel.tsx`。
- 测试：`import-leads.test.ts`、`import-leads-db.isolated.test.ts` 补用例；既有裁决用例本来就是组织管理员做的，不换人；既有断言只有槽里与导入结果里那两句的期望字符串随文字改动更新。
- 零 schema（撤回也写 `AuditLog`）、零依赖、零新增模型调用。
