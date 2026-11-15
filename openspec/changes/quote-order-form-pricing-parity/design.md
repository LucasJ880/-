# Design

## Context

动机见 proposal.md「Why」。已核实的现状（2026-11-15，main @ `0b46a74`，与任务书写作时同一提交，行号未漂移）：

**取键有三处消费方，两种写法都只看 SKU / 材质**
- 保存：`src/app/(main)/sales/quote-sheet/page.tsx` `handleSave` 内联构造 `QuoteItemInput[]`（`:869` 起）。Shades 行 `:901` `skuToPricingFabric(l.sku, l.product)`；Shutters 行 `:927` `fabric: shutterMaterial`。
- 预览：`pricing-helpers.ts` `computeShadeLinePrice`（`:131` 同一调用）、`computeShutterLinePrice`（`:193` 直接把 `"Wooden" | "Vinyl"` 传给 `priceFor`）。`:180` 的注释「MSRP_SHUTTERS 目前只有 Vinyl 数据」已过时——`pricing-data.ts` 有 `Vinyl`、`Wood` 两张表。
- PDF：`quote-pdf.ts:627 / 641 / 842 / 895` 调同一组预览函数，所以 PDF 上的行金额跟着预览走。
- `rollerEngineFabricKey` / `parseRollerFabric`（`src/lib/blinds/valance-options.ts`）只有已隐藏的 Part A 在用。

**详细订单有两个 Valance 输入**（任务书未提，第 1 步核对时发现）
- 行上 Valance：`order-shades.tsx:305`，选项来自 `valanceOptionsFor(product)`；新行默认空串（`order-shades.tsx:89`、`page.tsx:145`），换产品不重置。
- 表底部 Valance Type：`order-shades.tsx:431`，Cassette / Fascia 二选一，存 `formDataJson.shadeValanceType`。
- 工艺单：`src/lib/sunny-process/quote-mapping.ts:198` `s(l.valance) || formValance`，再经 `headrailFor`（Cassette → 亮白插片圆盒、Fascia → 哑白方型罩盒、None 或 Roller 无值 → 单轨无盒）。
- 定价两个都不看。Lucas 2026-11-15 拍板：定价与工艺单同口径。

**实木百叶窗现在有一条「去 Part B 手填」的指引**（任务书未提）
- `order-shutters.tsx:328`：材质 Wooden 且有行报错时显示横幅「Wooden shutters pricing data is not available in current catalog. Switch to Vinyl for automatic pricing, or set price manually in Part B.」
- `page.tsx:302`：`shutterMaterial` 初始值是 `"Wooden"`。
- 服务端（`src/app/api/sales/quotes/route.ts:154` 起）对算不出价的行不抛错：该行不落库、报错写进备注，其余行照存（`partial`）；全部行都算不出时存空壳（`shell`），此时不收运费也不补最低安装费。
- Lucas 2026-11-15 拍板取 B：修计价、删横幅，并在打开旧的实木报价时提醒检查 Part B。

**SKU 有时本身就是完整定价面料**：SKU 目录 CSV 加载失败时下拉回落到价表面料键（`sku-catalog.ts` `getSkusByProduct` → `buildFallbackEntries`），Roller 的键含 `Blackout w Cassette` 等六个；这类行今天已按键原样计价。

**第 1 步复现输出**（修之前；脚本原样抄了 `handleSave` 的三句行构造并先断言源码未变，「预览」调真实的 `compute*LinePrice`，「保存」走 `applyOrgDiscountDefaults` → `calculateQuoteTotal`，缺省企业折扣）：

```
[源码] page.tsx:901  const pricingFabric = skuToPricingFabric(l.sku, l.product);
[源码] page.tsx:927  fabric: shutterMaterial,
[源码] page.tsx:959  fabric: l.sheerFabricSku,

a. Roller 55×72 CABO-WHITE-BO（期望：Cassette / Fascia = 271.88，None = 221.88）
  Valance=None     定价键="Blackout (Open Roll)"  保存=221.88  预览=221.88
  Valance=Cassette 定价键="Blackout (Open Roll)"  保存=221.88  预览=221.88
  Valance=Fascia   定价键="Blackout (Open Roll)"  保存=221.88  预览=221.88
  对照：引擎直接用 "Blackout w Cassette" = 271.88

b. Door Screen Sheer 30×48，无行级折扣（工具 227.27）
  applyOrgDiscountDefaults 后 discountOverridePct=0.35
  保存=147.73  预览=147.73  （引擎不带折扣=227.27）

c. Shutters 72×60（价表键 Wood 期望 1172.22）
  材质=Wooden 保存=报错「Pricing for fabric "Wooden" under "Shutters" is not set yet.」  预览=报错「Pricing for fabric "Wooden" under "Shutters" is not set yet.」
  材质=Vinyl  保存=701.29  预览=701.29
  对照：引擎直接用 "Wood" = 1172.22
```

