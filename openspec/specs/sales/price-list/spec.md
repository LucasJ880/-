# sales/price-list Specification

## Purpose
Sunny 零售价表：价表版本、各产品按宽高档位查 MSRP 并套折扣与最低价的定价规则、手动成交价覆盖、企业折扣的零 schema 落点、SKU 别名，以及以黄金用例文件为契约的对照验证。

## Requirements

### Requirement: 价表版本与来源
系统 SHALL 公布当前价表版本标识，本次为 `2026-10-28`；价表数值 SHALL 只来自 `config/pricelist/2026-10-28-lucas-quote.json`，该文件 SHALL 记录来源文件的 SHA-256。新建报价时系统 SHALL 把价表版本写入报价的表单数据 `formDataJson.pricelistVersion`，SHALL NOT 为此新增数据库字段。

#### Scenario: 新建报价带价表版本
- **WHEN** 销售通过 `POST /api/sales/quotes` 新建一份报价，表单数据为 JSON 对象
- **THEN** 落库的 `formDataJson` 解析后含 `pricelistVersion: "2026-10-28"`；`npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` 断言版本常量

### Requirement: Fauxwood 查表定价
系统 SHALL 把 `Fauxwood`（配置 `Standard`）按价表宽档 18 / 24 / 32 / 36 / 42 / 48 / 54 / 60 / 66 / 72 / 78 与高档 30 / 36 / 42 / 48 / 54 / 60 / 66 / 72 / 75 向上取档查 MSRP，默认折扣 30%，折后低于 209 时 SHALL 取 209；安装费宽 ≤ 70" 为 18、否则 26。宽 > 78" 或高 > 75" SHALL 返回超范围错误而非金额。

#### Scenario: 36.5" × 48"
- **WHEN** 定价 Fauxwood Standard 宽 36.5" 高 48"
- **THEN** 取档 42 × 48，MSRP 410.06，成交 287.05，安装 18；黄金用例 `fauxwood` 组覆盖

#### Scenario: 最低价兜底
- **WHEN** 定价 Fauxwood Standard 宽 18" 高 30"
- **THEN** MSRP 339.29，折后 237.50 高于 209 不触发；黄金用例覆盖最小档

#### Scenario: 超范围
- **WHEN** 定价 Fauxwood 宽 79" 高 75"
- **THEN** 返回错误，不返回金额

### Requirement: Allusion 查表定价
系统 SHALL 把 `Allusion`（配置 `Standard`）按价表 14 个宽档（24 … 72、84 … 108）与 15 个高档（36 … 120）查 MSRP，默认折扣 35%，折后低于 200 时 SHALL 取 200；安装费与其它帘子相同。Allusion SHALL NOT 再要求销售手填单价。

#### Scenario: 25.5" × 36.5"
- **WHEN** 定价 Allusion Standard 宽 25.5" 高 36.5"
- **THEN** 取档 30 × 42，金额与黄金用例 `allusion` 组一致，不报"需要手填单价"

#### Scenario: 超范围
- **WHEN** 定价 Allusion 宽 109" 高 120"
- **THEN** 返回错误

### Requirement: Allusion 手动成交单价覆盖
当 Allusion 行带有大于 0 的手动成交单价时，系统 SHALL 以该值为成交价，MSRP 仍取价表值，折扣额 = MSRP − 手动成交价（不为负）；未填或非法时 SHALL 走查表定价。`Roman` SHALL 维持手填单价分支不变。

#### Scenario: 手填覆盖
- **WHEN** Allusion 宽 24" 高 36"，手动成交单价 300
- **THEN** 成交价 300，MSRP 为价表值，安装费不受影响；黄金测试文件中的覆盖用例断言

#### Scenario: Roman 仍手填
- **WHEN** Roman 行未填单价
- **THEN** 该行报错"需要销售在报价单上手填单价"，与改动前一致

