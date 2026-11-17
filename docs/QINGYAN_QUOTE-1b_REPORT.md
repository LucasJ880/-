# QUOTE-1b 报告 — 导入报价工具导出的文件（`.sunny-quote.json`）

change：`openspec/changes/archive/2026-11-17-quote-import-studio-file/`（PR #520，2026-11-17 合并；已归档）。规格增量：新能力 `sales/quote-file-import`（16 条要求）、`sales/price-list` 新增 3 条；design D1–D13（D2 有「核对结果」）；tasks 8 / 8。
任务书：`docs/QINGYAN_QUOTE-1_QUOTE_FILE_IMPORT_TASKBRIEF.md`（What · QUOTE-1b）。拍板（TASKFLOW Phase Q，Lucas 2026-11-15）：Door Screen Sheer 继续套纱帘的企业折扣，导入后以青砚金额为准、差额只列提醒；详细订单的褶皱率仍只有 180 / 230，文件里不是这两档的行由销售在核对窗里选一档，选之前不能填入表单。
零 schema：新数据只落 `formDataJson`（行上的 `pricingFabric` / `lineDiscountPct` / `drapeLineDiscountPct` / `sheerLineDiscountPct`、`importSource`）与 AuditLog（`quote_imported`）。不新增接口、路由、权限键；无出站、无 LLM、无新 cron / 队列；导入全程不上传文件。

**尚未用界面导出的真实文件验证。** 多方案与带照片的两份文件是在 Node 里执行工具自己的方案组装与校验代码生成的，不是从工具界面点「导出」得到的。见 §8。

## 1. 做了什么

| 场景 | 现在 |
|---|---|
| 入口 | 报价工作台「详细订单」右上角「导入报价文件」，接受 `.json`。文件只在浏览器里读（先判大小，超过 35 MB 不读） |
| 校验 | 只接受 `format: "sunny-quote-studio"`、`version: 1`；产品行 ≤ 500、附加项目 ≤ 200；产品属于青砚的 11 个品类。不通过给一条中文原因，不进核对窗 |
| 多方案 | 文件有多套方案时先选一套（清单按方案编号排序，标出导出时的当前方案）；每次只填一套 |
| 行映射 | 数量 N 拆 N 行（房间名第 2 行起加序号）；宽高取整到 1/16"；Shades 行带 SKU 与文件的面料档（定价面料）；Roller 拆成基础面料 + 行上 Valance；Shutters 按材质（两种混用阻断）；Drapery / Sheer / Door Screen Sheer 各一条 Drapes 行 |
| 褶皱率 | 1.8 → 180、2.3 → 230；其它值（含未填、工具默认 2.0）逐行让销售选，核对窗并排显示两档各自的青砚金额；没选完不能填入 |
| 折扣与成交价 | 行折扣低于企业默认（更贵）→ 保留到行上；高于企业默认或成交价更低 → 差额进特别让利；文件比青砚贵 → 只列提醒；Allusion 的成交价填手填成交单价 |
| 附加项目与费用 | ≥ 0 的进 Part B（与目录同名用预设项，否则自定义行）；< 0 的进特别让利；Downtown 用预设项；含安装 → 默认，运费差进让利或「Delivery surcharge」；不含安装 → 自提，送货进「Delivery」；税率照文件 |
| 价表比对 | 只比本次用到的品类：宽高档位、MSRP、最低价、安装费标准。不一致时不显示文件金额与差额，仍可导入 |
| 核对窗 | 逐行：文件金额 / 青砚金额 / 差额 / 处理方式；底部两边合计与让利明细；阻断 / 提醒两级清单；无阻断且褶皱率选完才能「填入表单」 |
| 填入表单 | 替换三张表、Part B、备注、安装方式、税率、特别让利，带入客户四项；电话或邮箱在已加载的客户里恰好对上一位才自动选中 |
| 留痕 | `formDataJson.importSource`（工具报价号、报价 id、版本、方案、导出时间、文件价表版本、文件合计、导入时间）；保存时写一条审计 `quote_imported`，同一次导入只写一次 |
| 不导入的 | 窗户照片、试装图、面料资料：读到即丢，只提示「有 N 张窗户照片未导入」 |

