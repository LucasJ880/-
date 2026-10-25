# Proposal: register-muse-rfq-tests

**TASKFLOW：** P0-9（`scripts/test-all.sh` 注册——"注册待做"欠账）；承载任务书 SDD-0（基础设施）。
**受影响的 Muse 意图：** 无。本 change 不改 `src/`，只把已有测试接进全量测试入口。

## Why

`npm test`（`scripts/test-all.sh`）今天一条 muse-bridge / tender-rfq 的断言都不跑：P0-9 起"注册待做"，之后 P1-1…P1-8 共 13 个测试文件（541 条断言）全部漏注册，CI 绿不等于这两个模块没坏。同类漂移在仓库里已经积累了 89 个未注册的 `src/lib/**/__tests__/*.test.ts`，没有任何机制阻止下一个。

## What Changes

- 把 13 个 muse-bridge / tender-rfq 测试文件注册进 `scripts/test-all.sh` 第一组（纯逻辑）的 `run_test` 列表，名字用中文，与现有风格一致：
  - `src/lib/muse-bridge/__tests__/{muse-bridge-pure,advisory,next-step,prefs}.test.ts`
  - `src/lib/tender-rfq/__tests__/{build,round-pure,inbound-parse,inbound-apply,landed-cost,compare,notes-parse,chase-pure,chase-execute}.test.ts`
- 新增 `scripts/check-test-registry.sh`：枚举 `src/lib/**/__tests__/*.test.ts`，与 `scripts/test-all.sh`（含它直接调用的 `scripts/*.sh`）比对，列出未注册文件；非空则退出码 1。
- 新增 `ci/test-registry-baseline.txt`：冻结本次之前已存在、且本任务禁止"顺手"补注册的 76 个历史欠账文件；清单只允许删，不允许加；条目一旦被注册或被删除，校验脚本报"基线过期"并退出 1。
- 把 `scripts/check-test-registry.sh` 自己注册进 `scripts/test-all.sh`，使注册漂移直接让 `npm test` 失败。
- 写 `docs/QINGYAN_SDD-0_REPORT.md`；删掉 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` P0-9 状态列里的"（注册待做）"。

## Capabilities

### New Capabilities
- `qa/test-registry`：测试文件注册纪律——`src/lib` 下的测试文件必须被全量测试入口执行，并由脚本校验、历史欠账只减不增。

### Modified Capabilities
（无。`openspec/specs/` 目前为空，这是第一个 change。）

## Impact

- `scripts/test-all.sh`：第一组末尾新增 13 + 1 条 `run_test`；不改既有行、不改分组结构、不改汇总逻辑。
- 新文件 `scripts/check-test-registry.sh`、`ci/test-registry-baseline.txt`（放 `ci/` 与现有 `ci/eslint-error-baseline.json` 同目录）。
- `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` P0-9 状态列；新文件 `docs/QINGYAN_SDD-0_REPORT.md`。
- `npm test` 运行时间增加约 15 秒（13 个纯逻辑测试，本地实测每个 < 1.5 秒；校验脚本 < 1 秒）。
- CI（`.github/workflows/ci.yml` 跑 `npm run test:ci` = `scripts/test-ci-unit.sh`）不受影响：本 change 不改 CI 子集。

## Out of scope

- 不注册基线里的其余 76 个历史欠账文件；不重构 `test-all.sh` 的 `run_test` 结构或分组。
- 不改 `scripts/test-ci-unit.sh`，不把新测试加进 CI 子集。
- 不动任何 `src/` 业务代码与测试文件内容。
- 不覆盖 `src/app/**`、`src/components/**`、`scripts/*.test.ts` 的注册情况（只管 `src/lib/**/__tests__/*.test.ts`，与任务书一致）。
- 不在本 change 内 archive；archive 等 PR 合并后另开小 PR。
