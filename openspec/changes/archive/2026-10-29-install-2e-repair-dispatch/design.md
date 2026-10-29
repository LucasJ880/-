# Design: install-2e-repair-dispatch

## Context

见 proposal.md「Why」。现状（2026-10-28 已读代码，基于 INSTALL-2d 本地头 `078c853`）：
- 维修单 = `AuditLog(install.repair.submitted)`，id = 审计行 id，`afterData` 含行（单元 id、品类、是否需工厂）、预约 id、目标日（`src/lib/install/repair.ts`、`repair-service.ts`）。2d 把"最新一张维修单"视为未关闭（`loadOrderStages`）。
- 安排安装今天只在 `src/app/api/blinds-orders/[id]/transition/route.ts`：`ready/confirmed/in_production → scheduled` 时校验 `install.task.assign` 与"所选人持 `install.task.read`"，在锁内建 `Appointment(type=install)` 并写工艺单 `appointmentId / expectedInstallDate / installDate`。`scheduled → scheduled` 不是合法转换。
- 完成收口 `src/app/api/install/tasks/[id]/complete/route.ts`：按工艺单全部收口单元判定，事务内预约 completed + 工艺单 installed + `OrderStatusLog`，事务后 `notifyInstallCompleted`（2b，`sourceKey` 按单 + 人）。
- 照片代理 `src/app/api/files/[...path]/route.ts` 的 `install-photos` 分支：ORG `install.photo.read` 放行，否则只放行工艺单**当前** `appointmentId` 的被分配人（F5）。
- 出单岗：`fulfillment_vinyl / drapery / shades` 各持 `orders.fulfillment.update.<品类>`（ORG）；伞键 `orders.fulfillment.update` 只给 owner（`role-defaults.ts`、`fulfillment/category.ts`）。
- 安装阶段 `installStage`（`src/lib/install/stage.ts`）只有 `repair_open / repair_ready_to_schedule` 两个返修态，由"含需工厂行"区分。

## Goals / Non-Goals

**Goals:**
- 路径 ② 闭环：维修单 → 出单登记 → 排返修 → 返修收口 → 工艺单已安装 → 2b 待收尾款 → 2c 质保邮件。
- 每个岗位在维修单详情只看到自己能点、点了一定成功的按钮。
- 首次安装与返修的安装工都看得到自己拍的照片。

**Non-Goals:**
- 不改 `src/lib/blinds/order-state-machine.ts`（不加 `scheduled → scheduled`；返修完成用既有 `scheduled → installed`）。
- 不改 `src/app/api/blinds-orders/[id]/transition/route.ts`（排返修走独立接口，只复用其校验口径）。
- 不改 2b / 2c 的接口与页面（返修完成调用既有 `notifyInstallCompleted`）。
- 不做维修单作废 / 关闭不返修、逾期提醒（INSTALL-2f）。
- 不改 `src/lib/muse-bridge/**`、`src/lib/pending-actions/**`。

## 八条硬纪律对照

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守。出单 / 排期 / 关闭是 `AuditLog` 事件；返修预约是既有 `Appointment`；工艺单只写既有 `appointmentId / installDate / expectedInstallDate` 与状态机内的 `scheduled → installed` |
| 2 | 出站先审批 | 不涉及。全部是站内通知，不给客户发任何消息 |
| 3 | 禁止第三套队列 | 不涉及。请求内同步；逾期提醒在 2f 挂既有 cron |
| 4 | 脱敏 | 不涉及 Muse。沿用 2d 的 SHALL NOT：维修单接口 / 页面 / 通知不出金额 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守。维修单进度、待登记品类、安装阶段、可执行操作全是纯函数查表；无 LLM |
| 8 | 测试注册 | 遵守。新增 `repair-dispatch-db.isolated.test.ts` 同 task 注册 |

## Decisions