### Requirement: 老产品定价不变
价表版本升级 SHALL NOT 改变 Roman Shade、Zebra、SHANGRILA、Cordless Cellular、SkylightHoneycomb、Roller、Drapery、Sheer、Shutters 任何档位的 MSRP、折扣、最低价与安装费。

#### Scenario: 回归组
- **WHEN** 运行黄金对照测试的 `regression` / `zebra` / `roller` / `door-screen` 组
- **THEN** 全部与引擎输出一致（金额误差 ≤ 0.01，报错 ↔ 报错）

### Requirement: 黄金用例对照
`config/pricelist/2026-10-28-golden-cases.json` 是定价契约。对照测试 SHALL 按标签把用例分为"本次必须一致"与"留给后续 change"两组，两组并集 SHALL 覆盖文件中全部标签，出现未归组的标签 SHALL 失败；"本次必须一致"组 SHALL 含 fauxwood、allusion、regression、zebra、roller、door-screen、door-screen-err、cordless-ignored、cordless-zebra、cordless-zebra-bo、cordless-roller、cordless-roller-cassette、cordless-override、fullness-drapery、fullness-sheer、fullness-default、fullness-invalid、door-screen-no-fullness；"留给后续 change"组 SHALL 为空。

#### Scenario: 新标签不被静默跳过
- **WHEN** 黄金文件新增一个未归组的标签
- **THEN** `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` 失败并列出该标签

#### Scenario: 全部 158 条一致
- **WHEN** 运行 `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts`
- **THEN** 158 条全部与引擎输出一致，输出中 DEFERRED 为 0 条

### Requirement: 企业折扣的零 schema 落点
Fauxwood 与 Allusion 的企业折扣 SHALL 存于企业设置 JSON `pricing.discounts.fauxwood` / `pricing.discounts.allusion`（0 到 1），缺失或非法时 SHALL 回落默认 0.30 / 0.35；`GET /api/sales/quote-settings/discounts` SHALL 返回 `fauxwood` 与 `allusion` 两项；定价、预览与报价创建 SHALL 使用同一来源。品类成本率 SHALL 接受 `fauxwood` / `allusion` 键。

#### Scenario: 读取回落
- **WHEN** 企业设置 JSON 的 `pricing.discounts.fauxwood` 为 `"abc"`
- **THEN** 折扣读作 0.30；纯函数测试覆盖

#### Scenario: 企业覆盖生效
- **WHEN** 企业设置 JSON 的 `pricing.discounts.allusion` 为 0.4
- **THEN** 预览与新建报价中 Allusion 行按 40% 折扣计价

### Requirement: SKU 别名
SKU 目录中 Zebra `LOUIA-WHITE-BL201-LF` SHALL 为正式编号；旧编号 `LOUIA-WHITE-LF-BL201` SHALL 解析到同一条目并映射到 `Light Filtering` 定价面料。目录条目总数 SHALL 保持 350。

#### Scenario: 旧编号仍可定价
- **WHEN** 历史报价行的 SKU 为 `LOUIA-WHITE-LF-BL201`
- **THEN** 查目录得到正式编号条目，定价面料为 `Light Filtering`

### Requirement: 产品下拉与文字解析
Order Form Shades 表、Part A、量房页的产品下拉 SHALL 含 `Fauxwood`；AI 报价文字解析 SHALL 把 `fauxwood` / `faux wood` / `仿木` 识别为 Fauxwood，把 `allusion` / `梦幻帘` 识别为 Allusion。

#### Scenario: 文字解析
- **WHEN** 解析文本 `2 faux wood 36x48; 1 allusion 48x60`
- **THEN** 得到 2 行 Fauxwood 与 1 行 Allusion；`npm run build` 通过作为下拉的可观察产物

### Requirement: 不输出成本
价表、折扣接口与报价预览响应 SHALL NOT 含经销商参考价或品类成本率以外的任何成本数据；经销商参考价 SHALL NOT 进入青砚。

