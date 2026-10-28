# INSTALL-2 任务书（方案）：安装结果二分 —— 完工收尾款 + 质保邮件 / 返修单 + 二次安装

| 项 | 值 |
|---|---|
| 编号 | INSTALL-2（权限主线 `docs/QINGYAN_PERMISSION_TASKFLOW.md` 新增段，接 INSTALL-1） |
| 动机 | Lucas（Sunny FDE）2026-10-28：安装后两种结果。① 顺利完成 → 安装工传完工照 → 会计可见 → 会计确认收到尾款 → 客户收到完工 + 质保邮件；② 没完成 → 安装工传完工照 + 未完成照 + 提交维修单（纸质模板见 §4.2）→ 与客户约返修时间（可选，默认 1 周）→ 管理安装的人排第二次安装；工厂出单人收到通知负责出单；会计、销售知道状态（完成 = 收尾款；没完成 = 销售知道哪天再去） |
| 状态 | **已拍板（2026-10-28，Lucas）**："质保以报价单为主，按照你的方案去进行开发"——Q1 = 报价单；其余 Q 采用本文建议（§12 拍板列）。按 §9 逐个 `/opsx:propose` → apply |
| 配套 | 质保邮件模板 `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md`；交接 `docs/QINGYAN_INSTALL-2_HANDOFF.md` |
| 纪律 | `openspec/config.yaml` 八条，逐条对照见 §8 |

---

## 0. 已核实的现状（2026-10-28，main @ 7e2a9a5，逐条对过代码）

