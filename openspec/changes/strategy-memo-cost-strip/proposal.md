# Proposal：投标策略备忘送进模型前去掉我方成本（CHAIN-2d）

TASKFLOW：CHAIN-2d（新增一行；Phase F（续）— 情报串联的后续；CHAIN-2b #532 留给 GATE 的第 ③ 条，Lucas 2026-11-20 答「可以」）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

投标策略备忘由模型写成，模型输入里的报价演算带着我方成本、目标毛利、成本底价情景与每个情景的毛利，提示词还要求逐字引用毛利；备忘给项目读者看、还交给投标文件草稿的模型、写进澄清问题文件，等于绕过了财务查看权。

## What Changes

- 修改备忘的报价演算：从调查室只取对手价，不读我方成本、成本来源、目标毛利与我方报价；送进模型的演算不含这些值、「成本 + 目标毛利」「成本价」两种情景与每个情景的毛利；评分模型、对手价、打平价与相对对手价的四个情景照旧。
- 修改备忘提示词：不再要求引用毛利，写明不得陈述、估算或推测我方成本、毛利与成本底价，也不得把缺成本列为数据缺口；提示词版本 3 → 4，备忘版本 `tender-bid-strategy-memo/v2` → `v3`（v3 表示输入里没有成本）。
- 裁剪旧版备忘：情报页签读取、工作台摘要、投标文件草稿的输入、澄清问题文件都先过同一个裁剪——「评分演算」「报价策略」置空并带标记，摘要与风险门依据整段换成短句，其余段落碰到成本类字眼或像金额的数字整段换掉，碰到的 RFI 去掉。
- 修改显示与导出：卡片第一行说明旧版、怎样生成新版；工作台摘要写固定说明；投标文件草稿的输入里被隐藏的段落送空值；澄清问题文件在提交表外写明去掉了几条。新版备忘的卡片指向报价表助手看成本情景。
- 加测试：调查室里放少见的成本、落地价、我方报价，用假模型捕获每一次请求，核对整段输入里搜不到它们和由成本算出的数字（另用改动前的装配作对照）；经真实路由与投标文件草稿的输入装配核对旧版备忘被裁剪。

## Out of scope

- 不改报价表助手、成本核算接口、寻源建议卡的财务权限（CHAIN-2b #532）。
- 不批量重算已存的备忘（下一次外部情报运行且备忘合成成功时才换成 v3；合成失败时保留旧备忘，旧版裁剪照旧生效）。
- 不改项目列表与调查室读取两个原样返回房间 JSON 的接口——由 CHAIN-2b（#532）去掉其中的备忘与成本；**本 change 须在 #532 之后合并**。
- 不处理已存的投标文件草稿（`summaryJson.bidDraft`，可能由旧版备忘生成），列为后续。
- 不改旧版自动策略草案 `bidStrategyAuto`（它的输入里没有报价演算）。
- 不新增开关、不新增模型调用。

## Capabilities

### New Capabilities

- `tender/bid-strategy-memo`：投标策略备忘的模型输入不带我方成本与毛利、提示词禁止写成本与毛利、旧版备忘在每个读取处先裁剪再用。

### Modified Capabilities

无。

## Impact

- 新增：`src/lib/tender-intel/memo-pricing.ts`（纯函数：给备忘用的报价演算、「输入里没有成本」的版本集合、旧版备忘的裁剪）。
- 修改：`src/lib/tender-intel/orchestrate.ts`（报价演算改用纯函数）、`src/lib/tender-intel/strategy.ts`（提示词第 2 条与新的第 8 条、两个版本号、类型名 `BidStrategyMemoV3`）、`src/app/api/projects/[id]/external-intel/award-history/route.ts`、`src/app/api/projects/[id]/workbench-summary/route.ts`、`src/lib/projects/generate/generate-docs.ts`、`src/lib/tender-bid-draft/gather.ts`、`src/lib/tender-bid-draft/contract.ts`（读备忘先裁剪、被隐藏的段落送空值）、`src/lib/projects/generate/rfi-export.ts`（提交表外的内部说明）、`src/components/tender-intel/org-award-intel-slots.tsx`（旧版的报价策略一行）、`scripts/bid-strategy-memo-e2e.ts`（认 v3）。
- 测试：新增 `src/lib/tender-intel/__tests__/memo-pricing.test.ts` 与隔离库 `memo-legacy-db.isolated.test.ts`（都注册进 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`）；`bid-strategy-memo.test.ts` 的 MEMO-07 / MEMO-08 原样通过。
- 零 schema、零依赖、零新增模型调用。