#### Scenario: 预览无成本
- **WHEN** 调用 `POST /api/sales/quotes/preview`
- **THEN** 响应只含 MSRP、折扣、成交价、安装费与合计，无成本字段

### Requirement: 无绳定价规则
Zebra 与 Roller 的无绳行 SHALL 按以下顺序计价：折扣取行级覆盖，没有覆盖时取企业无绳折扣（默认 30%），SHALL NOT 取产品折扣；Roller 罩盖加价在折扣之后加入；然后 MSRP 与成交价同乘 1.15；乘倍率后的成交价低于无绳最低价（默认 Zebra 159、Roller 129）时取最低价。无绳 SHALL NOT 再有独立尺寸上限，只受产品矩阵范围约束。其它产品带无绳标记时 SHALL 按有绳计价。

#### Scenario: 最低价兜底
- **WHEN** 定价 Zebra Light Filtering 24" × 36" 无绳
- **THEN** MSRP 184.26、成交 159、安装 18；黄金用例 `cordless-zebra` 组覆盖

#### Scenario: 超过 75" 不再报错
- **WHEN** 定价 Zebra Light Filtering 90" × 100" 无绳
- **THEN** 取档 90 × 102，MSRP 795.85、成交 557.10、安装 26

#### Scenario: 行级覆盖优先
- **WHEN** 定价 Roller Light Filtering (Open Roll) 24" × 36" 无绳，行级折扣 50%
- **THEN** 折扣记 0.5，成交 129（最低价兜底）；黄金用例 `cordless-override` 组覆盖

#### Scenario: 非 Zebra / Roller 忽略无绳
- **WHEN** 定价 SHANGRILA 48" × 60" 带无绳标记
- **THEN** 结果与有绳相同，无绳标记为假；黄金用例 `cordless-ignored` 组覆盖

### Requirement: 无绳企业设置落点
无绳折扣与两个无绳最低价 SHALL 存于企业设置 JSON `pricing.cordless.discount`（0 到 1）、`pricing.cordless.floors.Zebra`、`pricing.cordless.floors.Roller`（0 到 10000），缺失或非法时 SHALL 回落默认 0.30 / 159 / 129；`GET /api/sales/quote-settings/discounts` SHALL 返回 `cordlessDiscount`、`cordlessFloorZebra`、`cordlessFloorRoller`；预览与报价创建 SHALL 用同一来源，SHALL NOT 把企业产品折扣当作无绳行的行级覆盖。

#### Scenario: 企业无绳折扣生效
- **WHEN** 企业设置 JSON 的 `pricing.cordless.discount` 为 0.25，预览 Zebra Light Filtering 48" × 60" 无绳
- **THEN** 行折扣为 0.25，成交价 = max(MSRP × 0.75, 159) × 1.15；`quote-settings-db.isolated.test.ts` 覆盖

#### Scenario: 坏值回落
- **WHEN** `pricing.cordless.floors.Zebra` 为 `"x"`
- **THEN** Zebra 无绳最低价按 159；纯函数测试覆盖

### Requirement: 无绳标记来自显式开关
Order Form Shades 表每行 SHALL 有"Cordless"开关，只对 Zebra / Roller 可用，默认关；切换到其它产品时 SHALL 清掉开关。报价行的无绳标记 SHALL 只来自该开关（Part A 与量房页沿用各自的无绳勾选），Lift L / R SHALL NOT 再被解释为无绳。已保存的表单数据没有该字段时 SHALL 视为关。

#### Scenario: 旧报价重算
- **WHEN** 编辑一份保存于本次改动之前、Shades 行 Lift=L 且表单数据无 `cordless` 字段的报价并重算
- **THEN** 该行按有绳计价，`SalesQuoteItem.cordless` 为假

#### Scenario: 开关开
- **WHEN** Order Form 一行 Zebra 24" × 36" 打开 Cordless
- **THEN** 预览与保存后的行成交价都是 159（×1.15 后仍以 159 兜底），`cordless` 为真；可观察产物：`npm run build` 通过，走查截图

