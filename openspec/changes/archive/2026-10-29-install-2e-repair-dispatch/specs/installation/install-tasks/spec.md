# Spec Delta

## MODIFIED Requirements

### Requirement: 安装任务详情
`GET /api/install/tasks/{id}` SHALL 返回任务与其收口单元（单元 id、序号、位置、尺寸、产品或品类标签、面料或色号、所属段）及每个单元的收口状态（最新照片地址、时间、拍照人、照片张数；工艺参数单元位置已变时含标记与拍照时位置）。普通安装预约返回工艺单全部收口单元；返修预约只返回维修单各行对应的单元，并标明维修单号（见 `installation/repairs`「返修预约的收口范围」）。不在可见范围内的任务 SHALL 返回 403；任务未关联工艺单 SHALL 返回 409。

#### Scenario: 被分配人查看
- **WHEN** 小王打开分配给自己的任务
- **THEN** 返回 200，含工艺单全部收口单元与各自收口状态

#### Scenario: Shutters 单可见每扇窗
- **WHEN** 小王打开只有 Vinyl 3 扇窗的任务
- **THEN** 返回 3 个单元，所属段为 `vinyl`，位置与工艺参数一致（`closeout-db.isolated.test.ts`）

#### Scenario: 返修任务
- **WHEN** 小王打开维修单 `R-<单号>-1`（只有 Den 一行）的返修任务
- **THEN** 返回 1 个单元 Den，详情标明返修单号 `R-<单号>-1`（`repair-dispatch-db.isolated.test.ts`）

#### Scenario: 他人任务
- **WHEN** 小王打开分配给小李的任务
- **THEN** 返回 403