金额的来源：核对窗里的「青砚金额」与保存后服务端算的金额出自同一组函数（行构造 → 企业默认折扣 → 引擎）。「文件金额」是按文件自己的参数用青砚引擎重算的——**文件里没有任何合计字段**。

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/sales/quote-import/types.ts`（新） | 文件结构的最小类型、上限常量、提示类型 |
| `src/lib/sales/quote-import/validate.ts`（新） | `parseQuoteFile(text, byteLength)`：先判大小再解析；丢弃 `__proto__` / `constructor` / `prototype`；只拷认识的键；照片只计数；多方案清单 |
| `src/lib/sales/quote-import/map.ts`（新） | `mapQuoteToForm`、`applyFullnessChoices`、`pendingFullnessRows`、`matchCustomer`、`buildImportSource`、`buildFormFill` |
| `src/lib/sales/quote-import/compare.ts`（新） | `comparePricelist`、`compareWithQingyan`（逐行对照、两边合计、特别让利） |
| `src/lib/sales/quote-import/audit.ts`（先前已提交） | 留痕 → 审计内容 |
| `src/app/(main)/sales/quote-sheet/import-review-dialog.tsx`（新） | 核对窗；只调上面的纯函数，不发请求 |
| `quote-sheet/page.tsx` | 入口按钮、填入表单（经 `applyFormState`）、导入后的提示条 |
| `quote-sheet/{types.ts,order-items.ts,pricing-helpers.ts,order-shades.tsx,order-drapes.tsx,sku-select.tsx,quote-draft.ts}`、`src/lib/blinds/order-form-pricing.ts`（tasks 2.1，先前已提交） | 行上定价面料、行级折扣、SKU「目录外」、`importSource` 类型 |
| `src/app/api/sales/quotes/route.ts`、`src/lib/sales/quote-update.ts`（先前已提交） | 各加一条审计 `quote_imported` |
| `src/lib/sales/quote-import/__tests__/{validate,map,compare}.test.ts`、`helpers.ts`、`fixtures/*.json`（新） | 测试与三份夹具 |
| `scripts/test-all.sh`、`scripts/test-ci-unit.sh` | 注册三个新测试 |
| `scripts/quote-1b-local-acceptance-seed.ts`（新） | 走查用的本机种子（只允许隔离库） |
| `docs/acceptance/quote-1b/` | 走查截图 24 张 + `walkthrough.txt` |

没有动：`src/lib/blinds/pricing-engine.ts`、`discount-settings.ts`、`config/pricelist/**`、`prisma/`、`vercel.json`、`src/lib/navigation/**`、`src/lib/authorization/**`；`src/app/api/` 下没有新增路由文件。

## 3. 文件结构核对结果（tasks 1.1）

材料：Lucas 2026-11-16 提供的 `quote-1b-materials.zip`（工具的定价核心 `quote-core.cjs`、`seed.json`、附录 A 的脚本、16 行样例、两份 toolcode 文件），解压到仓库外的空目录只读使用。各文件的 SHA-256 与逐项对照表在 design D2「核对结果」。

- 工具 `index.html` 的 SHA-256 `f29513c0…cdf4a69` **取自材料包 README**；`index.html` 不在材料包里，没有实算。`quote-core.cjs`、`seed.json` 的哈希是实算的。
- 样例重跑：在空目录执行 `node <材料目录>/gen-sample-16.cjs`，输出 `8224.5`；生成的文件与包内 `sample-16.sunny-quote.json` 除 `exportedAt` 外逐字段相同。
- 用同一份 `quote-core.cjs` 对两份 toolcode 文件执行 `C.validateQuote` + `C.totals`：单方案 8224.50；多方案顶层（B，15 行）7965.46，`plans[0]`（A，16 行）8224.50。青砚的重算与这三个数一致（`compare.test.ts` CMP-90 – 92）。

与原设计的出入：

| 项 | 实际 |
|---|---|
| 税率 | `quote.pricing.tax` |
| 文件价表版本 | `quote.pricing.version`（样例 `2026.10-local.1`） |
| 文件合计 | 没有这个字段——留痕里的文件合计取重算值，价表不一致时为空 |
| 多方案 | 顶层 `quote` 是导出时的当前方案（不一定是 A，样例是 B）；其余在 `quote.plans[]`；每套方案自带行、附加项目、备注、安装 / 送货 / Downtown；客户、报价号、价表整份共用 |
| 照片 | 出现在两处：当前方案行上的 `windowPhotos` 与 `planWindows[*].windowPhotos`（同一批）；按窗位去重计数，两处都不拷贝 |
| 试装图 | 行上 `windowTrial = { product, sku, colour, image }`（来自工具的校验代码）；材料里没有带它的文件 |
| Roller 面料档 | 工具只有 `(Open Roll)` 与 `w Cassette`，没有 `w Fascia`（青砚多认一种，无害） |
| Door Screen Sheer | 文件里没有它的两档价（写死在工具代码里），只能核对计价方式标记 |

规格增量因此改了五处（已在实施中告知）：多方案的展开方式；数量 / 尺寸非法的行与拆行超过 500 行阻断；价表比对加最低价与安装费标准；留痕里的文件合计是重算值；客户匹配不认不足 7 位的电话与空值。设计上另改一处：文件金额重算时，行上没有折扣的行用文件自己的默认折扣（原写企业默认折扣）。

没有覆盖到的字段（`windowTrial`、`materials`、`materialSelection`、Excel 录入的行、旧版本报价）一律按「可能出现、形状未知」处理：校验时容忍、不留存，各有一条测试（`validate.test.ts` VAL-80 – 88）。

## 4. 怎么验

第 0 步：合入 main `7a0255d9`（没有冲突；`scripts/test-all.sh`、`scripts/test-ci-unit.sh`、TASKFLOW 两边的内容都在），动代码之前重跑基线，与分支上记录的数字一致。

| 命令 | 分支上的记录 | 第 0 步实测 |
|---|---|---|
| `npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts` | 原有 72 条不变 + 2.1 新增 | `结果：100 通过，0 失败`；把 main 版的该测试文件单独跑在分支代码上：`结果：72 通过，0 失败` |
| `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` | 158 条 | `黄金对照：MUST_MATCH 158 条（断言 787，失败 0）；DEFERRED 0 条` |
| `npx tsx src/lib/sunny-process/__tests__/quote-mapping.test.ts` | 55 | `结果：55 通过，0 失败` |
| `npx tsx src/lib/blinds/__tests__/valance-options.test.ts` | 13 | `结果：13 通过，0 失败` |
| `npx tsx src/lib/sales/quote-import/__tests__/audit.test.ts` | 19 / 0 | `结果：19 通过，0 失败` |
| 隔离库 `src/lib/sales/__tests__/quote-import-audit-db.isolated.test.ts` | 12 / 0 | `导入留痕审计 DB 端到端：12 通过，0 失败` |

完成后：

| 命令 | 实际输出 |
|---|---|
| `npx tsx src/lib/sales/quote-import/__tests__/validate.test.ts` | `结果：73 通过，0 失败` |
| `npx tsx src/lib/sales/quote-import/__tests__/map.test.ts` | `结果：118 通过，0 失败` |
| `npx tsx src/lib/sales/quote-import/__tests__/compare.test.ts` | `结果：67 通过，0 失败` |
| `npx tsx src/lib/sales/quote-import/__tests__/audit.test.ts` | `结果：19 通过，0 失败` |
| `npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts` | `结果：100 通过，0 失败` |
| `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` | `黄金对照：MUST_MATCH 158 条（断言 787，失败 0）；DEFERRED 0 条` |
| 隔离库 `quote-import-audit-db.isolated.test.ts` | `导入留痕审计 DB 端到端：12 通过，0 失败` |
| 隔离库 `quote-settings-db.isolated.test.ts` | `价表折扣设置审批 DB 端到端：54 通过，0 失败` |
| 隔离库 `signed-quote-amount-db.isolated.test.ts` | `签约单改价审批 DB 端到端：23 通过，0 失败` |
| `npm run typecheck` | 退出 0 |
| `npm run lint:baseline` | `[eslint-baseline] PASS（无新增 error fingerprint / 无 count 上升）` |
| `npm run test:ci` | `CI unit subset PASS`，退出 0 |
| `bash scripts/check-test-registry.sh` | `OK 测试注册校验通过：已注册 665 个；历史欠账基线剩余 67 条（只减不增）` |
| `openspec validate quote-import-studio-file --strict` | `Change 'quote-import-studio-file' is valid` |
| `git diff --stat origin/main -- prisma/ vercel.json` | 空 |
| `git diff --stat origin/main -- src/lib/navigation/ src/lib/authorization/ src/lib/blinds/pricing-engine.ts src/lib/blinds/discount-settings.ts config/pricelist/` | 空 |
| `git diff --name-status origin/main -- src/app/api` | 只有 `M src/app/api/sales/quotes/route.ts`（没有新增路由文件） |
| `npm test`（无数据库） | `测试结果: 685/698 通过, 13 失败`；新注册的五个测试在其中通过。同一环境下 main `7a0255d9` 的工作树：`测试结果: 680/693 通过, 13 失败`。两边失败的 13 项名单逐项相同 |

`npm test` 的 13 项失败（本机无 `DATABASE_URL`、无 OAuth 配置、Chromium 布局测试；main 上同样失败）：Agent Trace 只读查询；Gmail Draft OAuth Compose Scope；Governance Hygiene Gate / Concurrency Gate；Phase3A-2 Ledger DB / Smoke Access；Phase3A-3 Approvals Smoke；Phase3A-4 Acceptance / Governance Smoke；Phase3A-5 Overview Acceptance / Settle DB；Quote Operations 客户报价 PDF 分页布局；T4 授标情报真实 Postgres 矩阵。

如实记录：全量第一次跑是 `684/698 通过, 14 失败`，比 main 多一项「TypeScript 类型检查」，报错在生成目录里——`.next/dev/types/validator.ts(8625,1): error TS1128`。那是走查结束时我停掉本地 `next dev` 留下的写了一半的生成文件，不是源码问题：删掉 `.next` 后 `npm run typecheck` 退出 0，全量重跑得到上表的 685 / 698。

全量与 main 的对照跑在合入 main `0839c4ae`（之后 4 个提交，只动文档与规格目录）之前；合入之后重跑了 `npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate` 与四个 quote-import 测试，全量没有再跑。

三个新测试覆盖的内容：

- `validate.test.ts`：合法样例（逐字段）；16 种非法文件各自的中文原因；原型污染键；多方案（三套、当前方案不是 A、其它方案超限）；两份 toolcode 夹具（照片数 3、结果里没有图片数据）；没覆盖到的字段各一条；不信任文件里的值；源码（先判大小、无网络调用）。
- `map.test.ts`：规格里映射相关的每个场景至少一例（拆行、取整、三张表、SKU 与定价面料、Roller 罩型、无绳、Shutters 材质与混用、褶皱率、行折扣与成交价、附加项目与费用、客户匹配、工艺参数留空、留痕）；两份 toolcode 夹具；源码断言（导入模块与核对窗没有网络调用、产出不含照片与面料资料键、核对窗读文件前先判大小）。
- `compare.test.ts`：16 行样例逐行与合计（文件 8224.50、青砚 8134.62、让利 29.38 / 236.94）；价表比对的 11 种不一致与 3 种仍一致；文件金额按文件自己的参数重算；让利的三个来源；阻断；手工构造同样表单数据的等价性；留痕里的文件合计。

没有跑：`npm run build`（`next build`）。类型检查通过，页面在 `next dev` 下实际跑过（见下节）。

## 5. 页面走查

环境：本机 Postgres 16 隔离库（全部迁移已应用）+ `next dev` + Playwright 的 Chromium；`scripts/quote-1b-local-acceptance-seed.ts` 建的虚构企业 Fixture Blinds Co.（负责人、销售各一个账号，三位虚构客户，企业运费 50、最低安装费 200、让利上限 25%）。截图与逐项输出在 `docs/acceptance/quote-1b/`（`walkthrough.txt` 是脚本从页面与库里读到的原始值）。

| # | 操作 | 页面 / 库里看到的 | 截图 |
|---|---|---|---|
| ① | 导入 16 行样例 | 核对窗「文件 16 行 → 表单 17 行（Shades 13 / Shutters 1 / Drapes 3）」；第 12 行未选时按钮显示「还有 1 行待选褶皱率」且不可用；选 180 后让利 29.38、文件合计 8,224.50、青砚合计 8,134.62。填入 → 选客户、填定金 → Save 201。库里：`grandTotal` 8134.62、`specialPromotion` 29.38、`formDataJson` 有 `importSource`（`quoteNumber` SQ-TEST、`fileGrandTotal` 8224.5、`rowCount` 16）、`quote_imported` 1 条。点 Save 之前页面的非读取请求数为 0 | 01a – 01d |
| ② | 第 12 行改选 230 | 该行「计入让利 207.56」，让利 236.94，青砚合计 8,134.62；保存后库里 `grandTotal` 8134.62、`specialPromotion` 236.94 | 02 |
| ③ | 企业运费设 75 再导 | 让利 54.38（行差 29.38 + 运费差 25.00），青砚合计仍 8,134.62 | 03 |
| ④ | 表单里第 3 行 Valance | Cassette 时 $271.88，改 None 后 $221.88 | 04 |
| ⑤ | 第 6 行 SKU | 下拉当前项「B01-38-BO100 · 目录外」 | 05 |
| ⑥ | 第 11 行改 `Wood` 再导 | 核对窗该行两边都是 1,172.22；填入后 Shutters 表材质 Wooden 选中、金额 $1,172.22 | 06 |
| ⑦ | 反例 | Zebra 改一格 MSRP：各行文件金额「—」、提示价表不同、仍可填入；Vinyl + Wood：阻断并提示拆成两份，不能填入；带 3 张照片：提示「有 3 张窗户照片未导入」，保存后 `formDataJson` 无 `data:image`，保存请求体里也没有；改 `format` / `version`、600 行、非 JSON：各自的中文原因，不进核对窗 | 07a – 07d |
| ⑧ | 让利审批（销售账号） | 见下 | 08a – 08e |
| ⑨ | toolcode 文件各导一次（**代替真实导出文件**） | 单方案：自动选中电话 / 邮箱相同的已有客户；保存 201，库里合计 8134.62、无图片数据。多方案：先出现方案选择（A 16 行、B 15 行并标「导出时的当前方案」）；选 B：文件合计 7,965.46、青砚 7,875.57；保存后留痕 `plan` 为 B、`fileGrandTotal` 7965.46、无图片数据 | 09a – 09c |

第 ⑧ 项与任务书的出入：任务书预期「只留第 16 行、成交价 100」让利占比约 33% 会触发审批。实际占比是 **12.4%**，不触发——页面上占比的分母是「产品税前价」= 产品 149.38 + 该行安装费 18 + 最低安装费补差 182 + 运费 50 = 399.38，不只是产品金额。所以做了两例，每例都用同一个销售账号分别「导入」与「手填同样一行 + 同额让利」：

| 案例 | 导入 | 手填 |
|---|---|---|
| 只留第 16 行、成交价 100（让利 49.38，占比 12.4%） | 可保存；库里合计 395.49、让利 49.38、审批状态 `not_required` | 完全相同 |
| 同一行数量 12（让利 592.50，占比 28.8% > 25%） | Save 与「发送 Quote」不可用，出现「提交管理员审核」；提交后「已保存报价草稿并通知 1 位管理员」，库里审批状态 `pending`、占比 0.2878、待审批动作 1 条 | 完全相同 |

两例里页面状态与落库结果逐项相同；唯一的差别是导入的那张多一条 `quote_imported` 审计。

走查没有做的：35 MB 级大文件的解析耗时（design「Risks」里提过要测）；手机宽度下的核对窗。

## 6. BREAKING

无。不点「导入报价文件」的人看不到任何变化；不导入的报价金额与行为不变。

## 7. 对任务书的调整

| 任务书 | 实际 | 原因 |
|---|---|---|
| 验收：核对窗第 1–14 行「一致」，保存后合计 8,224.51 | 第 14 行（Door Screen Sheer）是「提醒：青砚金额低于文件 79.54」；保存后合计 **8,134.62** | 判断点 1 拍板「先不变」：Door Screen Sheer 继续套企业折扣（147.73，文件 227.27）。两边合计差 89.88 = 79.54 加税 |
| 判断点 2 推荐 A：原样保留文件的褶皱率 | 由销售逐行选 180 / 230；第 12 行（2.0）选 180 时金额与文件相同，选 230 时差额 207.56 进让利、合计不变 | 判断点 2 拍板「先不变」：详细订单仍只有两档 |
| `DrapeOrderLine` 的褶皱率字段放宽为数字字符串 | 没有放宽 | 同上 |
| 让利审批：只留第 16 行、成交价 100 ≈ 33% | 12.4%，不触发；另加数量 12 的一例走到审批 | 占比的分母含安装费与运费（见 §5） |
| 企业运费 75 时让利 54.38、合计不变 | 相同（54.38；合计 8,134.62） | — |

## 8. 已知限制

- **尚未用界面导出的真实文件验证。** 走查第 ⑨ 项用两份 toolcode 文件代替。界面上才会产生的字段（试装图 `windowTrial`、非空的 `materials` / `materialSelection`、Excel 录入的行）与旧版本保存的报价没有真实样本；代码对它们一律容忍、不留存，但「真实文件一定能导入」这一点没有证据。需要 Lucas 从工具界面导出 2–3 份（含一份多方案、一份带照片、一份带试装图或面料资料的）各导一次。
- 工具 `index.html` 的哈希没有实算（文件不在材料包里）。
- 客户匹配只在页面已加载的客户里做（最多 200 位）；列表之外的老客户匹配不到，需要手选。电话不足 7 位数字不参与匹配。
- 行级折扣没有服务端上限（既有行为）；导入只会写「让价格更高」的行级折扣。百叶窗行没有行级折扣字段，文件里百叶窗行的低折扣不保留（会提醒）。
- 不查重：同一份文件可以导入多次，每次各留一条审计。
- 尺寸不在 1/16" 格上的行取整后，若跨过价表档位，青砚金额可能与文件不同（核对窗会同时给出取整提醒与金额差）。
- 附加项目按名称匹配目录；改过名的进自定义行，金额不变，但不套企业价。数量不是整数的附加项目按合计填成一项。
- 「填入表单」会替换详细订单里现有的三张表、Part B、备注、安装方式、税率与特别让利（核对窗底部有说明），不是追加。
- 回滚（revert 本 PR）之后：已保存的报价保留 `importSource`、行级折扣与定价面料字段，旧代码忽略它们——带行级折扣或目录外 SKU 的行在旧代码下再次保存会回到企业默认折扣与按 SKU 后缀推断的面料档，**金额可能变化**。
- 核对窗没有在手机宽度下看过；35 MB 级文件的解析耗时没有测。

## 9. 上线前事项

- **核对生产的企业运费。** 代码缺省 75，工具默认 50。如果生产是 75，每份含安装的导入都会多出 25 的让利（核对窗的让利明细单列「运费差」）。建议先把企业运费与工具对齐。
- 核对生产的最低安装费、各品类折扣、让利上限（任务书「不确定处」）。核对窗读的是当时的企业设置，这些数值不影响代码。
- 拿到界面导出的真实文件后各导一次（§8 第一条）。
- 告知销售：导入后 Door Screen Sheer 行以青砚的低价为准；褶皱率不是 1.8 / 2.3 的行要在核对窗里选档。

## 10. 交接（2026-11-17）

状态：实现 PR #520 已合并，change 已归档（`openspec/changes/archive/2026-11-17-quote-import-studio-file/`）；主规格 `sales/quote-file-import`（16 条要求、45 个场景）与 `sales/price-list`（+3 条，共 32 条）已生效。TASKFLOW QUOTE-1b 为 `[x]`。没有进行中的 change，没有开着的 PR。

接手的人按 `CLAUDE.md` 的顺序读完之后，这件事还剩下这些：

| 事项 | 谁 | 说明 |
|---|---|---|
| 用界面导出的真实文件各导一次 | Lucas 提供文件；谁接手谁导 | **至今没有验证过。** 需要 2–3 份：一份多方案、一份带照片、一份带试装图或面料资料（`windowTrial` / `materials`）。导入时若被拒绝或某行被阻断，把文件结构与 design D2「核对结果」对一遍——那张表是照两份 toolcode 文件写的，界面才会产生的字段形状未知。要改校验就另起 change，样本脱敏后加进 `src/lib/sales/quote-import/__tests__/fixtures/` |
| 核对生产的企业运费 | Lucas / Evan | 代码缺省 75，工具默认 50。若生产是 75，每份含安装的导入会多 25 的让利（核对窗的让利明细里单列「运费差」）。在驾驶舱「报价附加价格」里改，不用改代码 |
| 核对生产的最低安装费、各品类折扣、让利上限 | Lucas / Evan | 核对窗读的是当时的企业设置；数值不影响代码 |
| 告知销售 | Lucas | ① Door Screen Sheer 行导入后以青砚的低价为准（核对窗会提醒差额）；② 褶皱率不是 1.8 / 2.3 的行要在核对窗里逐行选 180 或 230，选完才能填入；③「填入表单」是替换不是追加 |
| 没有测过的 | 谁接手谁测 | 35 MB 级文件在浏览器里的解析耗时；手机宽度下的核对窗；`npm run build` 下的页面（CI 的构建通过，没有在生产构建里点过） |

本机复现走查：起一个本机 Postgres，`npx prisma migrate deploy`，然后按 `scripts/quote-1b-local-acceptance-seed.ts` 文件头的说明建夹具（只允许隔离库），`next dev` 起服务后在「报价 → 详细订单」点「导入报价文件」，选 `src/lib/sales/quote-import/__tests__/fixtures/` 下的文件。走查脚本本身没有入库，逐项读到的值在 `docs/acceptance/quote-1b/walkthrough.txt`。

实施中发现、不属于本 change、没有处理的：

- 粗报价工具页（`/sunny-quote.html`）在生产构建下会请求三个不存在的 CSV（`零售用.csv`、`FABRIC.csv`、`ADDONS.csv`）并一直挂着（做 `site-csp-baseline` 时看到，与内容安全策略无关，原因没有查）。
- `src/app/api/product-content/upload/route.ts` 不限制上传的文件类型（`site-csp-baseline` design「发现」第 2 点）；文件代理的沙箱已挡住脚本执行，上传侧的类型限制还没补。
- 行级折扣在服务端没有上限（任务书附录 B 把它放在 QUOTE-2）。

后续队列（任务书附录 B，都还没有任务书）：QUOTE-2 原生快速报价、QUOTE-3 系列折扣、QUOTE-4 客户报价输出、QUOTE-5 多方案、QUOTE-6 窗户照片与试装。