### Requirement: 褶皱率查表
Drapery 与 Sheer（Door Screen Sheer 除外）的查表宽 SHALL 为实际窗宽 × 褶皱率 ÷ 2，取档、MSRP、折扣、最低价均按查表宽；安装费 SHALL 仍按实际窗宽判断宽窄档。褶皱率 SHALL 只接受 1 到 4 之间的有限数，其它值 SHALL 使该行报错而不是回落默认；未提供时 SHALL 按 2。查表宽超出矩阵时错误信息 SHALL 写明该褶皱率下允许的最大窗宽。Door Screen Sheer SHALL 忽略褶皱率。

#### Scenario: 1 倍褶皱可报 300" 窗
- **WHEN** 定价 Drapery Without liner 300" × 108"，褶皱率 1
- **THEN** 查表宽 150，取档 150 × 108，成交价与黄金用例 `fullness-drapery` 组一致；褶皱率 2 时同尺寸报超范围且错误信息含最大窗宽 200

#### Scenario: 非法褶皱率
- **WHEN** 褶皱率为 0.5 或 5
- **THEN** 该行报错；黄金用例 `fullness-invalid` 组覆盖

#### Scenario: Door Screen Sheer 不受影响
- **WHEN** 定价 Sheer Door Screen Sheer 25" × 50" 带褶皱率 3
- **THEN** 成交价与不带褶皱率相同；黄金用例 `door-screen-no-fullness` 覆盖

### Requirement: 褶皱率来源
Order Form 窗帘表与 Part A 的 Fullness 180 / 230 SHALL 分别作为褶皱率 1.8 / 2.3 传给定价，与工艺单使用同一字段；量房生成、AI 文字解析、Muse 等不带褶皱率的入口 SHALL 按 2 计价。系统 SHALL NOT 新增企业级默认褶皱率设置。

#### Scenario: Order Form 默认 Standard 180%
- **WHEN** Order Form 布帘行 Without liner 100" × 120"，Fullness 保持默认 180
- **THEN** 查表宽 90，成交价与黄金用例 `fullness-drapery`（100 × 120，1.8）一致：831.41、安装 90

#### Scenario: 量房生成按 2
- **WHEN** 量房记录生成报价，窗位为 Drapery 100" × 120"
- **THEN** 查表宽 100，成交价与黄金用例（100 × 120，2）一致

### Requirement: 附加项目目录与来源
附加项目目录 SHALL 含 36 项：`config/pricelist/2026-10-28-lucas-quote.json` 的 `retailAddonsCsv` 11 项（键、名称、客户可见名、单价、适用产品与该表一致）、`excelAddons` 中零售表没有的 24 项、以及 `fees.downtown` 的 Downtown 服务费一项。每项 SHALL 记录来源（零售表键、Excel 行 ID 或费用节路径），单价 SHALL 等于来源处的数值。零售表之外新增项的键 SHALL 含下划线。

#### Scenario: 目录与价表文件逐项一致
- **WHEN** 运行 `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-addons.test.ts`
- **THEN** 目录为 36 项，每项单价与其来源处数值相等；`motor_plugin` 为 350、`drape_motor_plugin_matter` 为 700、`hub` 为 240、`downtown_fee` 为 150

#### Scenario: 原有 7 项价格不变
- **WHEN** 读取 `motor`、`hub`、`remote`、`track6`、`track8`、`track10`、`track12`
- **THEN** 单价依次为 150、240、40、60、80、100、120

### Requirement: Excel 附加项目逐行归类
`excelAddons` 的每一行 SHALL 恰好归入一类：进目录、与零售表重复（指明对应零售键）、已由定价引擎计价、旧值、本次不做。Door Screen Sheer 两行与 Open roll Valance 两行 SHALL 归为"已由定价引擎计价"，SUNNY Hub 300 SHALL 归为旧值，黑色方盒 +15% SHALL 归为本次不做。出现未归类的行时测试 SHALL 失败。

