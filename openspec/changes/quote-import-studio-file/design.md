# Design

## Context

动机见 proposal.md。已核实的现状（2026-11-15，main @ `3ad3fb8`，QUOTE-1a 已合并）：

**青砚侧**
- 表单状态由 `page.tsx` 的 `applyFormState(d: QuoteDraftV1 | QuoteFormState)` 统一灌入（恢复草稿与编辑已存报价共用）；导入可以产出同一形状的数据交给它。
- 保存时的行构造是纯函数 `quote-sheet/order-items.ts` `buildOrderFormItems`；定价面料只经 `src/lib/blinds/order-form-pricing.ts` 取；预览在 `pricing-helpers.ts`。服务端按 `applyOrgDiscountDefaults` → `calculateQuoteTotal` 重算，行上已有 `discountOverridePct` 时不套企业默认（`discount-settings.ts`）。引擎里行级覆盖优先于无绳折扣（`pricing-engine.ts`）。
- `ShadeOrderLine` 没有折扣与定价面料字段；`DrapeOrderLine` 的褶皱率是 `"180" | "230"`，表单是两个切换按钮（`order-drapes.tsx:281 / 348`）。
- Part B 行是 `{ skuItem, customName?, qty, price, total }`，`skuItem` 为目录键或 `__custom`；目录在 `pricing-addons.ts`（`displayName` / `printLabel`，Downtown 预设键 `downtown_fee`）；`partBRowsToAddonInputs` 把行变成提交项，单价取行上的值。
- 特别让利是页面上的字符串状态 `specialPromotion`；占比 = 让利 ÷（产品小计 + 安装运费补差），三档由 `decideDiscountTier` 判。运费、最低安装费、各产品折扣、无绳策略来自页面已加载的 `/api/sales/quote-settings/discounts`。
- 客户下拉用 `/api/sales/customers?picker=1&pageSize=200` 一次取最多 200 位，含 `phone`、`email`、`address`。
- `SkuSelect` 的选项只来自目录；当前值不在目录里时浏览器把它显示成第一项「— SKU —」。
- 新建（`quotes/route.ts`）与修改（`quote-update.ts`）都原样保存 `formDataJson`，并用 `logAudit` 写 `quote_promotion_approved` 一类审计。

**工具侧（只有任务书的描述）**
- 工具源码不在仓库里（`scripts/pricelist/README.md`：上传包不进仓库）。本设计对文件结构的认识全部来自任务书附录 A 与「映射」表：

  | 位置 | 任务书给出的内容 |
  |---|---|
  | 顶层 | `format: "sunny-quote-studio"`、`version: 1`、`exportedAt`、`quote` |
  | `quote` | `id`、`number`、`customer`、`phone`、`email`、`address`、`items[]`、`addons[]`、`pricing`、`install`、`delivery`、`downtown`、`deliveryAmount`、`downtownAmount` |
  | `items[]` | `id`、`product`、`fabric`、`w`、`h`、`qty`、`room`、`sku`、`cordless`、`offer`、`discountOverridePct`、`fullness`、`note` |
  | `addons[]` | `id`、`name`、`qty`、`price`、`unit`、`note` |
  | 只知道存在、不知道字段名 | 税率、备注、多方案（`plans[]`、`planWindows`）、照片（`windowPhotos`、`windowTrial`）、`materials`、`materialSelection`、文件价表版本、文件合计 |

- 工具的计价规则仓库里有旁证：`config/pricelist/2026-10-28-lucas-quote.json`（费用、褶皱率默认 2、无绳）与 158 条黄金用例（工具 `price()` 的输出，含逐行取整）。
- 16 行样例在青砚引擎上的结果（本机实跑，缺省企业折扣、运费 50、税率 13%）：

  ```
  row12 Drapery 100x108 fullness 1.8: 831.7
  row12 Drapery 100x108 fullness 2: 831.7
  row12 Drapery 100x108 fullness 2.3: 1039.26
  12 选 180 errors 0 merch 6162.16 addons 485 install 531 delivery 50 promo 29.38 preTax 7198.78 grand 8134.62
    rows: 192.5 192.5 513.19 271.88 161 512.61 210.51 318.35 330.11 256.36 649.35 701.29 831.7 488.98 147.73 234.72 149.38
  12 选 230 errors 0 merch 6369.71 addons 485 install 531 delivery 50 promo 236.94 preTax 7198.77 grand 8134.62
  ```

  与任务书「验收」的出入来自 2026-11-15 的两项拍板：Door Screen Sheer 仍套企业折扣（第 14 行青砚 147.73，文件 227.27），所以青砚合计是 8134.62 而不是 8224.51；褶皱率由销售选档（第 12 行的 2.0 与 1.8 落在同一个价表档，选 180 时金额一致）。

