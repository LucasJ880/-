# Design: install-2f-repair-close

## Context

见 proposal.md「Why」。现状（2026-10-29 已读代码，基于 INSTALL-2e 本地头 `bc01286`）：
- 维修单 = `AuditLog(install.repair.submitted)`，`afterData.appointmentId` 是提交它的那次安装预约。生命周期事件 `install.repair.factory_issued / .scheduled / .completed` 由纯函数 `repairProgress` 推导进度；第一条 `install.repair.completed` 即关闭，原因只有 `completed` / `superseded`（`src/lib/install/repair.ts`）。
- "未关闭"在四处被读：`latestOpenRepair`（安装阶段、销售状态卡、会计列表）、`completeReturnVisit` 的"其他未关闭维修单"、`issueDecision` / `repairActions`、`scheduleRepair` 的锁内复核（`src/lib/install/repair-service.ts`）。
- 提交维修单把那次预约置为 `completed` 并写 `install.task.completed`（`needs_repair`），工艺单保持 `scheduled`；按预约找维修单的两处（`loadRepairForAppointment`、事务内 `findRepairRow`）只按 `appointmentId` 匹配，不看是否关闭。
- 排返修改写工艺单 `appointmentId / expectedInstallDate / installDate`，不保存旧值。
- `completeReturnVisit` 锁内只判"预约已 completed → 幂等"，没有复核预约是否已取消、维修单是否已关闭。
- 每日定时任务：`/api/cron/inspect`（UTC 08:00，按项目跑 LLM 巡检流程，`maxDuration` 60）；`/api/cron/followup`（每小时唤醒，企业当地 09:00 / 14:00，跑外贸跟进，自动化登记为 `trade-followup`）；`/api/cron/daily-brief`（每小时唤醒，企业当地 07:00，每个企业依次跑展会小结 / 老板询盘早报 / 简报，各自 try/catch，`maxDuration` 300）。`vercel.json` 不改。
- 通知：`notifyInstallUser` 的 `sourceKey = <类型>:<实体 id 或工艺单 id>:<收件人>[:dedupeKey]`；落点由实体类型决定（`installNotificationHref`）。

## Goals / Non-Goals

**Goals:**
- 维修单的两个例外出口（提交错了、客户不修了）各一步完成，之后工艺单回到正常路径（重新收口 / 待收尾款）。
- 每个过了目标日、没人推进的维修单，排安装的人与销售每天早上都看到一条，点进去能处理。
- 作废 / 关闭不返修的按钮与接口同一判定，沿用 2e 的"列出 ⇔ 2xx"。

**Non-Goals:**
- 不改 `src/lib/blinds/order-state-machine.ts`（关闭不返修用既有 `scheduled → installed`）。
- 不改 `src/app/api/blinds-orders/[id]/transition/route.ts`、`src/lib/install/stage.ts`（作废 / 关闭不返修后"无未关闭维修单"，阶段按 2e 既有规则得出 `scheduled` / `awaiting_balance`）。
- 不改 `vercel.json`、`src/lib/automation/registry.ts`（不加 cron 条目、不加自动化登记项）。
- 不改 2b / 2c 的接口与页面（关闭不返修调用既有 `notifyInstallCompleted`）。
- 不改 `src/lib/muse-bridge/**`、`src/lib/pending-actions/**`、`src/app/api/files/[...path]/route.ts`。

## 八条硬纪律对照

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守。作废 / 关闭不返修是 `AuditLog(install.repair.completed)` 的两个新原因；预约只改既有 `status / completedAt / cancelReason`；工艺单只改既有 `appointmentId / installDate / expectedInstallDate` 与状态机内的 `scheduled → installed` |
| 2 | 出站先审批 | 不涉及。全部是站内通知，不给客户发任何消息 |
| 3 | 禁止第三套队列 | **触碰**：逾期提醒挂在既有 `/api/cron/daily-brief` 的每企业循环里，不新增 cron 条目、scheduler、队列或自动化登记项（D6） |
| 4 | 脱敏 | 不涉及 Muse。沿用 2d 的 SHALL NOT：通知不出金额；另外通知不带作废 / 关闭的原因说明（自由文本，D8） |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守。作废 / 关闭判定、可执行操作、逾期选择全是纯函数；无 LLM |
| 8 | 测试注册 | 遵守。新增 `repair-close-db.isolated.test.ts` 同 task 注册 |

