# Tasks

每条带验证方式；真实输出写进报告。前置：`tender-bid-workspace-panel`（TI-4b）已 apply。

## 1. 契约与读取结果

- [x] 1.1 `contract.ts`：证书加 `evidenceRef`、行明细加 `basedOnAddendum`；保存请求拒绝「已核验」而无出处；合并时限制 `basedOnAddendum`；verify：`npx tsx src/lib/tender-bid-workspace/__tests__/workspace-contract.test.ts` 全部通过（含新增断言）
- [x] 1.2 `workspace-view.ts`：由行明细生成尺寸对照与认证判定两类结论并交给可投标判定；verify：`npx tsx src/lib/tender-bid-workspace/__tests__/workspace-view.test.ts` 全部通过（含新增断言）

## 2. 纯函数

- [x] 2.1 新建 `line-entry.ts`（行明细草稿与保存内容互转并校验、合并进整块明细、影响行解析、补遗增删）与 `line-entry.test.ts`，登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender-bid-workspace/__tests__/line-entry.test.ts` 全部通过

## 3. 面板

- [x] 3.1 价格表行的展开录入（品牌、型号、产品尺寸、证书）与补遗卡片；verify：`npm run typecheck` 通过；`panel-helpers.test.ts` 的源码断言仍全部通过
- [x] 3.2 隔离库端到端补用例（已核验无出处 → 400 且不落库；虚报补遗号被限制；补遗后报待复核、重新保存后消失）；verify：本地隔离库运行 `bid-workspace-db.isolated.test.ts` 全部通过
- [x] 3.3 真实应用截图 `line-entry.png`、`certificate.png`、`stale-after-addendum.png` 存 `docs/acceptance/ti-4c/`；verify：三张图存在，并在报告里逐张说明看到了什么

## 4. 收尾

- [x] 4.1 门禁：相关测试、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-bid-workspace-line-entry --strict`；verify：全部通过，真实输出写进报告
- [x] 4.2 写 `docs/QINGYAN_TI-4c_REPORT.md` + 在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase F 新增 TI-4c 行；verify：报告存在，`grep -n 'TI-4c' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive tender-bid-workspace-line-entry --yes`（独立小 PR）。
