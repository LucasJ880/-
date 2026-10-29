# Design: install-2d-repair-form

## Context

见 proposal.md「Why」。现状（2026-10-28 已读代码，基于 INSTALL-2c 本地头 `4c3d480`）：
- 收口单元：`buildCloseoutUnits()`（`src/lib/install/closeout.ts`）= Blinds 行 + 工艺参数四段，单元带 `logTargetId`（Blinds 行 = 行 id，目标类型 `blinds_order_item`；工艺参数行 = `<工艺单 id>:<段>:<下标>`，目标类型 `blinds_order_unit`）与品类（2c）。收口记录 = `AuditLog(install.window.completed)`，`loadCloseoutLogs()`（`src/lib/install/service.ts`）只查这一种动作，`aggregateCloseout()` 按位置快照比对后聚合。
- 上传完工照：`src/app/api/install/tasks/[id]/items/[itemId]/photo/route.ts`——权限 `install.window.complete`（被分配人或 ORG）、限流、类型 / 大小校验、私有前缀 `install-photos/{orgId}/{orderId}/{单元 id}/`、`writeAuditLog` 失败 500。
- 完成收口：`.../complete/route.ts` 把预约置 completed、工艺单 scheduled → installed，写 `install.task.completed`（`targetType=appointment`、`afterData.orderId / orderStatus`），然后 2b 的完工通知。
- 状态机（`src/lib/blinds/order-state-machine.ts`）：`scheduled → installed | cancelled`，没有返修态；工艺单只有一个 `appointmentId`。
- 岗位（`src/lib/authorization/role-defaults.ts`）：出单·Vinyl / 布帘 / Roller 各持 `orders.fulfillment.update.<品类>` 与 `install.task.read`、`install.photo.read`（ORG）；运营主管、会计、老板持 `install.task.assign` 与 ORG 读；会计、老板持 `install.balance.confirm`；安装工只有 ASSIGNED 的 `install.task.read / update`、`install.window.complete`。按键找人：`listUsersWithPermission(orgId, key)`。
- `/install` 页面守卫 `canAccessInstallWorkspace`（任一安装键）；接口再按范围判定。工艺单详情读权 `blindsOrderAccess().canRead`（销售 = 创建人）。
- 通知：落点由 `entityType` 决定（头部下拉与通知页都先调 `installNotificationHref`，`src/lib/install/balance.ts`），`metadata.href` 不被使用；新类型要进 `NOTIFICATION_TYPE_KEYS` 与 delivery-gate 的引入日期。
- 2b 的"待收尾款"列表把已安装与已完工、没有尾款确认记录的单都算进去（`listBalance`，`INSTALLED_STATUSES`）。

## Goals / Non-Goals

**Goals:**
- 安装工在一个任务页里逐单元二选一（完成 / 有问题），装不完时一次提交维修单，现场 1 分钟内完成。
- 维修单的每一行都有证据（问题照）和查表得出的"是否需工厂"；行由服务端生成，不会和现场标记对不上。
- 每个收件人点开通知都落在自己有权限打开、且能看到返修内容的页面。
- 一张 `installStage` 表供列表、详情、状态卡共用，2e 在同一张表上扩展。

**Non-Goals:**
- 不改 `src/lib/blinds/order-state-machine.ts`（不加状态、不加边）。
- 不改 `src/app/api/install/tasks/[id]/complete/route.ts` 的判定与推进（有问题的单元自然算未收口，完成收口仍 409）。
- 不改 `src/app/api/files/[...path]/route.ts`（问题照用同一前缀，沿用既有放行规则）。
- 不改 `src/app/api/blinds-orders/[id]/route.ts` 与 `transition/route.ts`（状态卡用独立接口）。
- 不改 `src/lib/muse-bridge/**`、`src/lib/pending-actions/**`（不建审批、不对外发送）。
- 不改 2b / 2c 的接口与页面；2b 的"历史已完工"修正单独提交在 2b（见 D8），不进本 change。

## 八条硬纪律对照

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守。问题记录 `install.window.issue`、维修单 `install.repair.submitted` 都在 `AuditLog`；预约用既有 `status / completedAt`；通知在 `Notification` |
| 2 | 出站先审批 | 不涉及。维修单是内部流程，不给客户发任何邮件 / 短信（返修时间确认邮件列入 Out of scope，将来也须走审批） |
| 3 | 禁止第三套队列 | 不涉及。全部在请求内同步；逾期提醒留到 2e 挂既有 cron |
| 4 | 脱敏 | 不涉及 Muse。新增 SHALL NOT：维修单接口 / 页面 / 打印版 / 通知 / 状态卡不出任何金额；状态卡另不出照片、描述、表头电话与备注 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及（不发邮件） |
| 7 | 确定性优先 | 遵守。问题类型 → 是否需工厂、目标日、单号、`installStage`、文案全部查表 / 日期计算；无 LLM |
| 8 | 测试注册 | 遵守。`repair.test.ts`、`stage.test.ts`、`repair-db.isolated.test.ts` 同 task 注册 `scripts/test-all.sh` |

