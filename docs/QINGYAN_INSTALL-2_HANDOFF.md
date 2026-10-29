# INSTALL-2 · 交接（HANDOFF）

> 新会话从这里进。先读本文件，再读任务书，不凭记忆重写；任何"现状"以本文 §3 的文件行号为准，打开核对后再动手。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-10-29（会话：INSTALL-2 交付流水线 + INSTALL-2g；Lucas："官网新条款已经开始了，shutters 的质保按照最新的来，链接保留，报修邮箱用 service@，同时 cc miki@"） |
| 任务书（方案） | `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` |
| 邮件模板 | `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` |
| 前置 | INSTALL-1（#268，已 archive：`openspec/specs/installation/{install-tasks,window-closeout}`）；PERM-3 品类（`fulfillment/order-category-access`）；PERM-5a 会计视图（`accounting/*`） |
| 分支 | `claude/vigilant-edison-73bk9i`（一个 change 一个 PR，archive 独立小 PR）。INSTALL-2a–2f 已合并并归档；INSTALL-2g 见 §0 |
| OpenSpec CLI | 未装进依赖：`OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 <cmd>`；archive 用 `openspec archive <change> --yes` |
| 状态 | INSTALL-2a–2f 完成（合并 + archive，TASKFLOW `[x]`）；**INSTALL-2g**（官网新质保条款 / 报修联系方式 / 质保邮件抄送）实施完成，见 §0；上线前置与后续见 §1 |

## 0. 交付流水线（每个 PR 合并后更新本表）