## Goals / Non-Goals

**Goals:**
- 校验、映射、金额对照都是不碰界面与网络的纯函数，核对窗只负责展示与收集销售的选择。
- 核对窗里的青砚金额与保存后服务端算出的金额出自同一组函数。
- 导入产出的表单数据与手工录入同形，保存、审批、工艺单生成一行不改。

**Non-Goals（不动的东西）:**
- `src/lib/blinds/pricing-engine.ts`、`pricing-data.ts`、`discount-settings.ts`、`sku-catalog.ts`、`pricing-addons.ts`：引擎、价表、企业折扣套用、SKU 推档、附加项目目录不改。
- `config/pricelist/**`、`pricelist-2026-10-golden.test.ts`：不改。
- `src/lib/sales/discount-tier.ts` 与让利审批链、签约后改金额的审批：不改。
- `src/lib/sunny-process/**`：工艺单映射不改（导入的行缺工艺参数，由既有的待核对清单处理）。
- `quotes/route.ts` 与 `quote-update.ts` 的计价与保存逻辑：只各加一条审计，不改请求体契约。
- `part-a.tsx`、`part-b.tsx`、`part-c.tsx`、`rough-quote-panel.tsx`、`public/sunny-quote.html`、`customer-combobox.tsx`。
- `prisma/schema.prisma`、`vercel.json`、`src/lib/navigation/**`、`src/lib/authorization/**`、`src/lib/muse-bridge/**`、`.claude/launch.json`、`openspec/specs/**`。
- 详细订单的褶皱率两档、Door Screen Sheer 的折扣口径。

## Decisions

### D1 五个纯函数模块 + 一个核对窗组件
- 做法：`src/lib/sales/quote-import/` 下
  - `types.ts`：文件结构的最小类型、提示（`{ level: "block" | "warn", code, rowIndex?, messageZh }`）、对照结果。
  - `validate.ts`：`parseQuoteFile(text, byteLength)` → 通过时返回净化后的报价主体与方案清单，不通过时返回中文原因。
  - `map.ts`：`mapQuoteToForm(plan, ctx)` → 表单数据片段（三张表的行、Part B 行、安装方式、税率、客户四项、备注、`importSource`）+ 提示 + 待选褶皱率的行 + 各项让利来源；`matchCustomer(file, customers)`。
  - `compare.ts`：`compareWithQingyan(plan, mapped, settings, fullnessChoices)` → 逐行文件金额 / 青砚金额 / 差额 / 处理方式、两边合计、特别让利、价表是否一致。
  - `audit.ts`：`readImportSource(formDataJson)` 与 `importAuditPayload(next, prev)`（D10；apply 中补进本清单——服务端两条保存路径共用，单独成模块才能做纯测试）。
  - 核对窗 `quote-sheet/import-review-dialog.tsx` 只调这些函数并渲染。
- `map.ts` 与 `compare.ts` 引用页面目录的表单类型与 `buildOrderFormItems` / 预览函数（`src/lib` 测试引用页面目录代码已有先例）。
- 否决：把映射写在核对窗组件里——测不到，且 QUOTE-1a 刚把同类逻辑从组件里搬出来。否决：服务端新增解析接口——要上传原文件（可带照片，最大 35 MB），违反任务书「不上传」。

### D2 文件结构先按任务书假设，实施第一步用真实文件核对
- 做法：`types.ts` 按 Context 表里的结构写；税率、备注、多方案、照片等字段名在 tasks 1.1 拿到工具包（`index.html`）与 2–3 份真实导出文件（含一份多方案、一份带照片）后确定，核对结果追加在本节。字段名的出入只改 `types.ts` / `validate.ts`；若出入改变了对外行为（例如多方案的展开方式、文件合计的口径），先回改 specs 增量再写代码。
- 样例夹具 `__tests__/fixtures/sample-16.sunny-quote.json` 用任务书附录 A 的脚本从真实工具包生成（不含照片），连同生成命令与工具包哈希一起入库。
- 否决：现在就猜字段名把校验写死——猜错会把合法文件拒掉。否决：等拿到文件再出四件套——Lucas 2026-11-15 选「先按任务书写」。

