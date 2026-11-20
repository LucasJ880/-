# Proposal：投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录（CHAIN-3b）

TASKFLOW：CHAIN-3b（新增一行；Phase F（续）— 情报串联的后续；CHAIN-3 的 Out of scope、交接文档第四十四次 §0.5h「之后还有什么」第 4 条；Lucas 2026-11-20「投标准备度的「进口线索」阶段读取 CHAIN-3 导入的记录」）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

投标工作区的阶段决定靠服务端从实际数据推导「手头材料」，但「进口线索」这份材料从来没人提供：CHAIN-3 已能把进口记录导入项目，阶段表照旧说「授权贸易 / 提单数据未接通；这不表示没有记录，而是没有查」。

## What Changes

- 修改投标工作区读取的「手头材料」推导：项目所属组织开了进口线索导入（`TENDER_IMPORT_LEADS_ENABLED` + 白名单）且该项目至少有一条 CHAIN-3 导入的进口记录（未被标为不采用，与 CHAIN-3 槽里「已导入 N 条」同一口径）时，多一项「进口线索」。
- 让「进口线索」阶段如实变为「执行」：说明照旧是「只处理人工提供的进口线索」，并从「未接通 / 仅人工」清单里消失。
- 保持开关关闭、或项目没有导入记录时，读取结果与现在逐字节相同。
- 保持阶段策略表（十三个阶段的分类与决定规则）不改；主规格 `tender/stage-policy` 的正文措辞改成与既有场景、代码一致（有人工材料时执行）。
- 改面板两处文字：未接通清单的标题改为「未接通、也没有人工材料的来源」；取决于来源的阶段（历史授标与采购、进口线索）在阶段标签下面写出说明（原来只在悬停提示里）。

## Out of scope

- 不改「历史授标与采购」阶段（`AWARD_RECORDS` 这份材料同样没有从授标记录推导；要不要做另立 change）。
- 不在阶段说明里显示导入条数、挂上条数或待确认条数（那些在情报页签「供应链情报」槽里）。
- 不改 CHAIN-3 的导入、匹配、汇总与加入供应商库；不改 `src/lib/tender-bid-readiness/stage-policy.ts`。
- 不新增开关（跟随既有的进口线索导入开关与投标工作区开关）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/bid-workspace`：修改「读取返回算出的结果」——「手头材料」的推导多一条进口线索；读取结果不含进口记录的条数或内容。
- `tender/stage-policy`：修改「未接通的来源不询问、不执行」的正文措辞（行为不变）。
- `tender/bid-workspace-panel`：修改「显示判定、阻断项与三张清单」（清单标题、取决于来源的阶段写出说明）。

## Impact

- 修改：`src/lib/tender-bid-workspace/store.ts`（`loadWorkspaceContext` 多查一次「有没有」）、`src/lib/tender-bid-workspace/workspace-view.ts`（`deriveMaterials` 多一条、上下文多一个可选字段）；新增 `src/lib/tender-import-leads/readiness-count.ts`（只读，只依赖 `@/lib/db` 与 `./flags`；不改该目录既有文件）。
- `loadWorkspaceContext` 的其它调用方也会多这一次查询：成本核算接口（不用材料，输出不变）、项目页「下一步」卡（`src/lib/tender-next-step/service.ts`，只用价格表与可投标判定的阻断项，输出不变）、投标工作区保存（`PUT` 的返回里同样带 `view`，材料与阶段随之变化）。
- 测试：`workspace-view.test.ts` 加用例；`import-leads.test.ts`、`panel-helpers.test.ts` 加源码断言；新增隔离库用例（注册进 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`）。
- 零 schema、零依赖、零新增模型调用。
