## MODIFIED Requirements

### Requirement: 疑似同一家由人裁决
「疑似同一家」SHALL 写成 `「{进口商}」和中标者「{中标者}」可能是同一家（{依据}），涉及 N 条记录。`，依据为 `只差公司后缀` 或 `一方名称完整包含另一方`。只有本组织的组织管理员（含组织所有者；平台超级管理员按既有规则）能裁决，其他人 SHALL 得到 403 `只有组织管理员能确认、否决或撤回「是不是同一家」（对本组织所有项目生效）。` 且 SHALL NOT 写库；只能裁决本项目当前待裁决的一对（否则 404 `这一对已不需要确认。`）；裁决 SHALL 记下裁决人与时间，并对本组织所有项目生效。确认后这一对的记录 SHALL 算作挂上；否决后这些记录 SHALL 不再显示，这一对 SHALL NOT 再出现在建议里，之后导入的同样一对 SHALL 按无关处理。已经有人裁决过（且没有撤回）时 SHALL 返回 409 `同事已经处理过这一对，页面已更新。`

#### Scenario: 确认与否决
- **WHEN** 对一对先确认、对另一对否决，再导入一条与被否决那一对相同的记录，再对已确认的那一对裁决一次，再在同采购方的另一个项目里导入已确认的那一对
- **THEN** 确认的那一对出现在汇总里；否决的不再出现，新导入的那条不导入；再裁决 409；另一个项目里直接挂上、不再要确认（`import-leads-db.isolated.test.ts`）

#### Scenario: 不是组织管理员
- **WHEN** 能修改本项目、但不是组织管理员的成员确认或否决一对；组织所有者、平台超级管理员各裁决一对
- **THEN** 前者 403、没有新的审计行、这一对仍待确认；后两者成功（`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/import-leads-db.isolated.test.ts`）

### Requirement: 裁决前先让人确认范围
界面上「是同一家」与「不是」SHALL 只对组织管理员显示，其他人 SHALL 看到 `只有组织管理员能确认或否决；对本组织所有项目生效。`；点了 SHALL 先让人再确认一次，写明 `确认后本组织所有项目都会把这两个名称当成同一家；组织管理员可以撤回。` 与 `否决后本组织所有项目都不再把这两个名称当成同一家，也不再提示；组织管理员可以撤回。`；裁决后 SHALL 写 `已确认是同一家，相关记录已加入出口商汇总。` 或 `已标为不是同一家，这些记录不再显示。`

#### Scenario: 两种确认
- **WHEN** 点「是同一家」或「不是」
- **THEN** 先弹出上面对应的一句；裁决后写明结果（`import-leads.test.ts` 源码断言）

### Requirement: 接口与权限
系统 SHALL 提供 `GET /api/projects/{项目}/tender-intel/import-leads`（读视图：线索说明、状态、来源情况、历史中标者、待裁决的一对、出口商汇总、挂上与存着的条数、`canEdit`）、`POST` 同一路径（导入：粘贴的文字、可选的来源说明与日期写法；返回结果与视图）、`POST …/import-leads/aliases` 与 `…/aliases/revoke`（裁决与撤回，见「撤回裁决」；返回视图）、`POST …/import-leads/suppliers`（加入供应商库；返回结果与视图）。判定顺序 SHALL 是：未登录 401；不能读本项目或不是该组织有效成员（平台超级管理员除外）404；开关关闭 404；写接口不能修改本项目 403。整批不导入 400，没有中标者或到了上限 422，请求不完整 400 `请求不完整`。响应 SHALL NOT 被缓存。不能修改的人 SHALL 看不到导入框与按钮，写 `你只有查看权限；导入和加入供应商库需要能修改本项目。`

#### Scenario: 权限
- **WHEN** 别的组织的用户读与写、没登录的人读、已被移出组织但项目成员记录还在的人读、只能读本项目的成员导入 / 裁决 / 加入供应商库
- **THEN** 依次 404、404、401、404、403 / 403 / 403；只读成员读到的 `canEdit` 为 false（`import-leads-db.isolated.test.ts`）

### Requirement: 审计
导入、裁决、撤回、加入供应商库 SHALL 各写一条审计：`tender.import_leads_imported`（批次、各项条数、来源说明）、`tender.import_lead_alias_decided`（两个名称、裁决、裁决人、时间）、`tender.import_lead_alias_revoked`（被撤回的那条裁决原样与它的审计行、撤回人、时间）、`tender.import_lead_supplier_added`（供应商、是否新建、出口商、关联的线索条数）。审计 SHALL NOT 记联系方式或运单原文。

