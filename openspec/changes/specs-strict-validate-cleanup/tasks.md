# Tasks

TASKFLOW：无（基础设施），不写 REPORT、不改 TASKFLOW 状态列。本 change 无代码改动；任何 task 都不写 `openspec/specs/**`。

## 1. delta 校验

- [x] 1.1 `openspec validate specs-strict-validate-cleanup --strict`；verify：输出 `Change 'specs-strict-validate-cleanup' is valid`，退出码 0
- [x] 1.2 按 design「验证方式」2 在临时目录模拟归档（本 change → D3 两行 Purpose），每步后跑 `openspec validate --specs --strict`；verify：失败数依次为 4（基线）、2、0，仓库内 `git status --short` 不出现 `openspec/specs/**`

## 2. 行为不变核对

- [x] 2.1 对比模拟归档前后的 `authorization/position-catalog` 与 `sunny/process-order-autogen` 主规格；verify：前者只有「新增权限键登记」正文一行不同（25 条 / 53 个场景不变），后者 17 → 18 条、场景 30 个不变，新两条的正文与场景除 design D2 列明的两处外与原条逐字相同
- [x] 2.2 跑场景里写到的两个测试：`npx tsx src/lib/sunny-process/__tests__/zebra-ratios.test.ts`、`npx tsx src/lib/authorization/__tests__/authorize.test.ts`；verify：两个都退出码 0

## 3. 门禁

- [x] 3.1 `git diff --name-only origin/main...HEAD`；verify：只列 `openspec/changes/specs-strict-validate-cleanup/` 下的文件，`bash scripts/check-test-registry.sh` 输出与 main 相同

## Workflow follow-up

- `/opsx:verify specs-strict-validate-cleanup` 后开 PR（一个 change = 一个 PR，直接对 `main`），PR 描述写明无对外行为变化、D3 已获 Lucas 2026-11-15 批准。
- PR 合并后 `/opsx:archive specs-strict-validate-cleanup --yes`（独立小 PR）。同一个归档 PR 里把 `accounting/workspace`、`inventory/fabric-stock-access` 的 Purpose 换成 design D3 的原文（Lucas 2026-11-15 批准；只限这两行）。
- 归档 PR 合并后在 main 上跑 `openspec validate --specs --strict`，确认 `0 failed`。
