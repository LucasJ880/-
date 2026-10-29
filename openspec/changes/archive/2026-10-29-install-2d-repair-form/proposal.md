# Proposal: install-2d-repair-form

**TASKFLOW：** INSTALL-2d（`docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2 段）；承载方案 `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §1、§4.1–4.3、§5、§6，§12 Q8（默认 7 个日历日）。依赖 INSTALL-2a（收口单元）；2b / 2c 只用到其状态（尾款已确认 / 质保状态）做阶段推导。
**受影响的 Muse 意图：** 无。不改 `src/lib/muse-bridge/**`，不建 PendingAction（维修单是内部流程，不对外发送）。

## Why

装不完的单现在没有出口：安装工只能"完成收口"，有问题的窗无处记录，工厂出单、运营、会计、销售都不知道要返修。纸质维修单（SUNNY SHUTTER INC 抬头）需要数字化，并让每个相关岗位收到能点开的通知。

## What Changes

- 在安装工任务页给每个收口单元增加"⚠ 有问题"：选问题类型、写描述、拍问题照（必填），落审计 `install.window.issue`；同一单元之后再拍完工照即恢复为已收口（以最新一条为准）。
- 新增问题类型表（查表决定是否需工厂出单）：尺寸不符、部件缺失、产品损坏、颜色 / 面料不符、电机 / 遥控 / 充电 → 需工厂；现场条件不具备、客户原因 → 不需；其他 → 安装工选择（默认需工厂）。
- 改收口聚合：单元状态由最新一条收口或问题记录决定（已收口 / 有问题 / 未收口），任务列表与详情增加"有问题"计数与每单元的问题内容。
- 底部按钮按单元状态切换：全部已收口 →「完成收口」；全部处理完且有问题 →「提交维修单」；还有未处理 → 禁用并列出。
- 新增 `POST /api/install/tasks/{id}/repair`：按纸质模板提交维修单（Name、Order#、Taken by、Phone、Notes、逐行 # / Location / Description + 问题类型 + 是否需工厂 + 问题照、Filling Date），加返修时间（客户期望日可选、"已和客户确认"、目标日 = 期望日或填写日 + 7 天）；维修单号 `R-<工艺单号>-<第几张>`；提交即本次预约完成（结果"需返修"），工艺单保持"已排期"，写审计 `install.repair.submitted`。
- 提交后站内通知：涉及品类的出单岗（只算需工厂的行；品类推不出发给三个品类岗）、持 `install.task.assign` 者、持 `install.balance.confirm` 者 → 维修单详情；工艺单创建人（销售）→ 工艺单详情状态卡。通知类型 `install_repair_submitted` 登记，落点进共用落点函数。
- 新增维修单列表 `/install/repairs`、详情 `/install/repairs/{id}`、打印版 `/install/repairs/{id}/print`（纸质版式，至少 10 行），以及 `GET /api/install/repairs`、`GET /api/install/repairs/{id}`，只对持 `install.task.read`（ORG）开放。
- 新增 `installStage` 纯函数（未排期 / 已排期 / 返修待出单 / 返修待排期 / 待收尾款 / 已结清 / 已取消，查表）与 `GET /api/blinds-orders/{id}/install-status`；工艺单详情顶部显示安装状态卡（销售可见，无照片、无金额）。
- 写 `docs/QINGYAN_INSTALL-2d_REPORT.md`，TASKFLOW INSTALL-2d 改 `[G]`。

## Capabilities

### New Capabilities
- `installation/repairs`：问题类型表、标记单元有问题、安装工页面的完成 / 提交二选一、提交维修单（字段、目标日、单号、对预约与工艺单的影响、幂等）、维修单通知与落点、维修单列表 / 详情 / 打印版、不输出的内容。2e 在此能力上补出单、排返修与二次安装。
- `installation/install-stage`：安装阶段推导（一张表，UI / 接口 / 通知共用）与工艺单详情的安装状态卡。

### Modified Capabilities
- `installation/window-closeout`：「收口状态聚合」改为由最新一条收口或问题记录决定单元状态，并增加"有问题"计数（基于 INSTALL-2a 增量后的文本）。
- `installation/install-tasks`：「开始与完成状态」——任务完成除收口流程外，也可经提交维修单完成（结果为需返修）。

## Impact

- 新：`src/lib/install/repair.ts`（纯：问题类型表、问题 / 维修单入参校验、目标日、单号、记录解析）、`src/lib/install/stage.ts`（纯：`installStage` 与各岗位文案）、`src/lib/install/repair-service.ts`；路由 `src/app/api/install/tasks/[id]/items/[itemId]/issue`、`src/app/api/install/tasks/[id]/repair`、`src/app/api/install/repairs/**`、`src/app/api/blinds-orders/[id]/install-status`；页面 `src/app/(main)/install/repairs/**`；组件 `src/components/install/repair-*.tsx`。
- 改：`src/lib/install/closeout.ts` 与 `service.ts`（读问题记录、聚合）、`src/components/install/install-task-detail.tsx`、`install-types.ts`、`install-task-list.tsx`（ORG 范围显示"返修单"入口）、`src/app/(main)/blinds-orders/[id]/page.tsx`（状态卡）、通知类型登记与落点（`src/lib/notifications/*`、`src/components/notification/*`、`src/lib/install/balance.ts` 落点函数）。
- 数据库：零 schema。问题与维修单在 `AuditLog`；照片在既有私有前缀 `install-photos/`；通知在 `Notification`；预约用既有 `Appointment.status / completedAt`。
- 权限：不加新键。标记问题 = `install.window.complete`；提交维修单 = `install.task.update`；列表 / 详情 / 打印 = `install.task.read`（ORG）；状态卡 = 工艺单读权。
- 测试：新增 `src/lib/install/__tests__/repair.test.ts`、`stage.test.ts`、`repair-db.isolated.test.ts`（注册）；`closeout-units.test.ts`、`balance.test.ts` 补断言。

## Out of scope

- 出单「已出单 + 预计备好日」、安排返修（新预约）、二次安装只收口维修行、按访次聚合与照片代理放行任一访次、全部关闭后接回 `installed`、逾期提醒（INSTALL-2e）。
- 撤销 / 作废已提交的维修单（2e 随返修关闭一起做）。
- 不绑定收口单元的自由行（维修单每行对应一个收口单元）。
- 给客户发返修时间确认邮件 / 短信（v2，且须走审批）。
- 自动生成返修工艺单（重做件下料计算）。
- 安装费 / 返修费结算，任何金额展示。
- 给销售开 `/install` 工作区或维修单照片。