## Decisions

### D1 问题记录与收口记录同目标，单元状态取最新一条
`install.window.issue` 用与完工照相同的目标类型与目标（`blinds_order_item` / `blinds_order_unit` + `logTargetId`），聚合时两种动作一起读，按时间取最新：收口 → 已收口；问题 → 有问题。现场修好后再拍完工照即恢复，不需要"撤销问题"接口。工艺参数单元沿用 2a 的位置快照比对。
- 否决：给单元加问题状态字段或新表——违反零 schema。
- 否决：完工照与问题并存、都显示——同一单元同时"已收口"又"有问题"，底部按钮无法判定。

### D2 维修单的行由服务端按"有问题"单元生成
提交接口只收表头（客户名、电话、备注、期望日、是否已确认），行从当前聚合里状态为"有问题"的单元按序号生成，带最新问题记录的类型 / 描述 / 是否需工厂与"本次有问题以来"的全部问题照。
- 否决：客户端传行——可能与现场标记不一致，也能绕过"每行必须有照片"。
- 否决：允许不绑定单元的自由行——无法定位品类与出单岗（列入 Out of scope）。

### D3 维修单 = 一条审计记录，id 即审计行 id
`AuditLog(install.repair.submitted, targetType=blinds_order, targetId=工艺单 id)`，`afterData` 存表头、行、单号、序号 n、预约 id、填写日、期望日、目标日、是否已确认。维修单 id（URL 用）= 审计行 id；单号 `R-<工艺单号>-<n>`，n = 该工艺单已有维修单条数 + 1。
- 否决：新表——违反零 schema。
- 否决：用预约 id 当维修单 id——2e 的二次安装会在同一工艺单上产生新预约与新维修单，预约 id 不是维修单的稳定身份。

### D4 提交即完成本次预约，工艺单不动
事务内把预约置 completed（`completedAt`），写 `install.task.completed`（`outcome: "needs_repair"`、单号、`orderStatus` 不变）；工艺单保持 `scheduled`，不写 `OrderStatusLog`。
- 否决：工艺单退回 `ready` / 新增"返修中"状态——要改状态机与 PERM-3 的品类推进规则。
- 否决：工艺单推到 `installed`——会直接进 2b 的"待收尾款"，与"没装完不收尾款"相反。

### D5 并发与幂等：按预约加锁
`pg_advisory_xact_lock(hashtext('install-repair:<预约 id>'))` 后在事务内查同一预约已有的维修单：有 → 返回它（200，`idempotent: true`，不发通知）；无 → 计数 n、写维修单与预约完成。预约已因完成收口而完成（有 `install.task.completed` 但没有维修单）→ 409。通知在事务提交后发，`sourceKey = install_repair_submitted:<维修单 id>:<收件人>`。
- 否决：只看预约状态判断重复——两个请求同时读到"未完成"会各写一张维修单。

### D6 目标日：企业时区当天 + 7 个日历日
填写日 = `todayInTimeZone(企业时区)`；目标日 = 期望日 ?? 填写日 + 7（Q8 拍板：日历日）；期望日须在 [填写日, 填写日 + 365]。
- 否决：5 个工作日——Q8 已拍板日历日，且节假日表不在系统内。

### D7 通知：按键取并集，按收件人决定落点
收件人 = 需工厂行品类的 `orders.fulfillment.update.<品类>` 持有者（需工厂行品类为空 → 三个品类键持有者）∪ `install.task.assign` 持有者 ∪ `install.balance.confirm` 持有者，减去提交人；这些人实体为 `install_repair`（→ `/install/repairs/<维修单 id>`，他们都持 `install.task.read` ORG）。工艺单创建人不在集合里时单独发一条，实体 `blinds_order`（→ `/blinds-orders/<id>` 状态卡）。落点进 `installNotificationHref`，测试断言头部与通知页都经过它。
- 否决：给销售也链到维修单详情——销售没有 `install.task.read`，点进去 403（"点不上"）。
- 否决：只通知出单岗——运营 / 会计 / 销售都要知道"没装完"。

