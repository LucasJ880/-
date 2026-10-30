# PRICE 任务书（方案）：Sunny 价格表 2026-10-28 进青砚 + 按人报价 / 销售额统计

| 项 | 值 |
|---|---|
| 编号 | PRICE-1 / PRICE-2 / PRICE-3 / STAT-1（主线 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 新增 Phase P） |
| 动机 | Lucas（Sunny 销售总管视角）2026-10-29：上传 `LUCAS_QUOTE.zip`（SUNNY SHUTTER 报价工作台 · 本地试用版 `2026.10-local.1`），要求 ① 把价格表更新到青砚后台，直接在青砚上报价；② 事后按月 / 按周知道**每个人一共报了多少钱、销售额是多少**；③ 长任务 + 多轮交叉验证 + 交接文档，防幻视与遗忘 |
| 状态 | **待拍板**（§7 判断点 Q1–Q11 给了推荐默认；拍板后按 §8 顺序逐个 `/opsx:propose`） |
| 交接 | `docs/QINGYAN_PRICELIST_HANDOFF.md`（新会话从那里进） |
| 价表证据 | `config/pricelist/2026-10-28-lucas-quote.json`（增量 + 来源哈希）、`config/pricelist/2026-10-28-golden-cases.json`（158 条黄金用例，由上传工具自带的 `price()` 原函数直接算出） |
| 纪律 | `openspec/config.yaml` 八条，逐条对照见 §5 |

---