### D3 文件金额由青砚引擎按文件的参数重算，只在价表一致时显示
- 做法：文件行金额 = 用文件里该行的面料档、尺寸、无绳、褶皱率、折扣（文件行折扣，否则该产品的企业默认折扣；无绳行否则无绳折扣）与成交价，经 `priceFor` 算出单价，逐行取到分，再乘数量。Door Screen Sheer 按工具的口径不打折（文件行自带折扣时照用）。安装、送货、Downtown、税按文件值与工具的规则合计。
- 只有 D4 的价表比对一致时才算并显示文件金额；不一致时文件金额与差额一律不显示。
- 样例测试断言文件合计为 8224.50（任务书里工具自己算的数），以此钉住这套重算与工具一致。
- 否决：直接读文件里的合计——任务书只说有「文件合计」，没有逐行金额，无法逐行对照。否决：在青砚里实现一份工具的 `price()`——两套计价会漂移；价表一致时青砚引擎与工具的结果已由 158 条黄金用例钉住。

### D4 价表比对只比本次用到的品类
- 做法：对选定方案里出现的每个产品，比文件 `pricing` 里该产品的宽高档位与用到的面料档 MSRP 表，逐格与 `pricing-data.ts` 的 `BRACKETS` / `MSRP_*`（Roller 经 `ROLLER_FABRICS` 的引用表）比较，浮点差 ≤ 1e-6 视为相同。Door Screen Sheer 没有矩阵，比两档价。文件没带 `pricing` 视为不一致。
- 否决：整份价表全比——文件里一个没用到的品类被改过，就会让一份其实算得对的报价失去文件金额。

### D5 青砚金额 = 行构造 → 企业默认折扣 → 引擎，输入取页面已加载的企业设置
- 做法：`compareWithQingyan` 用 `buildOrderFormItems`（映射出的表单行）→ `applyOrgDiscountDefaults`（页面已有的各产品折扣）→ `calculateQuoteTotal`（页面已有的无绳策略、电机单价、最低安装费、运费、Part B 行经 `partBRowsToAddonInputs`、特别让利、文件税率）。这正是 `quotes/route.ts` 的调用顺序；不新增接口。
- 行差绝对值 ≤ 0.01 × 数量为一致。逐行的处理方式：一致 / 保留行折扣 / 计入让利（青砚 > 文件）/ 提醒（青砚 < 文件）/ 待选褶皱率 / 阻断。
- 否决：调服务端预览接口算青砚金额——多一次往返且要把映射结果先传上去；同一组纯函数在浏览器里就能跑。

### D6 褶皱率由销售逐行选档
- 做法：文件褶皱率 1.8 → `"180"`、2.3 → `"230"`（容差 1e-9）；其它值（含缺失，按工具默认 2.0）进入「待选」。核对窗对每个待选行给两个选项，各自显示青砚金额与相对文件金额的差；没有预选。`fullnessChoices` 是 `行号 → "180" | "230"`，全部选完且无阻断才启用「填入表单」。选定的档写进表单行，差额按 D5 的规则落到让利或提醒。表单类型不改。
- 否决：就近取档或统一 180——工厂实际做哪一档由规则而不是销售决定（Lucas 2026-11-15 否决）。否决：放宽表单为任意数字（任务书原方案 A）——判断点 2 拍板「先不变」。

### D7 行级折扣与定价面料接到 QUOTE-1a 的取键与行构造
- 做法：`ShadeOrderLine` 加可选 `pricingFabric?: string`、`lineDiscountPct?: number`；`DrapeOrderLine` 加可选 `drapeLineDiscountPct?`、`sheerLineDiscountPct?`。
  - `order-form-pricing.ts` 的 `shadeLinePricingFabric` 增加可选的行上定价面料：它是 `getAvailableFabrics(product)` 里的键时作为取键起点，否则仍用 `skuToPricingFabric`；Roller 之后照旧拆基础面料 + 生效罩型。
  - `buildOrderFormItems` 在行级折扣是 0–1 的有限数时带上 `discountOverridePct`；预览函数同样优先用行级折扣（无绳行也是——与引擎「行级覆盖优先」一致）。
  - `order-shades.tsx` 的产品 / SKU 变更处理清掉 `pricingFabric`；行上显示「15% off · 导入」并带清除按钮；`order-drapes.tsx` 同样显示与清除。不提供录入框。
  - 映射只在「文件行折扣 < 企业默认」时写行级折扣；其余情况不写。
