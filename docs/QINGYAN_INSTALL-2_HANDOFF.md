# INSTALL-2 · 交接（HANDOFF）

> 新会话从这里进。先读本文件，再读任务书，不凭记忆重写；任何"现状"以本文 §3 的文件行号为准，打开核对后再动手。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-10-28（会话：Sunny FDE 安装后二分流程方案） |
| 任务书（方案） | `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` |
| 邮件模板 | `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` |
| 前置 | INSTALL-1（#268，已 archive：`openspec/specs/installation/{install-tasks,window-closeout}`）；PERM-3 品类（`fulfillment/order-category-access`）；PERM-5a 会计视图（`accounting/*`） |
| 分支 | `claude/vigilant-edison-73bk9i`（本会话，只含文档） |
| OpenSpec CLI | 未装进依赖：`OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 <cmd>` |
| 状态 | 方案已拍板（2026-10-28：质保以报价单为准，其余按建议，见任务书 §12）。**INSTALL-2a 已实施**（tasks 6/6；纯 27 + 隔离库 26 + 浏览器走查全过；typecheck / lint:baseline / test:ci / registry / validate --strict 全绿；报告 `docs/QINGYAN_INSTALL-2a_REPORT.md`；TASKFLOW `[G]`），待 PR 合并 → archive → propose 2b |

## 1. 下一步（按顺序）

1. ~~拍板~~（已完成，任务书 §12）。
2. ~~2a propose + apply~~（已完成，见报告）。下一步：2a 开 PR → 合并 → 独立小 PR `/opsx:archive install-2a-closeout-all-lines --yes`（TASKFLOW `[x]`）→ `/opsx:propose install-2b-balance-warranty`。
3. 2a 合并 + archive 后依次 2b（尾款 + 质保邮件）→ 2c（维修单）→ 2d（出单 + 二次安装 + 逾期提醒）。每个 change 一个 PR，archive 独立小 PR，同步 `docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2 段状态列。

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

## 5. 本会话做了什么

| 产物 | 说明 |
|---|---|
| `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` | 方案：现状 F1–F15、两条业务流、U-Haul 借鉴、通知矩阵、零 schema 落点、4 个 change 拆分、交叉验证 V1–V9、待拍板 Q0–Q10 |
| `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` | 完工 + 质保邮件英文模板与变量表；条款来源冲突表 |
| `docs/QINGYAN_PERMISSION_TASKFLOW.md` | 新增 INSTALL-2 段（2a–2d，状态 `[ ]`） |
| 代码（INSTALL-2a） | `src/lib/install/{closeout,service}.ts`、`src/app/api/install/tasks/**`、`src/components/install/*`、`blinds-orders/[id]/page.tsx` 收口标签；测试 2 个（已注册） |
