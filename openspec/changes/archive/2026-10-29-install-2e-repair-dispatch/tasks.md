# Tasks

## 1. 纯函数

- [x] 1.1 `repair.ts`：维修单事件（出单登记 / 排期 / 关闭）解析与 `repairProgress`（已登记 / 待登记品类、"待确认"品类、预计备好日、返修排期、是否关闭，D1 / D2）、`repairActions`（可登记品类、能否排返修，D9）、出单登记与排返修入参校验；`stage.ts`：维修单输入改为 `{ pendingFactory, scheduled }`，加 `repair_scheduled` 与销售文案（D8）；`repair.test.ts`、`stage.test.ts` 覆盖 spec「出单确认按品类登记」（判定部分）「安装阶段推导」「阶段文案」与可执行操作。verify：两个测试 0 失败。
- [x] 1.2 任务收口范围（D4）：返修预约识别与"范围 = 维修单行的单元"纯函数 + 服务层 `loadTaskScope`；`installNotificationHref` 加 `install_task` → `/install/<id>` 与两个新类型；`closeout-units.test.ts`、`balance.test.ts` 补断言。verify：两个测试 0 失败。

## 2. 服务与接口

- [x] 2.1 `POST /api/install/repairs/[id]/factory-issued`（D2：按品类、伞键、"待确认"品类；409 `NOT_NEEDED` / `ALREADY_ISSUED` / `CLOSED`；按工艺单加锁）与 `POST /api/install/repairs/[id]/schedule`（D3：校验口径同 transition；建预约 / 改期；工艺单 `appointmentId` 与安装日期；未登记出单或备好日较晚 → 提示）；两类通知（D10，类型表 / 引入日期 / 开关文案 / 图标）。verify：`npm run typecheck` 0 error；用例在 2.3。
- [x] 2.2 返修收口（D4–D6）：任务列表 / 详情 / 拍照 / 标记问题 / 提交维修单按任务收口范围；完成收口在返修预约上关闭维修单、无其他未关闭维修单时 `scheduled → installed` 并调 `notifyInstallCompleted`；返修预约上提交维修单 → 原单 superseded；照片代理放行任一安装预约的被分配人（D7）；`loadOrderStages` 用新进度。verify：`npm run typecheck` 0 error；2a–2d 隔离库测试仍全过。
- [x] 2.3 维修单列表 / 详情接口加进度与可执行操作（D9）；新建 `src/lib/install/__tests__/repair-dispatch-db.isolated.test.ts`（真实路由 + 隔离库，岗位：安装工 ×3、出单·Vinyl / 布帘 / Roller、运营主管、会计、老板、销售）覆盖 spec 中标注该文件的全部场景，含全链路到会计确认尾款与质保审批、岗位 × 操作"列出 ⇔ 2xx"；注册 `scripts/test-all.sh`。verify：本地隔离库 0 失败；`bash scripts/check-test-registry.sh` 通过。

## 3. 页面

- [x] 3.1 维修单详情：出单登记卡（各品类登记 / 待登记）+「登记出单」对话框（预计备好日、备注）、返修排期卡 +「安排返修 / 改期」对话框（安装工从 `/api/install/installers` 选、时间、提示）、关闭情况；按钮只按接口返回的可执行操作显示；列表加待登记品类与返修时间。verify：`npx eslint src/components/install` 0 error；本地 Playwright 截图。
- [x] 3.2 返修任务页标明"返修 R-…"且只列维修行；状态卡"<日期> 再去返修"；本地 Playwright 走一遍：首装提交维修单 → 出单·Vinyl 点通知登记 → 运营主管排返修 → 返修安装工点通知、拍照、完成收口 → 会计"待收尾款"出现该单 → 销售状态卡，截图存 `docs/install-2e-screenshots/`。verify：走查全部检查通过。

## 4. 收尾

- [x] 4.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate install-2e-repair-dispatch --strict` 通过；写 `docs/QINGYAN_INSTALL-2e_REPORT.md` + `docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2e 改 `[G]` + 更新 `docs/QINGYAN_INSTALL-2_HANDOFF.md`。verify：四条命令退出 0；`grep -c "INSTALL-2e .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- 2d PR 合并后本 change 才能开 PR；2d 与 2e 同批上线。
- 归档顺序：必须在 `install-2d-repair-form` 归档之后 `/opsx:archive install-2e-repair-dispatch --yes`（`installation/repairs`、`installation/install-stage` 由 2d 新建；`window-closeout`「完成收口」与 `install-tasks`「安装任务详情」基于 2a 增量后的文本），TASKFLOW INSTALL-2e 改 `[x]`。
- 之后 `/opsx:propose install-2f-repair-close`（维修单作废 / 关闭不返修、逾期提醒挂既有每日 cron）。