| # | 事实 | 位置 |
|---|---|---|
| F1 | 收口 = 每个 `BlindsOrderItem` 至少一张照片；照片落私有 Blob，记录落 `AuditLog(action=install.window.completed, targetType=blinds_order_item)`，补拍追加 | `src/lib/install/closeout.ts:9-14`、`src/app/api/install/tasks/[id]/items/[itemId]/photo/route.ts` |
| F2 | **`allCompleted` 要求窗数 > 0**。只有 Shutters / 窗帘 / 国内下单 / 外采购行的单（这些行在 ProcessSpec JSON 里，不是 `BlindsOrderItem`）窗数 = 0 → "完成收口（还差 0 扇）"按钮**永远禁用**，`/complete` 永远 409 且 `missing` 为空。**这就是"点不上"**，Sunny 的主力产品 Shutters 正好全中 | `closeout.ts:104`、`complete/route.ts:43-54`、`install-task-detail.tsx:229-240`；ProcessSpec 段 `process-spec.ts:94-104` |
| F3 | `/complete` 成功后：预约 → `completed`，工艺单 → `installed` + OrderStatusLog + 审计 `install.task.completed`。**之后没有任何通知、邮件、PendingAction**；也没有任何东西把 `installed` 推到 `completed` | `complete/route.ts:26-116` |
| F4 | 状态机：`scheduled → installed | cancelled`，`installed → completed`；没有"部分完成 / 返修"；一单只有一个 `appointmentId` 槽 | `src/lib/blinds/order-state-machine.ts:44-53`、`prisma/schema.prisma` BlindsOrder `appointmentId` |
| F5 | 收口日志读取**不按预约过滤**（`loadCloseoutLogs` 只按 itemId）；照片代理只放行**当前** `appointmentId` 的被分配人；工艺单"收口"标签只读当前预约 → 第二次安装会把第一次的结果"算作已完成"，且第一次的安装工看不到自己的照片 | `src/lib/install/service.ts:149-161`、`src/app/api/files/[...path]/route.ts:102-124`、`blinds-orders/[id]/page.tsx:201-215` |
| F6 | 尾款：报价有 `agreedBalanceAmount`（Order Form 解析），定金有 `depositCollectedAt` 等字段；**没有"尾款已收"字段、没有收款模型、没有会计写接口**；销售首页"待收尾款"是**本月签单**的尾款合计（`signedAt >= 月初`），是期间统计，不是未收清单 | `prisma/schema.prisma` SalesQuote 定金段、`src/lib/sales/quote-agreed-payment.ts`、`src/lib/sales/home/build-home.ts:239-248,571-577` |
| F7 | 会计岗位 = 只读（`accounting.read` 等）+ INSTALL-1 加的 `install.task.assign/read`、`install.photo.read`；**没有品类修改键**，所以今天会计无法把工艺单从 `installed` 推到 `completed`（规格 `fulfillment/order-category-access` 要求品类键） | `src/lib/authorization/role-defaults.ts:281-297`；`openspec/specs/fulfillment/order-category-access/spec.md`「状态推进按品类」 |
| F8 | 出站审批：`requestApproval()` 建 PendingAction（`idempotencyKey` 必填）→ `POST /api/ai/pending-actions/[id]` 批准 → `executePendingAction` 按 type 分派；批准人 = `approverUserId` / 老板 / org_admin / 超管。现有发信型：`sales.send_inquiry_reply`（组织发件身份 → Resend）。**现有客户邮件（发报价、签字回执）是直发，没走审批** | `src/lib/approval/request.ts:169-197`、`src/lib/pending-actions/executor.ts:166-552`、`src/lib/pending-actions/exec-sales-inquiry-reply.ts:61-86`、`src/lib/marketing/team.ts:81-95` |
| F9 | 现有发信均无附件能力（Gmail / Resend 都是单段 HTML） | `src/lib/google-email.ts:349-363`、`src/lib/trade/email.ts:42-72` |
| F10 | 通知：`createNotification` 以 `sourceKey` 去重；`listUsersWithPermission(orgId, key)` 按岗位键找人。**通知类型注册表 `NOTIFICATION_TYPE_KEYS` 不含 `process_order_generated`**，用户自定义过通知偏好时会被吞——新类型必须注册 | `src/lib/notifications/create.ts`、`src/lib/sales/approvers.ts:10-26`、`src/lib/notifications/constants.ts:2-15` |
| F11 | 会计页签是组件内 `useState`，**不读 URL** → 通知里写 `/accounting?tab=xxx` 点进去不会落到对应页签（又一个"点不上"） | `src/components/accounting/accounting-view.tsx:73` |
| F12 | 报价 PDF / Order Form 上写给客户的质保：帘类 "1 year labour · 5 years fabric · 15 years components"；Shutters "1 year labour / 5 years components"。**与官网检索摘要（Shutters 25 年 / 其他 5 年）不一致**，见 §3.4 | `src/app/(main)/sales/quote-sheet/quote-pdf.ts:99,128,166`、`order-shades.tsx:131`、`order-drapes.tsx:179` |
| F13 | 邮件模板品牌是 "SUNNY HOME & DECO"；维修单抬头是 "SUNNY SHUTTER INC, 2-680 Progress Avenue, Scarborough, ON M1H 3A5" | `src/lib/email/templates.ts:13-26`；用户上传维修单 PDF |
| F14 | 每日既有 cron：`/api/cron/inspect`（08:00）、`/api/cron/followup`（组织本地 09:00 / 14:00）；`Appointment.reminderSentAt` 字段存在但全仓无人使用 | `vercel.json`；schema Appointment |
| F15 | 没有报价详情页（`/sales/quotes` 只有列表）；销售能打开自己创建的工艺单详情 `/blinds-orders/[id]`（PERM-3 读范围：创建人可读；自动生成单的 `creatorId` = 报价创建人） | `src/app/(main)/sales/quotes/page.tsx`；`openspec/specs/fulfillment/order-category-access/spec.md`「工艺单读范围」、`src/lib/sunny-process/autogen.ts` |

---

## 1. 业务流（两条路，一个入口）

```
安装工 /install/[id]  ──逐窗：✅完成(拍完工照)  或  ⚠有问题(拍问题照+选问题类型+描述)──┐
                                                                                       │
              ┌──────────── 全部 ✅ ────────────┐            ┌──────── 任一 ⚠ ────────┐
              ▼                                 │            ▼                         │
     [完成收口] 工艺单 → installed               │   [提交维修单] 预约 → completed(结果=需返修)
              │                                 │   工艺单保持 scheduled（= 未装完）
              ▼                                 │   返修目标日 = 客户期望日 ‖ 填写日+7天
   通知：会计「待收尾款」、销售「已装完，收尾款」  │            │
              │                                 │            ├─ 通知 出单（按品类）：「返修出单」→ [已出单 + 预计备好日]
   会计 /accounting「待收尾款」看照片 → [确认收到尾款]│            ├─ 通知 运营/排安装：「待排返修」→ [安排二次安装]
              │   工艺单 → completed               │            ├─ 通知 会计：「未完工，暂不收尾款」
              ▼                                 │            └─ 通知 销售：「返修中，预计 X 日再去」
   PendingAction「发送完工+质保邮件」(预览)          │                         │
   会计 [批准发送] → 执行器发信 → 客户收到           │            二次安装（只收口维修单上的行）
              │                                 │                         │
   通知：销售「尾款已收、质保已发」                   │   全部 ✅ → 工艺单 installed ──► 回到左边（待收尾款）
                                                │   又有 ⚠ → 再开一张维修单（第 N 次，循环）
```

