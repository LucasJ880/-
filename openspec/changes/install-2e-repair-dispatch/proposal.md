# Proposal: install-2e-repair-dispatch

**TASKFLOW：** INSTALL-2e（`docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2 段）；承载方案 `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §4.4–4.6、§5、§6、§0 F5。依赖 INSTALL-2b（待收尾款）、INSTALL-2d（维修单）。原 2e 的"维修单作废 / 关闭不返修"与"逾期提醒"超出 8 条 task，拆到 INSTALL-2f。
**受影响的 Muse 意图：** 无。不改 `src/lib/muse-bridge/**`，不建 PendingAction，不对外发送。

## Why

2d 之后维修单提交了就停住：出单没法登记"已出单"，运营排不了第二次上门，二次安装也收不了口，工艺单永远停在"已排期"，钱和质保邮件都走不下去。这条路必须闭环，2d 才能上线。

## What Changes

- 新增出单确认 `POST /api/install/repairs/{id}/factory-issued`（预计备好日、备注）：按品类登记，持该品类修改键的出单岗只能登记自己的品类；全部需工厂品类都登记后维修单变为"待排期"；通知排安装的人与销售。
- 新增安排返修 `POST /api/install/repairs/{id}/schedule`（安装时间、安装工）：持 `install.task.assign` 者为维修单建一条新的安装预约（标题"返修 — 客户 (单号) R-…"），工艺单指向新预约，不经状态机；已排过且未完成时再次提交即改期；出单未完成或预计备好日晚于所选时间时照常排、返回提示；通知安装工、销售、会计。
- 返修预约只收口维修单上的行：任务列表 / 详情 / 完成收口 / 再提交维修单都按这些行计数与判定。
- 返修预约全部收口后：维修单关闭（`install.repair.completed`），没有其他未关闭维修单时工艺单"已排期 → 已安装"，并触发 2b 的完工通知进入会计"待收尾款"。返修时又有问题 → 提交新维修单（第 n 张），原维修单以"转入新单"关闭。
- 安装阶段加"返修已排期"（销售文案"<日期> 再去返修"）；"返修待出单 / 待排期"按出单登记推导。
- 照片代理放行该工艺单任一安装预约（首装与各次返修）的被分配人，修 F5。
- 维修单详情显示出单登记、返修排期与关闭情况，并给出当前用户可做的操作（登记出单 / 安排返修）；页面只显示接口会放行的按钮（同一个判定函数）。
- 写 `docs/QINGYAN_INSTALL-2e_REPORT.md`，TASKFLOW INSTALL-2e 改 `[G]`、新增 INSTALL-2f 行；任务书 §9 补拆分说明。

## Capabilities

### New Capabilities
（无。返修调度写在 2d 新建的 `installation/repairs` 里。）

### Modified Capabilities
- `installation/repairs`（2d 新建，尚未归档）：新增出单确认、安排返修、返修预约的收口范围、返修完成、返修中再发现问题、可执行操作、返修通知的要求。
- `installation/install-stage`（2d 新建，尚未归档）：「安装阶段推导」「阶段文案」加入出单登记与返修排期。
- `installation/window-closeout`：「完成收口」按任务的收口范围判定并在返修预约上关闭维修单（基于 INSTALL-2a 增量后的文本）；「照片可见范围」放行任一安装预约的被分配人。
- `installation/install-tasks`：「安装任务详情」返修预约只返回维修单上的单元（基于 INSTALL-2a 增量后的文本）。

## Impact

- 改：`src/lib/install/repair.ts`（维修单生命周期解析、出单品类、可执行操作）、`src/lib/install/stage.ts`（返修已排期）、`src/lib/install/repair-service.ts`（出单 / 排期 / 关闭 / 任务收口范围）、`src/lib/install/service.ts`（任务收口范围）、`src/app/api/install/tasks/[id]/**`（列表、详情、完成收口、上传、问题、提交维修单按范围）、`src/app/api/files/[...path]/route.ts`（安装照片放行规则）、`src/app/api/install/repairs/**`（新增两个写接口，详情带生命周期与可执行操作）、`src/components/install/*`（维修单详情操作、返修任务标识、状态卡文案）、通知类型登记与落点。
- 数据库：零 schema。出单 / 排期 / 关闭在 `AuditLog(install.repair.factory_issued / .scheduled / .completed)`；返修预约是既有 `Appointment(type=install)`；工艺单只改既有 `appointmentId`、`installDate / expectedInstallDate` 与状态机内的 `scheduled → installed`。
- 权限：不加新键。出单确认 = `orders.fulfillment.update.<品类>`（或伞键）；安排返修 = `install.task.assign`；返修收口沿用 `install.window.complete` / `install.task.update`。
- 测试：`repair.test.ts`、`stage.test.ts`、`closeout-units.test.ts`、`balance.test.ts` 补断言；新增 `repair-dispatch-db.isolated.test.ts`（路径 ② 全链路到会计确认尾款与质保审批）并注册。

## Out of scope

- 维修单作废（提交错了）与"关闭不返修"（INSTALL-2f）。
- 维修单逾期提醒（INSTALL-2f，挂既有每日 cron）。
- 自动生成返修工艺单 / 下料计算；出单"已出单"之外的生产进度跟踪。
- 给客户发返修时间确认邮件 / 短信。
- 改期以外的预约管理（取消返修预约、换客户地址）；日历同步。
- 安装费 / 返修费结算。
