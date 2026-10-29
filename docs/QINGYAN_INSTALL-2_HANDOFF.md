# INSTALL-2 · 交接（HANDOFF）

> 新会话从这里进。先读本文件，再读任务书，不凭记忆重写；任何"现状"以本文 §3 的文件行号为准，打开核对后再动手。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-10-29（会话：INSTALL-2 交付流水线，Lucas："#304 合并，开始 2f，继续任务书，不用问我"） |
| 任务书（方案） | `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` |
| 邮件模板 | `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` |
| 前置 | INSTALL-1（#268，已 archive：`openspec/specs/installation/{install-tasks,window-closeout}`）；PERM-3 品类（`fulfillment/order-category-access`）；PERM-5a 会计视图（`accounting/*`） |
| 分支 | `claude/vigilant-edison-73bk9i`：每个 PR 合并后从 main 重建，再带上下一个 change（一个 change 一个 PR，archive 独立小 PR）。尚未进 main 的 change 提交在本会话容器的本地工作树 `/home/user/i2b`（分支 `local/install-2b`，未推送） |
| OpenSpec CLI | 未装进依赖：`OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 <cmd>`；archive 用 `openspec archive <change> --yes` |
| 状态 | 见 §0 交付流水线 |

## 0. 交付流水线（每个 PR 合并后更新本表）