要点：
- **一个入口、二选一**：安装工不是先选"成功 / 失败"，而是逐窗标记；只要有一扇 ⚠，底部按钮就从"完成收口"变成"提交维修单"。避免安装工在现场选错大分支。
- **工艺单状态机不加状态**：返修期间工艺单保持 `scheduled`（含义"已排期、未装完"），细分状态由审计事件**查表推导**（§5），不让 LLM 判断（纪律 7），也不加字段（纪律 1）。
- **客户邮件只在钱确认之后**：完工 ≠ 发质保；会计确认尾款才建发信审批。返修中不发任何"部分完成"邮件。

---

## 2. 参考：U-HEAL 的做法与可借鉴点

> **需要你确认**：全网和仓库里都没检到 "U-HEAL"。按上下文（"安装后拍照、确认、再发邮件"）我理解为 **U-Haul 的自助还车（24/7 Self Return）**。如果指的是别的产品，告诉我名字或链接，我补这一节；其余设计不依赖它。
> `www.uhaul.com`、`sunnyshutter.ca` 在本会话网络策略里被拒，以下来自检索摘要。

U-Haul 自助还车流程（检索摘要）：App 引导 → 回答里程 / 车况 / 清洁问题 → **报告新损伤必须拍照**，清洁拍 2 张、停车位置拍 1 张 → 提交后**马上收到邮件收据** → **下一个工作日后台核对**，不符再补收费用。差评集中在：App 在照片没传完时就显示"已完成"、上传时崩溃、收据发了两次。

| U-Haul 做法 | 我们怎么用 |
|---|---|
| App 一步步引导，照片是必填证据 | 逐窗卡片；完工照 / 问题照**服务端强制**（不是只在前端禁用按钮），INSTALL-1 已对完工照这样做，INSTALL-2 对问题照同样做 |
| 结构化问题，不只给自由文本 | 问题类型下拉（§4.3），类型决定"要不要工厂出单"——查表，不靠理解描述 |
| 损伤必须拍照 | 每条维修行 ≥ 1 张问题照，否则 409 列出缺照的行 |
| 后台核对后才算最终账单 | 会计看完工照 + 核对尾款后才触发客户邮件；完工本身不发客户邮件 |
| 差评①：照片没传完就显示完成 | 每张照片单独上传、上传成功才显示缩略图（INSTALL-1 已是逐张落库）；提交按钮读服务端状态 |
| 差评②：上传崩溃 / 信号差 | 客户端压缩到 1600px（已有）+ 失败重试提示；已传的照片不因页面刷新丢失（已落库） |
| 差评③：收据发两次 | 质保邮件 `idempotencyKey = install-warranty:{orderId}`，一单一封；返修完成后也只发一封 |

通用外勤服务（field service）做法与之一致：现场捕获 → 分类 → 派单 / 排期 → 解决 → 关单前核验 → 回访。我们把"关单前核验"落在会计确认尾款这一步。

---

## 3. 路径 ①：完工 → 会计确认尾款 → 质保邮件

### 3.1 会计「待收尾款」页签（`/accounting` 新页签）
- 列表：本企业 `status = installed` 的工艺单。列：单号、客户、安装完成日、销售、**应收尾款**（= `agreedBalanceAmount`，缺失时 `grandTotal − 定金`；与销售首页 `build-home.ts:571-577` 同一口径，抽成共用函数，单笔口径一致）、完工照（缩略图，点开大图；会计已有 `install.photo.read`）、质保邮件状态。
- 无关联报价的手工单：应收显示"—"，会计手填金额。
- 页签状态读写 URL（`?tab=balance&order=<id>`），修 F11，否则通知点进去落不到这里。

### 3.2 确认收到尾款
- 新权限键 `install.balance.confirm`（ORG）：给 `accounting`、`owner`。数字员工禁用（同 `*.approve` 一类禁区）。
- 表单：实收金额、方式（沿用定金的 cash / visa / check / finance，是否加 e-transfer 待拍板 Q6）、收款日期、备注。实收 ≠ 应收时**必须填差额说明**（不阻断，只是强制留痕）。
- 提交后同一事务：
  1. `AuditLog(action=install.balance.confirmed, targetType=blinds_order, targetId=orderId, afterData={quoteId, expected, received, method, receivedAt, note, byUserId})`；
  2. 工艺单 `installed → completed`（`applyOrderTransition`，OrderStatusLog 记"尾款确认"）；
  3. 生成质保邮件审批（3.3）。
