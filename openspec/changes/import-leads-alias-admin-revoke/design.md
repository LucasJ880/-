# Design：「是不是同一家」只由组织管理员裁决，并能撤回

## Context

- CHAIN-3 的别名裁决存在 `AuditLog`：`action = "tender.import_lead_alias_decided"`、`targetType = "import_lead_alias"`、`targetId = "alias:" + sha256(pairKey)[0:32]`、`afterData` 是 `AliasDecision`（两个名称、CONFIRMED / REJECTED、裁决人、时间）。读取按对查最新一行（`loadDecisions`）。写入在 `pg_advisory_xact_lock` 下先查后写，已有裁决 → 409。
- 挂上 / 待确认 / 不显示在读的时候按最新裁决算（`createImporterMatcher`）；所以撤回只要让「最新一行」不再是裁决，读时判定就自动回到待确认。
- 权限：裁决接口走 `requireImportLeadsWrite`（能修改本项目）。CHAIN-3 安全审查把「全组织生效、不能撤回的裁决只要项目写权限」留给 GATE；Lucas 2026-11-20 定：只限组织管理员，做撤回，撤回写审计。
- 授标记录的确认 / 撤回（`tender/award-review`）已有「组织管理员」口径：本组织有效成员且组织角色不低于 `org_admin`（含 `org_owner`），平台超级管理员按既有规则放行（`src/app/api/org/tender-awards/route.ts` 的 `canReview`、`requireOrgRole(…, "org_admin")`）。

## Goals / Non-Goals

**Goals**：确认、否决、撤回都只有组织管理员能做；撤回可追溯（谁、何时、撤回了什么）；撤回后可以重新裁决；不是组织管理员的人照样能导入、看到待确认的对、加入供应商库。

**Non-Goals**：
- `src/lib/tender-import-leads/match-pure.ts`（三档比对与读时判定的规则不改，只是喂给它的裁决集合变了）。
- `src/lib/tender-import-leads/parse.ts`、导入接口、`suppliers` 接口与加入供应商库的规则。
- `src/lib/tender-competition/company-identity.ts`（TI-3a 契约不改）。
- 组织级的别名裁决管理页。

## Decisions

### D1：「组织管理员」沿用授标记录处理的口径

判定：平台超级管理员；或本组织有效成员（`status = "active"`）且 `hasOrgRole(role, "org_admin")`（`org_owner`、`org_admin`）。判定在既有读权限门之后（未登录 401、不能读本项目或不是有效成员 404、开关关 404 照旧），不是组织管理员 → 403 `NOT_ORG_ADMIN`。读视图多一个 `canDecideAliases`，界面据此显示按钮。

- 备选 A：只认 `org_admin`、不认 `org_owner` 与平台超级管理员。否决：与授标记录处理的口径不一致，所有者反而做不了。
- 备选 B：新增权限键（如 `tender.alias.decide`）。否决：要走岗位目录登记；GATE 定的是「组织管理员」，现成的组织角色就是这个意思。
- 备选 C：组织管理员之外再要求能修改本项目。否决：组织管理员按项目访问规则本来就能修改本组织的项目（`src/lib/projects/access.ts`），多一道判定不改变结果，只多一次查询。

### D2：撤回是一条新的审计行，不改旧行

撤回写 `AuditLog`：`action = "tender.import_lead_alias_revoked"`，`targetType`、`targetId` 与裁决相同，`beforeData` = 被撤回的那条裁决（原样），`afterData` = `{ pairKey, revokedBy, revokedAt }`。`loadDecisions` 改为同时读两种 action、按 `createdAt`、`id` 取每对最新一行：最新是裁决 → 有裁决；最新是撤回 → 没有裁决。写入与裁决共用同一把 advisory lock（同一 `targetId`），锁内先查「最新一行是不是裁决」：不是 → 409，是 → 写撤回行。

- 备选 A：删掉或改写原裁决行。否决：审计只追加；改了就丢了「谁当初裁决的」。
- 备选 B：在 `afterData` 里写 `decision: "REVOKED"` 沿用同一 action。否决：`tender.import_lead_alias_decided` 的含义变了，按 action 统计「裁决次数」的地方会算错；分开的 action 读起来也清楚。
- 备选 C：新表。否决：零 schema。

