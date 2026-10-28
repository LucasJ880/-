# INSTALL-2 · 完工 + 质保邮件模板（Sunny Shutter）

| 项 | 值 |
|---|---|
| 用途 | 安装顺利完成 → 会计确认尾款到账 → 系统生成本邮件（PendingAction，审批后发出，硬纪律 2） |
| 收件人 | 订单客户邮箱（`Customer.email`）；抄送 = 该单销售（可选，待拍板 Q3） |
| 发件人 | 组织设置 `fromEmail`（展示）/ `mailboxEmail`（授权），不从请求取（硬纪律 6） |
| 语言 | 英文正文（多伦多客户）；中文只在本文件做说明，不进邮件 |
| 方案 | `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §3 |

## 0. 质保条款来源与核实状态（防幻觉）

`https://sunnyshutter.ca/warranty-service/` 在本次会话的网络策略里被拒（DNS / 代理 403），**原文未能直接读取**。下表只写检索摘要里能对上的内容，其余一律留 `{{待确认}}`，上线前由 Lucas / Evan 对着官网原文填。

| 条款 | 本模板取值 | 来源 | 状态 |
|---|---|---|---|
| Shutters 质保年限 | 25 years | 官网 `warranty-registration` 页检索摘要："25-year guarantee on all of its shutter products" | 检索摘要，需对原文 |
| 其它窗饰（Zebra / Roller 等）质保年限 | 5 years | 同上："5-year guarantee for other window covering solutions like Zebra and roller shades" | 检索摘要，需对原文 |
| 电机 / 遥控 / 充电器 | `{{待确认}}` | 官网有单独 "Sunny motor support plan" 页，内容未取到 | **未知，不得猜** |
| 人工 / 上门维修费 | `{{待确认}}` | 未取到 | **未知，不得猜** |
| 质保起算日 | 安装完成日（`installedAt`） | 行业惯例；官网未核实 | 需对原文 |
| 不保范围（人为损坏、改装、日晒褪色、自行拆装等） | `{{待确认}}` | 未取到 | **未知，不得猜**——模板只放链接，不自己写条款 |
| 报修联系方式 | 647-857-8669 / sales@sunnyshutter.ca | 检索摘要 | 需对原文 |
| 公司地址 | 2-680 Progress Avenue, Scarborough, ON M1H 3A5 | 维修单 PDF 抬头（用户提供） | 已确认 |

**原则**：邮件正文只列"产品 + 年限 + 起算日 + 怎么报修"，条款细则全部链接回官网 `warranty-service` 页，系统不复述、不改写条款——官网改了条款，邮件不会过时也不会和官网矛盾。

## 1. 变量表（全部来自系统已有数据，零 schema）

| 变量 | 取值来源 | 缺失时 |
|---|---|---|
| `{{customerName}}` | `Customer.name`（工艺单 `customerName` 兜底） | 阻断生成，进会计待办"缺客户信息" |
| `{{customerEmail}}` | `Customer.email` | **阻断生成**，提示会计/销售补邮箱 |
| `{{installAddress}}` | `Customer.address`（工艺单地址兜底） | 显示 "—" |
| `{{orderNumber}}` | `BlindsOrder.code`（= 报价 orderNumber） | 阻断 |
| `{{installDate}}` | `BlindsOrder.installedAt`（多次安装取**最后一次完成**的日期，即返修完成日） | 阻断 |
| `{{warrantyNo}}` | `W-{{orderNumber}}`（确定性生成，不新增编号器） | — |
| `{{items[]}}` | `BlindsOrderItem`：`location` / 产品线 / 面料或颜色 / 尺寸 | 至少 1 行，否则阻断 |
| `{{items[].warrantyYears}}` | 产品线 → 年限查表（`Organization.settingsJson.sunnyWarranty.terms`，会计/老板可改；种子 = 上表） | 产品线未配置 → 阻断，提示补质保表，**不默认任何年限** |
| `{{items[].warrantyUntil}}` | `installDate + warrantyYears`（日期计算，确定性） | — |
| `{{salesName}}` | 报价创建人 / 负责人姓名 | 省略该行 |
| `{{companyPhone}}` / `{{companyEmail}}` / `{{companyAddress}}` / `{{warrantyUrl}}` | `Organization.settingsJson.sunnyWarranty.contact` | 阻断 |

**不出现在邮件里的**：任何金额（合同价、尾款、折扣、已付）、成本、毛利、内部备注、安装照片原始 URL、返修历史内部描述。尾款收据另走会计既有渠道，不和质保邮件混发（避免一封邮件里出现金额）。

## 2. 邮件正文（English）

**Subject:** `Your Sunny Shutter installation is complete — Warranty {{warrantyNo}} (Order {{orderNumber}})`

```text
Hi {{customerName}},

Thank you for choosing Sunny Shutter. Your installation at {{installAddress}}
was completed on {{installDate}}, and your order is now fully closed.
This email is your warranty confirmation — please keep it for your records.

WARRANTY CONFIRMATION
  Warranty No.:   {{warrantyNo}}
  Order No.:      {{orderNumber}}
  Customer:       {{customerName}}
  Address:        {{installAddress}}
  Installed on:   {{installDate}}  (warranty starts on this date)

COVERED PRODUCTS
  #  | Location          | Product            | Warranty  | Covered until
  {{#items}}
  {{index}}  | {{location}} | {{productLine}} {{fabricOrColor}} | {{warrantyYears}} years | {{warrantyUntil}}
  {{/items}}

Full warranty terms, coverage and exclusions:
{{warrantyUrl}}

NEED SERVICE?
  Please contact us with your Warranty No. ({{warrantyNo}}) and a photo of the
  issue — this lets us identify your exact product and size right away.
  Phone:   {{companyPhone}}
  Email:   {{companyEmail}}
  Address: {{companyAddress}}

CARE TIPS
  - Dust with a soft dry cloth or a vacuum brush attachment.
  - Operate cords, wands and motors gently; do not force past the end stop.
  - Keep cords out of reach of children and pets.

Thank you again for your trust.

Sunny Shutter Inc.
{{companyAddress}}
{{companyPhone}} · {{companyEmail}}
```

> Care tips 三条是通用窗饰保养常识，不涉及质保条款；若官网有官方保养说明，以官网为准替换或删除。

## 3. HTML 版本要点（实现时）

- 单列、600px 宽、内联样式，表格用 `<table>`（邮件客户端兼容）；Logo 用组织设置里的公开 URL，没有就纯文字抬头。
- 产品表每行一扇窗，与工艺单行一一对应（客户报修时能说"Living Room 左边那扇"）。
- 附件（v2，待拍板 Q4）：`Warranty-{{warrantyNo}}.pdf`，复用报价 PDF 的渲染链路；v1 只发正文 + 链接，不做 PDF。

## 4. 返修后的质保邮件

返修完成且会计确认后发**同一封**模板，`{{installDate}}` 取返修完成日；不发两封（一单一封，`sourceKey = warranty:{{orderNumber}}` 去重）。是否在首装完成、返修未完成时先发一封"部分完成"通知 → **不发**，避免客户拿到一份不完整的质保。

## 5. 中文版（如需要发给中文客户，待拍板 Q5）

v1 不做；如做，按客户语言偏好（若系统已有）选模板，条款仍链接官网英文页。
