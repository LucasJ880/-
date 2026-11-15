# Spec Delta

## Purpose

把 SUNNY SHUTTER 报价工具导出的报价文件导入青砚的详细订单：文件只提供「填了什么」，金额由青砚计算，文件比青砚便宜的部分变成特别让利并走现有审批，所有改动逐条列给销售核对。

## ADDED Requirements

### Requirement: 导入入口与流程
报价工作台的详细订单 SHALL 提供「导入报价文件」入口，只接受 `.json` 文件。流程 SHALL 为：选文件 → 校验 → 文件含多套方案时选一套 → 核对窗 → 填入表单 → 选择或新建客户 → 现有的保存。导入 SHALL NOT 新增页面路由、权限键或接口；能新建报价的人即可导入。填入表单后的保存、服务端重算与特别让利三档判定 SHALL 与手工录入同样内容时完全相同。

#### Scenario: 填入后与手填等价
- **WHEN** 运行 `npx tsx src/lib/sales/quote-import/__tests__/compare.test.ts`，把 16 行样例文件映射成表单数据后交给详细订单的行构造与服务端同一个计价函数
- **THEN** 逐行金额与合计等于手工构造同样表单数据算出的结果

#### Scenario: 不新增入口之外的东西
- **WHEN** 本 change 合并
- **THEN** `git diff --stat origin/main -- prisma/ vercel.json src/lib/navigation/ src/lib/authorization/` 为空，`src/app/api/` 下没有新增路由文件

### Requirement: 文件只在浏览器内读取
导入 SHALL 只在浏览器内读取文件。系统 SHALL NOT 把原文件上传到服务端，SHALL NOT 把文件里的窗户照片、试装图、面料色样与面料选择（`windowPhotos`、`windowTrial`、`materials`、`materialSelection`）写入表单数据、草稿或任何请求。文件含窗户照片时核对窗 SHALL 提示「有 N 张窗户照片未导入」。

#### Scenario: 带照片的文件
- **WHEN** 导入一份带 3 张窗户照片的文件并保存
- **THEN** 核对窗提示「有 3 张窗户照片未导入」；落库的 `formDataJson` 不含任何图片数据

#### Scenario: 导入代码不调上传
- **WHEN** 运行 `npx tsx src/lib/sales/quote-import/__tests__/map.test.ts` 的源码断言
- **THEN** 导入模块与核对窗的源码中没有任何网络请求调用；映射产出的表单数据不含 `windowPhotos`、`windowTrial`、`materials`、`materialSelection` 这些键

### Requirement: 文件校验与拒绝原因
系统 SHALL 只接受格式标识为 `sunny-quote-studio` 且 `version` 为 1 的文件，并 SHALL 拒绝：不是合法 JSON、大小超过 35 MB、产品行超过 500 行、附加项目超过 200 项、含青砚 11 个品类之外的产品、缺少报价主体。每种拒绝 SHALL 给出一条中文原因且不进入核对窗。文件中的 `__proto__`、`constructor`、`prototype` 键 SHALL NOT 被读入任何对象。

#### Scenario: 各类非法文件
- **WHEN** 运行 `npx tsx src/lib/sales/quote-import/__tests__/validate.test.ts`，依次校验：非 JSON 文本、`format` 不符、`version` 为 2、600 行、201 个附加项目、含未知产品、超过 35 MB
- **THEN** 每一种都返回不通过与各自的中文原因，没有一种返回可映射的结果

#### Scenario: 原型污染键
- **WHEN** 校验一份在报价主体与某一行里带 `__proto__` 键的文件
- **THEN** 校验结果中的对象不带该键，`Object.prototype` 未被改动

#### Scenario: 合法文件
- **WHEN** 校验 16 行样例文件
- **THEN** 通过，返回 16 行产品、2 个附加项目与方案清单

### Requirement: 多方案选择
文件含多套方案时，系统 SHALL 在核对窗之前让销售选择其中一套；一次导入 SHALL 只填入一套方案。只有一套方案时 SHALL 直接进入核对窗。

#### Scenario: 三套方案
- **WHEN** 校验一份含当前方案与另外 2 套方案的文件
- **THEN** 返回 3 套方案供选择，选定后只有该方案的行进入映射；`npx tsx src/lib/sales/quote-import/__tests__/validate.test.ts` 覆盖

