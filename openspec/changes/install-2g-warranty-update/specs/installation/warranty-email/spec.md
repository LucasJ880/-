# Spec Delta

## ADDED Requirements

### Requirement: 抄送来源
质保邮件的抄送地址 SHALL 只取自生成审批时企业质保设置里的抄送列表；尾款确认、重新生成与批准接口 SHALL NOT 从请求参数读取抄送地址或收件地址。

#### Scenario: 请求里带抄送
- **WHEN** 会计调用重新生成接口时在请求体里带 `cc: ["someone@example.com"]`、`to: "someone@example.com"`
- **THEN** 审批内容的收件人仍为客户档案邮箱、抄送仍为设置里的地址，都不含 someone@example.com（`warranty-db.isolated.test.ts`）

### Requirement: 报价单质保文字
报价单 PDF 的 Shutters 段 SHALL 写 "Warranty: 1 year labour / 15 years components / 25 years frame & panels."；帘类段与窗帘段 SHALL 写 "Warranty: 1 year labour · 5 years fabric · 15 years components."。各段年限 SHALL 与质保设置种子一致。

#### Scenario: 与种子一致
- **WHEN** 对照报价单 PDF 各段质保文字与质保设置种子
- **THEN** Shutters 段为人工 1 / 部件 15 / 框架与叶片 25 年，帘类与窗帘段为人工 1 / 面料 5 / 部件 15 年（`warranty.test.ts`）

## MODIFIED Requirements

### Requirement: 质保设置
系统 SHALL 为每个企业保存质保设置：按品类（`shades` 帘类、`drapery` 窗帘、`vinyl` Shutters）× 部件（`labour` 人工、`fabric` 面料、`components` 部件、`frame` 框架与叶片、`motor` 电机）的年限，联系方式（公司名、电话、邮箱、地址、质保条款链接），以及质保邮件抄送地址列表。企业从未保存时 SHALL 使用种子：帘类与窗帘为人工 1 年、面料 5 年、部件 15 年；Shutters 为人工 1 年、部件 15 年、框架与叶片 25 年；公司名 Sunny Shutter Inc、电话 647-857-8669、邮箱 service@sunnyshutter.ca、地址 2-680 Progress Avenue, Scarborough, ON M1H 3A5、条款链接 https://sunnyshutter.ca/warranty-service/；抄送 miki@sunnyshutter.ca。企业已保存的设置 SHALL 原样使用、SHALL NOT 被种子覆盖；已保存但没有抄送项的设置 SHALL 视为不抄送。

#### Scenario: 从未保存
- **WHEN** 企业从未保存质保设置时读取
- **THEN** Shutters 为人工 1 / 部件 15 / 框架与叶片 25 年；帘类为人工 1 / 面料 5 / 部件 15 年；电话 647-857-8669、邮箱 service@sunnyshutter.ca；抄送为 miki@sunnyshutter.ca（`warranty.test.ts`、`warranty-db.isolated.test.ts`）

#### Scenario: 已保存的旧设置
- **WHEN** 企业保存过的设置是 Shutters 人工 1 / 部件 5 且没有抄送项
- **THEN** 读取仍为 Shutters 人工 1 / 部件 5，抄送为空（`warranty.test.ts`）

### Requirement: 质保设置读写
`GET /api/install/warranty-settings` SHALL 对当前企业持 ORG 范围 `accounting.read`、`install.balance.confirm` 或 `sales.settings.manage` 的成员返回设置与 `canEdit`，其余 403。`PUT` SHALL 要求 `sales.settings.manage`（老板），否则 403；年限须为 0–50 的整数、部件只能取上述五种、邮箱与网址格式有效、抄送地址每个格式有效且合并重复（不分大小写）后不超过 5 个，否则 400。保存 SHALL 只改 `sunnyWarranty` 这一个设置键并记一条审计。

#### Scenario: 老板保存
- **WHEN** 老板把电话设为 647-555-0100、邮箱设为 service@example.com 并保存
- **THEN** 返回 200，再读取得到新值，其他设置键不变，审计一条（`warranty-db.isolated.test.ts`）

#### Scenario: 老板设置抄送
- **WHEN** 老板把抄送设为 "Miki@Fixture.test, miki@fixture.test, office@fixture.test" 并保存
- **THEN** 返回 200，再读取抄送为 miki@fixture.test、office@fixture.test 两个（`warranty-db.isolated.test.ts`）

