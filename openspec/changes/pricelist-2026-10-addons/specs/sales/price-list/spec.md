## ADDED Requirements

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