#### Scenario: 审计
- **WHEN** 导入、裁决、加入供应商库各做几次
- **THEN** 三种审计各有记录，内容如上，没有邮箱与来源网址（`import-leads-db.isolated.test.ts`）

## ADDED Requirements

### Requirement: 撤回裁决
组织管理员 SHALL 能撤回本项目现有记录涉及的一对的当前裁决（确认或否决都可以），请求 SHALL 带上页面上那条裁决的标识；其他人 SHALL 得到 403（同裁决那句）且 SHALL NOT 写库。撤回 SHALL 追加一条审计、SHALL NOT 改写或删除原来的裁决记录；撤回后这一对 SHALL 回到「要确认是不是同一家」，对本组织所有项目生效，之后 SHALL 能重新裁决。撤回 SHALL NOT 解除已建立的供应商关联，也 SHALL NOT 找回否决期间没有导入的记录。不是本项目现有记录涉及的一对 SHALL 返回 404 `这一对不在本项目里。`；这一对现在没有裁决、或裁决已不是页面上那一条（同事已撤回或重新裁决）SHALL 返回 409 `这一对现在没有可撤回的裁决，页面已更新。`；撤回与裁决同一对 SHALL 串行。

#### Scenario: 撤回确认与撤回否决
- **WHEN** 组织管理员确认一对后撤回，再撤回一次，再否决它，再撤回；另一个同采购方的项目里也有这一对的记录
- **THEN** 第一次撤回后这些记录回到待确认、不在出口商汇总里，审计多一行撤回（带原裁决）；第二次 409；否决后不显示；再撤回后重新待确认；另一个项目随之改变；已关联的供应商仍关联（`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/import-leads-db.isolated.test.ts`）

#### Scenario: 不能撤回的情形
- **WHEN** 项目编辑者（不是组织管理员）撤回；组织管理员撤回一对不在本项目里的；组织管理员拿一条已被同事换掉的裁决的标识去撤回
- **THEN** 依次 403 且没有新审计行、404、409（`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/import-leads-db.isolated.test.ts`）

### Requirement: 已裁决的一节
读视图 SHALL 带 `canDecideAliases` 与本项目现有记录涉及、当前有裁决的每一对；导入与加入供应商库接口返回的视图里的 `canDecideAliases` SHALL 是调用人的真实值。面板 SHALL 以 `已裁决的（对本组织所有项目生效）` 列出这些对，每一对写 `「{进口商}」和「{中标者}」：{已确认是同一家 / 已标为不是同一家}（{裁决人}，{日期}），涉及 N 条记录`，名称用本项目的写法，裁决人 SHALL 只取本组织现有成员的名字、否则写 `不是本组织现有成员`。组织管理员 SHALL 看到「撤回」，点了先确认 `撤回后这一对回到「要确认是不是同一家」，本组织所有项目都会随之改变。确定撤回吗？`，撤回后写 `已撤回，这一对回到待确认。`（撤回的是否决时再加 `之前因否决没有导入的记录需要重新导入。`）；其他人 SHALL NOT 看到「撤回」。

#### Scenario: 列出与按钮
- **WHEN** 本项目有一对已确认、一对已否决，组织管理员与项目编辑者分别读取并打开面板；编辑者导入一批
- **THEN** 两人都看到这两对与裁决人、日期、条数；`canDecideAliases` 前者 true、后者 false，编辑者导入返回的视图里也是 false；只有组织管理员有「撤回」，点了先弹出上面那句（`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/import-leads-db.isolated.test.ts`；`npx tsx src/lib/tender-import-leads/__tests__/import-leads.test.ts` 源码断言）

### Requirement: 已裁决的一节不带出的内容
读视图与面板 SHALL NOT 含裁决人或撤回人的邮箱与用户标识，也 SHALL NOT 含别的项目的记录内容。

#### Scenario: 视图里没有邮箱与用户标识
- **WHEN** 遍历读视图的全部字段
- **THEN** 没有任何邮箱格式的值，也没有裁决人的用户标识（`NODE_ENV=test npx tsx src/lib/tender-import-leads/__tests__/import-leads-db.isolated.test.ts`）
