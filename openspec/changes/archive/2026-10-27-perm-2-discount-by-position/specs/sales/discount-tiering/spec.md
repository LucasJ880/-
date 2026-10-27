# Spec Delta

## Purpose

报价折扣分档：按折扣比例与操作者岗位决定"直接生效 / 合价直批 / 需审批"，并规定谁能提交、谁能批准超限折扣以及审计如何记录。

## ADDED Requirements

### Requirement: 合价上限可按企业配置
系统 SHALL 为每个企业提供合价上限（比例，0 到 1），默认 0.35；企业设置里 `pricing.leadMaxPct` 为 0 到 1 之间的有限数时 SHALL 覆盖默认值，非法值 SHALL 回落到默认值。合价上限 SHALL NOT 低于销售上限 `promoMaxPct`；低于时以销售上限为准。

#### Scenario: 默认 35%
- **WHEN** 企业未配置 `pricing.leadMaxPct`
- **THEN** 合价上限为 0.35

#### Scenario: 企业覆盖
- **WHEN** 企业设置 `pricing.leadMaxPct = 0.4`
- **THEN** 合价上限为 0.4

#### Scenario: 非法值回落
- **WHEN** 企业设置 `pricing.leadMaxPct = "abc"` 或 1.5 或 -0.1
- **THEN** 合价上限为 0.35

### Requirement: 折扣三档判定
保存报价（创建或修改）时，系统 SHALL 按下列顺序判定折扣档位：折扣 ≤ 销售上限 → `within_limit`，不需审批；销售上限 < 折扣 ≤ 合价上限且操作者持有 `sales.quote.discount.over_limit.submit` → `lead_direct`，直接记为已批准；操作者为平台 super_admin 且折扣 > 销售上限 → `platform_self_approved`，直接记为已批准；其余折扣 > 销售上限 → `approval_required`，报价进入待提交审批状态。平台角色 `admin` SHALL NOT 因角色获得直批。

#### Scenario: 销售在上限内
- **WHEN** 销售保存折扣 20%，销售上限 25%
- **THEN** 档位 `within_limit`，审批状态 `not_required`

#### Scenario: 销售超上限
- **WHEN** 销售（无超限提交权）保存折扣 30%，销售上限 25%，合价上限 35%
- **THEN** 档位 `approval_required`，审批状态 `required`，报价不可发送

#### Scenario: 合价人在合价上限内
- **WHEN** 持有超限提交权的人保存折扣 30%，合价上限 35%
- **THEN** 档位 `lead_direct`，审批状态 `approved`，审计记录 `via: pricing_lead`

#### Scenario: 合价人超合价上限
- **WHEN** 持有超限提交权的人保存折扣 40%，合价上限 35%
- **THEN** 档位 `approval_required`，审批状态 `required`

#### Scenario: 平台管理员自批
- **WHEN** 平台 super_admin 保存折扣 40%
- **THEN** 档位 `platform_self_approved`，审批状态 `approved`，审计记录 `via: platform_admin_self_approval` 且 `selfApproved: true`

#### Scenario: 平台 admin 不再直批
- **WHEN** 平台角色为 `admin`、无超限提交权的人保存折扣 30%，销售上限 25%
- **THEN** 档位 `approval_required`

### Requirement: 超限审批的收件人与批准人
提交超限审批时，系统 SHALL 把企业内持有 `sales.quote.discount.over_limit.approve` 的人作为审批收件人，并排除提交人；无人持有时 SHALL 回退为企业 ownerId 与 org_admin 成员。批准时，系统 SHALL 拒绝批准人等于提交人（平台 super_admin 除外，自批 SHALL 审计 `selfApproved: true`），且 SHALL 拒绝不持有该权限的批准人（super_admin 除外）。

#### Scenario: 老板收到审批
- **WHEN** 合价人提交 40% 折扣审批，企业有三位持审批权的老板
- **THEN** 三位老板收到通知，提交人不在收件人内

#### Scenario: 提交人不能自批
- **WHEN** 提交人本人（持审批权的老板）尝试批准自己提交的超限审批
- **THEN** 批准被拒绝，错误说明不能批准自己提交的审批

#### Scenario: 无审批权不能批
- **WHEN** 平台角色 `admin` 且无 `sales.quote.discount.over_limit.approve` 的人尝试批准
- **THEN** 批准被拒绝

#### Scenario: 无人持审批权时回退
- **WHEN** 企业内没有任何岗位绑定持有审批权
- **THEN** 收件人为企业 ownerId 与 org_admin 成员

### Requirement: 报价读写判定不因平台 admin 跳过
报价详情读取、修改、提交审批的授权 SHALL 统一走岗位授权判定；平台角色 `admin` SHALL NOT 因角色跳过判定；平台 super_admin 通过平台管理员全权获得允许。

#### Scenario: 平台 admin 读他人报价
- **WHEN** 平台角色 `admin`、无岗位绑定的人读取他人创建的报价
- **THEN** 返回 403
