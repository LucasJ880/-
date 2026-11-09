# Spec Delta

## ADDED Requirements

### Requirement: /settings 索引只列放行的卡片
`/settings` 索引页的「邮箱绑定」卡片 SHALL 只在 `/settings/email` 对当前用户放行时出现。其余卡片的出现条件不变：「数字员工学习」「数字员工技能」只对平台 super_admin，「微信集成」随微信入口开关，外观、账号与企业、通知偏好对所有人。

#### Scenario: 安装工的设置页
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`，以只持 `installer` 岗位的输入判定设置页卡片
- **THEN** 没有「邮箱绑定」；只持 `sales_rep` 岗位时有，测试通过

### Requirement: 营销数字员工卡片只在其页面放行时出现
数字员工工作台的「营销增长数字员工」卡片 SHALL 只在营销数字员工页（`/marketing/employee`）对当前用户放行时出现（平台 super_admin 一律出现），SHALL NOT 按岗位派生的平台角色判定。

#### Scenario: 哪些岗位看得到营销员工
- **WHEN** 运行同一测试
- **THEN** 只持 `ops_staff`、`ops_lead`、`owner` 时卡片出现；只持 `sales_rep`、`accounting`、`installer`、`fulfillment_vinyl` 时不出现；源码断言工作台按该页面判定，测试通过
