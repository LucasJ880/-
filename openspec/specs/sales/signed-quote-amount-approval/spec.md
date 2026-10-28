# sales/signed-quote-amount-approval Specification

## Purpose
已签约报价改总价的两人把关：提交人改了已签约报价的总价时先进入审批，由另一位持签约改价审批权的人批准后才落库；总价不变的修改与未签约报价不受影响。

## Requirements

### Requirement: 改总价进入审批
对状态为 `signed` 或 `accepted` 的报价提交修改，若按提交内容重新计算的总价与当前总价相差超过 0.005，系统 SHALL NOT 修改报价，SHALL 生成一条 `sales.update_signed_quote` 审批并返回 202，响应含审批 ID。提交人 SHALL 是对该报价有修改权的人。

#### Scenario: 合价人改签约单总价
- **WHEN** 持 `pricing_lead` 岗位的人把一份已签约报价的一行宽度改大，使总价从 1000 变为 1080
- **THEN** 返回 202 与审批 ID；报价的行、总价、状态、签约时间均未变

#### Scenario: 总价不变的修改直接生效
- **WHEN** 持 `pricing_lead` 岗位的人只修改已签约报价的备注
- **THEN** 返回 200，修改按原流程生效，不生成审批

### Requirement: 同一报价只允许一条待批改价
当某报价已有待批的 `sales.update_signed_quote` 审批时，再次提交改总价的修改 SHALL 返回 409，响应 `code` 为 `SIGNED_QUOTE_APPROVAL_PENDING`，SHALL NOT 生成第二条审批。

#### Scenario: 重复提交
- **WHEN** 报价已有一条待批改价审批，合价人再提交一次改总价的修改
- **THEN** 返回 409 `SIGNED_QUOTE_APPROVAL_PENDING`

### Requirement: 没有另一位审批人时拒绝提交
提交改总价的修改时，若企业内除提交人外没有持 `sales.quote.signed_amount.approve` 的人、也没有企业负责人或企业管理员可作为兜底收件人，系统 SHALL 返回 409，响应 `code` 为 `NO_APPROVER`，SHALL NOT 生成审批，报价不变。

#### Scenario: 唯一老板改签约单总价
- **WHEN** 企业只有一位持 `owner` 岗位的人、且无其他兜底收件人，该老板修改已签约报价使总价变化
- **THEN** 返回 409 `NO_APPROVER`，报价不变

### Requirement: 批准人校验
执行改价审批时，批准人 SHALL 持有 `sales.quote.signed_amount.approve` 且 SHALL NOT 是提交人；平台 super_admin SHALL 可以批准，自己提交的也可以，此时审计 SHALL 记为自批。不满足时 SHALL 拒绝执行，报价不变。

#### Scenario: 提交人自批
- **WHEN** 持 `owner` 岗位的老板 A 批准自己提交的改价审批
- **THEN** 执行被拒绝，报价不变

#### Scenario: 另一位老板批准
- **WHEN** 老板 B（持 `sales.quote.signed_amount.approve`）批准老板 A 提交的改价审批
- **THEN** 报价按提交内容更新

### Requirement: 批准后按提交内容落库
批准执行 SHALL 用提交时的内容更新报价（行、附加项、费用、表单数据与重算后的金额），并按既有"已签约报价被修改"规则作废原签名、状态回到 `draft`；执行 SHALL 写审计（含提交人、批准人、改前与改后总价）并通知提交人。

#### Scenario: 批准后签名作废
- **WHEN** 改价审批被批准执行
- **THEN** 报价总价为新值，状态为 `draft`，原签名不再有效；审计含改前 1000、改后 1080

### Requirement: 报价已变化时不执行
若报价在提交审批之后又被修改过，执行 SHALL 失败并说明"报价已变化，请重新提交"，报价 SHALL 保持当前内容。

#### Scenario: 提交后报价被改
- **WHEN** 改价审批提交后，有人修改了该报价的备注，随后老板批准
- **THEN** 执行失败，报价保持备注修改后的内容

### Requirement: 平台 super_admin 直接生效
平台 super_admin 提交改总价的修改 SHALL 直接生效，SHALL 写审计并标记自批，SHALL NOT 生成审批。

#### Scenario: 平台管理员改签约单总价
- **WHEN** 平台 super_admin 修改已签约报价使总价变化
- **THEN** 返回 200，报价更新，审计标记自批

### Requirement: 审批内容不含成本
改价审批的标题、预览与通知 SHALL 只包含报价号、客户名、改前与改后总价及提交人；SHALL NOT 包含行级成本快照、成本率或毛利。

#### Scenario: 审批预览
- **WHEN** 读取一条改价审批的预览文字
- **THEN** 含报价号、改前与改后总价，不含任何成本或毛利数字

### Requirement: 只在网页审批
`sales.update_signed_quote` 审批 SHALL NOT 通过微信回数字确认，SHALL 只在网页审批中心处理。

#### Scenario: 微信确认策略
- **WHEN** 读取 `sales.update_signed_quote` 的微信确认策略
- **THEN** 为仅网页审批
