# Tasks

## 1. 纯函数

- [ ] 1.1 新建 `src/lib/install/repair.ts`：问题类型表与"是否需工厂"查表、标记问题入参校验（类型 / 描述 ≤ 300 / 其他类型的 needsFactory）、维修单表头校验（客户名必填、期望日范围）、目标日（D6）、单号 `R-<单号>-<n>`、打印补行到 10、维修单记录解析；新建 `src/lib/install/stage.ts`：`installStage`（含历史手工完工规则，D8）与阶段名 / 销售文案；新建 `repair.test.ts`、`stage.test.ts` 覆盖 spec「问题类型表」「维修单内容」「维修单打印版」（补行）「安装阶段推导」「阶段文案」；同 task 注册 `scripts/test-all.sh`。verify：两个测试 0 失败。
- [ ] 1.2 `closeout.ts` 聚合（D1）：同时读收口与问题记录，单元状态取最新一条（已收口 / 有问题 / 未收口），汇总加有问题数，单元带问题内容；`installNotificationHref` 加 `install_repair` 实体 → `/install/repairs/<id>`、`install_repair_submitted` + 工艺单实体 → `/blinds-orders/<id>`；`closeout-units.test.ts` 补"收口后标问题""问题后补拍"，`balance.test.ts` 补落点。verify：`npx tsx src/lib/install/__tests__/closeout-units.test.ts` 与 `balance.test.ts` 0 失败。

## 2. 服务与接口

- [ ] 2.1 `service.ts`：收口日志同时查 `install.window.issue`；任务列表 / 详情输出有问题数与每单元问题内容，因维修单完成的任务详情带单号 / 目标日 / 行数；新建 `POST /api/install/tasks/[id]/items/[itemId]/issue`（权限、限流、类型 / 大小、私有前缀同完工照，D12；`writeAuditLog` 失败 500）。verify：`npm run typecheck` 0 error；用例在 2.3 的隔离库测试里。
- [ ] 2.2 新建 `src/lib/install/repair-service.ts` 与 `POST /api/install/tasks/[id]/repair`：条件校验（409 `UNITS_UNHANDLED` / `NO_ISSUES` / 已收口完成，400 表头）、服务端生成行（D2）、按预约与工艺单加锁计数与幂等（D5）、事务内写 `install.repair.submitted` + 预约完成 + `install.task.completed`（`needs_repair`）、工艺单不动（D4）；事务后按 D7 发通知；通知类型 `install_repair_submitted` 登记（类型表 / 引入日期 / 开关文案 / 图标）。verify：`npm run typecheck` 0 error；用例在 2.3。
- [ ] 2.3 新建 `GET /api/install/repairs`、`GET /api/install/repairs/[id]`（`install.task.read` ORG；他企业 404；含阶段）与 `GET /api/blinds-orders/[id]/install-status`（工艺单读权，否则 404；不出照片 / 描述 / 电话 / 备注 / 金额，D10）；新建 `src/lib/install/__tests__/repair-db.isolated.test.ts`（真实路由 + 隔离库，岗位绑定：安装工、出单·Vinyl、出单·布帘、运营主管、会计、老板、销售）覆盖 spec 中标注 `repair-db.isolated.test.ts` 的全部场景，含通知收件人与"每个落点对收件人可读"；注册 `scripts/test-all.sh`。verify：本地隔离库 0 失败；`bash scripts/check-test-registry.sh` 通过。

## 3. 页面

- [ ] 3.1 安装工任务页（`install-task-detail.tsx` / `install-types.ts`）：每单元"有问题"表单（类型下拉、其他类型的是否需工厂、描述、拍照）、问题内容展示、底部按钮按状态切换（spec「完成收口与提交维修单二选一」）、维修单表单（预填客户名 / 电话、备注、期望日、已和客户确认、行预览、目标日预览）与提交后状态；`/install` 列表对 ORG 范围显示"返修单"入口。verify：`npx eslint src/components/install` 0 error；本地 Playwright 走查截图。
- [ ] 3.2 页面 `/install/repairs`、`/install/repairs/[id]`、`/install/repairs/[id]/print`（纸质版式、抬头取质保设置、补行到 10、无照片无金额，D9）；工艺单详情顶部安装状态卡（接口失败不显示）。verify：`npx eslint` 涉及目录 0 error；本地 Playwright 按 安装工 → 出单·Vinyl → 运营主管 → 会计 → 销售 走一遍（含点通知落点与打印版），截图存 `docs/install-2d-screenshots/`。

## 4. 收尾

- [ ] 4.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate install-2d-repair-form --strict` 通过；写 `docs/QINGYAN_INSTALL-2d_REPORT.md`（含"2d 与 2e 同批上线"的发布说明）+ `docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2d 改 `[G]` + 更新 `docs/QINGYAN_INSTALL-2_HANDOFF.md`。verify：四条命令退出 0；`grep -c "INSTALL-2d .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- apply 之前：在 2b 单独提交"历史手工完工不算待收尾款"修正（D8；2b spec 增量、`listBalance` 与隔离库测试同步），本 change 的阶段推导复用同一判定。
- 2c PR 合并后本 change 才能开 PR；合并后 `/opsx:archive install-2d-repair-form --yes`（独立小 PR，需在 2a 的 archive 之后，因为「收口状态聚合」基于 2a 增量后的文本），TASKFLOW INSTALL-2d 改 `[x]`。
- 之后 `/opsx:propose install-2e-repair-dispatch`；2d 与 2e 同批上线（design Risks）。
