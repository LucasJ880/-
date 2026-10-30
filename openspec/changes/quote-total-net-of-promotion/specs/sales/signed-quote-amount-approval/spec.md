## ADDED Requirements

### Requirement: 只改特别让利同样视为改总价
对状态为 `signed` 或 `accepted` 的报价，提交修改时若只改了特别让利，按提交内容重新计算的含税总额 SHALL 随让利变化，并按「改总价进入审批」处理：相差超过 0.005 时 SHALL 返回 202 并生成 `sales.update_signed_quote` 审批，报价 SHALL NOT 改变。

#### Scenario: 签约后加让利
- **WHEN** 持 `pricing_lead` 岗位的人把一份已签约报价的特别让利从 0 改为 50，其它内容不变
- **THEN** 返回 202 与审批 ID；报价的含税总额、`specialPromotion`、状态、签约时间均未变；`npx tsx src/lib/sales/__tests__/signed-quote-amount-db.isolated.test.ts` 覆盖

#### Scenario: 让利不变的修改仍直接生效
- **WHEN** 同一人只修改该已签约报价的备注，特别让利保持不变
- **THEN** 返回 200，不生成审批
