# Design: install-2b-balance-confirm

## Context

见 proposal.md「Why」。现状（2026-10-28 已读代码，main @ 82b18ba + INSTALL-2a）：
- 收口：`POST /api/install/tasks/{id}/complete` 成功后预约 `completed`、工艺单 `installed`，**之后不通知任何人**（`src/app/api/install/tasks/[id]/complete/route.ts`）。
- 报价 ↔ 工艺单：只有 `AuditLog(action=process_order.generated, targetType=sales_quote, targetId=<quoteId>, afterData={orderId, code})`（`src/lib/sunny-process/autogen.ts:138-146,232-236`）；`BlindsOrder` 无 quoteId。
- 尾款：报价有 `agreedBalanceAmount`（Order Form 解析，`src/lib/sales/quote-agreed-payment.ts`）、`depositAmount` / `depositCollectedAt`；**没有尾款已收字段，没有会计写接口**。销售首页"待收尾款"= 本月签约报价 `_sum.agreedBalanceAmount ?? max(0, _sum.grandTotal − _sum.depositAmount)`（`src/lib/sales/home/build-home.ts:239-248,571-577`），聚合口径在部分报价无约定尾款时会漏算。
- 状态推进：`installed → completed` 走 transition 路由要品类键（`src/app/api/blinds-orders/[id]/transition/route.ts:95-105`）；`applyOrderTransition(tx, order, to, operatorId, note)` 写状态 + 时间戳 + 状态日志（`src/lib/fulfillment/order-access.ts:70-85`）。
- 会计：`accounting` 岗位只读 + INSTALL-1 的 `install.task.assign/read`、`install.photo.read`（`src/lib/authorization/role-defaults.ts:281-297`）；**没有工艺单读权**（PERM-3 读范围），打不开 `/blinds-orders/[id]`，但能读 `/api/install/tasks/{id}` 与收口照片。
- 页面：`src/components/accounting/accounting-view.tsx` 页签是 `useState`，不读 URL。
- 通知：`createNotification`（`sourceKey` 去重）+ `shouldDeliverInApp`（偏好门禁）；点击落点由 `entityType` 在 `src/components/header.tsx` `handleNotificationNavigate` 与 `src/app/(main)/notifications/page.tsx` **各写一份**，`metadata.href` 不被读取；类型注册 `NOTIFICATION_TYPE_KEYS` + `TYPE_INTRODUCED_AT`（grandfather）+ `notification-type-toggle-list.tsx` 文案。
- 收款方式：`deposit-payment-methods.ts` 当前四种（cash / visa / check / finance），e-transfer 已有意下线、只为旧客户端兼容接收。

## Goals / Non-Goals

**Goals:**
- 会计在一个页签里看到"装完待收尾款"的单、看收口照片、一次确认；确认可追溯（谁、何时、多少、方式、差额说明）。
- 完工与尾款确认两个时点的通知都"点得上"：落点页面收件人一定有权打开。
- 会计页与销售首页的应收尾款同一口径（一个函数）。

**Non-Goals:**
- 不改 `src/app/api/sales/quotes/[quoteId]/record-deposit/route.ts`、`src/lib/sales/quote-agreed-payment.ts` 的解析逻辑、`SalesQuote` 任何字段。
- 不改 `src/app/api/blinds-orders/[id]/transition/route.ts`（出单仍可按品类键手动推 `completed`，不影响尾款列表，见 D2）。
- 不改既有通知类型在 `header.tsx` / `notifications/page.tsx` 的落点（只新增两个 install 类型的分支；差异已另提任务）。
- 不改 `src/lib/install/closeout.ts` / `service.ts` 的收口逻辑（只在 `/complete` 成功后追加通知）。
- 不做发信、不做质保（INSTALL-2c）。

## 八条硬纪律对照

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守。尾款确认写 `AuditLog(install.balance.confirmed, targetType=blinds_order)`；状态用既有 `status` / `completedAt` / `OrderStatusLog`；通知用 `Notification` |
| 2 | 出站先审批 | 不涉及。本 change 无对外发送（站内通知不是出站）；客户邮件在 INSTALL-2c 走 PendingAction |
| 3 | 禁止第三套队列 | 不涉及。通知在请求内同步创建，不新增队列 / cron |
| 4 | 脱敏 | 不涉及 Muse。新增 SHALL NOT：列表 / 确认接口不出成本 / 毛利 / 提成 / 客户联系方式；通知不含金额 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守。应收口径、差额判定、落点规则全是纯函数查表 |
| 8 | 测试注册 | 遵守。`balance.test.ts`、`balance-db.isolated.test.ts` 同 task 注册 |

## Decisions

### D1 尾款确认记录落 AuditLog（目标 = 工艺单）
`AuditLog(action=install.balance.confirmed, targetType=blinds_order, targetId=<orderId>, afterData={quoteId, expected, received, method, receivedAt, note, byUserId})`。手工建的单没有报价，目标只能是工艺单。
- 否决：复用报价定金字段 / 新加 `balanceCollectedAt`——前者语义混淆，后者违反零 schema。
- 否决：目标设为报价——手工单无报价，且一张报价理论上可对应重新生成的单。

### D2 "已确认"由记录是否存在判定，不看工艺单状态
出单持品类键仍能经 transition 把单手动推到 `completed`；若以状态判定，这类单会从会计列表里"消失"而钱没确认。列表 = 无确认记录，且状态 `installed`，或状态 `completed` 且当前安装预约有完成收口记录（`install.task.completed`）；确认时只在 `installed` 才推进状态。
补充（2026-10-28，任务书 §12 Q11，Lucas 拍板"只算走过系统收口的"）：上线前就被手工推到 `completed`、没走过系统收口的历史单不算，否则上线当天会计列表会被历史单淹没。
- 否决：禁止出单手动推 `completed`——要改 transition 路由与既有规格，超出本 change。
- 否决：`completed` 无记录一律算——历史手工完工单全部进列表。