## 0. 已核实的现状（2026-10-29，main @ `abad98d`，逐条对过代码）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 青砚已有一套 Sunny 定价引擎：按产品 / 面料查 MSRP 矩阵（宽高取档"向上取第一个 ≥"）→ 折扣 → 最低价 → 无绳 ×1.15 → 安装费；价表版本 `BASE_PRICE_VERSION = '2026-10'`，来源是 10 月的 `quote_2026-10月报价工具.html` | `src/lib/blinds/pricing-engine.ts`、`src/lib/blinds/pricing-data.ts:9` |
| F2 | **现有 9 个产品（Roman Shade / Zebra / SHANGRILA / Cordless Cellular / SkylightHoneycomb / Roller / Drapery / Sheer / Shutters）的宽高档位与 MSRP 矩阵，与上传包里的 HTML 内置价表、Excel `价格矩阵` 页三方逐格一致，0 差异**（§2 V1）。折扣（0.30 / 0.45 / 0.35 …）、最低价 100、安装费（18 / 26，窗帘 55 / 90，Shutters 每 35" 一扇 18，最低 200）、税率 13%、Roller 罩盖加价 25 / 50、Door Screen Sheer 两档也一致 | `pricing-data.ts:397-451`；上传 `seed.data.install` |
| F3 | 青砚**没有 Fauxwood**（仿木百叶）；`Allusion` 在枚举里但**没有 MSRP 表**，和 `Roman` 一样走"销售手填单价"分支（折扣 0、最低价 0） | `pricing-types.ts:11-16`、`pricing-data.ts:299,408-409,424`、`pricing-engine.ts:260` |
| F4 | 无绳（cordless）现状：只 Zebra / Roller 可选；**宽或高 > 75" 直接报错**；折扣用产品折扣（Zebra / Roller 45%）；最低价 100；最后 ×1.15 | `pricing-engine.ts:46,96,129,164,200,205`；`pricing-data.ts:449-451` |
| F5 | 上传工具的无绳规则：**无独立尺寸上限**（说明文件："本工具已取消额外无绳上限，仍需符合产品矩阵"）；**无绳用独立折扣 30% off**（不是产品的 45%）；**无绳最低价 Zebra $159 / Roller $129**；仍 ×1.15；行级折扣 / 手动成交价优先 | 上传 `使用说明.txt` "Cordless" 段、`index.html` `price()`（已抽到 `config/pricelist/2026-10-28-golden-cases.json`） |
| F6 | Order Form（电子订单表）路径里，**无绳 = Lift 选了 L 或 R**，Lift=M 为电机；Part A 路径才有独立的"无绳"勾选框 | `src/app/(main)/sales/quote-sheet/page.tsx:884`、`part-a.tsx:224` |
| F7 | 布帘 / 纱帘**褶皱率**：青砚没有这个概念（按实际窗宽查表）。上传工具：查表宽 = 实际窗宽 × 褶皱率 ÷ 2（矩阵本身按 2 倍折算），默认 2，范围 1–4，Door Screen Sheer 不适用；安装费与面积仍按实际窗宽。褶皱率 = 2 时与青砚现状完全一致 | 上传 `使用说明.txt` "布帘与纱帘褶皱率"；`price()` 里 `lookupW` |
| F8 | 附加项目：青砚只有 7 个预设（motor 150 / hub 240 / remote 40 / track 6–12 ft 60–120）+ Part B 自定义行；上传包有两套：结构化零售表 `retailAddons`（11 项：新增 motor_plugin 350、motor_battery_matter 190、drape_motor_battery 650、drape_motor_plugin_matter 700）和 Excel `ADD ON参考`（40 行，含按英尺计价、"+15%"、负数优惠等）。**两套有冲突**：Hub 零售表 240 vs Excel 300 | `src/lib/blinds/pricing-addons.ts`；`config/pricelist/2026-10-28-lucas-quote.json` `retailAddonsCsv` / `excelAddons` |
| F9 | 运费：青砚企业默认 75（驾驶舱可改），报价表默认 50；上传工具默认 50，另有 **Downtown 服务费 150**（勾选项），青砚没有 | `prisma/schema.prisma:4585,4690`；上传 `defaultPricing()` |
| F10 | 品类折扣是 `QuoteDiscountSettings` 的**列**（zebra … romanShade），改折扣表要走 PendingAction 审批（PERM-2）。**零 schema 下不能为 Fauxwood / Allusion / 无绳再加列** | `prisma/schema.prisma` `QuoteDiscountSettings`；`src/lib/blinds/discount-settings.ts:31-34`；`openspec/specs/sales/quote-settings-approval` |
| F11 | SKU 目录 350 条与上传包一致，只有 1 条改名：Zebra `LOUIA-WHITE-LF-BL201` → `LOUIA-WHITE-BL201-LF`（上传说明 2026-10-29 "BL201 更新"，旧编号仍兼容） | `public/sku-catalog.csv` vs 上传 `seed.skuCsv` |
| F12 | **"每个人报了多少钱 / 销售额"已经有一套口径（KPI-1，已归档）**：`GET /api/sales/period-summary` 按报价创建人拆 `byRep`（成单数 / 成单金额 / 报价数 / 报价金额 / 转化率），销售首页期间面板可选 本月至今 / 上月 / 本季 / 最近 30 天 / 自定义；成单 = signed/accepted 的 `grandTotal`（含税），报价 = `sentAt` 落在期间 | `openspec/specs/sales/period-summary/spec.md`；`src/lib/sales/period/{summary-pure,load}.ts`；`src/components/sales-command-center/sales-period-panel.tsx:20-24` |
| F13 | KPI-1 缺的：没有"本周 / 上周"预设；按人表只有合计，**点不进去看是哪几张报价**；`/sales/quotes` 列表没有"按销售"筛选；报价只有标记发送（`mark-sent`）或发邮件后才有 `sentAt`，草稿不计 | `sales-period-panel.tsx:403-417`；`src/app/(main)/sales/quotes/page.tsx:94-105,165`；`src/app/api/sales/quotes/[quoteId]/mark-sent/route.ts` |
| F14 | 出单品类映射是代码表（`Zebra/Roller/…/Allusion → shades`，`Shutters → vinyl`，`Drapery/Sheer → drapery`）；工艺单产品中文名也是代码表；新产品必须补这两张表 | `src/lib/fulfillment/category.ts:21-31`、`src/lib/sunny-process/quote-mapping.ts:76-84` |
| F15 | 上传包里还有一套**经销商参考价**（350 个 SKU 分 S1–S8 档 × 面积单价，最低 100；dealer 附件成本表）。青砚现有"品类成本率"（`costRatesJson`）承担类似作用 | 上传 `seed.dealer`；`QuoteDiscountSettings.costRatesJson` |

