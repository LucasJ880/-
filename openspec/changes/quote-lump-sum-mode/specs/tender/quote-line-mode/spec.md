# Spec Delta

## MODIFIED Requirements

### Requirement: 新建报价先问怎么交价与业务类型
新页面开着、看得到金额且有报价编辑权限的人在 ② 新建报价时，系统 SHALL 先问「这个标怎么交价？」（逐行报价 / 只报总价）与「业务类型」（只供货、供货加安装、长期供货协议，默认只供货）。选逐行报价且只供货时 SHALL 新建一份逐行报价（只供货报价、报价币种加元、按售价毛利定价、报价配置里记做法为逐行），并在同一次写入里建好货品行（有可用价格表时）、四条共用参数行与四条预置行，写一条新建报价的审计；选只报总价且只供货或供货加安装时 SHALL 新建一份总价报价（见 `tender/quote-lump-sum-mode`）；其余组合 SHALL 照改版前的模板新建、不记做法，并返回专业模式的地址。新建接口是 `POST /api/projects/{id}/bid-page/quotes`，成功返回 201 与新报价的标识、做法、专业模式地址；请求里的做法或业务类型不认识时 SHALL 返回 400。

#### Scenario: 逐行 + 只供货
- **WHEN** 项目有校验通过的价格表（2 行），有编辑权限且有财务查看权的人选逐行报价、只供货
- **THEN** 201；新报价是只供货报价、做法为逐行，有 2 条货品成本行、4 条共用参数行、4 条预置行，审计里有一条新建报价（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 供货加安装
- **WHEN** 选逐行报价、业务类型「供货加安装」
- **THEN** 新报价与改版前同一模板、配置里没有做法，返回专业模式的地址（同一测试）

#### Scenario: 只报总价
- **WHEN** 选只报总价、只供货；选只报总价、长期供货协议；请求里的做法是不认识的值
- **THEN** 201、做法为只报总价；201、与改版前同一模板、没有做法、返回专业模式的地址；400（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 新建两问
- **WHEN** 打开「新建报价」
- **THEN** 「这个标怎么交价？」有逐行报价与只报总价两个选项；选只报总价、长期供货协议时写明长期供货协议在专业模式里做（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