### D1 维修单进度 = 事件流推导
三类追加式审计，`targetType=blinds_order`、`targetId=工艺单 id`、`afterData.repairId`：`install.repair.factory_issued`（品类、预计备好日、备注）、`install.repair.scheduled`（预约 id、时间、安装工；同一维修单多条时最新一条为准）、`install.repair.completed`（原因 `completed` / `superseded`、转入单号）。纯函数 `repairProgress(record, events)` 给出：已登记 / 待登记品类、预计备好日（各品类最晚）、返修排期、是否关闭。
- 否决：改写维修单审计行——审计是追加式记录，改写会丢历史。
- 否决：新表——违反零 schema。

### D2 出单按品类登记
可登记品类 = 待登记品类 ∩ 调用者持键的品类；伞键可登记全部；品类推不出的需工厂行记为"待确认"品类，任一品类岗或伞键可登记。一次请求登记调用者能登记的全部待登记品类。
- 否决：任一出单岗一次登记整张维修单——出单·Vinyl 会替布帘报"已出单"，布帘件实际没下。
- 否决：逐行登记——同一品类的几行由同一个人同时下单，逐行点没有意义。

### D3 排返修建新预约，改期改同一预约
复用 transition 的校验口径（执行者 `install.task.assign`，所选人 `install.task.read`），在按工艺单加锁的事务内建 `Appointment(type=install)`，工艺单 `appointmentId` 指向它并更新 `installDate / expectedInstallDate`，状态不动；写 `install.repair.scheduled`。已有未完成的返修预约 → 更新该预约时间 / 安装工并再写一条 `install.repair.scheduled`。出单未全部登记或预计备好日晚于所选日 → 照常排，响应带提示（任务书 §4.5）。
- 否决：给状态机加 `scheduled → scheduled`——要改状态机与 PERM-3 规格。
- 否决：把首装预约改回 scheduled 复用——首装的完成时间、照片与"需返修"结果会被覆盖。

### D4 返修预约与任务收口范围
"返修预约" = 某维修单最新一条 `install.repair.scheduled` 指向的预约。服务层统一给出任务收口范围：普通预约 = 工艺单全部收口单元；返修预约 = 该维修单各行 `unitId` 对应的当前单元。列表、详情、完成收口、拍照、标记问题、提交维修单都从这一处取范围；拍照 / 标记问题的单元不在范围内 → 404。
- 否决：给 `Appointment` 加关联字段——违反零 schema。
- 否决：按预约标题前缀判断——标题可被改，不可靠。

### D5 返修完成在完成收口路由里分支
返修预约全部收口 → 事务内（按工艺单加锁）：预约 completed；`install.task.completed`（`outcome: repair_completed`、维修单）；`install.repair.completed`（`completed`）；没有其他未关闭维修单时工艺单 `scheduled → installed`（`installedAt`、状态日志"返修完成"）。事务后调 2b 的 `notifyInstallCompleted`（首装未完成过，所以这是该单第一次完工通知）。阶段推导里"完成收口记录"排除 `needs_repair`，包含 `repair_completed`。
- 否决：另开"完成返修"接口——安装工在两个任务页看到两个不同按钮，且与 2a 的完成收口规则重复。

### D6 返修中再发现问题 = 新维修单 + 原单转入关闭
在返修预约上提交维修单：行只来自返修范围；同一事务内给原维修单写 `install.repair.completed`（`superseded`、转入单号）。新单的出单登记从零开始。
- 否决：在原维修单上追加行——原单的出单登记、目标日与已发通知都对不上新问题。

### D7 照片代理放行任一安装预约的被分配人
放行集合 = 工艺单当前 `appointmentId` ∪ 该单所有维修单的 `appointmentId`（提交时的预约）∪ 所有 `install.repair.scheduled` 的预约；集合里任一预约的被分配人可读。ORG `install.photo.read` 规则不变。
- 否决：放行所有持 `install.task.read` 的安装工——会让安装工看到别人客户家的照片。

