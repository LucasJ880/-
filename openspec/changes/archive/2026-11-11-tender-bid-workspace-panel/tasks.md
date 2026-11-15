# Tasks

每条带验证方式；真实输出写进报告。前置：`tender-bid-workspace-api`（TI-4a）已 apply。

## 1. 纯函数

- [x] 1.1 `paste-import.ts`（价格表与领取方名单的粘贴解析）与 `cost-draft.ts`（成本草稿的类型、本地存储键、组装成接口请求）；新建 `panel-helpers.test.ts`（粘贴 18 行含表头与带逗号的字段、数量不是数字、九家名单夹空行、成本输入组装、面板源码断言：只请求两个接口、无审批 / 发信 / 提交调用、404 时返回空、挂载在页签里）并登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/tender-bid-workspace/__tests__/panel-helpers.test.ts` 全部通过

## 2. 面板

- [x] 2.1 `src/components/tender/bid-workspace-panel.tsx`：取数与 404 返回空；判定与阻断项；三张清单与十三个阶段；价格表表格与粘贴导入；领取方汇总与粘贴；verify：`npm run typecheck` 通过
- [x] 2.2 同一组件的成本核算部分：逐行输入、情景设置、本地保存与导出导入、「计算」、四块核算表、403 文案；在 `bid-tab.tsx` 顶部挂载；verify：`npm run typecheck` 通过
- [x] 2.3 真实应用截图：本地数据库 + `next dev`，登录后截 `flag-off.png`、`overview.png`、`cost-sheet.png` 存 `docs/acceptance/ti-4b/`；verify：三张图存在，并在报告里逐张说明看到了什么

## 3. 收尾

- [x] 3.1 门禁：新测试、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-bid-workspace-panel --strict`；verify：全部通过，真实输出写进报告
- [x] 3.2 写 `docs/QINGYAN_TI-4b_REPORT.md` + 在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase F 新增 TI-4b 行并更新状态列；verify：报告存在，`grep -n 'TI-4b' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive tender-bid-workspace-panel --yes`（独立小 PR）。