三条都与任务书一致。b（Door Screen Sheer，宽 25" 为 110.80 / 170.45，宽 30" 为 147.73 / 227.27）本 change 不改，只留此记录，待判断点 1 拍板。这是函数层复现，未在浏览器里点页面；页面走查放在 tasks 3.1。

引擎侧参考值（缺省折扣，Blackout，高 72"；用于对照测试里的字面量）：

| 窗宽 | Open Roll | w Cassette / w Fascia | 差 | 无绳 Open Roll | 无绳带罩 | 差 |
|---|---|---|---|---|---|---|
| 49" | 202.50 | 227.50 | 25 | 296.39 | 325.14 | 28.75 |
| 50" | 202.50 | 252.50 | 50 | 296.39 | 353.89 | 57.50 |
| 55" | 221.88 | 271.88 | 50 | 324.74 | 382.24 | 57.50 |

## Goals / Non-Goals

**Goals:**
- 详细订单的预览、PDF、保存对同一行给出同一个定价面料与同一个金额，由测试守住。
- 定价的罩型与工艺单的罩盒读同一个取值，由测试守住。
- 对照测试跑的是页面实际用的行构造函数，不是抄写。

**Non-Goals（不动的东西）:**
- `src/lib/blinds/pricing-engine.ts`、`pricing-data.ts`、`pricing-types.ts`、`sku-catalog.ts`：引擎、价表、SKU 推档规则不改。
- `src/lib/blinds/discount-settings.ts`：`applyOrgDiscountDefaults` 不改（Door Screen Sheer 例外属判断点 1）。
- `config/pricelist/**`、`src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts`：158 条黄金用例与其分组不改。
- `src/app/api/sales/quotes/route.ts`、`src/lib/sales/quote-update.ts`、`src/app/api/sales/quotes/preview/route.ts`：服务端入口不改，仍对收到的 `fabric` 原样计价。
- `src/app/(main)/sales/quote-sheet/part-a.tsx`、`rough-quote-panel.tsx`、`order-drapes.tsx`、`public/sunny-quote.html`、`src/app/(main)/sales/measure/page.tsx`、`src/app/api/sales/measurements/[id]/generate-quote/route.ts`、`src/app/api/sales/ai-quote-intake/route.ts`、`src/lib/agent-core/tools/sales-quote.ts`。
- `src/lib/sunny-process/quote-mapping.ts` 的输出：只把 `s(l.valance) || formValance` 换成调用共享取值，工艺单内容逐字不变（`quote-mapping.test.ts` 不改且全过）。
- `src/lib/sales/discount-tier.ts`、签约后改金额的审批（能力 `sales/signed-quote-amount-approval`）：不改，本 change 不绕过。
- `prisma/schema.prisma`、`vercel.json`、`src/lib/muse-bridge/**`、`.claude/launch.json`、`openspec/specs/**`。
- 百叶窗默认材质（`page.tsx:302` 的 `"Wooden"`）。

## Decisions

### D1 定价键收进 `src/lib/blinds/order-form-pricing.ts`，一个模块、纯函数
- 做法：新模块导出
  - `effectiveShadeValance(rowValance, formValance)`：行上去空白后非空取行上，否则取表单级，否则空串；
  - `shadeLinePricingFabric({ product, sku }, valance)`：非 Roller → `skuToPricingFabric(sku, product)`（与现状逐字相同）；Roller → 先 `skuToPricingFabric` 得到完整键，`parseRollerFabric` 取基础面料，`valance` 非空时 `rollerEngineFabricKey(base, valance)`，`valance` 为空时原键照旧（D3）；
  - `shutterPricingFabric(material)`：`"Wooden"` → `"Wood"`，其余原样；
  - `ORDER_PRICING_REV = 2` 与 `needsWoodRepriceNotice(...)`（D6）。
  模块只依赖 `valance-options.ts`、`sku-catalog.ts`、`pricing-types.ts`，入参用结构类型，不引用页面目录的类型。
