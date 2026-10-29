# Tasks

## 1. 纯函数

- [x] 1.1 `repair.ts`：列表参数解析（D4）与分栏 / 搜索 / 排序 / 分页 / 两栏总数（D1、D3）纯函数；`repair.test.ts` 覆盖 spec「维修单列表分栏、分页与搜索」的分栏、搜索、排序、分页、非法参数。verify：`npx tsx src/lib/install/__tests__/repair.test.ts` 0 失败。

## 2. 接口

- [x] 2.1 `GET /api/install/repairs` 按 D2 实现（去掉 200 上限，只对当前页完整序列化），响应带 `tab / page / pageSize / total / counts`；列表项 `closed` 补原因说明、关闭时间、关闭人姓名（D5）；`repair-close-db.isolated.test.ts` 列表断言改查已归档栏。verify：`npm run typecheck` 0 error；`repair-db`、`repair-dispatch-db`、`repair-close-db` 隔离库 0 失败。
- [x] 2.2 新建 `src/lib/install/__tests__/repair-list-db.isolated.test.ts`（真实路由 + 隔离库）覆盖 spec 标注该文件的场景：作废后自动归档、205 张分页、搜索、已归档结束情况，另含安装工 403；注册 `scripts/test-all.sh`。verify：本地隔离库 0 失败；`bash scripts/check-test-registry.sh` 通过。

## 3. 页面

- [x] 3.1 `/install/repairs`：进行中 / 已归档页签（带条数）、搜索框、翻页、已归档列（关闭原因、原因说明或转入单号、关闭人、关闭时间），栏 / 搜索词 / 页码写进地址（D6）；本地 Playwright 走查截图存 `docs/install-2i-screenshots/`。verify：`npx eslint src/components/install` 0 error；走查全部检查通过。

## 4. 收尾

- [x] 4.1 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate install-2i-repair-list-archive --strict` 通过；全量 `npm test`（隔离库）与 2h 基线比对；写 `docs/QINGYAN_INSTALL-2i_REPORT.md` + `docs/QINGYAN_PERMISSION_TASKFLOW.md` 增 INSTALL-2i 行并改 `[G]` + 更新 `docs/QINGYAN_INSTALL-2_HANDOFF.md`。verify：四条命令退出 0；`grep -c "INSTALL-2i .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后在最新 main 上 `openspec archive install-2i-repair-list-archive --yes`（独立小 PR），TASKFLOW INSTALL-2i 改 `[x]`；archive 后对 `installation/` 全部 spec 跑 `--strict`。
