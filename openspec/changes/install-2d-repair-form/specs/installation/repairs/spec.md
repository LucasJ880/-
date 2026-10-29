# Spec Delta

## Purpose

装不完的单在现场记录问题、提交数字化维修单（纸质 SUNNY SHUTTER INC 模板），并把返修需求送到出单、运营、会计与销售手里；后续的出单、排返修与二次安装也在此能力上扩展。

## ADDED Requirements

### Requirement: 问题类型表
每条问题 SHALL 属于以下类型之一，是否需工厂出单 SHALL 由类型查表决定：尺寸不符需重做、部件缺失 / 漏发、产品损坏 / 瑕疵、颜色 / 面料不符、电机 / 遥控 / 充电问题 → 需工厂；现场条件不具备、客户原因（不在家 / 改期 / 改方案）→ 不需工厂；其他 → 由安装工选择，未选时视为需工厂。类型以外的值 SHALL 被拒绝。

#### Scenario: 查表
- **WHEN** 问题类型为"尺寸不符需重做"或"现场条件不具备"
- **THEN** 前者需工厂、后者不需工厂（`repair.test.ts`）

#### Scenario: 其他类型默认需工厂
- **WHEN** 问题类型为"其他"且安装工没有选择是否需工厂
- **THEN** 视为需工厂（`repair.test.ts`）

#### Scenario: 未知类型
- **WHEN** 提交的问题类型不在表内
- **THEN** 返回 400，不写记录（`repair-db.isolated.test.ts`）

### Requirement: 标记单元有问题
`POST /api/install/tasks/{id}/items/{itemId}/issue`（multipart：问题照 `file` 必填、`issueType`、`description` 必填且不超过 300 字、类型为其他时可带 `needsFactory`）SHALL 沿用上传完工照的权限、文件类型与大小限制和存储前缀，并写审计 `install.window.issue`（目标类型与目标同完工照），内容含工艺单、任务、单元、位置、问题类型、是否需工厂、描述与照片代理地址。任务已完成或已取消 SHALL 返回 409；单元不属于该工艺单 SHALL 返回 404；缺照片或描述 SHALL 返回 400；写记录失败 SHALL 返回 500 并提示重拍。

#### Scenario: 标记成功
- **WHEN** 小王对 `spec-vinyl-1` 上传问题照，类型"尺寸不符需重做"，描述"高度短 2cm"
- **THEN** 返回 200；审计出现一条 `install.window.issue`，目标 `<工艺单 id>:vinyl:1`，需工厂为是；该单元状态为有问题（`repair-db.isolated.test.ts`）

#### Scenario: 缺照片或描述
- **WHEN** 只填类型与描述、不带照片，或带照片但描述为空
- **THEN** 返回 400，无文件写入、无审计

#### Scenario: 他人任务
- **WHEN** 小李对小王的任务标记问题
- **THEN** 返回 403

#### Scenario: 任务已完成
- **WHEN** 任务已通过完成收口或提交维修单完成后再标记问题
- **THEN** 返回 409

### Requirement: 任务详情中的问题与维修单
安装任务详情的每个收口单元 SHALL 带问题内容（类型、类型名、是否需工厂、描述、本次有问题以来的问题照片、时间、标记人），单元不处于"有问题"时为空。任务因提交维修单而完成时，详情 SHALL 带该维修单的单号、目标日与行数。

#### Scenario: 有问题的单元
- **WHEN** 小王打开任务，`spec-vinyl-1` 已标记"尺寸不符需重做"
- **THEN** 该单元问题内容含类型名、描述"高度短 2cm"、1 张问题照，汇总里有问题数为 1（`repair-db.isolated.test.ts`）

#### Scenario: 提交后
- **WHEN** 维修单 `R-<单号>-1` 提交后小王再打开该任务
- **THEN** 任务为已完成，详情带单号 `R-<单号>-1`、目标日与行数

