# Proposal: install-2b-balance-confirm

**TASKFLOW：** INSTALL-2b（`docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2 段）；承载方案 `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §3.1–3.2、§6、§12 Q9 / Q10（2026-10-28 Lucas 拍板）。原 2b 超过 8 条 task，拆为本 change（尾款确认）与 INSTALL-2c（质保邮件）。
**受影响的 Muse 意图：** 无。本 change 不触碰 `src/lib/muse-bridge/**`。

## Why

安装完成收口后没有任何人被通知，会计没有地方看到"装完待收尾款"的单、也没有地方登记"尾款已收"，工艺单一直停在"已安装"。尾款确认是之后发完工 + 质保邮件（INSTALL-2c）的前提，必须先有一个可核对、可追溯的确认动作。

## What Changes

- 新增权限键 `install.balance.confirm`（确认收到尾款，ORG，HIGH，只允许人类主体），绑定给 `accounting` 与 `owner`。
- 新增 `GET /api/accounting/balance`：列出本企业已安装、尚未确认尾款的工艺单（单号、客户、销售、安装完成日、收口单元数、应收尾款、关联报价），以及最近已确认的单。
- 新增 `POST /api/accounting/balance/{orderId}/confirm`：登记实收金额、方式（沿用定金的 Cash / Visa / 支票 / Finance）、收款日期、备注；实收与应收不一致时备注必填；写审计 `install.balance.confirmed`；工艺单为 `installed` 时推进到 `completed`；重复确认幂等。
- 安装完成收口后通知持 `install.balance.confirm` 的人（"待收尾款"）与该单销售（"已装完，收尾款"）；尾款确认后通知该单销售。通知点击后落到收件人能打开的页面（会计 → `/accounting?tab=balance&order=<id>`；销售 → 工艺单详情）。
- `/accounting` 新增"待收尾款"页签：接口 403 时不显示；页签可由 URL `?tab=` 直达；每行可展开看收口照片；行内"确认收到尾款"对话框。
- 销售首页"待收尾款"改为按单计算（报价约定尾款，缺省为总价 − 已收定金），已确认尾款的单不再计入。
- 写 `docs/QINGYAN_INSTALL-2b_REPORT.md`，TASKFLOW INSTALL-2b 改 `[G]`；方案 §9 / TASKFLOW / HANDOFF 同步拆分（2b 尾款、2c 质保邮件、2d 维修单、2e 返修排期）。

## Capabilities

### New Capabilities
- `installation/balance-confirmation`：装完待收尾款的列表、尾款确认（校验、差额说明、幂等、推进已完成）、完工与尾款确认的站内通知及其落点、销售首页待收尾款口径、不输出的内容。

### Modified Capabilities
- `authorization/position-catalog`：新增 `install.balance.confirm` 登记与 `accounting` / `owner` 绑定；数字员工禁区键增加 `install.balance.confirm`。
- `accounting/workspace`：页签增加"待收尾款"；页签可由 URL 参数直达。
- `fulfillment/order-category-access`：「状态推进按品类」增加例外——尾款确认推进 `installed → completed` 要求 `install.balance.confirm`，不要求品类键。

## Impact

- 改：`src/lib/authorization/permissions.ts`、`role-defaults.ts`；`src/app/api/install/tasks/[id]/complete/route.ts`（收口后通知）；`src/components/accounting/accounting-view.tsx`；`src/components/header.tsx` 与 `src/app/(main)/notifications/page.tsx`（新通知类型的落点）；`src/lib/notifications/constants.ts`、`delivery-gate.ts`、`src/components/notification/*`（类型登记与文案）；`src/lib/sales/home/build-home.ts`（待收尾款口径）。
- 新：`src/lib/install/balance.ts`（纯函数）、`src/lib/install/balance-service.ts`、`src/app/api/accounting/balance/route.ts`、`src/app/api/accounting/balance/[orderId]/confirm/route.ts`。
- 数据库：零 schema。尾款确认写 `AuditLog(action=install.balance.confirmed, targetType=blinds_order)`；工艺单状态用既有 `status` / `completedAt` / `OrderStatusLog`；通知用既有 `Notification`。
- 测试：新增 `src/lib/install/__tests__/balance.test.ts`、`src/lib/install/__tests__/balance-db.isolated.test.ts`（注册）；`authorize.test.ts` 加新键快照。
- 对外行为：会计页多一个页签；`/complete` 成功后产生站内通知；销售首页"待收尾款"数字在有单已确认时变小。

## Out of scope

- 完工 + 质保邮件、质保年限设置、发信审批（INSTALL-2c）。
- 维修单、返修、二次安装（INSTALL-2d / 2e）。
- 退款、分期、部分收款的多次登记：一张单只登记一次尾款确认；差额只记说明。
- 修改定金登记（`record-deposit`）或报价金额。
- 统一既有通知类型在头部铃铛与通知页的落点差异（已另提任务）。
- 给销售开会计页或展示会计登记的收款方式 / 备注。
