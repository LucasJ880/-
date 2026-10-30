## ADDED Requirements

### Requirement: 特别让利从库里报价金额扣除
报价新建与编辑（含签约改价审批批准后的执行）落库时，报价的税前合计 SHALL 等于产品、附加项目、安装（补足最低安装费后）与运费之和减去提交的特别让利金额，结果低于 0 时 SHALL 取 0；税额 SHALL 按扣除后的税前合计乘税率，含税总额 SHALL 为二者之和。所有保存模式（全部算出、部分算出、只存表单）SHALL 用同一算式。提交的特别让利不是有限数字或为负时 SHALL 按 0 处理。报价记录的特别让利金额 SHALL 按提交值（负数与非数字按 0）保存，SHALL NOT 截到税前合计。

#### Scenario: 新建报价扣除让利
- **WHEN** 通过 `POST /api/sales/quotes` 新建报价，让利前税前合计 1000，`specialPromotion` 为 100，税率 0.13
- **THEN** 落库税前合计 900、税额 117、含税总额 1017，特别让利 100；`NODE_ENV=test npx tsx src/lib/sales/__tests__/quote-settings-db.isolated.test.ts` 经真实路由覆盖

#### Scenario: 编辑报价改让利
- **WHEN** 上一条报价经 `PUT /api/sales/quotes/[quoteId]` 重新保存，内容不变，`specialPromotion` 改为 0
- **THEN** 落库税前合计 1000、含税总额 1130，特别让利 0；`quote-settings-db.isolated.test.ts` 覆盖

#### Scenario: 让利超过合计时总额为 0
- **WHEN** 让利前税前合计 1000，`specialPromotion` 为 1500
- **THEN** 税前合计 0、税额 0、含税总额 0，报价记录的特别让利为 1500；`npx tsx src/lib/blinds/__tests__/quote-promotion.test.ts` 覆盖

#### Scenario: 非法让利按 0
- **WHEN** `specialPromotion` 为 -50 或不是数字
- **THEN** 税前合计与不带让利时相同，报价记录的特别让利为 0；`quote-promotion.test.ts` 覆盖

#### Scenario: 期间汇总按扣除后的金额计
- **WHEN** 上面"新建报价扣除让利"的报价被发出，期间汇总覆盖其发出日
- **THEN** 该报价计入报价金额的数为 1017，不是 1130；`quote-settings-db.isolated.test.ts` 覆盖

### Requirement: 不带让利的入口金额不变
不提交特别让利的报价入口（快速报价面板保存、快速报价预览接口、量房生成报价、AI 解析建单、agent 建单工具、量房页预估）计算出的税前合计、税额与含税总额 SHALL 与本要求生效前逐分相同；黄金用例对照 SHALL 全部通过。

#### Scenario: 无让利时与原算式相同
- **WHEN** 同一组产品行与附加项目分别以不带让利、让利为 0 两种方式计算报价合计
- **THEN** 两次的税前合计、税额、含税总额完全相等；`quote-promotion.test.ts` 覆盖，`npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` 158 条通过

### Requirement: 对客金额不重复扣除让利
发给客户的金额（报价邮件、公开分享页、客户 PDF）SHALL 继续优先取表单快照里的对客总价；在表单快照没有对客总价、也没有定金与尾款时 SHALL 取库里含税总额。任何对客出口 SHALL NOT 在库里含税总额或表单对客总价上再减一次特别让利。

#### Scenario: 表单对客总价原样展示
- **WHEN** 报价表单快照对客总价为 1017，库里含税总额为 1017，特别让利为 100
- **THEN** 邮件与分享页显示总价 1017，不是 917；`quote-promotion.test.ts` 覆盖

#### Scenario: 老快照回退到库里总额
- **WHEN** 报价表单快照没有对客总价、没有定金与尾款，库里含税总额为 1017
- **THEN** 邮件与分享页显示总价 1017；`quote-promotion.test.ts` 覆盖