### Requirement: 完成收口与提交维修单二选一
安装工任务页每个收口单元 SHALL 提供"拍照完成"与"有问题"两个入口。底部按钮 SHALL 按单元状态切换：全部已收口显示「完成收口」；没有未处理单元且至少一个有问题显示「提交维修单（N 项有问题）」；还有未处理单元时禁用并写明还差几项与它们的位置。

#### Scenario: 有问题时切换
- **WHEN** 3 个单元中 2 个已收口、1 个有问题
- **THEN** 底部按钮为「提交维修单（1 项有问题）」，不显示「完成收口」（本地 Playwright 走查截图）

#### Scenario: 还有未处理
- **WHEN** 3 个单元中 1 个已收口、1 个有问题、1 个未处理
- **THEN** 底部按钮禁用，写明还差 1 项及其位置

### Requirement: 提交维修单的条件
`POST /api/install/tasks/{id}/repair`（JSON：`customerName`、`phone`、`notes`、可选 `customerPreferredDate`、`customerConfirmed`）SHALL 要求被分配人或持 `install.task.update`（ORG）。还有未处理单元 SHALL 返回 409 `UNITS_UNHANDLED` 并列出序号与位置；没有有问题的单元 SHALL 返回 409 `NO_ISSUES`；任务已取消、或已通过完成收口完成 SHALL 返回 409；客户名为空、期望日不是日期、早于填写日或晚于填写日 365 天 SHALL 返回 400。以上情况都 SHALL NOT 写记录或改状态。

#### Scenario: 还有未处理单元
- **WHEN** 3 个单元中有 1 个既没拍完工照也没标记问题时提交
- **THEN** 返回 409 `UNITS_UNHANDLED`，列出该单元序号与位置（`repair-db.isolated.test.ts`）

#### Scenario: 没有问题
- **WHEN** 所有单元都已收口时提交维修单
- **THEN** 返回 409 `NO_ISSUES`

#### Scenario: 期望日早于今天
- **WHEN** `customerPreferredDate` 早于企业时区当天
- **THEN** 返回 400，预约状态不变

### Requirement: 维修单内容
维修单 SHALL 记录：Name（预填客户名，可改）、Order#（工艺单号）、Taken by（提交人）、Phone（预填客户电话，可改）、Notes、Filling Date（企业时区当天）、客户期望日、是否已和客户确认、目标日（有期望日取期望日，否则填写日 + 7 个日历日）、单号 `R-<工艺单号>-<该工艺单第几张维修单>`。行 SHALL 由服务端按当前有问题的单元按序号生成（位置、描述、问题类型、是否需工厂、品类、问题照片），不接受客户端传入的行。记录为审计 `install.repair.submitted`，目标为工艺单。

#### Scenario: 默认目标日
- **WHEN** 2026-10-28 提交、没有客户期望日
- **THEN** 目标日为 2026-11-04（`repair.test.ts`）

#### Scenario: 客户期望日
- **WHEN** 客户期望 2026-11-10 并勾选已和客户确认
- **THEN** 目标日为 2026-11-10，已和客户确认为是

#### Scenario: 行与单号
- **WHEN** 工艺单 `SO-1` 第一次提交，`spec-vinyl-1` 与 3 号 Blinds 行有问题
- **THEN** 单号 `R-SO-1-1`，2 行按序号排列，各带位置、描述、问题类型、照片（`repair-db.isolated.test.ts`）

### Requirement: 提交维修单的效果
提交成功 SHALL 把本次预约置为已完成（记录完成时间）并写审计 `install.task.completed`（结果 `needs_repair`、单号）；工艺单状态 SHALL 保持不变（仍为已排期），不写状态日志。同一预约重复提交或并发提交 SHALL 只产生一张维修单，重复的请求 SHALL 返回 200 与已有维修单，不重复写记录或发通知。

#### Scenario: 预约完成、工艺单仍已排期
- **WHEN** 小王提交维修单
- **THEN** 预约 completed，工艺单仍为 scheduled，没有新的状态日志（`repair-db.isolated.test.ts`）

#### Scenario: 重复与并发
- **WHEN** 同一任务连续提交两次，或两个请求同时提交
- **THEN** 只有一条 `install.repair.submitted`，第二次返回 200 与同一单号，通知不重复

