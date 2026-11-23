## MODIFIED Requirements

### Requirement: 按招标方价格表导出
② 的报价区底部 SHALL 有「按招标方价格表导出」：当前我方报价已定且是逐行报价时可用，否则 SHALL 不可用并写明原因与去哪里做（没定时写明报价定为我方报价后才能导出、在这一页打开报价点「定为我方报价」，没有批准权限的点「提交给负责人」；有新版还没定时写明新版定为我方报价后才能导出；原因里 SHALL NOT 再写「在专业模式里做」；我方报价是只报总价的报价时写明它没有逐行单价、不能按价格表导出、要价格表请用逐行报价做一份；我方报价是专业模式做的时写明这里只能导出逐行报价）；导出处 SHALL 写明导出的是逐行表里的行、交出去前与招标方价格表核对。导出接口（`GET /api/projects/{id}/bid-page/quotes/{quoteId}/export`）SHALL 返回 CSV（`text/csv`，附件文件名含报价编号与版本），单价与行合计 SHALL 与逐行表相同；以 = + - @ 或制表符、回车开头的品名 SHALL 在前面加 ' 以免被表格软件当成公式；不是当前我方报价、不是逐行报价、缺单价、引擎算不出时 SHALL 返回 409 并写明原因；没有财务查看权时 SHALL 返回 403。

#### Scenario: 已定后导出
- **WHEN** 逐行报价已批准并选为我方报价，导出
- **THEN** 得到 CSV 附件（`text/csv`，文件名 `price-schedule-<报价编号>-v1.csv`），表头是招标方价格表的列，各行单价、行合计与合计与逐行表相同（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts`）

#### Scenario: 不能导出的情况
- **WHEN** 报价还是草稿；导出另一份不是我方报价的报价；没有财务查看权的人导出；另起新版后
- **THEN** 409「报价定为我方报价后才能导出」/ 409 / 403 / 我方报价状态是「新版待定」、不可用且原因写「新版还没定」（同一测试）

#### Scenario: 我方报价是总价报价
- **WHEN** 总价报价已批准并选为我方报价，看导出处、调导出接口
- **THEN** 不可用，原因写「我方报价是只报总价的，没有逐行单价，不能按招标方价格表导出；招标方要价格表的话，请用逐行报价做一份并定为我方报价」；导出接口 409（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts`）

#### Scenario: 品名像公式
- **WHEN** 品名是「=SUM(A1)」「+1」「-2」「@x」或以制表符开头
- **THEN** 导出时前面多一个 '；普通品名原样（`npx tsx src/lib/bid-page-v2/__tests__/quote-line.test.ts`）

#### Scenario: 没定时的原因
- **WHEN** 报价还是草稿时看导出处
- **THEN** 不可用，原因写「报价定为我方报价后才能导出」并说在这一页点「定为我方报价」或「提交给负责人」，没有「专业模式」四个字（`npx tsx src/lib/bid-page-v2/__tests__/quote-confirm.test.ts`）

### Requirement: 专业模式入口
逐行报价与总价报价的「更多」里 SHALL 有「用专业模式打开」，打开改版前的报价引擎页面（同一份报价）；列表里逐行报价与总价报价写「用专业模式打开」，不是新页面做的报价写「在专业模式里打开」，都链到专业模式。提交、批准、选为我方报价 SHALL 在本页的主按钮上做（见 `tender/quote-one-step-confirm`），专业模式里照旧也能做；逐行报价与总价报价 SHALL NOT 再写「提交、批准在专业模式里做」。

#### Scenario: 专业模式链接
- **WHEN** 渲染列表里一份逐行报价、一份总价报价与一份专业模式报价
- **THEN** 三者都有指向 `/projects/{id}/quote-engine/{quoteId}` 的入口，专业模式报价写「在专业模式里打开」（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`）

#### Scenario: 不再叫人去专业模式提交
- **WHEN** 渲染一份逐行报价草稿与一份总价报价草稿
- **THEN** 编辑器里没有「提交、批准在专业模式里做」，「更多」里仍有「用专业模式打开」（`npx tsx src/components/bid-page-v2/__tests__/quote-step.test.tsx`；`npx tsx src/components/bid-page-v2/__tests__/lump-sum-editor.test.tsx`）