## Decisions

### D1 关闭沿用 `install.repair.completed`，原因扩为四种
原因 `completed`（返修完成）/ `superseded`（转入新单）/ `voided`（已作废）/ `waived`（关闭不返修）；后两种另带 `note`（原因说明）与被取消 / 重新打开的预约 id。`repairProgress` 的关闭情况加 `note`，四处"未关闭"读点一行不改。
- 否决：新动作 `install.repair.cancelled`（任务书 §7 原写法）——四处读点都要加，漏一处就会出现"已作废的单仍挡住返修完成 / 仍在待排期"；任务书 §7 在 4.1 改为记录本决定。
- 否决：改写维修单审计行打标记——审计是追加式记录，且在不可清理清单里。

### D2 作废 = 重新打开提交维修单的那次预约
锁内：复核未关闭、不是返修预约上提交的、工艺单为已排期、该预约未取消 → 写关闭事件（`voided`）→ 有未完成的返修预约则置 `cancelled`（`cancelReason`"维修单 R-… 已作废"）→ 该次预约 `completed → scheduled`、清 `completedAt` → 排过返修时工艺单 `appointmentId` 指回它、安装日期取它的开始时间。安装工随后按正常收口（全部已收口 → 已安装；仍有问题 → 新维修单）。
- 否决：只关闭维修单、不动预约——预约已完成、工艺单已排期，没有任何任务能把它推到已安装，单子卡死。
- 否决：新建一条预约——要重新选人选时间，且首装的照片与收口记录落在旧预约上。
- 否决：允许作废返修预约上提交的单——那次预约的收口范围来自被它"转入"关闭的上一张单，重新打开要连带撤销那次 superseded，事件流没有"重新打开"；这种情况用关闭不返修（409 `RETURN_VISIT` 提示）。

### D3 关闭不返修 = 取消返修预约 + 指回提交预约 + 推进到已安装
锁内：复核未关闭、工艺单为已排期 → 写关闭事件（`waived`）→ 取消未完成的返修预约 → 排过返修时工艺单指回提交维修单的那次预约 → 无其他未关闭维修单时 `scheduled → installed`（`installedAt`、状态日志"关闭不返修（R-…）"，不写原因说明）。事务后调 `notifyInstallCompleted`。
- 否决：工艺单当前预约留在已取消的返修预约上——会计列表与任务页显示一条已取消的预约为"当前安装"。
- 否决：把返修预约标为已完成——没有照片的"完成"会进 2b"有完成收口记录"的判断。
- 否决：关闭不返修不推进工艺单、让人去状态机手动推——推进 `installed` 要品类键，会计 / 运营没有（PERM-3），又卡死。

### D4 已作废的维修单不再代表"那次预约的维修单"
`loadRepairForAppointment` 与提交维修单的幂等查找跳过关闭原因为 `voided` 的维修单（取同一预约上最新一张未作废的）。任务详情另给"已作废维修单"（单号、原因说明），仅在任务未完成时出现。
- 否决：作废时删除 / 改写原审计行——同 D1。
- 否决：只靠通知告诉安装工——从任务列表进来的安装工看不到原因，可能原样再提交一次。

### D5 可执行操作扩展，与写接口同一判定
`repairActions` 加 `canVoid`（持 `install.task.assign`、未关闭、不是返修预约上提交的）与 `canClose`（持键、未关闭）；`voidDecision` / `closeDecision` 先判权限再判状态，路由与锁内复核都调用它们。"是不是返修预约上提交的" = 维修单的提交预约是另一张维修单排期指向的预约（纯函数，从事件流算）。2e 的 `completeReturnVisit` 在锁内补一条复核：预约已取消或维修单已关闭 → 409（关闭不返修与返修收口同时发生时不会把已取消的预约改成完成）。
- 否决：页面按工艺单状态自行判断显示——与接口口径分叉，就是"点不上"的来源（任务书 §10 V1）。

