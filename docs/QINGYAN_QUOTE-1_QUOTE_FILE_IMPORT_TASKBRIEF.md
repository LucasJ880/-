# QUOTE-1 报价文件导入「工具里报过的，不用再录一遍」— 任务书

TASKFLOW：新增 Phase Q「报价工具并入青砚」（登记到 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`，与 Phase K / P / V 的 Sunny 线并列）：QUOTE-1a、QUOTE-1b 两个 change，一个 change = 一个 PR，按下文「上线顺序」合并。本任务书合并时同步放一份到 `docs/QINGYAN_QUOTE-1_QUOTE_FILE_IMPORT_TASKBRIEF.md`。
需求方：Sunny（Lucas，2026-11-14）："我们现在的报价系统需要升级……是否可以融入进青砚？" 方案见项目文档 `Sunny报价系统_融入青砚方案_2026-11-14.md`，本任务书是其中的 Q-0。
依据（均已核对；青砚侧为 `github.com/LucasJ880/-` main `0b46a74`，2026-11-14；未运行两边界面）：
- 工具侧：上传包「SUNNY SHUTTER 报价工具 · 完整本地版」（2026-11-11 发放，`index.html` SHA-256 `f29513c0…cdf4a69`）。读了导出与校验源码，用 Node 直接运行其定价核心 `QuoteCore`。
- 青砚侧：`src/app/(main)/sales/quote-sheet/**`、`src/app/api/sales/quotes/route.ts`、`src/lib/blinds/**`、`src/lib/sales/discount-tier.ts`。用 `tsx` 直接运行了 `calculateQuoteTotal` 与 `skuToPricingFabric`。
- 映射规则已做过原型：一份覆盖 11 个品类、16 行的样例报价，按本任务书的规则映射后用青砚引擎计价，合计 **$8,224.51**（未取整 8,224.5055），工具自己算的是 **$8,224.50**。差额来自工具逐行取整。样例与期望值见「验收」，生成脚本见附录 A（已按原文实跑）。

## 一条规则

**文件只告诉青砚「填了什么」，价格永远由青砚算。文件里比青砚便宜的部分一律变成特别让利，走现有审批；导入不丢行、不静默改数，改了什么逐条列给销售看。**

## Why

**1. 现在成交一单要录两遍。** 工具的报价存在各人电脑的浏览器里，自己写着「公司共享与自动同步尚未接入」。工具能导出 `.sunny-quote.json`（格式 `sunny-quote-studio`，`version: 1`），青砚没有任何入口能读它；工具里的报价也不进青砚的期间看板。

**2. 直接读文件会算错钱，有六处对不上。** 前三处是青砚详细订单自己的问题，不导入也存在。

| # | 对不上的地方 | 证据 |
|---|---|---|
| a | **详细订单里 Roller 选了罩盒不加价。** 选真实 SKU 的 Roller 行，定价键只按 SKU 后缀取，不看该行的 Valance。Roller 55×72 遮光带罩盒：工具 $271.88，青砚详细订单 $221.88，少收 $50 | `page.tsx:901`、`pricing-helpers.ts:131` 都只调 `skuToPricingFabric(sku, product)`；实跑 `CABO-WHITE-BO` → `Blackout (Open Roll)`。而 `valance-options.ts:5` 写明口径是「Cassette / Fascia 均触发加价 25 / 50」，`rollerEngineFabricKey`（`:39`）只有已隐藏的 Part A 在用 |
| b | **Door Screen Sheer 三个价。** 30×48：工具 $227.27（不打折）；青砚 $147.73（服务端把纱帘的企业折扣 35% 套了上去）；Excel 参考表写 $200 | `discount-settings.ts:203` `applyOrgDiscountDefaults` 对所有无行级折扣的行套企业折扣，引擎 `pricing-engine.ts:139` 是 `override ?? 0`；客户端 `pricing-helpers.ts:280` 同样。`docs/QINGYAN_PRICE-1_REPORT.md:92` 当时已记下「留 PRICE-2 一并看」，至今未改 |
| c | **详细订单里实木百叶窗算不出价。** 表单把材质存成 `Wooden`，价表的键是 `Wood`。72×60：工具 $1,172.22；青砚引擎用 `Wood` 也是 $1,172.22，用 `Wooden` 报错「Pricing … is not set yet」 | `page.tsx:927` `fabric: shutterMaterial`；`pricing-data.ts` 的 `MSRP_SHUTTERS` 有 `Vinyl`、`Wood` 两张表；`pricing-helpers.ts:180` 的注释「目前只有 Vinyl 数据」已过时 |
| d | **SKU 推不出面料档。** 青砚按 SKU 后缀 `-LF / -BO` 推遮光档。工具 SKU 索引 457 个里有 **197 个不在青砚的 SKU 目录**（Zebra 35、蜂巢 84、Roman 78，后者是两边编号写法不同），其中 Zebra 的 SSB / FWB / MSB 等免打孔遮光款没有后缀，会被推成透光档 | 实跑：`SSB01`（100% Blackout）→ `Light Filtering`；`public/sku-catalog.csv` 350 行，只有 Zebra 150 / Roller 122 / Roman 78 |
| e | **褶皱率。** 工具默认 2.0，可填 1–4；青砚详细订单只有 180 / 230 两档 | `types.ts:196`；定价（`fullnessFromPercent`）和工艺单（`quote-mapping.ts:369`）其实都按数字算，只有表单类型和下拉限制了两档 |
| f | **行级折扣与成交价没地方放。** 工具每行可改折扣、可填成交价；详细订单的行没有这两个字段。按 11-05 销售告示把 Blacklabel 手改成 15% 的行，直接导入会按 45% 算，**少收一大截** | `ShadeOrderLine`（`types.ts:143`）无折扣字段；服务端 `QuoteItemInput.discountOverridePct`（`pricing-types.ts:50`）本身支持 |

**3. 其余都对得上。** 样例 16 行在引擎层逐行比对，除 b 之外 MSRP、折后价、安装费全部一致（a、c 出在表单到引擎这一段，引擎本身没错）；企业默认折扣两边逐项相同。

## What（两个 change）

### QUOTE-1a `quote-order-form-pricing-parity`：详细订单三处定价口径对齐

- **Roller 罩型进定价**：Roller 行的定价键改为「基础面料 + 该行 Valance」：`None` / 空 → `(Open Roll)`，`Cassette` → `w Cassette`，`Fascia` → `w Fascia`，复用 `rollerEngineFabricKey`。客户端预览（`pricing-helpers.ts` `computeShadeLinePrice`）与保存时的行构造（`page.tsx:869` 起）用同一个纯函数，不各写一份。
- **实木百叶窗能算价**：表单材质 `Wooden` 提交给定价时映射为价表键 `Wood`（客户端预览与行构造同一处映射）；表单与工艺单里的 `Wooden` 字样不改。
- **Door Screen Sheer 不套纱帘的企业折扣**：`applyOrgDiscountDefaults` 与客户端预览对 `Sheer / Door Screen Sheer` 跳过默认折扣，行上显式带折扣时照旧。**此项在判断点 1 拍板前不实施。**
- 黄金测试补三组经「表单行 → 企业默认折扣 → 引擎」完整路径的用例（现有 158 条只测引擎本身，测不到这三处）：Roller 真实 SKU × 三种 Valance × 宽 49 / 50 / 55；Shutters `Wooden` 与 `Vinyl` 各一例；Door Screen Sheer 宽 25 / 30 且不带行级折扣。
- 已存报价不重算；再次保存时按新口径计价。

### QUOTE-1b `quote-import-studio-file`：导入工具报价文件

**入口与流程**
- 报价工作台「详细订单」加按钮「导入报价文件」，接受 `.json`。文件只在浏览器里读，**不上传原文件**（文件可带照片，工具导入上限是 35 MB）。
- 流程：选文件 → 校验 → 文件含多套方案时先选一套 → 核对窗（逐行对照 + 提示清单）→「填入表单」→ 销售选或新建客户 → 走现有保存。保存后服务端照常重算、照常走让利三档。
- 不新增页面路由、权限键、接口；能新建报价的人就能导入。

**校验（纯函数，失败给中文原因）**
- 只接受 `format === "sunny-quote-studio"` 且 `version === 1`；行数 ≤ 500、附加项目 ≤ 200（与工具自身上限相同）；产品必须是青砚认识的 11 个品类。
- 丢弃且不留存：`windowPhotos`、`windowTrial`、`materials`、`materialSelection`。核对窗提示「有 N 张窗户照片未导入」。
- 比对文件自带价表与青砚价表：只比本次用到的品类，宽高档位与 MSRP 逐格相同才算一致。不一致时核对窗不显示「文件金额」，只显示青砚金额，并提示「该文件的价表与公司现行价表不同」。

**映射（纯函数，产出一份可直接交给 `applyFormState`（`page.tsx:703`）的表单数据 + 提示清单）**

| 文件里的 | 填到青砚 | 说明 |
|---|---|---|
| 客户名、电话、邮箱、地址、备注 | 客户四项、Part B 备注 | 按电话（只比数字）或邮箱在当前可见客户里找，唯一命中才自动选中，否则停在选择 / 新建客户，四项已带入 |
| 一行数量 N | N 行 | 房间名相同，第 2 行起加序号 |
| 宽、高 | 整数 + 1/16 | 不在 1/16 格上的四舍五入到最近一格并提示 |
| Zebra / Roller / Shangri-La / 蜂巢 / 天窗蜂巢 / Roman Shade / Fauxwood / Allusion | Shades 行 | `sku` 取文件 SKU，空则取面料键；**面料档以文件为准**，写入新增的可选字段 `pricingFabric`，定价优先用它，销售手动换 SKU 时清空 |
| Roller 的 `… w Cassette` / `… (Open Roll)` | Valance = `Cassette` / `None` | 依赖 QUOTE-1a |
| 无绳 | Cordless | 只对 Zebra / Roller |
| Shutters（`Vinyl` / `Wood`） | Shutters 行，Panel 数 1；材质 `Vinyl` / `Wooden` | `Wood` 依赖 QUOTE-1a。文件里同时有两种材质 → 阻断，提示拆成两份导入（青砚一张报价只有一种材质） |
| Drapery / Sheer / Door Screen Sheer | Drapes 行，每个文件行一行 | 面料键原样；褶皱率按判断点 2 |
| 行级折扣**低于**企业默认（价格更高） | 新增可选字段 `lineDiscountPct`，随行提交为 `discountOverridePct` | 行上显示「15% off · 导入」，可清除 |
| 行级折扣**高于**企业默认，或成交价低于青砚标准价 | 不带到行上；差额累加进特别让利 | Allusion 的成交价走现有手填单价 |
| 成交价高于青砚标准价（非 Allusion） | 不处理，列为提醒 | 极少见 |
| 附加项目，金额 ≥ 0 | Part B 行 | 名称与青砚目录的销售名或对客名完全相同（不分大小写）→ 用该预设键，单价取文件值；否则自定义行 |
| 附加项目，金额 < 0（工具里的「优惠」） | 累加进特别让利 | |
| Downtown 服务费 | Part B 预设 `downtown_fee`，单价取文件值 | |
| 含安装 + 含送货 | 安装方式 = 默认 | 文件运费低于企业运费 → 差额进特别让利；高于 → 自定义行「Delivery surcharge」 |
| 含安装 + 不含送货 | 安装方式 = 默认 | 企业运费全额进特别让利 |
| 不含安装 | 安装方式 = 自提 | 文件仍含送货 → 自定义行「Delivery」 |
| 税率 | 税率 | |
| Mount / Lift / Bracket / 褶型 / Panels 等工艺参数 | 留空 | 工具不记录；签字后由工艺单「待核对」门禁拦 |
| 工具报价号、报价 id、版本、方案、导出时间、文件价表版本、文件合计 | `formDataJson.importSource` | 只读留痕，零 schema |

**特别让利**：上表各处差额相加、取到分，填进现有的 Special Promotion 输入框。之后完全是现有逻辑：让利 ÷ 产品税前价得到比例，`decideDiscountTier`（`discount-tier.ts:34`）判三档。

**核对窗**
- 每行并排显示：文件金额（文件自己的折扣、成交价、数量）/ 青砚金额 / 差额 / 处理方式（一致、保留行折扣、计入让利、提醒）。行差绝对值 ≤ $0.01 × 数量视为一致。
- 底部并排显示两边的产品小计、附加项目、安装、送货、税前、税、合计，以及本次计入的特别让利总额。
- 提示分两级：**阻断**（不能填入表单：格式不对、产品不认识、Shutters 材质混用、尺寸超出价表）和**提醒**（可继续：尺寸取整、SKU 不在目录、价表不同、照片未导入、工艺参数待补）。

**表单与显示的配套改动**
- `ShadeOrderLine` 加可选 `pricingFabric`、`lineDiscountPct`；`DrapeOrderLine` 的两个褶皱率字段放宽为数字字符串，并加可选 `drapeLineDiscountPct`、`sheerLineDiscountPct`。都只落 `formDataJson`。
- SKU 下拉在当前值不在目录里时，把它作为一个选项显示（「目录外」），不再显示成未选。
- 保存带 `importSource` 的报价时写一条审计 `quote_imported`（新建与修改两条路径）。

**测试**（全部注册进 `scripts/test-all.sh`）
- 纯函数表驱动：校验（各类非法文件、超限、原型污染键）；映射（上表每一行至少一例）；让利累加；客户匹配；价表一致 / 不一致。
- 样例对照：「验收」里的 16 行样例，断言逐行金额与合计。
- 源码断言：导入代码不调用任何上传接口；`windowPhotos` / `materials` 不进入 `formDataJson`。
- 既有测试不变：158 条黄金、`valance-options`、`quote-fees`、`cost-rates`。

## 判断点（请拍板）

1. **Door Screen Sheer 到底卖多少。** 现在三个数：工具 $170.45 / $227.27（宽 ≤ 25 / ≤ 40，不打折）；青砚 $110.80 / $147.73（套了 35%）；Excel 参考表 $150 / $200。推荐 **A：以工具为准，青砚不再套折扣**（销售现在就是按这个数报给客户的）。B：按 Excel 的 $150 / $200 固定价，那工具也是错的，需要另行通知改工具。这项不拍板，QUOTE-1a 只做 Roller 和实木百叶窗两项。
2. **褶皱率不是 180 / 230 的行怎么导。** 推荐 **A：原样保留文件值**（如 200%），金额与工具一致，行上标「导入值」，销售可改回 180 / 230。B：导入时强制销售逐行选 180 或 230，金额会变。取决于工厂实际只做两档还是都能做。
3. **Roller 罩盒加价在详细订单补上。** 推荐 **补**：代码注释里 2026-08-26 已定口径，只是详细订单没接上。补上后带 Cassette / Fascia 的 Roller 行每行多 $25（宽 < 50）或 $50（宽 ≥ 50）。

已按 2026-11-14「按推荐」落实、不再单独问的：多方案文件一次导一套、每套一张报价；手改折扣与成交价走 Special Promotion 三档；图片本期不导入。实木百叶窗算不出价属于明显缺陷，直接修，不设判断点。

## Impact

- 修改（1a）：`quote-sheet/pricing-helpers.ts`（含 `:180` 过时注释）、`quote-sheet/page.tsx`（行构造）、`src/lib/blinds/discount-settings.ts`（Door Screen 例外）、`src/lib/blinds/valance-options.ts`（如需补一个「行 → 定价键」的导出）、`src/lib/blinds/__tests__/`（新增对照测试）。
- 新增（1b）：`src/lib/sales/quote-import/`（校验、映射、对照三个纯函数模块 + `__tests__`）、核对窗组件。
- 修改（1b）：`quote-sheet/page.tsx`（入口、行构造带 `pricingFabric` / 行折扣 / 数字褶皱率）、`types.ts`、`pricing-helpers.ts`、`order-shades.tsx`、`order-drapes.tsx`、`sku-select.tsx`、`quote-draft.ts`（草稿带新字段）、`src/app/api/sales/quotes/route.ts` 与 `src/lib/sales/quote-update.ts`（审计一条）、`scripts/test-all.sh`。
- 八条硬纪律：1（零 schema）遵守，新字段只落 `formDataJson` 与 `AuditLog`；2（出站先审批）不涉及，无任何对外发送；3（不新增队列）不涉及；4（脱敏）不涉及；5 不涉及；6 不涉及；7（确定性优先）全部是查表与纯函数，零 LLM 调用；8（测试注册）每个 change 遵守。
- 不新增权限键、模块、路由；路由门映射表不变。

## 上线顺序与 BREAKING

1. **QUOTE-1a**（BREAKING · 金额，只影响新建和再次保存的报价）：
   - 详细订单里带 Cassette / Fascia 的 Roller 行多收 $25 / $50；
   - 实木百叶窗从「算不出价」变为按价表计价；
   - 判断点 1 取 A 时 Door Screen Sheer 由 $110.80 / $147.73 变为 $170.45 / $227.27。
   上线前告知销售一次。
2. **QUOTE-1b**（无 BREAKING；依赖 1a，否则导入的 Roller 罩盒行、实木百叶窗行和 Door Screen 行会报差额或报错）。

每个 change 合并后 archive 一个小 PR，更新 Phase Q 状态列，各出一份报告 `docs/QINGYAN_QUOTE-1a_REPORT.md`、`docs/QINGYAN_QUOTE-1b_REPORT.md`。

## Out of scope

- 窗户照片、试装图、面料色样、画册页的导入与存储（方案 Q-3 / Q-5）。
- 多方案在青砚里的关联、对比与「签一套作废其余」（方案 Q-4）。本期每套方案是互不相干的一张报价。
- 按面料系列的折扣（方案 Q-2，另一份任务书）。本期靠保留文件里的行级折扣兜住。
- 替换旧版快速报价 `public/sunny-quote.html`（方案 Q-1）。
- 旧格式 `sunny-owner-quote`、工具的「完整备份」`sunny-workspace-backup`、Excel 报价模板的导入。
- 重复导入的拦截（本期只留痕 `importSource` 与审计，不查重）。
- 从青砚导出回工具。
- 把工具 SKU 补进青砚 SKU 目录（方案 Q-3）。
- 一张报价里混用两种百叶窗材质。
- 服务端对行级折扣加上限（见「不确定处」）。

## 验收

**样例**：用工具新建下面 16 行（或按附录 A 生成同一份文件），勾选安装、送货 $50、Downtown $150，附加项目「Motor tube」×2 @150 和自定义「Custom bracket」×1 @35，税率 13%，导出 JSON。下表右三列是**工具自己算出来的**（已用工具源码实跑）：

| # | 产品 | 配置 | 宽 × 高 | 数量 | SKU | 其它 | MSRP | 成交单价 | 安装 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Zebra | Light Filtering | 48.5 × 60 | 2 | LOUIA-WHITE-BL201-LF | | 350.00 | 192.50 | 18 |
| 2 | Zebra | Blackout | 90 × 60 | 1 | MILAN-GREY-BO | 无绳 | 733.13 | 513.19 | 26 |
| 3 | Roller | Blackout w Cassette | 55 × 72 | 1 | CABO-WHITE-BO | | 453.41 | 271.88 | 18 |
| 4 | Roller | Light Filtering (Open Roll) | 36 × 48 | 1 | — | 无绳 | 230.00 | 161.00 | 18 |
| 5 | SHANGRILA | Standard | 60 × 72 | 1 | — | | 788.64 | 512.61 | 18 |
| 6 | Cordless Cellular | Standard | 30 × 48 | 1 | B01-38-BO100 | | 323.86 | 210.51 | 18 |
| 7 | SkylightHoneycomb | Standard | 30 × 48 | 1 | — | | 489.77 | 318.35 | 18 |
| 8 | Roman Shade | Blackout | 40 × 60 | 1 | BMF06-BO | | 471.59 | 330.11 | 18 |
| 9 | Fauxwood | Standard | 36 × 48 | 1 | — | | 366.23 | 256.36 | 18 |
| 10 | Allusion | Standard | 60 × 84 | 1 | — | | 999.00 | 649.35 | 18 |
| 11 | Shutters | Vinyl | 72 × 60 | 1 | — | | 1,078.91 | 701.29 | 54 |
| 12 | Drapery | With liner (Black out) | 100 × 108 | 1 | — | 褶皱 2.0 | 1,279.55 | 831.70 | 90 |
| 13 | Sheer | Light Filtering | 100 × 108 | 1 | — | 褶皱 2.3 | 752.27 | 488.98 | 90 |
| 14 | Sheer | Door Screen Sheer | 30 × 48 | 1 | — | | 227.27 | 227.27 | 55 |
| 15 | Zebra | Light Filtering | 40 × 50 | 1 | PRADO-WHITE-LF | 行折扣 15% | 276.14 | 234.72 | 18 |
| 16 | Roller | Blackout (Open Roll) | 40 × 50 | 1 | — | 成交价 120 | 271.59 | 120.00 | 18 |

工具合计：产品 6,212.32 + 附加 335.00 + 安装 531.00 + 送货 50.00 + Downtown 150.00 = 税前 7,278.32，HST 946.18，**合计 8,224.50**。

**导入后（判断点 1、2 取 A，企业运费 $50）**
- 表单里是 17 行（第 1 行拆成 2 行）：Shades 13 行、Shutters 1 行、Drapes 3 行。
- 核对窗：第 1–14 行「一致」；第 15 行「保留行折扣 15%」；第 16 行「计入让利 $29.38」（青砚标准价 $149.38 − 成交价 $120）；无阻断项。
- Special Promotion 自动填 **$29.38**；Part B 有 Motor tube ×2、Custom bracket、Downtown Service Fee $150。
- 保存后库里合计取整到分是 **8,224.51**（未取整 8,224.5055），与工具差不超过 $0.01；报价带 `importSource`；审计多一条 `quote_imported`。
- 把企业运费设为 $75 再导一次：Special Promotion 变为 **$54.38**，合计不变。
- 第 3 行在表单里 Valance = Cassette，行金额 $271.88；手动改成 None 后变为 $221.88。
- 第 6 行的 SKU 不在目录里，下拉显示该 SKU 并标「目录外」，不是空白。
- 把第 11 行改成 `Wood` 再导：表单材质为 Wooden，行金额 $1,172.22。
- 让利审批：只留第 16 行、成交价改成 $100 的文件，让利 $49.38 ÷ 产品税前 $149.38 ≈ 33%。用销售账号保存，行为与在表单里手填同额让利完全一致（代码默认销售上限 25%、合价上限 35%，以企业设置为准）。

**反例**
- 把文件里 Zebra 的任一格 MSRP 改掉再导入：核对窗不显示文件金额，提示价表不同，仍可继续。
- 同一文件里一行 Vinyl、一行 Wood 的 Shutters：阻断，提示拆分。
- 带 3 张窗户照片的文件：提示「3 张窗户照片未导入」；保存后的 `formDataJson` 里没有图片数据。
- 改 `format` 或 `version`、600 行、非 JSON：各自给出中文原因，不进核对窗。

**工程**
- `npm run test:ci`、`npm run typecheck` 通过；新增测试全部在 `scripts/test-all.sh` 注册；158 条黄金用例不变。
- Prisma schema 无 diff；`vercel.json` 无 diff；无新增 LLM 调用点；导入全程无文件上传请求。
- `openspec validate <change>` 通过；specs 增量覆盖：Roller 罩型计价、实木百叶窗计价、Door Screen Sheer 折扣规则、文件校验与拒绝原因、映射规则、让利累加、核对窗的一致判定、`importSource` 与审计。

## 不确定处（实现前先核对，结果写进各自的 design.md）

- **没有真实的导出文件。** 字段结构来自工具源码（`fresh()`、`QUOTE_PLAN_FIELDS`、`validateQuote`、`exportJSON`），样例是用工具的定价核心在 Node 里生成的，不是从界面点「导出」得到的。实现前请 Lucas 从工具里导出 2–3 份真实报价（含一份多方案、一份带照片）做一次对照。
- **多方案文件的展开方式**只读了源码：顶层是当前方案，`plans[]` 是其余最多 2 套，`planWindows` 存共用的房间与照片。没有用真实文件验证过。
- **Sunny 企业设置里的运费、最低安装费、各品类折扣、让利上限实际是多少**没有核对（生产数据）。代码默认运费是 $75，工具默认 $50；如果生产也是 75，每份导入都会多出 $25 让利，建议先把企业运费对齐。
- **服务端目前原样接受任何行级折扣**（`discount-settings.ts:210`）。本期导入只会提交「让价格更高」的行级折扣，但接口本身没有上限；旧版快速报价也走这条路，是否加上限放到替换旧版时一并处理。
- **a、c 两条（Roller 罩盒少收、实木百叶窗算不出价）**来自读代码和实跑定价函数，没有在界面上点过一遍；实现 1a 前先在页面上各复现一次。若页面上另有我没读到的处理，以页面实际为准并回报。
- **附加项目按名称匹配**：工具里附加项目的 id 是随机的、名称可改，只能按名称对。对不上的进自定义行，金额不受影响，但不会套青砚的企业价。
- **Roman Shade**：样例里两边按价表计价一致；青砚另有手填价的「Roman」品类，工具没有对应，本期不涉及。
- 详细订单的 Part C（安装与送货展示）用的是页面常量还是企业设置，没有逐行核对；核对窗的「青砚金额」以服务端同一个计价函数为准，不取页面常量。

---

## 附录 A · 样例生成脚本（已按原文实跑，输出 8224.5）

从工具 `index.html` 取两段：含 `root.QuoteCore=api` 的那个 `<script>`（以 `(function(root){` 开头，约 17 KB）存成 `quote-core.cjs`；`<script id="seed" type="application/json">` 的内容存成 `seed.json`。然后：

```js
const C = require('./quote-core.cjs'), seed = require('./seed.json');
const pricing = C.defaultPricing(seed);
const rows = [
  ['Zebra','Light Filtering',48.5,60,2,'LOUIA-WHITE-BL201-LF',{}],
  ['Zebra','Blackout',90,60,1,'MILAN-GREY-BO',{cordless:true}],
  ['Roller','Blackout w Cassette',55,72,1,'CABO-WHITE-BO',{}],
  ['Roller','Light Filtering (Open Roll)',36,48,1,'',{cordless:true}],
  ['SHANGRILA','Standard',60,72,1,'',{}],
  ['Cordless Cellular','Standard',30,48,1,'B01-38-BO100',{}],
  ['SkylightHoneycomb','Standard',30,48,1,'',{}],
  ['Roman Shade','Blackout',40,60,1,'BMF06-BO',{}],
  ['Fauxwood','Standard',36,48,1,'',{}],
  ['Allusion','Standard',60,84,1,'',{}],
  ['Shutters','Vinyl',72,60,1,'',{}],
  ['Drapery','With liner (Black out)',100,108,1,'',{fullness:2}],
  ['Sheer','Light Filtering',100,108,1,'',{fullness:2.3}],
  ['Sheer','Door Screen Sheer',30,48,1,'',{}],
  ['Zebra','Light Filtering',40,50,1,'PRADO-WHITE-LF',{discountOverridePct:0.15}],
  ['Roller','Blackout (Open Roll)',40,50,1,'',{offer:120}],
];
const items = rows.map(([product,fabric,w,h,qty,sku,x],i)=>({id:'i'+i,product,fabric,w,h,qty,room:'R'+(i+1),sku,
  cordless:false,offer:null,discountOverridePct:null,fullness:null,note:'',...x}));
const quote = {id:'q1',number:'SQ-TEST',customer:'Test',phone:'',email:'',address:'',items,
  addons:[{id:'a1',name:'Motor tube',qty:2,price:150,unit:'ea',note:''},{id:'a2',name:'Custom bracket',qty:1,price:35,unit:'ea',note:''}],
  pricing,install:true,delivery:true,downtown:true,deliveryAmount:50,downtownAmount:150};
C.validateQuote(quote);
console.log(C.totals(quote).grand); // 8224.5
require('fs').writeFileSync('sample.sunny-quote.json',
  JSON.stringify({format:'sunny-quote-studio',version:1,exportedAt:new Date().toISOString(),quote}));
```

仓库已有同类脚本可参考：`scripts/pricelist/extract-seed.py`、`scripts/pricelist/gen-golden.mjs`。

## 附录 B · 后续队列（不属于本任务书）

| ID | 对应方案 | What | 前置 |
|---|---|---|---|
| QUOTE-2 原生快速报价 | Q-1 | 行式录入 + 批量设置替换旧版 HTML；删除 `sunny-quote.html` 与 `rough-quote-panel.tsx`；服务端对行级折扣加上限 | QUOTE-1a |
| QUOTE-3 系列折扣 | Q-2 | 11-05 销售告示的 15 / 35 / 45 三档进服务端定价；需要先定「系列 → SKU」对照表 | Lucas 给出对照表 |
| QUOTE-4 客户报价输出 | Q-3 | 面料图与画册页进 PDF 和客户链接；隐藏尺寸 / 隐藏折扣；SKU 目录补全（至少本次缺的 197 个） | QUOTE-2 |
| QUOTE-5 多方案 | Q-4 | 方案组、对比、签一套作废其余 | QUOTE-1b |
| QUOTE-6 窗户照片与试装 | Q-5 | 照片挂到报价行；导入时带上照片 | QUOTE-1b |
