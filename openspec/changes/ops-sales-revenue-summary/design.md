# Design：运营看全公司销售额汇总（VIS-2）

## Decisions

### D1 新增窄权限键，不复用 `sales.analytics.read`
`sales.analytics.read`（ORG）会打开「团队销售分析」整页与期间汇总的按人明细（`byRep`）、客户矩阵，超出"只看销售额汇总"。新键 `sales.revenue.summary.read` 只支持 `ORG`，只用于一个只返回汇总数字的接口。
否决：给运营 `sales.analytics.read`（看到按人 / 按客户明细，拍板否决）。

### D2 口径复用销售期间汇总
用 `computeSalesPeriod`（KPI-1）在全企业范围算本周与本月至今，只取成单金额 / 成单数 / 报价金额 / 报价数；草稿、已归档客户、非 CAD 的处理与销售页完全一致，老板在销售页看到的数和运营看到的数一致。取数一次覆盖两个窗口的并集（跨月的周从本周一开始取）。

### D3 接口放行：全企业范围的汇总键或销售分析键
老板 / 合价 / 会计已有全企业 `sales.analytics.read`，汇总对他们不是新信息，所以也放行（老板进运营中心能看到同一张卡）。只有本人范围的 `sales.analytics.read`（销售人员）→ 403，避免销售经由这个接口看到全公司数字（拍板：销售只看本人）。

### D4 只输出白名单字段
响应只有 `timezone / currency / thisWeek / monthToDate / nonCadExcludedCount / truncated`，每个窗口只有 `from / to / wonAmount / wonCount / quotedAmount / quotedCount`。纯函数测试锁字段集合，DB 测试断言响应里没有客户名、销售员名 / id、报价 id。

### D5 卡片只在运营中心，无权不渲染
不新增导航项；卡片在 `/ops` 计数行下方，接口 403 时整张卡不出现（老板以外的非运营身份本来也进不了 `/ops`）。不链到销售页（运营没有销售页权限，链接会被路由门弹回）。

## Risks / Trade-offs

- 生效依赖重跑岗位模板落地：代码上线但没重跑时，运营岗没有新键，卡片不显示（不会报错）。
- 本周与本月至今两个窗口各算一次，取数上限沿用期间汇总（截断时卡片注明）。

## Migration Plan

无 schema 迁移。上线后对 Sunny 执行 `npx tsx scripts/seed-org-authorization.ts --org <Sunny code>`（Owner Gate；只 upsert 岗位与绑定、只动这一个企业；不用对全部企业生效的 `seed-security1-authorization.ts`）。回滚 = 还原代码；库里多出的 `sales.revenue.summary.read` 绑定在旧代码下不被任何接口使用，可留可删。