- 幂等：已 `completed` 再确认 → 200 `idempotent`，不重复建审批。

### 3.3 质保邮件（出站先审批，纪律 2）
- 新 PendingAction 类型 `install.send_warranty_email`；`idempotencyKey = install-warranty:{orderId}`；`approverUserId` = 确认尾款的会计本人（Q2：或改为老板 / 销售）。
- 确认对话框里直接展示邮件预览（收件人、主题、正文、产品与质保年限表），下面一个「批准发送」按钮（调既有 `POST /api/ai/pending-actions/[id]`）。会计两次点击：确认收款 → 批准发送。不点批准则留在审批收件箱，零出站。
- 执行器：重新校验 工艺单 `completed`、收件人 = 客户档案邮箱（不取 payload 外的地址）、payloadHash 未变；发件身份按组织设置（Q3），**不回退到个人 Gmail**；成功审计 + 通知销售；失败写 `failureReason` 并通知会计，页签显示"发送失败 · 重试"。
- 缺客户邮箱 / 产品线没配质保年限 → 尾款照常确认，但**不建审批**，页签显示"质保邮件未生成：缺 X"，补齐后点"生成质保邮件"。
- 模板与变量见 `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md`。邮件**不含任何金额**。

### 3.4 质保条款从哪来（必须拍板，Q1）
三个来源互相矛盾：

| 来源 | 帘类（Zebra / Roller / Drapes…） | Shutters |
|---|---|---|
| 报价 PDF / Order Form（客户签字的合同，仓库可查） | 1 年人工 · 5 年面料 · 15 年部件 | 1 年人工 · 5 年部件 |
| 官网 warranty-registration 检索摘要 | 5 年 | 25 年 |
| 官网产品页检索摘要 | Zebra / Roller 盖盒 15 年（≈ 报价 PDF 的 15 年部件）；电动 "10 Years Warranty"（未写明范围） | — |
| 官网 warranty-service 原文 | 本会话无法访问 | 同左 |

方案：质保表放 `Organization.settingsJson.sunnyWarranty`（组织级，可改，改动记审计），**按"品类 × 部件（人工 / 面料 / 部件 / 电机）"存年限**，不是一个产品一个数。种子值建议取**报价 PDF**（那是客户签字的版本），官网条款链接附在邮件里。你确认以哪个为准后再填种子；未配置的品类一律阻断生成，不默认任何年限。

---

## 4. 路径 ②：维修单 → 出单 → 二次安装

### 4.1 安装工现场（`/install/[id]` 扩展）
- 每个收口单元两个按钮：**✅ 完成**（拍完工照，= INSTALL-1 现有）/ **⚠ 有问题**（拍问题照 + 选问题类型 + 描述）。
- 收口单元 = `BlindsOrderItem` 行 **+ ProcessSpec 的 Vinyl 窗 / 窗帘行 / 国内下单行 / 外采购行**（修 F2；键 = `spec:{段}:{序号}`，afterData 存位置快照，工艺参数事后被改时提示"位置已变"）。
- 底部按钮按状态切换：全部 ✅ → 「完成收口」；任一 ⚠ 且其余都 ✅ → 「提交维修单」；还有没处理的 → 禁用并写"还差 N 项：<位置>"。

### 4.2 维修单（数字化你给的纸质模板）

| 纸质模板字段 | 系统取值 |
|---|---|
| Name | 客户名（预填，可改） |
| Order# | 工艺单号（预填，只读） |
| Taken by | 安装工本人（自动） |
| Phone | 客户电话（预填，可改） |
| Notes | 自由文本 |
| # / Location / Description（1–10 行，可超过 10） | 每个 ⚠ 单元一行：位置（预填）、描述（必填）；**另加** 问题类型、是否需工厂出单、问题照片（≥1） |
| Filling Date | 提交日（自动） |
| （新增）返修时间 | 客户期望日期（可选）；目标日 = 期望日 ‖ 填写日 + 7 天；"已和客户确认" 勾选 |

- 落点：`AuditLog(action=install.repair.submitted, targetType=blinds_order, targetId=orderId, afterData={repairNo, appointmentId, visitNo, header{name, orderNo, phone, notes, takenById}, rows[{n, unitKey, location, description, category, needsFactory, photos[]}], filledAt, customerPreferredDate, targetDate, customerConfirmed})`；`repairNo = R-{工艺单号}-{第几张}`，确定性生成。
- 提交即：本次预约 → `completed`（审计 `install.task.completed` 带 `outcome: "needs_repair"`）；工艺单**保持 `scheduled`**。
- **打印版**：`/install/repairs/[id]/print` 按纸质模板版式（SUNNY SHUTTER INC 抬头 + 地址、同样的表格和 Filling Date），附问题类型 / 目标日；工厂可以照旧打印纸单走流程。