- 否决：把文件面料档直接写进 `sku`——SKU 是给工艺单与面料库存用的真实编号，写成 `Blackout` 会丢掉 `SSB01`。否决：把所有文件折扣都带到行上——比企业默认更低的价应当走让利审批，不能藏在行折扣里。

### D8 特别让利的来源与取整
- 做法：让利 = Σ max(0, 青砚行金额 − 文件行金额)（来自更高的文件折扣、更低的成交价、选 230 的褶皱率差）+ Σ |负数附加项目| + 运费差（含安装：max(0, 企业运费 − 文件运费)，不含送货时文件运费按 0）。合计取到分，写成字符串填入 `specialPromotion`。Allusion 行的成交价填该行的手填成交单价，不进让利。文件金额不可用（价表不一致）时行差为 0，只累加附加项目与运费两项，并提醒「行级差额未计入让利」。
- 否决：把文件比青砚贵的差额从让利里抵扣——会把 Door Screen Sheer 的 79.54 变成其它行的降价空间。

### D9 客户匹配只在已加载的客户里做
- 做法：`matchCustomer` 把电话去掉非数字后比较（北美号码去掉前导 1），邮箱去空白转小写比较；电话或邮箱任一命中即算命中，命中集合恰好一位才返回。范围是页面已加载的列表（最多 200 位）；列表之外的客户匹配不到，停在选择 / 新建。
- 否决：为匹配新增按电话查客户的接口——超出「不新增接口」；匹配不到的后果只是销售手选。

### D10 `importSource` 与审计
- 做法：`importSource = { tool: "sunny-quote-studio", fileVersion, quoteId, quoteNumber, plan, exportedAt, pricelistVersion, fileGrandTotal, importedAt, pricelistMatch, rowCount }`，随表单数据保存；`QuoteFormState` / `QuoteDraftV1` 加可选字段，`applyFormState` 原样保留。
  - 服务端在两条保存路径里解析 `formDataJson`：有 `importSource` 且（新建，或修改前的 `formDataJson` 没有 `importSource`，或其 `quoteId` + `exportedAt` + `importedAt` 与这次不同）时 `logAudit({ action: "quote_imported", targetType: "sales_quote", targetId, afterData })`，`afterData` 只含上面的留痕字段。解析失败或字段形状不对时不写、不报错。
  - 已实现（apply，先于 1.1）：留痕只取白名单字段、文本截到 200 字；缺 `quoteId` / `exportedAt` / `importedAt` 任一项时视为没有留痕（无法判断是否同一次导入）。修改路径在 `commitQuoteUpdate` 开头按报价 id + 企业读一次保存前的 `formDataJson`，只在新的表单数据带留痕时才读；签约后改金额走审批的报价在批准落库时写审计。
- 否决：每次保存都写——同一次导入会刷出多条。否决：由浏览器调审计接口——审计要在服务端与保存同一处写。

### D11 文件读取的安全边界
- 做法：`File.size` 先于读取判断上限；`JSON.parse` 带 reviver 丢弃 `__proto__` / `constructor` / `prototype` 键；只取认识的字段拷进新对象；字符串截断（房间名、SKU、名称 200 字，备注 2000 字）；数字必须有限；所有文案以文本渲染。照片等大字段不拷贝，只数个数。
- 否决：整份对象直接当表单数据用——未知键会进 `formDataJson`。

### D12 SKU 下拉的选项构造抽成纯函数
- 做法：`sku-select.tsx` 的选项列表由 `skuSelectOptions(product, value)` 给出：当前值非空且不在目录条目里时在最前面加一项 `{ value, label: "<value> · 目录外" }`。组件只渲染。
- 否决：把目录外的 SKU 临时塞进目录缓存——会污染其它行的下拉。

