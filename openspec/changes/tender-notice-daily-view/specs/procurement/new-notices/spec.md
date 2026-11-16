## Purpose

规定采购监控里怎么看新标（只看未截标的招标公告、按发布日期排、带公告链接），以及怎么在页面上改扫描时间。

## ADDED Requirements

### Requirement: 新标视图
`GET /api/procurement/candidates?view=new` SHALL 只返回本组织的招标公告中截标时间未过（或未知）、且没有被忽略或归档的，按发布日期从新到旧排（没有发布日期的按首次发现时间、排在有发布日期的之后），SHALL NOT 按资料申请优先级重排。候选页 SHALL 提供「新标（未截标的招标公告）」筛选并用这个视图。

#### Scenario: 只看还能投的新标
- **WHEN** 组织里有新标、已截标的公告、合同、被忽略的公告
- **THEN** 新标视图只列新标，最新发布的在前（`npx tsx src/lib/procurement-records/__tests__/new-notices-db.isolated.test.ts`）

#### Scenario: 别的组织
- **WHEN** 另一个组织的成员请求新标视图
- **THEN** 看不到本组织的任何公告（`new-notices-db.isolated.test.ts`）

### Requirement: 发布日期与公告链接
候选接口的每一行 SHALL 带 `publishedAt` 与 `noticeUrl`；公告链接 SHALL 与「跟这个标」预填的链接取同一条证据（最新一条有链接的，优先 CanadaBuys 招标公告来源），没有就为空。候选卡片 SHALL 显示发布日期，有公告链接的招标公告 SHALL 显示「看公告」并在新窗口打开。

#### Scenario: 有 CanadaBuys 链接
- **WHEN** 一条公告有两条 CanadaBuys 证据和一条别的来源
- **THEN** `noticeUrl` 是最新那条 CanadaBuys 的链接，与跟标建出的项目里的公告链接相同（`npx tsx src/lib/procurement-records/__tests__/new-notices-pure.test.ts`；`new-notices-db.isolated.test.ts`）

### Requirement: 页面上改扫描时间
采购监控设置页 SHALL 让组织管理员选星期几（可多选，至少一天）与时刻，并提供「每天」「工作日」「默认（周一、周四）」快捷按钮；保存 SHALL 只在排期与打开时不同时才把排期放进请求；没选任何一天或时刻不合法 SHALL 不发请求并写明原因。非管理员 SHALL 只能看。排期说明 SHALL 把七天写成「每天」、周一到周五写成「每个工作日」。

#### Scenario: 一键改成每天
- **WHEN** 管理员点「每天」后保存
- **THEN** 请求里排期是七天、时刻不变；读回来下一次运行在明天（或今天稍后）该时刻，说明写「每天」（`new-notices-pure.test.ts`；`new-notices-db.isolated.test.ts`）

#### Scenario: 只改关键词
- **WHEN** 管理员只改关键词就保存
- **THEN** 请求里没有排期，别人刚改过的排期不被覆盖（`new-notices-pure.test.ts`）

#### Scenario: 一天都没选
- **WHEN** 管理员把星期几全取消后保存
- **THEN** 不发请求，写明至少选一天（`new-notices-pure.test.ts`）
