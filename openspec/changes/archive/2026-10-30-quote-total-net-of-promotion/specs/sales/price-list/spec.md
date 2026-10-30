## ADDED Requirements

### Requirement: 特别让利计入报价金额
报价新建与编辑时，服务端 SHALL 从税前合计（产品 + 附加项目 + 安装 + 运费）中扣除提交的特别让利，扣后最低为 0，税额 SHALL 按扣后的税前合计计算。库里的税前合计、税额、含税总额 SHALL 为扣除后的值，特别让利金额 SHALL 继续单独保存。库里含税总额与报价单对客金额相差 SHALL NOT 超过 0.01。不提交特别让利的入口 SHALL 按让利为 0 计算。

#### Scenario: 让利 100 后的库里金额
- **WHEN** 报价单产品、附加项目、安装与运费合计税前 1109.375，特别让利 100，税率 0.13，经真实路由保存
- **THEN** 库里税前合计 1009.375、含税总额 1140.59（±0.01），`specialPromotion` 为 100；`quote-settings-db.isolated.test.ts` 覆盖

#### Scenario: 编辑时改让利
- **WHEN** 同一报价编辑保存，特别让利改为 0
- **THEN** 库里税前合计回到 1109.375，含税总额 1253.59（±0.01）

#### Scenario: 让利超过税前合计
- **WHEN** 税前合计 300，特别让利 500
- **THEN** 税前合计、税额、含税总额均为 0；`npx tsx src/lib/blinds/__tests__/quote-fees.test.ts` 覆盖

#### Scenario: 不带让利的入口不变
- **WHEN** 预览接口或量房生成报价计算同一组产品
- **THEN** 金额与本次改动前相同
