## MODIFIED Requirements

### Requirement: 改总价进入审批
对状态为 `signed` 或 `accepted` 的报价提交修改，若按提交内容重新计算的总价与当前总价相差超过 0.005，系统 SHALL NOT 修改报价，SHALL 生成一条 `sales.update_signed_quote` 审批并返回 202，响应含审批 ID。提交人 SHALL 是对该报价有修改权的人。

#### Scenario: 合价人改签约单总价
- **WHEN** 持 `pricing_lead` 岗位的人把一份已签约报价的一行宽度改大，使总价从 1000 变为 1080
- **THEN** 返回 202 与审批 ID；报价的行、总价、状态、签约时间均未变

#### Scenario: 总价不变的修改直接生效
- **WHEN** 持 `pricing_lead` 岗位的人只修改已签约报价的备注
- **THEN** 返回 200，修改按原流程生效，不生成审批

#### Scenario: 让利首次计入库里总价也进入审批
- **WHEN** 一份在让利计入库里金额之前签约的报价，特别让利 100、税率 0.13，库里总价仍是让利前的 1130；合价人不改产品行、附加项目与让利，重新保存
- **THEN** 重新计算的总价为 1017（与 1130 相差超过 0.005），返回 202 与审批 ID，不按"总价不变"直接生效；报价的总价、状态、签约时间均未变；`NODE_ENV=test npx tsx src/lib/sales/__tests__/signed-quote-amount-db.isolated.test.ts` 覆盖
