# Proposal：投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录（CHAIN-3b）

TASKFLOW：CHAIN-3b（Phase F（续）— 情报串联的后续；CHAIN-3 的 Out of scope、交接文档第四十四次 §0.5h「之后还有什么」第 4 条；Lucas 2026-11-20「投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录」）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

投标工作区的阶段决定靠服务端从实际数据推导「手头材料」，但「进口线索」这份材料从来没人提供：CHAIN-3 已能把进口记录导入项目，阶段表照旧说「授权贸易数据未接通；这不表示没有记录，而是没有查」。

## What Changes

- 投标工作区读取时，项目所属组织开了进口线索导入（`TENDER_IMPORT_LEADS_ENABLED` + 白名单）且该项目有 CHAIN-3 导入的进口记录（未被标为不采用的）时，「手头材料」多一项「进口线索」；「进口线索」阶段的决定因此从「未接通」变为「执行」，说明照旧是「只处理人工提供的进口线索」，并从「未接通 / 仅人工」清单里消失。
- 进口线索导入开关关闭、或项目没有导入记录时，读取结果与现在逐字节相同。
- 阶段策略表（十三个阶段的分类与决定规则）不改；授权贸易数据照旧「未接通」。

## Out of scope

- 不改「历史授标与采购」阶段（`AWARD_RECORDS` 这份材料同样没有从授标记录推导；要不要做另立 change）。
- 不在阶段说明里显示导入条数、挂上条数或待确认条数（那些在情报页签「供应链情报」槽里）。
- 不改 CHAIN-3 的导入、匹配、汇总与加入供应商库；不改 `src/lib/tender-bid-readiness/stage-policy.ts`。
- 不新增开关（跟随既有的进口线索导入开关与投标工作区开关）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/bid-workspace`：修改「读取返回算出的结果」——「手头材料」的推导多一条进口线索。

## Impact

- 修改：`src/lib/tender-bid-workspace/store.ts`（`loadWorkspaceContext` 多数一个数）、`src/lib/tender-bid-workspace/workspace-view.ts`（`deriveMaterials` 多一条、上下文多一个可选字段）；新增 `src/lib/tender-import-leads/` 下一个只读计数函数（不改该目录既有文件之外的行为）。
- 测试：`workspace-view.test.ts` 加用例；新增隔离库用例（注册进 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`）。
- 零 schema、零依赖、零新增模型调用。