### D6 逾期提醒挂 `/api/cron/daily-brief`
在 daily-brief 每个企业的循环里加独立一步（自己的 try/catch，结果字段 `repairOverdueSent`），企业当地 07:00 跑一次。任务书 §4.7 给的候选是 inspect 与 followup，逐个比较后选 daily-brief。
- 否决：`/api/cron/inspect`——UTC 08:00（多伦多凌晨 3–4 点）、按项目而非企业循环、同一 60 秒预算里跑 LLM 巡检。
- 否决：`/api/cron/followup`——一天两个时段要再按小时过滤；运行记录算在 `trade-followup`（客户跟进建议）名下。
- 否决：新 cron 条目 / 新自动化登记项——纪律 3。

### D7 逾期选择规则与去重
纯函数：目标日 < 企业时区今天，未关闭，且（没有排期，或最新排期的返修预约日期 < 今天）。摘要写已过天数与卡点：待登记出单品类 / 未排返修 / 返修日已过未收口。去重 `dedupeKey = <维修单 id>:<企业时区日期>`，一天一条。
- 否决：沿用列表的"已过目标日"口径（目标日已过且未关闭）——已排了下周返修的单会每天提醒，收件人只会把这类通知关掉。
- 否决：用 `Appointment.reminderSentAt` 去重——未排返修的维修单没有预约，且该字段语义是上门前提醒。

### D8 通知收件人
`install_repair_closed`：2d 提交时的收件人（`repairRecipients`）∪ 工艺单创建人 ∪ 重新打开预约的被分配人 ∪ 被取消返修预约的被分配人，去掉操作人；`dedupeKey` = 关闭事件 id。`install_repair_overdue`：持 `install.task.assign` 者 + 工艺单创建人（任务书 §6）。两类都不带原因说明。新类型登记类型表、引入日期 2026-10-29、开关文案、图标。
- 否决：只通知排安装的人——出单岗可能正在下单，安装工的任务被取消 / 重新打开要立刻知道。
- 否决：通知带原因说明——自由文本，可能写进金额（"减免 $50"），违反通知不出金额。

## Risks / Trade-offs

- [作废恢复的安装日期 = 那次预约的开始时间，不是排返修前工艺单上的原值] → 2e 排返修时没存旧值；正常情况下两者相同，手工改过工艺单日期的单会被改回预约时间。
- [重新打开的首装预约日期在过去] → 任务列表按日期筛选时可能不在本周；通知直达 `/install/{预约 id}`，任务详情写明已作废的维修单。
- [关闭不返修时返修安装工正在现场拍照] → 预约取消后完成收口返回 409"任务已取消"，已拍照片留存；排安装的人应先联系安装工再关闭。
- [逾期提醒每天一条可能嫌多] → 只对"没人推进"的单发；类型可在通知设置里单独关闭。
- [归档顺序] → `installation/repairs` 由 2d 新建、2e 增补；本 change 必须在 2d、2e 归档之后归档（validate 的 INFO 提示）。

## Migration Plan

无数据迁移。上线顺序：2d 与 2e 同批 → 2f（可同批）。回滚：回退代码；已写的 `voided / waived` 关闭事件在旧代码里按"已完成"显示、仍视为关闭；重新打开的预约保持已排期，安装工照常收口。

## 验证方式

| 项 | 命令 / 产物 |
|---|---|
| 关闭原因、作废 / 关闭判定、可执行操作、原因校验、逾期选择 | `npx tsx src/lib/install/__tests__/repair.test.ts` |
| 两个新通知类型落点 | `npx tsx src/lib/install/__tests__/balance.test.ts` |
| 隔离库：作废（未排 / 已排 / 并发 / 返修中提交的 409）→ 重新打开任务补完收口 → 已安装；作废后再提交得新单号；关闭不返修 → 已安装 → 会计待收尾款；通知每人点得上；逾期提醒（未排 / 已排明天 / 返修日已过 / 一天一条 / 已关闭）；可执行操作 ⇔ 四个写接口 | `DATABASE_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/install/__tests__/repair-close-db.isolated.test.ts` |
| 2a–2e 回归 | `closeout-db` / `balance-db` / `warranty-db` / `repair-db` / `repair-dispatch-db` 隔离库测试 |
| 页面 | 本地 Playwright：运营主管作废 → 安装工点通知补完收口；运营主管关闭不返修 → 会计待收尾款；截图存 `docs/install-2f-screenshots/` |
