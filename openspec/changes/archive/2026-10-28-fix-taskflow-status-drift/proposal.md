# Proposal: fix-taskflow-status-drift

**TASKFLOW：** 无（基础设施）。本 change 修正 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 中 P1-1…P1-8、P3-4 行、GATE-1 联调前置与「已决定」节的漂移，不交付新的 TASKFLOW 任务。
**受影响的 Muse 意图：** 无。本 change 不改 `src/`。

## Why

TASKFLOW 是阶段状态的唯一事实源，但它和 main 的合并记录已经对不上：P1-8 行写的是 #235 已交付的 `price_scenario`，#236 实际交付的建议式回复、`next_step`、个人偏好没有出现；P3-4 已随 #236 完成却仍标 `[ ]`；GATE-1 前置仍按"project@ 授权、只开 rfq"写。同时 `bash scripts/check-test-registry.sh` 在 main 上退出 1（`a1d951dd` 新增的 2 个 trade 测试只注册进了 CI 子集），导致 `npm test` 整体失败，而 CI 不跑这项校验，所以这次漂移没有被拦下。

## What Changes

- 改写 TASKFLOW Phase 1 表，使每行的任务描述与状态对应 main 上实际合并的 PR：
  - P1-1 / P1-2 / P1-3 → #232；P1-4 → #234（入站形态改为"Gmail history 游标轮询，cron `tender-rfq-inbound` 每 10 分钟"，原文写的是 webhook）；
  - P1-5 / P1-6 → #235，P1-6 行同时写明 `compare` 与 `price_scenario` 两个意图，并注明决定 A（#237：所选供应商落地价可出）；
  - P1-7 → #239，注明后续 #258（未响应后晚到的回信照样入表、追问补问贸易条款 / 起订量）与 #240（询价 / 催单按 text/plain 发出）；
  - P1-8 → 改为 #236 实际交付的"建议式回复契约 + `next_step` 意图 + 个人偏好记忆"；
  - P1-1…P1-8 状态列统一为 `[x]（待 GATE-1 联调）`。
- Phase 0 表 P0-1…P0-8 的状态列由 `[x]` 改为 `[x]（#232）`，P0-9 改为 `[x]（#232；注册进 npm test 见 #241）`；Phase 0 其余内容（含 P0-10）不动。
- 把 P3-4（个人偏好记忆）状态改为 `[x]`，注明随 P1-8 / #236 交付，存储位置是 `Organization.settingsJson.museBridge.userPrefs`（原文写的是 user settings）。
- 改写「GATE-1 联调前置（运维）」：授权邮箱改为 `mailboxEmail`（lucas@）且需 compose + readonly；`project@` 须在授权账号里设为 Gmail「以此地址发送」；`MUSE_BRIDGE_INTENTS` 写全 11 个意图；列出 `PUT tender-rfq-settings` 的 body；staging 已于 2026-10-27 快进同步到 main。
- 改写「已决定」：第 3 条改为实际采用的 history 游标轮询（不用 Pub/Sub）；新增决定 A（#237）、邮箱分离（#238）、询价 / 催单 text/plain（#240）三条，每条注明 PR。
- 在 `scripts/test-all.sh` 注册 `src/lib/trade/__tests__/inbound-org.test.ts` 与 `src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts`（中文名，放在 WhatsApp / 微信来信组旁）。
- 在 `scripts/test-ci-unit.sh` 末尾加一条 `bash scripts/check-test-registry.sh`，使注册漂移在 CI 上直接失败。

## Capabilities

### New Capabilities
- `qa/taskflow-status`：TASKFLOW 状态表与 main 合并记录保持一致的纪律——每个完成行写明交付它的 PR，描述与实际交付相符。

### Modified Capabilities
- `qa/test-registry`：新增一条 Requirement——注册校验在 CI 子集中执行；不改现有 Requirement。

## Impact

- `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：Phase 1 表、P0-1…P0-9 状态列、P3-4 行、GATE-1 前置、「已决定」节；其余各节（Phase 0 其余列、Phase 2、P3-1…P3-3、度量表）不动。
- `scripts/test-all.sh`：新增 2 条 `run_test`，不改既有行。
- `scripts/test-ci-unit.sh`：末尾新增 1 行；CI（`npm run test:ci`）运行时间增加不到 1 秒。
- 不改 `ci/test-registry-baseline.txt`（这 2 个文件不在基线里，注册后基线条数不变）。

## Out of scope

- 不改任何 `src/` 代码与测试文件内容。
- 不注册基线里其余的历史欠账测试；不改 `scripts/check-test-registry.sh` 本身。
- Phase 0 表只在 P0-1…P0-9 状态列补 PR 编号，不改任务描述、产物列与 P0-10 ApiToken 种子的状态；不改 Phase 2 表、P3-1…P3-3、度量表。
- 不执行 GATE-1 联调，不改任何部署环境的配置（`MUSE_BRIDGE_INTENTS`、tender-rfq-settings、Gmail 别名）；文档只记录这些前置项。
- 不改 `docs/` 下其它任务书与完成报告。
- 不在本 change 内 archive；archive 等 PR 合并后另开小 PR。
