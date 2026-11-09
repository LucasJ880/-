# Tasks

## 1. 权限

- [x] 1.1 `permissions.ts` 登记 `sales.revenue.summary.read`（只支持 ORG）
- [x] 1.2 `role-defaults.ts` 窗饰 `ops_lead`、`ops_staff` 绑定该键（ORG）；verify：`revenue-summary.test.ts` 断言两者有、销售 / 招投标 / 出单 / 安装工没有、运营不多拿其他 `sales.*`

## 2. 取数与接口

- [x] 2.1 `revenue-summary-pure.ts`：本周 / 本月至今窗口、取数区间、白名单汇总（复用 `computeSalesPeriod` 全企业范围）；verify：纯函数 9 passed
- [x] 2.2 `revenue-summary.ts`（授权：ORG 范围汇总键或销售分析键）+ `GET /api/ops/sales-summary`

## 3. 页面

- [x] 3.1 运营中心只读卡 `ops-sales-summary-card.tsx`（本周 / 本月至今 × 成单金额 / 成单数 / 报价金额；403 不渲染；不链销售页）

## 4. 测试与收尾

- [x] 4.1 `revenue-summary-db.isolated.test.ts`（固定 now 的数字、六类身份权限、白名单与不泄露、运营仍不能读期间汇总）；注册；verify：13 passed
- [x] 4.2 回归：`authorize` / `digital-employee` / `residual-reads` / `position-binding-console` / `position-nav` / `entry-visibility` / `route-gate` / `wechat-entry-nav`；隔离库 `period-db` / `sales-record-access-db` / `residual-reads-db` / `position-binding-console-db` / `ops-authorize-db`
- [x] 4.3 隔离库 + `next dev` 截图 `docs/acceptance/vis-2/01–02`（运营人员落地运营中心、卡片数字与造数逐笔一致；运营读期间汇总 403、销售读汇总 403、老板同数）
- [x] 4.4 typecheck、`lint:baseline`、`test-runtime-architecture.sh`、`check-test-registry.sh`、`openspec validate ops-sales-revenue-summary --strict`
- [x] 4.5 `docs/QINGYAN_VIS-2_REPORT.md` + TASKFLOW VIS-2 行
- [x] 4.6 `scripts/seed-org-authorization.ts --org <code>`：只对一个企业重跑岗位落地（上线后给 Sunny 补新键）；verify：隔离库缺参数 / 不存在退出码 2，删键后跑一次补回

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive ops-sales-revenue-summary --yes`。
- 上线后对 Sunny 重跑岗位模板落地（Owner Gate）。