- 否决：把这几个函数加进 `valance-options.ts`——百叶窗材质映射与口径标记不属于罩型。否决：在引擎 `priceFor` 里兼容 `Wooden`、在 `fallbackFabricKey` 里读罩型——引擎拿不到行上的 Valance，且会让「表单词汇」渗进价表层；`Wooden` 进引擎还会改变其它入口对坏输入的报错行为。否决：把价表键 `Wood` 改名 `Wooden`——要动价表文件与黄金用例。

### D2 生效罩型 = 行上 → 表底部 Valance Type → 无，定价与工艺单调同一个函数
- 做法：`quote-mapping.ts:198` 改为 `effectiveShadeValance(s(l.valance), formValance)`（语义与现有 `||` 相同，输出不变）；预览、PDF、行构造都把 `shadeValanceType` 传进来。行上明确选 `None` 时不回落到表底部（`"None"` 非空）。
- 对照测试对「行上 4 种 × 表底部 3 种」12 个组合同时计价和生成工艺单，断言「含罩盒加价 ⇔ 罩盒不是单轨无盒」。
- 否决：只看行上 Valance（任务书原文）——行上留空、表底部选 Cassette 时工厂做罩盒而报价按无罩，少收照旧。否决：定价里另写一份 `row || form`——两处各写一份正是本次要消除的漂移来源。否决：给 Roller 新行默认填 `None`——改变表单默认值会让旧草稿与新行行为不一，且不解决已存表单。

### D3 没有生效罩型时，SKU 自带的完整 Roller 键原样计价
- 做法：`valance` 为空且 `skuToPricingFabric` 返回的键能被 `parseRollerFabric` 认出罩型（如 `Blackout w Cassette`）时不改写；有生效罩型（含 `None`）时以罩型为准重组键。普通 SKU（`CABO-WHITE-BO`）在 `valance` 为空时得到 `… (Open Roll)`，与现状相同。
- 理由：`valance-options.ts` 头注释已定「已存的完整 fabric 键原样定价」；这条路径今天就按带罩计价，改成 Open Roll 会让这类行降价。
- 已知不一致（保留现状）：这类行（SKU 是带罩键、两处 Valance 都空）定价带罩、工艺单是单轨无盒。只在 SKU 目录加载失败回落时出现；specs 的「同一取值」要求已把它排除在外。
- 否决：SKU 自带罩型优先于行上 Valance——行上的 Valance 是销售看得见、工艺单也在用的那个值。

### D4 预览函数把表单级罩型作为末位参数，调用点由源码断言守住
- 做法：`computeShadeLinePrice(line, installMode, discounts?, sunnyMotorPrice, cordlessPolicy, formValance = "")`、`sumShadeTotals(…, formValance = "")`、`sumAllMsrp(…, sunnyMotorPrice, formValance = "")`，既有参数的位置不动；`computeShutterLinePrice` 内部经 `shutterPricingFabric(material)` 取键，签名不变。调用方：`order-shades.tsx`（已有 `valanceType` 属性）、`page.tsx`（`shadeValanceType`）、`quote-pdf.ts`（输入对象加 `shadeValanceType`，页面传入）。同时改掉 `pricing-helpers.ts:180` 的过时注释。对照测试的源码断言逐个检查这 5 处调用（页面 2、Shades 表 1、PDF 2）的最后一个实参是表底部罩型。
- apply 中更正（原稿是「必填的第二个参数，漏改的调用点编译失败」）：`pricelist-2026-10-golden.test.ts` 末尾的本地用例按旧的参数顺序调 `computeShadeLinePrice` 与 `sumAllMsrp`，而 `tsconfig.json` 把 `**/__tests__` 排除在类型检查之外——在第二位插入参数既不会让它编译失败，又会让它运行时错位（实测 `sumAllMsrp` 直接抛错）。黄金测试文件不许动，所以改为末位可选参数：旧调用的含义一字不变（等于「表底部未选」），黄金测试 158 条 / 787 条断言与基线相同。
- 否决：必填的第二个参数——见上。否决：为此改黄金测试文件的调用——违反「158 条黄金用例与其测试文件不改」。否决：改成单个 `ctx` 对象入参——同样要改黄金测试文件，且六个调用点全部重写。
- 代价：漏传不再是编译错误，改由源码断言（SRC-05）兜住；新增调用点时断言里的计数会失败，提醒补上。

