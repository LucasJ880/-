# INSTALL-2 · 完工 + 质保邮件模板（Sunny Shutter）

| 项 | 值 |
|---|---|
| 用途 | 安装顺利完成 → 会计确认尾款到账 → 系统生成本邮件（PendingAction，审批后发出，硬纪律 2） |
| 收件人 | 客户档案邮箱（`SalesCustomer.email`，经 `BlindsOrder.customerId`）；不抄送销售，改发站内通知（方案 Q4） |
| 发件人 | 组织发件身份，只从组织设置取，不从请求 / payload 取（硬纪律 6）；用哪套设置见方案 Q3 |
| 语言 | 英文正文（多伦多客户）；中文只在本文件做说明，不进邮件 |
| 方案 | `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §3（变更 INSTALL-2c；尾款确认在 INSTALL-2b） |

## 0. 质保条款来源与核实状态（防幻觉）

`https://sunnyshutter.ca/warranty-service/` 在本次会话的网络策略里被拒（DNS / 代理 403；用户 2026-10-28 再次给出链接后重试仍被拒），**原文未能直接读取**。下表只写检索摘要里能对上的内容，其余一律留 `{{待确认}}`，上线前由 Lucas / Evan 对着官网原文填。

**三个来源互相矛盾（方案 Q1 必须拍板）**：

| 条款 | 报价 PDF / Order Form（客户签字版，仓库已核实） | 官网检索摘要 | 官网 warranty-service 原文 |
|---|---|---|---|
| 帘类（Zebra / Roller / Drapes / Sheer …） | 1 year labour · 5 years fabric · 15 years components（`src/app/(main)/sales/quote-sheet/quote-pdf.ts:99,166`、`order-shades.tsx:131`、`order-drapes.tsx:179`） | `warranty-registration`：5 years（"other window covering solutions like Zebra and roller shades"）；`light-filtering-blinds-toronto`：Zebra / Roller 1.4mm 铝弧形盖盒 15-year warranty（与报价 PDF 的 "15 years components" 对得上） | 本会话无法访问 |
| Shutters | 1 year labour / 5 years components（`quote-pdf.ts:128`） | 25 years（"all of its shutter products"） | 同上 |
| 电机 / 遥控 / 充电器 | 未单列（归"components"？） | `motorized-window-shades`："10 Years Warranty"（未写明指电机还是整套）+ 厂家质保 + Sunny 在 GTA 的服务支持；另有 "Sunny motor support plan" 页，内容未取到 | 同左 |
| 不保范围 / 起算日 / 转让 | 未写 | 未取到 | 同左 |

| 其它项 | 取值 | 状态 |
|---|---|---|
| 报修电话 / 邮箱 | 647-857-8669；邮箱检索到两个：sales@sunnyshutter.ca、service@sunnyshutter.ca（质保报修更可能是 service@） | 检索摘要，需对原文 |
| 公司地址 | 2-680 Progress Avenue, Scarborough, ON M1H 3A5 | 维修单 PDF 抬头，已确认 |
| 品牌 | 维修单 = SUNNY SHUTTER INC；现有客户邮件模板 = SUNNY HOME & DECO（`src/lib/email/templates.ts:13-26`） | 方案 Q3 待定 |
| 质保起算日 | 安装完成日（多次安装取最后一次完成） | 行业惯例，需对原文 |

**建议**：种子取客户签字的报价 PDF（合同口径），并按 **品类 × 部件** 存（labour / fabric / components / motor），不是一个产品一个年限；官网若写的是另一套，先把官网与报价单统一，再改种子。未拍板前所有年限保持 `{{待确认}}`，系统遇到未配置品类一律阻断生成。

**原则**：邮件正文只列"产品 + 年限 + 起算日 + 怎么报修"，条款细则全部链接回官网 `warranty-service` 页，系统不复述、不改写条款——官网改了条款，邮件不会过时也不会和官网矛盾。

## 1. 变量表（全部来自系统已有数据，零 schema）

| 变量 | 取值来源 | 缺失时 |
|---|---|---|
| `{{customerName}}` | `SalesCustomer.name`（工艺单 `customerName` 兜底） | 阻断生成，进会计待办"缺客户信息" |
| `{{customerEmail}}` | `SalesCustomer.email` | **阻断生成**，提示会计/销售补邮箱 |
| `{{installAddress}}` | `SalesCustomer.address`（工艺单 `address` 兜底） | 显示 "—" |
| `{{orderNumber}}` | `BlindsOrder.code`（= 报价 orderNumber） | 阻断 |
| `{{installDate}}` | `BlindsOrder.installedAt`（多次安装取**最后一次完成**的日期，即返修完成日） | 阻断 |
| `{{warrantyNo}}` | `W-{{orderNumber}}`（确定性生成，不新增编号器） | — |
| `{{items[]}}` | 收口单元：`BlindsOrderItem`（`location` / `productType` / `fabricSku`）+ ProcessSpec 各段行（Vinyl 窗 / 窗帘 / 国内下单 / 外采购，都有 `location`） | 至少 1 行，否则阻断 |
| `{{items[].category}}` | 品类推导复用 `src/lib/fulfillment/category.ts`（vinyl / drapery / shades） | 无品类 → 阻断 |
| `{{items[].terms[]}}` | 品类 → `[{part: labour/fabric/components/motor, years}]`，查 `Organization.settingsJson.sunnyWarranty.terms`（老板可改，改动记审计） | 品类未配置 → 阻断，提示补质保表，**不默认任何年限** |
| `{{items[].terms[].until}}` | `installDate + years`（日期计算，确定性） | — |
| `{{salesName}}` | 工艺单 `creatorId`（自动生成单 = 报价创建人）姓名 | 省略该行 |
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
  #  | Location          | Product
  {{#items}}
  {{index}}  | {{location}} | {{productLine}} {{fabricOrColor}}
  {{/items}}

WARRANTY COVERAGE (from {{installDate}})
  {{#categories}}
  {{categoryLabel}}:  {{#terms}}{{partLabel}} {{years}} yr (until {{until}}){{sep}}{{/terms}}
  {{/categories}}

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
- 附件：现有发信链路（Gmail / Resend）都没有附件能力，v1 只发正文 + 官网条款链接；PDF 附件留 v2。

## 4. 返修后的质保邮件

返修完成且会计确认后发**同一封**模板，`{{installDate}}` 取返修完成日；不发两封（一单一封，PendingAction `idempotencyKey = install-warranty:{orderId}`）。是否在首装完成、返修未完成时先发一封"部分完成"通知 → **不发**，避免客户拿到一份不完整的质保。

## 5. 中文版（如需要发给中文客户，待拍板 Q5）

v1 不做；如做，按客户语言偏好（若系统已有）选模板，条款仍链接官网英文页。
