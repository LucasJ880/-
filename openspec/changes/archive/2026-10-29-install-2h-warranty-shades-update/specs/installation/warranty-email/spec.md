# Spec Delta

## MODIFIED Requirements

### Requirement: 质保设置
系统 SHALL 为每个企业保存质保设置：按品类（`shades` 帘类、`drapery` 窗帘、`vinyl` Shutters）× 部件（`labour` 人工、`fabric` 面料、`components` 部件、`cordless` 无绳升降机构、`frame` 框架与叶片、`motor` 电机、`motor_accessories` 电机配件、`batteries` 电池）的年限，联系方式（公司名、电话、邮箱、地址、质保条款链接），以及质保邮件抄送地址列表。企业从未保存时 SHALL 使用「质保设置种子」。企业已保存的设置 SHALL 原样使用、SHALL NOT 被种子覆盖；已保存但没有抄送项的设置 SHALL 视为不抄送。

#### Scenario: 从未保存
- **WHEN** 企业从未保存质保设置时读取
- **THEN** 返回「质保设置种子」，并标明尚未保存（`warranty.test.ts`、`warranty-db.isolated.test.ts`）

#### Scenario: 已保存的旧设置
- **WHEN** 企业保存过的设置是 Shutters 人工 1 / 部件 5、帘类人工 1 / 面料 5 / 部件 15，且没有抄送项
- **THEN** 读取仍为保存的值（帘类没有无绳升降机构、电机等部件），抄送为空（`warranty.test.ts`）

### Requirement: 质保设置读写
`GET /api/install/warranty-settings` SHALL 对当前企业持 ORG 范围 `accounting.read`、`install.balance.confirm` 或 `sales.settings.manage` 的成员返回设置与 `canEdit`，其余 403。`PUT` SHALL 要求 `sales.settings.manage`（老板），否则 403；年限须为 0–50 的整数、部件只能取上述八种、邮箱与网址格式有效、抄送地址每个格式有效且合并重复（不分大小写）后不超过 5 个，否则 400。保存 SHALL 只改 `sunnyWarranty` 这一个设置键并记一条审计。

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

#### Scenario: 保存新部件
- **WHEN** 老板给帘类保存无绳升降机构 3 年、电池 1 年，或提交未知部件 `paint`
- **THEN** 前者返回 200 且读回同样的年限；后者返回 400（`warranty.test.ts`、`warranty-db.isolated.test.ts`）

### Requirement: 质保设置种子
企业从未保存质保设置时，系统 SHALL 使用以下种子年限：帘类为人工 1、面料 5、部件 15、无绳升降机构 3、电机 5、电机配件 5、电池 1 年；窗帘为人工 1、面料 5、部件 15、电机 5、电机配件 5、电池 1 年；Shutters 为人工 1、部件 15、框架与叶片 25 年。联系方式种子 SHALL 为公司名 Sunny Shutter Inc、电话 647-857-8669、邮箱 service@sunnyshutter.ca、地址 2-680 Progress Avenue, Scarborough, ON M1H 3A5、条款链接 https://sunnyshutter.ca/warranty-service/；抄送种子 SHALL 为 miki@sunnyshutter.ca。

#### Scenario: 种子内容
- **WHEN** 企业从未保存质保设置时读取
- **THEN** 帘类为 1 / 5 / 15 / 无绳 3 / 电机 5 / 配件 5 / 电池 1 年；窗帘为 1 / 5 / 15 / 电机 5 / 配件 5 / 电池 1 年；Shutters 为 1 / 15 / 25 年；电话 647-857-8669、邮箱 service@sunnyshutter.ca；抄送为 miki@sunnyshutter.ca（`warranty.test.ts`、`warranty-db.isolated.test.ts`）

### Requirement: 邮件内容
质保邮件 SHALL 为英文，主题为 `Your Sunny Shutter installation is complete — Warranty W-<单号> (Order <单号>)`；正文与 HTML SHALL 来自同一份内容，包含质保编号、单号、客户名、安装地址、安装日（企业时区）、每个收口单元的位置 / 产品 / 面料、单内每个品类的各部件年限与到期日（安装日加年限，部件按「质保设置」所列顺序）、质保条款链接、报修电话 / 邮箱 / 地址。电机、电机配件、电池 SHALL 注明 "(if supplied)"，无绳升降机构 SHALL 注明 "(cordless models)"。同样输入 SHALL 得到完全相同的邮件。

#### Scenario: Shutters 单
- **WHEN** 安装日 2026-10-28、只有 2 扇 Vinyl 窗、使用种子年限
- **THEN** 正文列出 2 扇窗，覆盖段只有 Shutters："Labour 1 yr (until 2027-10-28)"、"Components 15 yr (until 2041-10-28)"、"Frame & Panels 25 yr (until 2051-10-28)"（`warranty.test.ts`）

#### Scenario: 帘类单
- **WHEN** 安装日 2026-10-28、只有 1 个斑马帘、使用种子年限
- **THEN** 覆盖段只有 Shades & Blinds，依次为 Labour 1 yr、Fabric 5 yr、Components 15 yr、"Cordless Lift Mechanism (cordless models) 3 yr (until 2029-10-28)"、"Motor (if supplied) 5 yr (until 2031-10-28)"、"Motor Accessories (if supplied) 5 yr"、"Batteries (if supplied) 1 yr (until 2027-10-28)"（`warranty.test.ts`）

### Requirement: 报价单质保文字
报价单 PDF 的 Shutters 段 SHALL 写 "Warranty: 1 year labour / 15 years components / 25 years frame & panels."；帘类段 SHALL 写 "Warranty: 1 year labour · 5 years fabric · 15 years components · 3 years cordless lift mechanisms · 5 years motors & motor accessories (if supplied) · 1 year batteries (if supplied)."；窗帘段同帘类但没有无绳升降机构一项。帘类与窗帘 Order Form 页面 SHALL 显示与对应 PDF 段相同的质保文字。各处年限 SHALL 与质保设置种子一致。

#### Scenario: 与种子一致
- **WHEN** 对照报价单 PDF 三段与帘类、窗帘 Order Form 的质保文字与质保设置种子
- **THEN** 每处文字都由种子年限拼出且逐字一致；旧文字（只有人工 / 面料 / 部件）不再出现（`warranty.test.ts`）