### D4a 报价 PDF 的 Valance 列显示生效罩型（apply 走查后追加，Lucas 2026-11-15 拍板）
- 起因：走查 ⑤ 发现行上留空、靠表底部 Valance Type 加价的 Roller 行，PDF 上 Valance 列是「—」而金额含罩盒加价——客户看到的罩型与收的钱对不上。
- 做法：`quote-pdf.ts` Shades 表该列由 `l.valance || "—"` 改为 `effectiveShadeValance(l.valance, input.shadeValanceType) || "—"`，对所有 Shades 产品一致（Zebra 等的罩型不进定价，但工艺单同样按生效罩型做）。页面表格的行上 Valance 按钮不变。
- 否决：只对 Roller 行显示生效罩型——同一张 PDF 里两种规则，且 Zebra 行的工艺单也是按表底部取的。否决：在 PDF 另加一行打印表底部的 Valance Type——逐行对不上，客户仍要自己推。

### D5 行构造抽成 `src/app/(main)/sales/quote-sheet/order-items.ts` 的纯函数
- 做法：把 `handleSave` 里 `// Shades` 到 `// Drapes` 三段原样搬进 `buildOrderFormItems({ shadeOrders, shutterOrders, drapeOrders, shutterMaterial, shadeValanceType })`，返回 `QuoteItemInput[]`；只改两处取键（`shadeLinePricingFabric(l, effectiveShadeValance(l.valance, shadeValanceType))`、`shutterPricingFabric(shutterMaterial)`）。百叶窗行 `fabric` 为定价键（`Wood` / `Vinyl`），`sku` 仍是表单材质（`Wooden` / `Vinyl`）——与 Roller 行「`fabric` 是定价键、`sku` 是销售选的值」一致。其余字段、跳过规则、Drapes 两段逐字不变。`page.tsx` 改为调用它，并删掉对 `skuToPricingFabric` 的直接引用。
- 放在页面目录而不是 `src/lib`：它消费的是页面的表单行类型（`ShadeOrderLine` 等定义在同目录 `types.ts`）；`src/lib` 下的测试引用页面目录代码已有先例（`src/lib/sales/__tests__/*-db.isolated.test.ts`）。
- 否决：行构造留在组件里、测试里抄一份——测的就不是页面实际跑的代码（第 1 步的复现脚本只能这么做，正说明问题）。否决：搬到服务端由接口收表单行——改接口契约，超出本次范围。

### D6 口径标记 `orderPricingRev` 与实木旧报价提醒
- 做法：`QuoteFormState` 与 `QuoteDraftV1` 加可选 `orderPricingRev?: number`；页面持有「载入时的标记」状态——新建表单为 2，`applyFormState` 载入已存报价或本地草稿时取其值（缺省视为 1）；`handleSave` 写出的 `fullFormData` 恒为 2，保存成功后把状态置 2；本地草稿原样带着载入时的值。`needsWoodRepriceNotice({ loadedRev, shutterMaterial, shutterTotalsMerch })` 在 `loadedRev < 2 && shutterMaterial === "Wooden" && 百叶窗商品小计 > 0` 时为真。为真且本次打开未点「知道了」时，在表单顶部渲染一条琥珀色提示：「实木百叶窗现已按价表自动计价（本单百叶窗 $X）。这张报价保存于改动之前，此前实木百叶窗的价格需在 Part B 手填——请检查 Part B，删除手填的百叶窗价格，避免重复计价。」带「知道了」按钮。不拦保存。删除 `order-shutters.tsx:328` 的旧横幅。
- 「提示一次」的落法：每次打开都提示，直到该报价按新口径保存过一次；「知道了」只在本次打开内有效，不写库。
- 否决：不加标记、凡是 Wooden + Part B 有自定义行就提示——新报价也会一直提示，很快被无视。否决：按库里有没有 Shutters 报价行来判断「以前没算出价」——编辑页载入时只用 `formDataJson` 与让利审批字段、不读报价行，要为此多读一类数据并处理「部分计价」的多种成因。否决：自动删除 Part B 里疑似手填的百叶窗行——无法可靠识别，静默改销售填的金额违反任务书「不静默改数」。否决：把标记落到新列或企业设置——纪律 1；这是单张报价的属性，不是企业设置。