### 4.3 问题类型 → 是否需工厂（查表，纪律 7）

| 类型 | 需工厂出单 | 说明 |
|---|---|---|
| 尺寸不符需重做 | 是 | 重做 |
| 部件缺失 / 漏发 | 是 | 补件 |
| 产品损坏 / 瑕疵 | 是 | 换件 / 重做 |
| 颜色 / 面料不符 | 是 | 重做 |
| 电机 / 遥控 / 充电问题 | 是 | 补件 |
| 现场条件不具备（墙体、窗框、电源） | 否 | 只需改期再去 |
| 客户原因（不在家、要求改期、要改方案） | 否 | 只需改期再去 |
| 其他 | 安装工勾选（默认 是） | |

### 4.4 出单（工厂）
- 通知按**品类**发给出单人（复用 PERM-3 的品类推导与 `orders.fulfillment.update.<品类>` 持有者；品类推不出 → 发给全品类键持有者）。只发"需工厂"的行涉及的品类。
- 出单人在维修单页点「已出单」：填预计备好日期 + 备注 → `AuditLog(install.repair.factory_issued)` → 通知排安装的人"返修件预计 X 日备好"。
- 维修单没有任何"需工厂"行 → 跳过出单，直接进"待排期"。
- v1 不自动生成返修工艺单（重做件的下料计算），出单人按打印版走现有流程；v2 再做（Out of scope）。

### 4.5 排第二次安装（运营 / 会计 / 老板，`install.task.assign`）
- 「待排返修」列表（`/install/repairs`，持 `install.task.read` ORG 可见：运营、会计、出单、老板）：维修单号、客户、问题摘要、目标日、出单状态 / 预计备好日、是否逾期。
- 「安排返修」：选安装工 + 时间 → 新建 `Appointment(type=install, title="返修 — 客户 (单号)")`，工艺单 `appointmentId` 指向新预约，`AuditLog(install.repair.scheduled, {repairNo, appointmentId})`。**不经过状态机 transition**（工艺单本来就是 `scheduled`），所以不需要加边。
- 预计备好日晚于所选时间 → 提示但不阻断。

### 4.6 第二次安装收口
- 安装工任务页只列**本维修单的行**；每行 ✅ 拍照 → 全部 ✅ → 「完成返修」→ 维修单 `install.repair.completed`；没有其它未关的维修单时，工艺单 `scheduled → installed`（`installedAt` = 本次）→ 进入路径 ①。
- 二次安装又有 ⚠ → 再开一张维修单（`visitNo + 1`），循环。
- 修 F5：收口聚合按"访次"区分；照片代理放行该工艺单**任一**安装预约的被分配人；工艺单"收口"标签显示全部访次。

### 4.7 逾期提醒
- 目标日已过、仍未排期 / 未完成的维修单 → 通知运营 + 销售（`sourceKey` 按 维修单 + 日期 去重）。
- **挂在既有每日 cron 上**（`/api/cron/inspect` 或 `followup`，propose 时选一个），不新增 cron / 队列 / scheduler（纪律 3）。

---

## 5. 推导状态（谁看到什么）

`installStage(order, events)` —— 纯函数、查表，UI、API、通知、列表**共用一个**：

| stage | 条件 | 安装工 | 运营 | 出单 | 会计 | 销售 |
|---|---|---|---|---|---|---|
| `scheduled` | 已排期、本访次无结果 | 去装 | — | — | — | 已排 X 日安装 |
| `repair_open` | 有未关维修单、需工厂、未出单 | — | 待出单 | **待出单** | 未完工，暂不收尾款 | 返修中，目标 X 日 |
| `repair_ready_to_schedule` | 已出单（或无需工厂）、未排期 | — | **待排返修** | 已出单 | 同上 | 同上 |
| `repair_scheduled` | 返修已排期 | 去装 | 已排 | — | 同上 | **X 日再去** |
| `awaiting_balance` | 工艺单 `installed` | — | — | — | **待收尾款** | 已装完，收尾款 |
| `closed` | 尾款已确认（工艺单 `completed`） | — | — | — | 已收 · 质保：待批准 / 已发 / 失败 | 已结清，质保已发 |