---

## 1. 用户诉求（2026-10-29 原话要点）

1. "把价格表更新到青砚的后台中，这样我们可以直接在青砚上报价"。
2. "重点是希望能够在后期比如一个月、一周的时候，我们能通过报价单，知道每个人一共报了多少钱？销售额是多少？"
3. "要求是长任务 + 多轮交叉验证，做好 hand off 防止幻视与遗忘"。

---

## 2. 第一轮交叉验证（V1，已完成）与真正的增量

**V1 方法**：解包 → 从 `index.html` 抽出 `<script id="seed">` 价表 JSON（139 KB）→ 用 `openpyxl` 读 Excel `价格矩阵` 页 20 个矩阵 → 用 Node 原生 type-strip 导出青砚 `pricing-data.ts` 常量 → Python 逐格比对（阈值 1e-6）。

| 比对 | 结果 |
|---|---|
| HTML 价表 vs 青砚 `pricing-data.ts`（9 个产品、15 张矩阵） | 档位全同，**0 格差异** |
| Excel `价格矩阵` vs HTML 价表（20 个矩阵，含 Fauxwood / Allusion） | 档位全同，**0 格差异**（Door Screen Sheer 在 Excel 里是全 0 占位，走特殊规则） |
| SKU 目录 350 条 | 1 条改名（F11） |
| 折扣 / 最低价 / 安装 / 税率 | 一致（F2） |

**结论：这次不是"重录价表"，MSRP 一格都不用动。真正的增量只有下面这张表。**

| # | 增量 | 青砚现状 | 新价表 | 归属 change |
|---|---|---|---|---|
| D1 | Fauxwood（仿木百叶）新产品 | 无 | 11 宽档 × 9 高档矩阵，折扣 30%，最低价 209，最大 78" × 75" | PRICE-1 |
| D2 | Allusion（梦幻帘）有矩阵了 | 手填单价 | 14 宽档 × 15 高档矩阵，折扣 35%，最低价 200，最大 108" × 120" | PRICE-1 |
| D3 | 无绳折扣独立 30% | 用产品折扣 45% | 30%（行级折扣优先） | PRICE-2 |
| D4 | 无绳最低价 | 100 | Zebra 159 / Roller 129 | PRICE-2 |
| D5 | 无绳尺寸上限 | 宽高 ≤ 75" | 无上限（只受矩阵范围） | PRICE-2（Q3） |
| D6 | 布帘 / 纱帘褶皱率 | 无（等价于 2 倍） | 每行可填 1–4，企业默认 2 | PRICE-2 |
| D7 | Downtown 服务费 150 | 无 | 勾选项 | PRICE-3（Q6） |
| D8 | 附加项目 | 7 个预设 | 零售表 11 项 + Excel 40 行 | PRICE-3 |
| D9 | SKU BL201 改名 | 旧编号 | 新编号（旧编号兼容） | PRICE-1 |
| D10 | 运费默认 | 企业设置 75 | 工具默认 50 | 不改代码（Q5） |
| D11 | 经销商参考价 S1–S8 | 品类成本率 | 面料分档 × 面积 | 本次不做（Q11） |

---

## 3. 设计

### 3.1 PRICE-1 `pricelist-2026-10-fauxwood-allusion` — 新产品进价表