### D7 对照测试 `order-form-pricing-parity.test.ts`
- 位置 `src/lib/blinds/__tests__/`，纯逻辑、无 DB；与 D1 的模块同一个 task 创建并注册进 `scripts/test-all.sh`（与 `valance-options`、黄金对照相邻）与 `scripts/test-ci-unit.sh`，后续 task 往里加用例。
- 路径：表单行 → `buildOrderFormItems` → `applyOrgDiscountDefaults` → `calculateQuoteTotal`，与 `computeShadeLinePrice` / `computeShutterLinePrice` / `computeDrapeLinePrice` 的预览金额逐行比。
- 期望值两种来源并用：任务书与上表的字面量（271.88 / 221.88 / 227.50 / 252.50 / 382.24 / 1172.22 / 701.29）；以及用完整键直接调 `priceFor` 的结果（引擎已由 158 条黄金用例钉住）。
- 分组：① 定价键矩阵（Roller `-BO` 与 `-LF` 各一个真实 SKU × 行上 4 种 × 表底部 3 种；SKU 为完整键的 D3 用例；非 Roller 取键与 `skuToPricingFabric` 相同）；② 金额（窗宽 49 / 50 / 55 × 有无无绳；Wooden / Vinyl × Panel 数 1 / 2；安装费）；③ 预览 = 保存（缺省折扣与非缺省折扣各一轮，含 Zebra / Drapery / Sheer / Door Screen Sheer 行——后者只断言两边相等，不钉口径）；④ 定价 ⇔ 工艺单罩盒（`mapQuoteFormToProcessOrder` 的同一份表单）；⑤ 提醒判定；⑥ 源码断言：`page.tsx`、`pricing-helpers.ts`、`quote-pdf.ts` 不含 `skuToPricingFabric(`，`page.tsx` 不含 `fabric: shutterMaterial`，`order-shutters.tsx` 不含 `set price manually in Part B`，`quote-mapping.ts` 含 `effectiveShadeValance(`。
- 否决：把用例加进 `pricelist-2026-10-golden.test.ts`——那份测试的契约是「黄金文件 158 条」，混入表单路径用例会让「158 条不变」无从核对。否决：只做源码断言——断言不了金额。

## 与八条硬纪律的关系

1. **零 schema**：触碰并遵守。新数据只有 `formDataJson.orderPricingRev`（既有 JSON 位）与本地草稿里的同名字段；不新增 model、字段、migration；`git diff --stat origin/main -- prisma/` 为空。
2. **出站动作先审批**：不涉及。无任何对外发送；提醒是页面内文字，不发通知、不发邮件。
3. **禁止第三套队列**：不涉及。无 cron、队列、worker、租约。
4. **脱敏**：不涉及。不触碰 muse-bridge，不输出毛利率、项目估值、最终报价到 Muse 通道；本次不新增任何成本字段的输出。
5. **不爬登录页**：不涉及。无外部请求。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。全部是查表与纯函数，零新增 LLM 调用。
8. **测试注册**：触碰并遵守。新测试与被测模块同一个 task 注册进 `scripts/test-all.sh`（并进 `scripts/test-ci-unit.sh`）；`bash scripts/check-test-registry.sh` 退出 0；`ci/test-registry-baseline.txt` 不增。

## BREAKING（金额变化）

只影响新建的报价与再次保存的已存报价；库里已有金额不回填。