销售看到的是状态卡片（工艺单详情 `/blinds-orders/[id]`；报价列表行加一个状态标签），**不给销售开 `/install` 工作区**，也不给维修单照片；可见范围沿用工艺单读范围（销售看自己的单）。

---

## 6. 通知矩阵（每条都要"点得上"）

| 事件 | 收件人（按岗位键找人） | 点进去去哪 | 收件人对目标页有权限？ |
|---|---|---|---|
| 完成收口 | `install.balance.confirm` 持有者；工艺单创建人（销售） | 会计 → `/accounting?tab=balance&order=`；销售 → `/blinds-orders/[id]` 状态卡 | 会计有 `accounting.read`；销售是工艺单创建人（F15） |
| 提交维修单 | 出单（按品类）；`install.task.assign` 持有者；会计；销售 | 出单 / 运营 / 会计 → `/install/repairs/[id]`；销售 → `/blinds-orders/[id]` 状态卡 | 前三者需 `install.task.read` ORG（都有）；**销售不链 `/install`** |
| 已出单 | `install.task.assign` 持有者；销售 | `/install/repairs/[id]`；销售 → `/blinds-orders/[id]` | 同上 |
| 已安排返修 | 被分配安装工；销售；会计 | 安装工 → `/install/[appointmentId]`；其余同上 | 安装工 ASSIGNED |
| 维修单逾期 | `install.task.assign` 持有者；销售 | 同上 | 同上 |
| 质保邮件待批准 / 发送失败 | 确认人（会计） | `/accounting?tab=balance&order=` | 是 |
| 质保邮件已发 | 销售 | `/blinds-orders/[id]` | 是（创建人） |

- 所有新类型注册进 `NOTIFICATION_TYPE_KEYS`（修 F10 同类问题）；`sourceKey` 全部带事件 id，重放不重复。
- **验收硬条件**：表驱动测试——对每个 事件 × 收件岗位，用路由**真正使用的**守卫函数判定目标页可访问；任何一格为否即失败（§10）。

---

## 7. 数据落点（零 schema）

| 东西 | 落点 |
|---|---|
| 逐窗 / 逐单元结果、问题照片 | `AuditLog(install.window.completed / install.window.issue)` + 私有 Blob `install-photos/...`（沿用 INSTALL-1 前缀与代理） |
| 维修单及其生命周期 | `AuditLog(install.repair.submitted / .factory_issued / .scheduled / .completed / .cancelled)`，`targetType=blinds_order` |
| 尾款确认 | `AuditLog(install.balance.confirmed)` + 工艺单 `status=completed`、`completedAt`（既有字段） |
| 质保邮件 | `PendingAction(type=install.send_warranty_email)`（既有表） |
| 质保年限表 / 联系方式 | `Organization.settingsJson.sunnyWarranty`（读改写只动这个键，不整对象覆盖 settingsJson——与 `sunnyProcess` 同一教训） |
| 返修预约 | `Appointment(type=install)`（既有） |
| 通知 | `Notification`（既有），新 type 注册 |
| 新权限键 | `install.balance.confirm`（ORG：accounting、owner）。其余复用：维修单提交 = `install.task.update`；出单 = `orders.fulfillment.update.<品类>`；排返修 = `install.task.assign`；读 = `install.task.read` / `install.photo.read`；质保表编辑 = `sales.settings.manage`（Q7） |

**不可清理清单**（追加到 INSTALL-1 的"不可清理"）：`install.repair.*`、`install.window.issue`、`install.balance.confirmed`、`install.warranty.sent`（一单一封的唯一依据，删了会重发）、`install.warranty.settings`（质保年限改动记录）。

---

## 8. 与八条硬纪律

| 纪律 | 关系 |
|---|---|
| 1 零 schema | 遵守：全部落 AuditLog / settingsJson / Notification / PendingAction / 既有 Appointment、BlindsOrder 字段；状态机不加状态 |
| 2 出站先审批 | **触碰**：质保邮件走 PendingAction，批准前零出站；返修时间**不**发客户邮件（v1） |
| 3 禁止第三套队列 | 遵守：逾期提醒挂既有每日 cron；不新增 scheduler / queue |
| 4 脱敏 | 不涉及 Muse；另加 SHALL NOT：质保邮件、销售状态卡、维修单打印版不出任何金额 / 成本 / 折扣 |
| 5 不爬登录页 | 不涉及 |
| 6 邮箱分离 | **触碰**：发件身份只从组织设置取，payload 里没有发件地址；Q3 定用哪套设置 |
| 7 确定性优先 | 遵守：`installStage`、问题类型 → 需工厂、目标日、质保到期日全部查表 / 日期计算；无新 LLM 调用 |
| 8 测试注册 | 每个新 `__tests__/*.test.ts` 同 task 注册 `scripts/test-all.sh` |