What：
- 给 `ProductName` 加 `Fauxwood`；`BRACKETS` / `MSRP_FAUXWOOD` / `MSRP_ALLUSION` 从 `config/pricelist/2026-10-28-lucas-quote.json` 落到 `pricing-data.ts`（数值原样，不四舍五入；文件头记录来源 SHA-256）；`BASE_PRICE_VERSION` 升为 `'2026-10-28'`。
- Allusion 从"手填单价"改为查表定价（`isManualPriceShadeProduct` 只剩 `Roman`）；Order Form 上 Allusion 的手填价字段保留为"手动成交价"覆盖（有值优先，与 Part A 行折扣覆盖同级）。
- `DEFAULT_DISCOUNTS` / `PRICE_FLOOR` 加 Fauxwood 0.30 / 209、Allusion 0.35 / 200。
- 企业级折扣覆盖：**零 schema**，Fauxwood / Allusion 的企业折扣存 `Organization.settingsJson.pricing.discounts.{fauxwood,allusion}`，读法与 `pricing.leadMaxPct` 同一个纯函数风格（坏值回落默认）；驾驶舱折扣卡多两行；保存仍走 PendingAction（沿用 `quote-settings-approval` 规格，审批内容里带这两项）。
- 出单品类：Fauxwood → `shades`（Q2）；工艺单中文名"仿木百叶"；Order Form 产品下拉、量房页下拉、AI 报价解析词表（"仿木 / faux wood"）都加上。
- SKU 目录 BL201 改名，旧编号在 `findSku` 里做别名。
- 报价 `formDataJson` 写入 `pricelistVersion`（字符串），不加列。

受影响位置：`src/lib/blinds/{pricing-types,pricing-data,pricing-engine,discount-settings,sku-catalog}.ts`、`src/lib/fulfillment/category.ts`、`src/lib/sunny-process/quote-mapping.ts`、`src/app/(main)/sales/quote-sheet/{order-shades,part-a,page}.tsx`、`src/app/(main)/sales/measure/page.tsx`、`src/lib/sales/ai-quote-parser.ts`、`src/app/(main)/sales/cockpit/discount-settings-card.tsx`、`src/app/api/sales/quote-settings/discounts/route.ts`、`public/sku-catalog.csv`。

Out of scope：Fauxwood 的工艺单计算段（Sunny 工艺单引擎没有仿木百叶的工艺规则；本次只让它作为"外采购 / order"行出现，不新增工艺引擎）；Fauxwood 面料画册附页。

验收：黄金用例 `tag ∈ {fauxwood, allusion, regression}` 全部与 `priceFor` 输出一致（msrp / standard / install / billW / billH / 报错文案含义）；Order Form 选 Fauxwood 36.5" × 48" 预览得 MSRP 410.06 / 成交 287.05 / 安装 18；Allusion 25.5" × 36.5" 走表价而非手填。

### 3.2 PRICE-2 `pricelist-2026-10-cordless-fullness` — 无绳规则与褶皱率

What：
- `priceFor` 加参数 `cordlessPolicy = { discount, floors, multiplier }`（默认 30% / 159 & 129 / 1.15）：无绳行折扣 = 行级覆盖 ?? 无绳折扣（不再用产品折扣）；最低价用无绳最低价；删除 75" 上限（Q3）。
- 企业覆盖落 `settingsJson.pricing.cordless.{discount,floors}`；驾驶舱折扣卡加"无绳折扣 / 无绳最低价 Zebra / Roller"三格；保存走 PendingAction。
- `QuoteItemInput` 加可选 `fullness`（1–4）；只对 Drapery / Sheer 且非 Door Screen Sheer 生效；查表宽 = 宽 × fullness ÷ 2，安装费与面积按实际宽；超范围报错文案带"此褶皱率下最大窗宽"；非法值（< 1 或 > 4）整行报错，不静默回 2。企业默认褶皱率 `settingsJson.pricing.fullness.{Drapery,Sheer}`，缺省 2。
- Order Form 窗帘表与 Part A 加"褶皱率"列（下拉 1 / 1.8 / 2 / 2.5 / 3 / 4，可手输）；工艺单 drapes 段把褶皱率带过去（`formDataJson` 已有的字段，不加列）。
- `SalesQuoteItem` 不加列：褶皱率随行存在 `formDataJson`，`msrp` / `price` 已是算完的值。
- F6 的"Lift L/R = 无绳"推导保持不变（Q4 让 Lucas 确认），只在 Order Form 表头加说明文字。

