# installation/install-tasks Specification

## Purpose
安装任务：以预约（类型为安装）承载安装工作，规定谁能看到哪些任务、安装时间如何展示、谁能安排与改派，以及任务的开始与完成状态。

## Requirements

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

### Requirement: 安装工页面与日历
系统 SHALL 提供页面 `/install`（按日期分组的安装任务列表，含周视图）与 `/install/{id}`（任务页）。持 `install.task.read` 的人 SHALL 在手机底栏与侧栏看到"安装"入口；除管理层外、仅持安装权限的人登录后 SHALL 默认进入 `/install`。安装工在既有日历页 SHALL 能看到分配给自己的安装预约。

#### Scenario: 安装工登录
- **WHEN** 只持 `installer` 岗位的人登录
- **THEN** 落地 `/install`，底栏有"安装"入口，没有销售 / 报价 / 客户入口

#### Scenario: 周视图
- **WHEN** 安装工在 `/install` 切到周视图
- **THEN** 一周内每天显示当天任务的开始时间与客户名

### Requirement: 安排与改派安装
工艺单转为"已排期"时提交的 `assignedToId` SHALL 是持 `install.task.read`（任一范围）的用户，否则返回 400 说明"必须选择安装岗位的人"；执行转换的人 SHALL 持 `install.task.assign`。`GET /api/install/installers` SHALL 返回当前企业持 `install.task.read` 的用户（id、姓名），供安排安装时选择。

#### Scenario: 选了非安装岗
- **WHEN** 运营主管把工艺单转 scheduled 并指定一位销售为 assignedToId
- **THEN** 返回 400，工艺单状态不变

#### Scenario: 正常安排
- **WHEN** 运营主管或会计指定安装工小王与安装时间
- **THEN** 创建类型为安装、分配给小王的预约，工艺单进入 scheduled 并记录预计安装时间

#### Scenario: 出单人不能安排
- **WHEN** 只持出单岗位（无 `install.task.assign`）的人把工艺单转 scheduled
- **THEN** 返回 403

#### Scenario: 安装工候选列表
- **WHEN** 请求 `GET /api/install/installers`
- **THEN** 只返回持安装任务读权的用户，不含密码哈希 / token

### Requirement: 开始与完成状态
被分配人 SHALL 能把任务从"已排期"置为"进行中"（`POST /api/install/tasks/{id}/start`），SHALL NOT 能直接置为"已完成"；完成只能通过收口流程（见 `installation/window-closeout`）或提交维修单（见 `installation/repairs`，结果为需返修，工艺单保持已排期）。

#### Scenario: 开始安装
- **WHEN** 小王在任务页点"开始安装"
- **THEN** 预约状态为 in_progress，审计记录 `install.task.started`

#### Scenario: 提交维修单完成任务
- **WHEN** 小王在有问题的任务上提交维修单
- **THEN** 预约状态为 completed，审计 `install.task.completed` 的结果为 `needs_repair`，工艺单仍为 scheduled（`repair-db.isolated.test.ts`）
