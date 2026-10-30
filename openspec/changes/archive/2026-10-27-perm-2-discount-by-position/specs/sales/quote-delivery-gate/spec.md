# Spec Delta

## Purpose

报价交付闸：报价送到客户面前之前的前置条件——超限折扣未批不得发送、分享、签名，且发送权限按岗位而不是按"创建人或平台管理员"。

## ADDED Requirements

### Requirement: 超限未批不得交付
当报价的超限折扣审批状态不是已批准时，标记已发送、邮件发送、分享链接查看、分享链接签名、分享链接 PDF 五个出口 SHALL 返回 409，响应 `code` 为 `PROMOTION_APPROVAL_REQUIRED`，并 SHALL NOT 发出邮件、SHALL NOT 更新发送状态。

#### Scenario: 分享链接查看
- **WHEN** 客户打开一条超限折扣尚未批准的报价分享链接
- **THEN** 返回 409 `PROMOTION_APPROVAL_REQUIRED`，不返回报价内容

#### Scenario: 分享链接签名
- **WHEN** 客户对超限未批的报价提交签名
- **THEN** 返回 409，报价未被标记为已签

#### Scenario: 已批后放行
- **WHEN** 超限折扣已批准且金额比例与审批快照一致
- **THEN** 五个出口按原流程放行

### Requirement: 发送权限按岗位
标记已发送与邮件发送 SHALL 要求操作者对该报价持有 `sales.quote.send`（本人范围或全企业范围），而不是"创建人或平台管理员"。

#### Scenario: 合价人发他人报价
- **WHEN** 持 `pricing_lead` 岗位的人对销售 Alex 创建的报价执行邮件发送
- **THEN** 允许

#### Scenario: 销售发他人报价
- **WHEN** 销售 Lynn 对 Alex 创建的报价执行标记已发送
- **THEN** 返回 403

#### Scenario: 平台管理员
- **WHEN** 平台 super_admin 对任一报价执行发送
- **THEN** 允许