### Requirement: 产品行映射
系统 SHALL 把选定方案的每一行映射为详细订单的表单行：数量 N 拆成 N 行，房间名相同、第 2 行起加序号；宽高换成整数加 1/16"，不在 1/16" 格上的四舍五入到最近一格并提醒；Zebra、Roller、SHANGRILA、Cordless Cellular、SkylightHoneycomb、Roman Shade、Fauxwood、Allusion 填 Shades 行；Shutters 填 Shutters 行且 Panel 数为 1；Drapery、Sheer（含 Door Screen Sheer）各填一条 Drapes 行。尺寸超出青砚价表范围的行 SHALL 阻断导入。

#### Scenario: 16 行样例
- **WHEN** 运行 `npx tsx src/lib/sales/quote-import/__tests__/map.test.ts` 映射 16 行样例
- **THEN** 得到 17 条表单行：Shades 13、Shutters 1、Drapes 3；第 1 行（数量 2）拆成两条，房间名第二条带序号

#### Scenario: 尺寸取整
- **WHEN** 一行宽 48.53"
- **THEN** 填入 48 又 8/16"，并有一条提醒写明原值与取整后的值

#### Scenario: 尺寸超出价表
- **WHEN** 一行 Zebra 宽 200"
- **THEN** 该行列为阻断，不能填入表单

### Requirement: Shades 行的 SKU、面料档与罩型
Shades 行的 SKU SHALL 取文件里的 SKU，文件未填时取面料档名称；面料档 SHALL 以文件为准写入该行的定价面料。Roller 的面料档 SHALL 拆成基础面料与罩型：`… w Cassette` 填行上 Valance = Cassette，`… w Fascia` 填 Fascia，`… (Open Roll)` 填 None。文件里的无绳标记 SHALL 只对 Zebra 与 Roller 填入 Cordless。SKU 不在青砚目录里时 SHALL 列一条提醒，不阻断。

#### Scenario: 无后缀的遮光 SKU
- **WHEN** 文件一行 Zebra、SKU `SSB01`、面料档 `Blackout`
- **THEN** 表单行 SKU 为 `SSB01`、定价面料为 `Blackout`，青砚金额按 Blackout 表计算；有一条「SKU 不在目录」的提醒

#### Scenario: Roller 带罩盒
- **WHEN** 文件一行 Roller、面料档 `Blackout w Cassette`、SKU `CABO-WHITE-BO`、55" × 72"
- **THEN** 表单行 Valance = Cassette，青砚金额 271.88；在表单里把 Valance 改为 None 后为 221.88

#### Scenario: 非 Zebra / Roller 的无绳标记
- **WHEN** 文件一行 SHANGRILA 带无绳标记
- **THEN** 表单行 Cordless 为关

### Requirement: Shutters 材质
文件里 Shutters 行的材质 `Vinyl` SHALL 映射为表单材质 Vinyl，`Wood` SHALL 映射为 Wooden。同一套方案里同时出现两种材质时 SHALL 阻断导入，并提示把文件拆成两份分别导入。

#### Scenario: 实木
- **WHEN** 文件一行 Shutters、材质 `Wood`、72" × 60"
- **THEN** 表单百叶窗材质为 Wooden，该行青砚金额 1172.22

#### Scenario: 材质混用
- **WHEN** 同一套方案里一行 `Vinyl`、一行 `Wood`
- **THEN** 列为阻断，提示拆成两份导入；`npx tsx src/lib/sales/quote-import/__tests__/map.test.ts` 覆盖

### Requirement: 褶皱率落档
Drapery 与 Sheer 行（Door Screen Sheer 除外）的褶皱率为 1.8 时 SHALL 填 180，为 2.3 时 SHALL 填 230。其它值（含文件未填、按工具默认 2.0 处理的行）SHALL 由销售在核对窗里逐行选择 180 或 230；核对窗 SHALL 对这类行并排显示文件金额与两档各自的青砚金额；还有行未选时 SHALL NOT 允许填入表单。系统 SHALL NOT 替销售选择档位。

#### Scenario: 工具默认 2.0 的布帘
- **WHEN** 样例第 12 行 Drapery `With liner (Black out)` 100" × 108"、褶皱率 2.0
- **THEN** 核对窗该行显示文件金额 831.70、选 180 的青砚金额 831.70、选 230 的青砚金额 1039.26，并要求选择；未选时「填入表单」不可用

#### Scenario: 已是两档之一
- **WHEN** 样例第 13 行 Sheer 褶皱率 2.3
- **THEN** 直接填 230，不要求选择，青砚金额 488.98

