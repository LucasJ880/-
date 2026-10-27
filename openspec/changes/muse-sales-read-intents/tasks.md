# Tasks

## 1. 契约

- [x] 1.1 `contract.ts` 追加意图 `sales_overview` / `opportunity_status`（阶段 1）、两段 args、错误码 `PERMISSION_DENIED` / `OPPORTUNITY_NOT_FOUND`；`router-pure.ts` 未开放标签表加两项；`muse-bridge-pure.test.ts` 意图数 12 → 14 并加新意图的解析用例。verify：`npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts` 全部通过。

## 2. 纯逻辑

- [x] 2.1 新建 `sales-pure.ts`：读范围、开放态判定、加权排序与理由、未核实字段、`sales_overview` / `opportunity_status` 的 Advisory 与 data 构造、互动摘要脱敏；新建 `sales-pure.test.ts` 并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：`npx tsx src/lib/muse-bridge/__tests__/sales-pure.test.ts` 全部通过；`bash scripts/check-test-registry.sh` 退出 0。

## 3. 取数与分发

- [x] 3.1 新建 `sales.ts`（按范围查询商机、窗口统计、逾期行动计数、单商机的互动与行动、停滞阈值读 policy）；`router.ts` 加两个 case。verify：`npm run typecheck` 退出 0；`npx eslint src/lib/muse-bridge` 无新增错误。

## 4. 隔离库端到端

- [x] 4.1 新建 `sales-db.isolated.test.ts`（虚构两个组织：管理者 / 销售 A / 销售 B / 普通成员 / 外组织商机；经 `handleMuseCommand` 走全链）并注册进 `scripts/test-all.sh`。verify：本地隔离库上运行全部通过；无 `DATABASE_URL` 时输出跳过并退出 0。

## 5. 纪律与文档

- [x] 5.1 `openspec/config.yaml` 第 4 条补决定 B；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 新增 Phase S（S1–S4）与"已决定"第 9 条；`flags.ts` 注释写明两个意图默认不开。verify：`grep -n "决定 B" openspec/config.yaml docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 各至少 1 行；`npx -y @fission-ai/openspec@1.15.0 validate muse-sales-read-intents` 通过。

## 6. 收尾

- [x] 6.1 回归：muse-bridge 四个既有测试 + 两个新测试；`npm run typecheck`；`npm run lint:baseline`。verify：全部退出 0，通过数不低于开工前基线（muse-bridge-pure 53）。
- [x] 6.2 写 `docs/QINGYAN_S1_REPORT.md`（做了什么 / 怎么验 / 判断点 / 已知限制）并把 TASKFLOW S1 状态列改为实际值。verify：报告文件存在；`grep -n "| S1 " docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示新状态。

## Workflow follow-up

- PR 合并到 main 后再 `/opsx:archive muse-sales-read-intents --yes`（独立小 PR）。