### Requirement: 维修单通知
提交成功后 SHALL 发站内通知（类型 `install_repair_submitted`）：需工厂行涉及品类的出单岗（持该品类修改键；需工厂行品类推不出时三个品类岗都发）、持 `install.task.assign` 者、持 `install.balance.confirm` 者，落到 `/install/repairs/{维修单 id}`；工艺单创建人（不在上述人中时）落到 `/blinds-orders/{工艺单 id}`。提交人本人不收；没有需工厂行时 SHALL NOT 发给出单岗；同一维修单同一人只发一条。

#### Scenario: 只有 Vinyl 需工厂
- **WHEN** 维修单只有一行 Vinyl"尺寸不符需重做"
- **THEN** 出单·Vinyl、运营主管、会计、老板各收到一条落到维修单详情的通知，出单·布帘与出单·Roller 不收，销售收到一条落到工艺单详情的通知（`repair-db.isolated.test.ts`）

#### Scenario: 只有客户原因
- **WHEN** 维修单只有一行"客户原因"
- **THEN** 三个出单岗都不收；运营主管、会计、老板、销售照常收到

#### Scenario: 通知点得上
- **WHEN** 头部铃铛或通知页点开 `install_repair_submitted`
- **THEN** 实体为维修单的落到 `/install/repairs/{id}`，实体为工艺单的落到 `/blinds-orders/{id}`；每个收件岗位对落点页都有读权（`balance.test.ts`、`repair-db.isolated.test.ts`）

### Requirement: 维修单列表与详情
`GET /api/install/repairs` 与 `GET /api/install/repairs/{id}` SHALL 只对持 `install.task.read`（ORG）开放，其他人 403；他企业的维修单 SHALL 返回 404。列表每条含单号、工艺单号、客户名、提交人、填写日、目标日、是否已过目标日、行数、需工厂品类、是否已和客户确认与当前安装阶段，按目标日升序；详情含表头、全部行（含问题照片代理地址）与当前安装阶段。页面 `/install/repairs`、`/install/repairs/{id}` 展示同样内容；`/install` 对 ORG 范围的人显示"返修单"入口。

#### Scenario: 安装工不能看
- **WHEN** 只持 `installer` 的小王请求维修单列表或详情
- **THEN** 返回 403（`repair-db.isolated.test.ts`）

#### Scenario: 出单岗查看
- **WHEN** 出单·Vinyl 打开通知里的维修单详情
- **THEN** 返回 200，含全部行与问题照片代理地址，阶段为返修待出单

#### Scenario: 他企业
- **WHEN** 另一企业的运营主管请求该维修单
- **THEN** 返回 404

### Requirement: 维修单打印版
`/install/repairs/{id}/print` SHALL 按纸质维修单版式输出：抬头为组织质保设置里的公司名与地址（大写），表头 Name / Order# / Taken by / Phone / Notes，表格 # / Location / Description（另列问题类型与是否需工厂），行数不足 10 时补空行到 10、超过 10 时全部列出，底部 Filling Date 与目标返修日；访问权与维修单详情相同。

#### Scenario: 不足 10 行
- **WHEN** 打印一张 3 行的维修单
- **THEN** 表格共 10 行，前 3 行有内容，抬头为 "SUNNY SHUTTER INC" 与 "2-680 PROGRESS AVENUE, SCARBOROUGH, ON M1H 3A5"（`repair.test.ts` 补行；本地 Playwright 截图）

### Requirement: 维修单不输出的内容
维修单接口、页面、打印版与通知 SHALL NOT 含报价金额、定金、尾款、折扣、成本或毛利，SHALL NOT 返回存储令牌或原始存储地址（照片只给 `/api/files/` 开头的代理地址）；打印版 SHALL NOT 含照片。

#### Scenario: 响应字段
- **WHEN** 运营主管请求维修单详情
- **THEN** 响应不含 `grandTotal`、`price`、`deposit`、`balance`、`cost` 字段或 `$` 金额，照片地址以 `/api/files/` 开头（`repair-db.isolated.test.ts`）