Out of scope：电机（Lift=M）加价逻辑；Roller 罩盖价；Zebra 必带罩盖的规则。

验收：黄金用例 `tag ∈ {cordless-*, fullness-*, door-screen*}` 全部一致，尤其 Zebra LF 24" × 36" 无绳 = 159（最低价兜底）、Zebra 90" × 100" 无绳不再报错、布帘 300" × 108" 在 1 倍褶皱率可报、2 倍超范围；褶皱率 0.5 / 5 报错。

### 3.3 PRICE-3 `pricelist-2026-10-addons` — 附加项目

What：
- `ADDON_CATALOG` 以零售表 `retailAddons`（11 项）为准替换 / 追加（motor 150 不变、hub 240 不变（Q7）、新增 motor_plugin 350、motor_battery_matter 190、drape_motor_battery 650、drape_motor_plugin_matter 700）；保留 `eligibleProducts`。
- Excel `ADD ON参考` 里零售表没有的固定价项目（充电线 40、6C 遥控 40、Channel Rod 6/8/10/12 ft 82.5/112/145/178、加垫板 6–12 ft 60–120、软轨 150、硬轨每弯 75、Shutter Valance 三档 110/150/200、Shutters Track 三档 200/300/400、Open roll Valance 25/50、Door Screen Sheer 附加 150/200）进 Part B 预设下拉，`unitPrice` 固定，`qty` 自由；按英尺项（Motorized Drape Track $30/ft、U/H/L Channel $18/ft、Shutter Frame Vinyl $4/ft / Wood $7/ft）以"每英尺"为单位、`qty` = 英尺数。
- Downtown 服务费 150：作为 Part B 预设一项（Q6），不进引擎。
- "卷帘斑马帘黑色方盒 +15%"：本次**不做**（Q8），留自定义行。
- 预设价可被企业覆盖：`settingsJson.pricing.addons.{key: unitPrice}`，驾驶舱一张表，保存走 PendingAction。

Out of scope：经销商附件成本表；附件的工艺单出单行。

验收：Part B 下拉出现全部预设且价与 `config/pricelist/2026-10-28-lucas-quote.json` 一致；`calcAddonSubtotal` 对 `qty=13` 的 $30/ft 得 390；客户 PDF 上附加项目名称用 `printLabel`。

### 3.4 STAT-1 `sales-quote-stats-drilldown` — "每个人报了多少钱 / 销售额"补齐

KPI-1 已有口径与按人表（F12），本 change 只补 F13 的缺口，**不改口径**：
- 期间预设加"本周 / 上周"（周一为一周开始，组织时区；Q9）。
- 按人表每行可展开：`GET /api/sales/period-summary/quotes?from&to&repId&kind=quoted|won` 返回该人该期间计入的报价清单（报价号、客户、发送 / 签字时间、`grandTotal`、状态、`pricelistVersion`），同样按 `sales.analytics.read` 与 ORG / PRINCIPAL 范围授权，销售只能展开自己；上限 500 行带 `truncated`。
- `/sales/quotes` 列表加"按销售"筛选（ORG 范围可见）。
- 首页期间面板加一行"本期草稿未发送 N 份"（不计入报价金额，提醒销售点"标记已发送"，否则统计不到）。
- `sales_overview` 的 `period` 子对象不变。

Out of scope：改成单 / 报价口径；提成；导出 Excel（既有 `export-excel` 可另开）。

