# installation/warranty-email Specification

## Purpose
尾款确认之后给客户的完工 + 质保确认邮件：质保年限与联系方式从哪里来、邮件写什么不写什么、什么时候生成发信审批、批准后以谁的身份发给谁、怎样保证一单只发一封，以及会计在页面上看到的状态。

## Requirements

### Requirement: 质保设置
系统 SHALL 为每个企业保存质保设置：按品类（`shades` 帘类、`drapery` 窗帘、`vinyl` Shutters）× 部件（`labour` 人工、`fabric` 面料、`components` 部件、`frame` 框架与叶片、`motor` 电机）的年限，联系方式（公司名、电话、邮箱、地址、质保条款链接），以及质保邮件抄送地址列表。企业从未保存时 SHALL 使用「质保设置种子」。企业已保存的设置 SHALL 原样使用、SHALL NOT 被种子覆盖；已保存但没有抄送项的设置 SHALL 视为不抄送。

#### Scenario: 从未保存
- **WHEN** 企业从未保存质保设置时读取
- **THEN** 返回「质保设置种子」，并标明尚未保存（`warranty.test.ts`、`warranty-db.isolated.test.ts`）

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

### Requirement: 收口单元品类
每个收口单元 SHALL 有品类：Blinds 行按产品类型（卷帘 / 斑马帘 / 香格里拉 → 帘类）；国内下单行 → 帘类；窗帘行 → 窗帘；Vinyl 行 → Shutters；外采购行按段（百叶 → Shutters、窗帘 → 窗帘、帘子 → 帘类）。产品类型无法识别的 Blinds 行 SHALL 无品类。

#### Scenario: 混合单
- **WHEN** 工艺单有 1 个斑马帘行，工艺参数有 1 个 Vinyl 窗与 1 个窗帘行
- **THEN** 三个单元的品类依次为帘类、窗帘、Shutters（`closeout-units.test.ts`）

### Requirement: 邮件内容
质保邮件 SHALL 为英文，主题为 `Your Sunny Shutter installation is complete — Warranty W-<单号> (Order <单号>)`；正文与 HTML SHALL 来自同一份内容，包含质保编号 `W-<单号>`、单号、客户名、安装地址、安装日（企业时区的安装完成日期）、每个收口单元的位置 / 产品 / 面料、单内每个品类的各部件年限与到期日（安装日加年限，部件按人工、面料、部件、框架与叶片、电机的顺序）、质保条款链接、报修电话 / 邮箱 / 地址。同样输入 SHALL 得到完全相同的邮件。

#### Scenario: Shutters 单
- **WHEN** 安装日 2026-10-28、只有 2 扇 Vinyl 窗、使用种子年限
- **THEN** 正文列出 2 扇窗，覆盖段只有 Shutters："Labour 1 yr (until 2027-10-28)"、"Components 15 yr (until 2041-10-28)"、"Frame & Panels 25 yr (until 2051-10-28)"（`warranty.test.ts`）

### Requirement: 邮件不输出的内容
质保邮件的主题、正文与 HTML SHALL NOT 含任何金额（合同价、应收、实收、定金、折扣）、成本、内部备注、确认人备注、收口照片地址或员工内部信息。

#### Scenario: 无金额
- **WHEN** 为应收 2600、实收 2500 的单生成邮件
- **THEN** 主题、正文、HTML 都不含 `2600`、`2500`、`$`、`CAD`（`warranty.test.ts`）

### Requirement: 生成条件
生成质保邮件 SHALL 要求：工艺单已有尾款确认记录、客户档案有邮箱、至少一个收口单元、单内每个单元都有品类且该品类已配置年限、设置里电话与邮箱都已填。任一不满足 SHALL NOT 生成审批，并 SHALL 返回全部未满足的原因；尾款确认本身不受影响。

#### Scenario: 缺联系方式
- **WHEN** 设置里电话为空时会计确认尾款
- **THEN** 尾款确认 200，响应里质保邮件状态为 `blocked`，原因含"缺报修电话"，没有新审批

#### Scenario: 客户没有邮箱
- **WHEN** 客户档案邮箱为空
- **THEN** 原因含"客户没有邮箱"

### Requirement: 尾款确认后生成审批
尾款确认首次成功（非幂等返回）且满足生成条件时，系统 SHALL 创建一条 `install.send_warranty_email` 审批，批准人为确认尾款的人，内容为已定稿的收件人、抄送、主题、正文与 HTML；抄送为生成时企业质保设置里的抄送地址去掉与收件人相同（不分大小写）的地址。确认接口响应 SHALL 带审批 id 与邮件预览（收件人、抄送、主题、HTML）。批准前 SHALL NOT 发出任何邮件。

