# Spec Delta

## MODIFIED Requirements

### Requirement: 安装任务的可见范围
`GET /api/install/tasks` SHALL 只返回类型为安装、且属于当前企业的预约。持 `install.task.read` 为 ASSIGNED 范围的人 SHALL 只看到分配给本人的任务；持 ORG 范围的人 SHALL 看到全企业的任务；两者都不持有的人 SHALL 收到 403。每条任务 SHALL 含安装时间（开始 / 结束）、客户名、地址、工艺单编号、收口单元数与已收口单元数（收口单元见 `installation/window-closeout`「收口单元」）。

#### Scenario: 安装工只看自己的
- **WHEN** 安装工小王请求安装任务列表，企业内有分配给小王的 2 条和分配给小李的 3 条
- **THEN** 返回 2 条，均为分配给小王的

#### Scenario: 运营主管看全企业
- **WHEN** 持 `install.task.read`（ORG）的运营主管请求列表
- **THEN** 返回 5 条

#### Scenario: 无权限
- **WHEN** 只持销售岗位的人请求列表
- **THEN** 返回 403

#### Scenario: 按日期区间
- **WHEN** 带 `start` / `end` 请求
- **THEN** 只返回开始时间落在区间内的任务，按开始时间升序

#### Scenario: 含工艺参数行的单计数
- **WHEN** 任务的工艺单有 2 个 Blinds 行，工艺参数窗帘段 2 行
- **THEN** 该任务的收口单元数为 4（`closeout-db.isolated.test.ts`）

### Requirement: 安装任务详情
`GET /api/install/tasks/{id}` SHALL 返回任务与其工艺单的每个收口单元（单元 id、序号、位置、尺寸、产品或品类标签、面料或色号、所属段）及每个单元的收口状态（最新照片地址、时间、拍照人、照片张数；工艺参数单元位置已变时含标记与拍照时位置）。不在可见范围内的任务 SHALL 返回 403；任务未关联工艺单 SHALL 返回 409。

#### Scenario: 被分配人查看
- **WHEN** 小王打开分配给自己的任务
- **THEN** 返回 200，含工艺单全部收口单元与各自收口状态

#### Scenario: Shutters 单可见每扇窗
- **WHEN** 小王打开只有 Vinyl 3 扇窗的任务
- **THEN** 返回 3 个单元，所属段为 `vinyl`，位置与工艺参数一致（`closeout-db.isolated.test.ts`）

#### Scenario: 他人任务
- **WHEN** 小王打开分配给小李的任务
- **THEN** 返回 403