#### Scenario: 选 230 的差额进让利
- **WHEN** 第 12 行选 230
- **THEN** 该行处理方式为「计入让利 207.56」；`npx tsx src/lib/sales/quote-import/__tests__/compare.test.ts` 覆盖

### Requirement: 行级折扣与成交价的处理
文件行的折扣低于该产品的企业默认折扣时（价格更高），系统 SHALL 把它保留为该行的行级折扣并随行提交。文件行的折扣高于企业默认，或成交价低于青砚对该行算出的金额时，系统 SHALL NOT 把折扣或成交价带到行上，差额 SHALL 累加进特别让利；Allusion 行的成交价 SHALL 填入该行既有的手填成交单价。文件金额高于青砚金额的行 SHALL 只列提醒，SHALL NOT 调高青砚金额。

#### Scenario: 行折扣 15%
- **WHEN** 样例第 15 行 Zebra `Light Filtering` 40" × 50"、行折扣 15%（企业默认 45%）
- **THEN** 表单行带行级折扣 15%，青砚金额 234.72，处理方式为「保留行折扣 15%」

#### Scenario: 成交价低于青砚价
- **WHEN** 样例第 16 行 Roller `Blackout (Open Roll)` 40" × 50"、成交价 120
- **THEN** 表单行不带成交价，青砚金额 149.38，处理方式为「计入让利 29.38」

#### Scenario: 文件比青砚贵
- **WHEN** 样例第 14 行 Door Screen Sheer 30" × 48"（文件 227.27，青砚 147.73）
- **THEN** 处理方式为「提醒：青砚金额低于文件 79.54」，青砚金额仍为 147.73，特别让利不因此变化

### Requirement: 附加项目与费用映射
金额不小于 0 的附加项目 SHALL 填入 Part B：名称与青砚目录的销售名或对客名完全相同（不分大小写）时用该预设项，否则作为自定义行；单价一律取文件值。金额小于 0 的附加项目 SHALL 累加进特别让利。Downtown 服务费 SHALL 用 Part B 的 Downtown 预设项、单价取文件值。含安装时安装方式 SHALL 为默认，不含安装时为自提。含安装时文件运费低于企业运费的差额（不含送货时为企业运费全额）SHALL 累加进特别让利，高于时差额 SHALL 作为自定义行「Delivery surcharge」；不含安装但含送货时运费 SHALL 作为自定义行「Delivery」。税率 SHALL 取文件值。

#### Scenario: 样例的附加项目与费用
- **WHEN** 映射样例（Motor tube ×2 @150、Custom bracket ×1 @35、Downtown 150、含安装、送货 50，企业运费 50）
- **THEN** Part B 有 Motor tube ×2、Custom bracket ×1、Downtown Service Fee 150；安装方式为默认；运费不产生让利

#### Scenario: 企业运费更高
- **WHEN** 同一份文件，企业运费为 75
- **THEN** 特别让利多 25；`npx tsx src/lib/sales/quote-import/__tests__/map.test.ts` 覆盖

#### Scenario: 负数附加项目
- **WHEN** 文件有一项附加项目「优惠」金额 −100
- **THEN** 它不进 Part B，特别让利多 100

### Requirement: 特别让利累加
系统 SHALL 把成交价与折扣差额、负数附加项目、运费差额相加并取到分，填入详细订单既有的特别让利输入。填入之后的让利占比、三档判定与审批 SHALL 完全沿用现有逻辑，系统 SHALL NOT 为导入的让利设单独的规则或豁免。

#### Scenario: 样例的让利
- **WHEN** 样例第 12 行选 180、企业运费 50
- **THEN** 特别让利为 29.38，服务端合计 8134.62

#### Scenario: 选 230 时合计不变
- **WHEN** 样例第 12 行选 230
- **THEN** 特别让利为 236.94，服务端合计仍为 8134.62（误差 ≤ 0.01）；`npx tsx src/lib/sales/quote-import/__tests__/compare.test.ts` 覆盖

### Requirement: 价表一致性比对
系统 SHALL 把文件自带的价表与青砚现行价表比对，范围只限本次用到的品类；宽高档位与 MSRP 逐格相同才算一致。不一致时核对窗 SHALL NOT 显示文件金额与差额，只显示青砚金额，并提示「该文件的价表与公司现行价表不同」；此时仍 SHALL 允许继续导入。

#### Scenario: 改掉一格
- **WHEN** 把样例文件里 Zebra 的任一格 MSRP 改掉后做对照
- **THEN** 结果标记价表不一致，各行没有文件金额，有一条价表不同的提醒，无阻断；`npx tsx src/lib/sales/quote-import/__tests__/compare.test.ts` 覆盖

