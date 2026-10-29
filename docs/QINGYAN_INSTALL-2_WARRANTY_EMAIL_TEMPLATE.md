# INSTALL-2 · 完工 + 质保邮件模板（Sunny Shutter）

| 项 | 值 |
|---|---|
| 用途 | 安装顺利完成 → 会计确认尾款到账 → 系统生成本邮件（PendingAction，审批后发出，硬纪律 2） |
| 收件人 | 客户档案邮箱（`SalesCustomer.email`，经 `BlindsOrder.customerId`）；不抄送销售，改发站内通知（方案 Q4） |
| 发件人 | 组织发件身份，只从组织设置取，不从请求 / payload 取（硬纪律 6）；用哪套设置见方案 Q3 |
| 语言 | 英文正文（多伦多客户）；中文只在本文件做说明，不进邮件 |
| 方案 | `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §3（变更 INSTALL-2c；尾款确认在 INSTALL-2b） |

## 实现状态（INSTALL-2c，2026-10-28）

**已实现**：change `install-2c-warranty-email`，报告 `docs/QINGYAN_INSTALL-2c_REPORT.md`。下文 §0–§3 是实现前的草稿，保留作来源记录；**以代码与 spec 为准**。

| 项 | 实现 |
|---|---|
| 渲染 | `src/lib/install/warranty.ts` `renderWarrantyEmail`：纯文本与 HTML 同一份内容；同样输入得到同样邮件；HTML 全部转义 |
| 种子（`seedWarrantySettings`） | 官网新条款（Lucas 2026-10-29 确认已生效）：**Shades = Labour 1 / Fabric 5 / Components 15 / Cordless Lift Mechanism 3 / Motor 5 / Motor Accessories 5 / Batteries 1**；**Drapery = Labour 1 / Fabric 5 / Components 15 / Motor 5 / Motor Accessories 5 / Batteries 1**（INSTALL-2h）；**Shutters（vinyl）= Labour 1 / Components 15 / Frame & Panels 25**（INSTALL-2g）。邮件里电机 / 配件 / 电池注明 "(if supplied)"，无绳机构注明 "(cordless models)"。老板可在会计「待收尾款」→「质保设置」改；**已保存过的设置不被种子覆盖** |
| 联系方式种子 | 公司名 Sunny Shutter Inc；地址 2-680 Progress Avenue, Scarborough, ON M1H 3A5（维修单抬头）；条款链接 `https://sunnyshutter.ca/warranty-service/`（Lucas 2026-10-29：保留）；**报修电话 647-857-8669、邮箱 service@sunnyshutter.ca**（INSTALL-2g：电话经官网核实，邮箱由 Lucas 确认；2c 时留空） |
| 抄送（INSTALL-2g） | 质保设置项 `cc`，种子 miki@sunnyshutter.ca（Lucas 2026-10-29）；最多 5 个；生成审批时定稿（去掉与收件人相同的），预览可见，执行器按审批内容抄送，审计记录 |
| 证书 PDF 附件（INSTALL-2k） | 生成审批时定稿英文质保证书（`src/lib/install/warranty-certificate.ts`，A4，与邮件同一份数据）与附件名 `Warranty-W-<单号>.pdf`；批准后执行器用服务端 Chromium（`src/lib/pdf/html-to-pdf.ts`，注入 Noto Sans SC）渲染成 PDF 随邮件发出；PDF 生成失败 → `PDF_FAILED`，不发；正文加 "Your warranty certificate is attached as a PDF."；会计页预览显示附件名，可展开看证书；上线前生成的旧审批照常发、不带附件。样张：`docs/install-2k-screenshots/warranty-certificate-sample.pdf` |
| 发件人 | 组织发件身份 `trade.email_sender`（设置 → 邮件 → 组织发件人）；未配置 → `NO_ORG_SENDER`，不回落到个人邮箱（Q3） |
| 与本草稿的差异 | ① 不输出 `{{salesName}}`（spec「邮件不输出的内容」：不含员工内部信息）；② 安装地址：工艺单地址优先，客户档案地址兜底，都空显示 "—"；③ 安装日 = `installedAt` 在企业时区的日期（返修后的更新在 INSTALL-2e）；④ 只有英文版，§5 中文版未做 |
| 官网原文 | **已读到**（Lucas 2026-10-29 截图，见 §0a）；同日 Lucas 确认新条款**已生效**：Shutters → INSTALL-2g；帘类 / 窗帘（无绳升降 3、电机 / 配件 5、电池 1）→ INSTALL-2h；报价单 PDF 三段与帘类 / 窗帘 Order Form 文字均按新条款，并由 `warranty.test.ts` 与种子逐字比对 |

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

## 0a. 官网原文（Lucas 2026-10-29 截图核实）

会话网络策略仍拒绝 `sunnyshutter.ca`，以下由 Lucas 提供的 `warranty-service` 页截图逐字转录（截图 4 张；最后一段被截断处标"…"）。

**页面状态**：右侧框 "Proposed policy revision — draft for review"——"This proposed revision applies only to new orders whose written order terms adopt it. Existing orders retain the warranty terms supplied with their original purchase. Coverage depends on the original order, product category, installation method, warranty status and the specific terms below. Keep your invoice or order information whenever possible."

