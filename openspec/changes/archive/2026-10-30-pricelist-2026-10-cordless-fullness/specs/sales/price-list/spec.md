# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: 黄金用例对照
`config/pricelist/2026-10-28-golden-cases.json` 是定价契约。对照测试 SHALL 按标签把用例分为"本次必须一致"与"留给后续 change"两组，两组并集 SHALL 覆盖文件中全部标签，出现未归组的标签 SHALL 失败；"本次必须一致"组 SHALL 含 fauxwood、allusion、regression、zebra、roller、door-screen、door-screen-err、cordless-ignored、cordless-zebra、cordless-zebra-bo、cordless-roller、cordless-roller-cassette、cordless-override、fullness-drapery、fullness-sheer、fullness-default、fullness-invalid、door-screen-no-fullness；"留给后续 change"组 SHALL 为空。

#### Scenario: 新标签不被静默跳过
- **WHEN** 黄金文件新增一个未归组的标签
- **THEN** `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` 失败并列出该标签

#### Scenario: 全部 158 条一致
- **WHEN** 运行 `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts`
- **THEN** 158 条全部与引擎输出一致，输出中 DEFERRED 为 0 条
