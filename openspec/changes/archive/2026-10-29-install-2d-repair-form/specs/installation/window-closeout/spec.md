# Spec Delta

## MODIFIED Requirements

### Requirement: 收口状态聚合
任务详情中每个收口单元的状态 SHALL 由该单元计入的收口记录与问题记录（`install.window.issue`，见 `installation/repairs`）中最新的一条决定：最新为收口记录 → 已收口，当前照片为最新一条计入的收口记录，张数为计入的收口记录数；最新为问题记录 → 有问题，不计入已收口；两者都没有 → 未收口。工艺参数单元的问题记录与收口记录一样按位置比对决定是否计入。任务的"已收口单元数 / 总单元数"与"有问题单元数" SHALL 一致地出现在列表、详情与工艺单"收口"标签里。

#### Scenario: 聚合
- **WHEN** 工艺单 4 扇窗，其中 2 扇各有 1 张、1 扇有 3 张、1 扇没有
- **THEN** 已收口 3 / 4，有 3 张的窗显示张数 3

#### Scenario: 列表与详情一致
- **WHEN** 只有 Vinyl 3 扇窗的单已拍 2 扇
- **THEN** 任务列表该任务显示 2 / 3，任务详情也为 2 / 3（`closeout-db.isolated.test.ts`）

#### Scenario: 收口后又标记问题
- **WHEN** 3 号窗先拍了完工照，之后又被标记为有问题
- **THEN** 3 号窗为有问题，不计入已收口，有问题数为 1（`closeout-units.test.ts`）

#### Scenario: 问题后补拍完工照
- **WHEN** 3 号窗先被标记有问题，安装工现场修好后又拍了完工照
- **THEN** 3 号窗为已收口，有问题数为 0（`closeout-units.test.ts`）
