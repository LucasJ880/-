# tender/result-marking Specification

## Purpose
招标结果标记（中标 / 未中标 / 未投标 / 取消）里的中标方采集：未中标时可选填中标方，如何校验、保存，以及何时沉淀为授标事实。

## Requirements

### Requirement: 未中标时选填中标方
结果表单在选择"未中标"时 SHALL 显示"中标方（选填）"。接口 SHALL 只在 `result=lost` 时接受 `winnerName`（其他结果填了 SHALL 返回 400），去首尾与多余空白后空串视为未填，超过 200 字 SHALL 返回 400。中标方与我方组织名按授标记录同一规范化相同时 SHALL 返回 400，且 SHALL NOT 改变项目状态。

#### Scenario: 校验
- **WHEN** 分别提交 lost + "  ABC   Blinds  Ltd "、lost + 空白、won + "ABC"、lost + 超长名字
- **THEN** 依次为接受"ABC Blinds Ltd"、视为未填、400、400；`npx tsx src/lib/projects/__tests__/tender-result.test.ts` 覆盖

#### Scenario: 填我方被拒
- **WHEN** 未中标时中标方填的是我方组织名（大小写 / 标点不同）
- **THEN** 返回错误"未中标时，中标方不能填我方组织"，项目状态不变；`outcome-winner-db.isolated.test.ts` 覆盖

### Requirement: 中标方的保存与沉淀
未中标且填了中标方时，系统 SHALL 在项目结果备注追加 `[中标方 日期] 名称`；授标情报开启时 SHALL 经既有人工确认写路径写入一条授标记录（人工确认、来源 USER_ENTRY、幂等键 `tender-result-winner:{projectId}`，带买家、招标编号、中标价与币种）。每个项目 SHALL 只记一条：同名再标记 SHALL 幂等，换名 SHALL NOT 覆盖原记录并返回原因 `winner_already_recorded`；授标情报关闭时 SHALL 只写备注并返回原因 `t4_schema_not_ready`；未填中标方时 SHALL NOT 写竞争对手事实。响应 SHALL 返回 `winner: { name, recorded, reason }`，界面据此说明是否已进入竞争对手情报。

#### Scenario: 写入与幂等
- **WHEN** 未中标填"ABC Blinds Ltd"、再用"abc blinds ltd"标记、再用"XYZ Coverings Corp"标记
- **THEN** 只有一条中标方为"ABC Blinds Ltd"的人工确认记录；第三次返回 `winner_already_recorded`；`outcome-winner-db.isolated.test.ts` 覆盖

#### Scenario: 开关关闭
- **WHEN** 授标情报关闭时未中标并填了中标方
- **THEN** 不写授标记录，备注里有中标方，原因 `t4_schema_not_ready`；同一测试覆盖
