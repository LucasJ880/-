# Tasks

## 1. 契约

- [ ] 1.1 `contract.ts` 追加 `create_followup` / `update_followup`、四个 `followup.*` 事件、信封 `followupId`、错误码 `FOLLOWUP_NOT_FOUND` / `FOLLOWUP_CLOSED`；`router-pure.ts` 标签；`muse-bridge-pure.test.ts` 意图数 16 → 18。verify：`npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts` 通过。

## 2. 纯逻辑

- [ ] 2.1 新建 `followup-pure.ts`（参数规整、权限判定、状态迁移与证据校验、事件输入、提醒计划 `planReminders`、跟进视图）与 `followup-pure.test.ts` 并注册；`inquiry-pure.ts` 的回复事件建议动作改为 `create_followup`。verify：测试通过；`bash scripts/check-test-registry.sh` 不新增欠账。

## 3. 服务、扫描与路由

- [ ] 3.1 新建 `followup.ts`（创建、更新、按商机列跟进）、`reminder-scan.ts`；`router.ts` 两个 case 与账本 `traceId`；`sales.ts` / `sales-pure.ts` 加 `followups`；`sales-actions` cron 追加扫描；网页 PATCH 发事件；事件路由与 `listMuseEvents` 复合游标。verify：`tsc --noEmit` 退出 0。

## 4. 页面与脚本

- [ ] 4.1 商机详情页"协作追踪"区块；`scripts/muse-pilot-evidence.ts`（导出逻辑放在可测试的函数里）。verify：`tsc --noEmit` 退出 0；导出函数由 5.1 覆盖。

## 5. 隔离库端到端

- [ ] 5.1 新建 `followup-db.isolated.test.ts`（创建权限、重放、完成需证据、网页更新发事件、扫描两人各一条且不重复、改期限再提醒、复合游标跨页、证据导出）并注册。verify：本地隔离库全部通过；无库时跳过。

## 6. 收尾

- [ ] 6.1 回归 muse-bridge 全部测试、`tsc --noEmit`、`npm run lint:baseline`。verify：全部退出 0。
- [ ] 6.2 写 `docs/QINGYAN_S3_REPORT.md`，TASKFLOW S3 状态列改为实际值。verify：报告存在；`grep -n "| S3 " docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示新状态。
