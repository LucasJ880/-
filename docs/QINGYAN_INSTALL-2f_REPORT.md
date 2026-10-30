# INSTALL-2f 报告 — 维修单的例外出口：作废 / 关闭不返修 + 逾期提醒

change：`openspec/changes/install-2f-repair-close/`（proposal / specs：`installation/repairs` 新增 6 条、修改「维修单的进度与可执行操作」/ design D1–D8 / tasks 8/8）
方案：`docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §4.7、§6「维修单逾期」行、§7、§9 INSTALL-2f 行
零 schema：作废 / 关闭不返修写 `AuditLog(install.repair.completed)`，原因 `voided` / `waived`；预约只改既有 `status / completedAt / cancelReason`；工艺单只改既有 `appointmentId / installDate / expectedInstallDate` 与状态机内的 `scheduled → installed`；逾期提醒挂既有 `/api/cron/daily-brief`。不加权限键，不建审批，不对外发送，不新增 LLM 调用。

## 1. 做了什么

| 场景 | 2e 之后 | 现在 |
|---|---|---|
| 安装工提交错了维修单 | 没法撤回；首装任务已完成，工艺单停在"已排期"，没有任务能把它推到已安装 | 运营 / 会计 / 老板在维修单详情点「作废维修单」，必须填原因 → 维修单"已作废"；已排的返修预约自动取消；首装任务重新打开（回到已排期），工艺单指回它 |
| 作废后安装工 | — | 收到"维修单已作废"→ 直接落到首装任务；任务页写明"维修单 R-… 已作废：<原因>。请重新处理各窗后完成收口"；补拍后完成收口 → 已安装 → 会计待收尾款；仍有问题再提交 → 新单号 R-…-2 |
| 客户接受现状、不修了 | 只能等返修完成，工艺单永远进不了待收尾款 | 「关闭不返修」，必须填原因 → 维修单关闭；已排的返修预约取消；工艺单"已排期 → 已安装"（状态日志"关闭不返修（R-…）"）→ 2b 完工通知 → 会计「待收尾款」→ 尾款确认 → 2c 质保邮件 |
| 返修时提交的维修单（R-…-2） | — | 不能作废（409 `RETURN_VISIT`，页面不显示该按钮），可以关闭不返修 |
| 谁知道 | — | 新类型 `install_repair_closed`：提交时的收件人（相关品类出单岗、运营、会计、老板）→ 维修单详情；销售 → 工艺单详情；重新打开任务的安装工、被取消返修预约的安装工 → 各自任务页；操作人不收；**通知不带原因说明**（自由文本可能写进金额） |
| 维修单详情 | 关闭只有"返修已完成 / 转入" | 横幅写明"已作废 / 关闭不返修：<原因> · <操作人>（时间）"；返修排期卡标"已取消"；出单卡对已关闭单显示"未登记（维修单已关闭）"；按钮只按接口返回的可执行操作显示 |
| 维修单列表 | — | 进度列显示"已作废""关闭不返修"；已关闭的不标已过目标日 |
| 过了目标日没人管 | 系统不提醒 | 每天企业当地 07:00（每日简报定时任务里的一步）：目标日已过、未关闭、且没有今天或以后返修安排的维修单 → 运营 / 会计 / 老板（维修单详情）与销售（工艺单详情）各一条"返修逾期：…"，写明已过几天与卡点（待登记出单：Vinyl / 未排返修 / 返修日 X 已过仍未收口）；同一单同一人一天一条 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/install/repair.ts` | 关闭原因四种（`CLOSE_REASON_LABEL`）与原因说明；`isReturnVisitRepair`；`repairActions` 加 `canVoid / canClose`（需传维修单情形）；`voidDecision` / `closeDecision`；`validateCloseReason`；`overdueReminder` / `overdueSummary` / `daysBetween`；两个通知类型常量 |
| `src/lib/install/repair-service.ts` | `closeRepair`（作废 / 关闭不返修，按工艺单加锁复核）、`notifyRepairClosed`、`remindOverdueRepairs`；`loadRepairForAppointment` 与提交维修单幂等查找跳过已作废；`loadVoidedRepairForAppointment`；`repairContextOf`；`completeReturnVisit` 锁内复核预约已取消 / 维修单已关闭；序列化带关闭原因、原因说明、操作人、返修预约是否取消 |
| 路由（新） | `POST /api/install/repairs/[id]/void`、`POST /api/install/repairs/[id]/close` |
| 路由（改） | 维修单详情（可执行操作带维修单情形、关闭操作人姓名、返修预约已取消）、列表（关闭原因中文名）、任务详情（已作废维修单提示）、`/api/cron/daily-brief`（每企业加一步逾期提醒，结果字段 `repairOverdueSent`） |
| `src/lib/install/service.ts` | 任务详情带 `voidedRepair` |
| 页面 / 组件 | `repair-pages.tsx`（「处理维修单」区、作废 / 关闭不返修对话框、关闭横幅、取消标记、列表进度）、`install-task-detail.tsx`（已作废提示）、`install-types.ts` |
| 通知登记 | `install_repair_closed`（"维修单作废 / 关闭不返修"，CircleX）、`install_repair_overdue`（"返修逾期提醒"，AlarmClock）：类型表、引入日期 2026-10-29、开关文案、图标；`installNotificationHref` 销售落点 |
| 测试 | `repair.test.ts`（79 → 127）、`balance.test.ts`（50 → 56）；新增 `repair-close-db.isolated.test.ts`（76）并注册 |
| 文档 | 任务书 §4.7（所选定时任务）、§7（关闭原因代替 `.cancelled`） |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/install/__tests__/repair.test.ts` | 127 passed |
| `npx tsx src/lib/install/__tests__/balance.test.ts` | 56 passed |
| 隔离库 + 真实路由 `repair-close-db.isolated.test.ts` | 76 passed（见 §3.1；`/opsx:verify` 后补 [H] 3 条，全量跑时为 73） |
| 2a–2e 隔离库回归 | `closeout-db` 26、`balance-db` 36、`warranty-db` 31、`repair-db` 61、`repair-dispatch-db` 54 全过 |
| 浏览器走查（本地 `next dev` + Playwright：运营主管 → 安装工手机 → 返修安装工手机 → 运营主管 → 会计 → 销售 → 逾期提醒） | 17/17（见 §3.3） |
| `npm run typecheck` | 0 error（沙箱需 `NODE_OPTIONS=--max-old-space-size=8192`） |
| `npx eslint src/components/install src/app/api/install src/lib/install` | 0 error |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | PASS |
| `bash scripts/check-test-registry.sh` | OK（470 注册） |
| `openspec validate install-2f-repair-close --strict` | valid（INFO：`installation/repairs` 目标 spec 尚不存在——由 2d 新建，2f 必须在 2d、2e 归档之后归档） |
| `git diff -- vercel.json src/lib/automation/registry.ts` | 空（不新增 cron 条目 / 自动化登记项） |

### 3.1 隔离库端到端覆盖

- **A 作废（未排返修）**：出单·Vinyl 403；缺原因 400；超过 500 字 400（维修单仍未关闭、预约不变）→ 运营主管作废 200 → 首装预约回到已排期、无完成时间；工艺单仍已排期、不写状态日志；详情"已作废"+ 原因 + 操作人、无可执行操作；销售状态卡阶段 `scheduled`；再作废 / 再关闭 409 `CLOSED`；通知：出单·Vinyl / 会计 / 老板各一条落到维修单详情，出单·布帘不收，操作人不收，销售落到工艺单，小王落到首装任务，均不带原因与金额，且每个收件人都能打开落点页；任务详情带已作废提示、不带维修单摘要 → 补拍 Den 完成收口 → 已安装 → 会计完工通知 + 待收尾款；完成后不带已作废的单、再提交 409；列表"已作废"、不标已过目标日。
- **B 作废（已排返修）+ 并发**：两个请求同时作废 → 一个 200、一个 409 `CLOSED`，只有一条关闭记录；返修预约已取消（写明维修单号）、详情标"已取消"；首装预约回到已排期；工艺单指回首装预约、安装日期恢复为首装预约日期；小李的通知落到已取消的返修任务且能打开；已取消的返修任务完成收口 409；作废后再提交 → `R-…-2`（不返回已作废的单）。
- **C 关闭不返修（已排返修）**：出单·Vinyl 403、缺原因 400 → 200；返修预约取消；工艺单 installed 并指回首装预约；状态日志"关闭不返修（R-…）"不含原因；会计完工通知 + 待收尾款；阶段 `awaiting_balance`、销售"已装完，收尾款"；详情"关闭不返修"+ 原因；再关闭 409；通知（小李 / 出单·Vinyl / 销售）不带原因；已取消的返修任务完成收口 409、预约仍为已取消（`completeReturnVisit` 锁内复核）。
- **D 关闭不返修（未排返修）**：200 → 已安装，没有新预约。
- **E 返修中提交的**：可执行操作有关闭不返修、没有作废；作废 409 `RETURN_VISIT`；出单·Vinyl / 布帘 / Roller、运营主管、会计 × 作废 / 关闭不返修各用一张新单：可执行操作列出 ⇔ 接口 2xx（10 组）。
- **H 拒绝分支**：他企业的运营主管作废 / 关闭不返修 → 404；工艺单已取消 → 作废与关闭不返修都 409 `ORDER_STATUS`；提交维修单的那次预约已取消 → 作废 409 `ORDER_STATUS`；都不写关闭记录、预约不变。
- **F 逾期提醒**：daily-brief 路由对每个企业调用；把"今天"推后 10 天：未排返修的单 → 运营 / 会计 / 老板各一条（维修单详情）、销售一条（工艺单详情），内容"已过 3 天""待登记出单：Vinyl"、无金额；返修排在之后 → 不提醒；返修日已过仍未收口 → 提醒；已作废 / 关闭不返修 / 转入新单 → 不提醒；同一天再跑每人仍一条；第二天再跑每人新增一条（已过 4 天）；落点能打开。

### 3.2 全量 `npm test`

隔离库、`NODE_OPTIONS=--max-old-space-size=8192`：**480/489**（2e 时 479/488，+1 为本 change 新注册的 `repair-close-db.isolated`）。9 个失败与 2a–2e 报告记录的同一批环境性失败完全一致、与本 change 无关：Mention Gateway M2-A Identity DB（`prisma db push` 不建迁移里的 CHECK 约束）、`sunny-process/autogen-db.isolated`（`NO_BINDING`）、Phase3A-3 Approvals Smoke、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Phase3A-5 Overview Acceptance、Autopilot A2-P0、T4 授标情报矩阵、报价 PDF 分页（无 Chromium 字体）。套件内类型检查与测试注册校验（470）通过；INSTALL-1 / 2a–2f 全部安装测试 0 失败（`repair-close-db.isolated` 73）。

### 3.3 浏览器走查

| # | 谁 | 步骤 | 结果 |
|---|---|---|---|
| 0 | 接口 | V / W / X 三张单首装各提交维修单；V 排小李返修 | 3 张 R-…-1 |
| 1 | 运营主管 | V 详情 →「处理维修单」→ 作废维修单 | 对话框写明首装任务重新打开、返修预约（11/4 14:00）会取消、原因不进通知；不填原因不能提交；作废后横幅"已作废：Den 标错了，实际没问题 · Demo Ops Lead"，返修排期"已取消"，没有任何操作按钮 |
| 2 | 安装工小王（手机） | 点铃铛"维修单已作废" | 落到首装任务，提示"维修单 R-… 已作废：Den 标错了…" |
| 3 | 小王 | 给 Den 补拍完工照 → 完成收口 | 收口完成 |
| 4 | 返修安装工小李（手机） | 点铃铛"返修任务已取消" | 落到已取消的返修任务 |
| 5 | 运营主管 | W 详情 → 关闭不返修 | 对话框写明进入会计待收尾款；关闭后提示"工艺单转已安装、进入会计待收尾款"，横幅"关闭不返修：客户接受色差…"，没有操作按钮 |
| 6 | 会计 | 「待收尾款」 | V（作废后补完收口）与 W（关闭不返修）都在 |
| 7 | 销售 | W 工艺单详情 | 状态卡"已装完，收尾款" |
| 8 | 运营主管 | 返修单列表 | 进度列"已作废""关闭不返修" |
| 9 | 运营主管 / 销售 | 逾期提醒跑一次后点铃铛"返修逾期" | 只提醒 X；运营主管落到维修单详情，销售落到工艺单详情，无金额 |

截图：`docs/install-2f-screenshots/01-voided.png` … `09-overdue-landing.png`。

走查与自审中发现并修正：
- 作废 / 关闭不返修后，返修排期卡仍显示原时间与安装工，看不出已取消；出单卡对已关闭单仍以橙色"待登记"提示——改为排期卡标"已取消"、出单卡显示"未登记（维修单已关闭）"并灰显（详情接口另给返修预约是否已取消，隔离库断言）。
- 隔离库逾期场景 F3 起初偶发不过：测试按 UTC 日期构造返修时间，傍晚时与企业时区（多伦多）日期差一天，返修日正好落在"今天"而不提醒——代码行为正确，测试两边各留一天余量。
- 开 PR 前复跑时（多伦多刚过零点、+10 天又跨过 11/1 夏令时结束）"已过 3 天"算成 2 天：测试把"推后的今天"按 `Date.now() + 10 天` 取。改为企业时区今天 +10 天的 17:00Z，与运行时刻无关；代码不变。

## 4. 判断点（审核请重点看）

1. **关闭沿用 `install.repair.completed`，原因扩为四种**（D1）：所有"是否未关闭"的读点不改，不会出现某处漏读作废导致单子卡住；任务书 §7 已改。
2. **作废 = 重新打开提交维修单的那次预约**（D2）：返修时提交的单不能作废（重新打开要连带撤销"转入"，事件流没有"重新打开"），改用关闭不返修。
3. **关闭不返修直接推进到已安装**（D3）：运营 / 会计没有品类键，不能走状态机手动推；推进后走 2b 完工通知与 2c 质保邮件。
4. **作废恢复的安装日期 = 那次预约的开始时间**：2e 排返修时没存旧值；正常情况下相同。
5. **逾期提醒挂 daily-brief、只提醒没人推进的单**（D6 / D7）：任务书原候选 inspect / followup 都不合适；已排了今天或以后返修的不提醒，列表照常标红已过目标日。
6. **通知不带原因说明**（D8）：原因只在维修单详情与安装工任务页显示。

## 5. 已知限制 / 后续

- 已关闭的维修单不能重新打开（撤销作废 / 撤销关闭不返修）。
- 逾期提醒不发给出单岗、不升级、不能调频率（通知设置里可整类关闭）。
- 关闭不返修不登记减免金额；少收部分在 2b 确认尾款时写差额说明。
- 重新打开的首装预约日期在过去，任务列表按周筛选时可能不在本周；通知直达任务页。
- 归档顺序：2a → 2b → 2c → 2d → 2e → 2f。