#### Scenario: 确认后待批准
- **WHEN** 资料齐全，会计确认尾款
- **THEN** 响应含 `warranty.status = pending_approval` 与审批 id，审批人为该会计，邮件发送次数为 0（`warranty-db.isolated.test.ts`）

#### Scenario: 预览带抄送
- **WHEN** 设置里抄送为 miki@fixture.test 与客户本人邮箱，会计确认尾款
- **THEN** 预览与审批内容的抄送只有 miki@fixture.test，发送次数为 0（`warranty-db.isolated.test.ts`）

### Requirement: 重新生成
`POST /api/accounting/balance/{orderId}/warranty` SHALL 要求 ORG 范围 `install.balance.confirm`；工艺单未确认尾款 SHALL 返回 409 `NOT_CONFIRMED`，已发送 SHALL 返回 409 `ALREADY_SENT`；已有待批准的审批 SHALL 返回 200 与该审批；否则按「生成条件」生成新审批或返回 `blocked` 与原因。

#### Scenario: 补齐电话后重新生成
- **WHEN** 先前因缺电话被阻断，老板补齐后会计点"生成质保邮件"
- **THEN** 返回 200、`pending_approval` 与新审批 id

#### Scenario: 已发送
- **WHEN** 该单质保邮件已发送后再次生成
- **THEN** 返回 409 `ALREADY_SENT`

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

### Requirement: 一单只发一封
同一工艺单 SHALL 至多成功发送一封质保邮件。已有 `install.warranty.sent` 记录时，执行器 SHALL 拒发（`ALREADY_SENT`），重新生成接口 SHALL 返回 409。

#### Scenario: 两条审批先后批准
- **WHEN** 同一单的两条质保审批先后被批准
- **THEN** 只有第一条发出，第二条失败原因 `ALREADY_SENT`（`warranty-db.isolated.test.ts`）

### Requirement: 审批渠道
`install.send_warranty_email` SHALL 归为对外发送类：SHALL NOT 能通过微信回数字确认，Muse 侧 SHALL NOT 能直接批准，只能在网页看完预览后批准。

#### Scenario: 分类
- **WHEN** 读取微信确认策略
- **THEN** `install.send_warranty_email` 属对外发送类，不在可回数字确认的白名单内（`wechat-confirm-policy.test.ts`）

### Requirement: 质保邮件状态展示
待收尾款列表的 `recentConfirmed` 每条 SHALL 带质保邮件状态：`blocked`（附原因）、`pending_approval`（附审批 id）、`sent`（附发送时间）、`failed`（附原因）、`rejected` / `expired`、`none`（从未生成）；`failed` / `rejected` / `expired` / `blocked` / `none` SHALL 在页面上可点"生成质保邮件"。

#### Scenario: 发送后
- **WHEN** 质保邮件已发送
- **THEN** 该行状态为 `sent` 与发送时间，不显示"生成质保邮件"

### Requirement: 质保邮件通知
发送成功 SHALL 通知该单销售（类型 `install_warranty_sent`，落到工艺单详情）；发送失败 SHALL 通知批准人（类型 `install_warranty_failed`，落到 `/accounting?tab=balance&order=<id>`）。通知 SHALL NOT 含金额。

#### Scenario: 发送成功通知销售
- **WHEN** 质保邮件发送成功
- **THEN** 销售有一条 `install_warranty_sent`，点击落到工艺单详情（`warranty-db.isolated.test.ts`、`balance.test.ts`）

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

### Requirement: 质保设置种子
企业从未保存质保设置时，系统 SHALL 使用以下种子：帘类与窗帘为人工 1 年、面料 5 年、部件 15 年；Shutters 为人工 1 年、部件 15 年、框架与叶片 25 年；公司名 Sunny Shutter Inc、电话 647-857-8669、邮箱 service@sunnyshutter.ca、地址 2-680 Progress Avenue, Scarborough, ON M1H 3A5、条款链接 https://sunnyshutter.ca/warranty-service/；抄送 miki@sunnyshutter.ca。

#### Scenario: 种子内容
- **WHEN** 企业从未保存质保设置时读取
- **THEN** Shutters 为人工 1 / 部件 15 / 框架与叶片 25 年；帘类为人工 1 / 面料 5 / 部件 15 年；电话 647-857-8669、邮箱 service@sunnyshutter.ca；抄送为 miki@sunnyshutter.ca（`warranty.test.ts`、`warranty-db.isolated.test.ts`）