| change | 实施 | PR | archive PR | TASKFLOW |
|---|---|---|---|---|
| 2a `install-2a-closeout-all-lines` | 已完成（报告 `docs/QINGYAN_INSTALL-2a_REPORT.md`） | [#304](https://github.com/LucasJ880/-/pull/304) 已合并 | [#310](https://github.com/LucasJ880/-/pull/310) 已合并（`openspec/changes/archive/2026-10-29-install-2a-closeout-all-lines`） | `[x]` |
| 2b `install-2b-balance-confirm` | 已完成（报告 `docs/QINGYAN_INSTALL-2b_REPORT.md`；含 Q11 修正） | [#313](https://github.com/LucasJ880/-/pull/313) 已合并 | [#315](https://github.com/LucasJ880/-/pull/315) 已合并（`openspec/changes/archive/2026-10-29-install-2b-balance-confirm`） | `[x]` |
| 2c `install-2c-warranty-email` | 已完成（报告 `docs/QINGYAN_INSTALL-2c_REPORT.md`） | [#318](https://github.com/LucasJ880/-/pull/318) 已合并 | [#319](https://github.com/LucasJ880/-/pull/319) 已合并（`openspec/changes/archive/2026-10-29-install-2c-warranty-email`） | `[x]` |
| 2d `install-2d-repair-form` | 已完成（报告 `docs/QINGYAN_INSTALL-2d_REPORT.md`） | [#320](https://github.com/LucasJ880/-/pull/320) 已合并 | [#322](https://github.com/LucasJ880/-/pull/322) 已合并（`openspec/changes/archive/2026-10-29-install-2d-repair-form`） | `[x]` |
| 2e `install-2e-repair-dispatch` | 已完成（报告 `docs/QINGYAN_INSTALL-2e_REPORT.md`） | [#321](https://github.com/LucasJ880/-/pull/321) 已合并（与 2d 同批） | [#324](https://github.com/LucasJ880/-/pull/324) 已合并（`openspec/changes/archive/2026-10-29-install-2e-repair-dispatch`） | `[x]` |
| 2f `install-2f-repair-close` | 已完成（报告 `docs/QINGYAN_INSTALL-2f_REPORT.md`） | [#325](https://github.com/LucasJ880/-/pull/325) 已合并 | [#329](https://github.com/LucasJ880/-/pull/329) 已合并（`openspec/changes/archive/2026-10-29-install-2f-repair-close`） | `[x]` |
| 2g `install-2g-warranty-update` | 已完成（报告 `docs/QINGYAN_INSTALL-2g_REPORT.md`） | 本 PR | — | `[G]` |

- 每个 PR：基于最新 main → cherry-pick 该 change 的提交 → 本地跑 typecheck / lint:baseline / test:ci / registry / validate --strict 与该 change 的隔离库测试 → 推送开 PR → CI 绿后合并 → `openspec archive <change> --yes`（在最新 main 上重跑，不 cherry-pick 旧的 archive 结果，避免和别的会话同时改的主规格冲突）+ TASKFLOW `[x]` + 本表 → archive PR。
- 文档冲突（TASKFLOW / 本文件 / 任务书）一律以 main 上的现状为底，再按本表改状态；代码冲突逐块看，不整文件取一边。
- 归档顺序 2a → 2b → 2c → 2d → 2e → 2f（2e / 2f 的增量依赖 2d 新建的 `installation/repairs`、`installation/install-stage`）。
- **2d 与 2e 同批上线**：2d 合并后不等别的，紧接着开 2e PR。
- 上线前老板要做（2c 报告 §5、2g 报告 §5）：设置 → 邮件 → 组织发件人；会计「待收尾款」→「质保设置」核对（2g 起报修电话 / 邮箱 / 抄送已预填；若该企业保存过设置，Shutters 与抄送要手改）。

## 1. 下一步

INSTALL-2 的 6 个 change 已全部合并归档（§0）。剩下的都不是代码：

1. **上线前老板做**（2c 报告 §5、2g 报告 §5）：设置 → 邮件 → 组织发件人（没配置时质保邮件失败 `NO_ORG_SENDER`，不会回落个人邮箱）；会计「待收尾款」→「质保设置」打开看一眼：显示"当前为默认值"则无需操作（Shutters 1 / 15 / 25、报修电话 647-857-8669、邮箱 service@sunnyshutter.ca、抄送 miki@sunnyshutter.ca 已预填）；若已保存过，把 Shutters 改为人工 1 / 部件 15 / 框架与叶片 25 并填抄送。
2. **岗位绑定核对**：会计 / 老板持 `install.balance.confirm`；运营主管 / 会计持 `install.task.assign`（排返修、作废、关闭不返修）；三个出单岗按品类持 `orders.fulfillment.update.<品类>`。按 `role-defaults.ts` 种子落地的企业已满足，手工改过岗位的企业需核对。
3. **官网质保新条款**（原文转录与对比见 `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` §0a）：Lucas 2026-10-29 确认已生效，Shutters 按新条款、链接保留、报修邮箱 service@sunnyshutter.ca、抄送 miki@sunnyshutter.ca → **INSTALL-2g 已实现**（报告 `docs/QINGYAN_INSTALL-2g_REPORT.md`）。仍未做（Lucas 本次只定了 Shutters）：帘类 / 窗帘按新条款细分（无绳升降机构 3 年、电机 5、电机配件 5、电池 1）及报价单帘类文字。Q0 已确认是 U-Haul（2026-10-29）。
4. **可选后续**（各报告"已知限制"）：维修单列表分页（现取最近 200 张）；逾期提醒升级 / 发给出单岗；已关闭维修单撤销；客户返修时间确认邮件（出站需走审批）；质保 PDF 附件。都需另开 change。

## 2. 外部信息的可信度（防幻觉）

| 信息 | 状态 | 怎么补 |
|---|---|---|
| `sunnyshutter.ca/warranty-service/` 原文 | **已核实**（Lucas 2026-10-29 截图；网络策略仍拒绝该域名）：页面是修订草案，只适用于采纳它的新订单 | 转录见邮件模板文档 §0a |
| 官网质保年限 | **已核实，已生效**（Lucas 2026-10-29）：Shutters 框架与叶片 25、面料 5、手动部件 15（无绳升降 3）、电机 / 配件 5、电池 1、人工 1 | Shutters 已按新条款（INSTALL-2g）；帘类细分未做 |
| 报价 PDF 质保（帘类 1/5/15；Shutters 2g 起 1/15/25） | **仓库已核实**（`quote-pdf.ts:99,128,166`；`warranty.test.ts` 与种子交叉比对） | — |
| "U-HEAL" | **已确认**：即 U-Haul 自助还车（Lucas 2026-10-29；任务书 §2、§12 Q0） | — |
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
- 本仓库在沙箱里是浅克隆：从 main 重建分支后 `git push --force-with-lease` 可能被 GitHub 以 "missing necessary objects" 拒收。上一个 PR 刚合并、main 上没有别的提交时，直接在远端分支头（与 main 同树）上 cherry-pick 后快进推送即可；main 有别人的提交时先 `git fetch --deepen` 再试。
- 容器会重启（磁盘保留）：重启后本地 Postgres 不会自动起来，按上面的 `pg_ctl ... start` 再起一次。
- 本地 `next dev` 走查：main 上的运行环境防护（`src/lib/env/runtime-isolation.ts`）在 development 下要求显式放行数据库，否则所有写入（含建审批）静默失败；起 dev server 时加 `QINGYAN_ALLOWED_DB_ENDPOINT_PREFIXES=127`（只放行本机库）。
- 隔离库测试里模拟"以后某天"时，按企业时区日期构造（如企业今天的 `T17:00:00.000Z` 再加 N 天），不要用 `Date.now() + N 天`：多伦多午夜前后或跨夏令时会差一天（2f 开 PR 前复跑踩到，见 2f 报告）。
- 杀掉 dev server 后 `npm run typecheck` 若报 `.next/dev/types/validator.ts` 语法错，是 dev server 写到一半的生成文件（`tsconfig` 包含 `.next/dev/types/**`），删掉 `.next/dev/types` 再跑；沙箱里 `tsc` 需 `NODE_OPTIONS=--max-old-space-size=8192`。

## 5. 本会话做了什么

| 产物 | 说明 |
|---|---|
| `docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` | 方案：现状 F1–F15、两条业务流、U-Haul 借鉴、通知矩阵、零 schema 落点、4 个 change 拆分、交叉验证 V1–V9、待拍板 Q0–Q10 |
| `docs/QINGYAN_INSTALL-2_WARRANTY_EMAIL_TEMPLATE.md` | 完工 + 质保邮件英文模板与变量表；条款来源冲突表 |
| `docs/QINGYAN_PERMISSION_TASKFLOW.md` | 新增 INSTALL-2 段（2a–2d，状态 `[ ]`） |
| 代码（INSTALL-2g） | `warranty.ts` 新部件 `frame`（Frame & Panels / 框架与叶片）、种子 Shutters 1 / 15 / 25 + 报修电话 / 邮箱 + 抄送、`cc` 校验与 `warrantyCcProblem`；`warranty-service.ts` 审批内容与预览带抄送；执行器按审批抄送发送、审计记抄送；`trade/email.ts` / `email-sender.ts` 透出抄送；`warranty-panel.tsx` 抄送输入框与预览抄送；`quote-pdf.ts` Shutters 质保文字；测试 3 个扩充（`email-sender.test.ts` 登记并移出欠账基线） |
| 代码（INSTALL-2f） | `repair.ts` 关闭原因（completed / superseded / voided / waived）与原因说明、`voidDecision / closeDecision`、`canVoid / canClose`、逾期选择与摘要；`repair-service.ts` `closeRepair`（作废 / 关闭不返修，锁内复核）、按预约取维修单跳过已作废、`completeReturnVisit` 锁内复核、`notifyRepairClosed`、`remindOverdueRepairs`；`POST /api/install/repairs/[id]/{void,close}`；任务详情带已作废维修单；`daily-brief` 每个企业加逾期提醒一步；维修单详情两个对话框与关闭横幅；两个通知类型；测试 1 个新（已注册）+ 2 个扩充 |
| 代码（INSTALL-2e） | `repair.ts` 事件流进度 / 可执行操作 / 收口范围、`stage.ts` `repair_scheduled`、`repair-service.ts` 出单登记 / 排返修 / 返修收口 / superseded、`service.ts` `loadOrdersForTasks` 与 `returnRepair`、`POST /api/install/repairs/[id]/{factory-issued,schedule}`、任务 / 收口 / 拍照 / 问题路由按范围、照片代理放行任一安装预约（F5）、维修单详情出单卡 / 排期卡 / 两个对话框、返修任务标识、两个通知类型；测试 1 个新（已注册）+ 4 个扩充 |
| 代码（INSTALL-2d） | `src/lib/install/{repair,stage,repair-service}.ts`、收口聚合读问题记录、`/api/install/tasks/[id]/items/[itemId]/issue`、`/api/install/tasks/[id]/repair`、`/api/install/repairs/**`、`/api/blinds-orders/[id]/install-status`、安装工任务页有问题表单与维修单对话框、`/install/repairs/**`（列表 / 详情 / 打印）、工艺单安装状态卡与收口标签按状态；测试 3 个新（已注册）+ 2 个扩充 |
| 代码（INSTALL-2c） | `src/lib/install/warranty{,-service}.ts`、`src/lib/pending-actions/exec-install-warranty-email.ts` + executor / types / 微信策略登记、`src/app/api/install/warranty-settings`、`src/app/api/accounting/balance/[orderId]/warranty`、确认 / 列表接口带质保状态、`src/components/accounting/warranty-panel.tsx` + 确认对话框第二步、收口单元带品类、两个通知类型；测试 2 个新（已注册）+ 3 个扩充 |
| 代码（INSTALL-2b） | `src/lib/install/balance{,-service}.ts`、`src/app/api/accounting/balance/**`、`src/components/accounting/balance-tab.tsx` + 会计页 URL 页签、`/complete` 完工通知、两个通知类型登记与落点、销售首页待收尾款口径、`install.balance.confirm`；测试 2 个（已注册）+ authorize +15 |
| 代码（INSTALL-2a） | `src/lib/install/{closeout,service}.ts`、`src/app/api/install/tasks/**`、`src/components/install/*`、`blinds-orders/[id]/page.tsx` 收口标签；测试 2 个（已注册） |
