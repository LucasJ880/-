# Proposal：投标策略备忘送进模型前去掉我方成本（CHAIN-2d）

TASKFLOW：CHAIN-2d（新增一行；Phase F（续）— 情报串联的后续；CHAIN-2b #532 留给 GATE 的第 ③ 条，Lucas 2026-11-20 答「可以」）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

投标策略备忘由模型写成，模型输入里的报价演算带着我方成本、目标毛利、成本底价情景与每个情景的毛利，提示词还要求逐字引用毛利；备忘在情报页签等处给所有项目读者看，等于绕过了财务查看权。

## What Changes

- 修改备忘的报价演算：编排里给备忘算报价情景时不再传入我方成本与目标毛利，送进模型的演算 SHALL NOT 含我方成本、成本来源、目标毛利、「成本 + 目标毛利」「成本价」两种情景、每个情景的毛利；评分模型、对手价、打平价与相对对手价的四个情景照旧。
- 修改备忘提示词：不再要求引用毛利，写明不得陈述、估算或推测我方成本、毛利与成本底价；提示词版本 3 → 4，备忘版本 `tender-bid-strategy-memo/v2` → `v3`（v3 表示输入里没有成本）。
- 隐藏旧版备忘的两段：情报页签读取接口对 v3 以前的备忘不返回「评分演算」「报价策略」两段的文字，改带一个标记；卡片上报价策略一行写明旧版已隐藏、重新检索外部情报后会生成新的。
- 加测试：输入里放少见的成本与毛利数字，核对送进模型的整段输入里搜不到；旧版备忘的两段读不到。

## Out of scope

- 不改报价表助手、成本核算接口、寻源建议卡的财务权限（CHAIN-2b #532）。
- 不改旧版备忘在别处的使用：工作台摘要（只用摘要、风险门、数据缺口）、投标文件草稿（`src/lib/tender-bid-draft/gather.ts`，用摘要、风险门、teaming、RFI）、澄清问题文件（`src/lib/projects/generate/generate-docs.ts`，只用 RFI）——这些段落提示词没有要求写成本或毛利；残留风险写进 design。
- 不批量重算已存的备忘（下一次外部情报运行时自然换成 v3）。
- 不改旧版自动策略草案 `bidStrategyAuto`（它的输入里没有报价演算）。
- 不新增开关、不新增模型调用。

## Capabilities

### New Capabilities

- `tender/bid-strategy-memo`：投标策略备忘的模型输入不带我方成本与毛利、提示词不要求也不推测成本与毛利、旧版备忘的评分与报价两段不再给出。

### Modified Capabilities

无。

## Impact

- 新增：`src/lib/tender-intel/memo-pricing.ts`（纯函数：给备忘用的报价演算、旧版备忘的两段隐藏）。
- 修改：`src/lib/tender-intel/orchestrate.ts`（报价演算改用纯函数，不传成本与目标毛利）、`src/lib/tender-intel/strategy.ts`（提示词第 2 条与新的第 8 条、两个版本号）、`src/app/api/projects/[id]/external-intel/award-history/route.ts`（返回备忘前隐藏旧版两段）、`src/components/tender-intel/org-award-intel-slots.tsx`（旧版的报价策略一行）。
- 测试：新增 `src/lib/tender-intel/__tests__/memo-pricing.test.ts`（注册进 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`）；`bid-strategy-memo.test.ts` 的 MEMO-07 / MEMO-08 源码断言随接线更新。
- 零 schema、零依赖、零新增模型调用。