### D13 测试
- `src/lib/sales/quote-import/__tests__/validate.test.ts`、`map.test.ts`、`compare.test.ts`、`audit.test.ts`（纯逻辑，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）；`order-form-pricing-parity.test.ts` 加定价面料、行级折扣、SKU 选项三组；`src/lib/sales/__tests__/quote-import-audit-db.isolated.test.ts`（隔离库，经真实路由，注册进 `scripts/test-all.sh`）。
- 每个测试文件与它测的模块在同一个 task 里创建并注册。
- 否决：只做样例对照——映射表每一行都要有一例，样例覆盖不到负数附加项目、材质混用、运费差等。

## 与八条硬纪律的关系

1. **零 schema**：触碰并遵守。新数据只落 `formDataJson`（行上的可选字段、`importSource`）与 AuditLog（`quote_imported`）；不新增 model、字段、migration。
2. **出站动作先审批**：不涉及。导入不产生任何对外发送；文件不上传。导入后的发送报价仍走既有流程。
3. **禁止第三套队列**：不涉及。无 cron、队列、worker。
4. **脱敏**：不涉及 Muse 通道。审计 `quote_imported` 不含客户电话、邮箱、地址；不输出成本。
5. **不爬登录页**：不涉及。无外部请求。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。校验、映射、对照全部是查表与纯函数，零新增 LLM 调用；褶皱率落档由人选，不由规则或模型猜。
8. **测试注册**：触碰并遵守。四个新测试文件各自与被测模块同一个 task 注册；`bash scripts/check-test-registry.sh` 退出 0。

## Risks / Trade-offs

- [文件结构只来自任务书，真实文件可能不同] → tasks 1.1 先核对；出入影响对外行为时先改规格。在那之前不写依赖未知字段名的代码。
- [工具升级后导出 `version: 2`] → 校验直接拒绝并说明「文件版本 2 暂不支持」，不尝试兼容。
- [Door Screen Sheer 行导入后比工具报给客户的价低 35%] → 这是拍板的结果；核对窗逐行提醒并在底部显示两边合计差，销售看得见。
- [生产的企业运费若是 75 而工具默认 50，每份导入都会多 25 让利] → 核对窗的让利明细单列「运费差」；任务书已建议先把企业运费对齐，报告里再提一次。
- [服务端原样接受任何行级折扣] → 既有行为；导入只写「让价格更高」的行级折扣。上限留到替换旧版快速报价时处理（任务书附录 B）。
- [客户列表只加载 200 位，老客户可能匹配不到] → 不误配，只是需要手选；报告里记录。
- [35 MB 的文件在浏览器里解析会卡顿] → 只读一次、照片字段不拷贝；走查时用带照片的大文件测一次耗时。
- [附加项目按名称匹配，改过名的进自定义行] → 金额不受影响，只是不套企业价；核对窗提醒。

## Migration Plan

- 无数据迁移、无环境变量、无开关。合并即生效；不点「导入报价文件」的人看不到任何变化。
- 回滚：revert 该 PR。已导入并保存的报价保留 `importSource`、行级折扣与定价面料字段，旧代码忽略这些字段——带行级折扣或目录外 SKU 的行在旧代码下再次保存会回到企业默认折扣与 SKU 推断的面料档，金额可能变化；报告里写明。

## 验证方式

- `npx tsx src/lib/sales/quote-import/__tests__/validate.test.ts`、`map.test.ts`、`compare.test.ts`：全过；样例断言文件合计 8224.50、青砚合计 8134.62、让利 29.38（第 12 行选 180）与 236.94（选 230）。
- `npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts`：既有 72 条不变，新增三组全过。
- 隔离库：`quote-import-audit-db.isolated.test.ts`、`quote-settings-db.isolated.test.ts`、`signed-quote-amount-db.isolated.test.ts` 全过。
- `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts`：158 条一致。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate quote-import-studio-file --strict`；`git diff --stat origin/main -- prisma/ vercel.json` 为空。
- 页面走查（隔离库 + Playwright，截图进 `docs/acceptance/quote-1b/`）：见 tasks 4.1。

## Open Questions

- 生产里 Sunny 的企业运费、最低安装费、各品类折扣与让利上限的实际值（任务书「不确定处」）。不影响规格与实现——核对窗读的是当时的企业设置；数值由 Lucas / Evan 在上线前核对。
