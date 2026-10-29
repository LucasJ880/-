# Tasks

## 1. 纯函数

- [ ] 1.1 `repair.ts`：关闭原因扩为 `completed / superseded / voided / waived` 并带原因说明（D1）；"是否在返修预约上提交"判定；`repairActions` 加 `canVoid / canClose`、`voidDecision / closeDecision`（D5）；原因校验（必填、≤ 500 字）；逾期选择与摘要（目标日、已过天数、卡点，D7）；`repair.test.ts` 覆盖 spec「维修单作废的条件」「关闭不返修」判定部分、「维修单逾期提醒」选择规则、「维修单的进度与可执行操作」。verify：`npx tsx src/lib/install/__tests__/repair.test.ts` 0 失败。

## 2. 服务与接口

- [ ] 2.1 `POST /api/install/repairs/[id]/void`（D2：按工艺单加锁复核；关闭事件 `voided`；取消未完成的返修预约；提交预约 `completed → scheduled`；工艺单指回、恢复安装日期）；`loadRepairForAppointment` 与提交维修单幂等查找跳过已作废（D4）；任务详情带已作废维修单（单号、原因）。verify：`npm run typecheck` 0 error；用例在 2.5。
- [ ] 2.2 `POST /api/install/repairs/[id]/close`（D3：关闭事件 `waived`；取消返修预约、工艺单指回；无其他未关闭维修单时 `scheduled → installed` + 状态日志 + `notifyInstallCompleted`）；`completeReturnVisit` 锁内复核预约已取消 / 维修单已关闭 → 409（D5）。verify：`npm run typecheck` 0 error；2a–2e 隔离库测试仍全过。
- [ ] 2.3 通知（D8）：`install_repair_closed`、`install_repair_overdue` 登记类型表 / 引入日期 2026-10-29 / 开关文案 / 图标；作废与关闭不返修的收件人与落点；维修单详情 / 列表接口带关闭原因、原因说明、操作人与 `canVoid / canClose`，已关闭不标已过目标日；`balance.test.ts` 补两个类型的落点断言。verify：`npx tsx src/lib/install/__tests__/balance.test.ts` 0 失败。
- [ ] 2.4 逾期提醒（D6 / D7）：服务层按企业选出逾期维修单并通知（`dedupeKey` = 维修单 id + 企业时区日期）；在 `src/app/api/cron/daily-brief/route.ts` 每个企业的循环里加独立一步（自己的 try/catch，结果字段 `repairOverdueSent`），不改 `vercel.json` 与自动化登记表。verify：`npm run typecheck` 0 error；`git diff --stat -- vercel.json src/lib/automation/registry.ts` 为空。
- [ ] 2.5 新建 `src/lib/install/__tests__/repair-close-db.isolated.test.ts`（真实路由 + 隔离库，岗位：安装工 ×2、出单·Vinyl / 布帘 / Roller、运营主管、会计、老板、销售）覆盖 spec 中标注该文件的全部场景：作废（无权 / 缺原因 / 已关闭 / 返修中提交的 / 并发 / 未排 / 已排）→ 重新打开任务补完收口 → 已安装 → 待收尾款；作废后再提交得新单号；关闭不返修（已排 / 未排）→ 待收尾款；每个收件人点得上；逾期提醒五个场景；岗位 × 四个写接口"列出 ⇔ 2xx"；注册 `scripts/test-all.sh`。verify：本地隔离库 0 失败；`bash scripts/check-test-registry.sh` 通过。

## 3. 页面

- [ ] 3.1 维修单详情：「作废维修单」「关闭不返修」按接口返回的可执行操作显示，各一个必填原因的对话框（写明会取消返修预约 / 重新打开首装任务 / 转已安装）；关闭横幅显示原因、原因说明与操作人；列表进度列显示关闭原因；安装任务页显示"维修单 R-… 已作废：<原因>"；本地 Playwright：运营主管作废 → 安装工点通知、补完收口；运营主管关闭不返修 → 会计"待收尾款"出现该单，截图存 `docs/install-2f-screenshots/`。verify：`npx eslint src/components/install` 0 error；走查全部检查通过。

## 4. 收尾

- [ ] 4.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate install-2f-repair-close --strict` 通过；写 `docs/QINGYAN_INSTALL-2f_REPORT.md` + `docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2f 改 `[G]` + 任务书 §4.7（所选定时任务）与 §7（关闭原因代替 `.cancelled`）记录 + 更新 `docs/QINGYAN_INSTALL-2_HANDOFF.md`。verify：四条命令退出 0；`grep -c "INSTALL-2f .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- 2d、2e PR 合并后本 change 才能开 PR（可与 2d + 2e 同批上线）。
- 归档顺序：必须在 `install-2d-repair-form`、`install-2e-repair-dispatch` 归档之后 `/opsx:archive install-2f-repair-close --yes`（`installation/repairs` 由 2d 新建、「维修单的进度与可执行操作」由 2e 新增），TASKFLOW INSTALL-2f 改 `[x]`。
- INSTALL-2 至此全部完成；之后按交接文档依次开 2b / 2c / 2d+2e / 2f PR。
