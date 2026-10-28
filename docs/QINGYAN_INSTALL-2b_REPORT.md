# INSTALL-2b 报告 — 装完待收尾款：会计确认尾款

change：`openspec/changes/install-2b-balance-confirm/`（proposal / specs ×4 / design D1–D10 / tasks 8/8）
方案：`docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §3.1–3.2、§6、§12 Q6 / Q9 / Q10（2026-10-28 Lucas 拍板）
零 schema：尾款确认写 `AuditLog(install.balance.confirmed, targetType=blinds_order)`；状态用既有 `status` / `completedAt` / `OrderStatusLog`；通知用既有 `Notification`。

## 1. 做了什么

| 场景 | 改前 | 现在 |
|---|---|---|
| 安装工完成收口 | 没有任何人知道 | 会计 / 老板（持 `install.balance.confirm`）收到"待收尾款：客户（单号）"，点开直达会计页"待收尾款"并展开该单；该单销售收到"已装完：…"，点开是工艺单详情 |
| 会计看装完的单 | 没有入口；会计也打不开工艺单详情 | `/accounting` 新增"待收尾款"页签：单号 / 客户 / 销售 / 安装完成日 / 收口 n/m / 应收尾款；展开直接看每扇窗的收口照片 |
| 尾款已收 | 系统里没有地方记 | "确认收到尾款"：实收（预填应收）、方式（Cash / Visa / 支票 / Finance）、收款日期、备注；少收或多收必须写原因；确认后工艺单 → 已完成，销售收到"尾款已确认"；每单只确认一次（重复点击 / 两人同时点都只记一次） |
| 销售首页"待收尾款" | 本月签约报价的聚合公式（有一张有约定尾款时会漏算其他单） | 本月签约报价逐单应收之和，已确认尾款的单不再计入；与会计页同一口径（同一个函数） |
| 通知点得上 | — | 新的两类通知在头部铃铛下拉与通知页都用同一落点函数；测试里校验两处都调用它 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/authorization/permissions.ts`、`role-defaults.ts` | `install.balance.confirm`（确认收到尾款 / HIGH / ORG，数字员工禁区）；`accounting`、`owner` 绑定 |
| `src/lib/install/balance.ts`（新，纯） | `quoteBalanceDue`、`validateBalanceConfirm`、`balanceMismatch`、`parseBalanceRecord`、`sumBalanceDue`、`todayInTimeZone`、`installNotificationHref` |
| `src/lib/install/balance-service.ts`（新） | `loadLinkedQuotes`（生成审计反查报价）、`loadBalanceRecords`、`loadConfirmedQuoteIds`、`listBalance`、`confirmBalance`（advisory lock + 事务内审计 + 仅 installed 推进）、`notifyInstallCompleted` |
| `src/app/api/accounting/balance/route.ts`、`[orderId]/confirm/route.ts`（新） | GET 列表 / POST 确认 |
| `src/app/api/install/tasks/[id]/complete/route.ts` | 首次成功后完工通知 |
| `src/components/accounting/balance-tab.tsx`（新）、`accounting-view.tsx`、`src/app/(main)/accounting/page.tsx` | 页签、URL `?tab=` / `?order=`、照片、确认对话框、最近已确认 |
| `src/components/header.tsx`、`src/app/(main)/notifications/page.tsx` | 先调 `installNotificationHref` |
| `src/lib/notifications/constants.ts`、`delivery-gate.ts`、`src/components/notification/*` | 两个新类型登记、grandfather 时间、开关文案、图标 |
| `src/lib/sales/home/build-home.ts` | 待收尾款逐单口径 + 剔除已确认 |
| 测试 | `balance.test.ts`（纯 36）、`balance-db.isolated.test.ts`（隔离库 35）、`authorize.test.ts`（+15） |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/install/__tests__/balance.test.ts` | 36 passed |
| `npx tsx src/lib/authorization/__tests__/authorize.test.ts` | 174 passed（基线 159） |
| 隔离库 + 真实路由 `balance-db.isolated.test.ts` | 35 passed（见 §3.1） |
| INSTALL-2a 回归 `closeout*.test.ts` / `closeout-db.isolated.test.ts` | 见 §3.2 全量 |
| 浏览器走查（本地 `next dev` + Playwright，会计 / 销售两个会话） | 见 §3.3 |
| `npm run typecheck` | 0 error |
| `npm run test:ci` | PASS |
| `npm run lint:baseline` | PASS（相对基线 −14 error） |
| `bash scripts/check-test-registry.sh` | OK（463 注册） |
| `openspec validate install-2b-balance-confirm --strict` | valid |

### 3.1 隔离库端到端覆盖

收口 → 会计、老板各一条 `install_completed`（实体 `install_balance`）、销售一条（实体 `blinds_order`）、安装工无、标题摘要无金额、重复收口不重复；列表：销售 403、会计 200、排期中与他企业的单不出现、已完成未确认的单出现、应收 = 约定尾款、手工单应收为空、无成本 / 毛利 / 提成 / 联系方式 / 报价备注；确认：销售 403、他企业 404、未安装 409、金额 0 / mastercard / 未来日期 400、少收无说明 400 `NOTE_REQUIRED`、以上不改状态不写审计；会计确认 200 → completed、状态日志操作人为会计（无品类键）备注"尾款确认"、审计一条含报价 / 应收 / 实收 / 方式、销售收到无金额通知；重复确认 idempotent 且仍一条审计 / 一条状态日志 / 一条通知；并发两次只写一条；已 completed 的单确认后状态不变、不加状态日志；确认后离开 pending、进 recentConfirmed（含确认人）；销售首页两张各 1000、一张已确认 → 1000。

### 3.2 全量 `npm test`

隔离库、`NODE_OPTIONS=--max-old-space-size=8192`：**473/482**。9 个失败与 INSTALL-2a 报告记录的同一批完全一致、与本 change 无关：Mention Gateway M2-A Identity DB（`prisma db push` 不建迁移里的 CHECK 约束）、`sunny-process/autogen-db.isolated`（main 上同样 `NO_BINDING`）、Phase3A-3 Approvals Smoke、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Phase3A-5 Overview Acceptance、Autopilot A2-P0、T4 授标情报矩阵（本地库缺双租户种子）、报价 PDF 分页（无 Chromium 字体）。TypeScript 类型检查在套件内通过。自审修正列表截断顺序后复跑：`balance-db.isolated` 35/35、`closeout-db.isolated` 26/26、纯测试 36 / 16 / 27 / 15、`test:ci` PASS、`tsc` 0 error。

### 3.3 浏览器走查

| 步骤 | 结果 |
|---|---|
| 会计在通知页点"待收尾款"通知 | 跳到 `/accounting?tab=balance&order=<id>`，页签落在"待收尾款"，该行高亮并展开，2 张收口照片经文件代理加载，应收 $2,600.00、收口 2/2 |
| 确认对话框 | 实收预填 2600.00；改成 2500 → 按钮禁用并提示"必须写明原因"；写备注 → 可提交 → 该单移到"最近已确认"（实收 $2,500.00，标出应收 $2,600.00、确认人、备注） |
| 头部铃铛下拉点同一通知 | 同一落点；该单已确认时页面提示"尾款已于…确认" |
| 销售在通知页点"已装完"通知 | 打开工艺单详情（创建人可读） |
| 销售打开 `/accounting?tab=balance` | 被重定向，看不到"待收尾款" |
| 只持 `bids` 的人打开 `/accounting?tab=balance`（spec「无权页签的 URL 参数」） | **未在浏览器里单独走**：页签选择是"URL 指定且可见 → 否则第一个可见页签"（`accounting-view.tsx` load 内），`balance` 接口对 bids 返回 403 → 页签不可见 → 落到"项目结算"；按代码审查判定 |

截图：`docs/install-2b-screenshots/01-balance-tab.png`、`02-confirm-dialog-mismatch.png`、`03-after-confirm.png`、`04-bell-landing.png`、`05-sales-order-detail.png`。

## 4. 判断点（审核请重点看）

1. **"已确认"看记录不看状态**（D2）：出单仍可按品类键把单手动推到"已完成"；这样的单仍留在"待收尾款"里，直到会计确认。
2. **会计推进"已完成"不要品类键**（`fulfillment/order-category-access` 增量）：只经尾款确认接口，且要 `install.balance.confirm`。
3. **收款方式不含 e-transfer**（D10）：方案 Q6 原建议加；读代码发现定金登记已有意下线 e-transfer，本 change 沿用定金四种，方案 §12 已改。要加回请告诉我。
4. **销售首页数字会变**（D3）：逐单口径修掉了旧聚合在"部分报价有约定尾款"时的漏算；再加上剔除已确认，数字会和改前不同。
5. **差额允许**（D9）：少收 / 多收写原因即可确认，记录同时留应收与实收。
6. **列表先剔除再截断**：先取全部已安装 / 已完成单的 id 去掉已确认的，再取前 200 条明细——已完成的单越积越多，先截断会让老的未确认单掉出列表（自审时发现并修正）。

## 5. 已知限制

- `install.balance.confirmed` 加入不可清理清单（与 `install.window.completed`、`blinds_order_unit` 同）。
- 报价反查用 `afterData contains "orderId":"<id>"`（限定 action + targetType）；量很大时再给生成审计补 `orgId` 过滤。
- 既有通知类型在铃铛与通知页的落点差异未改（已另提任务卡）。
- 没有撤销确认的入口；登记错了需要老板在审计中心看记录后线下更正（v2 视需要再做撤销审批）。

## 6. 上线动作

- 合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（`accounting` / `owner` 新增 `install.balance.confirm`）。
- 此前已安装的单会直接出现在"待收尾款"，会计按实际逐单确认。
- 合并后独立小 PR `/opsx:archive install-2b-balance-confirm --yes`，TASKFLOW INSTALL-2b → `[x]`；之后 propose `install-2c-warranty-email`。
