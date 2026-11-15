## Purpose
规定组织页上「询价与落地价设置」一节：只对组织管理员显示；保存只发人改过的项，效果与直接调现有接口相同；汇率必须带日期与来源。

## ADDED Requirements

### Requirement: 谁能看到
组织详情页 SHALL 只对组织管理员（org_admin）与平台管理员显示「询价与落地价设置」一节。其他成员 SHALL NOT 看到这一节，接口对他们 SHALL 仍返回 403。

#### Scenario: 组织管理员
- **WHEN** 组织管理员打开组织详情页
- **THEN** 看到这一节，里面是当前的发件设置与落地价参数（`npx tsx src/lib/tender-rfq/__tests__/settings-form.test.tsx`；`npx tsx src/lib/tender-rfq/__tests__/settings-form-db.isolated.test.ts`）

#### Scenario: 普通成员
- **WHEN** 组织里的普通成员打开组织详情页，或直接调接口
- **THEN** 没有这一节；接口 403，设置不变（`settings-form.test.tsx`；`settings-form-db.isolated.test.ts`）

### Requirement: 保存只发改过的项
保存 SHALL 只把人改过的项发给现有的 `PUT tender-rfq-settings`：没改的项 SHALL NOT 出现在请求里（原来存的值与环境变量回退都不变）；改成空 SHALL 发 null（清空）；汇率表改过就整张发。保存之后读回来的设置 SHALL 与直接用同样的请求调接口的结果相同。

#### Scenario: 只改了保险费率
- **WHEN** 管理员只把保险费率从 1 改成 1.5 后保存
- **THEN** 请求里只有 `landedCost.insurancePct = 1.5`；发件地址仍按环境变量回退（没有被写成固定值）（`settings-form.test.tsx`；`settings-form-db.isolated.test.ts`）

#### Scenario: 清空一项
- **WHEN** 管理员把清关杂费清空后保存
- **THEN** 请求里 `clearanceFlatCad = null`，读回来是空（`settings-form.test.tsx`；`settings-form-db.isolated.test.ts`）

#### Scenario: 项目关税率
- **WHEN** 管理员给一个招投标项目加关税率 6.5%，删掉另一个项目的设置
- **THEN** 请求里前者是 `{ dutyRatePct: 6.5 }`、后者是 null；别的组织的项目被接口拒绝（`settings-form.test.tsx`；`settings-form-db.isolated.test.ts`）

### Requirement: 汇率必须带日期与来源
汇率表里有数字时，页面 SHALL 要求填汇率日期与来源（手工 / 银行结算），缺了 SHALL 不发请求并写明缺什么。币种 SHALL 是三位大写代码、汇率 SHALL 大于 0；不合规的行 SHALL 写明哪一行不对。

#### Scenario: 填了汇率没填日期
- **WHEN** 管理员加了 USD 1.36，没有填日期
- **THEN** 页面提示「填写汇率时必须同时给出日期和来源」，不发请求（`settings-form.test.tsx`）

#### Scenario: 币种或汇率不对
- **WHEN** 币种写成 usd 或汇率写成 0
- **THEN** 页面写明那一行不对，不发请求（`settings-form.test.tsx`）

### Requirement: 写明用在哪里
这一节 SHALL 写明这些参数用于比价矩阵的落地价与报价表助手的成本建议，是组织的估算参数，落地价会标明出处；SHALL 写明授权邮箱与显示地址可以不同。这一节 SHALL NOT 显示或要求任何密码、令牌。

#### Scenario: 说明文字
- **WHEN** 渲染这一节
- **THEN** 有用途说明与两个地址的说明，没有密码或令牌输入框（`settings-form.test.tsx`）