---

## 9. 拆分（5 个 change，按顺序；每个 ≤ 8 task）

> 2026-10-28 propose 2b 时原"尾款 + 质保邮件"超过 8 条 task，按纪律拆成 2b（尾款确认）与 2c（质保邮件）；原 2c / 2d 顺延为 2d / 2e。
> 2026-10-28 propose 2e 时"出单 + 排返修 + 返修收口 + 作废 / 关闭 + 逾期提醒"超过 8 条 task，拆成 2e（调度闭环）与 2f（作废 / 关闭不返修、逾期提醒）。2d 与 2e 同批上线。

| ID | change | 做什么 | 依赖 | 为什么这个顺序 |
|---|---|---|---|---|
| INSTALL-2a | `install-2a-closeout-all-lines` | 收口单元覆盖 ProcessSpec 各段（修 F2 点不上）；零单元单给出明确 409 与页面说明；收口记录写入失败时不再假成功（现为 `logAudit` 吞错） | INSTALL-1 | **今天 Shutters 单就收不了口**，后面两条路都建立在"能收口"上 |
| INSTALL-2b | `install-2b-balance-confirm` | `install.balance.confirm`；会计「待收尾款」页签（URL 页签，修 F11）；确认尾款 → `completed`（差额必填说明、幂等）；完工 / 尾款确认站内通知与落点；销售首页待收尾款逐单口径并剔除已确认（Q10） | 2a | 路径 ① 前半：钱的确认 |
| INSTALL-2c | `install-2c-warranty-email` | `sunnyWarranty` 质保表（种子 = 报价单口径）与设置页；完工 + 质保邮件模板；`install.send_warranty_email` 审批 + 执行器；尾款确认后生成审批、会计批准发送；发送结果通知 | 2b | 路径 ① 后半：客户邮件 |
| INSTALL-2d | `install-2d-repair-form` | 逐单元 ✅ / ⚠ 二选一；维修单提交（数字模板 + 打印版）；问题类型查表；返修目标日；预约结果 `needs_repair`；`installStage` 推导；通知（出单按品类 / 运营 / 会计 / 销售）；`/install/repairs`；销售状态卡 | 2a | 路径 ② 前半 |
| INSTALL-2e | `install-2e-repair-dispatch` | 出单按品类登记「已出单 + 预计备好日」；安排返修 / 改期（新预约、不走状态机）；返修预约只收口维修行；照片代理放行任一安装预约被分配人（修 F5）；返修完成 → `installed` 接回 2b；返修中再发现问题 → 新维修单、原单转入 | 2b、2d | 路径 ② 后半，闭环 |
| INSTALL-2f | `install-2f-repair-close` | 维修单作废（提交错了：恢复首装预约）/ 关闭不返修（客户接受现状：转已安装）；逾期提醒挂既有每日 cron | 2e | 例外出口与提醒 |

每个 change 照常：`/opsx:propose` → 四件套回传审 → `/opsx:apply` → `npm test` → `/opsx:verify` → PR → 合并 → archive 小 PR。规格增量要动的既有能力：`installation/window-closeout`、`installation/install-tasks`、`fulfillment/order-category-access`（会计推进 `completed` 的例外）、`accounting/workspace`（新页签）、`accounting/quote-process-view`（"会计只读"需改为"除尾款确认外只读"）。

---

## 10. 交叉验证（防"点不上"、防幻觉）

| # | 验证 | 方式 |
|---|---|---|
| V1 | 每个按钮 = 一个 API 判定 | UI 的可用按钮由 `availableActions(stage, keys)` 纯函数给出，路由用**同一函数**拒绝；表驱动测试：每个 stage × 岗位，UI 可见 ⇔ API 2xx |
| V2 | 通知点得上 | §6 矩阵表驱动测试：事件 × 收件岗位 → 目标路由守卫放行 |
| V3 | 零窗单能收口 | 纯测试 + 隔离库 e2e：只有 Vinyl 窗 / 只有窗帘 / 全部发国内 的单各一条，能完成收口 |
| V4 | 两条路全链路 | 隔离库 e2e（本地 Postgres，按 Sunny 岗位绑定 6 个人）：路径 ①；路径 ②（首装 2 ✅ 1 ⚠ → 出单 → 排返修 → 返修收口 → 尾款 → 邮件审批执行，发信用 stub provider） |
| V5 | 金额口径一致 | 同一张报价：会计页签"应收尾款" = `quote-agreed-payment` 解析值 = 销售首页口径（共用函数，纯测试三方对拍）；销售首页是本月签单统计，不随收款变化（F6，见 Q10） |
| V6 | 只发一封 | 重复确认 / 重复批准 / 返修后再确认 → 只有一条 PendingAction、只发一次 |
| V7 | 不出金额 | `grep` 质保模板渲染结果、维修单打印、销售状态卡 API 响应，无 `grandTotal|balance|price|deposit` |
| V8 | 浏览器点击 | 本地 Playwright，按 安装工 → 出单 → 运营 → 会计 → 销售 各登录一次走完两条路，截图存报告 |
| V9 | 规格 | `openspec validate <change> --strict`；specs 增量覆盖所有对外行为 |