#### Scenario: 40 行全部归类
- **WHEN** 运行 `pricelist-2026-10-addons.test.ts`
- **THEN** 进目录 24、重复 10、引擎计价 4、旧值 1、不做 1，合计 40，无未归类行

### Requirement: 按英尺计价的附加项目
Motorized Drape Track、U/H/L Channel、Shutter Frame Vinyl、Shutter Frame Wood SHALL 以英尺为计价单位，单价依次为 30、18、4、7，数量为英尺数，小计为单价乘数量。Part B 与客户 PDF SHALL 在这四项的单价后标"/ft"。

#### Scenario: 13 英尺电动窗帘轨道
- **WHEN** 附加项目为 Motorized Drape Track、数量 13
- **THEN** 小计为 390；`pricelist-2026-10-addons.test.ts` 覆盖

### Requirement: Part B 计入报价金额
报价单页面新建或编辑保存时，SHALL 把 Part B 中已选择（预设或自定义）且数量大于 0 的每一行作为附加项目提交。服务端 SHALL 按提交的单价落库附加项目；预设行未提交单价时 SHALL 取企业价。报价的附加项目小计 SHALL 等于这些行的小计之和，并计入税前合计与含税总额。未选择或数量为 0 的行 SHALL NOT 提交。

#### Scenario: Part B 两行进入库里总额
- **WHEN** 报价单产品行税前 1000，Part B 有 `drape_motor_battery` × 1（650）与自定义行"Extra bracket" × 2（单价 15），税率 0.13，保存
- **THEN** 报价的附加项目小计为 680，附加项目两行落库（名称 Drape motor(Battery) 与 Extra bracket），含税总额比不含 Part B 时多 768.40；`quote-settings-db.isolated.test.ts` 经真实路由覆盖

#### Scenario: 销售改过的单价按改后落库
- **WHEN** Part B 选 `hub` 后把单价改成 200，数量 1，保存
- **THEN** 落库附加项目单价 200、小计 200

### Requirement: 附加项目企业价落点
企业对附加项目的覆盖价 SHALL 存在企业设置 JSON 的 `pricing.addons.{附加项目键}`，不新增数据库列。读取时缺键、非数字、负数、超过 10000 或不在目录里的键 SHALL 回到目录价。报价新建、编辑与 Part B 下拉 SHALL 使用同一企业价。

#### Scenario: 企业把电机改成 160
- **WHEN** 企业设置 JSON 的 `pricing.addons.motor` 为 160，新建报价提交 `motor` × 2 且未带单价
- **THEN** 附加项目小计为 320；`cost-rates.test.ts` 覆盖读取与回退，`quote-settings-db.isolated.test.ts` 经真实路由覆盖

#### Scenario: 坏值回目录价
- **WHEN** `pricing.addons` 为 `{ motor: -5, hub: "x", unknown_key: 9 }`
- **THEN** `motor` 为 150、`hub` 为 240，`unknown_key` 被忽略

### Requirement: 附加项目对客名称与不输出内部提示
客户 PDF 与客户分享页的附加项目名称 SHALL 用该项的客户可见名（自定义行用销售填写的名称）。附加项目的内部提示文字（如"一个订单免费配一根充电线"）SHALL NOT 出现在客户 PDF、客户分享页与发给客户的邮件中。

#### Scenario: 轨道在 PDF 上的名称
- **WHEN** Part B 选 `track6` × 1 并导出客户 PDF
- **THEN** PDF 附加项目行名称为"Track 6 ft"，不出现"TRACK 6 ft (72")"；`pricelist-2026-10-addons.test.ts` 覆盖名称选择函数

#### Scenario: 充电线提示不出给客户
- **WHEN** Part B 选 `motor_charger` × 1 并保存
- **THEN** 落库附加项目名称为"Sunny Motor Tube Charging cable"，客户分享页与 PDF 不含"免费"提示文字