### D3：撤回之后

这一对回到「要确认是不是同一家」（只要本项目还有对得上的记录）：原来确认的，那些记录不再算挂上、不进出口商汇总；原来否决的，那些记录重新以待确认显示。已经关联到供应商的线索保持关联（撤回不碰供应商与信号）。撤回后组织管理员可以重新确认或否决（最新一行是撤回，409 不再触发）。

- 备选：撤回只允许撤「确认」。否决：误否决同样要能纠正；GATE 说的是「做撤回」，没有区分。

### D4：只在本项目的面板里列出与撤回

读视图多一个 `decidedPairs`：本项目的记录涉及、且当前有裁决的每一对（就是 `candidatePairKeys` 里查到裁决的那些）：两个名称、结论、裁决人（显示名，查不到时写「已不在组织的成员」）、裁决时间、涉及本项目几条记录。撤回接口只接受这些对之一（否则 404 `这一对不在本项目里。`）。

- 备选：组织级管理页列出全部裁决。否决：范围大得多；裁决本来就只在有记录的项目里产生，需要纠正时也是在那个项目里发现的。

### D5：文字

- 403：`只有组织管理员能确认、否决或撤回「是不是同一家」（对本组织所有项目生效）。`
- 非管理员看到待确认的对：`只有组织管理员能确认或否决；对本组织所有项目生效。`
- 确认前：`确定是同一家吗？确认后本组织所有项目都会把这两个名称当成同一家；组织管理员可以撤回。`
- 否决前：`确定不是同一家吗？否决后本组织所有项目都不再把这两个名称当成同一家，也不再提示；组织管理员可以撤回。`
- 分区标题：`已裁决的（对本组织所有项目生效）`；每一对：`「{进口商}」和「{中标者}」：{已确认是同一家 / 已标为不是同一家}（{裁决人}，{日期}），涉及 N 条记录`
- 撤回前：`撤回后这一对回到「要确认是不是同一家」，本组织所有项目都会随之改变。确定撤回吗？`
- 撤回后：`已撤回，这一对回到待确认。`
- 409：`这一对现在没有可撤回的裁决，页面已更新。`
- 404：`这一对不在本项目里。`

## 八条硬纪律

1. 零 schema：遵守（撤回写既有 `AuditLog`；不改 `prisma/`）。
2. 出站先审批：不涉及（不新增出站）。
3. 禁止第三套队列：不涉及。
4. 脱敏：遵守（撤回审计只记两个名称、裁决与人和时间，不记联系方式或运单原文；裁决人只显示名字，不显示邮箱）。
5. 不爬登录页：不涉及（不访问任何网站）。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守（零模型调用）。
8. 测试注册：只在既有已注册的测试文件里加用例。

## 验证方式

- 纯函数与源码断言：`npx tsx src/lib/tender-import-leads/__tests__/import-leads.test.ts`（新文字逐字、非管理员无按钮、撤回确认文字、最新行判定的纯函数）。
- 隔离库：`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/import-leads-db.isolated.test.ts`——项目编辑者（非管理员）裁决 403 且无审计行；组织管理员确认 → 挂上；撤回 → 回到待确认、多一行撤回审计（`beforeData` 是原裁决）；再撤回 409；重新否决 → 不显示；撤回否决 → 重新待确认；平台超级管理员可撤回；别的项目里同一对随之改变；撤回不改供应商关联；不是本项目的一对 404。
- 既有不改期望：除「只有能修改本项目的人能裁决」与两句确认文字外，`import-leads.test.ts`、`import-leads-db.isolated.test.ts` 的既有断言不改（原先用项目编辑者做裁决的用例改用组织管理员身份，并另加一条编辑者被拒）。
- 全量：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`。

## Risks / Trade-offs

- 组织里没有活跃的组织管理员时，待确认的对就一直待确认（记录照旧存着，不丢）。
- 撤回一个「确认」后，依赖它挂上的记录从出口商汇总里消失；已加入供应商库的供应商与关联不动，供应商页上照旧看得到。
- 两个人同时撤回 / 裁决同一对：同一把锁串行，后到的拿到 409。
