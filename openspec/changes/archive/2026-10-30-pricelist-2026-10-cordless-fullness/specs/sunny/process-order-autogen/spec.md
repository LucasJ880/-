# Spec Delta

## MODIFIED Requirements

### Requirement: 报价到工艺字段的映射
系统 SHALL 按以下口径从 Order Form 推导工艺输入：Lift L/R → 拉杆位置 L/R，Lift M → 电动；Shades 行 Cordless 开（仅 Zebra / Roller）→ 操控方式无绳，否则 Lift L/R → 普通拉绳；Mount I/O → IN/OUT；Bracket C/W → 顶装/墙装；Valance Cassette → 亮白插片圆盒、Fascia → 哑白方型罩盒、None → 单轨无盒；窗帘 Pleat P → 韩褶P、R → 蛇型R，Fullness 180/230 → 1.8/2.3，Panels S/D → 1/2，Bracket C/W → 顶装C/墙装W，版本默认 6cm。

#### Scenario: 斑马帘行映射
- **WHEN** Order Form 斑马帘行 Mount=O、Lift=L、Bracket=W、Valance=Cassette
- **THEN** 工艺单行为 斑马帘 / OUT / 普通 / 拉杆位置 L / 亮白插片圆盒 / 墙装

#### Scenario: 电动行
- **WHEN** 卷帘行 Lift=M
- **THEN** 操控方式为电动，且待核对中有一条"电机侧默认 R"提示

#### Scenario: 无绳行
- **WHEN** 斑马帘行 Cordless 开、Lift=R
- **THEN** 操控方式为无绳、拉杆位置 R，减尺按无绳表；`npx tsx src/lib/sunny-process/__tests__/quote-mapping.test.ts` 覆盖