### D8 `installStage` 纯函数；历史手工完工不算待收尾款（2026-10-28 Lucas 拍板）
输入：工艺单状态、是否有尾款确认记录、当前安装预约是否有完成收口记录（`install.task.completed`，目标为该预约，结果不是 `needs_repair`）、未关闭维修单（2d 内：所有已提交的）及其是否含需工厂行。查表见 spec「安装阶段推导」。已完工但当前预约没有完成收口记录 → `closed`（销售文案"已完工"），避免上线时历史手工完工单全部变成"待收尾款"。2b 的"待收尾款"列表必须用同一规则，作为 2b 的修正单独提交（2b 尚未开 PR），本 change 只在 `installStage` 里实现并在 2b 修正后复用同一判定。
- 否决：已完工无记录一律算待收尾款（2b 现状）——上线当天会计列表被历史单淹没。
- 否决：只算已安装——出单手工推到已完工的单会从待收尾款消失。

### D9 打印版抬头取质保设置的公司名与地址
复用 2c 的 `sunnyWarranty.contact`（未保存时为种子：Sunny Shutter Inc / 2-680 Progress Avenue, Scarborough, ON M1H 3A5），大写输出；行数不足 10 补空行。打印走浏览器 `window.print()` 与打印样式，不生成 PDF。
- 否决：抬头写死常量——公司名 / 地址改了要改两处。
- 否决：服务端生成 PDF——需要 Chromium，本地与 CI 已知不稳定（报价 PDF 测试长期环境性失败）。

### D10 销售状态卡用独立接口
`GET /api/blinds-orders/{id}/install-status` 用与工艺单详情相同的读权（`blindsOrderAccess().canRead`，否则 404），只输出阶段、文案与返修摘要。
- 否决：把阶段塞进 `GET /api/blinds-orders/{id}`——该接口给出单编辑页与导出用，加字段会扩大其职责与响应体。

### D11 不加新权限键
标记问题 = `install.window.complete`，提交维修单 = `install.task.update`（与完成收口一致，被分配人或 ORG），读维修单 = `install.task.read`（ORG）。
- 否决：新增 `install.repair.submit`——与 `install.task.update` 的持有人完全相同，只增加岗位模板维护成本。

### D12 问题照用既有私有前缀与单元目录
存 `install-photos/{orgId}/{orderId}/{单元 id}/{时间戳}.{ext}`，文件代理既有规则（被分配人 / `install.photo.read` ORG）直接覆盖；出单岗持 `install.photo.read`（ORG）能看。
- 否决：新前缀 `install-issues/`——要改文件代理的放行规则，扩大本 change 范围。

## Risks / Trade-offs

- [2d 上线后、2e 上线前没有返修闭环：工艺单停在"已排期"、预约已完成，系统里排不了二次安装] → 2d 合并后与 2e 一起发布；若需单独发布，返修排期按线下流程，状态卡持续显示"返修中"直到 2e 关闭维修单。
- [维修单号的 n 依赖审计条数] → 计数在 advisory lock 的事务内完成；同一工艺单两次提交来自不同预约，锁键按预约，二者仍可能并发——再加一把按工艺单的锁（`install-repair-order:<工艺单 id>`）包住计数。
- [AuditLog 继续承载业务记录] → `install.window.issue`、`install.repair.*` 已在任务书 §7 不可清理清单。
- [提交后出单改了工艺参数位置] → 维修单行保存提交时的位置快照，详情 / 打印显示快照，不随参数变化。
- [通知量：老板同时持 `install.task.assign` 与 `install.balance.confirm`] → 按收件人去重，每张维修单每人一条。

## Migration Plan

无数据迁移。上线顺序：2b（含历史已完工修正）→ 2c → 2d 与 2e 同批。回滚：回退代码即可；已写入的 `install.window.issue` / `install.repair.submitted` 审计不影响旧代码（旧聚合只读 `install.window.completed`，有问题的单元在旧代码里显示为"未收口"或"已收口"取决于是否有完工照）。

## 验证方式

| 项 | 命令 / 产物 |
|---|---|
| 问题类型表、入参校验、目标日、单号、补行、记录解析 | `npx tsx src/lib/install/__tests__/repair.test.ts` |
| `installStage` 与文案（含历史手工完工） | `npx tsx src/lib/install/__tests__/stage.test.ts` |
| 聚合：收口后标问题 / 问题后补拍 | `npx tsx src/lib/install/__tests__/closeout-units.test.ts` |
| 通知落点 | `npx tsx src/lib/install/__tests__/balance.test.ts` |
| 隔离库 + 真实路由：标记问题、提交条件与效果、幂等与并发、通知收件人与落点权限、列表 / 详情权限、状态卡、不输出金额 | `DATABASE_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/install/__tests__/repair-db.isolated.test.ts` |
| 浏览器走查（安装工 → 出单 → 运营 → 会计 → 销售） | 本地 `next dev`（`QINGYAN_ALLOWED_DB_ENDPOINT_PREFIXES=127`）+ Playwright，截图 `docs/install-2d-screenshots/` |
| 门禁 | `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate install-2d-repair-form --strict` |
