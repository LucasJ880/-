# Tasks

## 1. 纯函数

- [x] 1.1 新建 `src/lib/install/repair-visit-email.ts`：问题类型英文说明表、日期 / 时间段格式化（企业时区）、`renderRepairVisitEmail`（首次 / 改期主题，正文与 HTML 同内容，D3）、`repairVisitEmailBlockers`（客户邮箱、报修电话 / 邮箱）；新建 `repair-visit-email.test.ts` 覆盖 spec「返修时间确认邮件内容」「返修时间确认邮件不输出的内容」并注册 `scripts/test-all.sh`。verify：`npx tsx src/lib/install/__tests__/repair-visit-email.test.ts` 0 失败。

## 2. 审批、执行器与接口

- [x] 2.1 登记动作类型 `install.send_repair_visit_email`：`types.ts`（类型与 payload）、`executor.ts` 分派、`wechat-confirm-policy.ts` 归对外发送类（补测试断言）；新建 `exec-install-repair-visit-email.ts`（D2 校验顺序、advisory lock、审计 `install.repair_visit_email.sent`）。verify：`npm run typecheck` 0 error；微信策略测试通过。
- [x] 2.2 新建 `repair-visit-email-service.ts`：生成审批（D1 幂等键、改期判定）、当前时间的状态（复用 `deriveWarrantyStatus`）；排期接口在 `scheduleRepair` 成功后生成、响应带 `visitEmail`；`GET /api/install/repairs/{id}` 带 `visitEmail`；新建 `POST /api/install/repairs/{id}/visit-email`（`install.task.assign`、`NO_SCHEDULE`、`ALREADY_SENT`）。verify：`npm run typecheck` 0 error；`repair-dispatch-db`、`repair-close-db` 隔离库仍全过。
- [x] 2.3 新建 `repair-visit-email-db.isolated.test.ts`（真实路由 + 隔离库 + 测试发件通道）覆盖 spec 标注该文件的场景，并注册。verify：本地隔离库 0 失败；`bash scripts/check-test-registry.sh` 通过。

## 3. 页面

- [x] 3.1 `WarrantyApprove` 加可选 `label` / `footer`（默认质保文案不变）；维修单详情加"返修时间确认邮件"卡片（状态、阻断原因、预览、批准发送、生成确认邮件）。本地 Playwright：排期后卡片显示预览并批准（未配置发件身份 → 页面显示 `NO_ORG_SENDER` 原因）；截图存 `docs/install-2j-screenshots/`。verify：`npx eslint src/components/install src/components/accounting` 0 error；走查全部检查通过。

## 4. 收尾

- [x] 4.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate install-2j-repair-visit-email --strict` 通过；全量 `npm test`（隔离库）与 2i 基线比对；写 `docs/QINGYAN_INSTALL-2j_REPORT.md` + `docs/QINGYAN_PERMISSION_TASKFLOW.md` 增 INSTALL-2j 行并改 `[G]` + 更新 `docs/QINGYAN_INSTALL-2_HANDOFF.md`。verify：四条命令退出 0；`grep -c "INSTALL-2j .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- 2i 合并后本 change 才能开 PR（同一分支串行）。
- PR 合并后在最新 main 上 `openspec archive install-2j-repair-visit-email --yes`（独立小 PR），TASKFLOW INSTALL-2j 改 `[x]`；archive 后对 `installation/` 全部 spec 跑 `--strict`。