验收：隔离库种两位销售各 2 份已发送 + 1 份已签 + 1 份草稿 → 老板展开 A 行得 3 条（2 报价 + 1 成单各自 kind）、草稿不出现、合计等于按人表数字；销售 B 展开 A 返回 403；"本周"预设在周三打开 = 本周一至今天。

---

## 4. 零 schema 落点总表

| 数据 | 落点 | 读法 |
|---|---|---|
| Fauxwood / Allusion 企业折扣 | `Organization.settingsJson.pricing.discounts.{fauxwood,allusion}` | 纯函数，坏值回默认（0.30 / 0.35） |
| 无绳折扣 / 最低价 | `settingsJson.pricing.cordless.{discount,floors.Zebra,floors.Roller}` | 同上（0.30 / 159 / 129） |
| 企业默认褶皱率 | `settingsJson.pricing.fullness.{Drapery,Sheer}` | 同上（2） |
| 附加项目企业价 | `settingsJson.pricing.addons.{addonKey}` | 同上（目录价） |
| 行级褶皱率、价表版本 | `SalesQuote.formDataJson`（已有 Text 列） | 已算完的 `msrp` / `price` 落 `SalesQuoteItem` 既有列 |
| 折扣 / 附件价修改审批 | `PendingAction`（既有 `quote-settings-approval`） | 批准后写 settingsJson（只动 `pricing` 键，不整对象覆盖） |

改 `settingsJson` 时只动 `pricing` 子键（HANDOFF INSTALL-2 §4 的教训：整对象覆盖会抹掉 `sunnyProcess` / `tenderRfq` / `calendarWatch`）。

---

## 5. 与八条硬纪律的关系

| 条 | 关系 |
|---|---|
| 1 零 schema | 四个 change 都不加 Prisma 模型 / 字段 / migration；见 §4 |
| 2 出站先审批 | 不涉及对外发送；折扣 / 附件价修改沿用既有 PendingAction 审批 |
| 3 禁止第三套队列 | 不涉及 |
| 4 脱敏 | STAT-1 的报价清单只在网页端、按 `sales.analytics.read` 授权；Muse 侧不加新意图、不出新金额；销售范围看不到他人姓名与金额（沿用 KPI-1） |
| 5 不爬登录页 | 不涉及 |
| 6 邮箱分离 | 不涉及 |
| 7 确定性优先 | 定价是查表 + 纯函数；黄金用例来自原工具 `price()`；零 LLM |
| 8 测试注册 | 每个 change 的 `__tests__/*.test.ts` 同一 task 内注册进 `scripts/test-all.sh` |

---

## 6. 多轮交叉验证计划（每轮都要有可复跑的命令，不凭推断）

| 轮 | 内容 | 状态 |
|---|---|---|
| V1 | 三方矩阵逐格比对（HTML seed / Excel / `pricing-data.ts`） | **已完成**，0 差异（§2） |
| V2 | 黄金用例：Node 直接执行上传工具的 `price()` 原函数 + `defaultPricing(seed)`，158 条（含 37 条预期报错）→ `config/pricelist/2026-10-28-golden-cases.json` | **已完成**（生成脚本见 HANDOFF §3） |
| V3 | 引擎对照测试：`src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` 读 V2 文件逐条调 `priceFor`，msrp / standard / install / billW / billH 误差 ≤ 0.01，报错 ↔ 报错；PRICE-1 起每个 change 都必须保持全过 | PRICE-1 建，PRICE-2 / 3 扩 |
| V4 | 回归：既有 `sunny-motor` / `valance-options` / `cost-rates` / `quote-fees` / `blinds-oracle`（工艺单 × 原件逐值对照）全过；黄金用例 `regression` 组证明 9 个老产品数字不动 | 每个 change |
| V5 | 端到端：隔离库 + `next start` + Playwright：Order Form 录 Fauxwood / Allusion / 无绳 Zebra / 3 倍褶皱布帘各一行 → 预览金额 = 黄金用例 → 保存 → 标记发送 → 期间面板按人金额 = 该报价 `grandTotal` | PRICE-2、STAT-1 |
| V6 | Excel 模板公式复算：上传 `.xlsx` 的 `计算过程` 页是公式无缓存值；在有 LibreOffice 的机器上重算 10 行与黄金用例比对。沙箱没有 LibreOffice → **未做**，HANDOFF 标"未核对" | 可选 |
| V7 | 独立审查：PR 前跑 `/code-review` + `/opsx:verify <change>`；审查意见逐条处理写进报告 | 每个 PR |

