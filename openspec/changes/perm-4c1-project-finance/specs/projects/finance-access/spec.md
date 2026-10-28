## Purpose

项目财务与报价引擎接口按岗位权限判定：谁有财务特权、谁能只读看全量、不是项目成员的会计怎样只读进入，以及企业成员角色不再单独构成特权。

## ADDED Requirements

### Requirement: 项目财务特权
在项目财务接口中，平台 super_admin、在项目所属企业持 `ORG` 范围 `project.finance.manage` 的人、项目负责人 SHALL 拥有财务特权：可编辑预算、审核费用、登记付款、替他人提交费用与上传票据、看全部费用与全部应付。企业成员角色 `org_admin` / `org_owner` 本身 SHALL NOT 构成财务特权（经岗位或兼容回退持有 `project.finance.manage` 时除外）。

#### Scenario: 老板岗位审核费用
- **WHEN** 持 `owner` 岗位、不是项目成员、企业成员角色为 `org_member` 的老板审核一笔已提交费用
- **THEN** 请求被允许

#### Scenario: 只有 org_admin 不再有特权
- **WHEN** 窗饰企业里企业成员角色为 `org_admin`、无任何岗位绑定的项目成员（项目角色无审核权）请求费用列表
- **THEN** 只返回本人提交的费用，响应标明不可审核

#### Scenario: 项目负责人仍有特权
- **WHEN** 项目负责人编辑预算
- **THEN** 请求被允许

### Requirement: 结算只读全量
在项目所属企业持 `ORG` 范围 `project.finance.read`、但不持财务特权的人 SHALL 可以只读访问该企业已派发项目的财务接口：预算、全部费用、全部应付、收入、汇总、表现、投标摘要。这类人 SHALL NOT 编辑预算、审核费用、登记付款、替他人提交费用或上传票据。

#### Scenario: 会计看全部费用
- **WHEN** 持 `accounting` 岗位的会计请求某项目费用列表
- **THEN** 返回该项目全部费用，响应标明不可审核

#### Scenario: 会计不能审核
- **WHEN** 会计请求审核一笔费用
- **THEN** 返回 403

### Requirement: 非项目成员的只读进入
持 `ORG` 范围 `project.finance.read` 或 `project.finance.manage` 的人 SHALL 能访问本企业已派发项目的财务接口，即使不是项目成员或负责人；访问其他企业的项目或未派发的项目 SHALL 返回 404 或 403，与原有规则一致。项目财务接口以外的项目接口对这类人的口径 SHALL 不变。

#### Scenario: 会计不是项目成员也能看汇总
- **WHEN** 不是项目成员的会计请求本企业某已派发项目的财务汇总
- **THEN** 返回 200

#### Scenario: 跨企业不可见
- **WHEN** 企业 A 的会计请求企业 B 项目的财务汇总
- **THEN** 不返回该项目财务数据

#### Scenario: 无结算键的非成员仍被拒
- **WHEN** 只持 `sales_rep` 岗位、不是项目成员的人请求项目财务汇总
- **THEN** 返回 403

### Requirement: 报价引擎特权
报价引擎接口 SHALL 把平台 super_admin、在项目所属企业持 `ORG` 范围 `project.finance.manage` 的人、项目负责人视为特权（可看内部成本、编辑、批准）；其余项目成员按项目角色判定。企业成员角色 `org_admin` 本身 SHALL NOT 构成报价引擎特权。

#### Scenario: org_admin 不再直通
- **WHEN** 企业成员角色为 `org_admin`、不持 `project.finance.manage`、项目角色为只读的项目成员请求报价内部成本
- **THEN** 不允许

#### Scenario: 老板直通
- **WHEN** 持 `owner` 岗位的项目成员请求批准报价
- **THEN** 允许