#### Scenario: 会计只读
- **WHEN** 会计读取设置
- **THEN** 返回 200 且 `canEdit` 为 false；会计提交保存返回 403

#### Scenario: 非法年限
- **WHEN** 提交 Shutters 部件 99 年
- **THEN** 返回 400，设置不变

#### Scenario: 非法抄送
- **WHEN** 提交抄送 "not-an-email"，或 6 个不同的抄送地址
- **THEN** 返回 400，设置不变（`warranty.test.ts`、`warranty-db.isolated.test.ts`）

### Requirement: 邮件内容
质保邮件 SHALL 为英文，主题为 `Your Sunny Shutter installation is complete — Warranty W-<单号> (Order <单号>)`；正文与 HTML SHALL 来自同一份内容，包含质保编号 `W-<单号>`、单号、客户名、安装地址、安装日（企业时区的安装完成日期）、每个收口单元的位置 / 产品 / 面料、单内每个品类的各部件年限与到期日（安装日加年限，部件按人工、面料、部件、框架与叶片、电机的顺序）、质保条款链接、报修电话 / 邮箱 / 地址。同样输入 SHALL 得到完全相同的邮件。

#### Scenario: Shutters 单
- **WHEN** 安装日 2026-10-28、只有 2 扇 Vinyl 窗、使用种子年限
- **THEN** 正文列出 2 扇窗，覆盖段只有 Shutters："Labour 1 yr (until 2027-10-28)"、"Components 15 yr (until 2041-10-28)"、"Frame & Panels 25 yr (until 2051-10-28)"（`warranty.test.ts`）

### Requirement: 尾款确认后生成审批
尾款确认首次成功（非幂等返回）且满足生成条件时，系统 SHALL 创建一条 `install.send_warranty_email` 审批，批准人为确认尾款的人，内容为已定稿的收件人、抄送、主题、正文与 HTML；抄送为生成时企业质保设置里的抄送地址去掉与收件人相同（不分大小写）的地址。确认接口响应 SHALL 带审批 id 与邮件预览（收件人、抄送、主题、HTML）。批准前 SHALL NOT 发出任何邮件。

#### Scenario: 确认后待批准
- **WHEN** 资料齐全，会计确认尾款
- **THEN** 响应含 `warranty.status = pending_approval` 与审批 id，审批人为该会计，邮件发送次数为 0（`warranty-db.isolated.test.ts`）

#### Scenario: 预览带抄送
- **WHEN** 设置里抄送为 miki@fixture.test 与客户本人邮箱，会计确认尾款
- **THEN** 预览与审批内容的抄送只有 miki@fixture.test，发送次数为 0（`warranty-db.isolated.test.ts`）

### Requirement: 批准后发送
质保邮件审批被批准后，系统 SHALL 重新校验：工艺单属本企业且已确认尾款、收件人等于客户档案当前邮箱（不一致 SHALL 拒发 `RECIPIENT_MISMATCH`）、审批内容里的抄送地址格式有效且不超过 5 个（否则 SHALL 拒发 `INVALID_PAYLOAD`）、企业已配置组织发件身份（未配置 SHALL 拒发 `NO_ORG_SENDER`，SHALL NOT 改用任何个人邮箱）。通过后以组织发件身份发出并抄送审批内容里的地址（发件域名未验证时按既有规则用平台地址代发、显示名与回复地址仍为组织的），成功 SHALL 写审计 `install.warranty.sent`（收件人、抄送、主题、发件地址、消息 id）。

#### Scenario: 批准发送
- **WHEN** 会计批准待发的质保邮件，组织已配置发件身份，审批内容抄送 miki@fixture.test
- **THEN** 发送一次且抄送 miki@fixture.test，审计 `install.warranty.sent` 一条且记录抄送，审批状态为已执行（`warranty-db.isolated.test.ts`，测试发件通道）

#### Scenario: 不抄送
- **WHEN** 设置里抄送为空时生成并批准
- **THEN** 发送一次，不带抄送（`warranty-db.isolated.test.ts`）

#### Scenario: 未配置发件身份
- **WHEN** 组织未配置发件身份时批准
- **THEN** 不发送，审批失败原因 `NO_ORG_SENDER`，批准人收到失败通知

#### Scenario: 客户邮箱已改
- **WHEN** 生成后客户档案邮箱被改为另一个地址再批准
- **THEN** 不发送，原因 `RECIPIENT_MISMATCH`