### D3 应收口径逐单计算，会计页与销售首页共用
`quoteBalanceDue(q) = agreedBalanceAmount ?? max(0, grandTotal − (depositAmount ?? 0))`。销售首页改为取本月签约报价逐单求和，并剔除已确认的单（Q10）。
- 否决：保留聚合公式——任何一张报价有约定尾款时，聚合会把其余报价的尾款整体漏掉（`_sum.agreedBalanceAmount` 非空即用）。

### D4 报价查找走生成审计
按工艺单 id 在 `process_order.generated` 审计的 `afterData` 中查 `"orderId":"<id>"`（限定 `action` + `targetType`，走 action 索引），批量时一次 OR 查询。
- 否决：按 `quote.orderNumber = order.code`——单号冲突时工艺单会加 `-Q<后 6 位>` 后缀，匹配不确定。

### D5 会计在页签内看照片，不跳工艺单详情
会计没有工艺单读权；展开行时调 `/api/install/tasks/{appointmentId}`（会计持 `install.task.read` ORG）渲染收口缩略图。
- 否决：链接到 `/blinds-orders/{id}`——会计会 403，是"点不上"。
- 否决：给会计加 `orders.fulfillment.read`——扩大会计读范围到全部工艺参数，超出需要。

### D6 新通知类型的落点用一个纯函数
`installNotificationHref({type, entityType, entityId})` 放在 `src/lib/install/balance.ts`，头部下拉与通知页在既有分支之前先调用它。会计收到的通知 `entityType=install_balance`；销售收到的 `entityType=blinds_order`（既有分支已指向详情页，销售是创建人可读）。
- 否决：写 `metadata.href`——两处都不读它。
- 否决：本 change 统一全部既有类型——改动面大且会改变既有点击行为，已另提任务。

### D7 并发：工艺单级 advisory lock
确认在事务内先 `pg_advisory_xact_lock(hashtext('install-balance:'+orderId))`，再查是否已有记录，再写审计（`writeAuditLog(tx)`）+ 推进状态；两个并发请求只有一个写入。
- 否决：先查后写不加锁——双击会写两条记录、推进两次。

### D8 通知失败不影响主动作
完成收口与尾款确认在事务提交后发通知，`try/catch` 记日志；通知偏好照常生效（`shouldDeliverInApp`）。
- 否决：把通知放进事务——通知表写失败会让收口 / 确认回滚，安装工与会计看到失败但事实已发生。

### D9 差额允许，但必须写说明（Q9）
`|实收 − 应收| ≥ 0.01` 且应收非空时备注必填；照常推进 `completed`。
- 否决：少收则不允许确认——现场常有让价 / 抹零，会卡住整个收尾。

### D10 收款方式沿用定金四种
`cash` / `visa` / `check` / `finance`。方案 Q6 原建议加 e-transfer；读代码发现 e-transfer 已被有意下线（`deposit-payment-methods.ts` 注释），本 change 不加回，在报告与方案 §12 记录。
- 否决：加回 e-transfer——与定金登记口径不一致，且推翻他人既有决定。

## 验证方式

| 项 | 命令 / 产物 |
|---|---|
| 应收口径、差额判定、输入校验、通知落点 | `npx tsx src/lib/install/__tests__/balance.test.ts` |
| 新键与岗位快照、数字员工禁区 | `npx tsx src/lib/authorization/__tests__/authorize.test.ts` |
| 真实路由端到端（隔离库）：列表范围 / 403 / 他企业；确认 200 → completed + 审计 + 状态日志操作人为会计；未安装 409；非法 400；差额无说明 400；重复幂等；收口后会计与销售各一条通知、重复收口不重复；确认后销售通知；销售首页待收尾款剔除已确认；响应无敏感字段 | `DATABASE_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/install/__tests__/balance-db.isolated.test.ts` |
| 页面 | 本地 `next dev` + Playwright：会计打开 `/accounting?tab=balance&order=<id>` → 页签与行展开 → 缩略图 → 确认对话框（差额无说明被拦）→ 确认后行移到"已确认"；头部通知点击落点 |
| 类型 / lint / 注册 / CI | `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`；`npm run lint:baseline`；`npm run test:ci`；`bash scripts/check-test-registry.sh` |
| 规格 | `openspec validate install-2b-balance-confirm --strict` |

## Risks / Trade-offs

- [`afterData contains` 查报价无索引] → 限定 `action` + `targetType`（action 有索引），列表按页最多 200 张单；量大时再在生成审计里补 `orgId` 过滤。
- [审计表继续承载业务记录] → `install.balance.confirmed` 加入不可清理清单。
- [销售首页数字变化] → 剔除已确认 + 逐单口径会让数字与改前不同；报告写明口径。
- [岗位模板新增绑定需要重跑种子] → 上线动作：对 Sunny 重跑 `seedOrgAuthorizationProfiles`。

## Migration Plan

无数据迁移。合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（`accounting` / `owner` 加 `install.balance.confirm`）。此前已安装的单在会计页签"待收尾款"里直接出现（无确认记录），会计按实际情况逐单确认。回滚：回退代码即可，已写的 `install.balance.confirmed` 审计与 `completed` 状态保留无害。