| Category | Standard period | What the period covers | Important service note |
|---|---|---|---|
| Labour — Sunny installed | 1 year | Labour for a covered warranty issue, including reasonable related removal and reinstallation. | Begins on the original installation completion date. |
| Labour — pickup or shipped | 1 year | Repair labour at the Sunny Shutter showroom. | Customer drop-off and pickup is required unless paid on-site service is arranged. |
| Fabrics | 5 years | Covered defects under normal use for eligible zebra, roller, solar, Shangri-La and drapery fabrics. | Normal fading, curling, soiling, scratches and loss of colour intensity from use are excluded. |
| Manual components & hardware | 15 years | Eligible clutches, brackets and moving parts under normal use, excluding cordless lift mechanisms. | Cordless lift mechanisms have separate 3-year coverage. Metal hardware and hinges are covered for operation, not finish. |
| Cordless lift mechanisms | 3 years | Springs, spring motors and integral lift or holding components in manually operated cordless blinds and shades, including zebra blinds. | Includes loss of tension causing failure to raise or hold position under normal use. Labour and service charges follow the original order's service terms. |
| Shutter frame & panels | 25 years | Eligible cracking, excessive fading, extreme colour loss or warping under normal use. | High-humidity applications and normal light lines between louvers are excluded. |
| Motors | 5 years | Eligible motors supplied through the Sunny Shutter motorization program. | Damage caused by customer reprogramming or unsupported changes is excluded. |
| Motor accessories | 5 years | Eligible remotes and supplied motor accessories. | Compatibility and replacement depend on the original system. |
| Batteries | 1 year | Eligible supplied batteries. | Normal capacity loss and misuse are not covered. |

- **Repairs do not restart the warranty.** "A repair, replacement fabric, motor, accessory or other component remains part of the original order. The original warranty timeline continues from the initial installation, …"
- **Sunny-installed order**：第一年内的保修问题，维修 / 更换及相关人工免费，含与该问题直接相关的合理拆装；第一年后适用部件可能仍在保，但上门与人工收费；服务安排取决于地址、产品、通道与范围。
- **Pickup / courier / shipped order**：标准方式是展厅送修取回，一年免费维修人工；运送不含上门服务（除非书面确认）；可选上门安装 / 检查 / 维修 CAD $250 + HST（视档期），付费上门对同一维修问题自首次上门日起保一年。
- **服务范围**：Toronto、York、Peel、Durham、Halton。**电话**：647-857-8669（页面 "Call 647-857-8669" 按钮）。页面截图里没有出现报修邮箱。

**与系统现状对比**

| 项 | 系统现状（报价单口径） | 官网草案 | 结论 |
|---|---|---|---|
| 帘类 / 窗帘 人工 | 1 年 | Labour — Sunny installed 1 年 | 一致 |
| 帘类 / 窗帘 面料 | 5 年 | Fabrics 5 年（zebra / roller / solar / Shangri-La / drapery） | 一致 |
| 帘类 / 窗帘 部件 | 15 年 | Manual components & hardware 15 年，**但无绳升降机构单列 3 年**（含 zebra） | 草案更细：采纳后无绳款的升降机构从 15 年降为 3 年 |
| Shutters | 人工 1 / 部件 5 年（`quote-pdf.ts:128`） | 人工 1；框架与叶片 25 年；五金按 Manual components & hardware 15 年 | **不一致**：采纳后 Shutters 显著变长 |
| 电机 / 遥控 / 电池 | 不单列 | Motors 5、Motor accessories 5、Batteries 1 | 草案新增 |
| 起算日 | 工艺单 `installedAt`（整单装完那天；返修后为返修完成日，关闭不返修为关闭日） | Begins on the original installation completion date；维修不重启质保 | 一致：系统的维修单只发生在整单装完之前，装完后的保修维修不在系统里，不会重启质保 |
| 报修电话 | 种子留空，老板在「质保设置」填 | 647-857-8669 | 页面已核实，可填 |
| 报修邮箱 | 种子留空 | 截图未出现（检索摘要有 service@sunnyshutter.ca） | 待 Lucas 确认 |

**草案采纳时要做的事**（2026-10-29 Lucas：新条款已生效、Shutters 按新条款——第 1、2 条的 Shutters 部分由 INSTALL-2g 完成；第 3 条 Lucas 定为不分版本，一律按当前设置）：
1. 先改报价单 / Order Form 上的质保文字（`quote-pdf.ts:99,128,166`、`order-shades.tsx`、`order-drapes.tsx`）——草案只对"书面订单条款采纳它"的新订单生效。
2. 质保表部件只有 labour / fabric / components / motor 四种，草案需要再加：无绳升降机构、Shutter 框架与叶片、电机配件、电池。
3. **质保邮件要按订单适用的条款版本出年限**：现在是一张企业级质保表、发信时读取。老板若在草案生效当天直接改表，签单在前、装完在后的老订单会收到新条款，违反"现有订单保留原条款"。需要按签单日期（或条款生效日）区分版本。

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
  - **已实现（INSTALL-2k）**：Resend 发信透传附件，质保邮件附 `Warranty-W-<单号>.pdf` 质保证书，见上方「实现状态」。

## 4. 返修后的质保邮件

返修完成且会计确认后发**同一封**模板，`{{installDate}}` 取返修完成日；不发两封（一单一封，PendingAction `idempotencyKey = install-warranty:{orderId}`）。是否在首装完成、返修未完成时先发一封"部分完成"通知 → **不发**，避免客户拿到一份不完整的质保。

## 5. 中文版（如需要发给中文客户，待拍板 Q5）

v1 不做；如做，按客户语言偏好（若系统已有）选模板，条款仍链接官网英文页。
