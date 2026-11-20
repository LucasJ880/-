# Proposal：报价表助手的我方成本只给有财务查看权的人（CHAIN-2b）

TASKFLOW：CHAIN-2b（Phase F（续）— 情报串联的后续；CHAIN-2 第一轮多维审查发现、交接文档第四十四次 §0.5h「之后还有什么」第 4 条；Lucas 2026-11-20「报价助手里的落地成本与已保存成本，改成只对有财务查看权的人显示，口径与其它页面一致」）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

报价表助手的读取接口只要求项目读权限，就把已保存的我方成本、比价矩阵算出的落地价（及其明细与已记来源里的落地价）返回给任何项目成员；同一份数字在成本核算接口与 CHAIN-2 寻源建议卡上都只给有财务查看权的人。

## What Changes

- 报价表助手读取接口按与成本核算、寻源建议卡相同的财务查看权判定（平台超级管理员、持组织范围的 `project.finance.manage` 或 `project.finance.read`、项目负责人）：没有财务查看权的人拿到的 `inputs.ourCostCad` 为 `null`、多一个 `costHidden: true`，不返回比价矩阵的成本建议与已记来源；情景表按「没有成本」计算（毛利为空、不生成成本底价情景），假设说明里「未填我方成本」那一句换成「需要财务查看权才能看我方成本……」。
- 保存接口：没有财务查看权的人在请求里带了我方成本或成本来源 → 403「需要财务查看权才能修改我方成本。」，不写库；不带时照常保存另外两项，返回里的我方成本同样为 `null` 并带 `costHidden: true`。
- 报价表助手卡：`costHidden` 时「我方成本」输入框换成一句说明，保存时不带我方成本，情景表不显示毛利一栏。
- 判定出错时按「没有财务查看权」处理（失败即收）。
- 有财务查看权的人看到与保存的一切与现在逐字节相同。

## Out of scope

- 不改 Muse `price_scenario` 意图（决定 A：落地价可以出 Muse，见 `src/lib/muse-bridge/router.ts`；本 change 不触碰 muse-bridge）。
- 不改投标策略备忘对已保存成本的使用：`src/lib/tender-intel/orchestrate.ts` 把含我方成本与毛利的 `pricingAnalysis` 交给 `src/lib/tender-intel/strategy.ts` 写进模型输入，生成的备忘可能转述成本或毛利；是否也要收口另立 change（本 change 的报告列出这条路径）。投标文件草稿（`src/lib/tender-bid-draft/gather.ts`）只读我方报价与对手价，不读成本，不涉及。
- 不改目标毛利、对手价、评分模型的可见与可改范围。
- 不新增权限键、不改 `src/lib/project-finance/access.ts` 的判定规则。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/pricing-helper`：新增「我方成本只给有财务查看权的人」；修改「保存的对外行为」（没有财务查看权时的返回与 403）。
- `tender/pricing-compare-cost-source`：修改「来自比价矩阵的成本建议」（只对有财务查看权的人返回）。

## Impact

- 修改：`src/app/api/projects/[id]/pricing-helper/route.ts`、`src/components/tender/pricing-helper-card.tsx`；可能新增 `src/lib/tender-pricing/` 下一个纯函数文件（把对没有财务查看权的人的视图裁剪写成纯函数便于测试）。
- 测试：`src/lib/tender-pricing/__tests__/` 新增纯函数测试与隔离库用例（注册进 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`）。
- 零 schema、零依赖、零新增模型调用。
