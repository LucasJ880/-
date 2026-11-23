# Spec Delta

## Purpose

旧报价单（列表、详情、新建 / 修改 / 删除、AI 审查与起草、编辑器、Excel 导出）、智能体报价技能与问青砚两个报价工具：谁能看内部成本、成本价与利润率，谁能改，被拒时返回什么，不输出什么，界面写什么。判定与成本核算、报价引擎同一个财务查看权。报价单 PDF 不在本能力内（FIX-26a 的 `projects/legacy-quote-pdf`）。

## ADDED Requirements

### Requirement: 旧报价单的查看与编辑口径
旧报价单的接口、编辑器、Excel 导出与报价 AI SHALL 先过项目读权限，再按与成本核算、报价引擎相同的财务查看权判定能不能看内部数字：平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read` 的人、项目负责人。项目没有组织、或授权查询出错时 SHALL 只认负责人与平台超级管理员，出错时响应 SHALL 带 `hintReason: "unconfirmed"`。能编辑 SHALL 是能看且（是上述特权之一，或项目角色带成本写权限）。

#### Scenario: 八种身份
- **WHEN** 只读成员（viewer）、不是负责人的项目管理员、operator、不是项目成员也没有财务键的组织管理员、只在分配范围持 `project.finance.read` 的投标同事、持组织范围 `project.finance.read` 且项目角色为 viewer 的成员、项目负责人、平台超级管理员分别读同一份旧报价单
- **THEN** 前五人的 `capabilities` 为 `{ canViewInternal: false, canEdit: false }`，第六人为 `{ canViewInternal: true, canEdit: false }`，负责人与平台超级管理员为 `{ canViewInternal: true, canEdit: true }`（`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`）

#### Scenario: 判定出错与项目没有组织
- **WHEN** 授权查询抛错；或项目没有组织
- **THEN** 负责人与平台超级管理员仍能看、能编辑，其余人都不能；出错时带 `hintReason: "unconfirmed"`，没有组织时不调用授权查询（`npx tsx src/lib/quote/__tests__/legacy-quote-finance-view.test.ts`）

### Requirement: 报价单列表不带利润率
`GET /api/projects/{项目}/quotes` SHALL 只列所属组织为空的旧报价单，SHALL NOT 列出报价引擎、逐行报价建的报价（与旧接口对它们 409 同一口径）。响应 SHALL 对所有人多带 `capabilities`（`canViewInternal`、`canEdit`）。没有财务查看权的人：每份报价的 `profitMargin` SHALL 为 `null`，响应 SHALL 带 `costHidden: true`；`totalAmount`、标题、状态、版本、行数等其它字段 SHALL 照旧。有财务查看权的人每份旧报价单的字段 SHALL 与改动前相同。

#### Scenario: 只读成员与负责人读列表
- **WHEN** 项目里有一份旧报价单（利润率 23.45）、一份报价引擎的报价和一份逐行报价，只读成员与项目负责人分别读列表
- **THEN** 两人都只拿到那份旧报价单；只读成员的 `profitMargin` 是 `null`、带 `costHidden: true`、`totalAmount` 与负责人看到的相同；负责人的 `profitMargin` 是 23.45，没有 `costHidden`（`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`）

### Requirement: 报价单详情只返回旧报价单字段
`GET /api/projects/{项目}/quotes/{报价}` 与修改成功的返回 SHALL 只含：报价头（标题、模板、币种、贸易方式、付款条款、交期、有效期、MOQ、原产地、状态、版本）、小计、总额、内部成本、利润率、内部备注、AI 草稿与审查原文、是否 AI 生成、关联询价、创建人与时间，行项（顺序、类别、品名、规格、单位、数量、单价、合计、备注、成本价、是否内部行），以及 `capabilities`。没有财务查看权时内部成本、利润率、内部备注、AI 草稿与审查原文、每行成本价 SHALL 为 `null`，并带 `costHidden: true`。

#### Scenario: 只读成员读详情
- **WHEN** 旧报价单每行成本价 17.31、内部成本 91,234.56、利润率 23.45、存有 AI 草稿，只读成员读详情
- **THEN** 报价头、行项的品名、数量、单价、合计与负责人看到的相同；内部成本、利润率、内部备注、AI 草稿与审查原文、每行成本价都是 `null`，带 `costHidden: true`（`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`；`npx tsx src/lib/quote/__tests__/legacy-quote-finance-view.test.ts`）

### Requirement: 旧报价单接口不处理报价引擎的报价
所属组织不为空的报价（报价引擎、逐行报价建的）经旧报价单的读详情、修改、删除与 AI 审查接口时，系统 SHALL 返回 409「这份报价是在报价页里做的，旧报价单不能打开或修改它；请到报价页查看和修改。」并带报价页地址 `href`，SHALL NOT 写库、SHALL NOT 调模型。判定顺序 SHALL 是项目读权限、报价不存在 404、报价引擎的报价 409，再判编辑权或财务查看权。

#### Scenario: 负责人用旧接口改引擎报价
- **WHEN** 项目负责人对一份报价引擎的报价分别调旧接口的详情、`PATCH`（带行项与 `status: "approved"`）、`DELETE` 与 AI 审查
- **THEN** 四次都是 409 与那句话、带 `href`；这份报价的行项、状态与成本列与请求前相同；本机假模型服务没有收到请求（`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`）

### Requirement: 新建、修改、删除旧报价单要能编辑
新建（`POST …/quotes`）、修改与确认（`PATCH …/quotes/{报价}`）、删除（`DELETE …/quotes/{报价}`）、保存 AI 草稿（`POST …/quotes/save-ai-draft`）对不能编辑的人 SHALL 返回 403「没有改动：你不是本项目负责人，不能新建、修改、确认或删除报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。」，SHALL NOT 写库。项目没有真人负责人时后一句 SHALL 换成「这个项目还没有指定负责人，请找组织管理员在项目成员里把做报价的同事设为主负责人。」；授权查询出错时整句 SHALL 换成「没有改动：暂时无法确认你的查看权限，请稍后刷新。」。能编辑的人 SHALL 与改动前相同（删除仍只限草稿）。

#### Scenario: 只读成员与不是负责人的项目管理员改报价
- **WHEN** 只读成员、不是负责人也没有财务键的项目管理员分别新建报价、把一份旧报价单的单价改掉并确认、删除一份草稿
- **THEN** 都是 403 与那句话；报价份数、那份报价的行项、成本列与状态、那份草稿都与请求前相同（`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`）

#### Scenario: 负责人照常修改
- **WHEN** 项目负责人改一份旧报价单的行项并确认
- **THEN** 返回 200，状态为已确认，内部成本与利润率按新行项重算，返回里带成本，没有 `costHidden`（`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`）

### Requirement: 旧报价单的行都是客户行
旧报价单的修改（`PATCH …/quotes/{报价}` 带行项时）SHALL 把每一行存成非内部行（「是否内部行」为否），SHALL NOT 采用请求里带的「是否内部行」的值；其余行项字段 SHALL 照旧按请求保存。旧报价单的编辑器、PDF、Excel 与合计 SHALL 照旧把全部行当客户行处理。

#### Scenario: 请求里把一行标成内部行
- **WHEN** 项目负责人保存一份旧报价单，两行里一行带「是否内部行」为是
- **THEN** 返回 200；库里与返回里两行的「是否内部行」都为否，其余字段与请求相同，合计按两行算（`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`）

### Requirement: 报价 AI 只给有资格的人
`POST …/quotes/{报价}/ai/review` SHALL 只对有财务查看权的人调用模型；没有的人 SHALL 得到 403「AI 审查用到的成本和利润率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」。`POST …/quotes/ai/generate-draft` SHALL 只对能编辑的人调用模型；不能编辑的人 SHALL 得到 403「没有生成：你不是本项目负责人，不能用 AI 起草报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。」（后一句按上一条同样换）。被拒时 SHALL NOT 调模型。有资格的人的模型输入与返回 SHALL 与改动前相同。

#### Scenario: 被拒的 AI 请求不调模型
- **WHEN** 只读成员调 AI 审查与 AI 起草，项目负责人再各调一次
- **THEN** 只读成员两次 403 与对应那句话，本机假模型服务没有收到请求；负责人两次 200，假模型服务各收到一次、请求正文与改动前相同（`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`）

### Requirement: 没有财务查看权时旧报价单不带出的内容
对没有财务查看权的人，报价单列表、详情、修改返回与报价 AI 两个接口的返回 SHALL NOT 含内部成本、每行成本价、利润率（含报价引擎写进同一张表的毛利率）、内部备注、AI 草稿与审查原文。对任何人，旧报价单详情 SHALL NOT 含报价引擎的估算成本、毛利、毛利率、加成、成本分解、情景、定价方式与比例、客户抬头与条款快照，也 SHALL NOT 含行项的内部溯源。

#### Scenario: 响应里搜不到成本数字
- **WHEN** 旧报价单成本价 17.31、内部成本 91,234.56、利润率 23.45，引擎报价快照里估算成本 87,654.32；只读成员与不是成员的组织管理员读列表、读详情，并调两个 AI 接口
- **THEN** 每个响应的 JSON 里都搜不到 17.31、91234.56、23.45、87654.32；负责人读这份引擎报价的旧接口详情得到 409，任何人的旧接口详情里都没有 `summaryJson`、`engineJson`、`pricingRate`（`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`）

### Requirement: Excel 导出按财务查看权分两种
有财务查看权的人导出的 Excel SHALL 是内部成本表：第一张表首行 SHALL 写「内部成本表（含成本和利润率，不要发给客户）」，含内部成本、利润率两行与「成本价（内部）」一列，其余与改动前相同；导出菜单 SHALL 写「导出内部成本表（Excel）」。没有财务查看权的人导出的 Excel SHALL NOT 含内部成本、利润率与成本价，首行 SHALL 写「报价单信息」，菜单 SHALL 写「导出 Excel」。导出菜单的 PDF 项 SHALL 写「导出客户报价单（PDF）」。

#### Scenario: 两种 Excel
- **WHEN** 同一份报价单分别按能看成本与不能看成本生成 Excel 内容
- **THEN** 前者首行是那句内部成本表、有内部成本、利润率与成本价一列；后者首行是「报价单信息」，没有这三样，其余单元格与前者相同（`npx tsx src/lib/quote/__tests__/legacy-quote-finance-view.test.ts`）

### Requirement: 编辑器与报价管理区块的显示
没有财务查看权时编辑器 SHALL 在顶部写「报价单的内部成本和利润率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」，SHALL NOT 显示成本价一栏、内部成本、利润率与「内部成本表」入口，规则检查 SHALL NOT 出利润率检查项。不能编辑时编辑器 SHALL 只读并写不能编辑那句（不带「没有改动：」），SHALL NOT 显示保存、确认、AI 起草、AI 审查与 AI 自动流；报价管理区块 SHALL NOT 显示「新建报价」并写同一句。读取失败时 SHALL 写「打不开这个报价单：」加接口给的原因，409 时另给去报价页的链接，SHALL NOT 显示空白表单。

#### Scenario: 四种状态
- **WHEN** 编辑器分别收到看不到成本且不能编辑的详情、能看不能编辑的详情、403「无权查看该项目」、引擎报价的 409
- **THEN** 第一种有两句话、没有成本价一栏、内部成本、利润率与保存按钮；第二种有成本、只有不能编辑那句、没有保存按钮；第三种只写「打不开这个报价单：无权查看该项目」；第四种写那句 409 并有去报价页的链接；四种都没有空白表单（`npx tsx src/lib/quote/__tests__/legacy-quote-finance-view.test.ts`）

### Requirement: 智能体报价技能按执行的人判
报价技能（问青砚 `project_bid_quote`、智能体任务与一键投标方案的报价步骤）SHALL 按执行这一步的人判财务查看权。审查指定的报价不属于本项目时 SHALL 返回「报价单不存在」。没有财务查看权时审查 SHALL NOT 调模型，结果 SHALL NOT 含成本价、内部成本、利润率与利润率检查项，带 `costHidden: true`；起草 SHALL NOT 调模型，返回失败「没有起草：起草报价草稿要看供应商报价并填成本价，只给项目负责人和有全企业「查看项目结算」权限的人用。」。有财务查看权的人 SHALL 与改动前相同。

#### Scenario: 只读成员经问青砚审查与起草
- **WHEN** 只读成员经 `project_bid_quote` 审查本项目报价、审查另一个项目的报价 ID、起草报价；负责人再审查一次
- **THEN** 第一次成功、没有 AI 审查、规则检查里没有利润率、带 `costHidden`；第二次「报价单不存在」；第三次失败与那句话；三次假模型服务都没收到请求；负责人那次假模型服务收到一次、结果里有利润率检查（`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`）

### Requirement: 问青砚报价工具先查项目读权限
问青砚 `project_bid_quote` 与 `project_get_project_quotes` SHALL 先按项目读权限判调用者（平台超级管理员；项目已分发且是负责人、组织管理员或项目 active 成员），不过时 SHALL 返回「项目不存在或不属于当前组织」且 SHALL NOT 读报价、SHALL NOT 调模型。`project_get_project_quotes` 对没有财务查看权的人每份报价的 `profitMargin` SHALL 为 `null`、带 `costHidden: true`，小计与总额 SHALL 照旧；有财务查看权的人 SHALL 与改动前相同。

#### Scenario: 普通组织成员与只读成员查报价
- **WHEN** 不是项目成员的普通组织成员、只读成员、项目负责人分别调 `project_get_project_quotes`
- **THEN** 第一人得到「项目不存在或不属于当前组织」；只读成员拿到总额、`profitMargin` 为 `null`、带 `costHidden`；负责人拿到利润率 23.45（`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`）