| change | 实施 | PR | archive PR | TASKFLOW |
|---|---|---|---|---|
| 2a `install-2a-closeout-all-lines` | 已完成（报告 `docs/QINGYAN_INSTALL-2a_REPORT.md`） | [#304](https://github.com/LucasJ880/-/pull/304) 已合并 | [#310](https://github.com/LucasJ880/-/pull/310) 已合并（`openspec/changes/archive/2026-10-29-install-2a-closeout-all-lines`） | `[x]` |
| 2b `install-2b-balance-confirm` | 已完成（报告 `docs/QINGYAN_INSTALL-2b_REPORT.md`；含 Q11 修正） | [#313](https://github.com/LucasJ880/-/pull/313) 已合并 | [#315](https://github.com/LucasJ880/-/pull/315) 已合并（`openspec/changes/archive/2026-10-29-install-2b-balance-confirm`） | `[x]` |
| 2c `install-2c-warranty-email` | 已完成（报告 `docs/QINGYAN_INSTALL-2c_REPORT.md`） | [#318](https://github.com/LucasJ880/-/pull/318) 已合并 | 本 PR（`openspec/changes/archive/2026-10-29-install-2c-warranty-email`） | `[x]` |
| 2d `install-2d-repair-form` | 已完成（本地 `7693196` `078c853`） | 待开（与 2e 背靠背合并） | — | `[G]` |
| 2e `install-2e-repair-dispatch` | 已完成（本地 `a944219` `bc01286`） | 待开 | — | `[G]` |
| 2f `install-2f-repair-close` | 已 propose（本地 `a34f83d`），实施中 | — | — | `[~]` |

- 每个 PR：从 main 重建分支 → cherry-pick 该 change 的本地提交 → 本地跑 typecheck / lint:baseline / test:ci / registry / validate --strict 与该 change 的隔离库测试 → 推送开 PR → CI 绿后合并 → 从 main 重建 → `openspec archive <change> --yes` + TASKFLOW `[x]` + 本表 → archive PR。
- 文档冲突（TASKFLOW / 本文件 / 任务书）一律以 main 上的现状为底，再按本表改状态；代码冲突逐块看，不整文件取一边。
- 归档顺序 2a → 2b → 2c → 2d → 2e → 2f（2e / 2f 的增量依赖 2d 新建的 `installation/repairs`、`installation/install-stage`）。
- **2d 与 2e 同批上线**：2d 合并后不等别的，紧接着开 2e PR。
- 上线前老板要做两件事（2c 报告 §5）：设置 → 邮件 → 组织发件人；会计「待收尾款」→「质保设置」填报修电话 / 邮箱。

## 1. 下一步（按顺序）

1. ~~拍板~~（已完成，任务书 §12）。
2. ~~2a~~（#304 已合并；archive #310 已合并）。
3. 按 §0 依次：2b PR → 2b archive → 2c PR → 2c archive → 2d PR → 2e PR → 2d archive → 2e archive → 2f（apply 完成后）PR → 2f archive。
4. 原 2b 已拆为 2b（尾款确认）/ 2c（质保邮件），原 2c / 2d 顺延为 2d（维修单）/ 2e（返修排期），2e 又拆出 2f（作废 / 关闭不返修 / 逾期提醒），见任务书 §9。

## 2. 外部信息的可信度（防幻觉）

| 信息 | 状态 | 怎么补 |
|---|---|---|
| `sunnyshutter.ca/warranty-service/` 原文 | **未读到**（会话网络策略拒绝该域名） | 环境设置里放行 `sunnyshutter.ca` 后用 WebFetch 读原文；或 Lucas 直接贴条款 |
| 官网质保年限（Shutters 25 年 / 其它 5 年） | 只有搜索摘要，来自 `warranty-registration` 页 | 同上；与报价 PDF 冲突，见任务书 §3.4 |
| 报价 PDF 质保（帘类 1/5/15，Shutters 1/5） | **仓库已核实**（`quote-pdf.ts:99,128,166`） | — |
| "U-HEAL" | 全网 / 仓库都没找到；按 U-Haul 自助还车理解（任务书 §2） | 等 Lucas 确认 Q0 |
| U-Haul 自助还车流程 | 检索摘要（`uhaul.com` 也被网络策略拒绝） | 只作借鉴，不进规格 |
| 维修单纸质模板字段 | **已确认**（用户上传 PDF：Name / Order# / Taken by / Phone / Notes / # Location Description ×10 / Filling Date；抬头 SUNNY SHUTTER INC, 2-680 Progress Avenue, Scarborough, ON M1H 3A5） | — |

规则：没核实的条款**不得**写进规格、种子或邮件正文；代码遇到未配置的质保品类一律阻断，不给默认值。

## 3. 已核实的代码事实（2026-10-28，main @ 7e2a9a5）

任务书 §0 F1–F15 是完整表。最关键的五条：

- **F2 零窗单收不了口**：`src/lib/install/closeout.ts:104` `allCompleted: windows.length > 0 && …`；收口单元只取 `BlindsOrderItem`，ProcessSpec 段（`src/lib/sunny-process/process-spec.ts:94-104`：domestic / drapes / vinyl / purchase，各行都有 `location`，**没有稳定 id**）不计入。
- **F3 完工后什么都没发生**：`src/app/api/install/tasks/[id]/complete/route.ts` 只改预约 + 工艺单 `installed`，无通知 / 邮件；没人能把 `installed` 推到 `completed`。
- **F5 一单一个预约槽**：`loadCloseoutLogs`（`src/lib/install/service.ts:149-161`）不按预约过滤；照片代理（`src/app/api/files/[...path]/route.ts:102-124`）只认当前 `appointmentId` 的被分配人。
- **F7 会计没有推进权**：`role-defaults.ts:281-297` 会计无品类键；规格 `fulfillment/order-category-access` 要求推进 `completed` 持品类键 → 2b 需要规格增量写例外。
- **F8 出站审批链路**：`requestApproval()`（`src/lib/approval/request.ts:169-197`，`idempotencyKey` 必填）→ `executePendingAction`（`src/lib/pending-actions/executor.ts`，按 type switch）；发信样板 `src/lib/pending-actions/exec-sales-inquiry-reply.ts:61-86`；建审批不会自动给批准人发站内通知。

## 4. 不要做的事

- 不加 Prisma 字段 / 模型 / 状态机状态（纪律 1）；返修期间工艺单保持 `scheduled`，细分状态由审计事件推导。
- 不让质保邮件直发；必须 PendingAction，批准前零出站（纪律 2）。不要模仿现有发报价 / 签字回执邮件的直发写法（那是既有偏差，见任务书 §13）。
- 不新增 cron 条目 / 队列；逾期提醒挂既有每日 cron（纪律 3）。
- 邮件、维修单打印版、销售状态卡不出任何金额（任务书 §8 纪律 4 行）。
- 不清理 `install.*` 系列 AuditLog（INSTALL-1 + 任务书 §7 清单）。
- 改 `Organization.settingsJson` 时只动 `sunnyWarranty` 键，不整对象覆盖（会抹掉 `sunnyProcess` / `tenderRfq`）。
- 通知链接不要指向收件人进不去的页面；会计页签先支持 URL 参数再发带 `?tab=` 的链接（F11）。

## 4b. 本地隔离库（复跑端到端用）

```bash
apt-get install -y postgresql-16-pgvector   # 沙箱默认没有 pgvector，schema 需要
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/i2a -U postgres --auth=trust -E UTF8 && \
  /usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/i2a -o '-p 55432 -k /var/lib/postgresql' -l /var/lib/postgresql/i2a.log start && \
  /usr/lib/postgresql/16/bin/createdb -h 127.0.0.1 -p 55432 -U postgres qy_i2a"
export DATABASE_URL=postgresql://postgres@127.0.0.1:55432/qy_i2a DIRECT_URL=$DATABASE_URL
npx prisma db push --skip-generate
NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/install/__tests__/closeout-db.isolated.test.ts
```

`db push` 不建迁移里的原生 CHECK 约束，所以 Mention Gateway M2-A Identity DB 在这种库上有 3 条环境性失败（见 2a 报告 §3）。

页面走查（`next dev` 连这个库）：

- 必须带 `QINGYAN_ALLOWED_DB_ENDPOINT_PREFIXES=127`：development 运行时对未登记的库一律判 `DB_PLANE_MISMATCH`，建审批会被 `assertNonProdSideEffectsAllowed("write")` 拒掉，页面只显示"创建待确认草稿失败"（2c 走查踩过）。
- 工作树里的 `node_modules` 要用 `cp -al` 硬链接副本，不能是指向工作树外的软链接（Turbopack 报 "Symlink node_modules points out of filesystem root"）。
- Playwright 脚本放在 scratchpad 目录里跑（用预装的 Playwright / 浏览器）；项目自带的 Playwright 没有浏览器。
- 停 dev server 按 PID 杀；`pkill -f` 会匹配到自己的 shell。
- 杀掉 dev server 后 `npm run typecheck` 若报 `.next/dev/types/validator.ts` 语法错，是 dev server 写到一半的生成文件（`tsconfig` 包含 `.next/dev/types/**`），删掉 `.next/dev/types` 再跑；沙箱里 `tsc` 需 `NODE_OPTIONS=--max-old-space-size=8192`。

## 5. 本会话做了什么

| 产物 | 说明 |
|---|---|
| `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` | 方案：现状 F1–F15、两条业务流、U-Haul 借鉴、通知矩阵、零 schema 落点、4 个 change 拆分、交叉验证 V1–V9、待拍板 Q0–Q10 |
| `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` | 完工 + 质保邮件英文模板与变量表；条款来源冲突表 |
| `docs/QINGYAN_PERMISSION_TASKFLOW.md` | 新增 INSTALL-2 段（2a–2d，状态 `[ ]`） |
| 代码（INSTALL-2e） | `repair.ts` 事件流进度 / 可执行操作 / 收口范围、`stage.ts` `repair_scheduled`、`repair-service.ts` 出单登记 / 排返修 / 返修收口 / superseded、`service.ts` `loadOrdersForTasks` 与 `returnRepair`、`POST /api/install/repairs/[id]/{factory-issued,schedule}`、任务 / 收口 / 拍照 / 问题路由按范围、照片代理放行任一安装预约（F5）、维修单详情出单卡 / 排期卡 / 两个对话框、返修任务标识、两个通知类型；测试 1 个新（已注册）+ 4 个扩充 |
| 代码（INSTALL-2d） | `src/lib/install/{repair,stage,repair-service}.ts`、收口聚合读问题记录、`/api/install/tasks/[id]/items/[itemId]/issue`、`/api/install/tasks/[id]/repair`、`/api/install/repairs/**`、`/api/blinds-orders/[id]/install-status`、安装工任务页有问题表单与维修单对话框、`/install/repairs/**`（列表 / 详情 / 打印）、工艺单安装状态卡与收口标签按状态；测试 3 个新（已注册）+ 2 个扩充 |
| 代码（INSTALL-2c） | `src/lib/install/warranty{,-service}.ts`、`src/lib/pending-actions/exec-install-warranty-email.ts` + executor / types / 微信策略登记、`src/app/api/install/warranty-settings`、`src/app/api/accounting/balance/[orderId]/warranty`、确认 / 列表接口带质保状态、`src/components/accounting/warranty-panel.tsx` + 确认对话框第二步、收口单元带品类、两个通知类型；测试 2 个新（已注册）+ 3 个扩充 |
| 代码（INSTALL-2b） | `src/lib/install/balance{,-service}.ts`、`src/app/api/accounting/balance/**`、`src/components/accounting/balance-tab.tsx` + 会计页 URL 页签、`/complete` 完工通知、两个通知类型登记与落点、销售首页待收尾款口径、`install.balance.confirm`；测试 2 个（已注册）+ authorize +15 |
| 代码（INSTALL-2a） | `src/lib/install/{closeout,service}.ts`、`src/app/api/install/tasks/**`、`src/components/install/*`、`blinds-orders/[id]/page.tsx` 收口标签；测试 2 个（已注册） |