---

## 7. 判断点（请 Lucas / Evan 拍板；不答则按"推荐"执行）

| # | 问题 | 推荐 | 依据 |
|---|---|---|---|
| Q1 | Allusion 从"手填单价"改为查表（35% off，最低 200），手填价降为可选覆盖？ | **是** | 上传价表有完整矩阵（D2） |
| Q2 | Fauxwood 出单归哪个品类（出单岗）？工艺单归哪一段？ | 出单 `shades`（Roller/Zebra/Roman 岗）；工艺单作"外采购 / order"行，不建工艺引擎 | 仿木百叶与 Sunny 现有工艺单引擎（blinds / drapes / vinyl）都不同 |
| Q3 | 无绳取消 75" 上限？ | **是，只受矩阵范围** | 上传说明明示"已取消额外无绳上限" |
| Q4 | Order Form 里"Lift = L / R 即无绳"（F6）是否正确？ | **请确认**；若不对，PRICE-2 把无绳改为独立勾选 | 无绳有了独立折扣与最低价后，这个推导直接影响金额 |
| Q5 | 运费默认 50 还是 75？ | **不改代码**，企业在驾驶舱自己设 | 已是企业设置 |
| Q6 | Downtown 服务费 150 做成什么？ | Part B 预设项 | 零引擎改动，客户 PDF 可见 |
| Q7 | Hub 零售 240（结构化表）还是 300（Excel）？电池电机 150 还是 190（Matter）？ | 两个都保留：hub 240、`motor_battery_matter` 190 另列；Excel 300 视为旧值 | 结构化零售表更新于同一版本且带 `enabled / display_order` |
| Q8 | "黑色方盒 + 黑底杆 +15%" 做不做？ | **本次不做**，留自定义行 | 是行级比例加价，牵涉 Zebra / Roller 罩盖规则 |
| Q9 | "本周"从周一还是周日起？ | **周一**，组织时区 | 加拿大零售常用；与 KPI-1 当地日逻辑一致 |
| Q10 | 销售本人能否展开看自己的报价清单？ | **能**（只看自己） | 沿用 `record-access` 规格 |
| Q11 | 经销商参考价（S1–S8 × 面积）进不进青砚？ | **本次不进** | 青砚已有品类成本率；两套并存会出现两个"成本" |

---

## 8. 执行顺序与交接纪律

```
PRICE-1 → PRICE-2 → PRICE-3 → STAT-1
```

- 每个 change：`/opsx:propose` 四件套回传审 → `/opsx:apply`（开工前记基线测试数）→ `npm test` → `/opsx:verify` → 开 PR → 合并 → `/opsx:archive --yes`（独立小 PR）→ TASKFLOW 状态列 → `docs/QINGYAN_PRICELIST_HANDOFF.md` §0 流水线表。
- PRICE-1 的 V3 黄金测试一旦建立，后面每个 change 都必须保持全过；任何人改 `pricing-data.ts` 先跑它。
- 价表下一次更新的标准动作：新 HTML / Excel → 解包 → 重跑 V1 比对脚本（HANDOFF §3）→ 只把差异进 `config/pricelist/<日期>-*.json` → 重生成黄金用例 → 改引擎 → 升 `BASE_PRICE_VERSION`。
- 任何"现状"陈述以本文 §0 的文件行号为准；行号漂移先核对再动手。