| # | 什么变了 | 之前 | 之后 |
|---|---|---|---|
| B1 | Roller 行，行上 Valance = Cassette / Fascia | 按 Open Roll 计价 | 每行 +25（宽 < 50"）/ +50（宽 ≥ 50"）；无绳行 +28.75 / +57.50 |
| B2 | Roller 行，行上 Valance 为空、表底部 Valance Type = Cassette / Fascia | 按 Open Roll 计价 | 同 B1（比任务书原范围多出的一类，来自「同口径」拍板） |
| B3 | 百叶窗材质 Wooden | 行不计价、不落库，整单只有这类行时存空壳、不收运费与最低安装费差额 | 按 `Wood` 表计价（72" × 60" 为 1172.22 + 安装 54），计入小计、安装费、最低安装费与运费判断 |
| B4 | 随 B1–B3 变化的派生数 | — | 产品小计、MSRP 合计与成交折扣率、特别让利占比（分母变大，占比变小，可能由「需审批」落到「销售可批」）、定金占比判断、报价 PDF 行金额 |
| B5 | 再次保存旧的实木报价 | Part B 手填价是唯一的百叶窗金额 | 自动计价 + Part B 手填价会重复计入，除非销售按 D6 的提醒删掉手填行 |

不变：Zebra 等其它产品；Vinyl 百叶窗；行上明确选 None 的 Roller 行；SKU 为完整键且无生效罩型的 Roller 行（D3）；Door Screen Sheer；其它报价入口。

## Risks / Trade-offs

- [B5：销售没看提醒就保存，实木报价重复计价] → 提醒写明本单百叶窗金额，便于和 Part B 对照；上线前告知销售；报告里给出一条只读查询，列出表单材质为 Wooden、有百叶窗行且 Part B 有自定义行的已存报价数量，供 Lucas 判断是否逐张回看（查询在生产由 Evan / Lucas 执行，本 change 不连生产库）。
- [默认材质是 Wooden：销售忘了切 Vinyl，现在会按更贵的 Wood 表出价而不再报错] → 表头材质按钮与 PDF 的 `Shutters (Wooden…)` 都看得见；默认值不在本次范围，报告里列为后续项。
- [打开旧报价时预览已是新金额，库里还是旧金额，期间看板在再次保存前按旧金额统计] → 这是「不重算」的直接后果，specs 已写明；再次保存即一致。
- [已签约报价再次保存导致金额变化] → 走既有的签约后改金额审批，本 change 不改该路径；走查时确认一次（tasks 3.1）。
- [D3 的定价与工艺单不一致仍在] → 只在 SKU 目录加载失败时出现，保留现状而不是让这类行降价；报告里列为已知限制。
- [服务端不校验 `fabric`：旧版本的浏览器页面在上线后仍会按旧写法提交] → 刷新页面即取到新代码；不在服务端加校验（Non-Goals）。
- [`quote-mapping.ts` 改为调用共享函数时引入差异] → 语义与 `||` 相同；`quote-mapping.test.ts` 不改且全过作为门禁。

## Migration Plan

- 无数据迁移、无环境变量、无开关。合并即生效。
- 回滚：revert 该 PR。期间按新口径保存的报价带 `orderPricingRev: 2`，旧代码忽略该字段；这些报价的金额保持保存时的值。
- 上线前告知销售两条：Roller 带罩（行上或表底部）每行加 25 / 50；实木百叶窗自动计价，Part B 不再手填，打开旧报价看到提醒时先清 Part B。

## 验证方式

- `npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts`：全过。
- `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts`：158 条一致、DEFERRED 0；`git diff --stat origin/main -- config/pricelist/ src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` 为空。
- `npx tsx src/lib/blinds/__tests__/valance-options.test.ts`、`quote-fees.test.ts`、`cost-rates.test.ts`、`src/lib/sunny-process/__tests__/quote-mapping.test.ts`：通过数与开工前基线相同。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`npm test`：退出 0（`npm test` 中依赖数据库的项逐个与 origin/main 对照）。
- `openspec validate quote-order-form-pricing-parity --strict`：通过。
- `git diff --stat origin/main -- prisma/ vercel.json` 为空。
- 页面走查（隔离库 + `next start` + Playwright，截图进 `docs/acceptance/quote-1a/`）：见 tasks 3.1。

## Open Questions

- 生产里有多少张「材质 Wooden + 有百叶窗行 + Part B 有自定义行」的已存报价，本 change 看不到。不影响实现与规格；数量由报告里的只读查询在上线前后给出。
