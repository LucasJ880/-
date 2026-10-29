# Proposal: install-2f-repair-close

**TASKFLOW：** INSTALL-2f（`docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2 段）；承载方案 `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §4.7、§6「维修单逾期」行、§9 INSTALL-2f 行。依赖 INSTALL-2e（维修单进度事件流、返修预约）。
**受影响的 Muse 意图：** 无。不改 `src/lib/muse-bridge/**`，不建 PendingAction，不对外发送。

## Why

2e 之后维修单只有"返修完成"和"转入新单"两个出口：安装工提交错了没法撤回，客户接受现状不再返修时工艺单永远停在"已排期"、进不了会计待收尾款；过了目标日没人排也没人收口时，系统不提醒任何人。

## What Changes

- 新增作废维修单 `POST /api/install/repairs/{id}/void`（必填原因）：持 `install.task.assign` 者对未关闭、不是在返修预约上提交的维修单操作。维修单以"已作废"关闭，已排的返修预约取消，提交维修单的那次安装预约重新打开（回到已排期），工艺单当前预约指回它；安装工补完收口后按正常完成收口走到"已安装"。
- 新增关闭不返修 `POST /api/install/repairs/{id}/close`（必填原因）：持 `install.task.assign` 者对未关闭维修单操作。维修单以"关闭不返修"关闭，已排的返修预约取消，没有其他未关闭维修单时工艺单"已排期 → 已安装"（状态日志"关闭不返修（R-…）"），并发出 2b 完工通知进入会计"待收尾款"。
- 作废 / 关闭不返修各发站内通知（新类型 `install_repair_closed`）：维修单提交时的收件人与销售、重新打开任务的安装工、被取消返修预约的安装工；落点按收件人可读的页面。
- 维修单详情与列表显示关闭原因（已完成 / 转入 R-… / 已作废 / 关闭不返修）与原因说明；可执行操作加「作废」「关闭不返修」，与两个写接口同一判定。
- 作废后重新打开的安装任务带"维修单 R-… 已作废"与原因；同一预约再提交维修单生成新单号；任务详情不再带已作废的维修单摘要。
- 新增维修单逾期提醒（新类型 `install_repair_overdue`）：挂在既有每日简报定时任务（`/api/cron/daily-brief`，企业当地 07:00）上，对过了目标日、未关闭、且没有今天或以后的返修安排的维修单，每天提醒持 `install.task.assign` 者（维修单详情）与销售（工艺单详情）一次。
- 写 `docs/QINGYAN_INSTALL-2f_REPORT.md`，TASKFLOW INSTALL-2f 改 `[G]`；任务书 §4.7 记录所选的定时任务。

## Capabilities

### New Capabilities
（无。作废、关闭不返修与逾期提醒写在 2d 新建的 `installation/repairs` 里。）

### Modified Capabilities
- `installation/repairs`（2d 新建、2e 增补，尚未归档）：新增维修单作废、关闭不返修、作废与关闭通知、维修单逾期提醒的要求；修改「维修单的进度与可执行操作」（加关闭原因与两个新操作）。

## Impact

- 改：`src/lib/install/repair.ts`（关闭原因、作废 / 关闭判定与可执行操作、原因校验、逾期提醒选择）、`src/lib/install/repair-service.ts`（作废、关闭不返修、逾期提醒、按预约取维修单时跳过已作废）、`src/app/api/install/repairs/**`（两个新写接口，详情 / 列表带关闭原因与新操作）、`src/app/api/install/tasks/[id]/route.ts`（已作废维修单提示）、`src/app/api/cron/daily-brief/route.ts`（每个企业加一步逾期提醒）、`src/components/install/*`（维修单详情两个操作对话框、关闭横幅、列表进度、任务页作废提示）、通知类型登记。
- 数据库：零 schema。作废 / 关闭不返修写 `AuditLog(install.repair.completed)`（原因 `voided` / `waived`）；预约只改既有 `status / completedAt / cancelReason`；工艺单只改既有 `appointmentId / installDate / expectedInstallDate` 与状态机内的 `scheduled → installed`。
- 权限：不加新键。作废、关闭不返修 = `install.task.assign`（ORG）。
- 定时任务：不新增 cron 条目、不新增自动化登记项；在既有 `daily-brief` 每个企业的循环里加独立的一步。
- 测试：`repair.test.ts`、`balance.test.ts` 补断言；新增 `repair-close-db.isolated.test.ts` 并注册。

## Out of scope

- 已关闭维修单的重新打开（撤销作废 / 撤销关闭不返修）。
- 返修预约以外的预约管理（换地址、日历同步）；作废时不改首装预约的时间与安装工。
- 逾期提醒发给出单岗或客户；逾期升级（第 N 天抄送老板）；提醒频率设置。
- 关闭不返修时的减免 / 退款金额登记（尾款差额沿用 2b 确认尾款时的"差额说明"）。
- 给客户发作废 / 关闭不返修的确认邮件或短信。