### D8 安装阶段加 `repair_scheduled`
`installStage` 的维修单输入改为 `{ pendingFactory: boolean; scheduled: boolean }`；"未关闭维修单" = 最新一张没有 `install.repair.completed` 的。销售文案"<返修日> 再去返修"。
- 否决：已排返修仍显示"返修待排期 / 待出单"——销售最需要的就是"哪天再去"。

### D9 可执行操作与接口共用判定
纯函数 `repairActions(progress, { heldCategoryKeys, umbrella, canAssign })` → `{ issueCategories, canSchedule }`。维修单详情返回它，页面据此显示按钮；两个写接口调用同一函数决定 403 / 409。表驱动测试：岗位 × 操作，列出 ⇔ 2xx（任务书 §10 V1）。
- 否决：页面按岗位名写死按钮——岗位与权限键会漂移。

### D10 新通知类型
`install_repair_factory_issued`、`install_repair_scheduled`，登记进类型表与引入日期；新实体 `install_task` → `/install/<预约 id>`（安装工），沿用 `install_repair` → 维修单详情、`blinds_order` → 工艺单详情。`sourceKey` 带事件（登记 / 排期审计行 id），同一事件同一人一条。
- 否决：复用 `install_repair_submitted`——用户无法分别开关，且落点不同。

### D11 拆出 INSTALL-2f
作废（提交错了：恢复首装预约）与关闭不返修（客户接受现状：直接转已安装）、逾期提醒（挂既有每日 cron）放进 2f；2d + 2e 已构成完整闭环，可同批上线。
- 否决：塞进 2e——超过 8 条 task（纪律：超过即拆）。

## Risks / Trade-offs

- [出单未登记就排返修，安装工上门发现件没到] → 排返修响应与维修单详情都显示"出单尚未登记 / 预计 X 日备好"，由排安装的人决定。
- [同一工艺单两张维修单同时操作] → 出单登记、排返修、返修完成、提交维修单都在 `install-repair-order:<工艺单 id>` 锁内重读进度再写。
- [改期只改预约时间，不撤回已发的排期通知] → 改期再发一条排期通知（新审计行 id），安装工与销售以最新一条为准。
- [2b 完工通知按单去重] → 首装提交了维修单，没有触发过完工通知，返修完成是第一次；同一单再次返修完成（极少）不会再通知，会计列表照常显示。
- [归档顺序] → `installation/repairs`、`installation/install-stage` 由 2d 新建；本 change 必须在 2d 归档之后归档（`openspec validate` 提示：目标 spec 不存在时只允许 ADDED）。

## Migration Plan

无数据迁移。上线顺序：2b（含 Q11 修正）→ 2c → 2d 与 2e 同批 → 2f。回滚：回退代码；已写入的 `install.repair.*` 审计与返修预约留存，旧代码把返修预约当普通安装任务（按全部单元收口）。

## 验证方式

| 项 | 命令 / 产物 |
|---|---|
| 维修单进度、待登记品类、可执行操作 | `npx tsx src/lib/install/__tests__/repair.test.ts` |
| 安装阶段（出单登记、已排返修、返修完成） | `npx tsx src/lib/install/__tests__/stage.test.ts` |
| 通知落点（`install_task`、两个新类型） | `npx tsx src/lib/install/__tests__/balance.test.ts` |
| 隔离库全链路：首装 2 ✅ 1 ⚠ → 出单（按品类）→ 排返修 / 改期 → 返修范围 → 返修收口 → 已安装 → 会计确认尾款 → 质保审批；返修中再发现问题；照片代理；可执行操作 ⇔ 接口 | `DATABASE_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/install/__tests__/repair-dispatch-db.isolated.test.ts` |
| 2a–2d 回归 | `closeout-db` / `balance-db` / `warranty-db` / `repair-db` 隔离库测试 |
| 浏览器走查（出单 → 运营 → 返修安装工 → 销售 → 会计） | 本地 `next dev`（`QINGYAN_ALLOWED_DB_ENDPOINT_PREFIXES=127`）+ Playwright，截图 `docs/install-2e-screenshots/` |
| 门禁 | `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate install-2e-repair-dispatch --strict` |
