# qa/taskflow-status Specification

## Purpose
约束 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 这份阶段状态唯一事实源与 main 的合并记录保持一致：完成的任务写明交付它的 PR，任务描述、运维前置与已决定事项都反映实际交付，而不是最初的计划。

## Requirements

### Requirement: 完成行写明交付 PR
TASKFLOW 表中状态为 `[x]` 的任务行 SHALL 在状态列或验收列写出交付它的 PR 编号（`#<数字>`），且每个编号 SHALL 对应 `git log --merges origin/main` 中一个已合并的 PR。

#### Scenario: Phase 1 每行都有已合并的 PR 编号
- **WHEN** 对 TASKFLOW Phase 1 表中 P1-1 至 P1-8 每一行，取出其中的 `#<数字>`，并在 `git log --oneline --merges origin/main` 中查找 `Merge pull request #<数字>`
- **THEN** 每一行至少有一个编号，且每个编号都能找到对应的合并提交

#### Scenario: Phase 0 完成行写明 #232
- **WHEN** 读取 TASKFLOW Phase 0 表 P0-1 至 P0-9 的状态列
- **THEN** P0-1 至 P0-8 都是 `[x]（#232）`；P0-9 是 `[x]（#232；注册进 npm test 见 #241）`

#### Scenario: P3-4 随 P1-8 交付
- **WHEN** 读取 TASKFLOW Phase 3 表的 P3-4 行
- **THEN** 状态为 `[x]`，写明随 P1-8（#236）交付，存储位置为 `Organization.settingsJson.museBridge.userPrefs`

### Requirement: 任务描述与实际交付一致
TASKFLOW 任务行的描述 SHALL 与该行引用的 PR 实际交付的内容一致；同一项交付 SHALL NOT 作为两个任务行各自的交付出现，也 SHALL NOT 出现在不是交付它的那个任务行里。例外：计划中的任务行被另一行提前交付时，该行 SHALL 在状态列写明「随 <另一行 ID> 交付」与对应 PR，而不是重复记一次交付。

#### Scenario: P1-8 描述实际交付
- **WHEN** 读取 TASKFLOW Phase 1 表的 P1-8 行
- **THEN** 描述是建议式回复契约、`next_step` 意图与个人偏好记忆，引用 #236；不再把 `price_scenario` 写成 P1-8 的交付

#### Scenario: price_scenario 归入 P1-6
- **WHEN** 读取 TASKFLOW Phase 1 表的 P1-6 行
- **THEN** 描述同时包含 `compare` 与 `price_scenario` 两个意图，引用 #235，并注明决定 A（#237：所选供应商落地价可出）

#### Scenario: P1-4 写明实际的入站形态
- **WHEN** 读取 TASKFLOW Phase 1 表的 P1-4 行与「已决定」节
- **THEN** 两处都写明入站为 Gmail history 游标轮询（cron `tender-rfq-inbound`），不再写 webhook 或 Pub/Sub watch

### Requirement: 联调前置与已决定反映当前设置
TASKFLOW 的「GATE-1 联调前置（运维）」SHALL 列出当前代码实际依赖的设置；「已决定」节 SHALL 列出已合并、改变对外行为的决定，并注明 PR。前置清单 SHALL NOT 写出任何密钥、令牌或数据库连接串。

#### Scenario: GATE-1 前置按邮箱分离与全量意图书写
- **WHEN** 读取「GATE-1 联调前置（运维）」
- **THEN** 写明授权邮箱为 `mailboxEmail`（lucas@，需 gmail.compose 与 gmail.readonly）、`project@` 需在授权账号里设为「以此地址发送」、`MUSE_BRIDGE_INTENTS` 的完整 11 个意图、`PUT tender-rfq-settings` 的 body，以及 staging 已于 2026-10-27 同步到 main

#### Scenario: 已决定节包含三条新决定
- **WHEN** 读取「已决定」节
- **THEN** 出现决定 A（#237）、邮箱分离（#238）、询价 / 催单按 text/plain 发出（#240）三条，各自注明 PR 编号

#### Scenario: 前置清单不含凭据
- **WHEN** 在 TASKFLOW 全文中搜索 `token=`、`postgres://`、`postgresql://`、`CRON_SECRET=`
- **THEN** 没有任何匹配
