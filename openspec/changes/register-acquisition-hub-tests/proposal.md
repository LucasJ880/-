# Proposal: register-acquisition-hub-tests

**TASKFLOW：** 无（基础设施；对已归档能力 `qa/test-registry` 的合规修复）。
**受影响的 Muse 意图：** 无。不改 `src/`。

## Why

PR #242（acquisition-hub-m1）在 #241 与 #243 之间合入，新增的两个 trade 测试只写进了 CI 子集 `scripts/test-ci-unit.sh`，没进 `scripts/test-all.sh`；按 `qa/test-registry` 的规则，`scripts/check-test-registry.sh` 在当前 `main` 上退出 1，`npm test` 因此是红的。这是该纪律生效后的第一次真实命中。

## What Changes

- 在 `scripts/test-all.sh` 第一组、紧随第 75 行「WhatsApp/微信来信进 Revenue Spine DB 端到端(isolated)」之后，追加两条 `run_test`（中文名）：
  - `src/lib/trade/__tests__/inbound-org.test.ts`（纯函数，4 条断言）
  - `src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts`（隔离库执行；无 `DATABASE_URL` 时自动跳过并退出 0，与同组其它 isolated 条目一致）
- 不改其它行、不改分组、不改 `ci/test-registry-baseline.txt`（这两个文件是 SDD-0 之后新增的，不属于历史欠账，不得加进基线）。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
（无。本 change 不改变任何对外行为契约：`qa/test-registry` 已经要求「每个 `src/lib/**/__tests__/*.test.ts` 必须在 `test-all.sh` 注册」，这里只是让仓库重新满足它。因此 `.openspec.yaml` 设 `skip_specs: true`，不为满足校验凭空发明 Requirement。）

## Impact

- `scripts/test-all.sh`：+2 行。
- `npm test`：增加约 1 秒（纯函数测试 < 1 秒；isolated 测试无库时立即跳过）。
- `scripts/check-test-registry.sh` 在 `main` 上恢复退出 0（已注册 383 → 385，基线仍 76）。
- CI（`npm run test:ci`）不受影响：这两个文件本来就在 CI 子集里。

## Out of scope

- 不把 `scripts/check-test-registry.sh` 加进 `scripts/test-ci-unit.sh`（让注册漂移进 CI 门禁是另一个 change）。
- 不给 `test-all.sh` 的 tsc 项加 `NODE_OPTIONS`（另一个 change）。
- 不动 PR #242 的任何代码或测试内容；不动基线。
- 不处理 `.isolated.test.ts` 在无库环境"跳过算通过"的语义（既有约定）。