#### Scenario: 没用到的品类不同
- **WHEN** 文件价表里一个本次没用到的品类与青砚不同
- **THEN** 结果仍为一致

### Requirement: 核对窗
核对窗 SHALL 逐行并排显示文件金额、青砚金额、差额与处理方式（一致、保留行折扣、计入让利、提醒、待选褶皱率、阻断）；行差绝对值不超过 0.01 × 数量视为一致。底部 SHALL 并排显示两边的产品小计、附加项目、安装、送货、税前、税、合计与本次计入的特别让利。提示 SHALL 分为阻断与提醒两级；有阻断项或有行未选褶皱率时 SHALL NOT 允许填入表单。青砚金额 SHALL 出自保存时服务端使用的同一个计价函数与当前企业设置。

#### Scenario: 样例逐行
- **WHEN** 对照 16 行样例（第 12 行选 180）
- **THEN** 第 1–13 行为一致，第 14 行为提醒，第 15 行为保留行折扣 15%，第 16 行为计入让利 29.38，无阻断；`npx tsx src/lib/sales/quote-import/__tests__/compare.test.ts` 覆盖

#### Scenario: 两边合计
- **WHEN** 同一次对照
- **THEN** 文件合计 8224.50，青砚合计 8134.62，差额 89.88（即第 14 行的 79.54 加税）

#### Scenario: 有阻断时不能填入
- **WHEN** 文件含材质混用的 Shutters 行
- **THEN** 核对窗列出阻断原因，「填入表单」不可用

### Requirement: 客户匹配
填入表单时系统 SHALL 把文件里的客户名、电话、邮箱、地址带入客户四项，并在页面已加载的客户里按电话（只比数字）或邮箱查找；恰好一位客户命中时 SHALL 自动选中，零位或多位命中时 SHALL NOT 自动选中，停在选择或新建客户。系统 SHALL NOT 因导入自动新建客户。

#### Scenario: 唯一命中
- **WHEN** 文件电话为 `(416) 555-0100`，已加载客户里只有一位电话为 `416-555-0100`
- **THEN** 自动选中该客户

#### Scenario: 多位命中
- **WHEN** 两位客户的邮箱都与文件相同
- **THEN** 不自动选中，四项已带入；`npx tsx src/lib/sales/quote-import/__tests__/map.test.ts` 覆盖

### Requirement: 工艺参数不臆造
文件不记录的工艺参数（Mount、Lift、Bracket、褶型、Panels 等）SHALL 留空或保持表单默认值，系统 SHALL NOT 为它们推断取值；这些行在签字后仍由工艺单的待核对清单处理。

#### Scenario: 导入的 Shades 行
- **WHEN** 映射任一 Shades 行
- **THEN** 该行的 Mount、Lift、Bracket 为空；`npx tsx src/lib/sales/quote-import/__tests__/map.test.ts` 覆盖

### Requirement: 导入留痕与审计
填入表单时系统 SHALL 在表单数据里写入只读的 `formDataJson.importSource`，含工具报价号、报价 id、文件版本、所选方案、导出时间、文件价表版本、文件合计与导入时间，SHALL NOT 为此新增数据库字段。保存带留痕的报价时服务端 SHALL 写一条审计 `quote_imported`（新建与修改两条路径）；同一张报价的同一次导入 SHALL 只写一次。审计内容 SHALL NOT 含客户电话、邮箱与地址。系统 SHALL NOT 拦截重复导入。

#### Scenario: 新建时写审计
- **WHEN** 运行 `npx tsx src/lib/sales/__tests__/quote-import-audit-db.isolated.test.ts`，经真实路由新建一张带 `importSource` 的报价
- **THEN** 落库的 `formDataJson` 含 `importSource`，AuditLog 多一条 `quote_imported`，其内容含工具报价号与导出时间、不含客户电话与邮箱

#### Scenario: 再次保存不重复写
- **WHEN** 同一张报价不改 `importSource` 再保存两次
- **THEN** `quote_imported` 仍只有一条

#### Scenario: 修改路径
- **WHEN** 把文件导入一张已存的、原本没有留痕的报价并保存
- **THEN** 该报价多一条 `quote_imported`

#### Scenario: 不带留痕的报价
- **WHEN** 新建一张手工录入的报价
- **THEN** 没有 `quote_imported` 审计
