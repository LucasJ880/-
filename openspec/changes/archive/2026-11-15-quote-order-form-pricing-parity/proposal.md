# Proposal

## Why

详细订单把表单行交给定价时丢了两样东西：Roller 行的罩型（选了 Cassette / Fascia 不加价，55" × 72" 遮光少收 $50）和实木百叶窗的价表键（表单存 `Wooden`、价表键是 `Wood`，整行算不出价）；现有 158 条黄金用例只测引擎，测不到「表单行 → 定价键」这一段。QUOTE-1b 的导入要靠这一段把工具里的罩盒行与实木行算对，所以先修（任务书 `docs/QINGYAN_QUOTE-1_QUOTE_FILE_IMPORT_TASKBRIEF.md` Why 表 a、c；判断点 3 已拍板「做」）。

TASKFLOW：QUOTE-1a（`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase Q）。

## What Changes

- **BREAKING（金额）** 让详细订单的 Roller 行按「基础面料 + 生效罩型」取定价键：`Cassette` → `… w Cassette`、`Fascia` → `… w Fascia`、`None` 或无 → `… (Open Roll)`；带罩行加价 25（宽 < 50"）/ 50（宽 ≥ 50"），无绳行再 ×1.15。
- **BREAKING（金额）** 定生效罩型为「行上 Valance，行上为空时取 Shades 表底部的 Valance Type」，与工艺单取罩盒的口径相同（Lucas 2026-11-15 拍板「同口径」）；定价与工艺单读同一个取值。
- **BREAKING（金额）** 让表单材质 `Wooden` 的百叶窗行按价表键 `Wood` 计价；表单、PDF、工艺单上的 `Wooden` 字样不改。
- 把「表单行 → 定价键」收进一个纯函数，把保存时的行构造从页面组件里抽成一个纯函数；页面预览、报价 PDF、保存提交三处只经这两个函数取键，不再各写一份。
- 让报价 PDF 的 Shades 表 Valance 列显示生效罩型（行上为空时显示表底部的 Valance Type），不再只显示行上的值（Lucas 2026-11-15 走查后拍板）。
- 删除 Shutters 表下方「Wooden shutters pricing data is not available … set price manually in Part B」横幅。
- 给按新口径保存的表单数据写标记 `formDataJson.orderPricingRev: 2`；打开没有该标记、材质为 Wooden 且有可计价百叶窗行的已存报价或本地草稿时，页面顶部提示「实木百叶窗现已自动计价，请检查 Part B 并删除手填的百叶窗价格」（Lucas 2026-11-15 拍板取 B）。
- 新增对照测试 `src/lib/blinds/__tests__/order-form-pricing-parity.test.ts`，走「表单行 → 行构造 → 企业默认折扣 → 引擎」完整路径，并断言预览金额 = 保存金额；与实现同一个 task 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- 已存报价不重算、不回填：库里金额在该报价再次保存之前不变。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `sales/price-list`：新增七条要求——详细订单 Roller 行罩型计价、定价罩型与工艺单同一取值、报价 PDF 显示生效罩型、详细订单实木百叶窗计价、预览 / PDF / 保存金额一致、口径标记与实木旧报价提醒、已存报价不重算。既有要求（含「老产品定价不变」「黄金用例对照」）不改。

## Impact

- 新增：`src/lib/blinds/order-form-pricing.ts`（定价键、生效罩型、口径标记、提醒判定）、`src/app/(main)/sales/quote-sheet/order-items.ts`（行构造）、`src/lib/blinds/__tests__/order-form-pricing-parity.test.ts`。
- 修改：`src/app/(main)/sales/quote-sheet/{pricing-helpers.ts,page.tsx,order-shades.tsx,order-shutters.tsx,quote-pdf.ts,quote-draft.ts,types.ts}`、`src/lib/sunny-process/quote-mapping.ts`（改为调用同一个生效罩型取值，输出不变）、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 金额影响面（只影响新建与再次保存的报价）：带罩 Roller 行、实木百叶窗行的行金额；随之变化的产品小计、安装费合计（实木行此前不计）、最低安装费差额与运费（此前整单只有实木行时两项都不收）、MSRP 合计与成交折扣率、特别让利占比（分母变大）、报价 PDF 行金额；实木报价的保存结果由「部分行未计价」变为全部计价。
- 接口、权限键、路由、Prisma schema、`vercel.json`、企业设置键：无变化。
- 不触碰 muse-bridge：无受影响 Muse 意图。
- 上线前告知销售一次（两条：Roller 带罩行加价；实木百叶窗自动计价、Part B 不再手填）。

## Out of scope

- Door Screen Sheer 是否套纱帘的企业折扣（任务书判断点 1）：未拍板，本 change 不实施，待 Lucas 拍板后另起 change 或追加。现状复现结果记在 design.md「Context」。
- 褶皱率非 180 / 230 的行（判断点 2）、报价文件导入、行级折扣字段、`pricingFabric` 字段、SKU 下拉「目录外」：属 QUOTE-1b。
- 快速报价（`rough-quote-panel.tsx`、`public/sunny-quote.html`）、量房生成报价、AI 报价录入、Muse / agent 报价工具：它们不经详细订单的行构造，本次不动。
- 已隐藏的 Part A（`part-a.tsx`）：已按罩型取键，不动。
- Zebra 及其它产品的 Valance：不进定价，不动。
- 百叶窗默认材质（现为 Wooden）不改；一张报价混用两种材质不支持。
- 已存报价金额的回填或批量重算；按 Part B 内容自动识别并删除手填的百叶窗价格。
- 服务端对 `fabric` 与 `sku` 的一致性校验、对行级折扣加上限。
- 价表数值、`config/pricelist/**`、158 条黄金用例：不改。