#### Scenario: 没有编辑权限的人
- **WHEN** 看得到金额、没有编辑权限的人打开 ②
- **THEN** 没有「新建报价」，写着「新建、修改报价需要项目编辑权限，请找项目负责人」；调新建接口 403（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx` 与隔离库测试）

### Requirement: 做法记在报价配置里，旧报价按专业模式打开
报价配置 SHALL 接受可选的做法字段（逐行、只报总价）；没有这个字段的配置 SHALL 解析得与改版前相同（字段与键集合都相同）；不认识的做法值 SHALL 只丢掉这个字段、配置的其它内容照旧。做法字段 SHALL 只由新页面新建报价与互转时写：专业模式保存报价（表头里的引擎配置）SHALL NOT 接受这个字段，库里已有的做法 SHALL 在专业模式保存与另起新版后保留。只有做法为逐行且是只供货报价的才是逐行报价；做法为只报总价的按 `tender/quote-lump-sum-mode` 判定；其余报价 SHALL 在新页面上标为「专业模式」并链到专业模式页。

#### Scenario: 旧配置不受影响
- **WHEN** 用改版前的多种配置（空、只有税、带情景、长期供货协议的配置、含未知键）解析
- **THEN** 结果与去掉做法字段的校验深度相同、键集合相同（不多出做法键）；带不认识的做法值时税与情景照旧（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 只报总价的做法值
- **WHEN** 解析做法为只报总价的配置
- **THEN** 做法保留为只报总价，税与其它内容照旧（`npx tsx src/lib/bid-page-v2/__tests__/lump-sum.test.ts`）

#### Scenario: 专业模式保存不收做法字段
- **WHEN** 专业模式保存时请求里带了做法字段（逐行、只报总价、空、不认识的值），库里原来是逐行报价或不是
- **THEN** 表头解析后没有做法字段；库里原来是逐行的合并后仍是逐行，原来不是的仍不是（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 专业模式保存后做法还在
- **WHEN** 逐行报价、总价报价分别经专业模式的保存（引擎配置传空对象）与另起新版
- **THEN** 各自的做法都还在（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts` 与 `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 不是只供货的报价
- **WHEN** 一份供货加安装或长期供货协议报价的配置里带着逐行的做法字段
- **THEN** 不算逐行报价，按专业模式打开（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

### Requirement: 报价列表
报价列表（`GET /api/projects/{id}/bid-page/quotes`）SHALL 返回每份报价的名称、编号、版本、状态、做法（逐行、只报总价或专业模式）、币种、报价合计、是否我方报价、专业模式地址，以及能否编辑、可用价格表行数、能否导出（不能时的原因）；金额 SHALL 按每份报价自己的币种写。逐行报价与总价报价 SHALL 能在 ② 里直接打开。报价没有名称时 SHALL 显示业务类型加报价编号，SHALL NOT 显示内部标题（那里可能是英文类型码）。

#### Scenario: 列表内容
- **WHEN** 渲染一份逐行报价、一份总价报价与一份美元的供货加安装报价
- **THEN** 三份都列出做法（逐行报价 / 只报总价 / 专业模式）、版本、状态、报价合计（美元那份写美元）与我方报价标记；点开总价报价显示总价构成表（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

#### Scenario: 报价显示名
- **WHEN** 一份报价没有名称、编号 Q-1、是供货加安装
- **THEN** 显示「供货加安装报价 · Q-1」；有名称的显示名称（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

### Requirement: 按招标方价格表导出
② 的报价区底部 SHALL 有「按招标方价格表导出」：当前我方报价已定且是逐行报价时可用，否则 SHALL 不可用并写明原因与去哪里做（没定、有新版还没定时写明提交、批准、定为我方报价目前在专业模式里做；我方报价是只报总价的报价时写明它没有逐行单价、不能按价格表导出；我方报价是专业模式做的时写明这里只能导出逐行报价）；导出处 SHALL 写明导出的是逐行表里的行、交出去前与招标方价格表核对。导出接口（`GET /api/projects/{id}/bid-page/quotes/{quoteId}/export`）SHALL 返回 CSV（`text/csv`，附件文件名含报价编号与版本），单价与行合计 SHALL 与逐行表相同；以 = + - @ 或制表符、回车开头的品名 SHALL 在前面加 ' 以免被表格软件当成公式；不是当前我方报价、不是逐行报价、缺单价、引擎算不出时 SHALL 返回 409 并写明原因；没有财务查看权时 SHALL 返回 403。

#### Scenario: 已定后导出
- **WHEN** 逐行报价已批准并选为我方报价，导出
- **THEN** 得到 CSV 附件（`text/csv`，文件名 `price-schedule-<报价编号>-v1.csv`），表头是招标方价格表的列，各行单价、行合计与合计与逐行表相同（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 不能导出的情况
- **WHEN** 报价还是草稿；导出另一份不是我方报价的报价；没有财务查看权的人导出；另起新版后
- **THEN** 409「报价定为我方报价后才能导出」/ 409 / 403 / 我方报价状态是「新版待定」、不可用且原因写「新版还没定」（同一测试）

#### Scenario: 我方报价是总价报价
- **WHEN** 总价报价已批准并选为我方报价，看导出处、调导出接口
- **THEN** 不可用，原因写「我方报价是只报总价的报价，没有逐行单价，不能按价格表导出」；导出接口 409（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 品名像公式
- **WHEN** 品名是「=SUM(A1)」「+1」「-2」「@x」或以制表符开头
- **THEN** 导出时前面多一个 '；普通品名原样（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

### Requirement: 专业模式入口
逐行报价与总价报价的「更多」里 SHALL 有「用专业模式打开」，打开改版前的报价引擎页面（同一份报价）；列表里逐行报价与总价报价写「用专业模式打开」，不是新页面做的报价写「在专业模式里打开」，都链到专业模式。提交、批准、选为我方报价在本能力内 SHALL 仍在专业模式里做，逐行报价与总价报价 SHALL 写明「提交、批准在专业模式里做」。

#### Scenario: 专业模式链接
- **WHEN** 渲染列表里一份逐行报价、一份总价报价与一份专业模式报价
- **THEN** 三者都有指向 `/projects/{id}/quote-engine/{quoteId}` 的入口，专业模式报价写「在专业模式里打开」（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）
