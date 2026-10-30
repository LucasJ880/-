# INSTALL-2e 报告 — 返修调度闭环：出单登记 → 安排返修 → 返修收口 → 接回收尾款

change：`openspec/changes/install-2e-repair-dispatch/`（proposal / specs：`installation/repairs` 新增 7 条要求，改 `installation/install-stage`「安装阶段推导」「阶段文案」、`installation/window-closeout`「完成收口」「照片可见范围」、`installation/install-tasks`「安装任务详情」/ design D1–D11 / tasks 8/8）
方案：`docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §4.4–4.6、§5、§6、§0 F5、§9（2e / 2f 拆分）
零 schema：出单登记 / 排期 / 关闭写 `AuditLog(install.repair.factory_issued / .scheduled / .completed)`；返修预约是既有 `Appointment(type=install)`；工艺单只改既有 `appointmentId`、`installDate / expectedInstallDate` 与状态机内的 `scheduled → installed`。不加权限键，不建审批，不对外发送，不新增 LLM 调用。

## 1. 做了什么

| 场景 | 2d 之后 | 现在 |
|---|---|---|
| 出单 | 收到"返修单 R-…"只能看 | 维修单详情「工厂出单」卡：每个需工厂品类显示 ✓ 已登记（预计备好日 · 登记人 · 备注）或"待登记"；出单岗只看到自己品类的「登记出单（Vinyl）」按钮 → 填预计备好日（≥ 填写日、≤ +365 天）与备注 → 确认已出单 |
| 谁能登记 | — | 持该品类 `orders.fulfillment.update.<品类>` 的只能登记自己的品类；伞键可登记全部；品类推不出的行显示"品类待确认"，持任一品类键都可登记；全部登记后维修单变"返修待排期" |
| 排第二次上门 | 系统里排不了 | 持 `install.task.assign`（运营主管 / 会计）看到「安排返修」→ 选安装工（只列能看安装任务的人）、选时间 → 建一条新的安装预约"返修 — 客户 (单号) R-…"，工艺单指向它（不经状态机）；再点变「改期」，改同一条预约，不新建 |
| 出单没好就排 | — | 照常排，响应与详情提示"出单尚未登记：布帘"或"预计 X 日备好，晚于返修时间" |
| 返修安装工 | — | 收到"返修任务：…"→ 直接落到 `/install/<预约>`；任务卡标"返修 R-… · 只装维修单上的行"，只列维修单上的窗，计数 0 / 1；范围外的窗拍照 / 标问题 404 |
| 返修收口 | — | 全部收口 → 维修单关闭（返修已完成）；没有其他未关闭维修单时工艺单 `scheduled → installed`，状态日志"返修完成（R-…）"，触发 2b 完工通知 → 会计「待收尾款」→ 确认尾款 → 2c 质保邮件待批准 |
| 返修又有问题 | — | 在返修任务上再提交维修单 → R-…-2；原单以"转入 R-…-2"关闭，工艺单仍已排期 |
| 销售状态卡 | 返修中，目标 X 日 | 加"返修已排期：<日期> 再去返修"；返修待出单 / 待排期按出单登记推导；返修完成后"已装完，收尾款" |
| 首装照片 | 照片代理只认当前预约的被分配人（F5） | 放行该工艺单任一安装预约（首装与各次返修）的被分配人；首装安装工换了预约后仍能看自己拍的照片 |
| 维修单列表 | 目标日 / 阶段 | 加"进度"列：待登记品类 / 返修时间 / 已关闭；已关闭的不再算逾期 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/install/repair.ts` | 事件解析 `parseRepairEvent`、`repairProgress`（出单按品类累积、最新排期为准、首个关闭事件关闭）、`repairActions` / `issueDecision`（页面与写接口同一判定）、出单 / 排期入参校验、排期提示、返修预约识别 `returnRepairFor`、收口范围 `scopeUnits` |
| `src/lib/install/stage.ts` | 维修单输入 `{ pendingFactory, scheduled }`；新阶段 `repair_scheduled`（返修已排期）与销售文案"<日期> 再去返修" |
| `src/lib/install/repair-service.ts` | 读事件、阶段改用进度；`issueFactory`、`scheduleRepair`、`completeReturnVisit`（均在 `install-repair-order:<工艺单>` 锁内重读进度再写）；提交维修单在返修预约上 superseded 原单；任务收口范围；照片代理可放行的预约集合；三类通知收件人 |
| `src/lib/install/service.ts` | `loadOrdersForTasks`（预约换绑后仍能找到工艺单）、`scopeCloseout`、任务摘要 / 详情带 `returnRepair` |
| `src/lib/install/balance.ts`、`balance-service.ts` | 落点 `install_task` → `/install/<预约>`；两个新通知类型的落点 |
| 路由（新） | `POST /api/install/repairs/[id]/factory-issued`、`POST /api/install/repairs/[id]/schedule` |
| 路由（改） | 任务列表 / 详情 / 拍照 / 标问题 / 完成收口按收口范围，完成收口在返修预约上走 `completeReturnVisit`；`files/[...path]` 安装照片放行规则；`install-status` 带返修时间与待登记；维修单列表 / 详情带进度与可执行操作 |
| 页面 / 组件 | `repair-pages.tsx`（进度列、出单卡、排期卡、关闭横幅、登记出单 / 安排返修对话框）、`install-task-detail.tsx` / `install-task-list.tsx`（返修标识）、`install-status-card.tsx`、`install-types.ts` |
| 通知登记 | `install_repair_factory_issued`（"返修件已出单"，Package 图标）、`install_repair_scheduled`（"已安排返修"，Calendar 图标）：类型表、引入日期 2026-10-28、开关文案 |
| 测试 | `repair.test.ts`（35 → 79）、`stage.test.ts`（23 → 28）、`closeout-units.test.ts`（41 → 48）、`balance.test.ts`（46 → 50）；新增 `repair-dispatch-db.isolated.test.ts`（54）并注册 `scripts/test-all.sh` |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/install/__tests__/repair.test.ts` | 79 passed |
| `npx tsx src/lib/install/__tests__/stage.test.ts` | 28 passed |
| `closeout-units.test.ts` / `balance.test.ts` | 48 / 50 passed |
| 隔离库 + 真实路由 `repair-dispatch-db.isolated.test.ts` | 54 passed（见 §3.1） |
| 2a–2d 隔离库回归 | `closeout-db` 26、`balance-db` 36、`warranty-db` 31、`repair-db` 61 全过 |
| 浏览器走查（本地 `next dev` + Playwright：安装工手机 → 出单·Vinyl → 运营主管 → 销售 → 返修安装工手机 → 会计 → 销售 / 运营） | 12/12（见 §3.3） |
| `npm run typecheck` | 0 error（本沙箱默认堆会 OOM，需 `NODE_OPTIONS=--max-old-space-size=8192`；与 2c 同一环境问题） |
| `npx eslint src/components/install src/app/api/install src/lib/install` | 0 error（1 条 2b 既有 warning：`balance-db.isolated.test.ts` 的 `q2`） |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | PASS |
| `bash scripts/check-test-registry.sh` | OK（469 注册） |
| `openspec validate install-2e-repair-dispatch --strict` | valid（INFO：`installation/install-stage` 目标 spec 尚不存在——由 2d 新建，2e 必须在 2d 归档之后归档） |

### 3.1 隔离库端到端覆盖

五张工艺单、真实路由、岗位：安装工 ×3（小王 / 小李 / 小张）、出单·Vinyl / 布帘 / Roller、运营主管、会计、老板、销售。

- **A 主链路**：首装 2 ✅ 1 ⚠ → R-…-1，返修待出单、待登记 Vinyl；出单·Vinyl 登记 200 → 无待登记；运营主管（维修单详情）、销售（工艺单详情）收到"返修件已出单"；运营排返修 → 新预约分配给小王、标题含维修单号，工艺单指向它、仍已排期；改期 → 同一条预约改为小李、时间更新，不新建；小李收到"返修任务"（`install_task` → `/install/<预约>`），销售（工艺单）与会计（维修单详情）收到排期通知；销售状态卡"<日期> 再去返修"；返修任务只列 Den、0 / 1、标明返修单号；返修范围外拍照 404；首装任务详情仍可打开（3 个单元、带维修单号）；照片代理小王 200、小李 200、小张 403；返修收口 → 维修单关闭、工艺单 installed、结果 `repair_completed`；会计收到待收尾款、销售收到已装完（2b 完工通知）；会计「待收尾款」出现该单、阶段待收尾款；会计确认尾款 → 质保邮件待批准（路径 ② 接上 2b / 2c）。
- **B 多品类**：Vinyl 登记后仍返修待出单、待登记布帘；出单·Roller（不相关品类）403；Vinyl 再登记 409 `ALREADY_ISSUED`；布帘未登记时排返修 200 + 提示；全部登记后已排返修仍为返修已排期。
- **C 客户原因**：出单 409 `NOT_NEEDED`；排返修无提示。
- **D 返修又有问题**：返修任务提交 → R-…-2；原单关闭"转入 R-…-2"；新单待登记出单、阶段返修待出单；工艺单仍已排期。
- **E 可执行操作 ⇔ 接口**：预计备好日早于填写日 400 且不写记录；出单·Vinyl / 布帘 / Roller、运营主管、会计 × 登记出单 / 安排返修，详情接口"列出"与写接口 2xx 一一对应（出单岗只能登记自己的品类，运营 / 会计能排返修；未列出的一律被拒）；选一位销售当安装工 400 `NOT_INSTALLER`；列表带待登记品类、返修时间、关闭情况；出单 / 排期通知不含金额。

### 3.2 全量 `npm test`

隔离库、`NODE_OPTIONS=--max-old-space-size=8192`：**479/488**（2d 时 478/487，+1 为本 change 新注册的 `repair-dispatch-db.isolated`）。9 个失败与 2a–2d 报告记录的同一批环境性失败完全一致、与本 change 无关：Mention Gateway M2-A Identity DB（`prisma db push` 不建迁移里的 CHECK 约束）、`sunny-process/autogen-db.isolated`（首步 `mark-signed` 即 `NO_BINDING`，后续级联失败）、Phase3A-3 Approvals Smoke、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Phase3A-5 Overview Acceptance、Autopilot A2-P0、T4 授标情报矩阵、报价 PDF 分页（无 Chromium 字体）。套件内 TypeScript 类型检查与测试注册校验（469）通过；INSTALL-1 / 2a–2e 全部安装测试在全量里 0 失败（`repair-dispatch-db.isolated` 54、`repair-db.isolated` 61、`repair` 79、`stage` 28 等）。

### 3.3 浏览器走查

| # | 谁 | 步骤 | 结果 |
|---|---|---|---|
| 0 | 安装工小王（手机） | 首装：Living Room、Kitchen 拍完工照，Den 标"尺寸不符需重做"→ 提交维修单 | R-DEMO2E-…-1 |
| 1 | 出单·Vinyl | 点铃铛"返修单 R-…"→ 维修单详情 | 只有「登记出单（Vinyl）」，没有「安排返修」 |
| 2 | 出单·Vinyl | 登记出单（预计 +4 天，"Vinyl 窗已下单"） | 出单卡"✓ Vinyl：预计 … 备好 · Demo Vinyl Issuer · Vinyl 窗已下单"，按钮消失 |
| 3 | 运营主管 | 点铃铛"返修件已出单"→ 维修单详情 | 只有「安排返修」，没有「登记出单」 |
| 4 | 运营主管 | 安排返修（小王，+6 天 10:00）→ 改期（小李，+7 天 09:00） | 排期卡"11/4 09:00 · 安装工 Demo Installer Li"，按钮变「改期」 |
| 5 | 销售 | 工艺单详情 | 状态卡"返修已排期 · 2026-11-04 再去返修"、单号、Den · 尺寸不符需重做 |
| 6 | 返修安装工小李（手机） | 点铃铛"返修任务：…" | 落到返修任务，标"返修 R-… · 只装维修单上的行"，只列 Den |
| 7 | 小李 | Den 拍完工照 → 完成收口 | "收口完成，工艺单已标记为已安装" |
| 8 | 会计 | 会计「待收尾款」 | 出现该单 |
| 9 | 销售 | 刷新工艺单详情 | 状态卡"已装完，收尾款" |
| 10 | 运营主管 | 刷新维修单详情 | 横幅"维修单已关闭：返修已完成"，出单卡 / 排期卡（已完成）保留，无任何操作按钮 |

截图：`docs/install-2e-screenshots/01-factory-issued.png` … `07-repair-closed.png`。

走查与自审中发现并修正：
- 排返修后工艺单 `appointmentId` 指向返修预约，首装任务按 `appointmentId` 找不到工艺单——加 `loadOrdersForTasks`：按维修单 / 排期审计里的预约 id 回查（首装任务详情仍能打开，见 §3.1 A）。
- 走查脚本最初在接口返回后、页面重载前读卡片内容——改为等待预期文本出现再断言。

走查中销售页偶发一次 React hydration 警告（`Hydration failed …`），连续 3 次重载未复现；2d 走查的 dev 日志里有同一条（2e 代码之前），与本 change 无关。

## 4. 判断点（审核请重点看）

1. **进度由事件流推导**（D1）：出单登记按品类累积，排期以最新一条为准，第一个关闭事件即关闭；不建表、不加状态。
2. **"品类待确认"行**（D2）：任一出单岗都可登记；不登记就一直"待登记"，不会被默认跳过。
3. **出单没好也能排**（D3、Risks）：由排安装的人决定，系统只提示；改期改同一条预约，再发一条排期通知（以最新为准），不撤回旧通知。
4. **返修预约只收口维修单上的行**（D4）：返修安装工看不到、也拍不了首装已收口的窗。
5. **返修完成接回 2b**（D5）：只有在没有其他未关闭维修单时才 `scheduled → installed`；2b 完工通知按单去重，同一单第二次返修完成不再通知，会计列表照常显示。
6. **页面按钮与写接口同一判定**（D9）：`repairActions` 既给详情接口列出操作，也是写接口的前置判定；测试 E 对拍"列出 ⇔ 2xx"。
7. **2d 与 2e 同批上线**：只上 2d 时维修单提交后排不了二次上门，状态卡一直"返修中"。

## 5. 已知限制 / 后续

- 维修单不能作废、不能"关闭不返修"；逾期没有提醒——INSTALL-2f（`install-2f-repair-close`，提醒挂既有每日 cron）。
- 取消返修预约、换地址、日历同步不在范围；改期只改时间与安装工。
- 不给客户发返修时间确认（出站，需另走审批）。
- 维修单列表仍取最近 200 张。
- 归档顺序：2a → 2b → 2c → 2d → 2e（`installation/repairs`、`installation/install-stage` 由 2d 新建）。