---

## 11. Out of scope（INSTALL-2 全部 4 个 change 都不做）

- 不发给客户返修时间确认邮件 / 短信（v2，同样走审批）。
- 不自动生成返修工艺单（重做件下料计算）。
- 不做质保 PDF 附件（现有发信链路无附件能力，F9）；v1 只发正文 + 官网条款链接。
- 不做客户在线签收 / 满意度回访 / 评价邀请。
- 不做安装费 / 返修费结算，不改提成口径。
- 不改 Google Calendar 同步；不给销售开 `/install` 工作区。
- 不做中文 / 法文质保邮件（Q5）。

---

## 12. 拍板结果（2026-10-28）

Lucas："质保以报价单为主，按照你的方案去进行开发"。Q1 明确拍板；其余按"按照你的方案"采用下表建议列，实施中如需改，改这里并在对应 change 的 design 里写明。

| # | 问题 | 建议 = 拍板 |
|---|---|---|
| Q0 | "U-HEAL" 是不是 U-Haul 自助还车？ | 按 U-Haul 理解（§2） |
| Q1 | 质保年限以哪个为准：报价 PDF（1/5/15、1/5）还是官网（25 / 5）？ | **拍板：以报价单为准**（帘类 人工 1 / 面料 5 / 部件 15；Shutters 人工 1 / 部件 5） |
| Q2 | 质保邮件谁批准？ | 确认尾款的会计本人（两次点击）；或指定老板 |
| Q3 | 用哪个发件箱 / 品牌？现有客户邮件品牌是 SUNNY HOME & DECO，维修单是 SUNNY SHUTTER INC | 组织发件身份（Resend，同询价回复），品牌 Sunny Shutter Inc；不回退个人 Gmail |
| Q4 | 质保邮件要不要抄送销售？ | 不抄送，改发站内通知 |
| Q5 | 要不要中文质保邮件？ | v1 只英文 |
| Q6 | 尾款收款方式要不要加 e-transfer？ | ~~加~~ → **沿用定金四种（Cash / Visa / 支票 / Finance）**：读代码发现 e-transfer 已被有意从定金登记下线（`src/lib/sales/deposit-payment-methods.ts`），不加回（2b design D10） |
| Q7 | 质保表谁能改？ | 老板（`sales.settings.manage`） |
| Q8 | "默认 1 周" 是 7 个日历日还是 5 个工作日？ | 7 个日历日 |
| Q10 | 销售首页"待收尾款"现在是本月签单尾款合计；2b 之后要不要改成"已装完、未确认收款"的真实应收？ | 改，放进 2b（共用应收函数） |
| Q9 | 实收 < 应收（客户少付）时，工艺单还转 `completed`、还发质保吗？ | 必填差额说明后照常完成并发质保 |
| Q11 | 历史上手工推到「已完工」、没有尾款确认记录的单，算不算待收尾款？（2026-10-28 propose 2d 时发现：2b 列表现在全算） | **拍板：只算走过系统收口的**——「已安装」全算；「已完工」只有当前安装预约有完成收口记录才算；历史手工完工不进会计列表，状态卡显示"已完工"。2b 单独补修正，2d `installStage` 同一规则（2d design D8） |

---

## 13. 风险

- AuditLog 作为业务记录进一步加重（INSTALL-1 已是）：任何清理策略必须排除 §7 清单；PERM 后续若有订单扩展 JSON 位再迁移。
- ProcessSpec 行无稳定 id：收口单元键用"段 + 序号"，参数事后被改会错位——用位置快照比对并提示，不自动迁移照片。
- 现有发报价 / 签字回执邮件是直发（F8），与纪律 2 不一致；不在本任务修，另提。
