# Spec Delta

## Purpose
规定招标要求审核时的批量确认：人在要求列表上勾选若干条待确认的要求，一次确认；并在批准分析之前看得到还剩几条没确认。选择始终由人明确做出，系统不替人选。

## ADDED Requirements

### Requirement: 勾选后批量确认
招标分析处于等待审核状态时，要求列表 SHALL 为每条待确认的要求提供勾选框，并提供「全选待确认的」「取消全选」与「确认选中的 N 条」。默认 SHALL 一条都不选。已确认与已驳回的要求 SHALL NOT 可勾选。没有选中任何要求时「确认选中」SHALL 不可用。系统 SHALL NOT 提供不经过勾选就确认全部要求的操作，SHALL NOT 提供批量驳回。分析已批准或处于其它状态时 SHALL NOT 显示这些控件。

#### Scenario: 默认不选，全选只选待确认的
- **WHEN** 一份等待审核的分析有 5 条要求：3 条待确认、1 条已确认、1 条已驳回
- **THEN** 初始选中 0 条；点「全选待确认的」后选中的是那 3 条（`npx tsx src/lib/tender-auto-analysis/__tests__/requirement-batch-confirm.test.ts`）

#### Scenario: 分析已批准
- **WHEN** 分析已批准
- **THEN** 要求列表上没有勾选框与批量确认的按钮（`requirement-batch-confirm.test.ts` 的面板源码断言）

### Requirement: 提交与结果
「确认选中的 N 条」SHALL 调用既有的批量确认接口。选中超过 200 条时 SHALL 按每批不超过 200 条依次提交，直到全部提交或某一批失败。完成后 SHALL 显示实际被确认的条数；实际条数少于选中条数时 SHALL 如实显示。某一批失败（请求失败、被拒绝、或响应无法识别）时 SHALL 停止提交后面的批次，显示错误，并说明此前已确认了几条。提交完成后列表 SHALL 刷新，选中状态 SHALL 清空。结果消息 SHALL 只在它所属的那份分析仍在等待审核时显示。

#### Scenario: 超过 200 条分批
- **WHEN** 选中 450 条
- **THEN** 分成 200、200、50 三批依次提交（`requirement-batch-confirm.test.ts`）

#### Scenario: 实际确认数少于选中数
- **WHEN** 选中 3 条，其中 1 条在提交前已被别人驳回
- **THEN** 接口返回确认了 2 条，界面显示「已确认 2 条」而不是 3 条（`npx tsx src/lib/tender-auto-analysis/__tests__/requirement-batch-confirm-db.isolated.test.ts`）

#### Scenario: 某一批失败
- **WHEN** 选中 450 条，第二批被接口拒绝
- **THEN** 第三批不再提交；界面显示错误，并说明此前已确认 200 条（`requirement-batch-confirm.test.ts`，用假的接口走真实的提交逻辑）

### Requirement: 分析不再等待审核时不能批量确认
面板提交批量确认时 SHALL 要求接口只在这份分析仍是等待审核时确认。分析已被批准或已被新的分析取代时，接口 SHALL 拒绝这次请求、SHALL NOT 确认任何要求、SHALL NOT 写审计；面板 SHALL 显示原因。这个判断 SHALL 与确认本身是同一步完成的，不存在「先查到可以、随后被批准、仍然确认成功」的间隙。不带这项要求的请求 SHALL 保持本变更之前的行为。

#### Scenario: 面板开着时别人批准了分析
- **WHEN** 甲的面板停在等待审核的状态，乙批准了这份分析，随后甲点「确认选中的 N 条」
- **THEN** 接口返回 409，没有要求被确认，没有审计；甲看到「这份分析已经不是等待审核……」（`requirement-batch-confirm-db.isolated.test.ts`）

#### Scenario: 不带这项要求的调用
- **WHEN** 另一个调用方不带这项要求，对一份已批准的分析提交批量确认
- **THEN** 行为与本变更之前相同（`requirement-batch-confirm-db.isolated.test.ts`）

### Requirement: 计数与批准前的提示
要求列表上方 SHALL 显示已确认、待确认、已驳回各几条。分析等待审核且还有待确认的要求时，「批准分析」按钮旁 SHALL 显示提示：还剩几条没有确认、批准后不能再确认、没确认的不会进询价单。待确认为 0 时 SHALL NOT 显示这句提示。这句提示 SHALL NOT 增加批准所需的点击。

#### Scenario: 还有待确认的要求
- **WHEN** 等待审核的分析还有 4 条待确认的要求
- **THEN** 「批准分析」旁显示「还有 4 条要求没有确认……」；全部确认后这句话消失（`requirement-batch-confirm.test.ts`）

### Requirement: 批量确认留审计
批量确认接口每次成功 SHALL 写一条审计，记下操作者、所属的招标分析、请求确认的要求与实际确认的条数。审计里的要求号 SHALL 有条数与长度上限。接口的响应结构 SHALL 与本变更之前相同；请求体只新增一个可选字段（见「分析不再等待审核时不能批量确认」），不带它时行为不变。审计写入失败 SHALL NOT 使已经完成的确认失败。

#### Scenario: 审计内容
- **WHEN** 有项目写权限的人批量确认 3 条要求
- **THEN** 这 3 条变为已确认，有一条审计记下操作者、分析与这 3 条要求；响应里仍是 `ok` 与 `confirmedCount`（`requirement-batch-confirm-db.isolated.test.ts`）

#### Scenario: 没有写权限
- **WHEN** 对项目没有写权限的人（不是本组织成员、没登录、或只是项目里的操作员）调用批量确认接口
- **THEN** 请求被拒，没有要求被确认，也没有审计（`requirement-batch-confirm-db.isolated.test.ts`）
