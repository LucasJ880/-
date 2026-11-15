# Tasks：询价追踪页（T-2）

## 1. 规则

- [ ] 1.1 `tracker-pure.ts`（`nextChaseOutlook`、`trackerRowView`、`classifyNeedsAction`、`trackerSummary`、`quoteCellView`）；verify：`npx tsx src/lib/tender-rfq/__tests__/tracker-pure.test.ts` 全部通过（含与 `decideChases` 的一致性表）

## 2. 服务与接口

- [ ] 2.1 `loadItems` 导出 + `projectIds`；`chaseDaysForRound` 抽出；`tracker.ts`（可见项目、条目、未响应、待批卡审批信息、比价矩阵取价、白名单）；verify：隔离库测试的取数部分通过，`loadItems` 不传 `projectIds` 与原来相同
- [ ] 2.2 `GET /api/org/tender-rfq/tracker` + `POST /api/projects/[id]/tender-rfq/chase`；verify：`npx tsx src/lib/tender-rfq/__tests__/tracker-db.isolated.test.ts` 全部通过，且在改动之前的代码上失败

## 3. 页面

- [ ] 3.1 `/bids/rfq` 页面 + `/bids` 汇总卡；verify：呈现测试通过；真实浏览器截图 `docs/acceptance/t-2/*.png`

## 4. 首页与旧接口

- [ ] 4.1 scanner 改口径、首页建议跳追踪页、batch-followup 410；verify：隔离库测试对应场景通过；`grep -rn '"contacted"' src/lib/proactive src/app/api/projects` 为空

## 5. 验收

- [ ] 5.1 新测试注册；变异核对；独立审查并处理其发现；全部门禁；verify：`bash scripts/check-test-registry.sh` OK、`npm run test:ci` PASS、`npm run typecheck` 0、`npm run lint:baseline` PASS、`openspec validate rfq-tracker --strict` valid
- [ ] 5.2 写 `docs/QINGYAN_T-2_REPORT.md` + 更新 TASKFLOW 状态列 + 交接文档；verify：TASKFLOW 里 T-2 一行状态 `[G]`
