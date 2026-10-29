# Spec Delta

## ADDED Requirements

### Requirement: 质保证书 PDF 附件
生成质保邮件审批时 SHALL 同时定稿英文质保证书（与邮件同一份数据：质保编号、单号、客户名、安装地址、安装日、各单元位置 / 产品 / 面料、各品类各部件年限与到期日、条款链接、报修电话 / 邮箱 / 地址）与附件名 `Warranty-W-<单号>.pdf`。批准后发送时 SHALL 把证书渲染为 PDF 作为附件随邮件发出；PDF 生成失败 SHALL 拒发 `PDF_FAILED`，SHALL NOT 发出不带附件的邮件。内容里没有证书的审批（本功能前生成）SHALL 照常发送且不带附件。审计 SHALL 记附件名与字节数。

#### Scenario: 带附件发送
- **WHEN** 会计批准待发的质保邮件，组织已配置发件身份
- **THEN** 发送一次，带一个附件 `Warranty-W-<单号>.pdf`（PDF 内容），审计记附件名与字节数（`warranty-db.isolated.test.ts`，测试发件通道与测试 PDF 渲染）

#### Scenario: PDF 生成失败
- **WHEN** 批准时 PDF 渲染失败
- **THEN** 不发送，审批失败原因 `PDF_FAILED`，批准人收到失败通知；列表可重新生成（`warranty-db.isolated.test.ts`）

#### Scenario: 旧审批
- **WHEN** 批准一条内容里没有证书的质保审批
- **THEN** 照常发送一次，不带附件（`warranty-db.isolated.test.ts`）

#### Scenario: 证书内容
- **WHEN** 为安装日 2026-10-28、2 扇 Vinyl 窗的单渲染证书
- **THEN** 证书含 "Warranty Certificate"、质保编号、单号、客户名、地址、两扇窗、Shutters 各部件年限与到期日、条款链接与报修联系方式；同样输入得到同样证书（`warranty.test.ts`）

#### Scenario: 真实渲染
- **WHEN** 用服务端 Chromium 渲染含中文产品名（如 "Vinyl 百叶"）的证书
- **THEN** 得到合法 PDF，文本可提取到质保编号与中文产品名（本地走查，`CHROME_EXECUTABLE_PATH` 指向本机 Chromium）

## MODIFIED Requirements

### Requirement: 邮件内容
质保邮件 SHALL 为英文，主题为 `Your Sunny Shutter installation is complete — Warranty W-<单号> (Order <单号>)`；正文与 HTML SHALL 来自同一份内容，包含质保编号、单号、客户名、安装地址、安装日（企业时区）、每个收口单元的位置 / 产品 / 面料、单内每个品类的各部件年限与到期日（安装日加年限，部件按「质保设置」所列顺序）、质保证书以 PDF 附件随附的说明、质保条款链接、报修电话 / 邮箱 / 地址。电机、电机配件、电池 SHALL 注明 "(if supplied)"，无绳升降机构 SHALL 注明 "(cordless models)"。同样输入 SHALL 得到完全相同的邮件。

#### Scenario: Shutters 单
- **WHEN** 安装日 2026-10-28、只有 2 扇 Vinyl 窗、使用种子年限
- **THEN** 正文列出 2 扇窗，覆盖段只有 Shutters："Labour 1 yr (until 2027-10-28)"、"Components 15 yr (until 2041-10-28)"、"Frame & Panels 25 yr (until 2051-10-28)"；正文写明证书见 PDF 附件（`warranty.test.ts`）

#### Scenario: 帘类单
- **WHEN** 安装日 2026-10-28、只有 1 个斑马帘、使用种子年限
- **THEN** 覆盖段只有 Shades & Blinds，依次为 Labour 1 yr、Fabric 5 yr、Components 15 yr、"Cordless Lift Mechanism (cordless models) 3 yr (until 2029-10-28)"、"Motor (if supplied) 5 yr (until 2031-10-28)"、"Motor Accessories (if supplied) 5 yr"、"Batteries (if supplied) 1 yr (until 2027-10-28)"（`warranty.test.ts`）

### Requirement: 邮件不输出的内容
质保邮件的主题、正文、HTML 与质保证书（HTML 与 PDF 附件）SHALL NOT 含任何金额（合同价、应收、实收、定金、折扣）、成本、内部备注、确认人备注、收口照片地址或员工内部信息。

#### Scenario: 无金额
- **WHEN** 为应收 2600、实收 2500 的单生成邮件与证书
- **THEN** 主题、正文、HTML、证书都不含 `2600`、`2500`、`$`、`CAD`（`warranty.test.ts`）

### Requirement: 尾款确认后生成审批
尾款确认首次成功（非幂等返回）且满足生成条件时，系统 SHALL 创建一条 `install.send_warranty_email` 审批，批准人为确认尾款的人，内容为已定稿的收件人、抄送、主题、正文、HTML、质保证书与附件名；抄送为生成时企业质保设置里的抄送地址去掉与收件人相同（不分大小写）的地址。确认接口响应 SHALL 带审批 id 与邮件预览（收件人、抄送、主题、HTML、附件名与证书）。批准前 SHALL NOT 发出任何邮件。

#### Scenario: 确认后待批准
- **WHEN** 资料齐全，会计确认尾款
- **THEN** 响应含 `warranty.status = pending_approval` 与审批 id，审批人为该会计，预览带附件名 `Warranty-W-<单号>.pdf` 与证书，邮件发送次数为 0（`warranty-db.isolated.test.ts`）

#### Scenario: 预览带抄送
- **WHEN** 设置里抄送为 miki@fixture.test 与客户本人邮箱，会计确认尾款
- **THEN** 预览与审批内容的抄送只有 miki@fixture.test，发送次数为 0（`warranty-db.isolated.test.ts`）
